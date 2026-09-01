"""inspect_render.py — 渲染图自动质检（材质评审 spec）：像素采样/ΔE/A-B diff/故障指纹。
纯 PIL+numpy，不依赖 Blender；渲染后必跑，代替第一道人工读图（AI 无视觉时的数字眼睛）。

用法：
  # 区域采样 vs 预期色（可多组，ΔE76；超 --tol 退出码 1）
  python3 inspect_render.py --image out.png \
      --sample "960,540,120,80:#f7ff5ef" --sample "200,900,100,60:#c49a6c" --tol 18

  # A/B diff（默认全图，可 --region 限定；输出平均绝对差 per channel）
  python3 inspect_render.py --diff a.png b.png --region "0,540,1920,540"

  # 故障指纹自动检测（品红=HDRi截断 / 全黑=灯未挂 / 全白=过曝），--image 时始终运行

坐标为像素 (cx, cy, w, h) 左上角起点。ΔE76: <=10 肉眼可分辨但接近，<=18 同色系可接受（相对比较场景）。
"""
import argparse
import sys

import numpy as np
from PIL import Image


def _load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _rgb_to_lab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    """sRGB (0-255) -> CIELAB（D65）。"""
    lin = _srgb_to_linear(np.array(rgb, dtype=np.float64) / 255.0)
    mat = np.array([[0.4124564, 0.3575761, 0.1804375],
                    [0.2126729, 0.7151522, 0.0721750],
                    [0.0193339, 0.1191920, 0.9503041]])
    xyz = mat @ lin / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return (116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2]))


def delta_e76(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return float(np.sqrt(sum((x - y) ** 2 for x, y in zip(a, b))))


def region_mean(img: np.ndarray, region: tuple[int, int, int, int]) -> tuple[float, float, float]:
    cx, cy, w, h = region
    hh, ww = img.shape[:2]
    x0, y0 = max(0, min(cx, ww - 1)), max(0, min(cy, hh - 1))
    x1, y1 = max(x0 + 1, min(cx + w, ww)), max(y0 + 1, min(cy + h, hh))
    patch = img[y0:y1, x0:x1]
    m = patch.reshape(-1, 3).mean(axis=0)
    return (float(m[0]), float(m[1]), float(m[2]))


def check_fingerprints(img: np.ndarray, path: str) -> list[str]:
    """已知故障指纹：全品红（HDRi 截断）、全黑（灯未挂/世界黑）、全白（过曝/世界白）。"""
    issues = []
    m = img.reshape(-1, 3).mean(axis=0)
    frac = img.reshape(-1, 3)
    if abs(m[0] - 255) < 3 and abs(m[2] - 255) < 3 and m[1] < 200:
        # 品红：R/B 满 G 低（Blender 缺贴图占位色）
        pink = ((frac[:, 0] > 240) & (frac[:, 2] > 240) & (frac[:, 1] < 180)).mean()
        if pink > 0.5:
            issues.append(f'MAGENTA (missing-texture placeholder, fraction={pink:.2f}) — 贴图截断/缺失')
    if m.max() < 4.0:
        issues.append(f'ALL-BLACK (mean={m.tolist()}) — 灯未挂/世界过暗/渲染失败')
    if m.min() > 250.0:
        issues.append(f'ALL-WHITE (mean={m.tolist()}) — 过曝/世界过亮')
    return issues


def cmd_image(args) -> int:
    img = _load(args.image)
    issues = check_fingerprints(img, args.image)
    fail = bool(issues)
    for msg in issues:
        print(f'[FINGERPRINT] {args.image}: {msg}')
    for spec in args.sample or []:
        try:
            region_hex = spec.split(':')
            region = tuple(int(v) for v in region_hex[0].split(','))
            expect = _hex_rgb(region_hex[1])
        except Exception:
            print(f'[SAMPLE] SKIP 无法解析: {spec}')
            continue
        mean = region_mean(img, region)
        de = delta_e76(_rgb_to_lab(mean), _rgb_to_lab(expect))
        status = 'OK' if de <= args.tol else 'FAIL'
        if de > args.tol:
            fail = True
        print(f'[SAMPLE] {status} region={region} mean=({mean[0]:.0f},{mean[1]:.0f},{mean[2]:.0f}) '
              f'expect={expect} dE76={de:.1f} (tol={args.tol})')
    return 1 if fail else 0


def cmd_diff(args) -> int:
    a, b = _load(args.diff[0]), _load(args.diff[1])
    if a.shape != b.shape:
        print(f'[DIFF] FAIL 尺寸不一致: {a.shape} vs {b.shape}')
        return 1
    if args.region:
        cx, cy, w, h = (int(v) for v in args.region.split(','))
        hh, ww = a.shape[:2]
        a = a[max(0, cy):min(cy + h, hh), max(0, cx):min(cx + w, ww)]
        b = b[max(0, cy):min(cy + h, hh), max(0, cx):min(cx + w, ww)]
    d = np.abs(a - b)
    print(f'[DIFF] region={"full" if not args.region else args.region} '
          f'meanAbsDiff=({d[..., 0].mean():.1f},{d[..., 1].mean():.1f},{d[..., 2].mean():.1f}) '
          f'max={d.max():.0f} changedPixels(>10)={100 * (d.mean(axis=2) > 10).mean():.1f}%')
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--image', help='单图采样/指纹检查')
    ap.add_argument('--sample', action='append', help='"cx,cy,w,h:#rrggbb"（可多组）')
    ap.add_argument('--tol', type=float, default=18.0, help='ΔE76 阈值（默认 18）')
    ap.add_argument('--diff', nargs=2, metavar=('A', 'B'), help='两图 diff')
    ap.add_argument('--region', help='diff 限定区域 "cx,cy,w,h"')
    args = ap.parse_args()
    if args.image:
        sys.exit(cmd_image(args))
    if args.diff:
        sys.exit(cmd_diff(args))
    ap.print_help()


if __name__ == '__main__':
    main()
