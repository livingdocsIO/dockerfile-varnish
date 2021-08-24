const {writeFile, readFile} = require('fs/promises')
const VarnishAdminClient = require('./varnish-admin-client')
const {writeChunkToStderr} = require('./utils')

function debouncedHotReload () {
  let stopped = false
  let _timeout
  let _continue
  let nextConfig

  async function hotReloadConfig (config, type) {
    if (stopped) return
    const pending = !!nextConfig
    nextConfig = config
    writeChunkToStderr('configure', `Config reload triggered: ${type}`)
    if (pending) {
      return writeChunkToStderr('configure', `Config reload is in progress. Waiting to finish.`)
    }

    while (nextConfig) {
      if (stopped) return
      writeChunkToStderr('configure', `Config reload starting.`)
      const conf = nextConfig
      try {
        await writeVcl(conf, 'configure')
        await reloadVcl(conf, false, 'configure')
      } catch (err) {
        if (stopped) return
        writeChunkToStderr('configure', `Config reload failed: ${err.message}\n${err.stack}`)
        await new Promise((resolve) => {
          _timeout = setTimeout(resolve, 5000)
          _continue = resolve
        })
        continue
      }
      if (conf === nextConfig) nextConfig = undefined
    }
  }

  hotReloadConfig.stop = () => {
    stopped = true
    clearTimeout(_timeout)
    _continue?.()
  }

  return hotReloadConfig
}

async function writeVcl (config, prefix = 'configure') {
  try {
    await Promise.all(config.vcl.map(async (vcl) => writeFile(vcl.dest, vcl.render(config))))
    writeChunkToStderr(prefix || 'configure', `VCL files written.`)
  } catch (err) {
    err.message = `Failed to write vcl files: ${err.message}`
    throw err
  }
}

async function reloadVcl (config, withStartCommand, prefix = 'configure') {
  let client
  try {
    client = new VarnishAdminClient({
      host: 'localhost',
      port: /:(\d+)/.exec(config.adminListenAddress) && RegExp.$1,
      secret: await readFile(config.adminSecretFile, 'utf8')
    })

    // Do not update the vcl if none are present
    if (config.vcl.length) {
      const vclBeforeLoad = (await client.request('vcl.list -j')).body.slice(3)
        .filter((vcl) => { return vcl.status === 'active' || vcl.status === 'active'})

      // Load all the vcls first
      for (const vcl of config.vcl) {
        await client.request(`vcl.load ${vcl.id} ${vcl.dest}`)
        if (!vcl.top) await client.request(`vcl.label ${vcl.name} ${vcl.id}`)
      }

      // Then set the primary vcl to active
      await client.request(`vcl.use ${config.vcl.find((v) => v.top).id}`)
      for (const vcl of vclBeforeLoad) {
        try {
          await client.request(`vcl.discard ${vcl.name}`)
        } catch (err) {
          writeChunkToStderr(prefix, `Failed to discard the old vcl: ${err.message}\n${err.stack}`)
        }
      }
    }

    // Refresh parameters in varnish
    for (const param in config.parameters) {
      await client.request(`param.set ${param} ${config.parameters[param]}`)
    }

    if (withStartCommand) await client.request(`start`)
    writeChunkToStderr(prefix, `Varnish reloaded. Configuration reload completed.`)
    client.close()
  } catch (err) {
    client.close()
    err.message = `Failed to reload config in varnish: ${err.message}`
    throw err
  }
}

module.exports = {debouncedHotReload, writeVcl, reloadVcl}
