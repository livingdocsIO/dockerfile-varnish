FROM alpine:3.5

RUN apk add --no-cache varnish && rm -rf /var/cache/apk/*

ENV VARNISH_CONFIG '/etc/varnish/default.vcl'
ENV VARNISH_CACHE_SIZE 512m
ENV VARNISH_PORT 80

EXPOSE $VARNISH_PORT

COPY entrypoint.sh /entrypoint.sh
COPY default.vcl /etc/varnish/default.vcl

VOLUME ["/var/lib/varnish", "/etc/varnish"]

CMD ["/entrypoint.sh"]
