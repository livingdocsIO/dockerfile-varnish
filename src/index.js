#!/usr/local/bin/node
process.title = 'varnishconf'

function globalUncaughtException (reason) {
  writeChunkToStderr('entrypoint', `Uncaught Exception: ${reason.message}\n  ${reason.stack}`)
  process.exit(1)
}

function globalUnhandledRejection (reason) {
  writeChunkToStderr('entrypoint', `Unhandled Rejection: ${reason.message}\n  ${reason.stack}`)
  process.exit(1)
}

process.on('uncaughtException', globalUncaughtException)
process.on('unhandledRejection', globalUnhandledRejection)

const {writeChunkToStderr} = require('./utils')
const ConfigWatcher = require('./config-watcher')
const configReloader = require('./config-reloader')
const ProcessCollection = require('./process-collection')

async function dumpConfigCli () {
  try {
    const configWatcher = new ConfigWatcher()
    const config = await configWatcher.get()
    console.log(JSON.stringify(config, null, 2))
  } catch (err) {
    writeChunkToStderr('reload', `${err.message}\n\n${err.stack}`)
    process.exitCode = 1
  }
}

async function reloadConfigCli () {
  try {
    const configWatcher = new ConfigWatcher()
    const config = await configWatcher.get()
    writeChunkToStderr('', `Config loaded`)
    await configReloader.writeVcl(config, 'reload')
    await configReloader.reloadVcl(config, false, 'reload')
  } catch (err) {
    writeChunkToStderr('reload', `${err.message}\n${err.stack}`)
    process.exitCode = 1
  }
}

async function startVarnishCli () {
  process.on('exit', () => writeChunkToStderr('entrypoint', `Shutdown after running ${Math.floor(process.uptime() * 100) / 100}s`))

  const configWatcher = new ConfigWatcher()
  configWatcher.on('error', (err) => writeChunkToStderr('configure', `${err.message}\n${err.stack}`))

  const startTime = configWatcher.lastChange
  const hotReloadDebouncer = configReloader.debouncedHotReload()
  const config = await configWatcher.start()

  // Write all the vcls
  await configReloader.writeVcl(config)

  const processes = new ProcessCollection({
    listenAddress: config.listenAddress,
    shutdownDelay: config.shutdownDelay
  })

  process.stdin.resume()
  process.on('SIGTERM', () => processes.handleShutdownSignal('SIGTERM'))
  process.on('SIGINT', () => processes.handleShutdownSignal('SIGINT'))
  processes.on('shutdown', configWatcher.stop)
  processes.on('shutdown', hotReloadDebouncer.stop)

  process.removeListener('uncaughtException', globalUncaughtException)
  process.removeListener('unhandledRejection', globalUnhandledRejection)
  process.on('unhandledRejection', (reason) => {
    writeChunkToStderr('entrypoint', `Unhandled Rejection: ${reason.message}\n  ${reason.stack}`)
    processes.shutdown(1)
  })

  process.on('uncaughtException', (reason) => {
    writeChunkToStderr('entrypoint', `Uncaught Exception: ${reason.message}\n  ${reason.stack}`)
    processes.shutdown(1)
  })

  const varnish = processes.register({
    name: 'varnish',
    logToStdErrWithPrefix: true,
    // Logs get enabled after a successful start. we pipe explicitly until then
    disableLogs: true,
    command: '/usr/sbin/varnishd',
    stdio: ['pipe', 'pipe', 'pipe'],
    args: [
      '-d',
      '-S', config.adminSecretFile,
      '-s', config.storage,
      '-a', config.listenAddress,
      '-T', config.adminListenAddress,
      ...config.varnishRuntimeParameters
    ]
  }).start()

  const varnishSucceeded = await new Promise((resolve) => {
    const timeout = setTimeout(function () {
      writeChunkToStderr('entrypoint', `Varnish did not start within 20s: Cancelling`)
      cancelStartup()
    }, 20000)

    function cancelStartup () {
      removeListeners()
      resolve(false)
    }

    function removeListeners () {
      clearTimeout(timeout)
      varnish.cp.removeListener('exit', cancelStartup)
      varnish.cp.removeListener('error', cancelStartup)
      varnish.cp.stdout.removeListener('data', startupListener)
      varnish.cp.stderr.removeListener('data', startupListener)
    }

    async function startupListener (chunk) {
      const msg = chunk.toString()
      if (msg.includes('Info: manager dies')) {
        varnish.logChunk(msg)
        cancelStartup()
      } else if (msg.includes('said Child starts') || msg.includes('Varnish Cache CLI 1.0')) {
        removeListeners()
        varnish.enableLogs()
        await configReloader.reloadVcl(config, true)
        const port = /:(\d+)/.exec(config.listenAddress) && RegExp.$1
        writeChunkToStderr('entrypoint', `Listening on http://0.0.0.0:${port}`)
        resolve(true)
      } else {
        varnish.logChunk(msg)
      }
    }

    varnish.cp.stdout.on('data', startupListener)
    varnish.cp.stderr.on('data', startupListener)
    varnish.cp.on('exit', cancelStartup)
    varnish.cp.on('error', cancelStartup)
  })

  if (!varnishSucceeded) {
    process.exitCode = 1
    varnish.kill()
    return
  }

  if (startTime !== configWatcher.lastChange) hotReloadDebouncer(config, 'change-after-load')

  configWatcher.on('change', hotReloadDebouncer)

  /** Force refresh the configuration on SIGHUP */
  process.on('SIGHUP', () => configWatcher.refresh('SIGHUP'))

  if (config.varnishAccessLogs) {
    processes.register({
      name: 'logs',
        // // Write to stdout of main process, 1 is stdout
      stdio: ['ignore', 1, 'pipe'],
      command: '/usr/bin/varnishncsa',
      args: [
        '-t', 'off',
        '-q', 'not VCL_Log:nolog',
        '-F', '{"@timestamp":"%{%Y-%m-%dT%H:%M:%S%z}t","method":"%m","url":"%U","remote_ip":"%h","x_forwarded_for":"%{X-Forwarded-For}i","cache":"%{Varnish:handling}x","bytes":"%b","duration_usec":"%D","status":"%s","request":"%r","ttfb":"%{Varnish:time_firstbyte}x","referrer":"%{Referrer}i","user_agent":"%{User-agent}i"}'
      ]
    }).start()
  }

  if (config.prometheusListenAddress) {
    processes.register({
      name: 'prometheus',
      logToStdErrWithPrefix: true,
      command: '/usr/local/bin/prometheus_varnish_exporter',
      args: ['-web.listen-address', config.prometheusListenAddress, '-raw']
    }).start()
  }
}

const cmd = process.argv.slice(2)
if (cmd[0] === 'config') dumpConfigCli()
else if (cmd[0] === 'reload') reloadConfigCli()
else startVarnishCli()
