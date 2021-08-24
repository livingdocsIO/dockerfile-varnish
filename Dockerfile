FROM golang:1.13.10-alpine3.11 as go
RUN apk add --no-cache git
RUN go get -d github.com/jonnenauha/prometheus_varnish_exporter
RUN cd /go/src/github.com/jonnenauha/prometheus_varnish_exporter && git checkout 1.6 && go build -ldflags "-X 'main.Version=1.6' -X 'main.VersionHash=$(git rev-parse --short HEAD)' -X 'main.VersionDate=$(date -u '+%d.%m.%Y %H:%M:%S')'" -o /go/bin/prometheus_varnish_exporter

FROM livingdocs/node:16
ENV VARNISH_VERSION=6.6.1-r0

COPY --from=go /go/bin/* /bin/

RUN echo 'Install utils that stay in the image' \
  && apk add --no-cache bash ca-certificates bind-tools nano curl procps tini \
  && echo 'Install varnish' \
  && apk add --no-cache varnish=$VARNISH_VERSION --repository http://dl-3.alpinelinux.org/alpine/edge/main/ \
  && echo 'Install varnish-modules' \
  && apk add --virtual varnish-deps --no-cache git libgit2-dev automake varnish-dev=$VARNISH_VERSION autoconf libtool py-docutils make --repository http://dl-3.alpinelinux.org/alpine/edge/main/ \
  && git clone https://github.com/varnish/varnish-modules.git /varnish-modules --depth='1' --branch='6.6' --single-branch \
  && cd /varnish-modules && ./bootstrap && ./configure && make && make install && cd / \
  && echo 'Remove all build deps' \
  && rm -Rf /varnish-modules \
  && apk del varnish-deps \
  && chown -R varnish:varnish /etc/varnish

COPY default.vcl.ejs /etc/varnish/default.vcl.ejs
COPY package*.json ./src/* /app/
RUN cd /app && npm ci

USER varnish
EXPOSE 8080
EXPOSE 2000
EXPOSE 9131
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/index.js"]
