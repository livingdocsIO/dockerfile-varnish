# Varnish

The Varnish setup we at Livingdocs currently use for the delivery.

## Configuration options

All configuration is done via environment variables.

### Build

```bash
docker build -t livingdocs/varnish .
docker run --rm -e BACKEND=example.com:80 -e BACKEND_PROBE=false -p 8080:80 -p 6081:6081 -it --name varnish livingdocs/varnish

# test
curl -H 'Host: example.com' localhost:8080
```

### Run

* `VARNISH_CACHE_SIZE`, optional, default: 512m
* `VARNISH_PORT`, optional, default: 80
* `VARNISH_ADMIN_PORT`, optional, default: 2000
* `VARNISH_ADMIN_SECRET_FILE`, optional, default: `VARNISH_ADMIN_SECRET` env variable
* `VARNISH_ADMIN_SECRET`, optional, default to a random string
* `BACKEND` the hostname:port of the backend, supports comma delimited values
* `BACKEND_MAX_CONNECTIONS`, optional, default: 75
* `BACKEND_FIRST_BYTES_TIMEOUT`, optional, default: 10s
* `BACKEND_BETWEEN_BYTES_TIMEOUT`, optional, default: 5s
* `BACKEND_CONNECT_TIMEOUT`, optional, default: 5s
* `BACKEND_PROBE`, optional, default: true
* `BACKEND_PROBE_URL`, optional, default: /status
* `BACKEND_PROBE_INTERVAL`, optional, default: 2s
* `BACKEND_PROBE_TIMEOUT`, optional, default: 1s
* `BACKEND_PROBE_WINDOW`, optional, default: 3
* `BACKEND_PROBE_THRESHOLD`, optional, default: 3
* `REMOTE_BACKEND`, optional
* `PROMETHEUS_EXPORTER_PORT`, optional, default 9131

## Create a container and give it a name

```bash
docker run -p 80:80 --env BACKEND=backend:9090 --name varnish livingdocs/varnish
```

## Start an existing container

```bash
docker start varnish
```
