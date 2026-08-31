#!/usr/bin/env bash
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RUNNER="$SCRIPT_DIR/runner.ps1"

if [[ ! -f "$RUNNER" ]]; then
  printf 'agent-browser wrapper: missing PowerShell runner: %s\n' "$RUNNER" >&2
  exit 127
fi

PWSH=$(command -v pwsh.exe || command -v pwsh || true)
if [[ -z "$PWSH" ]]; then
  printf 'agent-browser wrapper: pwsh.exe is required but was not found on PATH\n' >&2
  exit 127
fi

exec "$PWSH" -NoProfile -ExecutionPolicy Bypass -File "$RUNNER" "$@"
