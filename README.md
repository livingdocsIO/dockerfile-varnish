# [Varnish](https://github.com/livingdocsIO/dockerfile-varnish) [![](https://img.shields.io/docker/automated/livingdocs/varnish.svg)](https://hub.docker.com/r/livingdocs/varnish)

The Varnish setup we at Livingdocs currently use for the delivery.

### Build

```bash
docker build -t livingdocs/varnish .
```

### Run

```
node fake/index.js
docker run --rm -it -e BACKEND=host.docker.internal:8081 -p 8080:80 -p 6081:6081 --name varnish livingdocs/varnish

# test
curl -H 'Host: example.com' localhost:8080
```

## Configuration options

All configuration is done using environment variables.

### Varnish Daemon Options
* `VARNISH_PORT`, optional, default: 8080
* `VARNISH_ADMIN_PORT`, optional, default: 2000
* `VARNISH_ADMIN_SECRET_FILE`, optional, default: `VARNISH_ADMIN_SECRET` env variable
* `VARNISH_ADMIN_SECRET`, optional, default to a random string
* `VARNISH_CACHE_SIZE`, optional, default: 512m
* `VARNISH_CACHE_TTL`, optional, default: 4m
* `VARNISH_CACHE_GRACE`, optional, default: 24h
* `VARNISH_CACHE_KEEP`, optional, default: 1h
* `VARNISH_RUNTIME_PARAMETERS`, optional
* `VARNISH_ACCESS_LOG`, optional, default: true, log frontend requests

### Varnish Backend Options
* `BACKEND` the hostname:port of the backend, supports comma delimited values
* `BACKEND_FETCH_RETRIES`, optional, default: 1
* `BACKEND_MAX_CONNECTIONS`, optional, default: 75
* `BACKEND_FIRST_BYTES_TIMEOUT`, optional, default: 30s
* `BACKEND_BETWEEN_BYTES_TIMEOUT`, optional, default: 30s
* `BACKEND_CONNECT_TIMEOUT`, optional, default: 0.7s
* `BACKEND_PROBE`, optional, default: false
* `BACKEND_PROBE_URL`, optional, default: /status
* `BACKEND_PROBE_INTERVAL`, optional, default: 2s
* `BACKEND_PROBE_TIMEOUT`, optional, default: 1s
* `BACKEND_PROBE_WINDOW`, optional, default: 3
* `BACKEND_PROBE_THRESHOLD`, optional, default: 2
* `REMOTE_BACKEND`, optional, the host:port of additional backends you can use for example with ESI

### VCL Configuration Options
* `ERROR_PAGE`, optional, an html page that is shown for every 5xx error instead of the regular server response. You can set it to something like `/error` or `http://some-error-page/error?code={{code}}`
  - Attention, https doesn't work
  - Use a `{{code}}` placeholder, which will be replaced with the error code.
* `PURGE_IP_WHITELIST`: a list of ip addresses that are allowed to purge pages. by default we've whitelisted the private networks.
* `VARNISH_STRIP_QUERYSTRING`: Forces varnish to remove all the query strings from a url before it gets sent to a backend, default: false
* `HOSTNAME` and `HOSTNAME_PREFIX`: By default we set a `x-served-by` header on the response of a request in varnish. Because the hostname is automatically set in docker, we've added a prefix, to make it more customizable.
* `VARNISH_CUSTOM_SCRIPT`: Allows us to inject some script at the end of the `vcl_recv` function.


### Prometheus exporter Options
* `PROMETHEUS_EXPORTER_PORT`, optional, default 9131
