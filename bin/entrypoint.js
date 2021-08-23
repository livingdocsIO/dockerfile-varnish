#!/usr/bin/node
const fs = require('fs')
const crypto = require('crypto')
const {spawn} = require("child_process")
const toSeconds = require('./seconds')
function normalizeIps (str) {
  return str.replace(/([0-9.:]+)/g, '"$1"').replace(/\/"([0-9]+)"/g, '/$1')
}

function writeChunkToStderr (procName, chunk) {
  const lines = chunk.toString().trim().split('\n')
  for (let i = 0; i < lines.length; i++) {
    lines[i] = `${new Date().toISOString()} [${procName}]: ${lines[i]}`
  }
  process.stderr.write(lines.join('\n') + '\n')
}

class ProcessCollection {
  constructor () {
    this.processes = []
    this.shuttingDown = false
    this.shutdownPromise = new Promise((resolve) => {
      this._shutdownResolve = resolve
    })
  }

  async _shutdown (exitCode) {
    for (const proc of this.processes) {
      if (!proc.killBeforeExit) continue
      proc.kill()
    }

    const wait = await new Promise((resolve) => {
      const req = require('http').request({
        method: 'POST',
        host: 'localhost',
        path: '/_health',
        port: env.VARNISH_PORT,
        headers: {health: '503'}
      }, (res) => resolve(res.statusCode === 200))
      req.on('error', () => resolve(false))
      req.end()
    })

    if (wait) {
      writeChunkToStderr('entrypoint', `Graceful Shutdown, waiting for ${shutdownDelay} seconds.`)
      await new Promise((resolve) => setTimeout(resolve, shutdownDelay * 1000))
    }

    for (const proc of this.processes) proc.kill()

    await Promise.race([
      this.shutdownPromise,
      new Promise((resolve) => setTimeout(resolve, 2000))
    ])

    for (const proc of this.processes) proc.kill('SIGKILL')

    process.exit(exitCode)
  }

  handleShutdownSignal (signal) {
    process.stdout.write('\n')
    if (this.shuttingDown) return
    this.shuttingDown = true
    writeChunkToStderr('entrypoint', `Shutdown with signal ${signal}`)
    this._shutdown(0)
  }

  _handleChildExit (proc, code, signal) {
    if (this.shuttingDown) return
    this.shuttingDown = true
    writeChunkToStderr(proc.name, `Exited with${code !== null ? ` code ${code}` : ''}${signal ? ` signal ${signal}` : ''}`)
    this._shutdown(code)
  }

  register (opts) {
    this.processes.push({
      name: opts.name,
      command: opts.command,
      args: opts.args || [],
      killBeforeExit: opts.killBeforeExit,
      logToStdErrWithPrefix: opts.logToStdErrWithPrefix,
      delay: opts.delay,
      kill (signal) {
        if (!this.cp) return
        if (this.cp.killed) return
        this.cp.stdout.removeAllListeners()
        this.cp.stderr.removeAllListeners()
        this.cp.kill(signal)
      }
    })

    return this
  }

  async launch (env) {
    await refreshConfig(true)
      .then((exit) => {
        if (exit.code) process.exit(exit.code)
      })

    writeChunkToStderr('entrypoint', `Listening on http://0.0.0.0:${env.VARNISH_PORT}`)
    await Promise.all(this.processes.map(async (proc) =>{
      if (proc.delay) await new Promise((resolve) => setTimeout(resolve, proc.delay))
      if (this.shuttingDown) return

      proc.cp = exec(proc)
      proc.cp.then((exit) => {
        this._handleChildExit(proc, exit.code, exit.signal)
        if (exit.code) return

        this.processes.splice(this.processes.indexOf(proc), 1)
        if (this.processes.length === 0) this._shutdownResolve()
      })
    }))
  }
}

function refreshConfig (syncOnly = false) {
  syncOnly = syncOnly ? ['--sync-only'] : []

  return exec({
    name: 'configure',
    command: '/bin/confd',
    args: ['--log-level', 'info', '--onetime', '--backend', 'env', ...syncOnly]
  })
}

function exec (opts) {
  let resolve
  const promise = new Promise((_resolve) => { resolve = _resolve })

  const proc = spawn(
    opts.command,
    opts.args,
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, ...env}
    }
  )

  const writeProcStdErr = (chunk) => writeChunkToStderr(opts.name, chunk)
  proc.stdout.on('data', writeProcStdErr)
  proc.stderr.on('data', writeProcStdErr)
  proc.on('exit', (code, signal) => resolve({code, signal}))
  proc.on('error', (err) => { writeChunkToStderr(opts.name, err.stack); resolve({code: 1, err}) })
  proc.then = (resolve, reject) => promise.then(resolve, reject)
  return proc
}

const env = {
  VARNISH_CONFIG: process.env.VARNISH_CONFIG || '/etc/varnish/default.vcl',
  VARNISH_PORT: process.env.VARNISH_PORT || "80",
  VARNISH_ADMIN_PORT: process.env.VARNISH_ADMIN_PORT || "2000",
  VARNISH_ADMIN_SECRET_FILE: process.env.VARNISH_ADMIN_SECRET_FILE || "/etc/varnish/secret",
  BACKEND: process.env.BACKEND,
  BACKEND_FETCH_RETRIES: process.env.BACKEND_FETCH_RETRIES || '1',
  BACKEND_MAX_CONNECTIONS: process.env.BACKEND_MAX_CONNECTIONS || '75',
  BACKEND_CONNECT_TIMEOUT: toSeconds(process.env.BACKEND_CONNECT_TIMEOUT || '0.7s'),
  BACKEND_FIRST_BYTES_TIMEOUT: toSeconds(process.env.BACKEND_FIRST_BYTES_TIMEOUT || '30s'),
  BACKEND_BETWEEN_BYTES_TIMEOUT: toSeconds(process.env.BACKEND_BETWEEN_BYTES_TIMEOUT || '30s'),
  BACKEND_PROBE: process.env.BACKEND_PROBE || false,
  BACKEND_PROBE_URL: process.env.BACKEND_PROBE_URL || '/status',
  BACKEND_PROBE_INTERVAL: toSeconds(process.env.BACKEND_PROBE_INTERVAL || '2s'),
  BACKEND_PROBE_TIMEOUT: toSeconds(process.env.BACKEND_PROBE_TIMEOUT || '1s'),
  BACKEND_PROBE_WINDOW: process.env.BACKEND_PROBE_WINDOW || '3',
  BACKEND_PROBE_THRESHOLD: process.env.BACKEND_PROBE_THRESHOLD || '2',
  REMOTE_BACKEND: process.env.REMOTE_BACKEND,
  PURGE_IP_WHITELIST: normalizeIps(process.env.PURGE_IP_WHITELIST || '212.51.140.235,104.248.103.88'),
  VARNISH_STRIP_QUERYSTRING: process.env.VARNISH_STRIP_QUERYSTRING || false,
  VARNISH_CUSTOM_SCRIPT: process.env.VARNISH_CUSTOM_SCRIPT || '',
}

const cacheSize = process.env.VARNISH_CACHE_SIZE || '512m'
const cacheTTL= toSeconds(process.env.VARNISH_CACHE_TTL || '4m')
const cacheGrace= toSeconds(process.env.VARNISH_CACHE_GRACE || '24h')
const cacheKeep= toSeconds(process.env.VARNISH_CACHE_KEEP || '1h')
const accessLogs= process.env.VARNISH_ACCESS_LOG !== 'false'
const prometheusExporterPort = process.env.PROMETHEUS_EXPORTER_PORT || '9131'
const shutdownDelay = toSeconds(process.env.VARNISH_SHUTDOWN_DELAY || '5s')
const runtimeParameters = (process.env.VARNISH_RUNTIME_PARAMETERS || '').split(' ').filter(Boolean)

if (!process.env.VARNISH_ADMIN_SECRET_FILE) {
  const varnishAdminSecret = process.env.VARNISH_ADMIN_SECRET || crypto.randomBytes(36).toString('hex')
  fs.writeFileSync(env.VARNISH_ADMIN_SECRET_FILE, varnishAdminSecret)
}

const processes = new ProcessCollection()
  .register({
    name: 'varnish',
    logToStdErrWithPrefix: true,
    command: '/usr/sbin/varnishd',
    args: [
      '-F', '-f', env.VARNISH_CONFIG,
      '-S', env.VARNISH_ADMIN_SECRET_FILE,
      '-s', `default,${cacheSize}`,
      '-a', `0.0.0.0:${env.VARNISH_PORT}`,
      '-T', `0.0.0.0:${env.VARNISH_ADMIN_PORT}`,
      '-p', 'feature=+http2,+esi_disable_xml_check',
      '-p', `default_grace=${cacheGrace}`,
      '-p', `default_keep=${cacheKeep}`,
      '-p', `default_ttl=${cacheTTL}`,
      '-p', `backend_idle_timeout=65`,
      '-p', `timeout_idle=60`,
      '-p', `syslog_cli_traffic=off`,
      ...runtimeParameters
    ]
  })
  .register({
    name: 'configure',
    logToStdErrWithPrefix: true,
    killBeforeExit: true,
    command: '/bin/confd',
    args: ['--backend', 'env', '--interval', '10']
  })

if (accessLogs) {
  processes.register({
    name: 'logs',
    command: '/usr/bin/varnishncsa',
    args: [
      '-t', 'off',
      '-q', 'not VCL_Log:nolog',
      '-F', '{"@timestamp":"%{%Y-%m-%dT%H:%M:%S%z}t","method":"%m","url":"%U","remote_ip":"%h","x_forwarded_for":"%{X-Forwarded-For}i","cache":"%{Varnish:handling}x","bytes":"%b","duration_usec":"%D","status":"%s","request":"%r","ttfb":"%{Varnish:time_firstbyte}x","referrer":"%{Referrer}i","user_agent":"%{User-agent}i"}',
      // Write to stdout of main process
      '-w', `/proc/${process.pid}/fd/${process.stdout.fd}`
    ],
    delay: 1000
  })
}

if (prometheusExporterPort) {
  processes.register({
    name: 'prometheus',
    logToStdErrWithPrefix: true,
    command: '/bin/prometheus_varnish_exporter',
    args: ['-web.listen-address', `:${prometheusExporterPort}`, '-raw'],
    delay: 1000
  })
}

process.stdin.resume()
process.on('SIGTERM', () => processes.handleShutdownSignal('SIGTERM'))
process.on('SIGINT', () => processes.handleShutdownSignal('SIGINT'))
process.on('SIGHUP', () => refreshConfig())
process.on ('exit', () => writeChunkToStderr('entrypoint', `Shutdown after running ${Math.floor(process.uptime() * 100) / 100}s`))
process.on('unhandledRejection', (reason) => {
  writeChunkToStderr('entrypoint', reason.stack)
  process.exit(1)
})

processes.launch(env)
