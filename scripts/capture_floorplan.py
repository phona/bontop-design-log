#!/usr/bin/env python3
"""通过 agent-browser 抓取户型 floor plan 截图。

依赖：agent-browser CLI（浏览器由它负责拉起，WSL 下自动走 Windows Chrome）。
契约：app 暴露 window.__APP__.isReady() 和 window.__APP__.captureFloorPlan()。

用法：
  python3 scripts/capture_floorplan.py out.png                 # 当前 dev 栈 (5173)
  python3 scripts/capture_floorplan.py head.png --url http://localhost:5174
  python3 scripts/capture_floorplan.py cur.png --baseline head.png   # 附带像素 diff
"""
import argparse, base64, json, socket, subprocess, sys, time
from pathlib import Path


def sh(*args: str) -> str:
    r = subprocess.run(['agent-browser', *args], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(f"agent-browser {' '.join(args)} 失败: {r.stderr.strip()}")
    return r.stdout.strip()


def eval_js(expr: str):
    out = sh('eval', expr)
    line = out.splitlines()[-1] if out else ''
    return json.loads(line)


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def wait_ready(timeout: float = 90.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if eval_js('!!(window.__APP__ && window.__APP__.isReady && window.__APP__.isReady())'):
                return
        except Exception:
            pass
        time.sleep(2)
    raise TimeoutError('应用未就绪（isReady 超时）。注意：改代码后页面需带 ?fresh= 参数防缓存旧 bundle')


def save_png(data_url: str, path: Path) -> None:
    assert data_url.startswith('data:image/png;base64,'), 'captureFloorPlan 应返回 PNG data URL'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64decode(data_url.split(',', 1)[1]))


def diff_baseline(a: Path, b: Path, out: Path) -> None:
    from PIL import Image, ImageChops
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        print(f'警告：尺寸不一致 {ia.size} vs {ib.size}（topDownLayoutBounds 可能变了），跳过 diff')
        return
    import numpy as np
    d = np.asarray(ImageChops.difference(ia, ib)).sum(axis=2)
    ratio = float((d > 60).mean())
    Image.fromarray((d / d.max() * 255).astype('uint8') if d.max() else d.astype('uint8')).save(out)
    print(f'diff 像素占比: {ratio:.1%}，可视化: {out}')


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('output', type=Path)
    p.add_argument('--url', default='http://localhost:5173')
    p.add_argument('--viewport-shot', type=Path, default=None, help='顺手存一张 3D 视角截图')
    p.add_argument('--baseline', type=Path, default=None)
    args = p.parse_args()

    port = int(args.url.rsplit(':', 1)[1])
    if not port_open(port) or not port_open(4000 if port == 5173 else 4001):
        print(f'错误：dev 栈未就绪（{args.url} 或对应 API 端口不可达）', file=sys.stderr)
        return 2

    sh('open', f'{args.url}/?fresh={int(time.time())}')   # cache-bust，防旧 bundle
    wait_ready()
    save_png(eval_js('window.__APP__.captureFloorPlan()'), args.output)
    print(f'floor plan: {args.output.resolve()}')

    if args.viewport_shot:
        sh('set', 'viewport', '1600', '1000')
        sh('screenshot', str(args.viewport_shot))
        print(f'viewport: {args.viewport_shot.resolve()}')
    if args.baseline:
        diff_baseline(args.baseline, args.output, args.output.with_suffix('.diff.png'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
