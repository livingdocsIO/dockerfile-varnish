FROM golang:1.9.2-alpine3.6 as go
RUN apk add --no-cache git
RUN go get -d github.com/jonnenauha/prometheus_varnish_exporter github.com/romabysen/exitd github.com/kelseyhightower/confd
RUN cd /go/src/github.com/jonnenauha/prometheus_varnish_exporter && git checkout 1.3.4 && go build -o /go/bin/prometheus_varnish_exporter
RUN cd /go/src/github.com/romabysen/exitd && git checkout 1.1.0 && go build -o /go/bin/exitd
RUN cd /go/src/github.com/kelseyhightower/confd && git checkout v0.14.0 && go build  -o /go/bin/confd
RUN ls -lisa /go/bin

FROM alpine:edge
ARG VERSION=5.2.0-r0

RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community/" >> /etc/apk/repositories
RUN apk add --no-cache tini varnish=$VERSION ca-certificates bind-tools
COPY --from=go /go/bin/* /bin/

ENV VARNISH_CONFIG '/etc/varnish/default.vcl'
ENV VARNISH_CONFIG_TEMPLATE '/etc/confd/templates/varnish.vcl.tmpl'
ENV VARNISH_CACHE_SIZE 512m
ENV VARNISH_PORT 80
ENV VARNISH_ADMIN_PORT 2000

COPY entrypoint.sh /entrypoint.sh
COPY default.vcl.tmpl $VARNISH_CONFIG_TEMPLATE
COPY varnish.toml /etc/confd/conf.d/varnish.toml
COPY ./bin/* /bin/

EXPOSE $VARNISH_PORT
ENTRYPOINT ["/sbin/tini", "-g", "--"]
CMD ["/entrypoint.sh"]
