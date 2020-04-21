#!/bin/bash
set -em

log () {
  awk '{print strftime("%Y-%m-%dT%H:%M:%SZ",systime()) " [entrypoint]: " $0}' <<<"$@" 1>&2
}

normalize_ips () {
  echo "${1:-}" | sed -E 's/([0-9.:]+)/"\1"/g' | sed -E 's/\/"([0-9]+)"/\/\1/g'
}

export VARNISH_ADMIN_SECRET_FILE=${VARNISH_ADMIN_SECRET_FILE:-/etc/varnish/secret}
export VARNISH_ADMIN_SECRET=${VARNISH_ADMIN_SECRET:-}
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
export BACKEND_FETCH_RETRIES=${BACKEND_FETCH_RETRIES:-1}
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
    dd if=/dev/random of=$VARNISH_ADMIN_SECRET_FILE count=1 > /dev/null 2>&1
  fi
fi

/bin/confd-reload-synconly 1>&2

PROCESSES=()
PROCESSES_PIDS=()
PROCESSES_IDX=()

KILL_BEFORE_EXIT=()
KILL_BEFORE_EXIT_PIDS=()

EXIT_SIGNAL=
EXIT_CODE=
EXIT_PROCESS=

track () {
  local ARGS="$(echo $@)"
  local PROCESS=$1
  if [[ " $ARGS " =~ " LOG_TO_STDERR " ]]; then
    $PROCESS 1>&2 &
  else
    $PROCESS &
  fi

  local PID=$!
  PROCESSES+=("$PROCESS")
  PROCESSES_PIDS+=($PID)
  PROCESSES_IDX+=("${#PROCESSES_IDX[@]}")

  log STARTED $PROCESS with PID $PID
  if [[ " $ARGS " =~ " KILL_BEFORE_EXIT " ]]; then
    KILL_BEFORE_EXIT+=("$PROCESS")
    KILL_BEFORE_EXIT_PIDS+=($PID)
  fi
}

exited_process_name () {
  for idx in "${PROCESSES_IDX[@]}"; do
    local found=$(ps -p "${PROCESSES_PIDS[idx]}" -o pid= || echo)
    if [ "$found" == "" ]; then echo "${PROCESSES[idx]}" && return 0; fi
  done
  return 0
}

handle_signal () {
  trap - ERR
  trap '' SIGINT SIGTERM

  # There's always a ^C when we do a manual cancel.
  # I want to have the next log on the next line, so it looks prettier
  >&2 echo

  if [ "$EXIT_SIGNAL" != "" ]; then return 0; fi
  EXIT_SIGNAL="$1";
  EXIT_CODE="${2:-0}" EXIT_PROCESS="$(exited_process_name)"
  handle_shutdown
}

handle_shutdown () {
  [ "$EXIT_SIGNAL" != "SIGKILL" ] && log EXITING with $EXIT_SIGNAL
  [ "$EXIT_SIGNAL" == "SIGKILL" ] && log EXITING with ERROR in $EXIT_PROCESS and exit code $EXIT_CODE
  trap "log EXITED with code $EXIT_CODE && exit $EXIT_CODE" EXIT

  if [ ${#KILL_BEFORE_EXIT_PIDS} -ne 0 ]; then
    kill -s $EXIT_SIGNAL $KILL_BEFORE_EXIT_PIDS 2>&1 > /dev/null || true
  fi

  GRACEFUL="$(curl -s -XPOST -H 'health: 503' http://localhost:$VARNISH_PORT/_health || true)"
  if [ "$GRACEFUL" == "200 OK" ]; then
    log GRACEFUL SHUTDOWN, waiting for $VARNISH_SHUTDOWN_DELAY seconds.
    sleep $VARNISH_SHUTDOWN_DELAY
  fi
  exec 2> /dev/null
  pkill -TERM -P $$
}

trap 'handle_signal SIGKILL' ERR
trap 'handle_signal SIGTERM' SIGTERM EXIT
trap 'handle_signal SIGINT' SIGINT

track /bin/varnish LOG_TO_STDERR
[ "$VARNISH_ACCESS_LOG" == "true" ] && track /bin/varnish-logs
track /bin/prometheus-varnish-exporter LOG_TO_STDERR
track /bin/confd-reload-watch KILL_BEFORE_EXIT LOG_TO_STDERR
wait -n
