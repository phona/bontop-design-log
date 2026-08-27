#!/usr/bin/env python3
"""Small, dependency-free AutoDL elastic deployment API client."""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import tomllib
except ModuleNotFoundError:
    try:
        import tomli as tomllib
    except ModuleNotFoundError:
        tomllib = None

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
DEFAULT_CONFIG = os.path.join(PROJECT_ROOT, ".agents", "skills", "autodl-manager", "config.toml")
DEFAULT_ENV_FILE = os.path.join(PROJECT_ROOT, ".env")
DEFAULT_HOST = "https://api.autodl.com"
DEFAULT_TIMEOUT = 15
DEFAULT_PAGE_SIZE = 100
CONFIG = {}
HOST = DEFAULT_HOST
TIMEOUT = DEFAULT_TIMEOUT


def load_config(path):
    if not os.path.exists(path):
        return {}
    if tomllib is None:
        fail("读取 TOML 配置需要 Python 3.11+，或安装 tomli")
    try:
        with open(path, "rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        fail(f"无法读取配置文件 {path}: {exc}")


def config_value(section, key, default=None):
    return CONFIG.get(section, {}).get(key, default)


def profile_values(name):
    profiles = CONFIG.get("profiles", {})
    if name and name not in profiles:
        fail(f"配置中不存在 profile：{name}")
    values = dict(CONFIG.get("defaults", {}))
    if name:
        values.update(profiles[name])
    return values


def initialize_config(path):
    global CONFIG, HOST, TIMEOUT
    CONFIG = load_config(path)
    HOST = os.environ.get("AUTODL_HOST", config_value("autodl", "host", DEFAULT_HOST))
    TIMEOUT = int(os.environ.get("AUTODL_TIMEOUT", config_value("autodl", "timeout", DEFAULT_TIMEOUT)))


def fail(message, code=2):
    print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def token():
    value = os.environ.get("AUTODL_TOKEN", "").strip()
    if not value:
        value = str(config_value("auth", "token", "")).strip()
    if not value:
        fail("未找到 AutoDL Token，请配置 [auth].token，或执行：export AUTODL_TOKEN=\"你的开发者Token\"")
    return value


def scrub(value, show_password=False):
    if show_password:
        return value
    if isinstance(value, dict):
        return {
            key: ("<hidden>" if key == "root_password" else scrub(item, False))
            for key, item in value.items()
            if key not in {"authorization", "Authorization"}
        }
    if isinstance(value, list):
        return [scrub(item, False) for item in value]
    return value


def request(method, path, body=None, query=None, mutate=False, show_password=False):
    headers = {"Authorization": token(), "Content-Type": "application/json"}
    url = HOST + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_obj = urllib.request.Request(url, data=data, headers=headers, method=method)
    attempts = 1 if mutate else 3
    last_error = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request_obj, timeout=TIMEOUT) as response:
                raw = response.read().decode("utf-8")
            result = json.loads(raw)
            if result.get("code") != "Success":
                fail(result.get("msg") or f"AutoDL API 返回失败：{result.get('code', 'unknown')}", 1)
            print(json.dumps(scrub(result, show_password), ensure_ascii=False, indent=2))
            return
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
                parsed = json.loads(detail)
                message = parsed.get("msg") or detail
            except (ValueError, json.JSONDecodeError):
                message = str(exc)
            last_error = f"HTTP {exc.code}: {message}"
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = f"请求 AutoDL 失败：{exc}"
        if attempt + 1 < attempts:
            time.sleep(0.5 * (attempt + 1))
    fail(last_error or "请求 AutoDL 失败", 1)


def require_confirm(args, deletion=False):
    flag = getattr(args, "confirm_delete", False) if deletion else getattr(args, "confirm", False)
    if not flag:
        fail("这是变更操作。请先向用户展示目标和参数，获得明确确认后再传入确认参数。")


def csv_values(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in value.split(",") if item.strip()]


def add_paging(parser):
    parser.add_argument("--page", type=int)
    parser.add_argument("--page-size", type=int)


def main():
    parser = argparse.ArgumentParser(description="AutoDL elastic deployment API client")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="TOML 配置文件路径")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("config", help="显示当前非敏感配置")
    sub.add_parser("list-profiles", help="列出配置中的 profile")

    p = sub.add_parser("deployments")
    add_paging(p)
    p.add_argument("--name")
    p.add_argument("--status", choices=["running", "stopped"])
    p.add_argument("--deployment")

    p = sub.add_parser("containers")
    p.add_argument("--deployment", required=True)
    p.add_argument("--container")
    p.add_argument("--status", action="append")
    add_paging(p)
    p.add_argument("--released", action="store_true")
    p.add_argument("--show-password", action="store_true")

    p = sub.add_parser("events")
    p.add_argument("--deployment", required=True)
    p.add_argument("--container")
    add_paging(p)

    p = sub.add_parser("images")
    add_paging(p)

    p = sub.add_parser("stock")
    p.add_argument("--region")
    p.add_argument("--gpu-names")
    p.add_argument("--cuda-from", type=int)
    p.add_argument("--cuda-to", type=int)
    p.add_argument("--memory-from", type=int)
    p.add_argument("--memory-to", type=int)
    p.add_argument("--cpu-from", type=int)
    p.add_argument("--cpu-to", type=int)
    p.add_argument("--price-from", type=int)
    p.add_argument("--price-to", type=int)

    p = sub.add_parser("create")
    p.add_argument("--profile")
    p.add_argument("--name")
    p.add_argument("--type", dest="deployment_type", choices=["ReplicaSet", "Job", "Container"])
    p.add_argument("--replicas", type=int)
    p.add_argument("--parallelism", type=int)
    p.add_argument("--regions")
    p.add_argument("--gpu-names")
    p.add_argument("--gpu-num", type=int)
    p.add_argument("--cuda-from", type=int)
    p.add_argument("--cuda-to", type=int)
    p.add_argument("--cpu-from", type=int)
    p.add_argument("--cpu-to", type=int)
    p.add_argument("--memory-from", type=int)
    p.add_argument("--memory-to", type=int)
    p.add_argument("--price-from", type=int)
    p.add_argument("--price-to", type=int)
    p.add_argument("--image-uuid")
    p.add_argument("--cmd")
    p.add_argument("--cmd-before-shutdown")
    p.add_argument("--reuse-container", action="store_true", default=None)
    p.add_argument("--reuse-scope", choices=["all", "deployment"])
    p.add_argument("--service-6006-protocol", choices=["http", "tcp"])
    p.add_argument("--service-6008-protocol", choices=["http", "tcp"])
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("stop-container")
    p.add_argument("--container", required=True)
    p.add_argument("--decrease-replica", action="store_true")
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--cmd-before-shutdown")
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("scale")
    p.add_argument("--deployment", required=True)
    p.add_argument("--replicas", type=int, required=True)
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("stop-deployment")
    p.add_argument("--deployment", required=True)
    p.add_argument("--confirm", action="store_true")

    p = sub.add_parser("delete-deployment")
    p.add_argument("--deployment", required=True)
    p.add_argument("--confirm-delete", action="store_true")

    p = sub.add_parser("blacklist")
    p.add_argument("--container", required=True)
    p.add_argument("--minutes", type=int)
    p.add_argument("--comment")
    p.add_argument("--confirm", action="store_true")

    sub.add_parser("blacklists")

    p = sub.add_parser("ddp")
    p.add_argument("--deployment", required=True)

    args = parser.parse_args()
    initialize_config(args.config)
    command = args.command

    if command == "create":
        values = profile_values(args.profile)
        aliases = {
            "deployment_type": "type", "regions": "regions", "gpu_names": "gpu_names",
            "gpu_num": "gpu_num", "cuda_from": "cuda_from", "cuda_to": "cuda_to",
            "cpu_from": "cpu_from", "cpu_to": "cpu_to", "memory_from": "memory_from",
            "memory_to": "memory_to", "price_from": "price_from", "price_to": "price_to",
            "image_uuid": "image_uuid", "cmd": "cmd", "replicas": "replicas",
            "parallelism": "parallelism", "cmd_before_shutdown": "cmd_before_shutdown",
            "reuse_scope": "reuse_scope", "service_6006_protocol": "service_6006_protocol",
            "service_6008_protocol": "service_6008_protocol",
        }
        for destination, source in aliases.items():
            if getattr(args, destination) is None and source in values:
                setattr(args, destination, values[source])
        if args.reuse_container is None:
            args.reuse_container = values.get("reuse_container", False)

    if command == "stock" and args.region is None:
        defaults = config_value("defaults", "regions", [])
        args.region = defaults[0] if defaults else None

    if command == "config":
        safe_config = json.loads(json.dumps(CONFIG))
        if "auth" in safe_config and "token" in safe_config["auth"]:
            safe_config["auth"]["token"] = "<configured>"
        safe_config.pop("token", None)
        print(json.dumps(safe_config, ensure_ascii=False, indent=2))
        return
    if command == "list-profiles":
        print(json.dumps(sorted(CONFIG.get("profiles", {}).keys()), ensure_ascii=False, indent=2))
        return

    page_size = getattr(args, "page_size", None) or int(config_value("autodl", "page_size", DEFAULT_PAGE_SIZE))
    page = getattr(args, "page", None) or 1

    if command == "deployments":
        body = {"page_index": page, "page_size": page_size}
        for key, value in (("name", args.name), ("status", args.status), ("deployment_uuid", args.deployment)):
            if value:
                body[key] = value
        request("POST", "/api/v1/dev/deployment/list", body)
    elif command == "containers":
        body = {"deployment_uuid": args.deployment, "page_index": page, "page_size": page_size, "released": args.released}
        if args.container:
            body["container_uuid"] = args.container
        if args.status:
            body["status"] = args.status
        request("POST", "/api/v1/dev/deployment/container/list", body, show_password=args.show_password)
    elif command == "events":
        body = {"deployment_uuid": args.deployment, "page_index": page, "page_size": page_size}
        if args.container:
            body["deployment_container_uuid"] = args.container
        request("POST", "/api/v1/dev/deployment/container/event/list", body)
    elif command == "images":
        request("POST", "/api/v1/dev/image/private/list", {"page_index": page, "page_size": page_size})
    elif command == "stock":
        region = args.region or config_value("defaults", "regions", [None])[0]
        if not region:
            fail("stock 需要 --region，或在 [defaults] 中配置 regions")
        body = {"region_sign": region}
        mapping = {"gpu_names": "gpu_name_set", "cuda_from": "cuda_v_from", "cuda_to": "cuda_v_to", "memory_from": "memory_size_from", "memory_to": "memory_size_to", "cpu_from": "cpu_num_from", "cpu_to": "cpu_num_to", "price_from": "price_from", "price_to": "price_to"}
        for source, target in mapping.items():
            value = getattr(args, source)
            if value is not None:
                body[target] = csv_values(value) if source == "gpu_names" else value
        request("POST", "/api/v1/dev/machine/region/gpu_stock", body)
    elif command == "create":
        required = ("name", "deployment_type", "regions", "gpu_names", "gpu_num", "cuda_from", "cuda_to", "cpu_from", "cpu_to", "memory_from", "memory_to", "price_from", "price_to", "image_uuid", "cmd")
        missing = [name for name in required if getattr(args, name) is None]
        if missing:
            fail("create 缺少参数：" + ", ".join("--" + name.replace("_", "-") for name in missing))
        require_confirm(args)
        if args.deployment_type in {"ReplicaSet", "Job"} and args.replicas is None:
            fail("ReplicaSet/Job 必须提供 --replicas")
        if args.deployment_type == "Job" and args.parallelism is None:
            fail("Job 必须提供 --parallelism")
        template = {"dc_list": csv_values(args.regions), "gpu_name_set": csv_values(args.gpu_names), "gpu_num": args.gpu_num, "cuda_v_from": args.cuda_from, "cuda_v_to": args.cuda_to, "cpu_num_from": args.cpu_from, "cpu_num_to": args.cpu_to, "memory_size_from": args.memory_from, "memory_size_to": args.memory_to, "price_from": args.price_from, "price_to": args.price_to, "image_uuid": args.image_uuid, "cmd": args.cmd}
        optional = {"cmd_before_shutdown": args.cmd_before_shutdown, "reuse_container": args.reuse_container, "reuse_container_scope": args.reuse_scope, "service_6006_port_protocol": args.service_6006_protocol, "service_6008_port_protocol": args.service_6008_protocol}
        template.update({key: value for key, value in optional.items() if value is not None})
        body = {"name": args.name, "deployment_type": args.deployment_type, "container_template": template}
        if args.replicas is not None:
            body["replica_num"] = args.replicas
        if args.parallelism is not None:
            body["parallelism_num"] = args.parallelism
        request("POST", "/api/v1/dev/deployment", body, mutate=True)
    elif command == "stop-container":
        require_confirm(args)
        body = {"deployment_container_uuid": args.container, "decrease_one_replica_num": args.decrease_replica, "no_cache": args.no_cache}
        if args.cmd_before_shutdown is not None:
            body["cmd_before_shutdown"] = args.cmd_before_shutdown
        request("PUT", "/api/v1/dev/deployment/container/stop", body, mutate=True)
    elif command == "scale":
        require_confirm(args)
        if args.replicas < 0:
            fail("--replicas 不能为负数")
        request("PUT", "/api/v1/dev/deployment/replica_num", {"deployment_uuid": args.deployment, "replica_num": args.replicas}, mutate=True)
    elif command == "stop-deployment":
        require_confirm(args)
        request("PUT", "/api/v1/dev/deployment/operate", {"deployment_uuid": args.deployment, "operate": "stop"}, mutate=True)
    elif command == "delete-deployment":
        require_confirm(args, deletion=True)
        request("DELETE", "/api/v1/dev/deployment", {"deployment_uuid": args.deployment}, mutate=True)
    elif command == "blacklist":
        require_confirm(args)
        body = {"deployment_container_uuid": args.container}
        if args.minutes is not None:
            if not 1 <= args.minutes <= 43200:
                fail("--minutes 必须在 1 到 43200 之间")
            body["expire_in_minutes"] = args.minutes
        if args.comment is not None:
            body["comment"] = args.comment
        request("POST", "/api/v1/dev/deployment/blacklist", body, mutate=True)
    elif command == "blacklists":
        request("GET", "/api/v1/dev/deployment/blacklist")
    elif command == "ddp":
        request("GET", "/api/v1/dev/deployment/ddp/overview", query={"deployment_uuid": args.deployment})


if __name__ == "__main__":
    main()
