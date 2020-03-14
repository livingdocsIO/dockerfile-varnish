#!/bin/bash
set -e

normalize_ips () {
  echo "${1:-}" | sed -E 's/([0-9.:]+)/"\1"/g' | sed -E 's/\/"([0-9]+)"/\/\1/g'
}

export VARNISH_ADMIN_SECRET_FILE=${VARNISH_ADMIN_SECRET_FILE:-/etc/varnish/secret}
export VARNISH_ADMIN_SECRET=${VARNISH_ADMIN_SECRET:-$()}
export VARNISH_RUNTIME_PARAMETERS=${VARNISH_RUNTIME_PARAMETERS:-}

export VARNISH_CONFIG=${VARNISH_CONFIG:-/etc/varnish/default.vcl}
export VARNISH_CACHE_SIZE=${VARNISH_CACHE_SIZE:-512m}
export VARNISH_CACHE_TTL=${VARNISH_CACHE_TTL:-4m}
export VARNISH_CACHE_GRACE=${VARNISH_CACHE_GRACE:-24h}
export VARNISH_CACHE_KEEP=${VARNISH_CACHE_KEEP:-1h}

export VARNISH_STRIP_QUERYSTRING=${VARNISH_STRIP_QUERYSTRING:-false}
export VARNISH_CUSTOM_SCRIPT=${VARNISH_CUSTOM_SCRIPT:-}
export VARNISH_SHUTDOWN_DELAY=${VARNISH_SHUTDOWN_DELAY:-5}
export VARNISH_ACCESS_LOG=true

export BACKEND=${BACKEND:-}
export BACKEND_MAX_CONNECTIONS=${BACKEND_MAX_CONNECTIONS:-75}
export BACKEND_CONNECT_TIMEOUT=${BACKEND_CONNECT_TIMEOUT:-0.7s}
export BACKEND_FIRST_BYTES_TIMEOUT=${BACKEND_FIRST_BYTES_TIMEOUT:-30s}
export BACKEND_BETWEEN_BYTES_TIMEOUT=${BACKEND_BETWEEN_BYTES_TIMEOUT:-30s}
export BACKEND_PROBE=${BACKEND_PROBE:-false}
export BACKEND_PROBE_URL=${BACKEND_PROBE_URL:-/status}
export BACKEND_PROBE_INTERVAL=${BACKEND_PROBE_INTERVAL:-2s}
export BACKEND_PROBE_TIMEOUT=${BACKEND_PROBE_TIMEOUT:-1s}
export BACKEND_PROBE_WINDOW=${BACKEND_PROBE_WINDOW:-3}
export BACKEND_PROBE_THRESHOLD=${BACKEND_PROBE_THRESHOLD:-2}
export REMOTE_BACKEND=${REMOTE_BACKEND:-}
export PURGE_IP_WHITELIST=$(normalize_ips "${PURGE_IP_WHITELIST:-212.51.140.235,85.195.241.146}")

if [ ! -f $VARNISH_ADMIN_SECRET_FILE ]; then
  if [ "$VARNISH_ADMIN_SECRET" != "" ]; then
    echo $VARNISH_ADMIN_SECRET > $VARNISH_ADMIN_SECRET_FILE
  else
    dd if=/dev/random of=$VARNISH_ADMIN_SECRET_FILE count=1
  fi
fi

/bin/varnish-reload-synconly

SIGNAL=
EXITCODE=
PROCESS=
PROCESSES=()
PROCESSES_PIDS=()
PROCESSES_IDX=()
PROCESSES_EARLY_KILL=()

track () {
  $1 &
  local pid="$!"
  PROCESSES+=("$1")
  PROCESSES_PIDS+=($pid)
  PROCESSES_IDX+=("${#PROCESSES_IDX[@]}")
  [ "$2" == "KILL_BEFORE_EXIT" ] && PROCESSES_EARLY_KILL+=($pid)
}

exited_process_name () {
  for idx in "${PROCESSES_IDX[@]}"; do
    local found=$(ps -p "${PROCESSES_PIDS[idx]}" -o pid= || echo)
    if [ "$found" == "" ]; then echo "${PROCESSES[idx]}" && return 0; fi
  done
  return 0
}

kill_processes () {
  trap - SIGTERM SIGINT
  if [ "$SIGNAL" == "" ]; then SIGNAL="$1"; EXITCODE="${2:-0}" PROCESS="$(exited_process_name)"; fi

  local pid_to_kill="$PROCESSES_EARLY_KILL[@]"
  [ "$pid_to_kill" != "" ] && kill $pid_to_kill 2> /dev/null || true
}

trap 'kill_processes SIGTERM' SIGTERM
trap 'kill_processes SIGINT' SIGINT

set +e
track /bin/varnish
track /bin/prometheus-varnish-exporter
track /bin/varnish-reload-watch KILL_BEFORE_EXIT

[ "$VARNISH_ACCESS_LOG" == "true" ] && track /bin/varnish-logs
wait -n
kill_processes ERROR "$?"

[ "$SIGNAL" != "ERROR" ] && >&2 echo EXITING with $SIGNAL
[ "$SIGNAL" == "ERROR" ] && >&2 echo EXITING because of ERROR in $PROCESS with code $EXITCODE
GRACEFUL="$(curl -XPOST -H 'health: 503' http://localhost:$VARNISH_PORT/_health 2> /dev/null || true)"
if [ "$GRACEFUL" == "200 OK" ]; then sleep $VARNISH_SHUTDOWN_DELAY; fi
kill $(jobs -p) 2>/dev/null || true
exit $EXITCODE
