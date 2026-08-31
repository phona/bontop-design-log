"""
dress_scene.py — Blender 自动定妆管线 v2（批量 A/B 决策）
用法（推荐通过环境无关 wrapper）：
  bash scripts/run-blender.sh --glb house.glb --config scripts/blender/render-config.json \
    --engine EEVEE --out-dir renders/blender/output --version v1 --config-dir .

坐标：glb 为 Three.js 米制（x 东 / y 高 / z 南）；glTF 导入 Blender 后 (x,y,z)_three → (x, -z, y)_blender。
材质/灯光全部按 objectId（节点名）声明式驱动，与 docs/dressing-map.md 同源。
机位×场景批量展开见 dress_config.py；材质从 materials.yaml appearance 生成见 materials_from_yaml.py。
候选色号对比：--mat-override "wall=#f5f1e8" 整场景覆盖该材质色号（2026-08-23 起替代实体色板）。
"""
import bpy
import hashlib
import json
import math
import os
import re
import sys

# 确保同目录的 dress_config / materials_from_yaml / curtain_projection 可导入（Blender --python 不自动加脚本目录）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from curtain_projection import (  # noqa: E402
    curtain_projection_from_facts,
    parse_curtain_node_name,
    validate_curtain_nodes,
)
import blender_lighting as _blender_lighting  # noqa: E402
import blender_environment as _blender_environment  # noqa: E402
import blender_assets as _blender_assets  # noqa: E402
import blender_render_only as _blender_render_only  # noqa: E402
import blender_preview as _blender_preview  # noqa: E402
import legacy_geometry as _legacy_geometry  # noqa: E402
import scene_asset_registry as _scene_asset_registry  # noqa: E402

# Formal dressed/audit runs require the tracked registry; only isolated unit helpers use builtin fallback.
ASSET_REGISTRY = _scene_asset_registry.load_registry(strict=True)

GLASS_IDS = {
    'west_curtain', 'kitchen_north_curtain', 'north_recess_curtain',
    'living_south_curtain', 'south_east_curtain', 'd_kit_balc',
}

# 厨卫/阳台墙面贴砖：GLB 墙段命名 wall:seg:N:room=r1|r2（export-gltf exportName，
# 房间归属来自 model-geometry 墙→房间拓扑），命中湿区即挂 mats['wall_tile']
WET_ROOM_IDS = {'kitchen', 'master_bath', 'guest_bath', 'balcony'}
_WALL_SEG_ROOM_RE = re.compile(r'^wall:seg:\d+:room=([a-z0-9_|]+)')
_FLOOR_ROOM_RE = re.compile(r'^floor:([a-z0-9_]+)(?:\.\d+)?$')


def _wall_seg_rooms(name: str) -> set:
    """解析墙段导出名的房间归属（容差 Blender 重名 .NNN 后缀：正则只吃到 | 与字母数字）。"""
    m = _WALL_SEG_ROOM_RE.match(name)
    if not m:
        return set()
    return {r for r in m.group(1).split('|') if r}


def floor_room_id(name: str) -> str | None:
    """仅根据 GLB 的稳定 floor:<roomId> 导出名识别房间，绝不按位置猜测。"""
    m = _FLOOR_ROOM_RE.match(name)
    return m.group(1) if m else None


def projection_facts(cfg: dict) -> dict:
    facts = cfg.get('facts')
    if not isinstance(facts, dict):
        print('[dress_scene] WARN: render config missing facts; plumbing/ceiling/floor overrides disabled')
        return {}
    return facts


def plumbing_by_id(facts: dict) -> dict:
    points = facts.get('plumbing', [])
    if not isinstance(points, list):
        print('[dress_scene] WARN: facts.plumbing must be a list')
        return {}
    return {p['id']: p for p in points if isinstance(p, dict) and isinstance(p.get('id'), str)
            and isinstance(p.get('x'), (int, float)) and isinstance(p.get('z'), (int, float))}


# Compatibility alias; formal lighting constants live in blender_lighting.
LIGHT_ENERGY = _blender_lighting.LIGHT_ENERGY

def kelvin_to_rgb(k: float) -> tuple[float, float, float]:
    t = k / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    return (min(255, max(0, r)) / 255.0, min(255, max(0, g)) / 255.0, min(255, max(0, b)) / 255.0)


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _srgb_to_linear_tuple(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    return (_srgb_to_linear(rgb[0]), _srgb_to_linear(rgb[1]), _srgb_to_linear(rgb[2]))


def hex_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip('#')
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


def new_sheer_transparent(name: str, color, opacity: float = 0.15):
    """真半透明纱帘（Cycles）：Transparent BSDF + Principled 混合。
    opacity = 布料权重（0.15 ≈ 85% 透），决策渲染必须能看穿纱帘见天色。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = _find_node(nt, 'ShaderNodeOutputMaterial') or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = opacity
    nt.links.new(trans.outputs[0], mix.inputs[1])
    nt.links.new(bsdf.outputs[0], mix.inputs[2])
    out = _find_node(nt, 'ShaderNodeOutputMaterial') or nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    try:
        mat.surface_render_method = 'DITHERED'
    except Exception:
        try:
            mat.blend_method = 'BLEND'
        except Exception:
            pass
    return mat


def _find_node(nt, bl_idname):
    """按类型查找节点（语言无关）——5.0 中文 locale 节点名被翻译，get('Principled BSDF') 失败。"""
    return next((n for n in nt.nodes if n.bl_idname == bl_idname), None)


def new_principled(name: str, color, rough: float, metallic: float = 0.0,
                   transmission: float = 0.0, ior: float = 1.5, alpha: float = 1.0,
                   coat: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = _find_node(nt, 'ShaderNodeOutputMaterial') or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = coat
    if 'Transmission Weight' in bsdf.inputs:
        bsdf.inputs['Transmission Weight'].default_value = transmission
    elif 'Transmission' in bsdf.inputs:
        bsdf.inputs['Transmission'].default_value = transmission
    if 'IOR' in bsdf.inputs:
        bsdf.inputs['IOR'].default_value = ior
    if 'Alpha' in bsdf.inputs:
        bsdf.inputs['Alpha'].default_value = alpha
    if alpha < 1.0:
        try:
            mat.surface_render_method = 'DITHERED'
        except Exception:
            try:
                mat.blend_method = 'BLEND'
            except Exception:
                pass
    return mat


FIXTURE_MATERIAL_ROLES = {
    'cabinet_body': 'cabinet_body',
    'door_front': 'door_front',
    'door_seam': 'door_seam',
    'drawer_front': 'drawer_front',
    'back_panel': 'back_panel',
    'frame': 'frame',
    'top_filler': 'top_filler',
    'plinth': 'plinth',
    'shelf': 'shelf',
    'hardware': 'hardware',
    'countertop': 'countertop',
    'end_panel': 'end_panel',
    'tv_frame': 'tv_frame',
    'tv_screen': 'tv_screen',
    'fixture_diffuser': 'fixture_diffuser',
    'fixture_diffuse': 'fixture_diffuser',
    'fixture_diff': 'fixture_diffuser',
    'fixture_track': 'fixture_track',
    'fixture_metal': 'fixture_metal',
    'fixture_met': 'fixture_metal',
    'cooktop_burner': 'cooktop_burner',
    'cooktop_surface': 'cooktop_surface',
    'cove_light': 'cove_light',
    'ceramic': 'ceramic',
    'cer': 'ceramic',
    'mi': 'mirror',
    't': 'furniture',
    'tv': 'tv_screen',
    'fabric': 'fabric',
    'weight_plate': 'weight_plate',
    'upholstery': 'upholstery',
    'floor_protection': 'floor_protection',
    'cabinet_foot': 'cabinet_foot',
    'cabinet_support': 'cabinet_support',
    'safety_bar': 'safety_bar',
    'railing': 'railing',
    'hvac_cover': 'hvac_coordination_cover',
    'mirror': 'mirror',
}


def _declared_fixture_role(name: str) -> str | None:
    match = re.search(r'(?:^|:)role=([^:]+)', name)
    return match.group(1) if match else None


def fixture_material_role(name: str) -> str | None:
    """Read the exporter-stable ``:role=<materialRole>`` child-node tag."""
    role = _declared_fixture_role(name)
    if role is None:
        return None
    return role if role in FIXTURE_MATERIAL_ROLES else None


def _require_known_fixture_role(name: str) -> str | None:
    role = _declared_fixture_role(name)
    if role is not None and role not in FIXTURE_MATERIAL_ROLES:
        raise RuntimeError(
            f'BLOCKED: unknown fixture material role {role!r} on object {name!r}; '
            'declare it in FIXTURE_MATERIAL_ROLES and materials.yaml render_roles'
        )
    return role


def classify(obj: bpy.types.Object) -> str:
    n = obj.name
    declared_role = _require_known_fixture_role(n)
    if declared_role:
        return FIXTURE_MATERIAL_ROLES.get(declared_role, declared_role)
    if n.startswith('molding:'):
        return 'wall'  # 石膏线用墙面材质（同色）
    if n.startswith('asset:'):
        return 'skip'  # 导入家具资产保留自带材质（fixture-assets.yaml 接线，见 french-cream spec）
    if n.startswith('furniture:'):
        return 'furniture'
    # 家具组的子 mesh 未命名 → 沿父节点链找前缀
    parent = obj.parent
    while parent is not None:
        pn = parent.name
        declared_parent_role = _require_known_fixture_role(pn)
        if declared_parent_role:
            return declared_parent_role
        if pn.startswith('furniture:'):
            return 'furniture'
        parent = parent.parent
    curtain = parse_curtain_node_name(n)
    if curtain:
        # 窗帘节点契约 <id>:<layer>:<variant>[:segment]：layer 决定材质
        # （sheer→纱帘 / blackout+blinds→布料）；variant 只影响材质语义，
        # 不改显隐——可见性已由 GLB 快照（expectedVisibleNodes）决定
        return 'sheer' if curtain['layer'] == 'sheer' else 'curtain_fabric'
    if n in GLASS_IDS or n.startswith('curtain_run:') or any(n.startswith(f'{glass_id}:part=') for glass_id in GLASS_IDS):
        return 'exterior_glazing'
    if n.startswith('sliding_door'):
        return 'fluted_glass'
    if n.startswith('shower_screen') or n.startswith('shower:') or 'shower_screen' in n:
        return 'shower_glass'
    if n.startswith('mirror:') or n.endswith(':mirror') or ':mirror:' in n or n.endswith('_mirror'):
        return 'mirror'
    if 'glass_infill' in n:
        return 'exterior_glazing'
    if n.startswith('floor:') or n.endswith('_floor'):
        return 'floor'
    if n.startswith('ceiling') or n.startswith('cz:'):
        return 'ceiling'
    if n.startswith('wall:seg:'):
        # 厨卫/阳台墙段挂墙砖（命名带 :room= 归属，见 WET_ROOM_IDS）；无归属仍走乳胶漆
        return 'wall_tile' if _wall_seg_rooms(n) & WET_ROOM_IDS else 'wall'
    if n.startswith('wall:') or n.startswith('wall_') or ':frame:' in n or n.startswith('wall_seg'):
        return 'wall'
    if '_bay' in n:
        return 'sill'
    if 'rail' in n:
        return 'railing'
    if n.startswith('d_') or n == 'door':
        return 'door'
    return 'default'


def _glass_shadow_passthrough(mat) -> None:
    """Cycles 直射光透玻璃修复：shadow ray 走 Transparent BSDF。
    Principled transmission 不参与焦散时会把太阳/HDRI 直射全挡在室外（室内死黑），
    建筑可视化标准做法：阴影光线透明直通，其他光线仍走真折射玻璃。"""
    nt = mat.node_tree
    bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
    out = _find_node(nt, 'ShaderNodeOutputMaterial')
    if bsdf is None or out is None:
        return
    if any(node.name == 'LowE Shadow Transparent' for node in nt.nodes):
        return
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    trans.name = 'LowE Shadow Transparent'
    lp = nt.nodes.new('ShaderNodeLightPath')
    lp.name = 'LowE Shadow Light Path'
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.name = 'LowE Shadow Mix'
    # MixShader：Fac=0→输入1，Fac=1→输入2。阴影光线(Fac=1)走 Transparent 直通，其余走真玻璃
    nt.links.new(lp.outputs['Is Shadow Ray'], mix.inputs[0])
    nt.links.new(bsdf.outputs[0], mix.inputs[1])
    nt.links.new(trans.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])


def build_materials(engine: str, sheer_opacity: float = 0.15) -> dict:
    is_cycles = engine.upper() == 'CYCLES'
    # EEVEE 默认无屏幕空间折射，transmission 渲成不透明 → 预览用 alpha 玻璃；Cycles 用真透射
    # LowE 玻璃：真透射 + 蓝绿微调 + 低辐射涂层 coat（Cycles）；EEVEE 预览用 alpha
    glass = (
        new_principled('硬装_LowE玻璃', hex_rgb('#c8e0dc'), rough=0.02, transmission=1.0, ior=1.5, coat=0.3)
        if is_cycles
        else new_principled('硬装_LowE玻璃', hex_rgb('#c8e0dc'), rough=0.05, alpha=0.25)
    )
    if is_cycles:
        _glass_shadow_passthrough(glass)
    # 纱帘在 Cycles/EEVEE 都使用显式 Transparent BSDF 混合，避免
    # EEVEE 仅改 Principled Alpha 后仍把整面窗变成不透明灰面。
    sheer = new_sheer_transparent('软装_纱帘', hex_rgb('#f7f4ec'), opacity=sheer_opacity)
    return {
        # 木纹砖（柔光）：materials.yaml floor_tile_01 #c49a6c finish=soft
        'floor': new_principled('硬装_木纹砖', hex_rgb('#c49a6c'), rough=0.35, coat=0.15),
        # 乳胶漆（哑光）：latex_paint_01 #f7f5ef
        'wall': new_principled('硬装_乳胶漆', hex_rgb('#f7f5ef'), rough=0.92),
        'ceiling': new_principled('硬装_天花白', hex_rgb('#f7f7f5'), rough=0.9),
        'aluminum_buckle': new_principled('硬装_铝扣板', hex_rgb('#ecece8'), rough=0.55, metallic=0.25),
        'glass': glass,
        'exterior_glazing': glass,
        'fluted_glass': new_principled('硬装_长虹玻璃', hex_rgb('#c7d7d5'), rough=0.2, transmission=0.75, ior=1.5),
        'shower_glass': new_principled('硬装_淋浴玻璃', hex_rgb('#dce8e8'), rough=0.12, transmission=0.9, ior=1.45),
        'mirror': new_principled('硬装_镜面', hex_rgb('#bcd2d8'), rough=0.08, metallic=0.75),
        'sheer': sheer,
        'curtain_fabric': new_principled('软装_遮光帘', hex_rgb('#d8d0c2'), rough=0.95),
        'furniture': new_principled('家具_暖灰', hex_rgb('#cbbfa9'), rough=0.8),
        # FixtureFactory child-node roles: preserve the same cabinet finish family
        # while separating doors, seams, open shelving, hardware, and stone tops.
        'cabinet_body': new_principled('柜体_柜身', hex_rgb('#f2ede2'), rough=0.62),
        'door_front': new_principled('柜体_门板', hex_rgb('#f2ede2'), rough=0.48),
        'door_seam': new_principled('柜体_门缝', hex_rgb('#604b38'), rough=0.82),
        'drawer_front': new_principled('柜体_抽屉面', hex_rgb('#f2ede2'), rough=0.48),
        'back_panel': new_principled('柜体_背板', hex_rgb('#503e2e'), rough=0.65),
        'frame': new_principled('器械_框架', hex_rgb('#25282b'), rough=0.3, metallic=0.75),
        'top_filler': new_principled('柜体_顶封板', hex_rgb('#f2ede2'), rough=0.62),
        'plinth': new_principled('柜体_踢脚', hex_rgb('#604b38'), rough=0.72),
        'shelf': new_principled('柜体_开放层板', hex_rgb('#a48763'), rough=0.58),
        'hardware': new_principled('柜体_五金', hex_rgb('#504b46'), rough=0.32, metallic=0.7),
        'countertop': new_principled('柜体_台面', hex_rgb('#e8e6e0'), rough=0.25, coat=0.12),
        'end_panel': new_principled('柜体_侧封板', hex_rgb('#f2ede2'), rough=0.62),
        'weight_plate': new_principled('器械_杠铃片', hex_rgb('#1f2326'), rough=0.65, metallic=0.35),
        'upholstery': new_principled('器械_软包', hex_rgb('#33383d'), rough=0.75),
        'floor_protection': new_principled('地面_橡胶保护', hex_rgb('#292b2e'), rough=0.92),
        'cabinet_foot': new_principled('柜体_柜脚', hex_rgb('#2f2822'), rough=0.5, metallic=0.35),
        'cabinet_support': new_principled('柜体_支撑', hex_rgb('#382b22'), rough=0.5, metallic=0.35),
        'safety_bar': new_principled('器械_安全托', hex_rgb('#d05a35'), rough=0.35, metallic=0.5),
        'tv_frame': new_principled('电视_边框', hex_rgb('#141414'), rough=0.35, metallic=0.15),
        'tv_screen': new_principled('电视_屏幕', hex_rgb('#202b32'), rough=0.12, coat=0.2),
        'fixture_diffuser': new_principled('灯具_扩散罩', hex_rgb('#f2eee2'), rough=0.6),
        'fixture_track': new_principled('灯具_轨道', hex_rgb('#111111'), rough=0.35, metallic=0.75),
        'fixture_metal': new_principled('灯具_金属', hex_rgb('#504b46'), rough=0.4, metallic=0.7),
        'cooktop_burner': new_principled('灶台_炉圈', hex_rgb('#4a4a4a'), rough=0.32, metallic=0.75),
        'cooktop_surface': new_principled('灶台_玻璃面', hex_rgb('#1b2024'), rough=0.18, metallic=0.35, coat=0.25),
        'cove_light': new_principled('灯具_灯槽', hex_rgb('#e8e6e0'), rough=0.7),
        'sill': new_principled('硬装_窗台石', hex_rgb('#d8d3c8'), rough=0.5),
        'railing': new_principled('硬装_栏杆', hex_rgb('#3a3d40'), rough=0.4, metallic=0.8),
        'door': new_principled('硬装_木门', hex_rgb('#8a6f52'), rough=0.6),
        'default': new_principled('默认_中性灰', hex_rgb('#bfbfbf'), rough=0.85),
    }


def select_floor_material(mats: dict, floor_mats: dict, room_id: str | None):
    """选择地面材质：房间 override 优先，否则使用全局 floor。"""
    if room_id and room_id in floor_mats:
        return floor_mats[room_id]
    return mats.get('floor')


def floor_material_label(mat) -> str:
    """Return a safe diagnostic label without dumping Blender material internals."""
    if mat is None:
        return '<none>'
    return getattr(mat, 'name', None) or '<unnamed>'


def assign_materials(mats: dict, floor_mats: dict | None = None) -> dict:
    """按稳定导出名赋材；floor overrides 仅匹配 floor:<roomId>，不做空间推断。"""
    stats: dict[str, int] = {}
    floor_mats = floor_mats or {}
    expected_floor_rooms = set(floor_mats)
    seen_floor_rooms = set()
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        key = classify(obj)
        if key == 'fixture_diffuse':
            key = 'fixture_diffuser'
        if key == 'skip':
            continue
        room_id = floor_room_id(obj.name) if key == 'floor' else None
        if room_id:
            seen_floor_rooms.add(room_id)
        mat = select_floor_material(mats, floor_mats, room_id) if key == 'floor' else mats.get(key)
        if mat is None:
            if key in FIXTURE_MATERIAL_ROLES or key in {
                'exterior_glazing', 'fluted_glass', 'shower_glass', 'mirror',
            }:
                raise RuntimeError(
                    f'BLOCKED: material contract missing for role {key!r} on object {obj.name!r}; '
                    'check materials.yaml render_roles and Blender material builders'
                )
            # wall_tile 仅在 scheme 选了墙砖时生成；否则湿区墙段回退乳胶漆
            fallback_key = 'wall' if key == 'wall_tile' else 'default'
            mat = mats[fallback_key]
            print(f'[dress_scene] WARN material role {key!r} missing; fallback to '
                  f'{fallback_key!r} material {floor_material_label(mat)!r}')
        if obj.data.materials:
            for i in range(len(obj.data.materials)):
                obj.data.materials[i] = mat
        else:
            obj.data.materials.append(mat)
        stats[key] = stats.get(key, 0) + 1
    missing = expected_floor_rooms - seen_floor_rooms
    if missing:
        raise RuntimeError(f'BLOCKED: GLB missing stable floor room tag(s) for overrides: {", ".join(sorted(missing))}')
    return stats


def to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def rotate_track_local_point(x: float, z: float, rotation_y: float) -> tuple[float, float]:
    cos_r = math.cos(rotation_y)
    sin_r = math.sin(rotation_y)
    return cos_r * x + sin_r * z, -sin_r * x + cos_r * z


def hvac_diagram(facts: dict) -> dict | None:
    """Return the implemented HVAC diagram only; never infer an alternate layout."""
    hvac = facts.get('hvac') if isinstance(facts, dict) else None
    if not isinstance(hvac, dict) or hvac.get('status') != 'implemented':
        return None
    diagram = hvac.get('diagram')
    return diagram if isinstance(diagram, dict) else None


def hvac_reference_constraints(facts: dict, show_constraints: bool = False) -> list[dict]:
    """Return only declared non-construction neighbor references for explicit coordination review."""
    diagram = hvac_diagram(facts)
    if not diagram or not show_constraints:
        return []
    out = []
    for item in diagram.get('reference_constraints', []):
        if not isinstance(item, dict) or item.get('status') not in {'inferred', 'pending'}:
            continue
        if item.get('source') != 'survey/neighbor_ys01_original_structure_2025-06.png' or item.get('uncertainty_m') != 0.15:
            continue
        if item.get('not_for_construction') is not True or not isinstance(item.get('reason'), str) or not isinstance(item.get('survey_confirmation'), str):
            continue
        bounds = item.get('range')
        if not isinstance(bounds, dict) or not all(isinstance(bounds.get(key), (int, float)) for key in ('x1', 'x2', 'z1', 'z2')):
            continue
        if bounds['x1'] >= bounds['x2'] or bounds['z1'] >= bounds['z2']:
            continue
        out.append(item)
    return out


def hvac_route_segments(diagram: dict) -> list[dict]:
    """Resolve declared route ids to ordered point segments for Blender coordination drawing."""
    points = {item.get('id'): item.get('position') for item in [*diagram.get('anchors', []), *diagram.get('terminals', [])]
              if isinstance(item, dict) and isinstance(item.get('id'), str) and isinstance(item.get('position'), dict)}
    out = []
    for route in diagram.get('routes', []):
        if not isinstance(route, dict):
            continue
        ids = [route.get('from'), *(route.get('via') or []), route.get('to')]
        coords = [points.get(point_id) for point_id in ids]
        if any(not isinstance(point, dict) for point in coords):
            continue
        for index, (start, end) in enumerate(zip(coords, coords[1:])):
            out.append({'route': route, 'index': index, 'start': start, 'end': end})
    return out


def add_hvac_reference_constraints(facts: dict, show_constraints: bool = False) -> int:
    """Draw declared neighbor-reference strips only for the explicit coordination scenario."""
    constraints = hvac_reference_constraints(facts, show_constraints)
    if not constraints:
        return 0
    collection = bpy.data.collections.get('HVAC_REFERENCE_CONSTRAINTS_A2') or bpy.data.collections.new('HVAC_REFERENCE_CONSTRAINTS_A2')
    if collection.name not in {child.name for child in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(collection)
    material = new_principled('HVAC_邻户参考_非施工', (0.96, 0.62, 0.08), rough=0.6, alpha=0.18)
    count = 0
    for constraint in constraints:
        bounds = constraint['range']
        x = (bounds['x1'] + bounds['x2']) / 2
        z = (bounds['z1'] + bounds['z2']) / 2
        y = constraint.get('reference_beam_bottom_y', 2.65)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=to_blender(x, y, z))
        obj = bpy.context.object
        obj.name = f"hvac:A2:reference:{constraint['id']}"
        obj.dimensions = (bounds['x2'] - bounds['x1'], bounds['z2'] - bounds['z1'], 0.08)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(material)
        obj['source'] = constraint['source']
        obj['uncertainty'] = '±150mm'
        obj['not_for_construction'] = True
        obj['reason'] = constraint['reason']
        for linked in list(obj.users_collection):
            linked.objects.unlink(obj)
        collection.objects.link(obj)
        bpy.ops.object.text_add(location=to_blender(x, y + 0.12, z))
        label = bpy.context.object
        label.name = f"hvac:A2:reference-label:{constraint['id']}"
        label.data.body = f"参考 ±150mm 非施工: {constraint['id']}"
        label.data.align_x = 'CENTER'
        label.data.size = 0.16
        for linked in list(label.users_collection):
            linked.objects.unlink(label)
        collection.objects.link(label)
        count += 1
    print(f'[dress_scene] HVAC reference constraints: {count}')
    return count


def add_hvac_diagram(facts: dict, show_routes: bool = False) -> int:
    """Draw only declared coordination lines in an isolated collection.

    Confirmed equipment is imported from the Web GLB. This helper intentionally does not
    manufacture a second equipment layout; it adds routes only when the declared review
    scenario explicitly enables them.
    """
    diagram = hvac_diagram(facts)
    if not diagram or not show_routes:
        return 0
    # Ref anchors deliberately have no duplicate coordinates in facts. Resolve their
    # imported Web GLB objects back to Three coordinates for route endpoints.
    diagram = {key: list(value) if isinstance(value, list) else value for key, value in diagram.items()}
    anchors = []
    for anchor in diagram.get('anchors', []):
        item = dict(anchor)
        if not isinstance(item.get('position'), dict):
            obj = bpy.data.objects.get(f"hvac:A2:anchor:{item.get('id')}")
            if obj:
                item['position'] = {'x': obj.location.x, 'y': obj.location.z, 'z': -obj.location.y}
        anchors.append(item)
    diagram['anchors'] = anchors
    collection = bpy.data.collections.get('HVAC_DIAGRAM_A2') or bpy.data.collections.new('HVAC_DIAGRAM_A2')
    if collection.name not in {child.name for child in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(collection)
    colors = {'confirmed': (0.22, 0.74, 0.97, 0.75), 'inferred': (0.96, 0.62, 0.08, 0.52), 'pending': (0.58, 0.64, 0.72, 0.28)}
    count = 0
    for segment in hvac_route_segments(diagram):
        route = segment['route']
        status = route.get('status', 'pending')
        curve = bpy.data.curves.new(f"hvac:A2:route:{route.get('id')}:segment:{segment['index']}", type='CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = 0.012
        spline = curve.splines.new('POLY')
        spline.points.add(1)
        for point, source in zip(spline.points, (segment['start'], segment['end'])):
            point.co = (*to_blender(source['x'], source['y'], source['z']), 1.0)
        material = bpy.data.materials.get(f'HVAC_{status}') or new_principled(f'HVAC_{status}', colors[status][:3], rough=0.45, alpha=colors[status][3])
        curve.materials.append(material)
        obj = bpy.data.objects.new(curve.name, curve)
        collection.objects.link(obj)
        count += 1
    print(f'[dress_scene] HVAC coordination routes: {count}')
    return count


def _mark_render_only(obj, role: str) -> None:
    """标记 Blender 成片的 render-only staging，不把它伪装成正式几何。"""
    obj['render_only'] = True
    obj['geometrySource'] = 'blender_staging'
    obj['renderRole'] = role


def _mark_ceiling_finishing(obj) -> None:
    """标记 Blender 成片的吊顶完成度 staging，不把它伪装成正式几何。"""
    _mark_render_only(obj, 'ceiling_finishing')


def add_ceiling_finishing(furniture_mats: dict, emit: bool = True) -> int:
    """生成客餐厅跌级边框/灯槽的 render-only staging（DEC-027 评估件）。

    基础吊顶几何来自 shared SceneBuilder/CLI GLB；本函数只为 Blender 成片
    保留视觉完成度，不产生正式设计几何，也不应进入正式设计清单或 GLB
    completeness。未来可将该效果迁移为正式 overlay/ceiling element。
    HVAC 风口由 render-facts 驱动的 GLB 实体提供；此处不再硬编码。
    living_dining 边界 x∈[7.2,13.4] z∈[2.4,9.8]，净高 2.8m → 跌级 8cm/宽 25cm。"""
    count = 0
    ceil_m = new_principled('顶面_跌级白', hex_rgb('#efece4'), rough=0.9)  # 比天花白(#f7f7f5)深半档，跌级才有阴影缝可读
    cove_m = bpy.data.materials.new('顶面_灯槽')
    cove_m.use_nodes = True
    cnt = cove_m.node_tree
    for n in list(cnt.nodes):
        cnt.nodes.remove(n)
    cout = cnt.nodes.new('ShaderNodeOutputMaterial')
    cem = cnt.nodes.new('ShaderNodeEmission')
    cem.inputs['Color'].default_value = (*kelvin_to_rgb(3000), 1.0)
    cem.inputs['Strength'].default_value = 6.0 if emit else 0.2  # 2.0 洗顶太弱看不到灯槽（v19 反馈吊顶效果不明显）
    cnt.links.new(cem.outputs[0], cout.inputs['Surface'])
    # 跌级边框（四条）：z=2.76 中心，厚 8cm，宽 25cm
    borders = [
        ((10.3, -2.525, 2.76), (6.2, 0.25, 0.08)),   # 北（餐区侧）
        ((10.3, -9.675, 2.76), (6.2, 0.25, 0.08)),   # 南（玻璃幕侧）
        ((7.325, -6.1, 2.76), (0.25, 7.4, 0.08)),    # 西
        ((13.275, -6.1, 2.76), (0.25, 7.4, 0.08)),   # 东
    ]
    for loc, dims in borders:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
        o = bpy.context.object
        o.name = 'asset:ceiling:drop'
        o.dimensions = dims
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(ceil_m)
        _mark_ceiling_finishing(o)
        count += 1
    # 灯槽（跌级内侧顶上，南北两条，自发光朝上洗顶）
    for y in (-2.55, -9.65):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(10.3, y, 2.81))
        o = bpy.context.object
        o.name = 'asset:ceiling:cove'
        o.dimensions = (6.0, 0.05, 0.02)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(cove_m)
        _mark_ceiling_finishing(o)
        count += 1
    print(f'[dress_scene] ceiling finishing: {count}')
    return count


def add_lights(cfg: dict, temp_override: float | None = None) -> int:
    return _blender_lighting.add_lights(
        cfg, temp_override, bpy_module=bpy, to_blender_fn=to_blender,
        kelvin_to_rgb_fn=kelvin_to_rgb,
    )


def add_window_portal(portal: dict) -> None:
    return _blender_lighting.add_window_portal(
        portal, bpy_module=bpy, to_blender_fn=to_blender,
        kelvin_to_rgb_fn=kelvin_to_rgb,
    )


def add_sun(sun_dir: list[float], energy: float = 1.2, temp: int = 3200) -> None:
    return _blender_lighting.add_sun(
        sun_dir, energy=energy, temp=temp, bpy_module=bpy,
        kelvin_to_rgb_fn=kelvin_to_rgb,
    )


def setup_world(engine: str, scenario: dict, config_dir: str | None = None) -> dict:
    return _blender_environment.setup_world(
        engine, scenario, config_dir=config_dir, bpy_module=bpy,
        hex_rgb_fn=hex_rgb, srgb_to_linear_tuple_fn=_srgb_to_linear_tuple,
    )


def add_sky_planes(hdri_status: dict | None = None) -> None:
    return _blender_environment.add_sky_planes(
        hdri_status, bpy_module=bpy, glass_ids=GLASS_IDS,
        find_node_fn=_find_node, srgb_to_linear_tuple_fn=_srgb_to_linear_tuple,
    )


def add_camera(cam_cfg: dict, reuse: bool = False) -> None:
    from mathutils import Vector
    obj = bpy.data.objects.get(cam_cfg['id']) if reuse else None
    if obj is None or obj.type != 'CAMERA':
        data = bpy.data.cameras.new(cam_cfg['id'])
        obj = bpy.data.objects.new(cam_cfg['id'], data)
        bpy.context.collection.objects.link(obj)
    obj.data.lens = cam_cfg.get('lens', 28)  # 缺省人眼等效；特写机位可配 35
    loc = Vector(to_blender(*cam_cfg['position']))
    target = Vector(to_blender(*cam_cfg['target']))
    obj.location = loc
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (target - loc).to_track_quat('-Z', 'Y')
    bpy.context.scene.camera = obj


FURNITURE_PARTS = {
    'sofa_3seat': [
        ('seat', [2.8, 0.4, 0.9], [0, 0.2, 0], 'fabric'),
        ('back', [2.8, 0.5, 0.15], [0, 0.55, -0.38], 'fabric'),
        ('arm_l', [0.15, 0.4, 0.9], [-1.4, 0.4, 0], 'fabric'),
        ('arm_r', [0.15, 0.4, 0.9], [1.4, 0.4, 0], 'fabric'),
        ('cushion1', [0.8, 0.12, 0.65], [-0.85, 0.46, 0.02], 'fabric_light'),
        ('cushion2', [0.8, 0.12, 0.65], [0, 0.46, 0.02], 'fabric_light'),
        ('cushion3', [0.8, 0.12, 0.65], [0.85, 0.46, 0.02], 'fabric_light'),
        ('back_cushion1', [0.75, 0.35, 0.1], [-0.85, 0.55, -0.3], 'fabric_light'),
        ('back_cushion2', [0.75, 0.35, 0.1], [0, 0.55, -0.3], 'fabric_light'),
        ('back_cushion3', [0.75, 0.35, 0.1], [0.85, 0.55, -0.3], 'fabric_light'),
    ],
    'bed_180': [
        ('frame', [1.8, 0.3, 2.0], [0, 0.15, 0], 'wood'),
        ('headboard', [1.8, 0.8, 0.1], [0, 0.6, -0.95], 'fabric'),
        ('mattress', [1.7, 0.2, 1.9], [0, 0.35, 0.05], 'fabric_white'),
        ('duvet', [1.6, 0.08, 1.4], [0, 0.49, 0.25], 'fabric_white'),
        ('pillow_l', [0.55, 0.1, 0.35], [-0.4, 0.5, -0.65], 'fabric_white'),
        ('pillow_r', [0.55, 0.1, 0.35], [0.4, 0.5, -0.65], 'fabric_white'),
    ],
    'bed_150': [
        ('frame', [1.5, 0.3, 2.0], [0, 0.15, 0], 'wood'),
        ('headboard', [1.5, 0.8, 0.1], [0, 0.6, -0.95], 'fabric'),
        ('mattress', [1.4, 0.2, 1.9], [0, 0.35, 0.05], 'fabric_white'),
        ('duvet', [1.3, 0.08, 1.4], [0, 0.49, 0.25], 'fabric_white'),
        ('pillow_l', [0.45, 0.1, 0.35], [-0.32, 0.5, -0.65], 'fabric_white'),
        ('pillow_r', [0.45, 0.1, 0.35], [0.32, 0.5, -0.65], 'fabric_white'),
    ],
    'dining_table': [
        ('top', [1.4, 0.04, 0.8], [0, 0.75, 0], 'wood'),
        ('leg1', [0.05, 0.73, 0.05], [-0.6, 0.365, -0.3], 'wood_dark'),
        ('leg2', [0.05, 0.73, 0.05], [0.6, 0.365, -0.3], 'wood_dark'),
        ('leg3', [0.05, 0.73, 0.05], [-0.6, 0.365, 0.3], 'wood_dark'),
        ('leg4', [0.05, 0.73, 0.05], [0.6, 0.365, 0.3], 'wood_dark'),
    ],
    'dining_chair': [
        ('seat', [0.45, 0.04, 0.45], [0, 0.45, 0], 'wood'),
        ('back', [0.45, 0.4, 0.04], [0, 0.65, -0.2], 'wood'),
        ('leg1', [0.04, 0.45, 0.04], [-0.18, 0.225, -0.18], 'wood_dark'),
        ('leg2', [0.04, 0.45, 0.04], [0.18, 0.225, -0.18], 'wood_dark'),
        ('leg3', [0.04, 0.45, 0.04], [-0.18, 0.225, 0.18], 'wood_dark'),
        ('leg4', [0.04, 0.45, 0.04], [0.18, 0.225, 0.18], 'wood_dark'),
    ],
    'tv_stand': [
        ('body', [1.8, 0.4, 0.4], [0, 0.2, 0], 'wood_dark'),
        ('top', [1.8, 0.02, 0.42], [0, 0.41, 0], 'wood_dark'),
    ],
    # 去酒店感软装：65寸电视（放电视柜上，台面高 0.42）
    'tv_65': [
        ('foot', [0.5, 0.05, 0.25], [0, 0.445, 0], 'black_glass'),
        ('panel', [1.45, 0.82, 0.05], [0, 0.88, 0], 'black_glass'),
    ],
    # 落地灯（沙发南臂地插位）
    'floor_lamp': [
        ('base', [0.28, 0.03, 0.28], [0, 0.015, 0], 'metal'),
        ('pole', [0.03, 1.5, 0.03], [0, 0.78, 0], 'metal'),
        ('shade', [0.32, 0.24, 0.32], [0, 1.62, 0], 'fabric_light'),
    ],
    # 琴叶榕（东南角玻璃旁）
    'plant_fiddle': [
        ('pot', [0.36, 0.35, 0.36], [0, 0.175, 0], 'ceramic'),
        ('trunk', [0.04, 0.9, 0.04], [0, 0.75, 0], 'wood_dark'),
        ('leaf1', [0.5, 0.55, 0.5], [-0.15, 1.3, 0.1], 'plant'),
        ('leaf2', [0.45, 0.5, 0.45], [0.2, 1.45, -0.1], 'plant'),
        ('leaf3', [0.4, 0.45, 0.4], [0.0, 1.62, 0.05], 'plant'),
    ],
    # 玄关餐边一体柜（通顶三段式：底架空 0.15 + 浅门下柜 + 深胡桃开放格 + 浅门上柜）
    'shoe_cabinet': [
        ('lower', [1.5, 0.75, 0.35], [0, 0.525, 0], 'paint_cream'),
        ('niche', [1.5, 0.5, 0.03], [0, 1.15, -0.16], 'wood_dark'),
        ('upper', [1.5, 1.0, 0.35], [0, 1.9, 0], 'paint_cream'),
    ],
    # 入户花园可移动换鞋站（三门矮鞋柜 + 自立浅色洞洞板孔阵，与 web FixtureFactory 同步）
    'garden_entry_station': [
        ('foot_fl', [0.05, 0.08, 0.05], [-0.48, 0.04, 0.12], 'wood_dark'),
        ('foot_fr', [0.05, 0.08, 0.05], [0.48, 0.04, 0.12], 'wood_dark'),
        ('foot_bl', [0.05, 0.08, 0.05], [-0.48, 0.04, -0.12], 'wood_dark'),
        ('foot_br', [0.05, 0.08, 0.05], [0.48, 0.04, -0.12], 'wood_dark'),
        ('shoe_body', [1.1, 0.72, 0.34], [0, 0.44, 0], 'wood'),
        ('door_l', [0.348, 0.64, 0.018], [-0.36, 0.45, 0.172], 'paint_cream'),
        ('door_m', [0.348, 0.64, 0.018], [0, 0.45, 0.172], 'paint_cream'),
        ('door_r', [0.348, 0.64, 0.018], [0.36, 0.45, 0.172], 'paint_cream'),
        ('pull_l', [0.09, 0.02, 0.015], [-0.36, 0.72, 0.185], 'wood_dark'),
        ('pull_m', [0.09, 0.02, 0.015], [0, 0.72, 0.185], 'wood_dark'),
        ('pull_r', [0.09, 0.02, 0.015], [0.36, 0.72, 0.185], 'wood_dark'),
        ('shoe_top', [1.16, 0.04, 0.38], [0, 0.82, 0], 'wood_dark'),
        ('pegboard', [1.1, 1.0, 0.025], [0, 1.34, -0.155], 'paint_cream'),
        *[(f'hole_{r}_{c}', [0.028, 0.028, 0.008], [-0.48 + c * 0.12, 0.94 + r * 0.12, -0.138], 'door_gap')
          for r in range(8) for c in range(9)],
        ('stand_l', [0.05, 1.85, 0.05], [-0.5, 0.925, -0.155], 'metal_black'),
        ('stand_r', [0.05, 1.85, 0.05], [0.5, 0.925, -0.155], 'metal_black'),
    ],
    # 门内右手定制半高柜：向客厅延伸，玄关侧封闭、餐厅侧开放，柜顶以上保持视线通透。
    'entry_half_height_cabinet': [
        ('lower', [2.0, 0.88, 0.35], [0, 0.44, 0], 'paint_cream'),
        ('top', [2.04, 0.04, 0.39], [0, 0.90, 0], 'wood_dark'),
        ('side_n', [0.08, 0.56, 0.35], [-0.96, 1.18, 0], 'paint_cream'),
        ('side_s', [0.08, 0.56, 0.35], [0.96, 1.18, 0], 'paint_cream'),
        ('upper', [1.76, 0.08, 0.35], [0, 1.46, 0], 'paint_cream'),
        ('dining_back', [1.76, 0.50, 0.025], [0, 1.18, 0.162], 'wood_dark'),
        ('dining_shelf', [1.76, 0.04, 0.31], [0, 1.00, 0.0], 'wood_dark'),
        ('entry_panel', [1.76, 0.50, 0.02], [0, 1.18, 0.186], 'paint_cream'),
    ],
    # 西墙实体墙段通顶柜（z=5.55-6.90，不进入餐厅/门厅）
    'wall_cabinet_tall': [
        ('lower', [1.35, 1.1, 0.35], [0, 0.55, 0], 'paint_cream'),
        ('niche', [1.35, 0.5, 0.03], [0, 1.35, -0.16], 'wood_dark'),
        ('upper', [1.35, 1.3, 0.35], [0, 2.25, 0], 'paint_cream'),
    ],
    # 西墙 TV 区（z=6.90-9.00）：仅保留独立深胡桃悬空低柜。
    # 西墙本体由 classify() → wall 使用暖白乳胶漆；电视由独立 tv_65 生成。
    # 不生成高于低柜的深色背板，避免把整面墙误读为电视背景墙。
    'tv_wall_low': [
        ('low', [2.1, 0.35, 0.4], [0, 0.325, 0], 'wood_dark'),
    ],
    # 主茶几（DEC-026 改款：圆形深木面+黑细柱，稳重克制；v14 精炼：更薄更轻）
    'coffee_table': [
        ('top', [0.8, 0.03, 0.8], [0, 0.38, 0], 'wood_dark', 'cylinder'),
        ('base', [0.35, 0.35, 0.35], [0, 0.175, 0], 'metal_black', 'cylinder'),
    ],
    'wardrobe_180': [
        ('carcass', [1.8, 2.7, 0.58], [0, 1.35, 0], 'paint_cream'),
        ('door_l', [0.88, 2.66, 0.03], [-0.45, 1.35, 0.30], 'paint_cream'),
        ('door_r', [0.88, 2.66, 0.03], [0.45, 1.35, 0.33], 'paint_cream'),
        ('handle_l', [0.03, 1.2, 0.03], [-0.04, 1.35, 0.33], 'wood_dark'),
        ('handle_r', [0.03, 1.2, 0.03], [0.04, 1.35, 0.36], 'wood_dark'),
    ],
    'wardrobe_240_split': [
        ('carcass', [2.4, 2.7, 0.58], [0, 1.35, 0], 'paint_cream'),
        ('door_l', [1.18, 2.66, 0.03], [-0.6, 1.35, 0.30], 'paint_cream'),
        ('door_r', [1.18, 2.66, 0.03], [0.6, 1.35, 0.33], 'paint_cream'),
        ('handle_l', [0.03, 1.2, 0.03], [-0.04, 1.35, 0.33], 'wood_dark'),
        ('handle_r', [0.03, 1.2, 0.03], [0.04, 1.35, 0.36], 'wood_dark'),
    ],
    'fridge': [
        ('body', [0.68, 1.8, 0.66], [0, 0.9, 0], 'metal'),
        ('door_up', [0.66, 0.62, 0.04], [0, 1.44, 0.35], 'metal'),
        ('door_lo', [0.66, 1.08, 0.04], [0, 0.6, 0.35], 'metal'),
    ],
    'gas_stove': [
        # 嵌入式灶：台面（顶 0.88）已开孔 0.75×0.45，面板坐台面齐平
        ('cooktop', [0.75, 0.02, 0.45], [0, 0.89, 0], 'black_glass'),
        ('burner1', [0.16, 0.01, 0.16], [-0.18, 0.905, 0], 'metal'),
        ('burner2', [0.16, 0.01, 0.16], [0.18, 0.905, 0], 'metal'),
    ],
    'range_hood': [
        ('panel', [0.8, 0.5, 0.06], [0, 1.5, 0.12], 'metal'),
        ('duct', [0.4, 0.9, 0.35], [0, 2.2, 0], 'metal'),
    ],
    'sink': [
        # 台下盆：台面（顶 0.88）已开孔 0.70×0.40，盆体挂台面下，压边条贴台面
        ('basin', [0.68, 0.18, 0.38], [0, 0.79, 0], 'metal'),
        ('rim', [0.74, 0.01, 0.44], [0, 0.882, 0], 'metal'),
        ('faucet_v', [0.03, 0.3, 0.03], [0, 1.0, -0.18], 'metal'),
        ('faucet_h', [0.03, 0.03, 0.2], [0, 1.14, -0.1], 'metal'),
    ],
    # 2026-08-23 补电器缺员（阳台洗烘叠放/厨下洗碗机/阳台壁挂热水器，点位对齐水电配置；
    # BlenderKit 真模型下载后走 FURNITURE_GLB 自动替换，以下为回退程序化几何）
    'washer': [
        ('body', [0.60, 0.85, 0.60], [0, 0.425, 0], 'ceramic'),
        ('door', [0.48, 0.48, 0.03], [0, 0.45, 0.29], 'black_glass'),
        ('top', [0.60, 0.02, 0.60], [0, 0.86, 0], 'metal'),
    ],
    # 烘干机叠放于洗衣机上（支架层 y≈0.88，总高 ≈1.73m）
    'dryer': [
        ('body', [0.60, 0.85, 0.60], [0, 1.305, 0], 'ceramic'),
        ('door', [0.48, 0.48, 0.03], [0, 1.33, 0.29], 'black_glass'),
    ],
    # 厨下洗碗机（北墙地柜留位 x∈[8.5,9.1]，上方台面连续）
    'dishwasher': [
        ('body', [0.60, 0.82, 0.58], [0, 0.41, 0], 'metal'),
        ('front', [0.58, 0.68, 0.02], [0, 0.44, 0.29], 'black_glass'),
    ],
    # 燃气壁挂炉（⚠️暂定位，pending-site-data #26 未定案）：挂墙底 1.4 顶 1.9，下出管
    'water_heater': [
        ('body', [0.36, 0.55, 0.16], [0, 1.65, 0], 'ceramic'),
        ('display', [0.20, 0.10, 0.02], [0, 1.55, 0.085], 'black_glass'),
        ('pipe', [0.05, 0.30, 0.05], [0, 1.22, 0], 'metal'),
    ],
}


def build_furniture_materials(hex_rgb_fn, new_principled_fn) -> dict:
    """中古胡桃方向家具材质（DEC-2026-08-20-025）：深胡桃/黑皮/奶油墙面作衬。
    （原为法式奶油：羊羔绒/白漆木；沙发/餐椅已 GLB 化不吃这套色，剩余程序部件用）"""
    mats = {}
    # 羊羔绒沙发面料（奶油色 + 细微织物纹理 bump）
    for name, color, rough in [
        ('fabric', '#d4cdb8', 0.9),       # 沙发主体（奶油灰）
        ('fabric_light', '#e8e0d2', 0.85), # 坐垫/靠垫（浅奶油）
        ('fabric_white', '#f5f0e6', 0.85), # 床品（白奶油）
        ('wood', '#c9a87e', 0.5),          # 浅橡木家具
        ('wood_dark', '#503e2e', 0.45),    # 深胡桃（电视柜/桌腿/框架，中古方向）
        ('paint_cream', '#f2ede2', 0.5),   # PET 肤感柜门/柜体（哑光+细微 bump，见下；原奶油白漆）
    ]:
        mat = new_principled_fn(f'家具_{name}', hex_rgb_fn(color), rough=rough)
        if name.startswith('fabric'):
            try:
                nt = mat.node_tree
                bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
                if bsdf:
                    noise = nt.nodes.new('ShaderNodeTexNoise')
                    noise.inputs['Scale'].default_value = 200.0
                    noise.inputs['Detail'].default_value = 4.0
                    bump = nt.nodes.new('ShaderNodeBump')
                    bump.inputs['Strength'].default_value = 0.25
                    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
                    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
            except Exception:
                pass
        mats[name] = mat
    mats['metal'] = new_principled_fn('家具_metal', hex_rgb_fn('#c8ccd0'), rough=0.35, metallic=1.0)
    _add_brushed_metal(mats['metal'])  # 电器金属件（冰箱/烟机/龙头）拉丝纹理，去"白模盒子"感
    mats['metal_black'] = new_principled_fn('家具_metal_black', hex_rgb_fn('#171412'), rough=0.35, metallic=0.85)
    # 黑玻璃（灶面/电视屏）：加 clearcoat 出镜面反射层，避免死黑平板
    mats['black_glass'] = new_principled_fn('家具_black_glass', hex_rgb_fn('#1a1a1c'), rough=0.08, coat=0.5)
    mats['quartz'] = new_principled_fn('家具_quartz', hex_rgb_fn('#e8e6e0'), rough=0.25)
    mats['ceramic'] = new_principled_fn('家具_ceramic', hex_rgb_fn('#f8f8f6'), rough=0.1)
    mats['plant'] = new_principled_fn('家具_plant', hex_rgb_fn('#5a6b4a'), rough=0.7)  # 琴叶榕叶绿
    # 柜门分缝条：深灰哑光细条读出凹槽阴影（假凹槽，比布尔开槽稳定）
    mats['door_gap'] = new_principled_fn('柜门_分缝', hex_rgb_fn('#35302a'), rough=0.9)
    _add_pet_bump(mats['paint_cream'])
    return mats


def _add_brushed_metal(mat) -> None:
    """拉丝金属：纵向拉伸 Noise → 细弱各向异性 bump（冰箱/烟机/龙头等电器金属件）。"""
    if mat is None or not getattr(mat, 'use_nodes', False):
        return
    try:
        nt = mat.node_tree
        bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
        if bsdf is None:
            return
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.noise_dimensions = '3D'
        tex.inputs['Scale'].default_value = 15.0
        tex.inputs['Detail'].default_value = 2.0
        tex.inputs['Roughness'].default_value = 0.7
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (4.0, 4.0, 150.0)  # 纵向拉丝
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.15
        bump.inputs['Distance'].default_value = 0.0002
        nt.links.new(geo.outputs['Position'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    except Exception:
        pass


def _add_pet_bump(mat) -> None:
    """PET 肤感饰面：哑光纯色 + 极细微 bump（肤感膜橘皮触感）。"""
    if mat is None or not getattr(mat, 'use_nodes', False):
        return
    try:
        nt = mat.node_tree
        bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
        if bsdf is None:
            return
        if any(n.bl_idname == 'ShaderNodeBump' for n in nt.nodes):
            return  # 已有 bump（如 paint_cream 兜底复用），不重复叠加
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 320.0
        noise.inputs['Detail'].default_value = 2.0
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.08
        bump.inputs['Distance'].default_value = 0.0005
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    except Exception:
        pass


# 定制柜柜门分缝布局（three 局部坐标 (x0, x1, y0, y1, front_z)，front 朝 +z 面）。
# 按 400-500mm 标准门宽在正面生成 4mm 宽分缝条（几何假凹槽，比布尔/贴图稳定）。
# 衣柜（wardrobe_180/240_split）为推拉门（DEC-013），door_l/door_r 已是分体门板，
# 0.88/1.18m 属推拉门标准门宽，不再加假分缝（加了会误读为平开门），饰面走 paint_cream PET。
# Asset replacement data is owned by blender_assets; keep a compatibility alias for callers.
FURNITURE_GLB = _blender_assets.FURNITURE_GLB

CABINET_SEAM_PANELS = {
    # 西墙通顶柜：下柜 1.35m→3门 / 上柜 1.35m→3门（中间开放格不动）
    'wall_cabinet_tall': [
        (-0.675, 0.675, 0.0, 1.10, 0.175),
        (-0.675, 0.675, 1.60, 2.90, 0.175),
    ],
    # 西墙 TV 悬空低柜：2.1m→5门（front z=0.20）
    'tv_wall_low': [
        (-1.05, 1.05, 0.15, 0.50, 0.20),
    ],
    # 入户半高柜：下柜双面（玄关侧 +z / 餐厅侧 -z）2.0m→4门
    'entry_half_height_cabinet': [
        (-1.0, 1.0, 0.0, 0.88, 0.175),
        (-1.0, 1.0, 0.0, 0.88, -0.175),
    ],
}

# bare_shell（硬装裸房验收）保留的 furniture 类型：定制柜/橱柜/水槽等硬装件；
# 其余 furniture:*（沙发/床/桌椅/冰箱/灶台烟机/绿植/落地灯/换鞋站等可移动件）隐藏
BARE_SHELL_KEEP = {'wall_cabinet_tall', 'tv_wall_low', 'entry_half_height_cabinet',
                   'shoe_cabinet', 'wardrobe_180', 'wardrobe_240_split',
                   'kitchen_cabinet_run', 'sink'}

BARE_SHELL_ASSET_HIDE_PREFIXES = (
    'asset:rug:', 'asset:art:', 'asset:sofa', 'asset:bed', 'asset:dining',
    'asset:plant', 'asset:floor_lamp', 'asset:tv_',
    # 独立导入的可移动家电；固定橱柜/硬装不使用这些前缀。
    'asset:fridge', 'asset:washer', 'asset:dryer', 'asset:dishwasher',
    'asset:gas_stove', 'asset:range_hood', 'asset:water_heater',
    'asset:microwave', 'asset:oven', 'asset:cooktop', 'asset:stove',
    'asset:hood',
)


_CURTAIN_HIDE_RENDER_SNAPSHOT: dict[str, bool] = {}
_PREVIEW_ROOM: str | None = None
_PREVIEW_SCOPE_STATS: dict | None = None


def _purge_preview_orphan_meshes() -> dict:
    """清理 preview 删除遗留的 orphan mesh，并返回 purge 统计。"""
    purge = getattr(_blender_preview, 'safe_cleanup_orphan_meshes', None)
    if not callable(purge):
        return {'status': 'unavailable', 'candidates': 0, 'removed': 0, 'skipped': 0}
    result = purge(bpy)
    return {'status': 'ok', **result}


def _object_room_id(obj) -> str | None:
    """Read an explicit room id from asset metadata or stable exporter names."""
    for key in ('formalInstanceKey', 'instance_key', 'roomId', 'room_id', 'room'):
        value = _metadata_value(obj, key)
        if isinstance(value, str):
            parts = value.split(':')
            if len(parts) >= 4 and parts[0] == 'furniture':
                return parts[1]
            if key in {'roomId', 'room_id', 'room'} and value:
                return value
    name = getattr(obj, 'name', '')
    match = re.match(r'^furniture:([^:]+):', name)
    if match:
        return match.group(1)
    match = re.match(r'^asset:([^:]+):', name)
    if match and match.group(1) in {
        'guest_bath', 'entry_garden', 'kitchen', 'study', 'bedroom_nw', 'living_dining',
    }:
        return match.group(1)
    match = re.match(r'^floor:([^:.]+)', name)
    return match.group(1) if match else None


def _apply_preview_scope(preview_room: str | None) -> None:
    """Delete imported preview objects outside the selected room before dressing.

    Untagged architectural GLB objects remain available; generated assets are
    constrained again after staging so formal mode keeps its existing behavior.
    """
    global _PREVIEW_ROOM, _PREVIEW_SCOPE_STATS
    _PREVIEW_ROOM = preview_room
    _PREVIEW_SCOPE_STATS = None
    if not preview_room:
        return
    scope = _blender_preview.parse_scope({'rooms': preview_room})
    stats = _blender_preview.safe_delete_preview_objects(
        bpy.data.objects, scope, action='delete'
    )
    stats['purge'] = _purge_preview_orphan_meshes()
    _PREVIEW_SCOPE_STATS = stats
    print(f'[dress_scene] preview scope room={preview_room} '
          f'deleted_imported={stats["deleted_count"]} '
          f'cropped={stats["cropped_count"]} failed={stats["failed_count"]}')


def _enforce_preview_scope() -> None:
    """Hide staged/replacement assets outside the selected preview room."""
    if not _PREVIEW_ROOM:
        return
    hidden = 0
    for obj in bpy.data.objects:
        room_id = _object_room_id(obj)
        if room_id and room_id != _PREVIEW_ROOM:
            _set_recursive_hidden(obj, True)
            hidden += 1
        elif obj.name.startswith('hvac:'):
            _set_recursive_hidden(obj, True)
            hidden += 1
    print(f'[dress_scene] preview scope enforced room={_PREVIEW_ROOM} hidden_assets={hidden}')


def _curtain_hide_render_snapshot(objects) -> dict[str, bool]:
    """记录 GLB 窗帘节点及其子节点的初始 hide_render 状态。"""
    snapshot = {}
    for obj in objects:
        if not parse_curtain_node_name(obj.name):
            continue
        snapshot[obj.name] = obj.hide_render
        for child in getattr(obj, 'children_recursive', ()):
            snapshot[child.name] = child.hide_render
    return snapshot


def _restore_curtain_hide_render(objects, snapshot: dict[str, bool]) -> None:
    """按 GLB 初始快照恢复窗帘节点及其子节点，保留 active-only 隐藏状态。"""
    for obj in objects:
        if obj.name in snapshot:
            obj.hide_render = snapshot[obj.name]


def _furniture_type_from_object(obj) -> str | None:
    """从对象自身或父链读取稳定 furniture:<type> 命名。"""
    current = obj
    while current is not None:
        parts = current.name.split(':')
        if len(parts) >= 3 and parts[0] == 'furniture':
            return parts[2]
        current = getattr(current, 'parent', None)
    return None


def _furniture_instance_key(obj) -> str | None:
    """读取家具实例的稳定四段 key，不把 geometry 子节点当成新实例。"""
    parts = obj.name.split(':')
    if len(parts) >= 4 and parts[0] == 'furniture':
        return ':'.join(parts[:4])
    return None


def _furniture_instance_anchors(objects):
    """按 furniture:<room>:<type>:<index> 收集每个实例唯一的 root/anchor。

    导出的 geometry 子节点会在同一四段 key 后继续追加路径；优先采用
    名称恰好等于 key 的 root，否则沿 parent 链选同 key 的最上层节点。
    """
    candidates = {}
    for obj in objects:
        key = _furniture_instance_key(obj)
        if key is None:
            continue
        if _PREVIEW_ROOM and _object_room_id(obj) != _PREVIEW_ROOM:
            continue
        current = obj
        while True:
            parent = getattr(current, 'parent', None)
            if parent is None or _furniture_instance_key(parent) != key:
                break
            current = parent
        candidates.setdefault(key, []).append((current.name != key, current))

    anchors = {}
    for key, items in candidates.items():
        # exact root wins; otherwise the first parent-chain anchor is stable.
        items.sort(key=lambda item: item[0])
        anchors[key] = items[0][1]
    return anchors


def _hide_furniture_instance_family(instance_key: str, hidden: bool = True) -> int:
    """按完整 formal instance key 隐藏 GLB 导出的整组 mesh，不依赖 parent links。"""
    count = 0
    for obj in bpy.data.objects:
        if _furniture_instance_key(obj) == instance_key:
            obj.hide_render = hidden
            count += 1
    return count


def _is_render_only(obj) -> bool:
    """读取 Blender custom property；纯 Python 测试对象没有 bpy 属性时默认 False。"""
    getter = getattr(obj, 'get', None)
    return bool(getter('render_only', False)) if getter is not None else False


def bare_shell_should_hide(obj) -> bool:
    """判断裸壳工况是否隐藏对象；render-only staging 不属于正式设计清单。"""
    if _is_render_only(obj):
        return True
    furniture_type = _furniture_type_from_object(obj)
    if furniture_type is not None:
        return furniture_type not in BARE_SHELL_KEEP
    return obj.name.startswith(BARE_SHELL_ASSET_HIDE_PREFIXES)


def _add_cabinet_seams(ftype: str, base, rz: float, gap_mat) -> int:
    """Compatibility wrapper for the legacy cabinet seam helper."""
    _configure_legacy_geometry()
    return _legacy_geometry._add_cabinet_seams(ftype, base, rz, gap_mat)


def add_pbr_maps(mat, tex_dir, size=2.0, with_diffuse=False, normal_strength=0.5, tint=None):
    """给已有材质接 PBR 贴图（世界坐标 BOX 投影，免 UV）。
    with_diffuse=False 时保留原 base color（墙面保色号决策），只加 normal+rough。"""
    tex_dir = os.path.normpath(tex_dir)
    if mat is None or not os.path.isdir(tex_dir):
        return False
    nt = mat.node_tree
    bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
    if bsdf is None:
        return False
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1.0 / size,) * 3
    nt.links.new(geo.outputs['Position'], mapping.inputs['Vector'])

    def img_node(fn, noncolor):
        p = os.path.join(tex_dir, fn)
        # 0 字节坏文件（下载残留）直接跳过，防品红
        if not os.path.exists(p) or os.path.getsize(p) == 0:
            return None
        img = bpy.data.images.load(p)
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.projection = 'BOX'
        n.projection_blend = 0.3
        if noncolor:
            img.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], n.inputs['Vector'])
        return n

    nm = img_node('normal.jpg', True)
    if nm:
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = normal_strength
        nt.links.new(nm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    rm = img_node('rough.jpg', True)
    if rm:
        nt.links.new(rm.outputs['Color'], bsdf.inputs['Roughness'])
    if with_diffuse:
        dm = img_node('diff.jpg', False)
        if dm:
            if tint:
                # diff 乘色压目标色号（浅橡木×深胡桃=带木纹的深胡桃）
                mul = nt.nodes.new('ShaderNodeMixRGB')
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Fac'].default_value = 1.0
                mul.inputs['Color2'].default_value = (*hex_rgb(tint), 1.0)
                nt.links.new(dm.outputs['Color'], mul.inputs['Color1'])
                nt.links.new(mul.outputs['Color'], bsdf.inputs['Base Color'])
            else:
                nt.links.new(dm.outputs['Color'], bsdf.inputs['Base Color'])
    return True


def place_extra_furniture(furniture_mats: dict, config_dir: str, plumbing: dict,
                          only_types: set | None = None) -> int:
    """Compatibility wrapper for the LEGACY furniture geometry escape hatch."""
    _configure_legacy_geometry()
    return _legacy_geometry.place_extra_furniture(furniture_mats, config_dir, plumbing, only_types)


def add_ceiling(ceiling: list, ceiling_mats: dict) -> int:
    """Compatibility wrapper for the LEGACY ceiling geometry escape hatch."""
    _configure_legacy_geometry()
    return _legacy_geometry.add_ceiling(ceiling, ceiling_mats)


def add_kitchen_cabinets(cream, quartz, plumbing: dict, gap=None) -> int:
    """Compatibility wrapper for the LEGACY kitchen geometry escape hatch."""
    _configure_legacy_geometry()
    return _legacy_geometry.add_kitchen_cabinets(cream, quartz, plumbing, gap)


def _add_cylinder(name: str, radius: float, depth: float, location: tuple,
                  mat, vertices: int = 12) -> int:
    """Compatibility wrapper for the legacy cylinder helper."""
    _configure_legacy_geometry()
    return _legacy_geometry._add_cylinder(name, radius, depth, location, mat, vertices)


def _add_shower_fixture(prefix: str, anchor: dict, mat) -> int:
    """Compatibility wrapper for the legacy shower fixture helper."""
    _configure_legacy_geometry()
    return _legacy_geometry._add_shower_fixture(prefix, anchor, mat)


MASTER_BATH_FINAL_LAYOUT = {
    # DEC-2026-08-25-043：条带洗漱梳妆一体台；正式半墙/长虹屏风由 shared overlay/GLB 提供。
    'vanity_size': (1.10, 0.50),
    'vanity_center_from_anchor': (0.29, 0.20),
    'partition_x': 1.11,
    'partition_z_range': (2.26, 2.86),
    'partition_height': 1.05,
    'screen_height_range': (1.05, 2.10),
}


def master_bath_final_layout() -> dict:
    """返回 DEC-043 已收口的主卫装扮尺寸；不读取或修改权威几何配置。"""
    return {
        'vanity_size': MASTER_BATH_FINAL_LAYOUT['vanity_size'],
        'vanity_center_from_anchor': MASTER_BATH_FINAL_LAYOUT['vanity_center_from_anchor'],
        'partition_x': MASTER_BATH_FINAL_LAYOUT['partition_x'],
        'partition_z_range': MASTER_BATH_FINAL_LAYOUT['partition_z_range'],
        'partition_height': MASTER_BATH_FINAL_LAYOUT['partition_height'],
        'screen_height_range': MASTER_BATH_FINAL_LAYOUT['screen_height_range'],
    }


def add_bath_fixtures(furniture_mats: dict, plumbing: dict) -> int:
    """Compatibility wrapper for the LEGACY bath geometry escape hatch."""
    _configure_legacy_geometry()
    return _legacy_geometry.add_bath_fixtures(furniture_mats, plumbing)


def parse_molding_declarations(overlay: dict) -> list[dict]:
    """读取 overlay 中的显式 molding 声明；未声明时返回空列表。

    仅接受 ``moldings`` 列表中的 wall/walls 或 room 目标和
    baseboard/crown/picture_rail 类型。suppress 是删除意图，不会被解释为
    molding 声明，也不会反向生成任何装饰线。
    """
    if not isinstance(overlay, dict) or not isinstance(overlay.get('moldings'), list):
        return []
    allowed_types = {'baseboard', 'crown', 'picture_rail'}
    declarations = []
    for item in overlay['moldings']:
        if not isinstance(item, dict) or item.get('type') not in allowed_types:
            continue
        targets = []
        if isinstance(item.get('wall'), str):
            targets.append({'wall': item['wall']})
        for wall in item.get('walls', []):
            if isinstance(wall, str):
                targets.append({'wall': wall})
        if isinstance(item.get('room'), str):
            targets.append({'room': item['room']})
        for target in targets:
            declarations.append({'type': item['type'], **target})
    return declarations


def room_boundary_wall_ids(geometry: dict, room_id: str) -> list[str]:
    """Return walls whose endpoints exactly match a room boundary edge."""
    if not isinstance(geometry, dict) or not isinstance(room_id, str):
        return []
    room = next((item for item in geometry.get('rooms', [])
                 if isinstance(item, dict) and item.get('id') == room_id), None)
    boundary = room.get('boundary') if room else None
    if not isinstance(boundary, list) or len(boundary) < 2:
        return []
    boundary_edges = {
        frozenset((boundary[index], boundary[(index + 1) % len(boundary)]))
        for index in range(len(boundary))
        if isinstance(boundary[index], str) and isinstance(boundary[(index + 1) % len(boundary)], str)
    }
    if not boundary_edges:
        return []
    wall_ids = []
    for wall in geometry.get('walls', []):
        if not isinstance(wall, dict) or not isinstance(wall.get('id'), str):
            continue
        endpoints = (wall.get('from'), wall.get('to'))
        if all(isinstance(endpoint, str) for endpoint in endpoints) and frozenset(endpoints) in boundary_edges:
            wall_ids.append(wall['id'])
    return wall_ids


def add_moldings(config_dir: str) -> int:
    """仅按 overlay 的显式 molding 声明生成装饰线；没有声明则关闭。"""
    import yaml as pyyaml
    import math

    geo_path = os.path.join(config_dir, 'config', 'layout', 'model-geometry.yaml')
    overlay_path = os.path.join(config_dir, 'config', 'layout', 'overlay.yaml')
    if not os.path.exists(geo_path) or not os.path.exists(overlay_path):
        return 0
    with open(geo_path, 'r', encoding='utf-8') as f:
        geo = pyyaml.safe_load(f) or {}
    with open(overlay_path, 'r', encoding='utf-8') as f:
        ov = pyyaml.safe_load(f) or {}
    declarations = parse_molding_declarations(ov)
    if not declarations:
        print('[dress_scene] moldings: 0 (no explicit declarations)')
        return 0
    suppressed = set()
    for s in ov.get('suppress', []):
        if not isinstance(s, dict):
            continue
        suppressed.update(s.get('walls') or ([s['wall']] if s.get('wall') else []))
    by_wall = {}
    for declaration in declarations:
        if 'wall' in declaration:
            wall_ids = [declaration['wall']]
        else:
            wall_ids = room_boundary_wall_ids(geo, declaration.get('room'))
        for wall_id in wall_ids:
            by_wall.setdefault(wall_id, set()).add(declaration['type'])
    verts = {v['id']: (v['x'], v['z']) for v in geo.get('vertices', [])}
    walls = geo.get('walls', [])
    wall_by_id = {wall['id']: wall for wall in walls if isinstance(wall, dict) and 'id' in wall}
    cx, cz = 8.0, 6.0  # 房屋大致中心，判断室内侧
    dimensions = {
        'baseboard': (0.08, 0.0),
        'crown': (0.10, 2.70),
        'picture_rail': (0.02, 1.00),
    }
    THICK = 0.025
    OFFSET = 0.07  # 墙厚/2 + 间隙
    count = 0
    for wall_id, molding_types in by_wall.items():
        wall = wall_by_id.get(wall_id)
        if not wall or wall_id in suppressed:
            continue
        f = verts.get(wall['from'])
        t = verts.get(wall['to'])
        if not f or not t:
            continue
        x1, z1 = f
        x2, z2 = t
        dx, dz = x2 - x1, z2 - z1
        length = math.sqrt(dx * dx + dz * dz)
        if length < 0.3:
            continue
        angle = math.atan2(-(z2 - z1), x2 - x1)  # three(x,z) → Blender(x,-z)
        # 法线方向（朝室内）
        nx, nz = dz / length, -dx / length
        mx, mz = (x1 + x2) / 2, (z1 + z2) / 2
        if (cx - mx) * nx + (cz - mz) * nz < 0:
            nx, nz = -nx, -nz
        ox, oz = mx + nx * OFFSET, mz + nz * OFFSET
        for name in sorted(molding_types):
            mh, base_y = dimensions[name]
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            box = bpy.context.object
            box.name = f'molding:{name}:{wall_id}'
            box.dimensions = (length, THICK, mh)
            box.location = to_blender(ox, base_y + mh / 2, oz)
            box.rotation_euler = (0, 0, angle)
            count += 1
    print(f'[dress_scene] moldings: {count} (explicit declarations only)')
    return count


def railing_bbox_is_rebuildable(dx: float, dy: float) -> bool:
    """包围盒可近似为直线栏杆时才允许生成一排竖杆。"""
    return not (dx > 0.5 and dy > 0.5)


def curved_railing_path(points: list[tuple[float, float]], min_points: int = 8) -> list[tuple[float, float]]:
    """从栏杆底面 world 顶点提取单调曲线路径；证据不足时返回空列表。

    当前 GLB 的 VRV 弧段沿 x 单调展开，底面顶点包含两条薄板边缘；按细 x-bin
    取中线可去掉板厚，同时仍完全由 mesh 顶点决定，不按配置硬编码弧形。
    """
    if len(points) < min_points:
        return []
    xs = [p[0] for p in points]
    span = max(xs) - min(xs)
    if span < 0.5:
        return []
    bins: dict[int, list[tuple[float, float]]] = {}
    for x, y in points:
        key = round(x / 0.01)
        bins.setdefault(key, []).append((x, y))
    path = [(sum(x for x, _ in ps) / len(ps), sum(y for _, y in ps) / len(ps))
            for ps in (bins[k] for k in sorted(bins))]
    if len(path) < min_points:
        return []
    if any(path[i][0] >= path[i + 1][0] for i in range(len(path) - 1)):
        return []
    length = sum(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
                 for i in range(len(path) - 1))
    if not (0.5 <= length <= 10.0):
        return []
    return path


def _metadata_value(obj, key: str, default=None):
    """Read Blender custom properties, tolerating lightweight test doubles."""
    try:
        return obj.get(key, default)
    except (AttributeError, TypeError):
        return getattr(obj, key, default)


def _railing_has_shared_parts(root) -> bool:
    """Whether a GLB railing root already owns shared handrail and bars."""
    if _metadata_value(root, 'type') != 'railing_run':
        return False
    has_handrail = False
    has_bar = False
    objects = [root, *list(getattr(root, 'children_recursive', ()))]
    for obj in objects:
        part = _metadata_value(obj, 'part')
        if part == 'handrail':
            has_handrail = True
        elif isinstance(part, str) and part.startswith('bar:'):
            has_bar = True
    return has_handrail and has_bar


def _shared_railing_objects() -> set:
    """Return all objects belonging to shared railing roots, by metadata only."""
    shared = set()
    for root in bpy.data.objects:
        if _railing_has_shared_parts(root):
            shared.update([root, *list(getattr(root, 'children_recursive', ()))])
    return shared


def rebuild_railings(mats: dict) -> int:
    """Prefer shared railing parts; enable the LEGACY solid fallback only when absent.

    Shared railing parts are preserved, while solid-only meshes are rebuilt only when no
    shared parts are present for that railing. This function remains in the Blender
    post-processing path for backward-compatible GLB inputs.
    """
    import mathutils
    rail_mat = mats.get('railing')
    rebuilt = 0
    shared_objects = _shared_railing_objects()
    for obj in list(bpy.data.objects):
        if obj in shared_objects or obj.type != 'MESH' or 'railing' not in obj.name or obj.name.startswith('railing:'):
            continue
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        xs = [c.x for c in corners]
        ys = [c.y for c in corners]
        zs = [c.z for c in corners]
        dx, dy = max(xs) - min(xs), max(ys) - min(ys)
        z0, z1 = min(zs), max(zs)
        obj.hide_render = True
        h = z1 - z0
        if not railing_bbox_is_rebuildable(dx, dy):
            bottom = []
            for vertex in obj.data.vertices:
                p = obj.matrix_world @ vertex.co
                if abs(p.z - z0) <= 0.025:
                    bottom.append((p.x, p.y))
            path = curved_railing_path(bottom)
            if not path:
                print(f'[dress_scene] WARN: curved railing {obj.name} lacks safe mesh path; solid panel hidden')
                continue
            curve = bpy.data.curves.new(f'railing:{obj.name}:handrail', 'CURVE')
            curve.dimensions = '3D'
            curve.resolution_u = 1
            curve.bevel_depth = 0.03
            curve.resolution_v = 1
            spline = curve.splines.new('POLY')
            spline.points.add(len(path) - 1)
            for point, (px, py) in zip(spline.points, path):
                point.co = (px, py, z1 - 0.025, 1.0)
            handrail = bpy.data.objects.new(f'railing:{obj.name}:handrail', curve)
            bpy.context.collection.objects.link(handrail)
            if rail_mat:
                curve.materials.append(rail_mat)
            total = sum(math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1])
                        for i in range(len(path) - 1))
            n_bars = max(2, int(total / 0.13) + 1)
            for i in range(n_bars):
                target = total * i / (n_bars - 1)
                travelled = 0.0
                for j in range(len(path) - 1):
                    seg = math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1])
                    if travelled + seg >= target:
                        ratio = (target - travelled) / seg if seg else 0.0
                        px = path[j][0] + (path[j + 1][0] - path[j][0]) * ratio
                        py = path[j][1] + (path[j + 1][1] - path[j][1]) * ratio
                        break
                    travelled += seg
                else:
                    px, py = path[-1]
                _add_cylinder(f'railing:{obj.name}:bar:{i}', 0.01, h - 0.05,
                              (px, py, z0 + (h - 0.05) / 2), rail_mat, vertices=8)
            rebuilt += 1
            print(f'[dress_scene] curved railing {obj.name} rebuilt from {len(path)} mesh path points')
            continue
        along_x = dx >= dy
        length = max(dx, dy)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2

        def bar(name: str, ln: float, wd: float, ht: float, px: float, py: float, pz: float) -> None:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            b = bpy.context.object
            b.name = name
            b.dimensions = (ln, wd, ht) if along_x else (wd, ln, ht)
            b.location = (px, py, pz)
            if rail_mat:
                b.data.materials.append(rail_mat)

        bar(f'railing:{obj.name}:handrail', length, 0.06, 0.05, cx, cy, z1 - 0.025)
        step = 0.13
        n_bars = max(2, int(length / step) + 1)
        start = -length / 2
        for i in range(n_bars):
            off = start + i * (length / (n_bars - 1))
            bar(f'railing:{obj.name}:bar:{i}', 0.02, 0.02, h - 0.05,
                cx + off if along_x else cx,
                cy if along_x else cy + off,
                z0 + (h - 0.05) / 2)
        rebuilt += 1
    print(f'[dress_scene] railings rebuilt: {rebuilt}')
    return rebuilt


def _set_eevee_samples(scene, samples: int) -> None:
    """Set and verify the Eevee render-sample property across Blender versions."""
    samples = int(samples)
    if samples < 1:
        raise ValueError(f'Eevee render samples must be >= 1 (got {samples})')
    eevee = getattr(scene, 'eevee', None)
    if eevee is None:
        raise RuntimeError('Eevee scene settings are unavailable')
    for property_name in ('taa_render_samples', 'render_samples'):
        if not hasattr(eevee, property_name):
            continue
        try:
            setattr(eevee, property_name, samples)
            actual = int(getattr(eevee, property_name))
            if actual != samples:
                raise RuntimeError(f'{property_name} readback mismatch: requested {samples}, got {actual}')
            print(f'[dress_scene] Eevee render samples={actual} property={property_name}')
            return
        except Exception as error:
            raise RuntimeError(f'failed to set Eevee render samples via {property_name}: {error}') from error
    raise RuntimeError('Eevee render sample property unavailable')


def set_engine(scene, engine: str, samples: int = 256) -> str:
    if engine.upper() == 'CYCLES':
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = samples
        try:
            scene.cycles.use_denoising = True
        except Exception:
            pass
        try:
            scene.cycles.seed = 42  # 固定 seed，保证 A/B 同配置两次渲染一致
        except Exception:
            pass
        # GPU compute：CUDA 优先（NVIDIA 稳，OptiX 需预编译 .ptx 易炸，HIP 仅 AMD）
        try:
            cprefs = bpy.context.preferences.addons['cycles'].preferences
            for backend in ('CUDA', 'OPTIX', 'HIP'):
                try:
                    cprefs.compute_device_type = backend
                    devs = cprefs.get_devices_for_type(backend)
                    gpu = [d for d in devs if d.type in ('HIP', 'OPTIX', 'CUDA')]
                    if gpu:
                        for d in devs:
                            d.use = d.type in ('HIP', 'OPTIX', 'CUDA')
                        scene.cycles.device = 'GPU'
                        print(f'[dress_scene] Cycles GPU backend={backend} device={[d.name for d in gpu]}')
                        break
                except Exception:
                    continue
            else:
                scene.cycles.device = 'CPU'
        except Exception:
            scene.cycles.device = 'CPU'
        return 'CYCLES'
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = eng
            _set_eevee_samples(scene, samples)
            return eng
        except TypeError:
            continue
    raise RuntimeError('no EEVEE engine id available')


def _actual_render_samples(scene, engine: str) -> int | None:
    """Read back the effective render sample count for audit metadata."""
    settings = scene.cycles if engine == 'CYCLES' else getattr(scene, 'eevee', None)
    if settings is None:
        return None
    for property_name in ('samples', 'taa_render_samples', 'render_samples'):
        value = getattr(settings, property_name, None)
        if isinstance(value, int):
            return value
    return None


CAMERA_SCENARIO_OVERRIDE_FIELDS = frozenset({'exposure', 'fill_light', 'fill_from_camera', 'sheer_opacity'})


CAMERA_DEFAULT_EXPOSURE_OVERRIDES = {
    # 仅针对已复核的机位×工况做温和修正，避免抬高全局曝光。
    ('corridor_view', 'material_review'): -0.5,
    ('bedroom_nw_overview', 'material_review'): -0.5,
    ('bedroom_nw_overview', 'bare_shell'): -0.5,
    # Cycles + Standard + material_review 的近地面取景被 80W 同轴补光推到裁剪；
    # 仅压低该特写，不改变全局工况曝光。
    ('bedroom_floor_closeup', 'material_review'): 1.0,
    ('master_bath_overview', 'material_review'): -0.25,
    ('master_bath_overview', 'bare_shell'): -0.25,
    ('balcony_overview', 'material_review'): 0.0,
    ('living_from_entry', 'bare_shell'): 0.35,
    ('living_from_entry', 'material_review'): 0.35,
    ('living_floor_mid', 'material_review'): 0.35,
    ('living_sofa_glass', 'material_review'): -0.35,
    ('living_sofa_glass', 'bare_shell'): -0.35,
    ('living_sofa_glass', 'hvac_coordination'): -0.35,
}


def camera_default_exposure(camera_id: str, scenario_id: str | None = None,
                            fallback: float | None = None) -> float | None:
    """返回少量已复核机位×工况的默认曝光；显式 camera/scenario 值优先。"""
    if scenario_id is not None:
        return CAMERA_DEFAULT_EXPOSURE_OVERRIDES.get((camera_id, scenario_id), fallback)
    # 保持旧调用的安全回退：不跨工况猜测曝光。
    return fallback


def effective_camera_config(camera: dict, scenario: dict) -> dict:
    """返回当前 job 的有效相机配置，不修改源配置也不允许覆盖全局场景状态。

    曝光优先级：非零显式 camera 值 > camera 的 scenario override > 已复核的
    camera×scenario 默认校正 > scenario 值。camera exposure 为旧默认值 0
    时视为未显式设置，允许机位×场景默认校正生效。
    """
    effective = dict(camera)
    scenario_id = scenario.get('id')
    overrides = camera.get('scenario_overrides')
    override = None
    if overrides is not None:
        if not isinstance(overrides, dict):
            print(f'[dress_scene] WARN: camera {camera.get("id")} scenario_overrides must be an object; ignored')
        else:
            override = overrides.get(scenario_id)
            if override is not None and not isinstance(override, dict):
                print(f'[dress_scene] WARN: camera {camera.get("id")} scenario override for {scenario_id} must be an object; ignored')
                override = None

    camera_exposure = camera.get('exposure')
    camera_has_explicit_exposure = (
        isinstance(camera_exposure, (int, float))
        and not isinstance(camera_exposure, bool)
        and camera_exposure != 0
    )
    if isinstance(override, dict):
        unknown = set(override) - CAMERA_SCENARIO_OVERRIDE_FIELDS
        if unknown:
            print(f'[dress_scene] WARN: camera {camera.get("id")} scenario override for {scenario_id} ignored fields: {", ".join(sorted(unknown))}')
        effective.update({key: value for key, value in override.items()
                          if key in CAMERA_SCENARIO_OVERRIDE_FIELDS
                          and (key != 'exposure' or not camera_has_explicit_exposure)})

    camera_has_default_exposure = 'exposure' not in camera or camera_exposure == 0
    has_scenario_override_exposure = isinstance(override, dict) and 'exposure' in override
    if not camera_has_explicit_exposure and not has_scenario_override_exposure:
        default_exposure = camera_default_exposure(camera.get('id'), scenario_id)
        if default_exposure is not None:
            effective['exposure'] = default_exposure
        elif 'exposure' in scenario and camera_has_default_exposure:
            effective['exposure'] = scenario['exposure']
    return effective


def _object_counts() -> dict:
    return {
        'objects': len(bpy.data.objects),
        'meshes': len(bpy.data.meshes),
        'lights': len(bpy.data.lights),
        'cameras': len(bpy.data.cameras),
        'collections': len(bpy.data.collections),
    }


def _tag_dynamic_objects() -> None:
    """把一次性生成的替代几何标记为动态组，后续只切换 hide_render。"""
    dynamic_prefixes = ('asset:', 'ceiling:', 'bath:', 'kitchen:', 'fixture:', 'molding:',
                        'railing:', 'hvac:', 'sky_plane:')
    for obj in bpy.data.objects:
        if obj.name.startswith(dynamic_prefixes) or _is_render_only(obj):
            obj['dress_dynamic'] = True


def _set_recursive_hidden(obj, hidden: bool) -> None:
    obj.hide_render = hidden
    for child in obj.children_recursive:
        child.hide_render = hidden


def _reset_job_visibility() -> None:
    for obj in bpy.data.objects:
        if obj.get('dress_dynamic'):
            _set_recursive_hidden(obj, False)
        elif obj.name.startswith('furniture:') and not obj.get('dress_replacement_source'):
            _set_recursive_hidden(obj, False)
    _restore_curtain_hide_render(bpy.data.objects, _CURTAIN_HIDE_RENDER_SNAPSHOT)
    # GLB 导出的家具子 mesh 可能没有完整 parent 链；恢复后再次按实例标记
    # 隐藏已被 replacement 接管的 formal family，避免 per-job reset 露出双份家具。
    replacement_keys = {
        obj.get('instance_key') for obj in bpy.data.objects
        if obj.get('dress_replacement_source') and obj.get('instance_key')
    }
    for instance_key in replacement_keys:
        _hide_furniture_instance_family(instance_key, True)


def _set_material_value(mat, socket_name: str, value) -> None:
    if not mat or not getattr(mat, 'use_nodes', False):
        return
    bsdf = _find_node(mat.node_tree, 'ShaderNodeBsdfPrincipled')
    if bsdf and socket_name in bsdf.inputs:
        bsdf.inputs[socket_name].default_value = value


def _set_fixture_emission(enabled: bool) -> None:
    for name in ('灯具_diffuser', '灯具_cove', '顶面_灯槽'):
        mat = bpy.data.materials.get(name)
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.bl_idname == 'ShaderNodeEmission':
                if name == '灯具_diffuser':
                    node.inputs['Strength'].default_value = 5.0 if enabled else 0.2
                else:
                    node.inputs['Strength'].default_value = 2.0 if enabled else 0.2


def _set_sheer_opacity(mat, opacity: float, engine: str) -> None:
    if not mat or not mat.use_nodes:
        return
    if engine.upper() in {'CYCLES', 'EEVEE'}:
        for node in mat.node_tree.nodes:
            if node.bl_idname == 'ShaderNodeMixShader':
                node.inputs[0].default_value = float(opacity)
    else:
        _set_material_value(mat, 'Alpha', max(0.1, float(opacity) * 2.0))


# Compatibility exports for existing callers and render entry points.
kelvin_to_rgb = _blender_lighting.kelvin_to_rgb
fill_light_is_enabled = _blender_lighting.fill_light_is_enabled
job_state = _blender_lighting.job_state


def _set_job_lights(runtime: dict, state: dict, cam_cfg: dict, scenario: dict) -> None:
    return _blender_lighting._set_job_lights(
        runtime, state, cam_cfg, scenario, bpy_module=bpy,
        to_blender_fn=to_blender, kelvin_to_rgb_fn=kelvin_to_rgb,
    )


def _job_light_audit() -> dict:
    return _blender_lighting.job_light_audit(bpy_module=bpy)


def _set_color_management(scene, scenario: dict) -> None:
    """Apply declared view transform/look while tolerating Blender enum drift."""
    view_settings = scene.view_settings
    view_transform = scenario.get('view_transform', 'AgX')
    try:
        view_settings.view_transform = view_transform
    except Exception:
        print(f'[dress_scene] WARN color management view_transform unavailable: {view_transform!r}')
    requested_look = scenario.get('look', 'None')
    try:
        available = {item.name for item in view_settings.bl_rna.properties['look'].enum_items}
    except Exception:
        available = None
    effective_look = requested_look if available is None or requested_look in available else 'None'
    try:
        view_settings.look = effective_look
    except Exception:
        try:
            view_settings.look = 'None'
        except Exception:
            effective_look = '<unavailable>'
    print(f'[dress_scene] color_management: requested_view_transform={view_transform!r} '
          f'effective_view_transform={getattr(view_settings, "view_transform", "<unavailable>")} '
          f'requested_look={requested_look!r} effective_look={getattr(view_settings, "look", effective_look)!r}')


def _apply_job_state(runtime: dict, cam_cfg: dict, scenario: dict) -> dict:
    state = job_state(cam_cfg, scenario)
    _reset_job_visibility()
    if state['bare_shell']:
        for o in bpy.data.objects:
            if bare_shell_should_hide(o):
                _set_recursive_hidden(o, True)
    if state['curtain_policy'] == 'hidden_for_bare_shell':
        for o in bpy.data.objects:
            if parse_curtain_node_name(o.name):
                _set_recursive_hidden(o, True)
    if not state['show_hvac']:
        for o in bpy.data.objects:
            if o.name.startswith('hvac:'):
                _set_recursive_hidden(o, True)
    mats = runtime['mats']
    _set_sheer_opacity(mats.get('sheer'), state['sheer_opacity'], runtime['engine'])
    # materials.yaml 会为 exterior_glazing 构建独立角色材质；工况参数必须同步到
    # 基础 glass 和最终幕墙角色，否则 daylight/blue_hour 的 Low-E 调整不会生效。
    defaults = runtime['material_defaults'].get('glass', {})
    for glass_key in ('glass', 'exterior_glazing'):
        glass_mat = mats.get(glass_key)
        if glass_mat is None:
            continue
        _set_material_value(glass_mat, 'IOR', float(state['glass_ior']) if state['glass_ior'] is not None else defaults.get('IOR', 1.5 if runtime['engine'] == 'CYCLES' else 1.0))
        _set_material_value(glass_mat, 'Coat Weight', float(state['glass_coat']) if state['glass_ior'] is not None else defaults.get('Coat Weight', 0.0))
        _set_material_value(glass_mat, 'Base Color', (*hex_rgb(state['glass_tint']), 1.0) if state['glass_tint'] else defaults.get('Base Color', (0.0, 0.0, 0.0, 1.0)))
        if runtime['engine'] == 'CYCLES' and glass_key == 'exterior_glazing':
            _glass_shadow_passthrough(glass_mat)
    _set_fixture_emission(state['lights_on'])
    _set_job_lights(runtime, state, cam_cfg, scenario)
    hdri_status = setup_world(runtime['engine'], scenario, config_dir=runtime['config_dir'])
    add_sky_planes(hdri_status)
    runtime['last_hdri_status'] = hdri_status
    add_camera(cam_cfg, reuse=True)
    scene = bpy.context.scene
    scene.render.filepath = runtime['out_path']
    _set_color_management(scene, scenario)
    try:
        default_exposure = 0.5 if runtime['engine'] == 'CYCLES' else 0.6
        scene.view_settings.exposure = cam_cfg.get('exposure', scenario.get('exposure', default_exposure))
    except Exception:
        pass
    current = _object_counts()
    if current != runtime['counts']:
        print(f'[dress_scene] WARN object counts changed: {runtime["counts"]} -> {current}')
    print(f'[dress_scene] job state: objects={current["objects"]} dynamic={sum(1 for o in bpy.data.objects if o.get("dress_dynamic"))}')
    return state


BLENDERKIT_PBR_CONTRACT = (
    {
        'material_key': 'wood_dark',
        'texture_id': 'blenderkit_light_oak_wood',
        'size': 1.2,
        'with_diffuse': False,
        'normal_strength': 0.3,
        'tint': None,
        'base_color': '#503e2e',
    },
    {
        'material_key': 'curtain_fabric',
        'texture_id': 'blenderkit_plain_natural_blackout',
        'size': 0.5,
        'with_diffuse': False,
        'normal_strength': 0.6,
        'tint': None,
        'base_color': '#d8d0c2',
    },
)


def _blenderkit_pbr_assignments(mats: dict, furniture_mats: dict) -> list[tuple]:
    """Resolve the reviewed BlenderKit contracts to material/map assignments."""
    materials = {**mats, **furniture_mats}
    return [
        (
            materials.get(item['material_key']),
            item['texture_id'],
            item['size'],
            item['with_diffuse'],
            item['normal_strength'],
            item['tint'],
        )
        for item in BLENDERKIT_PBR_CONTRACT
    ]


_ASSET_MODULE_CONFIGURED = False
_RENDER_ONLY_MODULE_CONFIGURED = False


def _configure_legacy_geometry() -> None:
    _legacy_geometry.configure(
        bpy_module=bpy, to_blender_fn=to_blender,
        furniture_parts=FURNITURE_PARTS,
        furniture_glb=_blender_assets.FURNITURE_GLB,
        cabinet_seam_panels=CABINET_SEAM_PANELS,
        import_furniture_glb_fn=_blender_assets.import_furniture_glb,
        master_bath_final_layout_fn=master_bath_final_layout,
    )


def _configure_asset_modules() -> None:
    global _ASSET_MODULE_CONFIGURED, _RENDER_ONLY_MODULE_CONFIGURED
    _configure_legacy_geometry()
    _blender_assets.configure(
        bpy_module=bpy, hex_rgb_fn=hex_rgb, find_node_fn=_find_node,
        new_principled_fn=new_principled,
        set_recursive_hidden_fn=_set_recursive_hidden,
        hide_furniture_instance_family_fn=_hide_furniture_instance_family,
        mark_render_only_fn=_mark_render_only, is_render_only_fn=_is_render_only,
        add_pbr_maps_fn=add_pbr_maps, fixture_material_role_fn=fixture_material_role,
        furniture_instance_anchors_fn=_furniture_instance_anchors,
        furniture_instance_key_fn=_furniture_instance_key,
        furniture_parts=FURNITURE_PARTS,
        cabinet_seam_panels=CABINET_SEAM_PANELS,
        asset_registry=ASSET_REGISTRY,
    )
    _blender_render_only.configure(
        bpy_module=bpy, hex_rgb_fn=hex_rgb, new_principled_fn=new_principled,
        import_furniture_glb_fn=_blender_assets.import_furniture_glb,
        set_recursive_hidden_fn=_set_recursive_hidden,
        hide_furniture_instance_family_fn=_hide_furniture_instance_family,
        mark_render_only_fn=_mark_render_only, is_render_only_fn=_is_render_only,
        furniture_instance_anchors_fn=_furniture_instance_anchors,
        furniture_instance_key_fn=_furniture_instance_key,
        furniture_type_from_object_fn=_furniture_type_from_object,
        to_blender_fn=to_blender, glass_ids=GLASS_IDS,
        furniture_glb=_blender_assets.FURNITURE_GLB,
        asset_registry=ASSET_REGISTRY,
    )
    _ASSET_MODULE_CONFIGURED = True
    _RENDER_ONLY_MODULE_CONFIGURED = True


def uniform_asset_scale(model_w: float, model_h: float, targets: dict) -> float:
    _configure_asset_modules()
    return _blender_assets.uniform_asset_scale(model_w, model_h, targets)


def import_furniture_glb(glb_path: str, targets: dict, block=None, loc_rz=None, rot_fix: float = 0) -> int:
    _configure_asset_modules()
    return _blender_assets.import_furniture_glb(glb_path, targets, block=block, loc_rz=loc_rz, rot_fix=rot_fix)


def dress_tv_wall_low(config_dir: str) -> dict[str, int]:
    _configure_asset_modules()
    return _blender_assets.dress_tv_wall_low(config_dir)


def replace_furniture(furniture_mats: dict, config_dir: str = '', only_types: set | None = None,
                      room_ids: set[str] | None = None) -> int:
    _configure_asset_modules()
    return _blender_assets.replace_furniture(
        furniture_mats, config_dir, only_types=only_types, room_ids=room_ids
    )


def stage_missing_room_candidates(config_dir: str) -> int:
    _configure_asset_modules()
    return _blender_render_only.stage_missing_room_candidates(config_dir)


def add_soft_decor(furniture_mats: dict, config_dir: str = '') -> int:
    _configure_asset_modules()
    return _blender_render_only.add_soft_decor(furniture_mats, config_dir=config_dir)


# Compatibility aliases for diagnostics that imported the former private helpers.
_world_bbox_for_objects = _blender_render_only._world_bbox_for_objects
_report_render_only_asset = _blender_render_only._report_render_only_asset
_mark_candidate_asset = _blender_render_only._mark_candidate_asset


def initialize_scene(args: dict, cfg: dict, jobs: list[dict]) -> dict:
    """一次性创建 Blender 场景；返回供各 job 复用的运行时上下文。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Configure extracted modules after factory reset so their injected bpy/helpers
    # always point at the current scene and can be refreshed for repeated runs.
    _configure_asset_modules()
    bpy.ops.import_scene.gltf(filepath=args['glb'])
    facts = projection_facts(cfg)
    curtain_proj = curtain_projection_from_facts(facts)
    curtain_errors = validate_curtain_nodes((o.name for o in bpy.data.objects), curtain_proj)
    if curtain_errors:
        raise RuntimeError('BLOCKED: GLB curtain nodes do not match facts.presentation.curtains '
                           f'(snapshot {curtain_proj.get("snapshotSha256")}):\n  ' + '\n  '.join(curtain_errors))
    _apply_preview_scope(args.get('preview-room') if args.get('mode', 'formal') == 'preview' else None)
    scene = bpy.context.scene
    engine = set_engine(scene, args['engine'], samples=int(args.get('samples', 256)))
    from materials_from_yaml import load_scheme_materials
    mats = build_materials(engine, sheer_opacity=0.15)
    floor_mats = {}
    if args.get('config-dir'):
        mats, floor_mats, role_profiles = load_scheme_materials(
            engine, mats, new_principled, hex_rgb, facts,
            config_dir=args['config-dir'],
            color_overrides=_parse_mat_overrides(args.get('mat-override')))
    else:
        role_profiles = {}
        print('[dress_scene] WARN: --config-dir 未传，跳过 materials.yaml 材质（使用基础材质）')
    print(f'[dress_scene] floor default material={floor_material_label(mats.get("floor"))}; '
          f'room override materials={len(floor_mats)}')
    stats = assign_materials(mats, floor_mats)
    # LEGACY: only render-only soft decor may use this fixed material table.
    # Formal GLB role materials are built from materials.yaml above and must not
    # be overwritten by these compatibility materials or fixed PBR assignments.
    furniture_mats = build_furniture_materials(hex_rgb, new_principled)
    config_dir = args.get('config-dir') or ''
    if not _PREVIEW_ROOM or _PREVIEW_ROOM == 'living_dining':
        dress_tv_wall_low(config_dir)
    else:
        print(f'[dress_scene] preview scope room={_PREVIEW_ROOM}; skip living_dining asset staging')
    tex_base = os.path.join(config_dir, 'assets', 'textures')
    for mat, path, size, diffuse, strength, tint in [
        (mats.get('wall'), 'painted_plaster_wall', 2.5, False, 0.3, None),
        (furniture_mats.get('wood'), 'oak_veneer_01', 1.0, True, 0.3, None),
        *_blenderkit_pbr_assignments(mats, furniture_mats),
        (furniture_mats.get('fabric_white'), 'fabric_pattern_07', 0.35, False, 1.0, None),
        (mats.get('door'), 'oak_veneer_01', 1.0, True, 0.3, '#8a6f52'),
        (mats.get('sill'), 'marble_01', 1.5, False, 0.3, None),
        (furniture_mats.get('fabric'), 'fabric_pattern_07', 0.35, False, 1.0, None),
    ]:
        add_pbr_maps(mat, os.path.join(tex_base, path), size=size, with_diffuse=diffuse, normal_strength=strength, tint=tint)
    plumbing = plumbing_by_id(facts)
    countertop_mat = mats.get('countertop') or furniture_mats.get('quartz')
    cabinet_mat = mats.get('cabinet') or furniture_mats.get('paint_cream')
    # 客餐厅家具、bed_180、客卫浴室柜及厨房家电用真实资产替换；其他正式家具/柜体继续由主 GLB 提供。
    # bed_150 候选因 BlenderKit 导入后尺度异常，明确回退程序化床；replace_furniture 只触碰上述白名单。
    # 失败时保留程序化 vanity/床；water_heater、range_hood、toilet 仍保持禁用。
    replace_furniture(furniture_mats, config_dir, only_types={
        'sofa_3seat', 'dining_table', 'dining_chair', 'plant_fiddle', 'bed_180', 'vanity',
        'washer', 'dryer', 'dishwasher', 'fridge', 'gas_stove'},
        room_ids={_PREVIEW_ROOM} if _PREVIEW_ROOM else None)
    # Render-only candidates use current Blender anchors/bboxes; formal layout and Web geometry remain untouched.
    if not _PREVIEW_ROOM:
        stage_missing_room_candidates(config_dir)
    else:
        print(f'[dress_scene] preview scope room={_PREVIEW_ROOM}; skip room candidate staging')
    add_moldings(config_dir)
    rebuild_railings(mats)
    # 基础吊顶几何由 shared SceneBuilder/CLI GLB 提供；Blender 只保留材质后处理。
    # add_ceiling_finishing 暂为 render-only staging，客餐厅跌级/灯槽仍在下方保留。
    _add_pet_bump(cabinet_mat)
    # 厨房正式几何（柜体、连续台面 bridge、sink/cooktop cutouts、家电位置）
    # 由 shared/CLI GLB 提供；Blender 不再重建。add_kitchen_cabinets 保留为 LEGACY 迁移参考。
    # 正式卫浴几何由 shared plumbing/overlay/furnishing GLB 提供；Blender 仅保留 legacy 函数作迁移参考。
    if not _PREVIEW_ROOM or _PREVIEW_ROOM == 'living_dining':
        add_soft_decor(furniture_mats, config_dir=config_dir)
    else:
        print(f'[dress_scene] preview scope room={_PREVIEW_ROOM}; skip living_dining soft decor staging')
    _enforce_preview_scope()
    # 正式灯具外形由 shared/CLI GLB 提供；Blender 仅保留光源。
    add_lights(cfg, temp_override=6500)
    if not _PREVIEW_ROOM or _PREVIEW_ROOM == 'living_dining':
        add_ceiling_finishing(mats, emit=True)
    else:
        print(f'[dress_scene] preview scope room={_PREVIEW_ROOM}; skip living_dining ceiling staging')
    if any(job['scenario'].get('hvac_coordination') for job in jobs):
        if _PREVIEW_ROOM:
            print(f'[dress_scene] preview scope room={_PREVIEW_ROOM}; skip HVAC staging')
        else:
            add_hvac_diagram(facts, show_routes=True)
            add_hvac_reference_constraints(facts, show_constraints=True)
    scenarios = [j['scenario'] for j in jobs]
    template = next((s for s in scenarios if s.get('sun_direction') or s.get('window_portal') or s.get('fill_light')), scenarios[0] if scenarios else {})
    if template.get('sun_direction'):
        add_sun(template['sun_direction'], energy=template.get('sun_energy', 1.2), temp=template.get('sun_temp', 3200))
    if template.get('window_portal'):
        add_window_portal(template['window_portal'])
    if any(effective_camera_config(c, j['scenario']).get('fill_light') for j in jobs for c in cfg['cameras'] if c['id'] == j['camera_id']):
        add_fill = bpy.data.lights.new('fill_light', type='AREA')
        add_fill.shape, add_fill.size, add_fill.size_y = 'RECTANGLE', 5.0, 5.0
        fill_obj = bpy.data.objects.new('fill_light', add_fill)
        bpy.context.collection.objects.link(fill_obj)
    hdri_status = setup_world(engine, template, config_dir=config_dir)
    # sky fallback 已在 initialize 阶段按稳定玻璃对象名创建；job 阶段仅复用/更新并切换显隐。
    # 仅无可用 HDRI 时启用不透明窗外 fallback；material_review 等无 HDRI 工况保留。
    add_sky_planes(hdri_status)
    for camera in cfg.get('cameras', []):
        add_camera(camera, reuse=True)
    _tag_dynamic_objects()
    global _CURTAIN_HIDE_RENDER_SNAPSHOT
    _CURTAIN_HIDE_RENDER_SNAPSHOT = _curtain_hide_render_snapshot(bpy.data.objects)
    counts = _object_counts()
    light_defaults = {o.name: o.data.energy for o in bpy.data.objects if o.type == 'LIGHT'}
    glass = mats.get('glass')
    glass_bsdf = _find_node(glass.node_tree, 'ShaderNodeBsdfPrincipled') if glass and glass.use_nodes else None
    material_defaults = {'glass': {}}
    if glass_bsdf:
        for socket in ('IOR', 'Coat Weight', 'Base Color'):
            if socket in glass_bsdf.inputs:
                value = glass_bsdf.inputs[socket].default_value
                material_defaults['glass'][socket] = tuple(value) if hasattr(value, '__len__') else value
    print(f'[dress_scene] initialized once: {counts}')
    return {'cfg': cfg, 'facts': facts, 'mats': mats, 'stats': stats, 'engine': engine,
            'samples': _actual_render_samples(scene, engine),
            'mode': args.get('mode', 'formal'), 'previewRoom': _PREVIEW_ROOM,
            'previewScopeStats': _PREVIEW_SCOPE_STATS if _PREVIEW_ROOM else None,
            'config_dir': config_dir, 'curtain_proj': curtain_proj, 'counts': counts,
            'light_defaults': light_defaults, 'material_defaults': material_defaults, 'out_path': '',
            'input_fingerprints': _load_render_fingerprints(args.get('manifest'))}


def _load_render_fingerprints(manifest_path: str | None) -> dict:
    if not manifest_path:
        return {'status': 'unbound'}
    try:
        manifest_path = os.path.abspath(manifest_path)
        if not os.path.isfile(manifest_path):
            raise ValueError('manifest path does not exist')
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
        fingerprints = manifest.get('inputFingerprints')
        keys = ('sourceInputsSha256', 'resourcesSha256', 'artifactsSha256', 'bundleSha256')
        if not isinstance(fingerprints, dict) or set(fingerprints) != set(keys) or not all(isinstance(fingerprints.get(key), str) and re.fullmatch(r'[0-9a-f]{64}', fingerprints[key]) for key in keys):
            raise ValueError('manifest inputFingerprints are missing or invalid')
        bundle_dir = os.path.dirname(manifest_path)
        groups = (('resources', manifest.get('resources')), ('artifacts', list((manifest.get('artifacts') or {}).values())))
        for label, entries in groups:
            if not isinstance(entries, list):
                raise ValueError(f'manifest {label} are missing or invalid')
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get('path'), str):
                    raise ValueError(f'manifest {label} contain invalid artifact')
                path = entry['path']
                if path.startswith('/') or '..' in path.split('/') or '\\' in path or not os.path.isfile(os.path.join(bundle_dir, path)):
                    raise ValueError(f'manifest {label} path is missing or unsafe: {path}')
                with open(os.path.join(bundle_dir, path), 'rb') as artifact_file:
                    digest = hashlib.sha256(artifact_file.read()).hexdigest()
                if digest != entry.get('sha256'):
                    raise ValueError(f'manifest {label} sha256 mismatch: {path}')
        source = manifest.get('sourceInputs')
        if not isinstance(source, dict) or not all(isinstance(path, str) and isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) for path, value in source.items()):
            raise ValueError('manifest sourceInputs are invalid')
        def digest(value):
            payload = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            return hashlib.sha256(payload).hexdigest()
        source_sha = digest([[path, source[path]] for path in sorted(source)])
        resources = manifest.get('resources')
        artifacts_record = manifest.get('artifacts')
        if not isinstance(resources, list) or not isinstance(artifacts_record, dict):
            raise ValueError('manifest resources or artifacts are missing')
        resource_rows = sorted([[entry['path'], entry['bytes'], entry['sha256']] for entry in resources if isinstance(entry, dict)], key=lambda row: row[0])
        artifact_rows = [[key, artifacts_record[key]['path'], artifacts_record[key]['bytes'], artifacts_record[key]['sha256']] for key in sorted(artifacts_record) if isinstance(artifacts_record[key], dict)]
        resources_sha = digest(resource_rows)
        artifacts_sha = digest(artifact_rows)
        bundle_sha = digest({'sourceInputsSha256': source_sha, 'resourcesSha256': resources_sha, 'artifactsSha256': artifacts_sha})
        if fingerprints != {'sourceInputsSha256': source_sha, 'resourcesSha256': resources_sha, 'artifactsSha256': artifacts_sha, 'bundleSha256': bundle_sha}:
            raise ValueError('manifest inputFingerprints do not match sourceInputs, resources, or artifacts')
        with open(manifest_path, 'rb') as manifest_file:
            manifest_sha256 = hashlib.sha256(manifest_file.read()).hexdigest()
        return {'status': 'bound', 'manifest': manifest_path, 'manifestSha256': manifest_sha256, **{key: fingerprints[key] for key in keys}}
    except Exception as error:
        raise RuntimeError(f'Unable to load render bundle manifest {manifest_path}: {error}')


def render_scene(runtime: dict, args: dict, cam_cfg: dict, scenario: dict, out_path: str) -> None:
    runtime['out_path'] = out_path
    state = _apply_job_state(runtime, cam_cfg, scenario)
    scene = bpy.context.scene
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = int(args.get('res', 100))
    try:
        scene.render.image_settings.file_format = 'PNG'
    except Exception:
        pass
    if runtime['mode'] == 'preview':
        audit = {'path': out_path, 'mode': runtime['mode'], 'previewRoom': runtime['previewRoom'],
                 'previewScopeStats': runtime['previewScopeStats'], 'scenario': scenario.get('id'),
                 'camera': cam_cfg.get('id'), 'engine': runtime['engine'], 'samples': runtime['samples'],
                 'effectiveExposure': scene.view_settings.exposure,
                 'viewTransform': getattr(scene.view_settings, 'view_transform', '<unavailable>'),
                 'look': getattr(scene.view_settings, 'look', '<unavailable>'),
                 'hdri': runtime.get('last_hdri_status', {}), 'lights': _job_light_audit(),
                 'materials': runtime['stats'], 'inputFingerprints': runtime['input_fingerprints']}
        print(f'[dress_scene] job_audit {json.dumps(audit, ensure_ascii=False, sort_keys=True)}')
    else:
        print(f'[dress_scene] job_audit path={out_path} scenario={scenario.get("id")} camera={cam_cfg.get("id")} '
              f'engine={runtime["engine"]} effective_exposure={scene.view_settings.exposure:.3f} '
              f'view_transform={getattr(scene.view_settings, "view_transform", "<unavailable>")} '
              f'look={getattr(scene.view_settings, "look", "<unavailable>")} '
              f'hdri={json.dumps(runtime.get("last_hdri_status", {}), ensure_ascii=False, sort_keys=True)} '
              f'lights={json.dumps(_job_light_audit(), ensure_ascii=False, sort_keys=True)} '
              f'materials={json.dumps(runtime["stats"], ensure_ascii=False)} '
              f'inputFingerprints={json.dumps(runtime["input_fingerprints"], ensure_ascii=False, sort_keys=True)}')
    bpy.ops.render.render(write_still=True)
    with open(out_path + '.meta.json', 'w', encoding='utf-8') as f:
        metadata = {'scenario': scenario.get('id'), 'camera': cam_cfg.get('id'),
                    'curtainPolicy': state['curtain_policy'] or 'as_snapshot',
                    'curtainSnapshotSha256': runtime['curtain_proj'].get('snapshotSha256'),
                    'inputFingerprints': runtime['input_fingerprints']}
        if runtime['mode'] == 'preview':
            metadata.update({'mode': runtime['mode'], 'previewRoom': runtime['previewRoom'],
                             'previewScopeStats': runtime['previewScopeStats'],
                             'engine': runtime['engine'], 'samples': runtime['samples']})
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return



def _parse_mat_overrides(raw: str | None) -> dict:
    """--mat-override "wall=#f5f1e8,floor=#d8bd93" → {classify_key: hex}。
    候选色号循环评审用（实体色板机制 2026-08-23 废弃）：每个候选色跑一次渲染，
    整场景同机位同光对比，而非在场景里摆色板。"""
    out = {}
    for pair in (raw or '').split(','):
        if '=' in pair:
            k, v = pair.split('=', 1)
            out[k.strip()] = v.strip()
    return out


def main() -> None:
    argv = sys.argv[sys.argv.index('--') + 1:]
    args = {}
    for i in range(0, len(argv), 2):
        args[argv[i].lstrip('-')] = argv[i + 1]

    glb_path = args['glb']
    cfg_path = args['config']
    mode = args.get('mode', 'formal')
    if mode not in {'formal', 'preview'}:
        raise ValueError(f'unsupported --mode: {mode}')
    if mode == 'preview' and not args.get('preview-room'):
        raise ValueError('--preview-room is required when --mode preview')
    engine = args.get('engine', 'EEVEE')
    version = args.get('version', 'v1')
    out_dir = args.get('out-dir', '.')

    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    from dress_config import make_jobs
    jobs = make_jobs(cfg, version=version, scenario_id=args.get('scenario'))
    only = args.get('only')  # 逗号分隔 camera_id 白名单：冒烟只渲指定机位
    if only:
        allow = {c.strip() for c in only.split(',')}
        jobs = [j for j in jobs if j['camera_id'] in allow]
    print(f'[dress_scene] {len(jobs)} jobs (cameras×scenarios)')
    os.makedirs(out_dir, exist_ok=True)
    if not jobs:
        return
    runtime = initialize_scene(args, cfg, jobs)
    for job in jobs:
        camera = next(c for c in cfg['cameras'] if c['id'] == job['camera_id'])
        # 每个 job 取得独立有效配置，白名单覆盖绝不写回 camera/scenario 源对象。
        cam_cfg = effective_camera_config(camera, job['scenario'])
        out_path = os.path.join(out_dir, job['out_name'] + '.png')
        render_scene(runtime, args, cam_cfg, job['scenario'], out_path)


if __name__ == '__main__':
    main()
