#!/usr/bin/env python3
"""Client for the official AutoDL Container Instance Pro API."""

import argparse
import copy
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10
    try:
        import tomli as tomllib
    except ModuleNotFoundError:  # pragma: no cover
        tomllib = None

PROJECT_ROOT = Path(__file__).resolve().parents[4]
SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = SKILL_ROOT / "config.toml"
if not DEFAULT_CONFIG.exists():
    DEFAULT_CONFIG = PROJECT_ROOT / "config" / "autodl-manager.toml"
DEFAULT_ENV_FILE = SKILL_ROOT / ".env"
DEFAULT_HOST = "https://api.autodl.com"
DEFAULT_TIMEOUT = 15
DEFAULT_PAGE_SIZE = 100
SENSITIVE_KEYS = {"authorization", "token", "access_token", "refresh_token", "secret", "root_password", "jupyter_token", "password", "cookie", "cookies"}
STOPPED_STATES = {"stopped", "shutdown", "shut_down", "powered_off", "released", "terminated"}


class ApiError(Exception):
    """An HTTP or official API error."""


def fail(message, code=2):
    print(json.dumps({"error": scrub_text(str(message))}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def scrub_text(text):
    text = str(text)
    for name in ("root_password", "jupyter_token", "AUTODL_TOKEN", "password", "cookie", "token"):
        if name.lower() in text.lower():
            text = text.replace(name, "<hidden>")
    for candidate in (os.environ.get("AUTODL_TOKEN"),):
        if candidate:
            text = text.replace(candidate, "<hidden>")
    return text


def load_env_file(path):
    """Load simple KEY=VALUE lines without overriding the process environment."""
    if not path:
        return
    env_path = Path(path)
    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if value[:1] in {"'", '"'} and value[-1:] == value[:1]:
                value = value[1:-1]
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError as exc:
        fail(f"无法读取 env 文件 {env_path}: {scrub_text(str(exc))}")


def load_config(path):
    if not path or not Path(path).exists():
        return {}
    if tomllib is None:
        fail("读取 TOML 配置需要 Python 3.11+，或安装项目要求的 tomli")
    try:
        with open(path, "rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"无法读取配置文件 {path}: {scrub_text(str(exc))}")


def scrub(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_lower in SENSITIVE_KEYS or any(part in key_lower for part in ("token", "password", "cookie")):
                result[key_text] = "<hidden>"
            else:
                result[key_text] = scrub(item)
        return result
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, str):
        return scrub_text(value)
    return value


def token(config):
    value = os.environ.get("AUTODL_TOKEN", "").strip()
    if not value:
        value = str(config.get("auth", {}).get("token", "")).strip()
    if not value or value == "你的AutoDL开发者Token" or value == "replace-me":
        fail("未找到 AutoDL Token，请配置项目 .env 的 AUTODL_TOKEN，或设置进程环境变量")
    return value


def setting(config, key, default):
    api = config.get("api", {})
    legacy = config.get("autodl", {})
    value = os.environ.get("AUTODL_" + key.upper())
    if value is None:
        value = api.get(key, legacy.get(key, default))
    try:
        return int(value)
    except (TypeError, ValueError):
        fail(f"配置项 api.{key} 必须是整数")


def host(config):
    api = config.get("api", {})
    legacy = config.get("autodl", {})
    value = os.environ.get("AUTODL_HOST", api.get("host", legacy.get("host", DEFAULT_HOST)))
    return str(value).rstrip("/")


def api_request(config, method, path, body=None, query=None, mutate=False):
    url = host(config) + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Authorization": token(config), "Content-Type": "application/json"}, method=method)
    attempts = 1 if mutate else 3
    last_error = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=setting(config, "timeout", DEFAULT_TIMEOUT)) as response:
                status = response.status
                raw = response.read().decode("utf-8")
            result = json.loads(raw)
            if status < 200 or status >= 300:
                raise ApiError(f"HTTP {status}: {result.get('msg') or result}")
            if result.get("code") != "Success":
                raise ApiError(result.get("msg") or f"AutoDL API 返回失败：{result.get('code', 'unknown')}")
            return result
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("msg") or detail
            except (ValueError, json.JSONDecodeError):
                pass
            last_error = f"HTTP {exc.code}: {scrub_text(detail)}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ApiError) as exc:
            last_error = scrub_text(str(exc))
        if attempt + 1 < attempts:
            time.sleep(0.5 * (attempt + 1))
    raise ApiError(last_error or "请求 AutoDL 失败")


def call_and_print(config, method, path, body=None, query=None, mutate=False):
    result = api_request(config, method, path, body, query, mutate)
    print(json.dumps(scrub(result), ensure_ascii=False, indent=2))
    return result


def profile_values(config, name):
    profiles = config.get("profiles", {})
    if name and name not in profiles:
        fail(f"配置中不存在 profile：{name}")
    return dict(profiles.get(name, {})) if name else {}


def merged_create_values(config, args):
    values = profile_values(config, args.profile)
    fields = ("gpu_spec_uuid", "gpu_num", "image_uuid", "cuda_from", "system_disk_gb", "data_center_list", "instance_name", "start_command")
    return {field: getattr(args, field, None) if getattr(args, field, None) is not None else values.get(field) for field in fields}


def csv_values(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def cuda_value(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            major, minor = str(value).strip().split(".", 1)
            return int(major) * 10 + int(minor[:1])
        except (ValueError, IndexError):
            fail("--cuda-from/cuda_from 必须是例如 118 或 11.8 的 CUDA 版本")


def require_confirm(args, flag="confirm"):
    if not getattr(args, flag, False):
        fail("这是变更操作，请先确认目标和参数后传入确认参数。")


def current_status(config, uuid):
    result = api_request(config, "GET", "/api/v1/dev/instance/pro/status", query={"instance_uuid": uuid})
    status = result.get("data")
    if not isinstance(status, str):
        raise ApiError(f"实例 {uuid} 状态响应格式异常")
    return status.lower()


def release_instance(config, uuid):
    try:
        api_request(config, "GET", "/api/v1/dev/instance/pro/snapshot", query={"instance_uuid": uuid})
        state = current_status(config, uuid)
        if state in {"released", "terminated"}:
            raise ApiError(f"实例 {uuid} 已是 {state} 状态，无需再次 release。")
        if state not in STOPPED_STATES:
            call_and_print(config, "POST", "/api/v1/dev/instance/pro/power_off", {"instance_uuid": uuid}, mutate=True)
            deadline = time.monotonic() + min(setting(config, "timeout", DEFAULT_TIMEOUT), 60)
            while time.monotonic() < deadline:
                time.sleep(1)
                state = current_status(config, uuid)
                if state in STOPPED_STATES:
                    break
            if state not in STOPPED_STATES:
                raise ApiError(f"实例 {uuid} 未确认停止（当前状态：{state}），已拒绝 release。")
        result = api_request(config, "POST", "/api/v1/dev/instance/pro/release", {"instance_uuid": uuid}, mutate=True)
    except ApiError as exc:
        fail(f"实例 {uuid} 查询或 release 失败（可能已释放或不存在）：{exc}", 1)
    print(json.dumps(scrub(result), ensure_ascii=False, indent=2))


def add_page_options(parser):
    parser.add_argument("--page", type=int)
    parser.add_argument("--page-size", type=int)


def page_body(config, args):
    return {"page_index": args.page or 1, "page_size": args.page_size or setting(config, "page_size", DEFAULT_PAGE_SIZE)}


def main():
    parser = argparse.ArgumentParser(description="AutoDL official Container Instance Pro API client")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="项目 TOML 配置文件路径")
    parser.add_argument("--env-file", help="env 文件路径，默认 skill 目录 .env")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("config")
    sub.add_parser("list-profiles")
    p = sub.add_parser("ls"); add_page_options(p)
    p = sub.add_parser("info"); p.add_argument("uuid")
    p = sub.add_parser("status"); p.add_argument("uuid")
    p = sub.add_parser("create")
    p.add_argument("--profile"); p.add_argument("--gpu-spec", dest="gpu_spec_uuid"); p.add_argument("--gpu"); p.add_argument("--gpu-num", dest="gpu_num", type=int)
    p.add_argument("--image-uuid"); p.add_argument("--cuda-from"); p.add_argument("--system-disk-gb", type=int); p.add_argument("--region", action="append")
    p.add_argument("--name", dest="instance_name"); p.add_argument("--start-command"); p.add_argument("--confirm", action="store_true")
    for name in ("start", "stop"):
        p = sub.add_parser(name); p.add_argument("uuid"); p.add_argument("--start-command"); p.add_argument("--confirm", action="store_true")
    p = sub.add_parser("release"); p.add_argument("uuid"); p.add_argument("--confirm-release", action="store_true")
    p = sub.add_parser("images"); add_page_options(p)
    p = sub.add_parser("save-image"); p.add_argument("uuid"); p.add_argument("--image-name", required=True); p.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    load_env_file(args.env_file or DEFAULT_ENV_FILE)
    config = load_config(os.environ.get("AUTODL_CONFIG", args.config))
    if args.command == "config":
        print(json.dumps(scrub(copy.deepcopy(config)), ensure_ascii=False, indent=2)); return
    if args.command == "list-profiles":
        print(json.dumps(sorted(config.get("profiles", {}).keys()), ensure_ascii=False, indent=2)); return
    try:
        if args.command == "ls": call_and_print(config, "POST", "/api/v1/dev/instance/pro/list", page_body(config, args))
        elif args.command == "info": call_and_print(config, "GET", "/api/v1/dev/instance/pro/snapshot", query={"instance_uuid": args.uuid})
        elif args.command == "status": call_and_print(config, "GET", "/api/v1/dev/instance/pro/status", query={"instance_uuid": args.uuid})
        elif args.command == "create":
            require_confirm(args); values = merged_create_values(config, args)
            if args.gpu and not values.get("gpu_spec_uuid"): fail("--gpu 仅是显示别名，请提供 --gpu-spec/gpu_spec_uuid。")
            missing = [key for key in ("gpu_spec_uuid", "gpu_num", "image_uuid", "cuda_from", "system_disk_gb") if values.get(key) is None]
            if missing: fail("create 缺少参数：" + ", ".join(missing))
            if not 1 <= values["gpu_num"] <= 4: fail("gpu_num 必须在 1 到 4 之间")
            if not 0 <= values["system_disk_gb"] <= 500: fail("system_disk_gb 必须在 0 到 500 之间")
            body = {"gpu_spec_uuid": values["gpu_spec_uuid"], "req_gpu_amount": values["gpu_num"], "image_uuid": values["image_uuid"], "cuda_v_from": cuda_value(values["cuda_from"]), "expand_system_disk_by_gb": values["system_disk_gb"]}
            if values["data_center_list"] is not None: body["data_center_list"] = csv_values(values["data_center_list"])
            if values["instance_name"] is not None: body["instance_name"] = values["instance_name"]
            if values["start_command"] is not None: body["start_command"] = values["start_command"]
            call_and_print(config, "POST", "/api/v1/dev/instance/pro/create", body, mutate=True)
        elif args.command == "start":
            require_confirm(args); body = {"instance_uuid": args.uuid, "payload": "gpu"}
            if args.start_command is not None: body["start_command"] = args.start_command
            call_and_print(config, "POST", "/api/v1/dev/instance/pro/power_on", body, mutate=True)
        elif args.command == "stop":
            require_confirm(args); call_and_print(config, "POST", "/api/v1/dev/instance/pro/power_off", {"instance_uuid": args.uuid}, mutate=True)
        elif args.command == "release":
            if not args.confirm_release: fail("release 是不可逆操作，请传入 --confirm-release。")
            release_instance(config, args.uuid)
        elif args.command == "images": call_and_print(config, "POST", "/api/v1/dev/instance/pro/image/private/list", page_body(config, args))
        elif args.command == "save-image":
            require_confirm(args); call_and_print(config, "POST", "/api/v1/dev/instance/pro/image/save", {"instance_uuid": args.uuid, "image_name": args.image_name}, mutate=True)
    except ApiError as exc:
        fail(str(exc), 1)


if __name__ == "__main__":
    main()
