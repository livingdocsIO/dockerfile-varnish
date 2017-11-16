#!/bin/sh
set -e
/bin/varnish-reload-synconly
exitd /bin/varnish-reload-watch /bin/varnish /bin/varnish-logs /bin/prometheus-varnish-exporter
