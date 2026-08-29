#!/usr/bin/env bash
# Environment-independent Blender entrypoint. RUN_BLENDER_FORCE_WSL is test-only.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/bontop-design-log/blender.env"

# Load only the two documented variables; never source this file.
if [[ -r "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key=${line%%=*}
    value=${line#*=}
    key=${key//[[:space:]]/}
    case "$key" in
      BLENDER_BIN|BLENDER_HOST)
        value=${value#"${value%%[![:space:]]*}"}
        value=${value%"${value##*[![:space:]]}"}
        if [[ ${#value} -ge 2 && ( ( ${value:0:1} == '"' && ${value: -1} == '"' ) || ( ${value:0:1} == "'" && ${value: -1} == "'" ) ) ]]; then
          value=${value:1:${#value}-2}
        fi
        if [[ -z "${!key+x}" ]]; then
          printf -v "$key" '%s' "$value"
          export "$key"
        fi
        ;;
    esac
  done < "$ENV_FILE"
fi

usage() {
  cat >&2 <<'EOF'
Usage: scripts/run-blender.sh --glb PATH --config PATH [options]
Options: --engine VALUE --out-dir PATH --version VALUE --config-dir PATH
         --manifest PATH --only VALUE --mat-override VALUE --res VALUE --help
EOF
}

if [[ $# -eq 0 ]]; then usage; exit 2; fi

glb= config= engine= out_dir= version= config_dir= manifest= only= mat_override= res=
while [[ $# -gt 0 ]]; do
  opt=$1; shift
  case "$opt" in
    --help) usage >&1; exit 0 ;;
    --glb|--config|--engine|--out-dir|--version|--config-dir|--manifest|--only|--mat-override|--res)
      [[ $# -gt 0 ]] || { printf 'run-blender.sh: %s requires a value\n' "$opt" >&2; exit 2; }
      value=$1; shift
      case "$opt" in
        --glb) glb=$value ;; --config) config=$value ;; --engine) engine=$value ;;
        --out-dir) out_dir=$value ;; --version) version=$value ;; --config-dir) config_dir=$value ;;
        --manifest) manifest=$value ;; --only) only=$value ;; --mat-override) mat_override=$value ;; --res) res=$value ;;
      esac
      ;;
    *) printf 'run-blender.sh: unknown argument: %s\n' "$opt" >&2; usage; exit 2 ;;
  esac
done
[[ -n "$glb" ]] || { printf 'run-blender.sh: --glb is required\n' >&2; exit 2; }
[[ -n "$config" ]] || { printf 'run-blender.sh: --config is required\n' >&2; exit 2; }

if [[ -n "${BLENDER_BIN:-}" ]]; then
  blender=$BLENDER_BIN
else
  blender=$(command -v blender || true)
fi
[[ -n "$blender" ]] || { printf 'run-blender.sh: Blender not found; set BLENDER_BIN or install blender on PATH\n' >&2; exit 127; }

host=${BLENDER_HOST:-}
if [[ -z "$host" ]]; then
  case "$(basename -- "$blender")" in *.exe) host=windows ;; *) host=linux ;; esac
fi
case "$host" in linux|windows) ;; *) printf 'run-blender.sh: BLENDER_HOST must be linux or windows (got %s)\n' "$host" >&2; exit 2 ;; esac

project_path() {
  local value=$1
  # Drive-letter and UNC paths are already host paths; do not reinterpret them.
  if [[ "$value" == /* || "$value" =~ ^[A-Za-z]:[\\/] || "$value" == \\* || "$value" == //* ]]; then
    printf '%s' "$value"
  else
    realpath -m -- "$PROJECT_ROOT/$value"
  fi
}

glb=$(project_path "$glb")
config=$(project_path "$config")
out_dir=$(project_path "${out_dir:-$PROJECT_ROOT}")
config_dir=$(project_path "${config_dir:-$PROJECT_ROOT}")
[[ -n "$manifest" ]] && manifest=$(project_path "$manifest")
scene_script=$(project_path "$SCRIPT_DIR/blender/dress_scene.py")

[[ -f "$glb" ]] || { printf 'run-blender.sh: GLB not found: %s\n' "$glb" >&2; exit 1; }
[[ -f "$config" ]] || { printf 'run-blender.sh: render config not found: %s\n' "$config" >&2; exit 1; }

is_wsl=0
if [[ -n "${RUN_BLENDER_FORCE_WSL:-}" || -n "${WSL_INTEROP:-}" ]]; then
  is_wsl=1
else
  version_text=$(< /proc/version 2>/dev/null || true)
  [[ "$version_text" =~ [Mm]icrosoft|[Ww][Ss][Ll] ]] && is_wsl=1
fi
if [[ "$host" == windows && $is_wsl -eq 1 ]]; then
  command -v wslpath >/dev/null 2>&1 || { printf 'run-blender.sh: windows host on WSL requires wslpath\n' >&2; exit 127; }
  scene_script=$(wslpath -w -- "$scene_script")
  glb=$(wslpath -w -- "$glb")
  config=$(wslpath -w -- "$config")
  out_dir=$(wslpath -w -- "$out_dir")
  config_dir=$(wslpath -w -- "$config_dir")
  [[ -n "$manifest" ]] && manifest=$(wslpath -w -- "$manifest")
fi

args=(--background --python "$scene_script" -- --glb "$glb" --config "$config" --engine "${engine:-EEVEE}" --out-dir "$out_dir" --version "${version:-v1}" --config-dir "$config_dir")
[[ -n "$manifest" ]] && args+=(--manifest "$manifest")
[[ -n "$only" ]] && args+=(--only "$only")
[[ -n "$mat_override" ]] && args+=(--mat-override "$mat_override")
[[ -n "$res" ]] && args+=(--res "$res")
cd "$PROJECT_ROOT"
exec "$blender" "${args[@]}"
