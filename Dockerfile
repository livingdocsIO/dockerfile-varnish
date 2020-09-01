FROM livingdocs/varnish:6.4.0-r3
COPY default.vcl.tmpl $VARNISH_CONFIG_TEMPLATE
