const ejs = require('ejs')

// We use custom functions that generate the template for better newline handling
function stringLines (prefix, arr) {
  let str = ''
  for (const [variable, property = variable] of arr) {
    str += `  <%_ if (${prefix}.${variable}) { _%>\n`
    str += `  .${property} = "<%= ${prefix}.${variable} %>";\n`
    str += `  <%_ } _%>\n`
  }
  return str
}

function lines (prefix, arr) {
  let str = ''
  for (const [variable, property = variable] of arr) {
    str += `  <%_ if (${prefix}.${variable}) { _%>\n`
    str += `  .${property} = <%= ${prefix}.${variable} %>;\n`
    str += `  <%_ } _%>\n`
  }
  return str
}

const backendTemplate = ejs.compile(`<%_ for (const address of d.addresses) { %>backend <%- address.name %> {
  ${stringLines('address', [
    ['host'],
    ['port'],
    ['path']
  ])}  ${lines('d', [
    ['maxConnections', 'max_connections'],
    ['firstByteTimeout', 'first_byte_timeout'],
    ['betweenBytesTimeout', 'between_bytes_timeout'],
    ['connectTimeout', 'connect_timeout'],
    ['probe', 'probe']
  ])}}
<%_ } _%>
`)

const probeTemplate = ejs.compile(`probe <%- d.name %> {
  <% if (d.url) { %>.url = "<%= d.url %>";<% } %>
  <% if (d.request?.length) { %>.request = <% for (const l of d.request) { %> "<%= l %>"\n    <% } %>;<% } %>
  ${lines('d', [
    ['interval'],
    ['timeout'],
    ['window'],
    ['threshold'],
    ['initial'],
    ['expectedResponse', 'expected_response']
  ])}}
`)

const aclTemplate = ejs.compile(`acl <%- d.name %> {
  <%_ for (const a of d.entries) { _%>
  <%- normalizeAclEntryToString(a) %>
  <%_ } _%>
}
`)

const directorTemplate = ejs.compile(`new <%- d.name %> = directors.round_robin();
  <%_ for (const e of d.addresses) { _%>
  <%- d.name %>.add_backend(<%- e.name %>);
  <%_ } _%>
`)

function includer (file, data) {
  switch (file) {
    case 'backend': return backendTemplate({d: data})
    case 'probe': return probeTemplate({d: data})
    case 'director': return directorTemplate({d: data})
    case 'acl': return aclTemplate({d: data, normalizeAclEntryToString})
    default: throw new Error(`Unsupported template '${file}'`)
  }
}

function normalizeAclEntryToString (str) {
  if (str.startsWith('#')) return str
  return str.replace(/^(!\s*)?([^\/]*)([^;]*);?(.*)/, '$1"$2"$3;$4')
}

function varnishTemplate (str) {
  const content = str.replace(/(?:(")|{{([^}]+)}})/g, (str, whitespace, placeholder) => {
    if (whitespace === '"') return `" + {"""} + "`
    return `" + ${placeholder.trim()} + "`
  })

  return `"${content}"`
}

module.exports = {
  compile (content) {
    const render = ejs.compile(content, {client: true})
    return function (config) {
      return render({
        config,
        vstr: varnishTemplate
      }, null, includer)
    }
  }
}
