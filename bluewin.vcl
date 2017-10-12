vcl 4.0;

import std;
import directors;

backend delivery1 {
  .host = "{{BACKEND_HOST}}";
  .port = "{{BACKEND_PORT}}";

  .first_byte_timeout     = 30s; # How long to wait before we receive a first byte from our backend?
  .connect_timeout        = 5s;  # How long to wait for a backend connection?
  .between_bytes_timeout  = 2s;  # How long to wait between bytes received from our backend?
}

# Sport results custom pages source
backend sportdaten {
  .host = "sportdaten.bluewin.ch";
}

# allowed to purge
acl purge {
  "localhost";
  "127.0.0.1";
  "::1";
}

sub vcl_recv {
  # Normalize the header, remove the port (in case you're testing this on various TCP ports)
  set req.http.Host = regsub(req.http.Host, ":[0-9]+", "");

  # Called at the beginning of a request, after the complete request has been
  # received and parsed.
  # Its purpose is to decide whether or not to serve the request, how to do it,
  # and, if applicable, which backend to use. Also used to modify the request.

  if (req.http.host == "sportdaten.bluewin.ch") {
    set req.backend_hint = sportdaten;
  }
  else {
    set req.backend_hint = delivery1;
  }

  # Remove the proxy header (see https://httpoxy.org/#mitigate-varnish)
  unset req.http.proxy;

  # Normalize the query arguments
  set req.url = std.querysort(req.url);

  # Allow purging
  if (req.method == "PURGE") {
    # purge is an ACL defined above, we check the ip is in there
    if (!client.ip ~ purge) {
      return (synth(405, "This IP is not allowed to send PURGE requests."));
    }
    return (purge);
  }

  # Only deal with "normal" types
  if (req.method != "GET" &&
      req.method != "HEAD" &&
      req.method != "PUT" &&
      req.method != "POST" &&
      req.method != "TRACE" &&
      req.method != "OPTIONS" &&
      req.method != "PATCH" &&
      req.method != "DELETE") {
    # Non-RFC2616 or CONNECT which is weird.
    return (pipe);
  }

  # Only cache GET or HEAD requests. This makes sure the POST requests are always passed.
  if (req.method != "GET" && req.method != "HEAD" && req.method != "OPTIONS") {
    return (pass);
  }

  # Some generic URL cleanup, useful for all templates that follow
  # First remove the Google Analytics added parameters, useless for our backend
  if (req.url ~ "(\?|&)(utm_source|utm_medium|utm_campaign|utm_content|gclid|cx|ie|cof|siteurl)=") {
    set req.url = regsuball(req.url, "&(utm_source|utm_medium|utm_campaign|utm_content|gclid|cx|ie|cof|siteurl)=([A-z0-9_\-\.%25]+)", "");
    set req.url = regsuball(req.url, "\?(utm_source|utm_medium|utm_campaign|utm_content|gclid|cx|ie|cof|siteurl)=([A-z0-9_\-\.%25]+)", "?");
    set req.url = regsub(req.url, "\?&", "?");
    set req.url = regsub(req.url, "\?$", "");
  }

  # Strip hash, server doesn't need it.
  if (req.url ~ "\#") {
    set req.url = regsub(req.url, "\#.*$", "");
  }

  # Strip a trailing ? if it exists
  if (req.url ~ "\?$") {
    set req.url = regsub(req.url, "\?$", "");
  }

  # Nuke all cookies
  unset req.http.Cookie;

  # Strip Auth and then cache
  unset req.http.Authorization;

  # Send Surrogate-Capability headers to announce ESI support to backend
  set req.http.Surrogate-Capability = "key=ESI/1.0";

  return (hash);
}

# Called after vcl_recv to create a hash value for the request. This is used
# as a key to look up the object in Varnish.
# These hash subs are executed in order, they should not return anything
# and the hashed data will later on get concatenated by the default vcl_hash.
sub vcl_hash {
  # Cache based on hostname or ip
  if (req.http.host) { hash_data(req.http.host); }
  else { hash_data(server.ip); }

  # Cache based on user agent
  if (req.http.User-Agent == "bluewin-app") { hash_data("ua-app"); }
  else { hash_data("ua-default"); }

  # Cache based on url
  hash_data(req.url);
}

# Handle the HTTP request coming from our backend
# Called after the response headers has been successfully retrieved from the backend.
sub vcl_backend_response {
  # Pause ESI request and remove Surrogate-Control header
  if (beresp.http.Surrogate-Control ~ "ESI/1.0") {
    unset beresp.http.Surrogate-Control;
    set beresp.do_esi = true;
    set beresp.do_gzip = true;
  }

  # Enable ESI for sport results custom pages
  if (bereq.url ~ "/(de|fr|it)/sport/(resultate|resultats|risultati)?.*.html") {
    set beresp.do_esi = true;
    set beresp.do_gzip = true;
  }

  # Enable cache for all static files
  # The same argument as the static caches from above: monitor your cache size, if you get data nuked out of it, consider giving up the static file cache.
  # Before you blindly enable this, have a read here: https://ma.ttias.be/stop-caching-static-files/
  if (bereq.url ~ "^[^?]*\.(7z|avi|bmp|bz2|css|csv|doc|docx|eot|flac|flv|gif|gz|ico|jpeg|jpg|js|less|mka|mkv|mov|mp3|mp4|mpeg|mpg|odt|otf|ogg|ogm|opus|pdf|png|ppt|pptx|rar|rtf|svg|svgz|swf|tar|tbz|tgz|ttf|txt|txz|wav|webm|webp|woff|woff2|xls|xlsx|xml|xz|zip)(\?.*)?$") {
    unset beresp.http.Set-Cookie;
  }

  # Large static files are delivered directly to the end-user without
  # waiting for Varnish to fully read the file first.
  # Varnish 4 fully supports Streaming, so use streaming here to avoid locking.
  if (bereq.url ~ "^[^?]*\.(7z|avi|bz2|flac|flv|gz|mka|mkv|mov|mp3|mp4|mpeg|mpg|ogg|ogm|opus|rar|tar|tgz|tbz|txz|wav|webm|xz|zip)(\?.*)?$") {
    set beresp.do_stream = true;  # Check memory usage it'll grow in fetch_chunksize blocks (128k by default) if the backend doesn't send a Content-Length header, so only enable it for big objects
  }

  # Directly pass 404 statuses, cache for 5s to throttle requests to a backend
  if (beresp.status == 404) {
    return (pass(5s));
  }

  # Directly pass 50x responses, cache for 15s to throttle requests to a backend
  if (beresp.status == 500 || beresp.status == 502 || beresp.status == 503 || beresp.status == 504) {
    return (pass(15s));
  }

  # Set cache time of all cacheable requests that didn't configure a cache ttl
  if (beresp.ttl <= 0s &&
      beresp.http.Vary != "*" &&
      beresp.http.Cache-Control !~ "no-cache|no-store|private" &&
      !beresp.http.Set-Cookie &&
      beresp.http.Surrogate-control !~ "no-store" &&
      !beresp.http.Surrogate-Control
      ) {
      set beresp.ttl = 4m;
  }

  # Allow stale content, in case the backend goes down.
  # make Varnish keep all objects for 24 hours beyond their TTL
  if (beresp.ttl >= 0s) {
    set beresp.grace = std.duration(beresp.http.X-Varnish-Grace, 24h);
  }

  return (deliver);
}

# Called before a cached/fresh object is delivered to the client.
sub vcl_deliver {
  # Add Cache Grace Info to Response (set in vcl_hit)
  if (req.http.X-Cache-Grace) { set resp.http.X-Cache-Grace = req.http.X-Cache-Grace; }
  else { set resp.http.X-Cache-Grace = "NONE"; }


  # Add debug header to see if it's a HIT/MISS and the number of hits, disable when not needed
  if (obj.hits > 0) { set resp.http.X-Cache = "HIT"; }
  else { set resp.http.X-Cache = "MISS"; }

  # Please note that obj.hits behaviour changed in 4.0, now it counts per
  # objecthead, not per object and obj.hits may not be reset in some cases where
  # bans are in use. See bug 1492 for details. So take hits with a grain of salt
  set resp.http.X-Cache-Hits = obj.hits;

  # Remove some headers
  unset resp.http.Server;
  unset resp.http.X-Varnish;
  unset resp.http.Via;
  unset resp.http.X-Generator;

  return (deliver);
}

sub vcl_hit {
  if (obj.ttl >= 0s) {
    set req.http.X-Cache-Grace = "HIT";
  } else if (obj.ttl + 10s > 0s) {
    // Object is probably updating in the background
    set req.http.X-Cache-Grace = "MISS";
  } else {
    // Backend is probably down
    set req.http.X-Cache-Grace = "STALE";
  }

  return(deliver);
}

sub vcl_purge {
  # Only handle actual PURGE HTTP methods, everything else is discarded
  if (req.method != "PURGE") {
    # restart request
    set req.http.X-Purge = "Yes";
    return (restart);
  }
}

sub vcl_synth {
  return (deliver);
}

sub vcl_fini {
  return (ok);
}
