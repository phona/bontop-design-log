#!/usr/bin/env python3
"""Capture a floor-plan screenshot from a running Chromium via CDP."""

import argparse
import base64
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
from websocket import create_connection

DEFAULT_RECV_TIMEOUT = 30.0
_check_id_counter = 0


def _next_check_id() -> int:
    global _check_id_counter
    _check_id_counter += 1
    return _check_id_counter


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Capture floor-plan screenshot via CDP')
    parser.add_argument('--cdp-host', default='localhost', help='Chromium CDP host')
    parser.add_argument('--cdp-port', type=int, default=9222, help='Chromium CDP port')
    parser.add_argument('--app-url', default='http://localhost:5173', help='App URL to find in CDP page list')
    parser.add_argument('--output', default=None, help='Output PNG path')
    return parser.parse_args(argv)


def build_cdp_url(host: str, port: int) -> str:
    return f'http://{host}:{port}/json'


def find_page_ws_url(cdp_url: str, app_url: str) -> str:
    try:
        resp = requests.get(cdp_url, timeout=10)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f'无法连接 CDP，请确认已启动 --remote-debugging-port: {e}')
    pages = resp.json()
    target = urlparse(app_url)
    for page in pages:
        if page.get('type') != 'page':
            continue
        page_url = page.get('url', '')
        if page_url == app_url or page_url.rstrip('/') == app_url.rstrip('/'):
            return page['webSocketDebuggerUrl']
    raise RuntimeError(f'未在 CDP 页面列表中找到 {app_url}，可用页面: {[p.get("url") for p in pages]}')


def _send_and_wait(ws, req_id: int, payload: dict, timeout: float = DEFAULT_RECV_TIMEOUT) -> dict:
    ws.send(json.dumps({**payload, 'id': req_id}))
    deadline = time.monotonic() + timeout if timeout else None
    while True:
        if deadline and time.monotonic() > deadline:
            raise TimeoutError(f'Timeout waiting for CDP response id={req_id}')
        raw = ws.recv()
        msg = json.loads(raw)
        if msg.get('id') == req_id:
            return msg


def _wait_for_load_event(ws, reload_id: int, timeout: float = DEFAULT_RECV_TIMEOUT) -> None:
    deadline = time.monotonic() + timeout if timeout else None
    while True:
        if deadline and time.monotonic() > deadline:
            raise TimeoutError('等待页面加载超时，请检查开发服务器是否可达')
        raw = ws.recv()
        msg = json.loads(raw)
        if msg.get('id') == reload_id:
            if 'error' in msg:
                raise RuntimeError(f"CDP Page.reload 失败: {msg['error']}")
            continue
        if 'error' in msg:
            raise RuntimeError(f"CDP 发生错误: {msg['error']}")
        if msg.get('method') == 'Page.loadEventFired':
            return


def _wait_for_app_ready(ws, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    check_id = _next_check_id()
    while time.monotonic() < deadline:
        msg = _send_and_wait(ws, check_id, {
            'method': 'Runtime.evaluate',
            'params': {
                'expression': 'window.__APP__ && window.__APP_READY__ && window.__APP__.isReady() && typeof window.__APP__.captureFloorPlan === "function"',
                'returnByValue': True,
            }
        }, timeout=min(5.0, deadline - time.monotonic()))
        if msg.get('result', {}).get('result', {}).get('value'):
            return
        time.sleep(0.1)
    raise TimeoutError('应用未在超时前就绪，请确认 window.__APP_READY__ 已完成且场景 ready')


def capture_floor_plan_screenshot(ws_url: str) -> str:
    ws = create_connection(ws_url, timeout=30)
    try:
        _send_and_wait(ws, 1, {'method': 'Page.enable'})
        _send_and_wait(ws, 2, {
            'method': 'Page.reload',
            'params': {'ignoreCache': True}
        })

        _wait_for_load_event(ws, 2)
        _wait_for_app_ready(ws)

        msg = _send_and_wait(ws, 3, {
            'method': 'Runtime.evaluate',
            'params': {
                'expression': "window.__APP__.captureFloorPlan().then(dataUrl => ({dataUrl}))",
                'awaitPromise': True,
                'returnByValue': True,
            }
        })
        result = msg.get('result', {}).get('result', {})
        if result.get('value'):
            return result['value']['dataUrl']
        raise RuntimeError(f'CDP 执行失败: {result}')
    finally:
        ws.close()


def save_data_url(data_url: str, output_path: str) -> Path:
    if not data_url.startswith('data:image/png;base64,'):
        raise ValueError('应为 PNG base64 data URL')
    b64 = data_url.split(',', 1)[1]
    png_bytes = base64.b64decode(b64)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png_bytes)
    return out


def main(argv=None):
    args = parse_args(argv)
    if not args.output:
        print('错误：必须指定 --output', file=sys.stderr)
        return 2
    cdp_url = build_cdp_url(args.cdp_host, args.cdp_port)
    ws_url = find_page_ws_url(cdp_url, args.app_url)
    data_url = capture_floor_plan_screenshot(ws_url)
    out = save_data_url(data_url, args.output)
    print(out.resolve())
    return 0


if __name__ == '__main__':
    sys.exit(main())
