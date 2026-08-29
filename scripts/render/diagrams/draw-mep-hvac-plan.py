#!/usr/bin/env python3
"""Draw a preliminary MEP + central HVAC coordination plan from authoritative YAML."""
from pathlib import Path
import math
import yaml
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.lines import Line2D
from matplotlib import font_manager as fm

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'renders' / 'mep'
OUT.mkdir(parents=True, exist_ok=True)
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
PROP = fm.FontProperties(fname=FONT) if Path(FONT).exists() else None
plt.rcParams['axes.unicode_minus'] = False

def load(relative):
    with open(ROOT / relative, encoding='utf-8') as handle:
        return yaml.safe_load(handle)

def text(ax, *args, **kwargs):
    if PROP:
        kwargs.setdefault('fontproperties', PROP)
    return ax.text(*args, **kwargs)

def load_sources():
    geometry = load('config/layout/model-geometry.yaml')
    electrical = load('config/electrical.yaml')
    plumbing = load('config/plumbing.yaml')
    hvac = load('config/hvac.yaml')['plans'][0]
    ceiling = load('config/ceiling.yaml')
    coordination = load('config/mep-hvac-coordination.yaml')
    vertices = {item['id']: (item['x'], item['z']) for item in geometry['vertices']}
    points = {}
    for item in electrical + plumbing:
        points[item['id']] = (item['x'], item['z'])
    for item in ceiling:
        if item.get('x') is not None and item.get('z') is not None:
            points[item['id']] = (item['x'], item['z'])
    diagram = hvac['diagram']
    for item in diagram['anchors']:
        if 'position' in item:
            points[item['id']] = (item['position']['x'], item['position']['z'])
        elif item.get('ref', {}).get('source') == 'ceiling':
            source = points.get(item['ref']['id'])
            if source: points[item['id']] = source
        elif item.get('ref', {}).get('source') == 'outdoor':
            points[item['id']] = (hvac['outdoor']['x'], hvac['outdoor']['z'])
    for item in diagram['terminals']:
        points[item['id']] = (item['position']['x'], item['position']['z'])
    return geometry, electrical, plumbing, hvac, coordination, vertices, points

def endpoint(value, points):
    if isinstance(value, dict):
        return value['x'], value['z']
    return points.get(value)

def main():
    geometry, electrical, plumbing, hvac, coordination, vertices, points = load_sources()
    fig, ax = plt.subplots(figsize=(17, 12), dpi=160)
    ax.set_aspect('equal')
    room_colors = {'private': '#f3e8d8', 'public': '#f7f1e5', 'service': '#dcecf0'}
    room_by_id = {room['id']: room for room in geometry['rooms']}
    for room in geometry['rooms']:
        polygon = [vertices[item] for item in room['boundary']]
        ax.add_patch(patches.Polygon(polygon, closed=True, facecolor=room_colors.get(room.get('type'), '#eeeeee'), edgecolor='#9ca3af', linewidth=0.7, alpha=0.72, zorder=1))
        cx = sum(p[0] for p in polygon) / len(polygon)
        cz = sum(p[1] for p in polygon) / len(polygon)
        text(ax, cx, cz, room['name'], ha='center', va='center', fontsize=8, color='#334155', zorder=2)
    platform = geometry['platform']
    platform_poly = [vertices[item] for item in platform['boundary']]
    ax.add_patch(patches.Polygon(platform_poly, closed=True, facecolor='#d1d5db', edgecolor='#475569', hatch='//', alpha=0.8, zorder=2))
    text(ax, sum(p[0] for p in platform_poly)/len(platform_poly), sum(p[1] for p in platform_poly)/len(platform_poly), platform['name'], ha='center', va='center', fontsize=7, color='#7f1d1d', zorder=3)
    for wall in geometry['walls']:
        a, b = vertices[wall['from']], vertices[wall['to']]
        ax.plot([a[0], b[0]], [a[1], b[1]], color='#334155', linewidth=1.35, zorder=3)
    layers = coordination['layers']
    offsets = {'strong_power': 0.00, 'weak_power': 0.035, 'water_supply': 0.00, 'drainage': 0.035, 'refrigerant': 0.00, 'condensate': 0.035, 'supply_air': 0.00, 'return_air': 0.035}
    for route in coordination['routes']:
        a, b = endpoint(route['from'], points), endpoint(route['to'], points)
        if not a or not b:
            print(f"warning: unresolved route {route['id']}")
            continue
        path = [a] + [(p['x'], p['z']) for p in route.get('via', [])] + [b]
        color = layers[route['layer']]['color']
        linestyle = '-' if route['status'] == 'confirmed' else '--'
        width = 1.7 if route['status'] == 'confirmed' else 1.25
        for index in range(len(path) - 1):
            x1, z1 = path[index]; x2, z2 = path[index + 1]
            ax.plot([x1, x2], [z1 + offsets.get(route['layer'], 0), z2 + offsets.get(route['layer'], 0)], color=color, linestyle=linestyle, linewidth=width, alpha=0.88, zorder=7)
        text(ax, path[len(path)//2][0], path[len(path)//2][1], route['id'], fontsize=4.8, color=color, rotation=0, ha='center', va='bottom', zorder=8, bbox={'facecolor': 'white', 'alpha': 0.55, 'edgecolor': 'none', 'pad': 0.8})
    electrical_markers = {'socket': 'o', 'switch': 's', 'switch_2way': 's', 'network': 'D', 'floor_socket': 'P', 'strong_panel': 'H', 'weak_panel': 'X', 'pendant': '*', 'dome': '*', 'wall_lamp': '*', 'downlight': '*', 'led_strip': '*'}
    for item in electrical:
        marker = electrical_markers.get(item['type'], 'o')
        panel = item['type'] in ('strong_panel', 'weak_panel')
        ax.scatter(item['x'], item['z'], s=105 if panel else 25, marker=marker, c='#dc2626' if panel else '#b91c1c', edgecolors='white', linewidths=0.55, zorder=10)
        if panel:
            width = item.get('width', 0.4); depth = item.get('depth', 0.25)
            ax.add_patch(patches.Rectangle((item['x'] - width/2, item['z'] - depth/2), width, depth, fill=False, edgecolor='#7f1d1d', linewidth=1.1, zorder=10))
        text(ax, item['x'] + 0.08, item['z'] + 0.08, item['id'], fontsize=4.4, color='#991b1b', zorder=11)
    plumbing_markers = {'faucet': '^', 'toilet': 'v', 'shower': 'x', 'drain': 'o'}
    for item in plumbing:
        ax.scatter(item['x'], item['z'], s=36, marker=plumbing_markers.get(item['type'], 'o'), c='#0369a1' if item['type'] != 'drain' else '#15803d', edgecolors='white', linewidths=0.55, zorder=10)
        text(ax, item['x'] + 0.08, item['z'] - 0.12, item['id'], fontsize=4.2, color='#075985' if item['type'] != 'drain' else '#166534', zorder=11)
    for item in hvac['diagram']['terminals']:
        color = layers.get(item['system'], {'color': '#f59e0b'})['color']
        ax.scatter(item['position']['x'], item['position']['z'], s=42, marker='s' if item['system'] == 'access' else '>', c=color, edgecolors='black', linewidths=0.35, zorder=12)
    ax.scatter(hvac['outdoor']['x'], hvac['outdoor']['z'], s=125, marker='s', c='#ea580c', edgecolors='black', linewidths=0.7, zorder=12)
    text(ax, hvac['outdoor']['x'], hvac['outdoor']['z'] - 0.35, hvac['outdoor']['id'], fontsize=5, ha='center', color='#9a3412', zorder=13)
    handles = [Line2D([0], [0], color=v['color'], lw=2, label=v['label']) for v in layers.values()]
    handles += [Line2D([0], [0], marker='H', color='w', markerfacecolor='#dc2626', label='强电箱', markersize=8), Line2D([0], [0], marker='X', color='w', markerfacecolor='#dc2626', label='弱电箱', markersize=8), Line2D([0], [0], marker='o', color='w', markerfacecolor='#b91c1c', label='电气点位', markersize=6), Line2D([0], [0], marker='o', color='w', markerfacecolor='#0369a1', label='给排水点位', markersize=6), Line2D([0], [0], color='#64748b', lw=1.5, linestyle='--', label='推断/待确认路线')]
    ax.legend(handles=handles, loc='upper left', bbox_to_anchor=(1.01, 1), fontsize=7, framealpha=0.94, title='图例', prop=PROP)
    ax.annotate('北', xy=(0.035, 0.93), xycoords='axes fraction', fontsize=15, fontweight='bold', ha='center', fontproperties=PROP)
    ax.arrow(0.035, 0.88, 0, 0.045, transform=ax.transAxes, width=0.002, head_width=0.018, head_length=0.018, color='#0f172a')
    ax.set_xlabel('x (m) — +x 东', fontproperties=PROP); ax.set_ylabel('z (m) — +z 南', fontproperties=PROP)
    ax.set_title('701 综合水电 + 中央空调走线协调图', fontproperties=PROP, fontsize=15)
    text(ax, 0.5, 0.51, '初步协调示意\n非施工图', transform=ax.transAxes, ha='center', va='center', fontsize=28, color='#64748b', alpha=0.16, rotation=25, fontproperties=PROP, zorder=20)
    text(ax, 0.01, -0.08, '数据源：model-geometry.yaml / electrical.yaml / plumbing.yaml / hvac.yaml；路线来自独立 proposal，可后续按现场实测调整。', transform=ax.transAxes, fontsize=6.5, color='#475569', fontproperties=PROP)
    ax.invert_yaxis(); ax.grid(True, linewidth=0.25, alpha=0.25); ax.set_xlim(-1.2, 17.5); ax.set_ylim(11.2, -1.2)
    fig.tight_layout()
    png = OUT / 'mep-hvac-coordination.png'; svg = OUT / 'mep-hvac-coordination.svg'
    fig.savefig(png, dpi=220, bbox_inches='tight'); fig.savefig(svg, bbox_inches='tight'); plt.close(fig)
    print(f'saved {png}'); print(f'saved {svg}')

if __name__ == '__main__': main()
