const {EventEmitter} = require('events')
const {spawn} = require("child_process")
const {writeChunkToStderr} = require('./utils')
class ProcessCollection extends EventEmitter {
  constructor ({listenAddress, shutdownDelay}) {
    super()
    this.config = {listenAddress, shutdownDelay}
    this.processes = []
    this.shuttingDown = false
    this._allProcessesShutdownPromise = new Promise((resolve) => {
      this._allProcessesShutdownResolve = resolve
    })
  }

  async shutdown (exitCode) {
    if (this.shuttingDown) return
    this.shuttingDown = true

    this.emit('shutdown', exitCode)
    for (const proc of this.processes) {
      if (!proc.killBeforeExit) continue
      proc.kill()
    }

    const port = /:(\d+)/.exec(this.config.listenAddress) && RegExp.$1
    if (port && this.config.shutdownDelay) {
      const wait = await new Promise((resolve) => {
        const req = require('http').request({
          method: 'POST',
          host: 'localhost',
          path: '/_health',
          port,
          headers: {health: '503'}
        }, (res) => resolve(res.statusCode === 200))
        req.on('error', () => resolve(false))
        req.end()
      })

      if (wait) {
        writeChunkToStderr('entrypoint', `Graceful Shutdown, waiting for ${this.config.shutdownDelay} seconds.`)
        await new Promise((resolve) => setTimeout(resolve, this.config.shutdownDelay * 1000))
      }
    }

    for (const proc of this.processes) proc.kill()

    await Promise.race([
      this._allProcessesShutdownPromise,
      new Promise((resolve) => setTimeout(resolve, 5000))
    ])

    for (const proc of this.processes) proc.kill('SIGKILL')

    // Use exit code 0 as process.exitCode might be assigned somewhere else
    if (exitCode === 0) process.exit()
    else process.exit(exitCode)
  }

  handleShutdownSignal (signal) {
    process.stdout.write('\n')
    if (this.shuttingDown) return
    writeChunkToStderr('entrypoint', `Shutdown with signal ${signal}`)
    this.shutdown(0)
  }

  _handleChildExit (proc, code, signal) {
    if (this.shuttingDown) return
    writeChunkToStderr(proc.name, `Exited with${code !== null ? ` code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`)
    this.shutdown(code)
  }

  register (opts) {
    const logChunk = (chunk) => writeChunkToStderr(proc.name, chunk)

    const proc = {
      name: opts.name,
      command: opts.command,
      args: opts.args || [],
      killBeforeExit: opts.killBeforeExit,
      logToStdErrWithPrefix: opts.logToStdErrWithPrefix,
      stdio: opts.stdio,
      disableLogs: opts.stdio,
      logChunk,
      enableLogs () {
        proc.cp.stdout.on('data', logChunk)
        proc.cp.stderr.on('data', logChunk)
      },
      start: () => {
        return this._launchProcess(proc)
      },
      kill (signal) {
        if (!proc.cp) return
        if (proc.cp.killed) return
        proc.cp.stdout?.removeAllListeners()
        proc.cp.stderr?.removeAllListeners()
        proc.cp.kill(signal)
      }
    }

    this.processes.push(proc)
    return proc
  }

  _launchProcess (proc) {
    if (proc.started) return
    if (this.shuttingDown) return
    proc.started = true

    if (this.shuttingDown) return

    proc.cp = exec(proc, this.env)
    if (!proc.disableLogs) proc.enableLogs()
    proc.cp.on('error', () => {
      proc.kill()
      this._handleChildExit(proc, 1, 'ERROR')
    })
    proc.cp.on('exit', (code, signal) => {
      this._handleChildExit(proc, code, signal)
      this.processes.splice(this.processes.indexOf(proc), 1)
      if (this.processes.length === 0) this._allProcessesShutdownResolve()
    })
    return proc
  }
}

function exec (proc, env) {
  const cp = spawn(
    proc.command,
    proc.args,
    {
      detached: true,
      stdio: proc.stdio || ['ignore', 'pipe', 'pipe'],
      env: {...process.env, ...env}
    }
  )

  cp.on('error', (err) => writeChunkToStderr(proc.name, err.stack))
  return cp
}

module.exports = ProcessCollection
