#!/usr/bin/env python3
"""Safe, JSON-oriented workflow wrapper for rendering Blender jobs on AutoDL Pro."""

import argparse
import json
import os
import posixpath
import shlex
import sys
import time
from pathlib import Path

import autodl_pro
import autodl_ssh

PROJECT_ROOT = autodl_pro.PROJECT_ROOT
DEFAULT_BUNDLE = Path("tmp/final-render-bundle")
DEFAULT_BLENDER_BIN = "/root/blender/blender"
DEFAULT_REMOTE_ROOT = "/root/bontop-acceptance"
VALID_STATES = {"creating", "starting", "running", "shutting_down", "shutdown"}
POLL_INTERVAL = 3
POLL_TIMEOUT = 900


class WorkflowError(RuntimeError):
    pass


def output(value):
    print(json.dumps(autodl_pro.scrub(value), ensure_ascii=False, indent=2))


def fail(message, code=1):
    print(json.dumps({"error": autodl_pro.scrub_text(str(message))}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


def load_runtime(args):
    autodl_pro.load_env_file(args.env_file or autodl_pro.DEFAULT_ENV_FILE)
    config_path = os.environ.get("AUTODL_CONFIG", args.config)
    return autodl_pro.load_config(config_path)


def profile(config, name):
    values = autodl_pro.profile_values(config, name)
    if not values:
        raise WorkflowError(f"配置中不存在或为空的 profile：{name}")
    return values


def project_path(value):
    path = Path(value)
    if path.is_absolute():
        raise WorkflowError(f"路径必须是项目相对路径：{value}")
    resolved = (PROJECT_ROOT / path).resolve()
    try:
        resolved.relative_to(PROJECT_ROOT.resolve())
    except ValueError as exc:
        raise WorkflowError(f"路径越出项目根目录：{value}") from exc
    return resolved


def bundle_path(value):
    path = project_path(value or DEFAULT_BUNDLE)
    if not path.is_dir():
        raise WorkflowError(f"bundle 目录不存在：{path}")
    required = ("house.glb", "render-config.json", "project-render-facts.json")
    missing = [name for name in required if not (path / name).is_file()]
    if missing:
        raise WorkflowError(f"bundle 缺少必需文件：{', '.join(missing)}")
    files = [item for item in path.rglob("*") if item.is_file() and item.stat().st_size > 0]
    if not files:
        raise WorkflowError(f"bundle 没有非空文件：{path}")
    return path, files


def do_preflight(bundle):
    path, files = bundle_path(bundle)
    return {"ok": True, "bundle": str(path.relative_to(PROJECT_ROOT)), "non_empty_files": len(files), "files": [str(item.relative_to(PROJECT_ROOT)) for item in files]}


def status(config, uuid):
    result = autodl_pro.api_request(config, "GET", "/api/v1/dev/instance/pro/status", query={"instance_uuid": uuid})
    state = result.get("data")
    if not isinstance(state, str) or state.lower() not in VALID_STATES:
        raise WorkflowError(f"实例 {uuid} 状态响应异常：{autodl_pro.scrub(result)}")
    return state.lower()


def wait_for(config, uuid, wanted="running", timeout=POLL_TIMEOUT):
    deadline = time.monotonic() + timeout
    observed = None
    while time.monotonic() < deadline:
        observed = status(config, uuid)
        if observed == wanted:
            return observed
        if observed == "shutdown" and wanted == "running":
            raise WorkflowError(f"实例 {uuid} 已关机，未进入 running")
        time.sleep(POLL_INTERVAL)
    raise WorkflowError(f"实例 {uuid} 等待 {wanted} 超时（当前状态：{observed}）")


def create_instance(config, values, name=None):
    fields = ("gpu_spec_uuid", "gpu_num", "image_uuid", "cuda_from", "system_disk_gb")
    missing = [field for field in fields if values.get(field) is None]
    if missing:
        raise WorkflowError("create 缺少参数：" + ", ".join(missing))
    body = {
        "gpu_spec_uuid": values["gpu_spec_uuid"],
        "req_gpu_amount": int(values["gpu_num"]),
        "image_uuid": values["image_uuid"],
        "cuda_v_from": autodl_pro.cuda_value(values["cuda_from"]),
        "expand_system_disk_by_gb": int(values["system_disk_gb"]),
    }
    if values.get("data_center_list") is not None:
        body["data_center_list"] = autodl_pro.csv_values(values["data_center_list"])
    if name or values.get("instance_name") is not None:
        body["instance_name"] = name or values["instance_name"]
    if values.get("start_command") is not None:
        body["start_command"] = values["start_command"]
    result = autodl_pro.api_request(config, "POST", "/api/v1/dev/instance/pro/create", body, mutate=True)
    uuid = result.get("data")
    if not isinstance(uuid, str) or not uuid.strip():
        raise WorkflowError(f"创建响应 data 不是 UUID 字符串：{autodl_pro.scrub(result)}")
    return uuid.strip()


def ssh_exec(config, uuid, command, start=False):
    client = None
    try:
        client = autodl_ssh.open_client(config, uuid, start, POLL_TIMEOUT)
        _, stdout, stderr = client.exec_command(command)
        result = {"stdout": stdout.read().decode("utf-8", "replace"), "stderr": stderr.read().decode("utf-8", "replace"), "exit_code": stdout.channel.recv_exit_status(), "command": command}
        return autodl_pro.scrub(result)
    finally:
        if client is not None:
            client.close()


def do_probe(config, uuid, start=False):
    checks = []
    for command in ("/root/blender/blender --version", "test -x /root/blender/blender", "nvidia-smi"):
        result = ssh_exec(config, uuid, command, start=start)
        checks.append(result)
        if result["exit_code"] != 0:
            raise WorkflowError(f"probe 检查失败：{command}")
    return {"ok": True, "checks": checks}


def profile_paths(values):
    paths = values.get("upload_paths")
    if not isinstance(paths, list) or not paths:
        raise WorkflowError("profile.upload_paths 必须是非空白名单")
    result = []
    for value in paths:
        path = Path(str(value))
        if path.is_absolute() or ".." in path.parts:
            raise WorkflowError(f"非法上传白名单路径：{value}")
        result.append(path)
    return result


def do_upload(config, uuid, values, bundle=None):
    root = str(values.get("remote_root", DEFAULT_REMOTE_ROOT)).rstrip("/")
    configured_bundle = Path(str(values.get("bundle", DEFAULT_BUNDLE)))
    selected_bundle = Path(str(bundle)) if bundle else configured_bundle
    bundle_local = project_path(selected_bundle)
    if not bundle_local.is_dir():
        raise WorkflowError(f"bundle 目录不存在：{bundle_local}")
    allowed = profile_paths(values)
    if configured_bundle not in allowed:
        raise WorkflowError(f"bundle 不在 profile.upload_paths 白名单中：{configured_bundle}")
    bundle_relative = configured_bundle
    client = None
    uploaded = []
    try:
        client = autodl_ssh.open_client(config, uuid, False, POLL_TIMEOUT)
        sftp = client.open_sftp()
        try:
            for relative in allowed:
                local = bundle_local if relative == bundle_relative else project_path(relative)
                if not local.exists():
                    raise WorkflowError(f"上传路径不存在：{local}")
                remote = posixpath.join(root, relative.as_posix())
                autodl_ssh.upload_path(sftp, local, remote, autodl_ssh.load_ignore_file(local if local.is_dir() else local.parent))
                uploaded.append(str(relative))
        finally:
            sftp.close()
    finally:
        if client is not None:
            client.close()
    return {"ok": True, "uploaded": uploaded, "remote_root": root}


def render_command(values, engine=None, out_dir=None, version=None, res=None):
    blender = str(values.get("blender_bin", DEFAULT_BLENDER_BIN))
    engine = str(engine or values.get("engine", "CYCLES"))
    out_dir = str(out_dir or values.get("out_dir", "tmp/cycles"))
    version = str(version or values.get("render_version", "cycles-final"))
    res = int(res if res is not None else values.get("resolution", 35))
    if not blender.startswith("/") or Path(blender).name != "blender":
        raise WorkflowError("blender_bin 必须是绝对路径且 basename 为 blender")
    if not 1 <= res <= 100:
        raise WorkflowError("res 必须在 1 到 100 之间")
    args = [blender, "-b", "--python", "scripts/blender/dress_scene.py", "--", "--glb", "tmp/final-render-bundle/house.glb", "--config", "tmp/final-render-bundle/render-config.json", "--engine", engine, "--out-dir", out_dir, "--version", version, "--config-dir", ".", "--res", str(res)]
    return "cd " + shlex.quote(str(values.get("remote_root", DEFAULT_REMOTE_ROOT))) + " && exec " + " ".join(shlex.quote(item) for item in args)


def do_render(config, uuid, values, engine=None, out_dir=None, version=None, res=None):
    command = render_command(values, engine, out_dir, version, res)
    result = ssh_exec(config, uuid, command)
    if result["exit_code"] != 0:
        raise WorkflowError("Blender render 失败")
    return {"ok": True, "result": result, "command": command}


def non_empty_local(path):
    return path.is_file() and path.stat().st_size > 0 or path.is_dir() and any(item.is_file() and item.stat().st_size > 0 for item in path.rglob("*"))


def do_fetch(config, uuid, values, remote=None, local=None):
    remote_path = remote or posixpath.join(str(values.get("remote_root", DEFAULT_REMOTE_ROOT)).rstrip("/"), str(values.get("out_dir", "tmp/cycles")))
    local_path = project_path(local or values.get("out_dir", "tmp/cycles"))
    client = None
    try:
        client = autodl_ssh.open_client(config, uuid, False, POLL_TIMEOUT)
        sftp = client.open_sftp()
        try:
            autodl_ssh.download_path(sftp, remote_path, local_path)
        finally:
            sftp.close()
    finally:
        if client is not None:
            client.close()
    if not non_empty_local(local_path):
        raise WorkflowError(f"下载目录没有非空输出文件：{local_path}")
    return {"ok": True, "remote": remote_path, "local": str(local_path.relative_to(PROJECT_ROOT))}


def stop_instance(config, uuid):
    return autodl_pro.api_request(config, "POST", "/api/v1/dev/instance/pro/power_off", {"instance_uuid": uuid}, mutate=True)


def release_instance(config, uuid):
    return autodl_pro.api_request(config, "POST", "/api/v1/dev/instance/pro/release", {"instance_uuid": uuid}, mutate=True)


def wait_for_shutdown(config, uuid, timeout=POLL_TIMEOUT):
    deadline = time.monotonic() + timeout
    observed = None
    while time.monotonic() < deadline:
        observed = status(config, uuid)
        if observed == "shutdown":
            return observed
        if observed == "shutting_down":
            time.sleep(POLL_INTERVAL)
            continue
        time.sleep(POLL_INTERVAL)
    raise WorkflowError(f"实例 {uuid} 等待 shutdown 超时（当前状态：{observed}）")


def do_cleanup(config, uuid, release_after=False, confirm_release=False):
    result = {"stopped": False, "shutdown_confirmed": False, "released": False}
    stop_instance(config, uuid)
    result["stopped"] = True
    if release_after and confirm_release:
        wait_for_shutdown(config, uuid)
        result["shutdown_confirmed"] = True
        release_instance(config, uuid)
        result["released"] = True
    return result


def warn_cleanup(uuid, exc):
    warning = f"实例 {uuid} 清理未完成：{autodl_pro.scrub_text(str(exc))}；请手动检查实例状态"
    print(json.dumps({"warning": warning}, ensure_ascii=False), file=sys.stderr)


def cleanup_workflow(config, uuid, fetch_ok, release_after, confirm_release):
    try:
        stop_instance(config, uuid)
    except BaseException as exc:
        warn_cleanup(uuid, exc)
        return
    if fetch_ok and release_after and confirm_release:
        try:
            wait_for_shutdown(config, uuid)
            release_instance(config, uuid)
        except BaseException as exc:
            warn_cleanup(uuid, exc)


def run_workflow(config, values, args):
    preflight = do_preflight(args.bundle or values.get("bundle", DEFAULT_BUNDLE))
    uuid = None
    fetch_ok = False
    try:
        uuid = create_instance(config, values, args.name)
        wait_for(config, uuid)
        probe = do_probe(config, uuid)
        upload = do_upload(config, uuid, values, args.bundle)
        render = do_render(config, uuid, values)
        fetched = do_fetch(config, uuid, values)
        fetch_ok = True
        return {"ok": True, "uuid": uuid, "preflight": preflight, "probe": probe, "upload": upload, "render": render, "fetch": fetched}
    finally:
        if uuid:
            cleanup_workflow(config, uuid, fetch_ok, args.release_after, args.confirm_release)


def parser():
    root = argparse.ArgumentParser(description="AutoDL Blender workflow (JSON output, credentials scrubbed)")
    root.add_argument("--config", default=str(autodl_pro.DEFAULT_CONFIG))
    root.add_argument("--env-file", default=str(autodl_pro.DEFAULT_ENV_FILE))
    sub = root.add_subparsers(dest="command", required=True)
    p = sub.add_parser("preflight"); p.add_argument("--bundle")
    p = sub.add_parser("probe"); p.add_argument("uuid"); p.add_argument("--start", action="store_true")
    p = sub.add_parser("upload"); p.add_argument("uuid"); p.add_argument("--bundle")
    p = sub.add_parser("render"); p.add_argument("uuid"); p.add_argument("--engine"); p.add_argument("--out-dir"); p.add_argument("--version"); p.add_argument("--res", type=int)
    p = sub.add_parser("fetch"); p.add_argument("uuid"); p.add_argument("--remote"); p.add_argument("--local")
    p = sub.add_parser("cleanup"); p.add_argument("uuid"); p.add_argument("--release-after", action="store_true"); p.add_argument("--confirm-release", action="store_true")
    p = sub.add_parser("run"); p.add_argument("--profile", default="pro"); p.add_argument("--bundle"); p.add_argument("--release-after", action="store_true"); p.add_argument("--confirm-release", action="store_true"); p.add_argument("--name")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    config = load_runtime(args)
    try:
        if args.command == "preflight":
            output(do_preflight(args.bundle))
            return
        values = profile(config, getattr(args, "profile", "pro"))
        if args.command == "probe": result = do_probe(config, args.uuid, args.start)
        elif args.command == "upload": result = do_upload(config, args.uuid, values, args.bundle)
        elif args.command == "render": result = do_render(config, args.uuid, values, args.engine, args.out_dir, args.version, args.res)
        elif args.command == "fetch": result = do_fetch(config, args.uuid, values, args.remote, args.local)
        elif args.command == "cleanup": result = do_cleanup(config, args.uuid, args.release_after, args.confirm_release)
        else: result = run_workflow(config, values, args)
        output(result)
    except KeyboardInterrupt:
        fail("操作被中断；如已创建实例，请手动执行 cleanup", 130)
    except (WorkflowError, autodl_pro.ApiError, OSError, ValueError, TypeError) as exc:
        fail(exc)


if __name__ == "__main__":
    main()
