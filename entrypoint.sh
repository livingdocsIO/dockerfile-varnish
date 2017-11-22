#!/bin/sh
set -e
/bin/varnish-reload-synconly
NO_LOG_PREFIX=first exitd /bin/varnish-logs /bin/varnish /bin/varnish-reload-watch /bin/prometheus-varnish-exporter
