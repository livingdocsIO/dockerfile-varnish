const http = require('http')
const hostname = require('os').hostname()

const server = http.createServer(function (req, res) {
  console.log('Request', req.method, req.url)

  if (req.url.startsWith('/errorpage')) {
    res.writeHead(200, {'X-Served-By': hostname, 'Content-Type': 'text/html'})
    res.write('Error page: ' + req.url)
    return res.end()
  }

  if (req.url.startsWith('/500')) {
    res.writeHead(500, {'X-Served-By': hostname, 'Content-Type': 'text/html'})
    res.write('500 page: ' + req.url)
    return res.end()
  }

  if (req.url.startsWith('/501')) {
    res.writeHead(501, {'X-Served-By': hostname, 'Content-Type': 'text/html'})
    res.write('501 page: ' + req.url)
    return res.end()
  }

  if (req.url.startsWith('/502')) {
    res.writeHead(502, {'X-Served-By': hostname, 'Content-Type': 'text/html'})
    res.write('502 page: ' + req.url)
    return res.end()
  }

  if (req.url.startsWith('/301/')) {
    res.writeHead(301, {
      'X-Served-By': hostname,
      'Content-Type': 'text/html',
      Location: req.url.replace('/301', ''),
    })
    res.write('301 page: ' + req.url)
    return res.end()
  }

  if (req.url.startsWith('/cache-tags')) {
    res.writeHead(200, {'X-Cache-Tags': 'something', 'Content-Type': 'text/html'})
    res.write('X-Cache-Tags Header: something')
    return res.end()
  }

  if (req.url.startsWith('/stale-if-error')) {
    const status = req.headers.success ? 200 : 500
    res.writeHead(status, {'Cache-Control': 's-maxage=5, stale-if-error=20'})
    res.write(`stale-if-error: ${status === 200 ? 'success' : 'error'}`)
    return res.end()
  }

  if (req.url.startsWith('/regular-redirect')) {
    res.writeHead(302, {'Content-Type': 'text/html', Location: '/some-fake-page-to-redirect'})
    res.write('302 Found')
    return res.end()
  }

  if (req.url.startsWith('/follow-redirect')) {
    res.writeHead(302, {
      'Content-Type': 'text/html',
      Location: `/fake-redirect/${req.url.replace('/follow-redirect/', '')}`,
      'Follow-Location': 'true'
    })
    res.write('302 Found')
    return res.end()
  }

  res.writeHead(200, {'X-Served-By': hostname, 'Content-Type': 'text/html'})
  res.write('Success Page: ' + req.url)
  res.end()
})


server.listen(8081)
