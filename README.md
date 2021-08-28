# [Varnish](https://github.com/livingdocsIO/dockerfile-varnish) [![](https://img.shields.io/docker/automated/livingdocs/varnish.svg)](https://hub.docker.com/r/livingdocs/varnish)

A varnish setup with config hot reloading, ready to use in kubernetes and dockerized environments.

It includes:
- A templating setup
- Hot reloading by watching for file changes
- Config reloads using `SIGHUP` signal
- A prometheus exporter running on port `9131`
- Automatic dns reloads
- Automatically apply varnish parameters on startup or config change

### Build

```sh
docker build -t livingdocs/varnish .
```

### Run

### Without config file

For simplicity, there's support for a `--backend` option.

```sh
docker run --rm -it -e BACKEND=host.docker.internal:8081 -p 8080:8080 --name varnish livingdocs/varnish --backend host.docker.internal:8081
```

### With YAML config file
```sh
echo '
listenAddress: 0.0.0.0:8080
watchFiles: true
watchDns: false
clusters:
- name: delivery
  address: host.docker.internal:8081
' > config.yaml

docker run --rm -it -v $PWD:/etc/varnish/source -p 8080:8080 --name varnish livingdocs/varnish
```

### With a JSON config file
```sh
echo '
{
  "listenAddress": "0.0.0.0:8080",
  "watchFiles": true,
  "watchDns": false,
  "clusters": [{"name": "delivery", "address": "host.docker.internal:8081"}]
}
' > config.json

docker run --rm -it -v $PWD:/etc/varnish/source -p 8080:8080 --name varnish livingdocs/varnish
```

## Configuration options

YAML and JSON config files are supported. The decision behind that is that YAML
supports multi line strings, which allow to embed configs more easily.

The configuration file must be in the varnish config source directory.
By default that's `/etc/varnish/source`. The path can be overridden
by the `--config-source` cli option. Please dont't change this to `/etc/varnish`,
as the file watcher would end up in a endless loop of updates.

Attention, in Kubernetes it's also not possible to write any file in a directory where
a config map gets mounted.

Config file changes are watched and trigger a reload within varnish.
Attention, file notifications aren't working properly, if the file owner is not `varnish`.

The configuration can also be reloaded using a `SIGHUP` signal against the main process.

The whole configuration object gets passed to the VCL templates, so you can
can add custom variables that gets passed down to the template renderer.

```yaml
# /etc/varnish/source/config.yaml

# Static Configurations
#
# Any varnish listen option is supported
listenAddress: 0.0.0.0:8080,HTTP
adminListenAddress: 0.0.0.0:2000
prometheusListenAddress: 0.0.0.0:9131
# Command args that directly get passed to the process
# e.g. to add a secondary listen address, you could pass the option
varnishRuntimeParameters: [-a, /path/to/listen.sock]
# The varnish storage configuration
storage: default,512m
# Define a custom secret for the admin port
# By default one gets generated and
# written to the secret file.
# If the secret file already contains a value,
# that one is preferred
adminSecret: null
adminSecretFile: /etc/varnish/secret
# Enable http access logs to stdout
varnishAccessLogs: true
# During the shutdown period,
# varnish will serve a 503 error on /_health
shutdownDelay: 5s

# Dynamic Configurations
#
# You can explicitly disable file watches that trigger a config reload
# 'kill -SIGHUP 1' against the running process will
# also reload the configuration.
watchFiles: true
watchDns: true
# Varnish serves requests with a X-Served-By header
# You can customize it here. {{hostname}} gets replaced automatically
xServedBy: "{{hostname}}"
# You can declare multiple vcls and reference them
# in the top vcl config that gets loaded
vcl:
- name: default
  # The configurations are relative to the config file
  # So this would be `/etc/varnish/source/default.vcl.ejs`
  # We only watch for file changes in /etc/varnish/source, so better keep this
  src: default.vcl.ejs
  # By default the destination of the final file is
  # the template name without the ejs extension in the '/etc/varnish' directory.
  dest: default.vcl
  # Declare that flag on the main vcl in case there are multiple ones,
  # so we know which one to set active
  top: true
- name: secondary
  src: secondary.vcl.ejs

# Probes that can get referenced in the cluster.probe config
probes:
  # only this is mandatory, the rest are defaults
  # Within the vcl, we name the probe probe_delivery
  # as varnish needs unique names
  name: probe_delivery
  url: /status
  interval: 5s
  timeout: 4s
  window: 3
  threshold: 2
  initial: null

acl:
  # The purge acl is required in the default vcl config
- name: acl_purge
  entries:
    - "# localhost"
    - localhost
    - 127.0.0.1
    - ::1
    - "# Private networks"
    - 10.0.0.0/8
    - 172.16.0.0/12
    - 192.168.0.0/16

clusters:
  # Name the cluster. The name is used in the round robin director
  # Please don't use 'backend' or 'default' here. Those are disallowed keywords.
  name: delivery
  # One hostname
  # A round robin director gets created automatically
  # that points to all the ip addresses behind a record.
  # The director name will be cluster.name, in that case 'delivery'.
  address: host.docker.internal:8081
  # Or multiple
  addresses: [host.docker.internal:8081]
  # Configure a probe declared on the root
  probe: probe_delivery
  # Define some backend parameters for every backend in the cluster
  # Varnish defaults will be used if not declared
  maxConnections: null
  firstByteTimeout: null
  betweenBytesTimeout: null
  connectTimeout: null

# Enable background fetches in case a request fails
# This is set to 1 by default
fetchRetries: 1
# Always remove all the query strings before
# a request gets hashed and sent to a backend
stripQueryString: false,
# Any varnish parameter that gets loaded on start and file change
# Those are the defaults if the parameter object is not present
parameters:
  feature: +http2,+esi_disable_xml_check
  default_grace: 86400
  default_keep: 3600
  default_ttl: 1
  backend_idle_timeout: 65
  timeout_idle: 60
  syslog_cli_traffic: off

# Instead of completely customizing the VCL built into the image
# you could also just use those hooks, which get placed at the specific location.
hooks:
  # You can also use multi line strings
  import: |
    import accept;
  global: ""
  vclInit: ""
  vclRecvStart: ""
  vclRecvBackendHint: ""
  vclRecvEnd: ""
  vclHash: ""
  vclDeliverStart: ""
  vclDeliverEnd: ""
  vclSynthStart: ""
  vclSynthEnd: ""
```

## Templating

In the config.vcl declaration, you can configure multiple template source files,
which should be present in in `/etc/varnish/`.
With such a configuration:
`{"vcl": [{"name": "something", "src": "something.vcl.ejs"}]}`

The file should get placed at `/etc/varnish/something.vcl.ejs`.
On build, the file lands in `/etc/varnish/generated/something.vcl`.

We're using [EJS](https://ejs.co/) templates to generate the final varnish configuration.
You can use any `config.*` variable in the template to generate the configuration.

```
<%= config.something || '' %>
```

### Includes

There are few specific includes supported:

Probe:
```
<% for (const probe of config.probes) { %><%- include('probe', probe) %><% } -%>
```

Backend:
```
<% for (const cluster of config.clusters) { %><%- include('backend', cluster) %><% } -%>
```

ACL:
```
<% for (const acl of config.acl) { %><%- include('acl', {"name": "purge", "entries:}) %><% } -%>

// or

<%- include('acl', {"name": "purge", "entries": ["127.0.0.1"]}) %>
```

Director:
```
<% for (const cluster of config.clusters) { %><%- include('director', cluster) -%><% } %>
```
