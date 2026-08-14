"""wood_texture.py — three.js TextureFactory.drawWoodPlankTextures 的 Python 移植。

纯程序化（无 bpy 依赖）：从 materials.yaml 的 appearance 生成 wood_plank 三通道贴图
（diffuse / roughness / normal），供 Blender 材质加载。随机序列与 three.js 完全一致
（mulberry32 逐位复刻），同 seed 同图，A/B 可复现。

用法（系统 python 自测）：
  python3 wood_texture.py --color '#c49a6c' --pattern straight --plank 800 800 --seed 42 --out-dir /tmp/woodtest
"""
import argparse
import math
import os

import numpy as np
from PIL import Image, ImageDraw

PLANK_CANVAS = 2048  # 画布边长（px）：1024 时人字拼单板宽仅 ~30px 糊；2048 决策可辨（cache key 含尺寸）


def mulberry32(seed: int):
    """three.js seeded-rng.ts 的逐位复刻（32 位整数运算）。"""
    state = [seed & 0xFFFFFFFF]

    def rng() -> float:
        a = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = a
        t = a
        t = ((t ^ (t >> 15)) * (1 | t)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF) ^ t
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def _gcd(a: int, b: int) -> int:
    return a if b == 0 else _gcd(b, a % b)


def _c255(v: float) -> int:
    return max(0, min(255, round(v)))


def _parse_hex(color: str) -> tuple[int, int, int]:
    h = color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rot(px: float, py: float, cx: float, cy: float, ang: float) -> tuple[float, float]:
    """canvas translate(cx,cy)+rotate(ang) 语义：板内局部坐标 (px,py) 先旋转再平移到世界。"""
    ca, sa = math.cos(ang), math.sin(ang)
    return cx + px * ca - py * sa, cy + px * sa + py * ca


def _rect_pts(cx, cy, x0, y0, x1, y1, ang):
    return [_rot(x0, y0, cx, cy, ang), _rot(x1, y0, cx, cy, ang),
            _rot(x1, y1, cx, cy, ang), _rot(x0, y1, cx, cy, ang)]


def generate_wood_plank(appearance: dict, canvas: int = PLANK_CANVAS) -> tuple[Image.Image, Image.Image, Image.Image, float]:
    """返回 (diffuse, normal, roughness, worldSize_S米)。逻辑逐行对照 TextureFactory.ts。"""
    seed = appearance.get('seed', 42)
    rng = mulberry32(seed)
    dims = appearance.get('plank_mm', [150, 900])
    wmm, lmm = int(dims[0]), int(dims[1])
    pattern = 'herringbone' if appearance.get('pattern') == 'herringbone' else 'straight'
    br, bg, bb = _parse_hex(appearance.get('color', '#c49a6c'))
    grout = (_c255(br * 0.88), _c255(bg * 0.88), _c255(bb * 0.88))
    base_rough = 0.5 if appearance.get('finish') == 'soft' else 0.85

    FACE_COUNT = 8
    face_rng = mulberry32((seed ^ 0x9E37) & 0xFFFFFFFF)
    faces = [dict(dl=(face_rng() - 0.5) * 28, warm=(face_rng() - 0.5) * 10,
                  grain=0.1 + face_rng() * 0.12) for _ in range(FACE_COUNT)]

    if pattern == 'herringbone':
        g = _gcd(wmm, lmm + wmm)
        m = (lmm + wmm) // g
        smm = (m * (lmm + wmm)) / math.sqrt(2)
    else:
        smm = lmm * math.ceil(4000 / lmm)
        while smm % wmm != 0 or (smm // wmm) % 2 != 0:
            smm += lmm
    S = smm / 1000.0
    ppm = canvas / S
    pl = lmm / 1000 * ppm
    pw = wmm / 1000 * ppm
    g2 = max(0.75, (2 / 1000 * ppm) / 2)

    diffuse = Image.new('RGB', (canvas, canvas), grout)
    height = Image.new('RGB', (canvas, canvas), (0x7C, 0x7C, 0x7C))
    gr = _c255(min(1.0, base_rough + 0.15) * 255)
    rough = Image.new('RGB', (canvas, canvas), (gr, gr, gr))
    dd, hd, rd = ImageDraw.Draw(diffuse), ImageDraw.Draw(height), ImageDraw.Draw(rough)

    def draw_plank(cx: float, cy: float, angle: float) -> None:
        face = faces[int(rng() * FACE_COUNT)]
        dl = face['dl'] + (rng() - 0.5) * 8
        warm = face['warm'] + (rng() - 0.5) * 3
        rr = _c255(br + dl + warm)
        gg = _c255(bg + dl)
        b2 = _c255(bb + dl - warm)
        rv = _c255(min(1.0, max(0.05, base_rough + (rng() - 0.5) * 0.16)) * 255)

        ix, iy = -pl / 2 + g2, -pw / 2 + g2
        iw, ih = pl - 2 * g2, pw - 2 * g2

        dd.polygon(_rect_pts(cx, cy, ix, iy, ix + iw, iy + ih, angle), fill=(rr, gg, b2))

        # 板缘 AO：canvas rgba(c*0.55, 0.65) 叠于板色 → c*0.7075
        ao = (_c255(rr * 0.7075), _c255(gg * 0.7075), _c255(b2 * 0.7075))
        dd.line(_rect_pts(cx, cy, ix, iy, ix + iw, iy + ih, angle) +
                [_rect_pts(cx, cy, ix, iy, ix + iw, iy + ih, angle)[0]],
                fill=ao, width=max(2, int(g2 * 0.8)), joint='curve')

        # 板内木纹带：canvas stroke c*f alpha a → 近似 c*(1-a+f*a)
        bands = min(24, max(5, round(ih / 12) + int(rng() * 3)))
        for b in range(bands):
            by = iy + ((b + 0.15 + rng() * 0.7) / bands) * ih
            amp = ih * (0.04 + rng() * 0.08)
            phase = rng() * math.pi * 2
            freq = 1 + rng() * 0.2
            f = 0.62 if rng() < 0.75 else 1.18
            a = face['grain'] * (0.6 + rng() * 0.8)
            a = min(1.0, a)
            gc = (_c255(rr * (1 - a + f * a)), _c255(gg * (1 - a + f * a)),
                  _c255(b2 * (1 - a + f * a)))
            pts = []
            for s in range(9):
                gx = ix + iw * s / 8
                gy = by + math.sin(phase + (s / 8) * math.pi * 2 * freq) * amp
                pts.append(_rot(gx, gy, cx, cy, angle))
            dd.line(pts, fill=gc, width=max(1, int(0.5 + rng() * 1.8)), joint='curve')

        # 偶发木节（仅长条板）
        if pl > pw * 2 and rng() < 0.08:
            kx = ix + iw * (0.2 + rng() * 0.6)
            ky = iy + ih * (0.3 + rng() * 0.4)
            kc = (_c255(rr * 0.825), _c255(gg * 0.825), _c255(b2 * 0.825))
            for ring in range(2):
                rad = 1.5 + ring * 1.5
                pts = []
                for s2 in range(9):
                    ang2 = s2 / 8 * math.pi * 2
                    pts.append(_rot(kx + math.cos(ang2) * rad * 2.2,
                                    ky + math.sin(ang2) * rad * 0.9, cx, cy, angle))
                dd.line(pts, fill=kc, width=1, joint='curve')

        # V 型倒角高度图：#8a → #90 → #96 三阶
        b1 = min(2.0, iw / 6, ih / 6)
        for k, col in ((0, 0x8A), (1, 0x90), (2, 0x96)):
            hd.polygon(_rect_pts(cx, cy, ix + k * b1, iy + k * b1,
                                 ix + iw - k * b1, iy + ih - k * b1, angle),
                       fill=(col, col, col))

        rd.polygon(_rect_pts(cx, cy, ix, iy, ix + iw, iy + ih, angle), fill=(rv, rv, rv))

    if pattern == 'herringbone':
        d = (pl + pw) / math.sqrt(2)
        row_shift = pw / math.sqrt(2)
        j = -2
        while j * d < canvas + 2 * d:
            y = j * d
            ox = ((j * row_shift) % d + d) % d
            k = -2
            while k * d + ox < canvas + 2 * d:
                angle = math.pi / 4 if ((k % 2) + 2) % 2 == 0 else -math.pi / 4
                draw_plank(k * d + ox, y, angle)
                k += 1
            j += 1
    else:
        j = -1
        while j * pw < canvas + pw:
            y = j * pw + pw / 2
            off = (((j % 2) + 2) % 2) * (pl / 2)
            k = -2
            while k * pl + off - pl / 2 < canvas + pl:
                draw_plank(k * pl + off, y, 0)
                k += 1
            j += 1

    normal = _sobel_normal(height, strength=3.0)
    return diffuse, normal, rough, S


def _sobel_normal(height: Image.Image, strength: float) -> Image.Image:
    """TextureFactory.computeNormalMap 移植：Sobel 高度图→法线图。"""
    h = np.asarray(height.convert('L'), dtype=np.float32)
    dx = (np.roll(h, -1, axis=1) + 2 * h + np.roll(h, 1, axis=1)) - \
         (np.roll(h, (1, -1), (0, 1)) + 2 * np.roll(h, 1, axis=0) + np.roll(h, (1, 1), (0, 1)))
    # 标准 Sobel（与 three.js 同式）
    tl = np.roll(h, (1, 1), (0, 1)); t = np.roll(h, 1, axis=0); tr = np.roll(h, (1, -1), (0, 1))
    l = np.roll(h, 1, axis=1); r = np.roll(h, -1, axis=1)
    bl = np.roll(h, (-1, 1), (0, 1)); b = np.roll(h, -1, axis=0); br = np.roll(h, (-1, -1), (0, 1))
    dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
    dy = (bl + 2 * b + br) - (tl + 2 * t + tr)
    dz = np.full_like(h, 255.0 / strength)
    ln = np.sqrt(dx * dx + dy * dy + dz * dz)
    out = np.stack([(dx / ln) * 0.5 + 0.5, (dy / ln) * 0.5 + 0.5, (dz / ln) * 0.5 + 0.5], axis=-1)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGB')


def ensure_wood_textures(material_id: str, appearance: dict, cache_dir: str,
                         canvas: int = PLANK_CANVAS) -> tuple[str, str, str, float]:
    """生成（或复用缓存）木纹贴图 PNG，返回 (diffuse, normal, rough, worldSize)。缓存 key 含画布尺寸。"""
    key = f"{material_id}_{appearance.get('pattern', 'straight')}_{appearance.get('seed', 42)}_{canvas}"
    os.makedirs(cache_dir, exist_ok=True)
    d = os.path.join(cache_dir, f'{key}_diffuse.png')
    n = os.path.join(cache_dir, f'{key}_normal.png')
    r = os.path.join(cache_dir, f'{key}_rough.png')
    if not (os.path.exists(d) and os.path.exists(n) and os.path.exists(r)):
        diffuse, normal, rough, S = generate_wood_plank(appearance, canvas=canvas)
        diffuse.save(d); normal.save(n); rough.save(r)
    else:
        S = _world_size(appearance)
    return d, n, r, S


def _world_size(appearance: dict) -> float:
    dims = appearance.get('plank_mm', [150, 900])
    wmm, lmm = int(dims[0]), int(dims[1])
    if appearance.get('pattern') == 'herringbone':
        g = _gcd(wmm, lmm + wmm)
        return ((lmm + wmm) // g) * (lmm + wmm) / math.sqrt(2) / 1000.0
    smm = lmm * math.ceil(4000 / lmm)
    while smm % wmm != 0 or (smm // wmm) % 2 != 0:
        smm += lmm
    return smm / 1000.0


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--color', default='#c49a6c')
    ap.add_argument('--pattern', default='straight')
    ap.add_argument('--plank', type=int, nargs=2, default=[800, 800])
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--out-dir', required=True)
    args = ap.parse_args()
    app = {'type': 'wood_plank', 'color': args.color, 'pattern': args.pattern,
           'plank_mm': args.plank, 'finish': 'soft', 'seed': args.seed}
    d, n, r, S = ensure_wood_textures('test', app, args.out_dir)
    print(f'generated worldSize={S}m -> {d}')
