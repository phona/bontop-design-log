#!/usr/bin/env python3
"""Export the current Web scene as a GLB through Chromium CDP."""

import argparse
import base64
import binascii
import sys
import time
from pathlib import Path

from capture_floor_plan_screenshot import (
    _next_check_id,
    _send_and_wait,
    _wait_for_load_event,
    build_cdp_url,
    find_page_ws_url,
)
from websocket import create_connection

DATA_URL_PREFIX = 'data:model/gltf-binary;base64,'


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Export Web scene GLB via CDP')
    parser.add_argument('--output', required=True, help='Output GLB path')
    parser.add_argument('--cdp-host', default='localhost', help='Chromium CDP host')
    parser.add_argument('--cdp-port', default=9222, type=int, help='Chromium CDP port')
    parser.add_argument('--app-url', default='http://localhost:5173', help='App URL to find in CDP page list')
    parser.add_argument('--timeout-seconds', default=120.0, type=float, help='Overall readiness/export timeout')
    return parser.parse_args(argv)


def _result_value(message: dict):
    result = message.get('result', {})
    if result.get('exceptionDetails'):
        raise RuntimeError(f'CDP JavaScript 执行失败: {result["exceptionDetails"]}')
    remote = result.get('result', {})
    if 'value' not in remote:
        raise RuntimeError(f'CDP JavaScript 未返回可序列化值: {remote}')
    return remote['value']


def wait_for_exporter_ready(ws, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        response = _send_and_wait(ws, _next_check_id(), {
            'method': 'Runtime.evaluate',
            'params': {
                'expression': '''(() => { const root = window.__APP__?.houseScene?.scene; if (!root || typeof window.__APP__.exportGlbDataUrl !== "function") return false; const exportTypes = new Set(["floor", "ceiling", "ceiling_zone", "ceiling_zone_solid", "wall", "curtain_run", "curtain", "glass_infill", "shower_screen", "bay_sill", "railing_run", "sliding_door_run", "sliding_door", "door", "floor_region", "furniture"]); let ready = false; root.traverse((object) => { const type = object.userData?.type; if (exportTypes.has(type) && object.userData?.objectId && (object.isMesh || object.children.some((child) => child.isMesh))) ready = true; }); return ready; })()''',
                'returnByValue': True,
            },
        }, timeout=min(5.0, max(0.001, remaining)))
        if _result_value(response) is True:
            return
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    raise TimeoutError('应用未在超时前就绪，请确认 window.__APP__.exportGlbDataUrl 已暴露且 Web 场景已构建')


def decode_glb_data_url(data_url: object) -> bytes:
    if not isinstance(data_url, str) or not data_url.startswith(DATA_URL_PREFIX):
        raise ValueError('应为 data:model/gltf-binary;base64, GLB data URL')
    encoded = data_url[len(DATA_URL_PREFIX):]
    if not encoded:
        raise ValueError('GLB data URL 为空')
    try:
        result = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f'GLB data URL 的 base64 无效: {error}') from error
    if not result:
        raise ValueError('GLB 解码结果为空')
    return result


def save_glb_data_url(data_url: object, output_path: str) -> Path:
    payload = decode_glb_data_url(data_url)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    if output.stat().st_size == 0:
        raise RuntimeError(f'GLB 写入为空: {output}')
    return output


def export_web_glb(ws_url: str, timeout: float) -> str:
    ws = create_connection(ws_url, timeout=min(timeout, 30.0))
    try:
        _send_and_wait(ws, _next_check_id(), {'method': 'Page.enable'}, timeout=timeout)
        reload_id = _next_check_id()
        _send_and_wait(ws, reload_id, {
            'method': 'Page.reload',
            'params': {'ignoreCache': True},
        }, timeout=timeout)
        _wait_for_load_event(ws, reload_id, timeout=timeout)
        wait_for_exporter_ready(ws, timeout)
        response = _send_and_wait(ws, _next_check_id(), {
            'method': 'Runtime.evaluate',
            'params': {
                'expression': 'window.__APP__.exportGlbDataUrl().then(dataUrl => ({dataUrl}))',
                'awaitPromise': True,
                'returnByValue': True,
            },
        }, timeout=timeout)
        value = _result_value(response)
        if not isinstance(value, dict) or 'dataUrl' not in value:
            raise RuntimeError(f'CDP GLB 导出未返回 dataUrl: {value}')
        return value['dataUrl']
    finally:
        ws.close()


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.timeout_seconds <= 0:
        print('错误：--timeout-seconds 必须大于 0', file=sys.stderr)
        return 2
    try:
        ws_url = find_page_ws_url(build_cdp_url(args.cdp_host, args.cdp_port), args.app_url)
        data_url = export_web_glb(ws_url, args.timeout_seconds)
        output = save_glb_data_url(data_url, args.output)
    except (RuntimeError, TimeoutError, ValueError) as error:
        print(f'导出 Web GLB 失败: {error}', file=sys.stderr)
        return 1
    print(output.resolve())
    return 0


if __name__ == '__main__':
    sys.exit(main())
