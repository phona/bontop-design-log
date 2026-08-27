#!/usr/bin/env python3
"""AutoDL Pro SSH/SFTP helper using Paramiko and fresh API credentials."""

import argparse
import fnmatch
import json
import os
import posixpath
import stat
import sys
import time
from pathlib import Path

import autodl_pro

try:
    import paramiko
except ModuleNotFoundError:
    paramiko = None

SENSITIVE_WORDS = ("root_password", "jupyter_token", "password", "token", "cookie", "authorization")
DEFAULT_IGNORES = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def scrub_text(text):
    return autodl_pro.scrub_text(str(text))


def fail(message, code=2):
    print(json.dumps({"error": scrub_text(message)}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def require_paramiko():
    if paramiko is None:
        fail("未找到 Paramiko。请使用 .agents/skills/autodl-manager/.venv/bin/python，或在该私有 venv 中安装 requirements.txt。")


CREDENTIAL_RETRIES = 5
CREDENTIAL_RETRY_DELAY = 3


def find_exact_field(value, name):
    """Find one exact credential field without treating unrelated ports as SSH data."""
    if isinstance(value, dict):
        item = value.get(name)
        if item not in (None, ""):
            return item
        for nested in value.values():
            found = find_exact_field(nested, name)
            if found is not None:
                return found
    elif isinstance(value, list):
        for nested in value:
            found = find_exact_field(nested, name)
            if found is not None:
                return found
    return None


def snapshot_credentials(snapshot):
    """Read Pro SSH credentials, preferring the documented data object."""
    if not isinstance(snapshot, dict):
        return None, None, None
    data = snapshot.get("data")
    sources = [data, snapshot] if isinstance(data, (dict, list)) else [snapshot]
    values = {}
    for name in ("proxy_host", "ssh_port", "root_password"):
        for source in sources:
            values[name] = find_exact_field(source, name)
            if values[name] not in (None, ""):
                break
    return values.get("proxy_host"), values.get("ssh_port"), values.get("root_password")


def fresh_connection(config, uuid, start, wait_timeout):
    try:
        snapshot = autodl_pro.api_request(config, "GET", "/api/v1/dev/instance/pro/snapshot", query={"instance_uuid": uuid})
        status_result = autodl_pro.api_request(config, "GET", "/api/v1/dev/instance/pro/status", query={"instance_uuid": uuid})
        state = status_result.get("data")
        if not isinstance(state, str):
            raise autodl_pro.ApiError("状态响应格式异常")
        state = state.lower()
        if state != "running":
            if not start:
                raise autodl_pro.ApiError(f"实例当前状态为 {state}，默认只允许 running；请传入 --start")
            autodl_pro.api_request(config, "POST", "/api/v1/dev/instance/pro/power_on", {"instance_uuid": uuid, "payload": "gpu"}, mutate=True)
            deadline = time.monotonic() + wait_timeout
            while time.monotonic() < deadline:
                time.sleep(1)
                status_result = autodl_pro.api_request(config, "GET", "/api/v1/dev/instance/pro/status", query={"instance_uuid": uuid})
                state = str(status_result.get("data", "")).lower()
                if state == "running":
                    break
            if state != "running":
                raise autodl_pro.ApiError(f"实例启动超时，当前状态为 {state}")

        last_missing = "snapshot 未返回完整 SSH 地址或密码"
        for attempt in range(CREDENTIAL_RETRIES):
            if attempt:
                time.sleep(CREDENTIAL_RETRY_DELAY)
            snapshot = autodl_pro.api_request(config, "GET", "/api/v1/dev/instance/pro/snapshot", query={"instance_uuid": uuid})
            host, port, password = snapshot_credentials(snapshot)
            if host and port and password:
                return str(host), int(port), str(password)
            missing = [name for name, value in (("proxy_host", host), ("ssh_port", port), ("root_password", password)) if not value]
            last_missing = "snapshot SSH 凭据未就绪，缺少：" + ", ".join(missing)
        raise autodl_pro.ApiError(last_missing)
    except (autodl_pro.ApiError, ValueError, TypeError) as exc:
        fail(f"实例 {uuid} 凭据获取失败：{scrub_text(exc)}", 1)


def load_ignore_file(root):
    for name in (".autodlignore", ".gitignore"):
        path = root / name
        if path.exists():
            patterns = []
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if line and not line.startswith("#") and not line.startswith("!"):
                    patterns.append(line.rstrip("/"))
            return patterns
    return []


def ignored(relative, is_dir, patterns):
    parts = relative.parts
    if any(part in DEFAULT_IGNORES for part in parts) or relative.suffix == ".pyc":
        return True
    text = "/".join(parts)
    for pattern in patterns:
        if fnmatch.fnmatch(text, pattern) or fnmatch.fnmatch(relative.name, pattern) or (is_dir and fnmatch.fnmatch(text + "/", pattern + "/")):
            return True
    return False


def ensure_remote_dir(sftp, path):
    current = "" if path.startswith("/") else "."
    for part in path.split("/"):
        if not part or part == ".":
            continue
        current = current + "/" + part if current else "/" + part
        try:
            sftp.stat(current)
        except OSError:
            sftp.mkdir(current)


def upload_path(sftp, local, remote, patterns):
    local = Path(local)
    if not local.exists():
        raise FileNotFoundError(local)
    if local.is_file():
        sftp.put(str(local), remote)
        return
    ensure_remote_dir(sftp, remote)
    for path in local.rglob("*"):
        relative = path.relative_to(local)
        if ignored(relative, path.is_dir(), patterns):
            continue
        target = posixpath.join(remote, *relative.parts)
        if path.is_dir():
            ensure_remote_dir(sftp, target)
        else:
            ensure_remote_dir(sftp, posixpath.dirname(target))
            sftp.put(str(path), target)


def download_path(sftp, remote, local):
    local = Path(local)
    try:
        mode = sftp.stat(remote).st_mode
    except OSError:
        raise FileNotFoundError(remote)
    if stat.S_ISDIR(mode):
        local.mkdir(parents=True, exist_ok=True)
        for entry in sftp.listdir_attr(remote):
            download_path(sftp, posixpath.join(remote, entry.filename), local / entry.filename)
    else:
        local.parent.mkdir(parents=True, exist_ok=True)
        sftp.get(remote, str(local))


def open_client(config, uuid, start, wait_timeout):
    require_paramiko()
    host, port, password = fresh_connection(config, uuid, start, wait_timeout)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(hostname=host, port=port, username="root", password=password, timeout=autodl_pro.setting(config, "timeout", 15), look_for_keys=False, allow_agent=False)
    except Exception:
        client.close()
        raise
    return client


def main():
    parser = argparse.ArgumentParser(description="AutoDL Pro SSH/SFTP helper")
    parser.add_argument("--config", default=str(autodl_pro.DEFAULT_CONFIG))
    parser.add_argument("--env-file", default=str(autodl_pro.DEFAULT_ENV_FILE))
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("exec"); p.add_argument("uuid"); p.add_argument("--command", dest="shell_command", required=True); p.add_argument("--start", action="store_true"); p.add_argument("--wait-timeout", type=int, default=120)
    p = sub.add_parser("upload"); p.add_argument("uuid"); p.add_argument("local"); p.add_argument("remote"); p.add_argument("--start", action="store_true"); p.add_argument("--wait-timeout", type=int, default=120)
    p = sub.add_parser("download"); p.add_argument("uuid"); p.add_argument("remote"); p.add_argument("local"); p.add_argument("--start", action="store_true"); p.add_argument("--wait-timeout", type=int, default=120)
    args = parser.parse_args()
    autodl_pro.load_env_file(args.env_file)
    config_path = os.environ.get("AUTODL_CONFIG", args.config)
    config = autodl_pro.load_config(config_path)
    client = None
    try:
        client = open_client(config, args.uuid, args.start, args.wait_timeout)
        if args.command == "exec":
            stdin, stdout, stderr = client.exec_command(args.shell_command)
            result = {"stdout": stdout.read().decode("utf-8", "replace"), "stderr": stderr.read().decode("utf-8", "replace"), "exit_code": stdout.channel.recv_exit_status()}
            print(json.dumps(autodl_pro.scrub(result), ensure_ascii=False, indent=2))
        else:
            sftp = client.open_sftp()
            try:
                if args.command == "upload":
                    root = Path(args.local).resolve() if Path(args.local).is_dir() else Path(args.local).resolve().parent
                    upload_path(sftp, args.local, args.remote, load_ignore_file(root))
                else:
                    download_path(sftp, args.remote, args.local)
                print(json.dumps({"ok": True}, ensure_ascii=False))
            finally:
                sftp.close()
    except Exception as exc:
        fail(f"{args.command} 失败：{scrub_text(exc)}", 1)
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    main()
