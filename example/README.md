### An example server to test

```sh
# Launch the node process
node index.js &

# And launch the varnish docker container
docker run --rm -p 8080:8080 -v $PWD:/etc/varnish/source --name varnish livingdocs/varnish:latest --backend=host.docker.internal:8081 &

# Modify the config.yaml if to see hot reloads
```
