const http = require('http')

const server = http.createServer(function (req, res) {
  console.log('Request', req.url)
  if (req.url.startsWith('/error')) {
    res.writeHead(200, {'Content-Type': 'text/html'})
    res.write('Error page')
    return res.end()
  }

  if (req.url.startsWith('/500')) {
    res.writeHead(500, {'Content-Type': 'text/html'})
    res.write('500 page')
    return res.end()
  }

  if (req.url.startsWith('/501')) {
    res.writeHead(501, {'Content-Type': 'text/html'})
    res.write('501 page')
    return res.end()
  }

  if (req.url.startsWith('/502')) {
    res.writeHead(502, {'Content-Type': 'text/html'})
    res.write('502 page')
    return res.end()
  }

  res.writeHead(200, {'Content-Type': 'text/html'})
  res.write('Success Page')
  res.end()
})

server.listen(8081)
