#!/bin/sh
set -e

if hash gsed 2>/dev/null; then
  alias sed=gsed
fi

sed -i.original "s|\${BACKEND_HOST}|${BACKEND_HOST}|g" $VARNISH_CONFIG
sed -i.original "s|\${BACKEND_PORT}|${BACKEND_PORT}|g" $VARNISH_CONFIG

varnishd -f $VARNISH_CONFIG -s malloc,$VARNISH_CACHE_SIZE -a 0.0.0.0:${VARNISH_PORT}
varnishlog
