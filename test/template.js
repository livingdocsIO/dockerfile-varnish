const assert = require('assert')
const template = require('../src/template')

const renderAcl = template.compile(`<%- include('acl', config) %>`)
assert.equal(renderAcl({
  name: 'foo',
  entries: ['127.0.0.1/10']
}), `acl foo {
  "127.0.0.1"/10;
}
`)

const clusterObject = {
  name: 'foo',
  maxConnections: 10,
  addresses: [
    {name: 'foo_1', host: '127.0.0.1', port: 8000},
    {name: 'foo_2', host: '127.0.0.1', port: 8001}
  ]
}

const renderBackend = template.compile(`<%- include('backend', config) %>`)
assert.equal(renderBackend(clusterObject), `backend foo_1 {
  .host = "127.0.0.1";
  .port = "8000";
  .max_connections = 10;
}
backend foo_2 {
  .host = "127.0.0.1";
  .port = "8001";
  .max_connections = 10;
}
`)


const renderDirector = template.compile(`
sub vcl_init {
  <%- include('director', config) _%>
}
`)

assert.equal(renderDirector(clusterObject), `
sub vcl_init {
  new foo = directors.round_robin();
  foo.add_backend(foo_1);
  foo.add_backend(foo_2);
}
`)
