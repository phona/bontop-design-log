#!/usr/bin/env python3
"""DEC-2026-10-07-R03 客餐厅三层线视角证据截图（CDP）。
前置：PATH=$PWD/node_modules/.bin bash scripts/dev.sh（源码 dev，server :4000 / vite :5175）+
chromium --headless=new --remote-debugging-port=9222 --remote-allow-origins=* --enable-unsafe-swiftshader http://localhost:5175
用法：.venv/bin/python scripts/render/capture/capture_hvac_ld_threeline_views.py
说明：轨道模式默认极角钳位会把低机位相机推高，脚本在页面内放开 controls.maxPolarAngle 后按人视高度截图。
"""
import base64
import json
import sys
import time
from pathlib import Path

import requests
from websocket import create_connection

CDP = 'http://localhost:9222/json'
APP_URL = 'http://localhost:5175'
OUT = Path(__file__).resolve().parents[2] / 'docs/design-iterations/hvac-dual-outlet-threeline-20261007/evidence'
OUT.mkdir(parents=True, exist_ok=True)

# name, camera pos, controls target, note
VIEWS = [
    ('view1-living-band-main', (9.9, 1.60, 7.70), (10.4, 2.42, 5.00), '客餐厅主效果图：客厅侧看向设备带（南→北）'),
    ('view2-from-living-to-dining', (12.9, 1.58, 7.20), (7.8, 2.25, 3.40), '从客厅看餐厅（越过设备带北缘看餐区/餐桌）'),
    ('view3-from-dining-to-living', (7.9, 1.52, 3.60), (12.9, 2.42, 5.60), '从餐厅看客厅（餐桌位看向客厅侧与设备带）'),
    ('view4-band-closeup', (9.50, 1.42, 6.50), (10.2, 2.50, 4.90), '设备带近景（仰视：底面前侧下出风 + 后侧回风两条线）'),
    ('view4b-band-underside', (10.30, 1.30, 7.55), (10.15, 2.56, 5.15), '设备带底面仰视候选（客厅侧低于边吊看向底面两层线）'),
    ('view4c-band-underside-dining', (8.05, 1.30, 3.75), (9.00, 2.56, 4.55), '设备带底面仰视候选（餐厅侧低于边吊看向底面两层线）'),
]


def ws_url():
    pages = requests.get(CDP, timeout=10).json()
    for page in pages:
        if page.get('type') == 'page' and APP_URL in page.get('url', ''):
            return page['webSocketDebuggerUrl']
    raise RuntimeError(f'no CDP page for {APP_URL}; pages={[p.get("url") for p in pages]}')


class Cdp:
    def __init__(self, ws_url):
        self.ws = create_connection(ws_url, timeout=60)
        self.next_id = 1

    def send(self, method, params=None):
        rid = self.next_id
        self.next_id += 1
        self.ws.send(json.dumps({'id': rid, 'method': method, 'params': params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == rid:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg['result']

    def evaluate(self, expression, await_promise=False, timeout=60):
        result = self.send('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': await_promise})
        value = result.get('result', {})
        if value.get('exceptionDetails'):
            raise RuntimeError(f'evaluate failed: {value["exceptionDetails"]}')
        return value.get('value')

    def close(self):
        self.ws.close()


def wait_ready(cdp, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            ready = cdp.evaluate('window.__APP__ && window.__APP__.isReady && window.__APP__.isReady()')
            if ready:
                return True
        except Exception:
            pass
        time.sleep(1)
    raise TimeoutError('app not ready')


def prepare_mode(cdp):
    # setMode 会触发相机动画归位，必须先切模式并等动画结束再设置相机
    # 放开轨道相机的极角限制，否则仰视（相机低于设备带）会被 controls 钳位推回高处
    cdp.evaluate('(() => { const hs = window.__APP__.houseScene; hs.setMode("orbit"); hs.setCeilingVisible(true); hs.controls.maxPolarAngle = Math.PI * 0.99; hs.controls.minPolarAngle = 0.02; hs.requestRender(); return 1; })()')
    time.sleep(1.8)


def set_camera(cdp, pos, target):
    js = (
        '(() => {'
        '  const hs = window.__APP__.houseScene;'
        '  hs.camera.position.set(%f, %f, %f);'
        '  hs.controls.target.set(%f, %f, %f);'
        '  hs.controls.update();'
        '  hs.requestRender();'
        '  return JSON.stringify(hs.getCameraState());'
        '})()' % (*pos, *target)
    )
    return cdp.evaluate(js)


def main():
    cdp = Cdp(ws_url())
    try:
        cdp.send('Page.enable')
        wait_ready(cdp)
        for name, pos, target, note in VIEWS:
            prepare_mode(cdp)
            state = set_camera(cdp, pos, target)
            time.sleep(1.2)
            shot = cdp.send('Page.captureScreenshot', {'format': 'png', 'captureBeyondViewport': False})
            path = OUT / f'{name}.png'
            path.write_bytes(base64.b64decode(shot['data']))
            print(f'saved {path}  ({note})')
            print(f'  camera={state}')
    finally:
        cdp.close()


if __name__ == '__main__':
    main()
