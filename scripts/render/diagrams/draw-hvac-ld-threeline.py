#!/usr/bin/env python3
"""DEC-2026-10-07-R03 客餐厅双出风风口三层线交付图：
D1 两台内机平面布置 / 风口对应关系（顶视）
D2 天花剖面节点（A-A x=10.30 穿 71T2 / B-B x=7.90 穿 42T2）
数据源：config/hvac.yaml（A2 diagram.terminals）、config/model/envelope/ceiling.yaml（ceiling_living / ac_living / ac_dining）。
只读配置；装饰段（LD-deco-*）以封闭背板表达，不接风道。

行位口径（issue #98 第五阶段 S1）：本脚本原先硬编码 `LAYER_Z = {side_south: 5.54,
side_north: 4.31, supply_bottom: 4.85, return_bottom: 4.45}` 作为「风口画在第几行」的依据，
而 DEC-2026-10-19-R02 把两排底面行位南移到 z=5.125/4.725 后没人回改脚本——`segments()` 按
`abs(z - 4.85) < 0.01` / `abs(z - 4.45) < 0.01` 分行的 continue 把带内 15 个口里的 11 个
（含 4 个功能口与 access_dining）**静默丢掉**，只画 4 个（A F7：脚本没进任何门禁，静默失效）。
现改为**行位读投影数据**（见 `layer_rows`），`segments()` 末尾自证「带内每个口都落到某一行」，
丢掉即 raise——同类失效再现时是噪声而不是静默。
"""
from pathlib import Path
import argparse
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.lines import Line2D
from matplotlib import font_manager as fm
import yaml

ROOT = Path(__file__).resolve().parents[3]

FONT_CANDIDATES = [
    '/home/tao/.local/share/fonts/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
]
FONT = next((path for path in FONT_CANDIDATES if Path(path).exists()), '')
PROP = fm.FontProperties(fname=FONT) if Path(FONT).exists() else None
plt.rcParams['axes.unicode_minus'] = False

BAND = {'x1': 7.20, 'x2': 13.40, 'z1': 4.30, 'z2': 5.55, 'bottom': 2.50, 'top': 2.80}
MACHINES = {'ac_living': {'x': 10.30, 'model': '71T2 MJV-71T2/P-SS'}, 'ac_dining': {'x': 8.00, 'model': '42T2 MJV-42T2/P-SS'}}
FUNCTIONAL = {'supply_living', 'return_living', 'supply_dining', 'return_dining', 'supply_living_bottom', 'supply_dining_bottom'}

# 底装行聚类容差（米）：检修口 access_dining 中心 z=4.70 与回风行 z=4.725 差 0.025m，
# 按「同一层线」并入回风行（DEC-2026-10-07-R03 的三层线语言：回风/检修同一层）。
BOTTOM_ROW_TOLERANCE = 0.05

# 行名 → 图例/标注文案（z 与 y 由数据插值，不写死）
LAYER_LABELS = {
    'side_south': '① 侧立面上出风层（南边界）',
    'side_north': '① 侧立面上出风层（北立面）',
    'supply_bottom': '② 底面前侧下出风层',
    'return_bottom': '③ 底面后侧回风/检修层',
}


def load(relative):
    with open(ROOT / relative, encoding='utf-8') as handle:
        return yaml.safe_load(handle)


def band_terminals(hvac):
    """客餐厅设备带（x[7.20,13.40] × z[4.30,5.55]）内的风口——带宽本身与 ceiling_living area 同源。"""
    out = []
    for terminal in hvac['plans'][0]['diagram']['terminals']:
        x = terminal['position']['x']
        z = terminal['position']['z']
        if not (BAND['x1'] - 0.01 <= x <= BAND['x2'] + 0.01 and BAND['z1'] - 0.01 <= z <= BAND['z2'] + 0.01):
            continue
        out.append(terminal)
    return out


def bottom_rows(band):
    """底装风口行位：按 position.z 聚类（容差 BOTTOM_ROW_TOLERANCE），行名按组内 id 功能词判定。

    返回 [(layer_key, z)]，按 z 降序（南→北）。行位不再硬编码——旧 4.85/4.45 与现配置
    5.125/4.725 漂移后曾静默丢 11/15 个口（见模块 docstring）。
    """
    bottom = sorted(
        (terminal for terminal in band if terminal.get('mount_face', 'bottom') not in ('south', 'north')),
        key=lambda terminal: terminal['position']['z'],
    )
    rows: list[dict] = []
    for terminal in bottom:
        z = terminal['position']['z']
        for row in rows:
            if abs(row['z'] - z) <= BOTTOM_ROW_TOLERANCE:
                row['zs'].append(z)
                row['terminals'].append(terminal)
                break
        else:
            rows.append({'z': z, 'zs': [z], 'terminals': [terminal]})
    out = []
    for row in rows:
        # 行位取该行众数 z（回风行 5 个口在 4.725、检修口 1 个在 4.70 → 行位记 4.725，
        # 不让单个偏移口把整行拖偏；access_dining 与回风行同层的口径见 BOTTOM_ROW_TOLERANCE）
        row_z = max(set(row['zs']), key=row['zs'].count)
        ids = ' '.join(terminal['id'] for terminal in row['terminals'])
        if 'supply' in ids:
            key = 'supply_bottom'
        elif 'return' in ids:
            key = 'return_bottom'
        else:
            key = f"bottom_z{row_z:.3f}"
        out.append((key, row_z))
    return out


def layer_rows(band):
    """全部行位：返回 (rows, bottom_z)。

    rows = {layer_key: z}（画图用，含侧装行）；bottom_z = 仅底装行的 {layer_key: z}
    （`bottom_layer_of` 按 z 聚类匹配底装风口用）。
    """
    rows: dict[str, float] = {}
    for face, key in (('south', 'side_south'), ('north', 'side_north')):
        zs = [terminal['position']['z'] for terminal in band if terminal.get('mount_face', 'bottom') == face]
        if zs:
            rows[key] = max(set(zs), key=zs.count)  # 同组多个 z 时取众数（今天各组唯一）
    bottom = dict(bottom_rows(band))
    rows.update(bottom)
    return rows, bottom


def bottom_layer_of(terminal, bottom_z):
    """底装风口所属行 key：按 z 聚类匹配；落不进任何行返回 None（调用方显形，不静默丢）。"""
    z = terminal['position']['z']
    for key, row_z in bottom_z.items():
        if abs(row_z - z) <= BOTTOM_ROW_TOLERANCE:
            return key
    return None


def segments(hvac):
    """返回 (segments, rows)；segments = [(id, layer_key, x1, x2, functional)]。

    行位读投影数据，带内每个口都必须落到某一行——丢一个即 raise（历史硬编码 LAYER_Z 的
    静默丢口缺陷：15 个口只画 4 个，见模块 docstring）。
    """
    band = band_terminals(hvac)
    rows, bottom_z = layer_rows(band)
    out = []
    for terminal in band:
        length = terminal.get('length') or 0.8
        x = terminal['position']['x']
        face = terminal.get('mount_face', 'bottom')
        layer = {'south': 'side_south', 'north': 'side_north'}.get(face) or bottom_layer_of(terminal, bottom_z)
        if layer is None:
            continue
        functional = terminal.get('kind') != 'decorative_louver'
        out.append((terminal['id'], layer, round(x - length / 2, 3), round(x + length / 2, 3), functional))
    drawn = {segment[0] for segment in out}
    missing = sorted(terminal['id'] for terminal in band if terminal['id'] not in drawn)
    if missing:
        raise SystemExit(
            f'设备带内 {len(band)} 个口有 {len(missing)} 个未落到任何行位（行位读数据也解不出：'
            f'{missing}）——历史硬编码 LAYER_Z 的静默丢口缺陷不许复发'
        )
    return out, rows


def annotate(ax, *args, **kwargs):
    if PROP:
        kwargs.setdefault('fontproperties', PROP)
    return ax.annotate(*args, **kwargs)

def text(ax, *args, **kwargs):
    if PROP:
        kwargs.setdefault('fontproperties', PROP)
    return ax.text(*args, **kwargs)


def machine_of(tid):
    if 'dining' in tid and 'living' not in tid:
        return 'ac_dining'
    if 'living' in tid:
        return 'ac_living'
    return None


def draw_plan(ax, segs, rows):
    ax.set_aspect('equal')
    ax.add_patch(patches.Rectangle((BAND['x1'], BAND['z1']), BAND['x2'] - BAND['x1'], BAND['z2'] - BAND['z1'],
                                   facecolor='#f8fafc', edgecolor='#0f172a', linewidth=1.4, zorder=1))
    text(ax, (BAND['x1'] + BAND['x2']) / 2, BAND['z2'] + 0.12, '设备带 ceiling_living  x[7.20,13.40] × z[4.30,5.55]，完成面 2.50（深度 1.25）',
         ha='center', fontsize=8.5, color='#0f172a')
    text(ax, BAND['x2'] + 0.12, (BAND['z1'] + BAND['z2']) / 2, '客厅侧（南）', fontsize=8, rotation=90, va='center', color='#475569')
    text(ax, BAND['x1'] - 0.12, (BAND['z1'] + BAND['z2']) / 2, '餐厅侧（北）', fontsize=8, rotation=90, va='center', color='#475569')
    # 行位标注：z 从数据来（旧文案里的 5.56/4.85/4.45 是硬编码快照，已随 R02 漂移）
    for layer, z in rows.items():
        annotate(ax, f'{LAYER_LABELS.get(layer, layer)}（z={z:.3f}）', xy=(BAND['x2'] + 0.15, z), fontsize=7.6, va='center', color='#1e293b')
    for tid, layer, x1, x2, functional in segs:
        z = rows[layer]
        if functional:
            ax.add_patch(patches.Rectangle((x1, z - 0.055), x2 - x1, 0.11, facecolor='#111827', edgecolor='#000000', linewidth=0.5, zorder=5))
            text(ax, (x1 + x2) / 2, z, tid.replace('hvac:A2:terminal:', '').replace('LD-deco-', 'deco:'), ha='center', va='center', fontsize=5.6, color='#f8fafc', zorder=6)
        else:
            ax.add_patch(patches.Rectangle((x1, z - 0.055), x2 - x1, 0.11, facecolor='none', edgecolor='#111827', linewidth=0.9, hatch='///', zorder=5))
            text(ax, (x1 + x2) / 2, z + 0.085, f"{tid}（封闭）", ha='center', va='bottom', fontsize=5.4, color='#111827', zorder=6)
    for machine_id, machine in MACHINES.items():
        x = machine['x']
        ax.add_patch(patches.Rectangle((x - 0.45, 4.75 - 0.22), 0.9, 0.44, facecolor='none', edgecolor='#b45309', linewidth=1.1, linestyle=(0, (4, 3)), zorder=7))
        text(ax, x, 4.75, f"{machine_id}\n{machine['model']}\n机身外廓待厂家图", ha='center', va='center', fontsize=6.2, color='#92400e', zorder=8)
    for tid, layer, x1, x2, functional in segs:
        if not functional:
            continue
        owner = machine_of(tid)
        if not owner:
            continue
        zm = 4.75
        zt = rows[layer]
        ax.plot([MACHINES[owner]['x'], (x1 + x2) / 2], [zm, zt], color='#b45309', linewidth=0.6, linestyle=':', zorder=4)
    annotate(ax, '北', xy=(0.03, 0.965), xycoords='axes fraction', fontsize=11, fontweight='bold')
    ax.arrow(0.03, 0.94, 0, 0.03, transform=ax.transAxes, width=0.0015, head_width=0.012, head_length=0.012, color='#0f172a')
    handles = [
        patches.Patch(facecolor='#111827', edgecolor='black', label='功能风口（送风/回风，各自归属一台机器）'),
        patches.Patch(facecolor='none', edgecolor='#111827', hatch='///', label='装饰延续段（背板封闭、无风道、不进 MEP 路线）'),
        patches.Patch(facecolor='none', edgecolor='#b45309', linestyle=(0, (4, 3)), label='双出风内机（机身外廓为占位，尺寸以厂家安装图为准）'),
        Line2D([0], [0], color='#b45309', linestyle=':', label='机器 ↔ 自有风口对应关系'),
    ]
    ax.legend(handles=handles, loc='upper center', bbox_to_anchor=(0.5, -0.045), fontsize=7.2, framealpha=0.95, prop=PROP, ncol=2)
    ax.set_xlim(6.9, 15.6)
    ax.set_ylim(5.7, 3.9)
    ax.invert_yaxis()
    ax.grid(True, linewidth=0.2, alpha=0.25)
    ax.set_xlabel('x (m) — +x 东', fontproperties=PROP)
    ax.set_ylabel('z (m) — +z 南', fontproperties=PROP)
    ax.set_title('D1 客餐厅双出风风口平面布置 / 风口对应关系（DEC-2026-10-07-R03，非施工图）', fontproperties=PROP, fontsize=11)


def span_text(segs, cut_x, layer):
    """剖面 cut_x 处该行上的段（功能段优先）——文案从数据生成，不再手抄可能 stale 的 x 区间。"""
    hits = [segment for segment in segs if segment[1] == layer and segment[2] - 0.01 <= cut_x <= segment[3] + 0.01]
    if not hits:
        return '该 x 无段'
    parts = []
    for tid, _layer, x1, x2, functional in sorted(hits, key=lambda segment: segment[2]):
        parts.append(f"{tid.replace('hvac:A2:terminal:', '').replace('LD-deco-', 'deco:')}"
                     f"（{'功能' if functional else '封闭装饰'}，x[{x1:.2f},{x2:.2f}]）")
    return '；'.join(parts)


def draw_section(ax, cut_x, title, tags, segs, rows):
    """沿 z 向剖面（固定 x=cut_x）：横轴 z（北->南），纵轴 y 标高。
    表达设备带深度上的三层线：北/南立面侧出风、底面后侧回风/检修、底面前侧下出风。
    底面两层的 z 位置读数据行位（rows），不再硬编码 4.45/4.85。"""
    z1, z2 = BAND['z1'], BAND['z2']  # 4.30 北（餐厅侧）-> 5.55 南（客厅侧）
    supply_z = rows.get('supply_bottom')
    return_z = rows.get('return_bottom')
    ax.set_aspect('equal')
    ax.add_patch(patches.Rectangle((z1 - 0.25, BAND['top']), (z2 - z1) + 0.5, 0.18, facecolor='#cbd5e1', edgecolor='#475569', linewidth=0.8, hatch='\\\\', zorder=2))
    text(ax, (z1 + z2) / 2, BAND['top'] + 0.09, '原顶/楼板 2.80', ha='center', va='center', fontsize=7.5, color='#1e293b')
    ax.plot([z1 - 0.25, z2 + 0.25], [2.73, 2.73], color='#dc2626', linewidth=0.8, linestyle='--', zorder=3)
    text(ax, z2 + 0.28, 2.73, '参考梁底 2.73（南窗带，量房复核）', fontsize=6.2, color='#dc2626', va='center')
    ax.add_patch(patches.Rectangle((z1, BAND['bottom']), z2 - z1, BAND['top'] - BAND['bottom'], facecolor='#f1f5f9', edgecolor='#0f172a', linewidth=1.2, zorder=2))
    ax.add_patch(patches.Rectangle((z1 + 0.16, 2.56), (z2 - z1) - 0.32, 0.20, facecolor='#fde68a', edgecolor='#b45309', linewidth=1.0, zorder=4))
    text(ax, (z1 + z2) / 2, 2.66, tags['machine'], ha='center', va='center', fontsize=6.2, color='#92400e', zorder=5)
    # 北立面（z=4.30）侧出风口
    ax.add_patch(patches.Rectangle((z1 - 0.03, 2.60), 0.06, 0.12, facecolor='#111827', zorder=6))
    annotate(ax, tags['north'], xy=(z1, 2.66), xytext=(z1 - 0.30, 2.97), fontsize=6.4, ha='left',
             arrowprops=dict(arrowstyle='->', color='#111827', lw=0.7, connectionstyle='arc3,rad=-0.15'), color='#111827')
    # 南立面（边界z=5.55，风口中心 z=5.56）侧出风口
    ax.add_patch(patches.Rectangle((z2 - 0.03, 2.60), 0.06, 0.12, facecolor='#111827', zorder=6))
    annotate(ax, tags['south'], xy=(z2, 2.66), xytext=(z2 + 0.30, 2.97), fontsize=6.4, ha='left',
             arrowprops=dict(arrowstyle='->', color='#111827', lw=0.7, connectionstyle='arc3,rad=0.15'), color='#111827')
    # 底面后侧回风/检修层、底面前侧下出风层（z 读数据行位）
    if return_z is not None:
        ax.add_patch(patches.Rectangle((return_z - 0.12, BAND['bottom'] - 0.05), 0.24, 0.05, facecolor='#111827', zorder=6))
        annotate(ax, tags['ret'], xy=(return_z, BAND['bottom']), xytext=(z1 - 0.35, 2.20), fontsize=6.4, ha='left',
                 arrowprops=dict(arrowstyle='->', color='#111827', lw=0.7, connectionstyle='arc3,rad=0.18'), color='#111827')
    if supply_z is not None:
        ax.add_patch(patches.Rectangle((supply_z - 0.12, BAND['bottom'] - 0.05), 0.24, 0.05, facecolor='#111827', zorder=6))
        annotate(ax, tags['supply'], xy=(supply_z, BAND['bottom']), xytext=(z2 + 0.05, 2.20), fontsize=6.4, ha='left',
                 arrowprops=dict(arrowstyle='->', color='#111827', lw=0.7, connectionstyle='arc3,rad=-0.18'), color='#111827')
    text(ax, (z1 + z2) / 2, BAND['bottom'] - 0.40, f'剖面 {tags["label"]}：固定 x={cut_x:.2f} 沿 z 向剖切（切面位置见 D1）', ha='center', fontsize=6.6, color='#0369a1')
    annotate(ax, '', xy=(z2 + 0.25, 2.80), xytext=(z2 + 0.25, 2.50), arrowprops=dict(arrowstyle='<->', color='#475569', lw=0.7))
    text(ax, z2 + 0.30, 2.65, '边吊\n0.30', fontsize=6.0, color='#475569', ha='left', va='center')
    annotate(ax, '', xy=(z2 + 0.62, 2.50), xytext=(z2 + 0.62, 2.35), arrowprops=dict(arrowstyle='<->', color='#475569', lw=0.7))
    text(ax, z2 + 0.67, 2.425, '净高\n2.50', fontsize=6.0, color='#475569', ha='left', va='center')
    annotate(ax, '', xy=(z1, BAND['top'] + 0.22), xytext=(z2, BAND['top'] + 0.22), arrowprops=dict(arrowstyle='<->', color='#475569', lw=0.7))
    text(ax, (z1 + z2) / 2, BAND['top'] + 0.19, '设备带进深 1.25（z=4.30 -> 5.55）', fontsize=6.2, color='#475569', ha='center')
    text(ax, z1 - 0.10, 2.40, '北（餐厅侧）', fontsize=6.2, color='#475569', ha='right', va='center')
    text(ax, z2 + 0.10, 2.40, '南（客厅侧）', fontsize=6.2, color='#475569', ha='left', va='center')
    ax.set_xlim(z1 - 1.2, z2 + 1.9)
    ax.set_ylim(2.06, 3.24)
    ax.grid(True, linewidth=0.2, alpha=0.25)
    ax.set_xlabel('z (m)', fontproperties=PROP)
    ax.set_ylabel('y (m) 标高', fontproperties=PROP)
    ax.set_title(title, fontproperties=PROP, fontsize=8.6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='tmp/capture/hvac-dual-outlet-threeline-20261007')  # 默认落 tmp/capture，见 AGENTS.md 证据分级与退场铁律
    args = parser.parse_args()
    out_dir = ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    hvac = load('config/hvac.yaml')
    segs, rows = segments(hvac)
    print(f'设备带内 {len(segs)} 个口全部落到行位（行位读数据：{ {key: round(z, 3) for key, z in rows.items()} }）')

    fig, ax = plt.subplots(figsize=(13.5, 6.2), dpi=170)
    draw_plan(ax, segs, rows)
    fig.tight_layout()
    d1 = out_dir / 'd1-plan-correspondence.png'
    fig.savefig(d1, bbox_inches='tight')
    plt.close(fig)
    print(f'saved {d1}')

    fig, axes = plt.subplots(2, 1, figsize=(13.5, 8.6), dpi=170)
    draw_section(axes[0], 10.30, 'D2a 剖面 A-A（x=10.30，穿 71T2）：功能上出风 + 功能下出风 + 封闭装饰回风段', {
        'label': 'A-A',
        'machine': '71T2 MJV-71T2/P-SS（机身外廓待厂家图）',
        'north': '北立面（餐厅侧）：' + span_text(segs, 10.30, 'side_north'),
        'south': '南立面（客厅侧）：' + span_text(segs, 10.30, 'side_south'),
        'supply': '底面前侧：' + span_text(segs, 10.30, 'supply_bottom'),
        'ret': '底面后侧：' + span_text(segs, 10.30, 'return_bottom'),
    }, segs, rows)
    draw_section(axes[1], 7.90, 'D2b 剖面 B-B（x=7.90，穿 42T2）：功能上出风 + 功能下出风 + 功能回风/检修', {
        'label': 'B-B',
        'machine': '42T2 MJV-42T2/P-SS 旋转 180°（机身外廓待厂家图）',
        'north': '北立面（餐厅侧）：' + span_text(segs, 7.90, 'side_north'),
        'south': '南立面（客厅侧）：' + span_text(segs, 7.90, 'side_south'),
        'supply': '底面前侧：' + span_text(segs, 7.90, 'supply_bottom'),
        'ret': '底面后侧：' + span_text(segs, 7.90, 'return_bottom'),
    }, segs, rows)
    fig.suptitle('D2 客餐厅天花剖面节点（DEC-2026-10-07-R03，非施工图；装饰段背板封闭，两台机器不共用风道）', fontproperties=PROP, fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    d2 = out_dir / 'd2-ceiling-section.png'
    fig.savefig(d2, bbox_inches='tight')
    plt.close(fig)
    print(f'saved {d2}')


if __name__ == '__main__':
    main()
