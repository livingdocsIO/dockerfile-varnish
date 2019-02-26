FROM golang:1.11.5-alpine3.9 as go
RUN apk add --no-cache git
RUN go get -d github.com/jonnenauha/prometheus_varnish_exporter github.com/marcbachmann/exitd github.com/kelseyhightower/confd
RUN cd /go/src/github.com/jonnenauha/prometheus_varnish_exporter && git checkout 1.3.4 && go build -ldflags "-X 'main.Version=1.3.4' -X 'main.VersionHash=$(git rev-parse --short HEAD)' -X 'main.VersionDate=$(date -u '+%d.%m.%Y %H:%M:%S')'" -o /go/bin/prometheus_varnish_exporter
RUN cd /go/src/github.com/marcbachmann/exitd && git checkout master && go build -o /go/bin/exitd
RUN cd /go/src/github.com/kelseyhightower/confd && git checkout v0.15.0 && go build -ldflags "-X 'main.GitSHA=$(git rev-parse --short HEAD)'"  -o /go/bin/confd
RUN ls -lisa /go/bin

FROM alpine:3.9
ENV VARNISH_VERSION=6.1.1-r0

RUN apk add --no-cache tini varnish=$VARNISH_VERSION ca-certificates bind-tools
COPY --from=go /go/bin/* /bin/

ENV VARNISH_CONFIG='/etc/varnish/default.vcl'
ENV VARNISH_CONFIG_TEMPLATE='/etc/confd/templates/varnish.vcl.tmpl'
ENV VARNISH_PORT=80
ENV VARNISH_ADMIN_PORT=2000
ENV VARNISH_ADMIN_SECRET=
ENV VARNISH_ADMIN_SECRET_FILE=/etc/varnish/secret
ENV VARNISH_CACHE_SIZE=512m
ENV VARNISH_CACHE_TTL=4m
ENV VARNISH_CACHE_GRACE=24h
ENV VARNISH_RUNTIME_PARAMETERS="-p timeout_idle=65"

ENV BACKEND=
ENV BACKEND_MAX_CONNECTIONS=75
ENV BACKEND_FIRST_BYTES_TIMEOUT=10s
ENV BACKEND_BETWEEN_BYTES_TIMEOUT=5s
ENV BACKEND_CONNECT_TIMEOUT=5s
ENV BACKEND_PROBE=true
ENV BACKEND_PROBE_URL=/status
ENV BACKEND_PROBE_INTERVAL=2s
ENV BACKEND_PROBE_TIMEOUT=1s
ENV BACKEND_PROBE_WINDOW=3
ENV BACKEND_PROBE_THRESHOLD=2
ENV REMOTE_BACKEND=
ENV PROMETHEUS_EXPORTER_PORT=9131

COPY entrypoint.sh /entrypoint.sh
COPY default.vcl.tmpl $VARNISH_CONFIG_TEMPLATE
COPY varnish.toml /etc/confd/conf.d/varnish.toml
COPY ./bin/* /bin/

EXPOSE $VARNISH_PORT
EXPOSE $VARNISH_ADMIN_PORT
EXPOSE $PROMETHEUS_EXPORTER_PORT
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["/entrypoint.sh"]
