#!/usr/bin/env bash
set -euo pipefail

HOST="localhost"
FORWARD_ARGS=()

while (($#)); do
  case "$1" in
    --host)
      if (($# < 2)); then
        echo "error: --host requires a value" >&2
        exit 1
      fi
      HOST="$2"
      FORWARD_ARGS+=("--host" "$HOST")
      shift 2
      ;;
    --host=*)
      HOST="${1#--host=}"
      FORWARD_ARGS+=("--host" "$HOST")
      shift
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
      ;;
  esac
done

cleanup() {
  kill "$SERVER_PID" "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

HOST="$HOST" tsx --watch server/index.ts &
SERVER_PID=$!

(
  cd app
  bun run dev -- "${FORWARD_ARGS[@]}"
) &
APP_PID=$!

wait -n "$SERVER_PID" "$APP_PID"
