'use strict'
process.env.CONFIG_FILE = './test/example-config.json'
const assert = require('assert')
const ConfigWatcher = require('../src/config-watcher')
const configReloader = require('../src/config-reloader')
const watcher = new ConfigWatcher()

async function start () {
  const config = await watcher.get()
  assert.equal(typeof config, 'object')
  assert.equal(config.listenAddress, '0.0.0.0:8080,HTTP')
  assert.equal(config.adminListenAddress, '0.0.0.0:2000')
  assert.equal(config.adminSecretFile, '/etc/varnish/secret')

  await configReloader.writeVcl(config)
}

start()
