#!/bin/sh
set -e

if [ ! -f $VARNISH_CONFIG ]; then
  gomplate --file $VARNISH_CONFIG_TEMPLATE > $VARNISH_CONFIG
fi

varnishd -f $VARNISH_CONFIG -s malloc,$VARNISH_CACHE_SIZE -a 0.0.0.0:$VARNISH_PORT -T 0.0.0.0:2000 -p feature=+http2
varnishncsa -F '{"@timestamp":"%{%Y-%m-%dT%H:%M:%S%z}t","method":"%m","url":"%U","remote_ip":"%h","x_forwarded_for":"%{X-Forwarded-For}i","cache":"%{Varnish:handling}x","bytes":%b,"duration_usec":%D,"status":%s,"request":"%r","ttfb":"%{Varnish:time_firstbyte}x","referrer":"%{Referrer}i","user_agent":"%{User-agent}i"}'
