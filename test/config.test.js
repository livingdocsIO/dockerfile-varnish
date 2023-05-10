'use strict'
process.env.CONFIG_SOURCE = require.resolve('./source/config.json')
process.env.CONFIG_OUTPUT = './dest/'

const assert = require('assert')
const ConfigWatcher = require('../src/config-watcher')
const configReloader = require('../src/config-reloader')
const watcher = new ConfigWatcher()

async function start () {
  const config = await watcher.get()
  assert.equal(typeof config, 'object')
  assert.equal(config.listenAddress, '0.0.0.0:8080,HTTP')
  assert.equal(config.adminListenAddress, '0.0.0.0:2000')
  assert.equal(config.adminSecretFile.endsWith('/test/source/dest/secret'), true)

  // assert that the secret got written
  require.resolve('./source/dest/secret')

  await configReloader.writeVcl(config)

  // assert that the vcl got written
  require.resolve('./source/dest/default.vcl')
}

start()
