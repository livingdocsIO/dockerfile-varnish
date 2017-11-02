FROM alpine:edge

ARG VERSION=5.1.3-r0
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community/" >> /etc/apk/repositories
RUN apk add --no-cache tini gomplate varnish=$VERSION && rm -rf /var/cache/apk/*

ENV VARNISH_CONFIG '/etc/varnish/default.vcl'
ENV VARNISH_CONFIG_TEMPLATE '/etc/varnish/default.vcl.tmpl'
ENV VARNISH_CACHE_SIZE 512m
ENV VARNISH_PORT 80

EXPOSE $VARNISH_PORT

COPY entrypoint.sh /entrypoint.sh
COPY bluewin.vcl.tmpl $VARNISH_CONFIG_TEMPLATE

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/entrypoint.sh"]
