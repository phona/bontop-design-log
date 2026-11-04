#!/usr/bin/env bash
set -euo pipefail

# 写操作 token 认证（issue #64）：服务端对所有 POST/PUT/PATCH/DELETE 一律校验
# x-bontop-token 头（GET 不校验，本机回环同样不免）。token 首次启动生成并持久化在
# 仓库根 .bontop-write-token（权限 600，已 gitignore，重启复用；轮换 = 手动删文件），
# 也可用 BONTOP_WRITE_TOKEN 环境变量优先指定。浏览器首次写操作会弹框要求输入
# （值见服务端启动日志或 .bontop-write-token）。手机联调 --host 0.0.0.0 同样要带 token。

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
