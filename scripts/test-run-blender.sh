#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/work/child dir" "$tmp/config dir" "$ROOT/tmp/run-blender-test spaced"
touch "$ROOT/tmp/run-blender-test spaced/input file.glb" "$ROOT/tmp/run-blender-test spaced/cfg file.json"
trap 'rm -rf "$tmp" "$ROOT/tmp/run-blender-test spaced"' EXIT
cat > "$tmp/bin/fake-blender" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$PWD" > "$FAKE_LOG"
printf '%s\n' "$#" >> "$FAKE_LOG"
printf '<%s>\n' "$@" >> "$FAKE_LOG"
EOF
cat > "$tmp/bin/fake-wslpath" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${!#}" >> "$WSLPATH_LOG"
printf 'WIN(%s)' "${!#}"
EOF
chmod +x "$tmp/bin/fake-blender" "$tmp/bin/fake-wslpath"
ln -s fake-wslpath "$tmp/bin/wslpath"

run() { FAKE_LOG="$tmp/fake.log" WSLPATH_LOG="$tmp/wslpath.log" PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" RUN_BLENDER_FORCE_WSL= "$ROOT/scripts/run-blender.sh" "$@"; }
run_wsl() { : > "$tmp/wslpath.log"; FAKE_LOG="$tmp/fake.log" WSLPATH_LOG="$tmp/wslpath.log" PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" BLENDER_HOST=windows RUN_BLENDER_FORCE_WSL=1 "$ROOT/scripts/run-blender.sh" "$@"; }
assert_log_has() { grep -Fqx "$1" "$tmp/fake.log"; }
assert_failed() { if "$@" >"$tmp/error.log" 2>&1; then return 1; fi; }

(cd "$tmp/work/child dir" && run --glb 'tmp/run-blender-test spaced/input file.glb' --config 'tmp/run-blender-test spaced/cfg file.json' --config-dir . --out-dir 'tmp/run-blender-test spaced/out dir' --engine CYCLES --version v2 --only cam --mat-override 'wall=#fff' --res 50)
assert_log_has "<$ROOT/tmp/run-blender-test spaced/input file.glb>"
assert_log_has "<$ROOT/tmp/run-blender-test spaced/cfg file.json>"
assert_log_has "<$ROOT>"
assert_log_has "<$ROOT/tmp/run-blender-test spaced/out dir>"
assert_log_has '<CYCLES>'
assert_log_has '<--python>'
assert_log_has "<$ROOT/scripts/blender/dress_scene.py>"
assert_log_has '<-->'
assert_log_has '<--only>'
assert_log_has '<cam>'

run_wsl --glb 'tmp/run-blender-test spaced/input file.glb' --config 'tmp/run-blender-test spaced/cfg file.json' --out-dir 'tmp/run-blender-test spaced/out dir' --config-dir config-dir --only 'ordinary value'
[[ $(wc -l < "$tmp/wslpath.log") -eq 5 ]]
grep -Fqx "$ROOT/scripts/blender/dress_scene.py" "$tmp/wslpath.log"
grep -Fqx "$ROOT/tmp/run-blender-test spaced/input file.glb" "$tmp/wslpath.log"
grep -Fq '<WIN(' "$tmp/fake.log"
grep -Fqx '<ordinary value>' "$tmp/fake.log"
! grep -Fqx '<WIN(ordinary value)>' "$tmp/fake.log"

# User env file is allow-listed, and explicit environment wins over it.
env_home="$tmp/home"; mkdir -p "$env_home/.config/bontop-design-log"
printf 'BLENDER_BIN=%s\nBLENDER_HOST=windows\nIGNORED=bad\n' "$tmp/bin/fake-blender" > "$env_home/.config/bontop-design-log/blender.env"
HOME="$env_home" XDG_CONFIG_HOME= PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" BLENDER_HOST=linux FAKE_LOG="$tmp/fake.log" "$ROOT/scripts/run-blender.sh" --glb 'tmp/run-blender-test spaced/input file.glb' --config 'tmp/run-blender-test spaced/cfg file.json'
assert_log_has "<$ROOT/tmp/run-blender-test spaced/input file.glb>"

assert_failed env -i PATH=/usr/bin:/bin HOME="$tmp/no-home" "$ROOT/scripts/run-blender.sh" --glb missing.glb --config missing.json
assert_failed env PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" BLENDER_HOST=solaris "$ROOT/scripts/run-blender.sh" --glb 'tmp/run-blender-test spaced/input file.glb' --config 'tmp/run-blender-test spaced/cfg file.json'
assert_failed env PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" "$ROOT/scripts/run-blender.sh" --config 'tmp/run-blender-test spaced/cfg file.json'
assert_failed env PATH="$tmp/bin:$PATH" BLENDER_BIN="$tmp/bin/fake-blender" "$ROOT/scripts/run-blender.sh" --glb 'tmp/run-blender-test spaced/input file.glb'
printf 'run-blender wrapper tests passed\n'
