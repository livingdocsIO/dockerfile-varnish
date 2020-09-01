FROM livingdocs/varnish:6.4.0-r3
COPY custom.vcl.tmpl $VARNISH_CONFIG_TEMPLATE
