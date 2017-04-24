# Varnish

The Varnish setup we at Livingdocs currently use for the delivery.

## Configuration options

All configuration is done via environment variables.

* `BACKEND_HOST` -- the IP address or hostname of the delivery server
* `BACKEND_PORT` -- the HTTP port of the delivery server
* (optional) `VARNISH_CONFIG` defaults to `/etc/varnish/default.vcl`. Use this if you'd like to mount a config file to another location.
* (optional) `VARNISH_CACHE_SIZE` defaults to `512m`
* (optional) `VARNISH_PORT` defaults to `80`

## Create a container and give it a name

```bash
docker run -p 80:80 --env BACKEND_HOST=127.0.0.1 --env BACKEND_PORT=9090 --name varnish livingdocs/varnish
```

## Start an existing container

```bash
docker start varnish
```


## To build this image manually

```bash
docker build --tag livingdocs/varnish .
```
