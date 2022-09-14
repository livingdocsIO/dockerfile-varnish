# Varnish

The Varnish setup we at Netcetera currently use for the delivery when paywall from MPP is needed. Such paywall are used in the BLZ and ASC websites.

### Build

```bash
colima start
docker build -t forwardpublishing/varnish-paywall .
```

### Run

```
docker run --rm -it -e BACKEND=example.com:80 -p 8080:80 -p 6081:6081 --name varnish forwardpublishing/varnish-paywall

# test
curl -H 'Host: example.com' localhost:8080
```

### Deploy

Each "merge to master" creates a docker image that you can use afterwards to deploy to a specific environment.

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
* `VARNISH_RUNTIME_PARAMETERS`, optional
* `VARNISH_ACCESS_LOG`, optional, default: true, log frontend requests

### Varnish Backend Options
* `BACKEND` the hostname:port of the backend, supports comma delimited values
* `BACKEND_MAX_CONNECTIONS`, optional, default: 75
* `BACKEND_FIRST_BYTES_TIMEOUT`, optional, default: 10s
* `BACKEND_BETWEEN_BYTES_TIMEOUT`, optional, default: 5s
* `BACKEND_CONNECT_TIMEOUT`, optional, default: 5s
* `BACKEND_PROBE`, optional, default: false
* `BACKEND_PROBE_URL`, optional, default: /status
* `BACKEND_PROBE_INTERVAL`, optional, default: 1s
* `BACKEND_PROBE_TIMEOUT`, optional, default: 1s
* `BACKEND_PROBE_WINDOW`, optional, default: 3
* `BACKEND_PROBE_THRESHOLD`, optional, default: 2
* `REMOTE_BACKEND`, optional, the host:port of additional backends you can use for example with ESI

### Varnish EMeter required values
* `E_METER_URL` eMeter endpoint used for sending eSuiteInformation
* `E_METER_X_TOKEN`, eMeter unique x-token-id

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
