const net = require('net')
const crypto = require('crypto')
const {EventEmitter} = require('events')

class VarnishAdminClient extends EventEmitter {
  failures = 0
  authenticating = false
  queue = []
  constructor (opts = {host: '127.0.0.1', port: 2000}) {
    super()
    this.opts = opts
    this._waitForCommand = new Promise((resolve) => { this._sendCommand = resolve })
    this._start()
  }

  close () {
    this.closed = true
    this._socket?.destroy()
    this._sendCommand?.()
    this._socket = undefined
    this._sendCommand = undefined
  }

  async _start () {
    while (true) {
      if (this.closed) return

      try {
        if (this._socket?.destroyed === false) this._socket.destroy()
        const socket = this._socket = net.createConnection({host: this.opts.host, port: this.opts.port})
        await Promise.all([
          new Promise((resolve, reject) => socket.on('error', reject)),
          (async () => {
            for await (const chunk of socket) await this._onChunk(socket, chunk)
          })()
        ])
      } catch (err) {
        if (this.failures !== 0) {
          console.warn(
            `${new Date().toISOString()} [configure]`,
            `Failed to connect to varnish ${this.failures} times.`,
            err
          )
        }
        this.failures = this.failures + 1
        if (this._resolveCommand) this._handleResponse(500, err)
      }

      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  async _onChunk (socket, chunk) {
    const response = chunk.toString()
    const status = parseInt(response.match(/^(\d\d\d)/) && RegExp.$1)
    let body = response.slice(response.indexOf('\n')).trim()
    try {
      body = JSON.parse(body)
    } catch (err) {
      // Patch a faulty varnish vcl.list response
      // A fix for that got merged to master already
      // https://github.com/varnishcache/varnish-cache/issues/3677
      // $ varnishd -d -a 0.0.0.0:8080 -T 0.0.0.0:2000 -S /etc/varnish/secret
      // $ varnishadm vcl.list -j
      // body = `200 44
      // [ 2, ["vcl.list", "-j"], 1629933022.312,
      //
      // ]`
      if (status === 200 && typeof body === 'string') {
        const tmp = body.replace(/,\n\n]$/, ']')
        try { body = JSON.parse(tmp) } catch (err) { }
      }
    }

    if (status === 107) {
      const challenge = response.split('\n')[1]
      const signed = crypto.createHash('sha256')
        .update(`${challenge}\n${this.opts.secret}${challenge}\n`, 'utf8')
        .digest('hex')
      socket.write(`auth ${signed}\n`)
      this.authenticating = true
      return
    } else if (this.authenticating) {
      this.authenticating = false

      if (status !== 200) {
        console.warn(
          `${new Date().toISOString()} [configure]`,
          `Authentication against Varnish Admin Socket failed with status ${status}`
        )
        return
      } else {
        console.log(
          `${new Date().toISOString()} [configure]`,
          'Authenticated against Varnish Admin Socket'
        )
      }

      this.failures = 0
    } else if (this._resolveCommand) {
      this._handleResponse(status, body)
    }

    if (this.closed) return
    const cmd = await this._waitForCommand
    this._waitForCommand = undefined
    try {
      socket.write(`${cmd}\n`)
    } catch (err) {
      err.message = `Varnish Admin Socket write failed: ${err.message}`
      this._handleResponse(500, err)
      socket.destroy(err)
    }
  }

  _handleResponse (status, body) {
    if (body instanceof Error) {
      this._rejectCommand(body)
    } else if (status !== 200) {
      const err = new Error(body.replace(`\nType 'help' for more info.`, ''))
      err.status = status
      this._rejectCommand(err)
    } else {
      this._resolveCommand({status, body})
    }
    this._resolveCommand = undefined
    this._rejectCommand = undefined
    this._waitForCommand = new Promise((resolve) => { this._sendCommand = resolve })
  }

  async request (command) {
    return new Promise((resolve, reject) => {
      if (this._resolveCommand) return reject(new Error('Parallel requests are not supported'))
      if (this._socket.destroyed) return reject(new Error('Varnish Admin Socket disconnected'))
      this._resolveCommand = resolve
      this._rejectCommand = reject
      this._sendCommand(command)
    })
  }
}



module.exports = VarnishAdminClient
