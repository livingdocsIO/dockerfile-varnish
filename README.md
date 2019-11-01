# Varnish

The Varnish setup we at Livingdocs currently use for the delivery.

### Build

```bash
docker build -t livingdocs/varnish .
```

### Run

```
docker run --rm -it -e BACKEND=example.com:80 -e BACKEND_PROBE=false -p 8080:80 -p 6081:6081 --name varnish livingdocs/varnish

# test
curl -H 'Host: example.com' localhost:8080
```

## Configuration options

All configuration is done using environment variables.

### Varnish Daemon Options
* `VARNISH_PORT`, optional, default: 80
* `VARNISH_ADMIN_PORT`, optional, default: 2000
* `VARNISH_ADMIN_SECRET_FILE`, optional, default: `VARNISH_ADMIN_SECRET` env variable
* `VARNISH_ADMIN_SECRET`, optional, default to a random string
* `VARNISH_CACHE_SIZE`, optional, default: 512m
* `VARNISH_CACHE_TTL`, optional, default: 4m
* `VARNISH_CACHE_GRACE`, optional, default: 24h
* `VARNISH_CACHE_KEEP`, optional, default: 1h
* `VARNISH_RUNTIME_PARAMETERS`, optional, default: `-p timeout_idle=65`

### Varnish Backend Options
* `BACKEND` the hostname:port of the backend, supports comma delimited values
* `BACKEND_MAX_CONNECTIONS`, optional, default: 75
* `BACKEND_FIRST_BYTES_TIMEOUT`, optional, default: 10s
* `BACKEND_BETWEEN_BYTES_TIMEOUT`, optional, default: 5s
* `BACKEND_CONNECT_TIMEOUT`, optional, default: 5s
* `BACKEND_PROBE`, optional, default: true
* `BACKEND_PROBE_URL`, optional, default: /status
* `BACKEND_PROBE_INTERVAL`, optional, default: 1s
* `BACKEND_PROBE_TIMEOUT`, optional, default: 1s
* `BACKEND_PROBE_WINDOW`, optional, default: 3
* `BACKEND_PROBE_THRESHOLD`, optional, default: 2
* `REMOTE_BACKEND`, optional, the host:port of additional backends you can use for example with ESI
* `ERROR_PAGE`, optional, an html page that is shown for every 5xx error instead of the regular server response `/errorpage` or `http://some-error-page/error` (https doesn't work)

### Prometheus exporter Options
* `PROMETHEUS_EXPORTER_PORT`, optional, default 9131
