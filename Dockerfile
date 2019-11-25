FROM golang:1.13.3-alpine3.10 as go
RUN apk add --no-cache git
RUN go get -d github.com/jonnenauha/prometheus_varnish_exporter github.com/kelseyhightower/confd
RUN cd /go/src/github.com/jonnenauha/prometheus_varnish_exporter && git checkout 1.5.2 && go build -ldflags "-X 'main.Version=1.5.2' -X 'main.VersionHash=$(git rev-parse --short HEAD)' -X 'main.VersionDate=$(date -u '+%d.%m.%Y %H:%M:%S')'" -o /go/bin/prometheus_varnish_exporter
RUN cd /go/src/github.com/kelseyhightower/confd && git checkout v0.15.0 && go build -ldflags "-X 'main.GitSHA=$(git rev-parse --short HEAD)'"  -o /go/bin/confd
RUN ls -lisa /go/bin

FROM alpine:3.10
ENV VARNISH_VERSION=6.3.1-r1

RUN apk add --no-cache bash ca-certificates bind-tools nano curl tini procps && \
  apk add --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main --no-cache varnish=$VARNISH_VERSION && \
  apk add --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main --virtual build-dependencies --no-cache git libgit2-dev automake varnish-dev=$VARNISH_VERSION autoconf libtool py-docutils make \
    && git clone https://github.com/varnish/varnish-modules.git --depth='1' --branch='6.3' --single-branch /varnish-modules \
    && cd /varnish-modules \
    && ./bootstrap && ./configure && make && make install \
    && apk del build-dependencies \
    && rm -Rf /varnish-modules

COPY --from=go /go/bin/* /bin/

ENV VARNISH_CONFIG_TEMPLATE='/etc/confd/templates/varnish.vcl.tmpl'
ENV VARNISH_PORT=80
ENV VARNISH_ADMIN_PORT=2000
ENV PROMETHEUS_EXPORTER_PORT=9131

COPY entrypoint.sh /entrypoint.sh
COPY default.vcl.tmpl $VARNISH_CONFIG_TEMPLATE
COPY varnish.toml /etc/confd/conf.d/varnish.toml
COPY ./bin/* /bin/

EXPOSE $VARNISH_PORT
EXPOSE $VARNISH_ADMIN_PORT
EXPOSE $PROMETHEUS_EXPORTER_PORT
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
