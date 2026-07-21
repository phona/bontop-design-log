import yaml
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib import font_manager as fm
from pathlib import Path

fm.fontManager.addfont('/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc')
prop = fm.FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc')
plt.rcParams['axes.unicode_minus'] = False

ROOT = Path(__file__).resolve().parent.parent
with open(ROOT / 'config/layout/model-geometry.yaml', 'r', encoding='utf-8') as f:
    cfg = yaml.safe_load(f)

fig, ax = plt.subplots(figsize=(14, 10))
ax.set_aspect('equal')

colors = {
    'master_bedroom': '#e8d5c4',
    'master_bath': '#c4d7e8',
    'bedroom_nw': '#d5e8c4',
    'study': '#e8e0c4',
    'bedroom_se': '#d5c4e8',
    'living_dining': '#f5efe6',
    'kitchen': '#c4e8d7',
    'guest_bath': '#c4d7e8',
    'balcony': '#e8d4c4',
    'entry_garden': '#e8e8c4',
    'west_platform': '#d0d0d0',
}

def rect_bounds(x, z, w, d):
    return (x - w / 2, z - d / 2, w, d)

for r in cfg['rooms']:
    bx, bz, w, d = rect_bounds(r['x'], r['z'], r['width'], r['depth'])
    rect = patches.Rectangle((bx, bz), w, d, linewidth=1, edgecolor='#333',
                             facecolor=colors.get(r['id'], '#f0f0f0'), alpha=0.7)
    ax.add_patch(rect)
    ax.text(r['x'], r['z'], r['name'], ha='center', va='center', fontsize=8, fontproperties=prop)

p = cfg['platform']
bx, bz, w, d = rect_bounds(p['x'], p['z'], p['width'], p['depth'])
rect = patches.Rectangle((bx, bz), w, d, linewidth=1.5, edgecolor='#a00',
                         facecolor=colors.get(p['id'], '#d0d0d0'), alpha=0.9, hatch='//')
ax.add_patch(rect)
ax.text(p['x'], p['z'], p['name'], ha='center', va='center', fontsize=8, color='#a00', fontproperties=prop)

for w in cfg['walls']:
    ax.plot([w['x1'], w['x2']], [w['z1'], w['z2']], 'k-', linewidth=1.2)

# 坐标系说明：+z 向南，-z 向北
ax.annotate('北', xy=(0.05, 0.95), xycoords='axes fraction', fontsize=14, fontweight='bold', fontproperties=prop)
ax.set_xlabel('x (m) — +x 东', fontproperties=prop)
ax.set_ylabel('z (m) — +z 南', fontproperties=prop)
ax.set_title('701 户型俯视验证图（基于 model-geometry.yaml）', fontproperties=prop)
ax.invert_yaxis()

plt.tight_layout()
plt.savefig(ROOT / 'tmp/topdown-verification.png', dpi=150)
print('saved topdown-verification.png')
