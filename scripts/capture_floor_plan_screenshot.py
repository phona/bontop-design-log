#!/usr/bin/env python3
"""Capture a floor-plan screenshot from a running Chromium via CDP."""

import argparse
import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests
from websocket import create_connection


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
    resp = requests.get(cdp_url, timeout=10)
    resp.raise_for_status()
    pages = resp.json()
    target = urlparse(app_url)
    for page in pages:
        if page.get('type') != 'page':
            continue
        page_url = page.get('url', '')
        if page_url == app_url or page_url.rstrip('/') == app_url.rstrip('/'):
            return page['webSocketDebuggerUrl']
    raise RuntimeError(f'No CDP page found for {app_url}. Available pages: {[p.get("url") for p in pages]}')


def capture_floor_plan_screenshot(ws_url: str) -> str:
    ws = create_connection(ws_url, timeout=30)
    try:
        # Evaluate the app method and return the base64 PNG.
        expr = "window.__app.captureFloorPlan().then(dataUrl => ({dataUrl}))"
        ws.send(json.dumps({
            'id': 1,
            'method': 'Runtime.evaluate',
            'params': {
                'expression': expr,
                'awaitPromise': True,
                'returnByValue': True,
            }
        }))
        while True:
            raw = ws.recv()
            msg = json.loads(raw)
            if msg.get('id') == 1:
                result = msg.get('result', {}).get('result', {})
                if result.get('value'):
                    return result['value']['dataUrl']
                raise RuntimeError(f'CDP evaluation failed: {result}')
    finally:
        ws.close()


def save_data_url(data_url: str, output_path: str) -> Path:
    if not data_url.startswith('data:image/png;base64,'):
        raise ValueError('Expected PNG base64 data URL')
    b64 = data_url.split(',', 1)[1]
    png_bytes = base64.b64decode(b64)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png_bytes)
    return out


def main(argv=None):
    args = parse_args(argv)
    if not args.output:
        print('error: --output is required', file=sys.stderr)
        return 2
    cdp_url = build_cdp_url(args.cdp_host, args.cdp_port)
    ws_url = find_page_ws_url(cdp_url, args.app_url)
    data_url = capture_floor_plan_screenshot(ws_url)
    out = save_data_url(data_url, args.output)
    print(out.resolve())
    return 0


if __name__ == '__main__':
    sys.exit(main())
