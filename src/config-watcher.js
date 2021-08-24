'use strict'
const path = require('path')
const dns = require('dns').promises
const os = require('os')
const {promises: {readFile, writeFile, mkdir}, watch} = require('fs')
const {EventEmitter} = require('events')
const template = require('./template')
const toSeconds = require('./seconds')

function delay (time) {
  let resolve
  const promise = new Promise((_resolve) => { resolve = _resolve })
  const timeout = setTimeout(resolve, time)
  promise.refresh = () => timeout.refresh()
  promise.continue = () => { clearTimeout(timeout); resolve() }
  promise.clear = () => { clearTimeout(timeout) }
  return promise
}

/**
 * @typedef {Object} VarnishConfig
 * @prop {string} listenAddress
 * @prop {string} adminListenAddress
 * @prop {string} adminSecret
 * @prop {string} adminSecretFile
 * @prop {Array<VclConfig>} vcl
 * @prop {Array} probes
 * @prop {Array<Cluster>} clusters
 * @prop {Object} parameters
*/

/**
 * @typedef {Object} VclConfig
 * @prop {string} name
 * @prop {string} path
 * @prop {string} content
*/

/**
 * @typedef {Object} Cluster
 * @prop {string} name
 * @prop {HttpEndpoint|UnixSocketEndpoint} address
 * @prop {Array<HttpEndpoint|UnixSocketEndpoint>} addresses
 * @prop {string} probe
*/

/**
 * @typedef {Object} HttpEndpoint
 * @prop {string} name
 * @prop {string} host
 * @prop {number} port
 * @prop {string} path
*/

/**
 * @typedef {Object} UnixSocketEndpoint
 * @prop {string} name
 * @prop {string} path
*/

const defaultValues = {
  listenAddress: `0.0.0.0:${process.env.VARNISH_PORT || 8080},HTTP`,
  adminListenAddress: `0.0.0.0:${process.env.VARNISH_ADMIN_PORT || 2000}`,
  prometheusListenAddress: `:${process.env.PROMETHEUS_EXPORTER_PORT || 9131}`,
  storage: `default,${process.env.VARNISH_CACHE_SIZE || '512m'}`,
  varnishRuntimeParameters: [],
  configDirectory: '/etc/varnish',
  adminSecretFile: '/etc/varnish/secret',
  varnishAccessLogs: (process.env.VARNISH_ACCESS_LOG || process.env.VARNISH_ACCESS_LOGS) !== 'false',
  shutdownDelay: '5s',
  adminSecret: null,
  watchFiles: true,
  watchDns: true,
  vcl: [{name: 'default', src: 'default.vcl.ejs'}],
  probes: (process.env.BACKEND && process.env.BACKEND_PROBE === 'true') ? [{name: 'delivery'}] : [],
  acl: [{
    name: 'purge',
    entries: [
      '# localhost',
      'localhost',
      '127.0.0.1',
      '::1',
      '# Private networks',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      ...(process.env.PURGE_IP_WHITELIST || '212.51.140.235,104.248.103.88').split(',')
    ]
  }],
  fetchRetries: 1,
  clusters: process.env.BACKEND ? [{
    name: 'delivery',
    probe: process.env.BACKEND_PROBE === 'true' ? 'delivery' : undefined,
    addresses: [process.env.BACKEND]
  }] : [],
  parameters: {
    feature: '+http2,+esi_disable_xml_check',
    default_grace: toSeconds(process.env.VARNISH_CACHE_GRACE || '24h'),
    default_keep: toSeconds(process.env.VARNISH_CACHE_KEEP || '1h'),
    default_ttl: toSeconds(process.env.VARNISH_CACHE_TTL || '4m'),
    backend_idle_timeout: 65,
    timeout_idle: 60,
    syslog_cli_traffic: 'off'
  }
}

function assertType (value, type, message) {
  if (type === 'number') {
    if (parseInt(value) != value) throw new Error(message)
    else value = parseInt(value)
  }

  if (typeof value !== type) throw new Error(message)
  return value
}

function probeDefaults (probe, i) {
  try {
    if (typeof probe !== 'object') throw new Error(`must be an object.`)

    probe.url = assertType(probe.url || '/status', 'string', 'probe.url must be a string.')

    if (!probe.interval) probe.interval = `5s`
    else probe.interval = `${toSeconds(probe.interval)}s`

    if (!probe.timeout) probe.timeout = `4s`
    else probe.timeout = `${toSeconds(probe.timeout)}s`

    probe.window = assertType(probe.window || 3, 'number', 'probe.window must be a number.')
    probe.threshold = assertType(probe.threshold || 2, 'number', 'probe.threshold must be a number.')
    return probe
  } catch (err) {
    throw new Error(`The probe config in config.probes[${i}] is invalid: ${err.message}`)
  }
}

class ConfigWatcher extends EventEmitter {
  constructor () {
    super()
    // Change this to /etc/varnish/config.json
    this.configFilePath = path.resolve(process.env.CONFIG_FILE || '/etc/varnish/config.json')
    this.configDirPath = path.dirname(this.configFilePath)
    this.configDirGeneratedPath = path.join(this.configDirPath, 'generated')
    this._config = undefined
    this._addresses = undefined
    this._resolvedAddresses = undefined
    this._firstTime = true
    this._started = false
    this.lastChange = new Date()
  }

  /**@returns {Promise<VarnishConfig>} */
  async get () {
    return this._forceRefresh()
  }

  /**@returns {Promise<VarnishConfig>} */
  async start () {
    if (this._started) throw new Error(`Can't call configWatcher.start() multiple times`)
    this._started = true
    const config = await this._forceRefresh()

    this._watchFilesEnabled = config.watchFiles
    this._watchDnsEnabled = config.watchDns
    if (this._config.watchFiles) this._watchFiles()
    if (this._config.watchDns) this._watchDns()
    return this._resolvedConfig
  }

  _notifyChange (config, type) {
    this.lastChange = new Date()

    if (this._watchFilesEnabled !== config.watchFiles) {
      if (config.watchFiles) this._watchFiles()
      else this._watchFilesAbortController?.abort()
    }

    if (this._watchDnsEnabled !== config.watchDns) {
      if (config.watchDns) this._watchDns()
      else this._watchDnsAbortController?.abort()
    }

    this._watchFilesEnabled = config.watchFiles
    this._watchDnsEnabled = config.watchDns
    this.emit('change', config, type)
  }

  refresh () {
    this._forceRefresh()
      .then(() => this._notifyChange(this._resolvedConfig, 'SIGHUP'))
      .catch(err => this.emit('error', err))
  }

  stop () {
    if (this._stopped) return
    this._stopped = true
    this._rawDnsRetryDelay?.continue()
    this._watchFilesAbortController?.abort()
    this._watchDnsAbortController?.abort()
  }

  async _rawConfig () {
    const time = Date.now()
    let fileContent, config
    try {
      fileContent = await readFile(this.configFilePath, 'utf8')
      this._configFilePathExists = true
    } catch (err) {
      if (err.code === 'ENOENT') {
        fileContent = '{}'
        this._configFilePathExists = false
        this.emit('error', {
          message: `Config file ${this.configFilePath} does not exist. Fallback to environment variables.`,
          stack: ''
        })
      } else {
        throw new Error(`Failed to read config file ${this.configFilePath}: ${err.message}`)
      }
    }

    try {
      config = JSON.parse(fileContent)
    } catch (err) {
      throw new Error(`Failed to parse config file ${this.configFilePath}: ${err.message}`)
    }

    // Set defaults
    for (const prop in defaultValues) {
      if (config[prop] === undefined) config[prop] = deepClone(defaultValues[prop])
    }

    if (!config.vcl?.length) {
      throw new Error('The array config.vcl must include at least one varnish vcl')
    }

    if (!config.clusters?.length) {
      throw new Error('The array config.clusters must include at least one backend')
    }

    if (this._firstTime) {
      try {
        await mkdir(this.configDirGeneratedPath)
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw new Error(`Failed to create directory ${this.configDirGeneratedPath}: ${err.message}`)
        }
      }

      try {
        await readFile(config.adminSecretFile)
      } catch (err) {
        if (err.code === 'ENOENT') {
          if (!config.adminSecret) config.adminSecret = require('crypto').randomBytes(36).toString('hex')
          await writeFile(config.adminSecretFile, config.adminSecret)
        } else {
          throw err
        }
      }
      this._firstTime = false
    }
    config.adminSecret = '[TRUNCATED]'

    if (config.shutdownDelay == null) config.shutdownDelay = '5s'
    config.shutdownDelay = toSeconds(config.shutdownDelay)

    // Validate and normalize the probe configs
    ;(config.probes = config.probes || []).map(probeDefaults)

    const acls = config.acl = config.acl || []
    const hasPurgeAcl = acls.find((a) => a.name === 'purge')
    if (!hasPurgeAcl) acls.push(defaultValues.acl[0])

    config.xServedBy = (config.xServedBy || '{{host}}').replace(/{{\s*host(?:name)?\s*}}/, os.hostname())
    if (!config.vcl.find((v) => v.top)) config.vcl[config.vcl.length - 1].top = true

    config.vcl = await Promise.all(config.vcl.map(async (vcl, i) => {
      if (!vcl.src || !vcl.name) throw new Error(`The config.vcl[${i}] config requires a 'name' and 'src'`)

      vcl.id = `${vcl.name}_${time}`
      vcl.src = path.resolve(this.configDirPath, vcl.src)
      vcl.dest = vcl.dest
        ? path.resolve(this.configDirPath, vcl.dest)
        : path.join(this.configDirGeneratedPath, path.basename(vcl.src, '.ejs'))

      try {
        const content = await readFile(vcl.src, 'utf8')
        vcl.render = template.compile(content)
      } catch (err) {
        if (err.code === 'ENOENT') throw new Error(`Could not read VCL file ${vcl.src}: File does not exist`)
        throw new Error(`Could not read VCL file ${vcl.src}: ${err.message}`)
      }
      return vcl
    }))

    const addresses = {}
    for (const c of config.clusters) {
      let addrs = c.address || c.addresses
      if (!Array.isArray(addrs)) addrs = [addrs]
      c.addresses = addrs
      delete c.address
      for (const address of addrs) {
        if (typeof address !== 'string') {
          throw new Error(`Invalid hostname in cluster.addresses array: ${JSON.stringify(address)}`)
        }

        // Skip if the address already got parsed
        if (addresses[address]) continue

        // Support unix sockets
        if (address.startsWith('/')) {
          addresses[address] = {path: address}
          continue
        }

        // Support hostnames and fallback to port 80 if none is present
        try {
          const {port, hostname} = new URL(address.replace(/^(https?::\/\/)?/, 'http://'))
          addresses[address] = {hostname, port: port || 80}
        } catch (err) {
          throw new Error(`Invalid hostname in cluster.addresses: ${JSON.stringify(address)}`)
        }
      }
    }

    return deepFreeze({config, addresses})
  }

  async _rawDns (addresses, retries = 1) {
    try {
      const resolved = {}
      const promises = []
      let tries = 0
      for (const address in addresses) {
        // Skip resolving unix sockets
        if (address.path) {
          resolved[address] = [path]
        } else {
          promises.push(dns.resolve4(addresses[address].hostname).then((addrs) => {
            resolved[address] = addrs
          }))
        }
      }
      await Promise.all(promises)
      return resolved
    } catch (err) {
      const msg = err.message
      if (!retries) {
        err.message = `Failed to resolve DNS: ${msg}`
        throw err
      }

      err.message = `Failed to resolve DNS. Retrying in 1s: ${msg}`
      this.emit('error', err)
      await (this._rawDnsRetryDelay = delay(1000))
      if (this._stopped) {
        err.message = `Failed to resolve DNS: ${msg}`
        throw err
      }
      if (retries) return this._rawDns(addresses, retries - 1)
    }
  }

  async _watchDns () {
    if (this._watchDnsAbortController) this._watchDnsAbortController.abort()
    this._watchDnsAbortController = new AbortController()

    let _timeout
    const signal = this._watchDnsAbortController.signal
    signal.addEventListener('abort', () => {
      this._watchDnsAbortController = undefined
      _timeout?.continue()
      this._watchDnsTimeout = undefined
    })

    while (!signal.aborted) {
      try {
        const current = this._resolvedAddresses
        const resolved = await this._rawDns(this._addresses)
        if (signal.aborted)  return

        if (!addressObjectIsEqual(current, resolved)) {
          this._resolvedAddresses = resolved
          this._resolvedConfig = this._toResolvedConfig(this.addresses, this._config, this._resolvedAddresses)
          this._notifyChange(this._resolvedConfig, 'dns')
        }
      } catch (err) {
        if (signal.aborted) return
        err.message = `DNS resolution failed: ${err.message}`
        this.emit('error', err)
      }

      await (_timeout = this._watchDnsTimeout = delay(5000))
    }
  }

  _watchFiles () {
    if (this._watchFilesAbortController) this._watchFilesAbortController.abort()
    this._watchFilesAbortController = new AbortController()

    let timeout
    const signal = this._watchFilesAbortController.signal
    signal.addEventListener('abort', () => {
      this._watchFilesAbortController = undefined
      timeout?.continue()
    })

    const onChange = () => {
      if (timeout) return timeout.refresh()
      // debounce by 50ms
      timeout = delay(50)
      timeout.then(() => {
        if (signal.aborted) return
        timeout = undefined
        this._forceRefresh()
          .then(() => this._notifyChange(this._resolvedConfig, 'file'))
          .catch((err) => this.emit('error', err))
      })
    }

    const onError = (err) => {
      if (err.name === 'AbortError') return
      this.emit('error', err)
    }

    const opts = {signal}

    try {
      watch(this.configDirPath, opts, onChange).on('error', onError)
    } catch (err) {
      onError(err)
    }
  }

  _toResolvedConfig (addresses, config, resolvedAddresses) {
    const conf = deepClone(config)
    for (const c of conf.clusters) {
      const addrs = []
      for (const key of c.addresses) {
        const resolved = resolvedAddresses[key]
        if (!resolved) throw new Error(`Could not resolve address ${key}`)

        for (const addr of resolved) {
          const a = {name: `${c.name}_${addrs.length}`}
          if (addresses[key].port) a.port = addresses[key].port
          if (addr.startsWith('/')) a.path = addr
          else a.host = addr
          addrs.push(a)
        }
      }
      c.addresses = addrs
    }
    return conf
  }

  /**@returns {Promise<VarnishConfig>} */
  async _forceRefresh () {
    try {
      const c = await this._rawConfig()
      this._addresses = c.addresses
      this._config = c.config
      this._resolvedAddresses = await this._rawDns(c.addresses)
      // We just triggered a dns refresh, so delay it in case there's one
      this._watchDnsTimeout?.refresh()
      this._resolvedConfig = this._toResolvedConfig(c.addresses, c.config, this._resolvedAddresses)
    } catch (err) {
      err.message = `Failed to load config: ${err.message}`
      throw err
    }
    return this._resolvedConfig
  }
}

module.exports = ConfigWatcher


function deepFreeze (obj) {
  if (Object.isFrozen(obj)) return obj
  if (typeof obj !== 'object') return obj
  Object.freeze(obj)
  for (const key of Object.keys(obj)) deepFreeze(obj[key])
  return obj
}

function deepClone (obj) {
  switch (Object.prototype.toString.call(obj)) {
    case '[object Object]':
      const clone = {}
      for (const key of Object.keys(obj)) clone[key] = deepClone(obj[key])
      return clone
    case '[object Array]':
      return obj.map(deepClone)
    default:
      return obj
  }
}

function addressObjectIsEqual (a, b) {
  for (const key in a) {
    if (!(key in b)) return false
    if (a[key].length !== b[key].length) return false
    for (let i = 0; i < a[key].length; i++) {
      if (!b[key].includes(a[key][i])) return false
    }
  }
  return true
}
