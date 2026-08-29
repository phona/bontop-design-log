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


LIGHT_ENERGY = {  # 瓦（Cycles/EEVEE 通用，先求氛围对再校绝对亮度）
    'pendant': 110.0,
    'dome': 55.0,
    'downlight': 22.0,
    'wall_lamp': 18.0,
    'led_strip': 25.0,
    'track_light': 45.0,
}


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
    if n in GLASS_IDS or n.startswith('curtain_run:'):
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
    # 纱帘：Cycles 用真半透明（可看穿见天色，布料权重配置驱动）；EEVEE 用 alpha 混合
    sheer = (
        new_sheer_transparent('软装_纱帘', hex_rgb('#f7f4ec'), opacity=sheer_opacity)
        if is_cycles
        else new_principled('软装_纱帘', hex_rgb('#f7f4ec'), rough=0.9, alpha=max(0.1, sheer_opacity * 2))
    )
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


def add_lights(cfg: dict, temp_override: float | None = None) -> int:
    count = 0
    for lp in cfg['lights']:
        energy = LIGHT_ENERGY.get(lp['type'], 15.0)
        # temp_override：材质评审工况用 6500K 中性白，避免 3000K 暖光污染色号判断
        color = kelvin_to_rgb(temp_override if temp_override is not None else lp.get('temp', 3000))
        if lp['type'] == 'track_light':
            track = lp.get('track')
            if not track:
                raise ValueError(f"track_light {lp['id']} requires detailed track config")
            from mathutils import Vector
            resolved_heads = track.get('resolvedHeads')
            if not isinstance(resolved_heads, list) or not resolved_heads:
                raise ValueError(f'track_light {lp["id"]} requires resolvedHeads in generated render config')
            for index, head in enumerate(resolved_heads, start=1):
                data = bpy.data.lights.new(f'{lp["id"]}/head:{index}', type='SPOT')
                data.energy = track['energy']
                data.color = color
                data.spot_size = track['beam']
                data.spot_blend = 0.45
                obj = bpy.data.objects.new(f'{lp["id"]}/head:{index}', data)
                obj.location = to_blender(head['position']['x'], head['position']['y'], head['position']['z'])
                target = bpy.data.objects.new(f'{lp["id"]}/target:{index}', None)
                target.location = to_blender(head['target']['x'], head['target']['y'], head['target']['z'])
                bpy.context.collection.objects.link(obj)
                bpy.context.collection.objects.link(target)
                direction = Vector(to_blender(head['direction']['x'], head['direction']['y'], head['direction']['z'])).normalized()
                obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
                count += 1
            continue
        if lp['type'] == 'led_strip':
            data = bpy.data.lights.new(lp['id'], type='AREA')
            data.shape = 'RECTANGLE'
            data.size = 2.4
            data.size_y = 0.1
        else:
            data = bpy.data.lights.new(lp['id'], type='POINT')
            data.shadow_soft_size = 0.25 if lp['type'] == 'downlight' else 0.15
        data.energy = energy
        data.color = color
        obj = bpy.data.objects.new(lp['id'], data)
        # led_strip 贴墙放会打出眩光斑 → 离墙 0.15m 且朝向房间（本项目仅西墙灯带，法线 +x 朝东）
        off = 0.15 if lp['type'] == 'led_strip' else 0.0
        # dome 高度=净高（2.8）时点光源正好嵌进天花网格被整体遮挡（书房北墙全黑确诊案例，
        # v24 降到 2.55 后房间恢复照明）→ dome 一律下沉 0.25m 到天花以下
        h = lp['height'] - 0.25 if lp['type'] == 'dome' else lp['height']
        if lp['type'] == 'downlight' and lp.get('recessed'):
            h -= 0.03
        obj.location = to_blender(lp['x'] + off, h, lp['z'])
        if lp['type'] == 'led_strip':
            import math as _m
            obj.rotation_euler = (0, -_m.radians(90), 0)
        bpy.context.collection.objects.link(obj)
        count += 1
    return count


def add_light_fixtures(cfg: dict, temp_override: float | None = None, emit: bool = True) -> int:
    """LEGACY Blender 几何旁路；not called by initialize_scene。

    正式灯具外形由 shared/CLI GLB（GLB geometry source）提供；保留此实现供历史
    渲染对照。正式渲染光源仍由 add_lights 提供；emit=False（daylight 等关灯工况）
    时灯罩不自发光，仅保留形体。"""
    import math

    def emis(name, temp, strength):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (*kelvin_to_rgb(temp), 1.0)
        em.inputs['Strength'].default_value = strength
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        return m

    diff_m = emis('灯具_diffuser', temp_override or 3000, 5.0)
    cove_m = emis('灯具_cove', temp_override or 3000, 2.0)  # 灯槽低亮度，防眩光斑
    track_m = new_principled('灯具_黑色明装轨道', hex_rgb('#111111'), rough=0.35, metallic=0.75)
    if not emit:
        # 关灯工况（daylight）：灯具只留形体——吸顶/筒灯白色哑光，吊灯罩深色金属（中古黑）
        diff_m = new_principled('灯具_diffuser_off', hex_rgb('#f2f0eb'), rough=0.6)
        cove_m = new_principled('灯具_cove_off', hex_rgb('#e8e6e0'), rough=0.7)
        shade_off_m = new_principled('灯具_shade_off', hex_rgb('#26221e'), rough=0.4, metallic=0.6)
    count = 0
    for lp in cfg['lights']:
        t = lp['type']
        x, z = lp.get('x'), lp.get('z')
        h = lp.get('height', 2.8)
        if x is None or z is None:
            continue
        if t == 'track_light':
            track = lp.get('track') or {}
            resolved_heads = track.get('resolvedHeads')
            if not isinstance(resolved_heads, list) or not resolved_heads:
                resolved_heads = []
            rotation_y = track.get('rotation', {}).get('y', 0.0)
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=to_blender(x, h, z))
            rail = bpy.context.object
            rail.name = f'fixture:track_rail:{lp["id"]}'
            rail.dimensions = (track.get('length', 3.6), 0.08, 0.045)
            rail.rotation_euler[2] = rotation_y
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            rail.data.materials.append(track_m)
            count += 1
            for index, resolved in enumerate(resolved_heads, start=1):
                direction = Vector(to_blender(resolved['direction']['x'], resolved['direction']['y'], resolved['direction']['z'])).normalized()
                bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.08, location=to_blender(resolved['mountPosition']['x'], resolved['mountPosition']['y'], resolved['mountPosition']['z']))
                mount = bpy.context.object
                mount.name = f'fixture:track_mount:{lp["id"]}/head:{index}'
                mount.data.materials.append(track_m)
                bpy.ops.mesh.primitive_cylinder_add(radius=0.055, depth=0.14, location=to_blender(resolved['headPosition']['x'], resolved['headPosition']['y'], resolved['headPosition']['z']))
                head = bpy.context.object
                head.name = f'fixture:track_head:{lp["id"]}/head:{index}'
                head.rotation_euler = direction.to_track_quat('Y', 'Z').to_euler()
                head.data.materials.append(track_m)
                count += 2
        elif t == 'dome':
            bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.06, location=to_blender(x, h - 0.03, z))
            o = bpy.context.object
            o.name = f'fixture:dome:{lp["id"]}'
            o.data.materials.append(diff_m)
            count += 1
        elif t == 'downlight':
            if lp.get('recessed'):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=0.08, location=to_blender(x, h + 0.04, z))
                body = bpy.context.object
                body.name = f'fixture:down_body:{lp["id"]}'
                body.data.materials.append(diff_m)
                bpy.ops.mesh.primitive_torus_add(major_radius=0.068, minor_radius=0.012, major_segments=20, minor_segments=8, location=to_blender(x, h - 0.002, z))
                ring = bpy.context.object
                ring.name = f'fixture:down_ring:{lp["id"]}'
                ring.data.materials.append(track_m)
                bpy.ops.mesh.primitive_cylinder_add(radius=0.052, depth=0.008, location=to_blender(x, h - 0.006, z))
                lens = bpy.context.object
                lens.name = f'fixture:down_lens:{lp["id"]}'
                lens.data.materials.append(diff_m)
                count += 3
            else:
                bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.02, location=to_blender(x, h - 0.01, z))
                o = bpy.context.object
                o.name = f'fixture:down:{lp["id"]}'
                o.data.materials.append(diff_m)
                count += 1
        elif t == 'pendant':
            # DEC-027：客厅主吊灯取消（无主灯方案评估）；餐桌吊灯=黑色线性长条（与餐桌方向一致）
            if lp['id'] == 'light_living_main':
                continue
            hang = 1.9
            bar_len = 1.2
            bpy.ops.mesh.primitive_cylinder_add(radius=0.006, depth=(h - hang), location=to_blender(x, (h + hang) / 2, z))
            bpy.context.object.name = f'fixture:pendant_cord:{lp["id"]}'
            # 线性灯体（黑色细条，1.2m 沿 x 与餐桌同向）
            bpy.ops.mesh.primitive_cube_add(size=1.0, location=to_blender(x, hang, z))
            s = bpy.context.object
            s.name = f'fixture:pendant_bar:{lp["id"]}'
            s.dimensions = (bar_len, 0.06, 0.04)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            s.data.materials.append(diff_m if emit else shade_off_m)
            count += 1
        elif t == 'wall_lamp':
            bpy.ops.mesh.primitive_cylinder_add(radius=0.06, depth=0.2, location=to_blender(x, h or 1.5, z),
                                                rotation=(0, math.radians(90), 0))
            o = bpy.context.object
            o.name = f'fixture:wall:{lp["id"]}'
            o.data.materials.append(diff_m)
            count += 1
        elif t == 'led_strip':
            # 电视墙隐藏灯槽：西墙 x=7.2 沿 z 长 2.4，高 2.0，离墙 0.03
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            o = bpy.context.object
            o.name = f'fixture:led_cove:{lp["id"]}'
            o.dimensions = (0.05, 2.4, 0.05)
            o.location = to_blender(x + 0.03, h, z)
            o.data.materials.append(cove_m)
            count += 1
    if count:
        print(f'[dress_scene] light fixtures: {count}')
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


def add_window_portal(portal: dict) -> None:
    """窗外柔光 portal：南玻璃幕外侧挂大面积 area light 模拟天空漫射，
    让窗光真正漫进房间深处（背光机位不再死黑）。玻璃 shadow 直通已保证光线穿窗。"""
    import math as _m
    data = bpy.data.lights.new('window_portal', type='AREA')
    data.shape = 'RECTANGLE'
    data.size = portal.get('width', 6.0)
    data.size_y = portal.get('height', 2.6)
    data.energy = portal.get('energy', 1500.0)
    data.color = kelvin_to_rgb(portal.get('temp', 6000))
    obj = bpy.data.objects.new('window_portal', data)
    obj.location = to_blender(portal.get('x', 10.3), portal.get('y', 2.2), portal.get('z', 11.0))
    obj.rotation_euler = (_m.radians(90), 0, 0)  # 灯体 -Z 朝北（指向室内）
    # Cycles 下 area light 对相机可见：portal 贴在玻璃幕外会把窗外渲染成白板，
    # 关掉相机/透射可见性——只漫射照明，外景交给 HDRI
    obj.visible_camera = False
    obj.visible_transmission = False
    bpy.context.collection.objects.link(obj)


def add_sun(sun_dir: list[float], energy: float = 1.2, temp: int = 3200) -> None:
    """sun_dir: 指向太阳方向的单位向量（Blender 坐标 +X 东/+Y 北/+Z 上）。
    场景常量由 gen-render-config.ts 预计算。
    Blender 日光灯光线沿灯体局部 -Z 发射 → -Z 必须指向"光线行进方向"= sun_dir 的反向
    （此前对齐 sun_dir 本身，光线射向天空=太阳不存在；旧工况 sun_direction=null 从未暴露）。
    energy/temp 由工况覆盖：白天正午约 5.0/5500K，傍晚低太阳默认 1.2/3200K。"""
    from mathutils import Vector
    direction = -Vector(sun_dir).normalized()
    data = bpy.data.lights.new('Sun', type='SUN')
    data.energy = energy
    data.color = kelvin_to_rgb(temp)
    obj = bpy.data.objects.new('Sun', data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    bpy.context.collection.objects.link(obj)


def setup_world(engine: str, scenario: dict, config_dir: str | None = None) -> dict:
    """Configure the world and report whether HDRI can provide window background."""
    hdri_status = {'loaded': False, 'path': None, 'reason': 'not_configured'}
    world = bpy.data.worlds.new('World') if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    # World 是每 job 的状态，不复用上一工况的 HDRI/Light Path 节点连接。
    world.node_tree.nodes.clear()
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    out = world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs['Background'], out.inputs['Surface'])
    if engine.upper() == 'CYCLES':
        hdri = scenario.get('world_hdri')
        if hdri and config_dir:
            import os
            path = os.path.normpath(os.path.join(config_dir, hdri))
            hdri_status['path'] = hdri
            try:
                if not os.path.isfile(path):
                    raise FileNotFoundError(path)
                env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
                env.image = bpy.data.images.load(path)
                hdri_status.update(loaded=True, reason='loaded')
                print(f'[dress_scene] world HDRI: scenario={scenario.get("id", "unknown")} path={hdri} status=loaded')
            except Exception as exc:
                hdri_status['reason'] = type(exc).__name__
                print(f'[dress_scene] WARN world HDRI fallback: scenario={scenario.get("id", "unknown")} path={hdri} reason={hdri_status["reason"]}')
            if hdri_status['loaded']:
                # HDRI 外景 + Light Path 分离：相机光线（透玻璃所见）用 HDRI 真外景；
                # 其余光线（环境照明）用可控纯色 world_color，避免房间被 HDRI 颜色污染。
                if scenario.get('world_hdri_lighting'):
                    # HDRI 仅负责窗外/透射可见背景；室内漫射环境仍使用声明的 world_color。
                    bg.inputs['Color'].default_value = (*hex_rgb(scenario.get('world_color', '#808080')), 1.0)
                    bg.inputs['Strength'].default_value = scenario.get('world_strength', 1.0)
                    cam_str = scenario.get('world_hdri_camera_strength')
                    if cam_str is not None:
                        bg_cam = world.node_tree.nodes.new('ShaderNodeBackground')
                        # 可选冷色混合仅作用于相机/透射/奇异光线的 HDRI 背景。
                        camera_tint = scenario.get('world_hdri_camera_tint')
                        if isinstance(camera_tint, dict) and camera_tint.get('color'):
                            tint_mix = world.node_tree.nodes.new('ShaderNodeMixRGB')
                            tint_mix.blend_type = 'MIX'
                            tint_mix.inputs['Fac'].default_value = camera_tint.get('strength', 0.0)
                            world.node_tree.links.new(env.outputs['Color'], tint_mix.inputs['Color1'])
                            tint_mix.inputs['Color2'].default_value = (*hex_rgb(camera_tint['color']), 1.0)
                            world.node_tree.links.new(tint_mix.outputs['Color'], bg_cam.inputs['Color'])
                        else:
                            world.node_tree.links.new(env.outputs['Color'], bg_cam.inputs['Color'])
                        bg_cam.inputs['Strength'].default_value = cam_str
                        lp2 = world.node_tree.nodes.new('ShaderNodeLightPath')
                        add1 = world.node_tree.nodes.new('ShaderNodeMath')
                        add1.operation = 'ADD'
                        world.node_tree.links.new(lp2.outputs['Is Camera Ray'], add1.inputs[0])
                        world.node_tree.links.new(lp2.outputs['Is Transmission Ray'], add1.inputs[1])
                        add2 = world.node_tree.nodes.new('ShaderNodeMath')
                        add2.operation = 'ADD'
                        world.node_tree.links.new(add1.outputs[0], add2.inputs[0])
                        world.node_tree.links.new(lp2.outputs['Is Singular Ray'], add2.inputs[1])
                        mix2 = world.node_tree.nodes.new('ShaderNodeMixShader')
                        world.node_tree.links.new(add2.outputs[0], mix2.inputs[0])
                        world.node_tree.links.new(bg.outputs['Background'], mix2.inputs[1])
                        world.node_tree.links.new(bg_cam.outputs['Background'], mix2.inputs[2])
                        world.node_tree.links.new(mix2.outputs[0], out.inputs['Surface'])
                    else:
                        world.node_tree.links.new(env.outputs['Color'], bg.inputs['Color'])
                    bg.inputs['Strength'].default_value = scenario.get('world_strength', 1.0)
                    return hdri_status
                lp = world.node_tree.nodes.new('ShaderNodeLightPath')
                add1 = world.node_tree.nodes.new('ShaderNodeMath')
                add1.operation = 'ADD'
                world.node_tree.links.new(lp.outputs['Is Camera Ray'], add1.inputs[0])
                world.node_tree.links.new(lp.outputs['Is Transmission Ray'], add1.inputs[1])
                add2 = world.node_tree.nodes.new('ShaderNodeMath')
                add2.operation = 'ADD'
                world.node_tree.links.new(add1.outputs[0], add2.inputs[0])
                world.node_tree.links.new(lp.outputs['Is Singular Ray'], add2.inputs[1])
                mix = world.node_tree.nodes.new('ShaderNodeMixRGB')
                mix.blend_type = 'MIX'
                mix.inputs['Color1'].default_value = (*hex_rgb(scenario.get('world_color', '#3a5a8f')), 1.0)
                world.node_tree.links.new(add2.outputs[0], mix.inputs['Fac'])
                world.node_tree.links.new(env.outputs['Color'], mix.inputs['Color2'])
                world.node_tree.links.new(mix.outputs['Color'], bg.inputs['Color'])
                bg.inputs['Strength'].default_value = scenario.get('world_strength', 0.8)
                return hdri_status
        elif scenario.get('world_color'):
            # 自定义天光色（蓝调深蓝 / 夜晚近黑）：玻璃透出可见天色，方向性天光不染天花板
            bg.inputs['Color'].default_value = (*hex_rgb(scenario['world_color']), 1.0)
            bg.inputs['Strength'].default_value = scenario.get('world_strength', 0.3)
        else:
            # 白天工况：方向性天光 HOSEK_WILKIE
            sky = world.node_tree.nodes.new('ShaderNodeTexSky')
            sky.sky_type = 'HOSEK_WILKIE'
            sun_dir = scenario.get('sun_direction') or [0, 0, 1]
            sky.sun_direction = tuple(sun_dir)
            sky.sun_intensity = 1.2
            try:
                sky.sun_size = 0.02
            except Exception:
                pass
            world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
            bg.inputs['Strength'].default_value = 1.0
    else:
        # EEVEE 下世界光无方向地照射室内，会染蓝天花板 → 环境光降到微弱，
        # 蓝天改为玻璃室内侧的发光平面（见 add_sky_planes），只透过玻璃可见。
        bg.inputs['Color'].default_value = (*_srgb_to_linear_tuple((0.85, 0.87, 0.90)), 1.0)
        bg.inputs['Strength'].default_value = 0.25
    return hdri_status


def add_sky_planes(hdri_status: dict | None = None) -> None:
    """为无可用 HDRI 的工况显示统一的玻璃窗外天空 fallback。
    成功加载 HDRI 时隐藏已有 fallback，避免不透明平面覆盖真实外景。"""
    use_fallback = not (hdri_status and hdri_status.get('loaded'))
    existing = [o for o in bpy.data.objects if o.name.startswith('sky_plane:')]
    for plane in existing:
        plane.hide_render = not use_fallback
    if not use_fallback:
        print('[dress_scene] sky fallback: disabled (HDRI loaded)')
        return
    from mathutils import Vector
    mat = bpy.data.materials.new('天_傍晚天空')
    mat.use_nodes = True
    e = _find_node(mat.node_tree, 'ShaderNodeBsdfPrincipled')
    if e is None:
        e = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        out = _find_node(mat.node_tree, 'ShaderNodeOutputMaterial') or mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(e.outputs['BSDF'], out.inputs['Surface'])
    e.inputs['Emission Color'].default_value = (*_srgb_to_linear_tuple((0.55, 0.65, 0.92)), 1.0)
    e.inputs['Emission Strength'].default_value = 1.2
    try:
        mat.use_backface_culling = False
    except Exception:
        pass

    # Blender 导入坐标为 (x, -z, y)：户内中心约为 Three.js (8, 1.4, 3.5)。
    center = Vector((8.0, -3.5, 1.4))  # 户内大致中心，用于判断室内侧
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.name not in GLASS_IDS:
            continue
        c = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        mins = Vector((min(v.x for v in c), min(v.y for v in c), min(v.z for v in c)))
        maxs = Vector((max(v.x for v in c), max(v.y for v in c), max(v.z for v in c)))
        size = maxs - mins
        axis = list(size).index(min(size))  # 玻璃最薄轴 = 法线轴
        off = 0.12
        loc = (mins + maxs) / 2.0
        # 室内侧 = 沿最短轴朝 center 的一侧；偏移必须离开玻璃，避免共面闪烁。
        if axis == 0:
            loc.x = maxs.x + off if center.x > maxs.x else mins.x - off
        elif axis == 1:
            loc.y = maxs.y + off if center.y > maxs.y else mins.y - off
        else:
            loc.z = maxs.z + off if center.z > maxs.z else mins.z - off

        bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc)
        p = bpy.context.object
        p.name = f'sky_plane:{obj.name}'
        if p.name not in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.link(p)
        # plane 默认法线 +z（x-y 平面）。旋转后法线指向户内中心。
        # (1.5708,0,0)->法线(0,-1,0)  (-1.5708,0,0)->法线(0,1,0)
        # (0,1.5708,0)->法线(1,0,0)   (0,-1.5708,0)->法线(-1,0,0)
        if axis == 0:
            p.rotation_euler = (0, 1.5708 if loc.x < center.x else -1.5708, 0)
        elif axis == 1:
            p.rotation_euler = (-1.5708 if loc.y < center.y else 1.5708, 0, 0)
        else:
            p.rotation_euler = (0, 0, 0 if loc.z < center.z else math.pi)  # 水平
        p.scale = (max(size.y if axis != 1 else size.x, 0.2),
                   max(size.z, 0.2),
                   1.0)
        p.data.materials.append(mat)
        print(f'[dress_scene] sky plane for {obj.name} at {tuple(round(v,2) for v in loc)}')


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
    """在定制柜正面生成柜门分缝条。base=(bx,by,bz) Blender 世界坐标（柜体块原点），
    rz 为绕 Z 旋转。缝条 4mm 宽、3mm 深（半嵌入门板正面），深色哑光读出凹槽阴影。"""
    import math
    panels = CABINET_SEAM_PANELS.get(ftype)
    if not panels or gap_mat is None:
        return 0
    cos_rz, sin_rz = math.cos(rz), math.sin(rz)
    bx, by, bz = base
    n = 0
    for (x0, x1, y0, y1, fz) in panels:
        w = x1 - x0
        doors = max(1, round(w / 0.45))  # 400-500mm 标准门宽
        for k in range(1, doors):
            sx = x0 + w * k / doors
            sy = (y0 + y1) / 2
            # three 局部 (sx, sy, fz) → Blender 局部 (sx, -fz, sy)，绕 Z 旋 rz
            lx, ly = sx, -fz
            wx = bx + lx * cos_rz - ly * sin_rz
            wy = by + lx * sin_rz + ly * cos_rz
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            s = bpy.context.object
            s.name = f'asset:{ftype}:door_gap:{k}'
            s.dimensions = (0.004, 0.003, y1 - y0)
            s.location = (wx, wy, bz + sy)
            s.rotation_euler = (0, 0, rz)
            s.data.materials.append(gap_mat)
            n += 1
    if n:
        print(f'[dress_scene] cabinet door gaps: {ftype} ×{n}')
    return n


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


def dress_tv_wall_low(config_dir: str) -> dict[str, int]:
    """用 BlenderKit sideboard 替换正式客厅电视低柜；导入失败时保留原柜体。"""
    import mathutils

    prefix = 'furniture:living_dining:tv_wall_low:'

    # 本轮唯一的电视柜替换：不改正式锚点坐标/旋转，也不触碰电视及其他软装。
    source_objects = [obj for obj in bpy.data.objects
                      if obj.name.startswith(prefix) and not _is_render_only(obj)]
    source_anchors = [obj for obj in _furniture_instance_anchors(source_objects).values()
                      if obj.name.startswith(prefix)]
    if not source_anchors:
        print('[dress_scene] tv_wall_low sideboard failed: no formal instance '
              f'matching {prefix}')
        return {'objects': 0, 'modifiers': 0, 'images': 0, 'front_panels': 0,
                'separators': 0, 'toe_kick': 0}
    source = source_anchors[0]
    anchor_location = source.matrix_world.translation.copy()
    anchor_rotation = source.matrix_world.to_quaternion()
    source_family = [obj for obj in bpy.data.objects
                     if obj is source or obj.name.startswith(prefix)]
    print(f'[dress_scene] tv_wall_low sideboard source_objects={len(source_family)} '
          f'names={[obj.name for obj in source_family]}')

    # 旧程序化前面板、separator、踢脚增强件全部禁用；不删除正式 GLB 几何。
    old_enhancements = [obj for obj in bpy.data.objects
                        if obj.name.startswith('render_only:tv_wall_low:')]
    for obj in old_enhancements:
        obj.hide_render = True
        obj.hide_viewport = True
    if old_enhancements:
        print(f'[dress_scene] tv_wall_low sideboard disabled_old_enhancements='
              f'{[obj.name for obj in old_enhancements]}')

    asset_path = os.path.join(config_dir or '.', 'assets', 'furniture',
                              'blenderkit_sideboard', 'sideboard.blend')
    existing_asset = bpy.data.objects.get('asset:tv_wall_low:blenderkit_sideboard')
    if existing_asset is not None:
        _set_recursive_hidden(source, True)
        existing_asset.hide_render = False
        existing_asset.hide_viewport = False
        print('[dress_scene] tv_wall_low sideboard reused: asset:tv_wall_low:blenderkit_sideboard')
        return {'objects': 1, 'modifiers': 0, 'images': 0, 'front_panels': 0,
                'separators': 0, 'toe_kick': 0}
    if not os.path.isfile(asset_path):
        print(f'[dress_scene] tv_wall_low sideboard failed: asset missing: {asset_path}')
        return {'objects': 0, 'modifiers': 0, 'images': 0, 'front_panels': 0,
                'separators': 0, 'toe_kick': 0}

    before = set(bpy.data.objects)
    try:
        imported = import_furniture_glb(asset_path, {}, block=source, rot_fix=0)
    except Exception as exc:
        print(f'[dress_scene] tv_wall_low sideboard failed: import exception: '
              f'{type(exc).__name__}: {exc}')
        return {'objects': 0, 'modifiers': 0, 'images': 0, 'front_panels': 0,
                'separators': 0, 'toe_kick': 0}
    imported_objects = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
    if not imported or not imported_objects:
        print(f'[dress_scene] tv_wall_low sideboard failed: no imported mesh '
              f'(import_result={imported}, objects={[obj.name for obj in imported_objects]})')
        return {'objects': 0, 'modifiers': 0, 'images': 0, 'front_panels': 0,
                'separators': 0, 'toe_kick': 0}

    asset = imported_objects[-1]
    asset.name = 'asset:tv_wall_low:blenderkit_sideboard'
    # 资产源实测约 1.816×0.65×0.874m；保留原材质/UV，温和调整到电视柜目标比例。
    asset.dimensions = (2.05, 0.44, 0.47)
    bpy.context.view_layer.update()
    asset.rotation_mode = 'QUATERNION'
    asset.rotation_quaternion = anchor_rotation
    asset.location = anchor_location
    _mark_render_only(asset, 'tv_wall_low:blenderkit_sideboard')
    asset['geometrySource'] = 'blender_staging'
    asset['assetKind'] = 'REAL asset'
    asset['assetProvider'] = 'BlenderKit'
    asset['assetSource'] = asset_path
    asset['formalWebGeometry'] = False

    # 只有导入成功后才隐藏正式实例，确保失败时原柜体仍可见。
    _set_recursive_hidden(source, True)
    asset.hide_render = False
    asset.hide_viewport = False
    bpy.context.view_layer.update()
    bb = [asset.matrix_world @ mathutils.Vector(c) for c in asset.bound_box]
    bbox = tuple(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3))
    materials = [mat for mat in asset.data.materials if mat is not None]
    images = {node.image for mat in materials if mat.use_nodes
              for node in mat.node_tree.nodes
              if node.type == 'TEX_IMAGE' and node.image is not None}
    image_texture_count = sum(1 for mat in materials if mat.use_nodes
                              for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE')
    packed_images = sum(1 for image in images if image.packed_file is not None)
    print(f'[dress_scene] tv_wall_low sideboard imported_objects='
          f'{[obj.name for obj in imported_objects]} final_object={asset.name} '
          f'final_bbox=({bbox[0]:.4f},{bbox[1]:.4f},{bbox[2]:.4f}) '
          f'dimensions=({asset.dimensions.x:.4f},{asset.dimensions.y:.4f},{asset.dimensions.z:.4f}) '
          f'material_slots={len(asset.data.materials)} materials={[mat.name for mat in materials]} '
          f'uv_layers={len(asset.data.uv_layers)} image_textures={image_texture_count} '
          f'images={len(images)} packed_images={packed_images} '
          f'rotation={tuple(round(v, 5) for v in asset.rotation_euler)}')
    return {'objects': 1, 'modifiers': 0, 'images': len(images), 'front_panels': 0,
            'separators': 0, 'toe_kick': 0}

    # Legacy cabinet-detail path retained below for reference only; unreachable after
    # the canonical sideboard replacement above and intentionally does not run.
    bevel_roles = {'cabinet_body', 'door_front', 'end_panel', 'countertop', 'plinth', 'cabinet_support'}
    wood_roles = {'cabinet_body', 'door_front', 'end_panel'}
    front_roles = {'door_front', 'drawer_front'}
    skipped_parts = {'door_seam', 'handle', 'feet', 'niche-light'}
    tex_dir = os.path.join(config_dir or '.', 'assets', 'textures', 'oak_veneer_01')
    texture_files = ('diff.jpg', 'normal.jpg', 'rough.jpg')
    textures_ready = all(
        os.path.isfile(os.path.join(tex_dir, filename))
        and os.path.getsize(os.path.join(tex_dir, filename)) > 0
        for filename in texture_files
    )
    bevel_count = 0
    processed_objects = 0
    image_count = 0
    panel_count = 0
    separator_count = 0
    local_materials = {}
    role_tints = {
        'cabinet_body': '#503e2e',
        'door_front': '#604a35',
        'end_panel': '#493626',
        'countertop': '#6a5139',
        'plinth': '#2d2520',
        'cabinet_support': '#382d26',
    }

    def assign_material(obj, material):
        if obj.data.materials:
            for index in range(len(obj.data.materials)):
                obj.data.materials[index] = material
        else:
            obj.data.materials.append(material)

    def world_bounds(obj):
        half = obj.dimensions
        return (obj.location.x - half.x / 2, obj.location.x + half.x / 2,
                obj.location.y - half.y / 2, obj.location.y + half.y / 2,
                obj.location.z - half.z / 2, obj.location.z + half.z / 2)

    def make_role_material(role, source):
        material = local_materials.get(role)
        if material is not None:
            return material
        if source is None:
            return None
        material = source.copy()
        material.name = f'{source.name}_tv_wall_low_{role}'
        local_materials[role] = material
        if role in wood_roles and textures_ready:
            before_images = {node.image.name for node in material.node_tree.nodes
                             if node.bl_idname == 'ShaderNodeTexImage' and node.image is not None}
            if not add_pbr_maps(material, tex_dir, size=1.0, with_diffuse=True,
                                normal_strength=0.3, tint=role_tints[role]):
                local_materials.pop(role, None)
                return None
            nonlocal image_count
            image_count += sum(
                1 for node in material.node_tree.nodes
                if node.bl_idname == 'ShaderNodeTexImage' and node.image is not None
                and node.image.name not in before_images
            )
        else:
            bsdf = _find_node(material.node_tree, 'ShaderNodeBsdfPrincipled')
            if bsdf is not None:
                bsdf.inputs['Base Color'].default_value = (*hex_rgb(role_tints[role]), 1.0)
                bsdf.inputs['Roughness'].default_value = {
                    'countertop': 0.48, 'plinth': 0.72, 'cabinet_support': 0.58,
                }.get(role, 0.62)
        return material

    for obj in bpy.data.objects:
        if obj.type != 'MESH' or not obj.name.startswith(prefix):
            continue
        role = fixture_material_role(obj.name)
        part_name = obj.name[len(prefix):].lower()
        if role in skipped_parts or any(token in part_name for token in skipped_parts):
            continue
        if role in bevel_roles:
            processed_objects += 1
            if min(float(value) for value in obj.dimensions) >= 0.012 and not obj.modifiers.get('tv_wall_low_soft_bevel'):
                modifier = obj.modifiers.new('tv_wall_low_soft_bevel', 'BEVEL')
                modifier.width = 0.0025
                modifier.segments = 2
                modifier.limit_method = 'ANGLE'
                try:
                    modifier.harden_normals = True
                except Exception:
                    pass
                bevel_count += 1
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
            material = make_role_material(role, obj.active_material)
            if material is not None:
                assign_material(obj, material)

    front_parts = [obj for obj in bpy.data.objects
                   if obj.type == 'MESH' and obj.name.startswith(prefix)
                   and fixture_material_role(obj.name) in front_roles
                   and obj.dimensions.x > 0.04 and obj.dimensions.y > 0.004 and obj.dimensions.z > 0.04]
    if not front_parts:
        print('[dress_scene] tv_wall_low: no usable door-front bounds; render-only geometry skipped')
        return {'objects': processed_objects, 'modifiers': bevel_count, 'images': image_count,
                'front_panels': 0, 'separators': 0, 'toe_kick': 0}

    # 远程实测：正式 door-front-base 的正面是 Blender +Y；仅隐藏连续门板本身。
    original_fronts = [obj for obj in front_parts if 'door-front-base' in obj.name.lower()]
    if original_fronts:
        for obj in original_fronts:
            obj.hide_render = True
    print(f'[dress_scene] tv_wall_low: original_door_front_hidden={bool(original_fronts)} '
          f'objects={[obj.name for obj in original_fronts]}')

    front_bounds = [world_bounds(obj) for obj in front_parts]
    x0, x1 = min(b[0] for b in front_bounds), max(b[1] for b in front_bounds)
    z0, z1 = min(b[4] for b in front_bounds), max(b[5] for b in front_bounds)
    front_surface = max(b[3] for b in front_bounds)
    seam_centers = sorted(obj.location.x for obj in bpy.data.objects
                          if obj.type == 'MESH' and obj.name.startswith(prefix)
                          and fixture_material_role(obj.name) == 'door_seam'
                          and x0 < obj.location.x < x1)
    cuts = sorted(seam_centers[:2] if len(seam_centers) >= 2 else
                  [x0 + (x1 - x0) / 3, x0 + 2 * (x1 - x0) / 3])
    edges = [x0, *cuts, x1]

    source = front_parts[0].active_material
    panel_tints = ('#6b4d35', '#795a3d', '#5a402c')
    panel_materials = []
    for index, tint in enumerate(panel_tints):
        name = f'tv_wall_low_render_panel:{index:02d}'
        material = bpy.data.materials.get(name)
        if material is None:
            material = source.copy() if source is not None else new_principled(name, hex_rgb(tint), rough=0.56)
            material.name = name
            if textures_ready:
                before_images = {node.image.name for node in material.node_tree.nodes
                                 if node.bl_idname == 'ShaderNodeTexImage' and node.image is not None}
                if add_pbr_maps(material, tex_dir, size=1.0, with_diffuse=True,
                                normal_strength=0.3, tint=tint):
                    image_count += sum(
                        1 for node in material.node_tree.nodes
                        if node.bl_idname == 'ShaderNodeTexImage' and node.image is not None
                        and node.image.name not in before_images
                    )
            else:
                bsdf = _find_node(material.node_tree, 'ShaderNodeBsdfPrincipled') if material.use_nodes else None
                if bsdf is not None:
                    bsdf.inputs['Base Color'].default_value = (*hex_rgb(tint), 1.0)
                    bsdf.inputs['Roughness'].default_value = 0.56
        panel_materials.append(material)

    seam_material = bpy.data.materials.get('tv_wall_low_render_shadow_line')
    if seam_material is None:
        seam_material = new_principled('tv_wall_low_render_shadow_line', hex_rgb('#1b120d'), rough=0.88)

    def enhancement(name, role, dimensions, location, material, bevel_width):
        nonlocal panel_count, separator_count
        obj = bpy.data.objects.get(name)
        if obj is None:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            obj = bpy.context.object
            obj.name = name
            _mark_render_only(obj, role)
            if role == 'tv_wall_low:front_panel':
                panel_count += 1
            else:
                separator_count += 1
        obj.dimensions = dimensions
        obj.location = location
        assign_material(obj, material)
        modifier = obj.modifiers.get('tv_wall_low_render_bevel') or obj.modifiers.new('tv_wall_low_render_bevel', 'BEVEL')
        modifier.width = bevel_width
        modifier.segments = 3
        modifier.limit_method = 'ANGLE'
        return obj

    panel_depth = 0.020
    panel_offset = 0.012
    panel_height = max(0.04, z1 - z0 - 0.018)
    panel_z = (z0 + z1) / 2
    seam_width = 0.022
    seam_depth = 0.006
    seam_height = z1 - z0 - 0.006
    panels = []
    for index in range(3):
        left, right = edges[index], edges[index + 1]
        width = right - left - seam_width - 0.004
        panel = enhancement(
            f'render_only:tv_wall_low:front_panel:{index:02d}', 'tv_wall_low:front_panel',
            (width, panel_depth, panel_height),
            ((left + right) / 2, front_surface + panel_offset + panel_depth / 2, panel_z),
            panel_materials[index], 0.0035)
        panels.append(panel)

    separators = []
    panel_front = front_surface + panel_offset + panel_depth
    for index, cut in enumerate(cuts):
        separator = enhancement(
            f'render_only:tv_wall_low:separator:v:{index:02d}', 'tv_wall_low:separator',
            (seam_width, seam_depth, seam_height),
            (cut, panel_front - seam_depth / 2, panel_z), seam_material, 0.001)
        separators.append(separator)

    # 旧版本曾创建方盒踢脚；本版本不再创建，已有对象直接移除，避免被后续重置重新显示。
    old_toe_kick = bpy.data.objects.get('render_only:tv_wall_low:toe_kick_shadow')
    if old_toe_kick is not None:
        bpy.data.objects.remove(old_toe_kick, do_unlink=True)

    enhancements = [*panels, *separators]
    print(f'[dress_scene] tv_wall_low: front_surface_y={front_surface:.6f} '
          f'panels=3 seam_width={seam_width:.3f} seam_depth={seam_depth:.3f} '
          f'panel_depth={panel_depth:.3f} panel_offset={panel_offset:.3f} '
          f'bevel_objects={bevel_count} processed_objects={processed_objects} '
          f'wood_pbr={"ready" if textures_ready else "skipped_missing_assets"}')
    for obj in enhancements:
        print(f'[dress_scene] tv_wall_low enhancement: {obj.name} '
              f'dimensions=({obj.dimensions.x:.4f},{obj.dimensions.y:.4f},{obj.dimensions.z:.4f}) '
              f'location=({obj.location.x:.4f},{obj.location.y:.4f},{obj.location.z:.4f}) '
              f'render_only={_is_render_only(obj)}')
    return {'objects': processed_objects, 'modifiers': bevel_count, 'images': image_count,
            'front_panels': panel_count, 'separators': separator_count, 'toe_kick': 0}


FURNITURE_GLB = {
    # 中古胡桃方向（DEC-2026-08-20-025/026）：Poly Haven CC0，清单见 assets/SOURCES.md
    # width/height 为目标尺寸（米）：缩放系数取 width/模型宽 与 height/模型高 的较小者，
    # 防止模型长宽比与目标槽位不一致时拉飞高度（wooden_table_02 按宽缩会顶到 0.99m）
    # tint: 可选，对导入材质做乘色（如中色木桌压成深胡桃）
    # DEC-026：沙发/餐椅/茶几换 BlenderKit 现代中古款（Burrard 直排+细腿、
    # 藤编细腿餐椅、Noguchi 黑座玻璃圆几），弃 Chesterfield/高背拉扣/工业方几
    # 布纹底图 col_2（灰蓝）× #a36954 乘色 ≈ 目标深棕 #3a2e26（乘色反推）
    'sofa_3seat': {'path': 'assets/furniture/burrard_sofa/burrard_sofa.blend', 'width': 2.8, 'height': 0.8, 'tint': '#a36954', 'tint_mode': 'solid', 'fabric_tex': 'assets/textures/fabric_pattern_07', 'fabric_soften': 0.55},
    'dining_chair': {'path': 'assets/furniture/rattan_dining_chair/rattan_dining_chair.blend', 'width': 0.5, 'height': 0.9, 'tint': '#6b4c38'},
    'dining_table': {'path': 'assets/furniture/wooden_table_02/wooden_table_02.gltf', 'width': 1.4, 'height': 0.78, 'tint': '#54382a'},
    'plant_fiddle': {'path': 'assets/furniture/potted_plant_01/potted_plant_01.gltf', 'width': 0.6, 'tint': '#a89a8c'},  # 陶土盆亮橙太跳，乘灰陶色压暗
    # 2026-08-23 电器缺员（BlenderKit，清单见 assets/SOURCES.md）：width/height 约束到 standard 尺寸，
    # lift=离地抬升（dryer 叠放支架层 / water_heater 壁挂）；朝向未实测，下轮渲染核对后按需补 rot_fix
    'washer': {'path': 'assets/furniture/washer/washer.blend', 'width': 0.60, 'height': 0.85},
    # Samsung 套组含洗衣机+烘干机+展柜三 mesh，只留烘干机（drop_nodes 前缀/精确匹配）
    'dryer': {'path': 'assets/furniture/dryer/dryer.blend', 'width': 0.60, 'height': 0.85, 'lift': 0.88,
              'drop_nodes': ['Washer AI Home 7" LCD Display AI OptiWash', 'cabinets']},
    'dishwasher': {'path': 'assets/furniture/dishwasher/dishwasher.blend', 'width': 0.60, 'height': 0.82},
    # 厨房电器：BlenderKit 冰箱 source 原始 Z=2.76m，但 append 四元数复合前计算到的高度轴为 1.90m；
    # height=1.24 → scale≈0.65，最终直立高度≈1.80m、宽≈0.75m，契合东墙高柜位。
    # Build In Gas Stove 75x51 资产经摆位四元数复合后变为 51cm 高立块（EEVEE v35b），不可用；
    # Whirlpool Range Hood 亦为 13cm 顶吸薄板、无竖向烟管，均继续回退到已验证的程序化壁挂烟机/嵌入式灶具。
    'fridge': {'path': 'assets/furniture/fridge/fridge.blend', 'width': 0.68, 'height': 1.24},
    # BlenderKit 的 Shower Water Heater 在 append→摆位四元数复合后横躺（EEVEE v34 仅高 11cm），
    # 暂保留程序化壁挂机回退；待找到已归一化为 +Z 竖直的资产再启用，禁止以错误姿态入图。
    # 主卧真实床候选：导入失败时保留程序化床体回退；仅按宽度等比缩放，不强行拉伸。
    'bed_180': {'path': 'assets/furniture/blenderkit_upholstered_bed_51602564/bed.blend', 'width': 1.8},
    # bed_150 候选因导入后尺度异常，禁用 BlenderKit 替换并回退程序化床。
    # 客卫浴室柜：资产含木纹贴图；导入失败时保留程序化 vanity 回退。
    'vanity': {'path': 'assets/furniture/blenderkit_vanity/vanity.blend', 'width': 0.60},
    # 床 GLB（bed_soft_modern）暂不进管线：headless 下导入姿态不稳（baked 倾角+辅助 Cube，
    # 见 docs/renders/pipeline-acceptance.md v16 节），回退程序化床体；待 GUI Blender 定姿后再启用
}


def uniform_asset_scale(model_w: float, model_h: float, targets: dict) -> float:
    """按导入资产实际 bbox 计算统一缩放；宽高约束取较小值以保持原比例。"""
    scales = []
    if targets.get('width') and model_w > 0.01:
        scales.append(float(targets['width']) / model_w)
    if targets.get('height') and model_h > 0.01:
        scales.append(float(targets['height']) / model_h)
    return min(scales) if scales else 1.0


def import_furniture_glb(glb_path: str, targets: dict, block=None, loc_rz=None, rot_fix: float = 0) -> int:
    """导入 .glb/.gltf 家具模型，归一化缩放后放置并写入资产审计元数据。
    targets: {'width': 米, 'height': 米, 'tint': '#hex'}（均可省），缩放取各约束的较小值；
    tint 时对每个导入材质的 Base Color 前插 MULTIPLY 节点（保纹理、压色调）。
    放置：block（继承其世界变换）或 loc_rz=((x,y,z), rz)（Blender 坐标，用于 place_extra_furniture）。
    步骤：导入→剥骨架→合并→命名/审计元数据→设原点→缩放→tint→贴地→定位→旋转。
    审计元数据是 blend_asset 基线；调用方后续可显式标记 render-only staging。"""
    import math
    import mathutils

    existing = set(obj.name for obj in bpy.data.objects)
    if glb_path.lower().endswith('.blend'):
        # BlenderKit 资产多为 .blend（含打包贴图）：append 全部对象再按既有流程处理
        with bpy.data.libraries.load(glb_path) as (data_from, data_to):
            data_to.objects = data_from.objects
        for o in data_to.objects:
            if o is not None:
                try:
                    bpy.context.collection.objects.link(o)
                except Exception:
                    pass
        # 清理 append 带入的非网格对象（相机/灯光），避免污染场景
        for o in [o for o in bpy.data.objects
                  if o.name not in existing and o.type in ('CAMERA', 'LIGHT')]:
            bpy.data.objects.remove(o)
    else:
        bpy.ops.import_scene.gltf(filepath=glb_path)
    new_objs = [obj for obj in bpy.data.objects if obj.name not in existing and obj.type == 'MESH']
    # drop_nodes：资产导出残留的辅助节点（如 bed_soft_modern 的 2m 包围盒 Cube），不参与合并；
    # 导入可能因重名加 .NNN 后缀，按前缀匹配。
    # 注：drop_nodes/level_x/flip_axis 当前无条目引用（床 GLB 回退程序化），属预留机制，床启用时生效
    for drop in targets.get('drop_nodes', []):
        new_objs = [o for o in new_objs if o.name != drop and not o.name.startswith(drop + '.')]
    if not new_objs:
        print(f'[dress_scene] WARN glb 导入无 mesh: {glb_path}')
        return 0

    # 剥掉骨架/动画绑定：家具资产不需要 rig。Poly Haven 部分模型（滑门柜/铁架茶几）
    # 带 Armature 修改器，transform_apply 后网格被骨骼扯回错误姿态（木板立起/跑偏）
    new_armatures = [o for o in bpy.data.objects if o.name not in existing and o.type == 'ARMATURE']
    for obj in new_objs:
        for mod in list(obj.modifiers):
            if mod.type == 'ARMATURE':
                obj.modifiers.remove(mod)
        if obj.parent is not None and obj.parent.type == 'ARMATURE':
            mw_keep = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = mw_keep
    for arm in new_armatures:
        bpy.data.objects.remove(arm)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in new_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = new_objs[0]

    if len(new_objs) > 1:
        bpy.ops.object.join()

    obj = bpy.context.active_object
    tag = block.name.split(":")[2] if block is not None and ":" in block.name else "extra"
    obj.name = f'asset:{tag}:glb'
    # 导入资产的审计基线；render-only staging 标记由调用方显式追加，不在此覆盖。
    normalized_glb_path = os.path.normpath(glb_path)
    obj['geometrySource'] = 'blend_asset'
    obj['assetProvider'] = 'BlenderKit' if 'blenderkit' in glb_path.lower() else 'external_asset'
    obj['assetSource'] = normalized_glb_path
    obj['assetKind'] = 'REAL asset'
    obj['formalWebGeometry'] = False

    # 原点设到几何中心
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

    # 计算包围盒 → 缩放（宽/高约束取小，防长宽比失真）
    bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    model_w = max(c.x for c in bb) - min(c.x for c in bb)
    model_h = max(c.z for c in bb) - min(c.z for c in bb)
    scale = uniform_asset_scale(model_w, model_h, targets)
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # tint 乘色（可选）：Base Color 前插 MULTIPLY，保纹理压色调
    # tint_mode='solid'：直接替换 Base Color 为纯色（乘色改不了色相，绿布×棕=还是绿）
    tint = targets.get('tint')
    if tint:
        solid = targets.get('tint_mode') == 'solid'
        for mat in obj.data.materials:
            if mat is None or not mat.use_nodes:
                continue
            nt = mat.node_tree
            bsdf = _find_node(nt, 'ShaderNodeBsdfPrincipled')
            if bsdf is None:
                continue
            base_in = bsdf.inputs['Base Color']
            if solid:
                for link in list(base_in.links):
                    nt.links.remove(link)
                # fabric_tex：纯色修正但保布纹（沙发原布料色相不对，替换为布纹×色号乘色）
                ftex = targets.get('fabric_tex')
                diff = os.path.join(ftex, 'diff.jpg') if ftex else None
                # 0 字节坏文件回退纯色（防占位文件渲染品红）
                if diff and os.path.exists(diff) and os.path.getsize(diff) > 0:
                    geo = nt.nodes.new('ShaderNodeNewGeometry')
                    mp = nt.nodes.new('ShaderNodeMapping')
                    mp.inputs['Scale'].default_value = (1.0 / 0.35,) * 3
                    img = bpy.data.images.load(diff)
                    tn = nt.nodes.new('ShaderNodeTexImage')
                    tn.image = img
                    tn.projection = 'BOX'
                    tn.projection_blend = 0.3
                    mul2 = nt.nodes.new('ShaderNodeMixRGB')
                    mul2.blend_type = 'MULTIPLY'
                    mul2.inputs['Fac'].default_value = 1.0
                    mul2.inputs['Color2'].default_value = (*hex_rgb(tint), 1.0)
                    nt.links.new(geo.outputs['Position'], mp.inputs['Vector'])
                    nt.links.new(mp.outputs['Vector'], tn.inputs['Vector'])
                    # fabric_soften（0~1）：先把布纹往中灰抹平再乘色，压低格纹对比度
                    # （fabric_pattern_07 棋盘格 35cm 重复太跳，沙发显"贴皮"）
                    soften = float(targets.get('fabric_soften', 0.0))
                    if soften > 0:
                        flat = nt.nodes.new('ShaderNodeMixRGB')
                        flat.blend_type = 'MIX'
                        flat.inputs['Fac'].default_value = soften
                        flat.inputs['Color2'].default_value = (0.62, 0.60, 0.57, 1.0)
                        nt.links.new(tn.outputs['Color'], flat.inputs['Color1'])
                        nt.links.new(flat.outputs['Color'], mul2.inputs['Color1'])
                    else:
                        nt.links.new(tn.outputs['Color'], mul2.inputs['Color1'])
                    nt.links.new(mul2.outputs['Color'], base_in)
                else:
                    base_in.default_value = (*hex_rgb(tint), 1.0)
                continue
            mul = nt.nodes.new('ShaderNodeMixRGB')
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Fac'].default_value = 1.0
            mul.inputs['Color2'].default_value = (*hex_rgb(tint), 1.0)
            if base_in.is_linked:
                nt.links.new(base_in.links[0].from_socket, mul.inputs['Color1'])
            else:
                mul.inputs['Color1'].default_value = base_in.default_value
            nt.links.new(mul.outputs['Color'], base_in)

    # 定位 + 旋转（继承 block 的世界变换，或用显式 loc_rz）
    # 关键：glTF 导入对象多为 rotation_mode='QUATERNION'，且模型自带 +90°X 基础旋转
    # （Y-up→Z-up 转换）。切 XYZ 模式/覆盖 rotation_euler 会静默丢掉基础旋转
    # （茶几木板立起来、电视柜嵌墙、床朝向悬案全是这一类）→ 一律用四元数复合：
    # 最终旋转 = 摆位 yaw ⊗ 模型原始旋转
    from mathutils import Quaternion
    orig_quat = obj.matrix_world.to_quaternion()
    if loc_rz is not None:
        (lx, ly, lz), rz = loc_rz
        obj.location = (lx, ly, lz)
        base = Quaternion((0, 0, 1), rz + math.radians(rot_fix))
    else:
        mw = block.matrix_world
        obj.location.x = mw.translation.x
        obj.location.y = mw.translation.y
        base = mw.to_quaternion() @ Quaternion((0, 0, 1), math.radians(rot_fix))
    # level_x：资产自带展示倾角（如 bed_soft_modern 根节点 baked 30.5° X 倾斜）。
    # block 四元数可能含额外 X 分量使共轭变号，故两符号都试、取高度小者。
    # flip_axis：180° 翻转绕长轴纠正正反面（自共轭，不受 block 旋转影响），不改变床头端
    level_deg = targets.get('level_x', 0)
    flip = {'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}.get(targets.get('flip_axis', ''))
    flip_q = Quaternion(flip, math.pi) if flip else Quaternion()
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = base @ flip_q @ Quaternion((1, 0, 0), math.radians(level_deg)) @ orig_quat
    if level_deg:
        bpy.context.view_layer.update()
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        h1 = max(c.z for c in bb) - min(c.z for c in bb)
        obj.rotation_quaternion = base @ flip_q @ Quaternion((1, 0, 0), math.radians(-level_deg)) @ orig_quat
        bpy.context.view_layer.update()
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        if max(c.z for c in bb) - min(c.z for c in bb) < h1:
            pass  # 负号更平，保持
        else:
            obj.rotation_quaternion = base @ flip_q @ Quaternion((1, 0, 0), math.radians(level_deg)) @ orig_quat
    bpy.context.view_layer.update()
    # 旋转后重新算世界包围盒 → 贴地（保证旋转不抬升）
    bb2 = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    min_z = min(c.z for c in bb2)
    obj.location.z -= min_z
    # lift：叠放/壁挂件的离地抬升（dryer 叠洗衣机 +0.88、water_heater 挂墙 +1.40）
    lift = targets.get('lift')
    if lift:
        obj.location.z += lift
    dims = [round(max(c[i] for c in bb2) - min(c[i] for c in bb2), 2) for i in range(3)]
    print(f'[dress_scene] glb import: {obj.name} scale={scale:.2f} dims={dims} loc={tuple(round(v,2) for v in obj.location)}')

    # 材质豁免：asset: 前缀 → classify 返回 skip
    return 1


def _world_bbox_for_objects(objects):
    """Return the world-space bbox of mesh objects, or None when unavailable."""
    import mathutils
    corners = []
    for obj in objects:
        if getattr(obj, 'type', None) != 'MESH':
            continue
        corners.extend(obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box)
    if not corners:
        return None
    return tuple(
        (min(c[i] for c in corners), max(c[i] for c in corners))
        for i in range(3)
    )


def _report_render_only_asset(obj, label: str, source_path: str, source_bbox=None) -> None:
    """Print the staging evidence required for post-render asset auditing."""
    bbox = _world_bbox_for_objects([obj])
    if bbox is None:
        print(f'[dress_scene] real asset audit: {label} has no mesh bbox source={source_path}')
        return
    dims = tuple(hi - lo for lo, hi in bbox)
    materials = [mat for mat in obj.data.materials if mat is not None]
    images = set()
    image_texture_count = 0
    for mat in materials:
        material_images = []
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE':
                    image_texture_count += 1
                    if node.image is not None:
                        images.add(node.image)
                        material_images.append(node.image.name)
        print(f'[dress_scene] asset material: {label} material={mat.name} '
              f'image_textures={len(material_images)} images={material_images}')
    packed_images = sum(1 for image in images if image.packed_file is not None)
    source_text = ''
    if source_bbox is not None:
        source_dims = tuple(hi - lo for lo, hi in source_bbox)
        source_text = f' source_bbox=({source_dims[0]:.4f},{source_dims[1]:.4f},{source_dims[2]:.4f})'
    print(f'[dress_scene] real asset audit: {label} source={source_path}{source_text} '
          f'final_bbox=({dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}) '
          f'dimensions=({obj.dimensions.x:.4f},{obj.dimensions.y:.4f},{obj.dimensions.z:.4f}) '
          f'material_slots={len(obj.data.materials)} materials={[mat.name for mat in materials]} '
          f'uv_layers={len(obj.data.uv_layers)} image_textures={image_texture_count} '
          f'images={len(images)} packed_images={packed_images}')


def _mark_candidate_asset(obj, role: str, source_path: str, metadata_path: str | None = None) -> None:
    _mark_render_only(obj, role)
    obj['geometrySource'] = 'blender_staging'
    obj['assetProvider'] = 'BlenderKit'
    obj['assetSource'] = os.path.normpath(source_path)
    obj['assetKind'] = 'REAL asset'
    obj['formalWebGeometry'] = False
    if metadata_path and os.path.isfile(metadata_path):
        try:
            with open(metadata_path, encoding='utf-8') as metadata_file:
                metadata = json.load(metadata_file)
            obj['candidateMetadata'] = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
            for key in ('uuid', 'file_id', 'file_type', 'asset_type', 'license', 'validation_status', 'download_status'):
                value = metadata.get(key)
                if value is not None:
                    obj[f'candidate_{key}'] = str(value)
        except (OSError, TypeError, ValueError) as exc:
            print(f'[dress_scene] WARN candidate metadata unreadable; continue staging: '
                  f'{metadata_path}: {type(exc).__name__}: {exc}')


def stage_missing_room_candidates(config_dir: str) -> int:
    """Stage reviewed BlenderKit candidates without changing formal layout data.

    Positions come only from current furniture anchors or named plumbing bboxes.
    Every candidate is render-only; a missing or failed import leaves the existing
    formal/procedural fallback visible.
    """
    import mathutils
    if not config_dir:
        print('[dress_scene] room candidates skipped: config dir missing')
        return 0

    root = os.path.join(config_dir, 'assets', 'furniture', 'blenderkit_candidates')
    candidates = (
        {
            'name': 'asset:guest_bath:mirror_cabinet_simple',
            'role': 'guest_bath:mirror_cabinet_simple',
            'path': os.path.join(root, 'bathrooms', 'mirror_cabinet_simple', 'mirror_cabinet_simple.blend'),
            'anchor_type': 'vanity', 'room_token': 'guest_bath', 'mode': 'above',
            'hide_tokens': ('mirror_cab',),
        },
        {
            'name': 'asset:entry_garden:shoe_cabinet_black',
            'role': 'entry_garden:shoe_cabinet_black',
            'path': os.path.join(root, 'public', 'shoe_cabinet_black', 'shoe_cabinet_black.blend'),
            'anchor_type': 'garden_entry_station', 'room_token': 'entry_garden', 'mode': 'east',
            'hide_tokens': ('shoe_body', 'door_', 'pull_', 'shoe_top'),
        },
        {
            'name': 'asset:kitchen:gas_stove_cooktop',
            'role': 'kitchen:gas_stove_cooktop',
            # 目录当前仅有 metadata.json；模型缺失时只记录 fallback，不伪造 REAL asset。
            'path': os.path.join(root, 'kitchen_missing', 'gas_stove_cooktop', 'gas_stove_cooktop.blend'),
            'metadata_path': os.path.join(root, 'kitchen_missing', 'gas_stove_cooktop', 'metadata.json'),
            'anchor_type': 'gas_stove', 'room_token': 'kitchen', 'mode': 'surface',
            'hide_tokens': ('gas_stove', 'cooktop', 'burner'),
        },
        {
            'name': 'asset:study:bedroom_desk',
            'role': 'study:bedroom_desk',
            'path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'bedroom_desk.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'metadata.json'),
            'anchor_type': 'desk', 'room_token': 'study', 'mode': 'ground',
            'hide_tokens': ('desk',),
        },
        {
            'name': 'asset:study:office_chair',
            'role': 'study:office_chair',
            'path': os.path.join(root, 'bedroom_missing', 'office_chair', 'office_chair.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'office_chair', 'metadata.json'),
            'anchor_type': 'chair', 'room_token': 'study', 'mode': 'ground',
            'hide_tokens': ('chair',),
        },
        {
            'name': 'asset:bedroom_nw:desk',
            'role': 'bedroom_nw:desk',
            'path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'bedroom_desk.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'metadata.json'),
            'anchor_type': 'desk', 'room_token': 'bedroom_nw', 'mode': 'ground',
            'fit_anchor_bbox': True, 'hide_tokens': ('desk', 'desktop', 'tabletop'),
        },
        {
            'name': 'asset:bedroom_nw:chair',
            'role': 'bedroom_nw:chair',
            'path': os.path.join(root, 'bedroom_missing', 'office_chair', 'office_chair.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'office_chair', 'metadata.json'),
            'anchor_type': 'chair', 'room_token': 'bedroom_nw', 'mode': 'ground',
            'fit_anchor_bbox': True, 'hide_tokens': ('chair', 'seat', 'caster', 'wheel'),
        },
        {
            'name': 'asset:living_dining:mid_century_lounge_chair',
            'role': 'living_dining:mid_century_lounge_chair',
            'path': os.path.join(root, 'public', 'mid_century_lounge_chair',
                                 'mid_century_lounge_chair.blend'),
            'metadata_path': os.path.join(root, 'public', 'mid_century_lounge_chair',
                                          'metadata.json'),
            'anchor_type': 'sofa_3seat', 'room_token': 'living_dining',
            'mode': 'living_lounge_chair', 'hide_tokens': ('lounge_chair', 'armchair', 'accent_chair'),
        },
    )

    public_candidates = (
        {
            'name': 'asset:living_dining:side_table_wood',
            'role': 'living_dining:side_table_wood',
            'path': os.path.join(root, 'public', 'side_table_wood', 'side_table_wood.blend'),
            'metadata_path': os.path.join(root, 'public', 'side_table_wood', 'metadata.json'),
        },
        {
            'name': 'asset:living_dining:wall_art_botanical',
            'role': 'living_dining:wall_art_botanical',
            'path': os.path.join(root, 'public', 'wall_art_botanical', 'wall_art_botanical.blend'),
            'metadata_path': os.path.join(root, 'public', 'wall_art_botanical', 'metadata.json'),
        },
    )

    # Bookshelf staging is floor-standing and can only follow an existing shelf/open-rack
    # anchor.  It never derives a position from house.yaml or attaches to a wall/glazing node.
    bookshelf_path = os.path.join(root, 'bedroom_missing', 'bookshelf', 'bookshelf.blend')
    bookshelf_metadata_path = os.path.join(root, 'bedroom_missing', 'bookshelf', 'metadata.json')
    bookshelf_specs = (
        ('bedroom_nw', 'asset:bedroom_nw:bookshelf', 'bedroom_nw:bookshelf', ('shelf', 'open_shelf', 'open_rack')),
        ('study', 'asset:study:bookshelf', 'study:bookshelf', ('shelf', 'open_shelf', 'open_rack')),
    )

    # Bathroom staging deliberately uses only the already exported room anchors/bboxes.
    # No house.yaml, furnishing coordinates, Web geometry, cameras, or lights are touched.
    bathroom_assets = (
        ('master_bath', 'toilet', 'toilet_wall_hung', 'toilet_wall_hung.blend', 'ground', ('toilet',)),
        ('guest_bath', 'toilet', 'toilet_wall_hung', 'toilet_wall_hung.blend', 'ground', ('toilet',)),
        ('master_bath', 'shower', 'shower_set', 'shower_set.blend', 'ground', (), 'shower_mbath'),
        ('guest_bath', 'shower', 'shower_set', 'shower_set.blend', 'ground', (), 'shower_gbath'),
        ('guest_bath', 'faucet', 'bathroom_faucet_black', 'bathroom_faucet_black.blend', 'surface', (), 'faucet_gbath_vanity'),
        ('master_bath', 'towel_set', 'towel_rail', 'towel_rail.blend', 'center', ('towel',)),
        ('guest_bath', 'towel_set', 'towel_rail', 'towel_rail.blend', 'center', ('towel',)),
    )
    staged = 0
    candidate_metadata_paths = {
        spec['name']: spec.get('metadata_path') for spec in candidates
        if spec.get('metadata_path')
    }
    candidate_metadata_paths.update({
        name: bookshelf_metadata_path for _, name, _, _ in bookshelf_specs
    })
    candidate_metadata_paths.update({
        spec['name']: spec['metadata_path'] for spec in public_candidates
    })

    def remove_new(before):
        for obj in [o for o in bpy.data.objects if o not in before]:
            bpy.data.objects.remove(obj, do_unlink=True)

    def stage_one(spec, anchor, anchor_bbox, path, mode, hide_tokens, fit_anchor_bbox=False):
        nonlocal staged
        name = spec
        metadata_path = candidate_metadata_paths.get(name)
        existing = bpy.data.objects.get(name)
        if existing is not None:
            _set_recursive_hidden(existing, False)
            _mark_candidate_asset(existing, spec.split(':', 2)[-1], path, metadata_path)
            _report_render_only_asset(existing, spec.split(':', 2)[-1], path, anchor_bbox)
            staged += 1
            return
        center = tuple((lo + hi) / 2 for lo, hi in anchor_bbox)
        rotation = anchor.matrix_world.to_quaternion() if anchor is not None else mathutils.Quaternion()
        before = set(bpy.data.objects)
        try:
            imported = import_furniture_glb(
                path, {'width': max(0.25, min(0.75, anchor_bbox[0][1] - anchor_bbox[0][0]))},
                loc_rz=((center[0], center[1], center[2]), rotation.to_euler().z))
        except Exception as exc:
            remove_new(before)
            print(f'[dress_scene] WARN room candidate import failed; keep fallback: '
                  f'{path}: {type(exc).__name__}: {exc}')
            return
        meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if not imported or not meshes:
            remove_new(before)
            print(f'[dress_scene] WARN bathroom candidate produced no mesh; keep fallback: {path}')
            return
        obj = meshes[-1]
        obj.name = name
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = rotation
        bpy.context.view_layer.update()
        bbox = _world_bbox_for_objects([obj])
        if bbox is None:
            print(f'[dress_scene] WARN bathroom candidate has no bbox; keep fallback: {path}')
            return
        obj.location.x, obj.location.y = center[0], center[1]
        lo_z, hi_z = bbox[2]
        if mode == 'ground':
            obj.location.z -= lo_z
        elif mode == 'surface':
            obj.location.z += anchor_bbox[2][1] - lo_z + 0.01
        elif mode in {'living_lounge', 'living_lounge_chair'}:
            # Derive all horizontal placement candidates from the formal sofa bbox.
            # The chair additionally protects other living furniture and the solid TV wall;
            # the existing side-table path retains its original sofa/table/rug checks.
            candidate_width = bbox[0][1] - bbox[0][0]
            candidate_depth = bbox[1][1] - bbox[1][0]
            sofa_cx = (anchor_bbox[0][0] + anchor_bbox[0][1]) / 2
            sofa_cy = (anchor_bbox[1][0] + anchor_bbox[1][1]) / 2
            sofa_positions = (
                (anchor_bbox[0][1] + candidate_width / 2 + 0.12, sofa_cy),
                (anchor_bbox[0][0] - candidate_width / 2 - 0.12, sofa_cy),
                (sofa_cx, anchor_bbox[1][1] + candidate_depth / 2 + 0.12),
                (sofa_cx, anchor_bbox[1][0] - candidate_depth / 2 - 0.12),
            )
            protected = []
            for protected_obj in bpy.data.objects:
                if protected_obj is obj or protected_obj.type != 'MESH':
                    continue
                protected_type = _furniture_type_from_object(protected_obj)
                protected_name = protected_obj.name
                name_lower = protected_name.lower()
                living_furniture = (
                    mode == 'living_lounge_chair'
                    and 'living_dining' in name_lower
                    and protected_type is not None
                )
                lounge_piece = protected_type in {'sofa_3seat', 'coffee_table'}
                living_rug = protected_name.startswith('asset:rug:living')
                solid_tv_wall = (
                    mode == 'living_lounge_chair'
                    and not _is_render_only(protected_obj)
                    and protected_name not in GLASS_IDS
                    and not protected_name.startswith('curtain_run:')
                    and (name_lower.startswith('furniture:living_dining:tv_wall_low:')
                         or name_lower.startswith('furniture:living_dining:wall_cabinet_tall:')
                         or 'tv_wall' in name_lower)
                )
                if not (living_furniture or lounge_piece or living_rug or solid_tv_wall):
                    continue
                protected_bbox = _world_bbox_for_objects([protected_obj])
                if protected_bbox is not None:
                    protected.append((protected_name, protected_bbox))
            placed = None
            for px, py in sofa_positions:
                obj.location.x, obj.location.y = px, py
                bpy.context.view_layer.update()
                trial_bbox = _world_bbox_for_objects([obj])
                if trial_bbox is None:
                    continue
                overlaps = [name for name, other_bbox in protected if all(
                    min(trial_bbox[i][1], other_bbox[i][1])
                    - max(trial_bbox[i][0], other_bbox[i][0]) > 0.02
                    for i in (0, 1))]
                if not overlaps:
                    placed = trial_bbox
                    break
            if placed is None:
                remove_new(before)
                print(f'[dress_scene] WARN living lounge candidate has no clear sofa-side bbox; '
                      f'keep fallback: {path}')
                return
            lo_z = placed[2][0]
            obj.location.z -= lo_z
        else:  # towel rail follows the existing towel_set bbox center.
            obj.location.z += center[2] - (lo_z + hi_z) / 2
        bpy.context.view_layer.update()
        placed_bbox = _world_bbox_for_objects([obj])
        if fit_anchor_bbox and placed_bbox is not None:
            anchor_width = anchor_bbox[0][1] - anchor_bbox[0][0]
            anchor_depth = anchor_bbox[1][1] - anchor_bbox[1][0]
            placed_width = placed_bbox[0][1] - placed_bbox[0][0]
            placed_depth = placed_bbox[1][1] - placed_bbox[1][0]
            if placed_width > anchor_width + 0.05 or placed_depth > anchor_depth + 0.05:
                remove_new(before)
                print(f'[dress_scene] WARN room candidate does not fit anchor; keep fallback: '
                      f'{path} placed=({placed_width:.3f},{placed_depth:.3f}) '
                      f'anchor=({anchor_width:.3f},{anchor_depth:.3f})')
                return
        role = name.split(':', 2)[-1]
        _mark_candidate_asset(obj, role, path, metadata_path)
        _report_render_only_asset(obj, role, path, anchor_bbox)
        hidden = []
        for child in bpy.data.objects:
            if child is anchor or not child.name.startswith(anchor.name + ':'):
                continue
            if any(token in child.name.lower() for token in hide_tokens):
                child['dress_replacement_source'] = True
                _set_recursive_hidden(child, True)
                hidden.append(child.name)
        print(f'[dress_scene] bathroom candidate staged: {obj.name} anchor={anchor.name} '
              f'anchor_bbox={anchor_bbox} hidden_duplicates={hidden}')
        staged += 1

    for spec in candidates:
        path = spec['path']
        if not os.path.isfile(path):
            if spec.get('metadata_path'):
                print(f'[dress_scene] WARN room candidate missing; keep fallback: {path} '
                      f'(metadata={spec["metadata_path"]})')
            else:
                print(f'[dress_scene] WARN room candidate missing; keep fallback: {path}')
            continue
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if _furniture_type_from_object(a) == spec['anchor_type']
                   and spec['room_token'] in a.name.lower()]
        if not anchors:
            print(f'[dress_scene] WARN room candidate skipped: no {spec["room_token"]} '
                  f'{spec["anchor_type"]} anchor')
            continue
        anchor = anchors[0]
        family = [o for o in bpy.data.objects if o is anchor or o.name.startswith(anchor.name + ':')]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN room candidate skipped: anchor has no mesh bbox: {anchor.name}')
            continue
        if spec['mode'] == 'above':
            # Existing mirror cabinet behavior: align over vanity, without hiding vanity.
            stage_one(spec['name'], anchor, bbox, path, 'surface', spec['hide_tokens'])
        elif spec['mode'] == 'east':
            stage_one(spec['name'], anchor, bbox, path, 'ground', spec['hide_tokens'])
            obj = bpy.data.objects.get(spec['name'])
            if obj:
                obj.location.x = bbox[0][1] + obj.dimensions.x / 2 + 0.08
        else:
            stage_one(spec['name'], anchor, bbox, path, spec['mode'], spec['hide_tokens'],
                      spec.get('fit_anchor_bbox', False))

    # Public-area side table: derive every placement input from the formal living sofa bbox.
    side_table_spec = public_candidates[0]
    side_table_path = side_table_spec['path']
    if not os.path.isfile(side_table_path):
        print(f'[dress_scene] WARN public candidate missing; keep fallback: {side_table_path}')
    else:
        sofa_anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                        if _furniture_type_from_object(a) == 'sofa_3seat'
                        and 'living_dining' in a.name.lower()]
        if not sofa_anchors:
            print('[dress_scene] WARN side table candidate skipped: no reliable living_dining sofa anchor; '
                  'keep fallback')
        else:
            sofa_anchor = sofa_anchors[0]
            sofa_family = [o for o in bpy.data.objects
                           if o is sofa_anchor or o.name.startswith(sofa_anchor.name + ':')]
            sofa_bbox = _world_bbox_for_objects(sofa_family)
            if sofa_bbox is None:
                print(f'[dress_scene] WARN side table candidate skipped: sofa has no mesh bbox: '
                      f'{sofa_anchor.name}')
            else:
                stage_one(side_table_spec['name'], sofa_anchor, sofa_bbox, side_table_path,
                          'living_lounge', ('side_table', 'end_table'), False)
                if bpy.data.objects.get(side_table_spec['name']) is not None:
                    for duplicate in bpy.data.objects:
                        if duplicate is bpy.data.objects.get(side_table_spec['name']):
                            continue
                        if duplicate.name.startswith(('asset:side_table', 'asset:end_table')):
                            duplicate['dress_replacement_source'] = True
                            _set_recursive_hidden(duplicate, True)

    # Wall art may only attach to a reliable solid TV-wall/west-wall bbox. Never use
    # curtain/glazing objects or infer a wall from room coordinates; no wall means skip.
    art_spec = public_candidates[1]
    art_path = art_spec['path']
    if not os.path.isfile(art_path):
        print(f'[dress_scene] WARN public candidate missing; keep fallback: {art_path}')
    else:
        # Plant-themed art requires independently confirmed public-area furniture bboxes;
        # without sofa and coffee-table evidence, do not infer a wall placement.
        sofa_anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                        if _furniture_type_from_object(a) == 'sofa_3seat'
                        and 'living_dining' in a.name.lower()]
        sofa_anchor = sofa_anchors[0] if sofa_anchors else None
        sofa_family = ([o for o in bpy.data.objects
                        if o is sofa_anchor or o.name.startswith(sofa_anchor.name + ':')]
                       if sofa_anchor else [])
        sofa_bbox = _world_bbox_for_objects(sofa_family)
        coffee_objects = [o for o in bpy.data.objects
                          if o.type == 'MESH' and not _is_render_only(o)
                          and (_furniture_type_from_object(o) == 'coffee_table'
                               or o.name.startswith('asset:coffee_table'))]
        coffee_bbox = _world_bbox_for_objects(coffee_objects)
        if sofa_bbox is None or coffee_bbox is None:
            print('[dress_scene] WARN wall art candidate skipped: reliable living_dining sofa and '
                  'coffee_table bboxes required; keep fallback')
            wall_candidates = []
        else:
            wall_candidates = []
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or _is_render_only(obj):
                continue
            name_lower = obj.name.lower()
            if obj.name in GLASS_IDS or obj.name.startswith('curtain_run:'):
                continue
            is_tv_wall = (name_lower.startswith('furniture:living_dining:tv_wall_low:')
                          or name_lower.startswith('furniture:living_dining:wall_cabinet_tall:')
                          or 'tv_wall' in name_lower)
            is_west_wall = ('west_wall' in name_lower or name_lower.startswith('wall:west')
                            or name_lower.startswith('wall_west'))
            if is_tv_wall or is_west_wall:
                wall_candidates.append(obj)
        if sofa_bbox is None or coffee_bbox is None:
            wall_candidates = []
        wall_anchor = wall_candidates[0] if wall_candidates else None
        wall_bbox = _world_bbox_for_objects([wall_anchor]) if wall_anchor is not None else None
        if wall_anchor is None or wall_bbox is None:
            print('[dress_scene] WARN wall art candidate skipped: no reliable solid TV/west wall bbox; '
                  'keep fallback')
        else:
            name = art_spec['name']
            existing = bpy.data.objects.get(name)
            if existing is not None:
                _set_recursive_hidden(existing, False)
                _mark_candidate_asset(existing, art_spec['role'], art_path,
                                      art_spec['metadata_path'])
                _report_render_only_asset(existing, art_spec['role'], art_path, wall_bbox)
                staged += 1
            else:
                before = set(bpy.data.objects)
                try:
                    imported = import_furniture_glb(
                        art_path, {'width': 0.72, 'height': 1.05},
                        loc_rz=((0.0, 0.0, 0.0), wall_anchor.matrix_world.to_euler().z))
                except Exception as exc:
                    remove_new(before)
                    print(f'[dress_scene] WARN wall art candidate import failed; keep fallback: '
                          f'{art_path}: {type(exc).__name__}: {exc}')
                    imported = 0
                meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
                if imported and meshes:
                    art = meshes[-1]
                    art.name = name
                    art.rotation_mode = 'QUATERNION'
                    art.rotation_quaternion = wall_anchor.matrix_world.to_quaternion()
                    bpy.context.view_layer.update()
                    art_bbox = _world_bbox_for_objects([art])
                    wall_span = (wall_bbox[0][1] - wall_bbox[0][0],
                                 wall_bbox[1][1] - wall_bbox[1][0])
                    wall_normal_axis = 0 if wall_span[0] <= wall_span[1] else 1
                    wall_tangent_axis = 1 - wall_normal_axis
                    if art_bbox is None or wall_span[wall_normal_axis] > 0.35:
                        remove_new(before)
                        print('[dress_scene] WARN wall art candidate skipped: wall bbox is not a '
                              'reliable thin solid face; keep fallback')
                    else:
                        # Derive the face and tangent from the solid wall bbox, while the
                        # sofa/coffee-table midpoint supplies the public-area target.
                        art_normal = art_bbox[wall_normal_axis][1] - art_bbox[wall_normal_axis][0]
                        art_tangent = art_bbox[wall_tangent_axis][1] - art_bbox[wall_tangent_axis][0]
                        sofa_center = tuple((lo + hi) / 2 for lo, hi in sofa_bbox)
                        coffee_center = tuple((lo + hi) / 2 for lo, hi in coffee_bbox)
                        target_tangent = (sofa_center[wall_tangent_axis] + coffee_center[wall_tangent_axis]) / 2
                        tangent_lo, tangent_hi = wall_bbox[wall_tangent_axis]
                        art.location[wall_tangent_axis] = max(
                            tangent_lo + art_tangent / 2,
                            min(tangent_hi - art_tangent / 2, target_tangent))
                        wall_mid = sum(wall_bbox[wall_normal_axis]) / 2
                        toward_room = 1 if sofa_center[wall_normal_axis] > wall_mid else -1
                        face = wall_bbox[wall_normal_axis][1] if toward_room > 0 else wall_bbox[wall_normal_axis][0]
                        art.location[wall_normal_axis] = face + toward_room * (art_normal / 2 + 0.025)
                        art.location.z = wall_bbox[2][1] + (art_bbox[2][1] - art_bbox[2][0]) / 2 + 0.35
                        bpy.context.view_layer.update()
                        placed_bbox = _world_bbox_for_objects([art])
                        protected = [sofa_bbox, coffee_bbox]
                        protected += [_world_bbox_for_objects([o]) for o in bpy.data.objects
                                      if o.name.startswith('asset:rug:living') and o is not art]
                        overlaps = [other for other in protected if other is not None and placed_bbox is not None
                                     and all(min(placed_bbox[i][1], other[i][1])
                                             - max(placed_bbox[i][0], other[i][0]) > 0.02
                                             for i in (0, 1))]
                        if placed_bbox is None or overlaps:
                            remove_new(before)
                            print('[dress_scene] WARN wall art candidate skipped: placement overlaps '
                                  'living furniture/rug; keep fallback')
                        else:
                            _mark_candidate_asset(art, art_spec['role'], art_path,
                                                  art_spec['metadata_path'])
                            _report_render_only_asset(art, art_spec['role'], art_path, wall_bbox)
                            staged += 1
                            print(f'[dress_scene] wall art candidate staged: {art.name} '
                                  f'wall_anchor={wall_anchor.name} wall_bbox={wall_bbox} '
                                  f'sofa_bbox={sofa_bbox} coffee_bbox={coffee_bbox}')
                elif imported:
                    remove_new(before)
                    print(f'[dress_scene] WARN wall art candidate produced no mesh; keep fallback: '
                          f'{art_path}')

    # Stage the bookshelf only from a reliable shelf/open-rack anchor. The anchor
    # world bbox supplies both placement and width; no wall or room-coordinate guess.
    for room_token, name, role, anchor_types in bookshelf_specs:
        if not os.path.isfile(bookshelf_path):
            print(f'[dress_scene] WARN bookshelf candidate missing; keep fallback: {bookshelf_path} '
                  f'(metadata={bookshelf_metadata_path})')
            break
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if room_token in a.name.lower()
                   and (_furniture_type_from_object(a) or '').lower() in anchor_types]
        if not anchors:
            print(f'[dress_scene] WARN bookshelf candidate skipped: no reliable {room_token} '
                  f'shelf/open-rack anchor; keep fallback')
            continue
        anchor = anchors[0]
        family = [o for o in bpy.data.objects if o is anchor or o.name.startswith(anchor.name + ':')]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN bookshelf candidate skipped: anchor has no mesh bbox: {anchor.name}')
            continue
        stage_one(name, anchor, bbox, bookshelf_path, 'ground', anchor_types, True)
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        # A bookshelf must not occupy protected glazing or a door opening. Since
        # staging is render-only, reject and remove the candidate rather than move it.
        protected = []
        for protected_obj in bpy.data.objects:
            if protected_obj.type != 'MESH':
                continue
            protected_name = protected_obj.name
            if protected_name in GLASS_IDS or protected_name.startswith('curtain_run:') \
                    or protected_name.startswith('d_') or protected_name.startswith('door'):
                protected_bbox = _world_bbox_for_objects([protected_obj])
                candidate_bbox = _world_bbox_for_objects([obj])
                if protected_bbox is not None and candidate_bbox is not None and all(
                        min(candidate_bbox[i][1], protected_bbox[i][1])
                        - max(candidate_bbox[i][0], protected_bbox[i][0]) > 0.02
                        for i in range(3)):
                    protected.append(protected_name)
        if protected:
            bpy.data.objects.remove(obj, do_unlink=True)
            for child in bpy.data.objects:
                if child.name.startswith(anchor.name + ':') and child.get('dress_replacement_source'):
                    child['dress_replacement_source'] = False
                    _set_recursive_hidden(child, False)
            staged = max(0, staged - 1)
            print(f'[dress_scene] WARN bookshelf candidate protected-geometry conflict; '
                  f'keep fallback: room={room_token} anchor={anchor.name} conflicts={protected}')
            continue
        print(f'[dress_scene] bookshelf candidate staged: {obj.name} anchor={anchor.name} '
              f'anchor_bbox={bbox}')

    for room, kind, folder, filename, mode, hide_tokens, *anchor_hint in bathroom_assets:
        path = os.path.join(root, 'bathrooms', folder, filename)
        if not os.path.isfile(path):
            print(f'[dress_scene] WARN bathroom candidate missing; keep fallback: {path}')
            continue
        room_key = room.lower()
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if room_key in a.name.lower() and _furniture_type_from_object(a) == kind]
        anchor = anchors[0] if anchors else None
        if anchor is None and anchor_hint and anchor_hint[0] == 'faucet_gbath_vanity':
            anchor = bpy.data.objects.get('plumbing:faucet_gbath_vanity')
        if anchor is None and anchor_hint and anchor_hint[0].startswith('shower_'):
            anchor = bpy.data.objects.get(f'plumbing:{anchor_hint[0]}')
        if anchor is None and kind == 'towel_set':
            towels = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                      if room_key in a.name.lower() and _furniture_type_from_object(a) == 'towel_set']
            anchor = towels[0] if towels else None
        if anchor is None:
            print(f'[dress_scene] WARN bathroom candidate skipped: no reliable {room} {kind} anchor; keep fallback')
            continue
        family = [anchor] + list(anchor.children_recursive) if _furniture_type_from_object(anchor) else [anchor]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN bathroom candidate skipped: no bbox for {anchor.name}; keep fallback')
            continue
        name = f'asset:{room}:{kind}'
        stage_one(name, anchor, bbox, path, mode, hide_tokens)

    if staged:
        print(f'[dress_scene] room candidates staged: {staged}')
    return staged


def replace_furniture(furniture_mats: dict, config_dir: str = '', only_types: set | None = None) -> int:
    """用真实资产替换指定的可移动家具，保留其余正式 GLB 几何。

    parts 格式: (name, three_size[x,y,z], three_pos[x,y,z], material_key)。
    坐标转换：three(x,y,z) → Blender(x,-z,y)，尺寸(x,z,y)。
    only_types：由调用方控制的工况白名单；未列入 FURNITURE_GLB 的正式家具不进入替换链。
    厨房/阳台家电资产替换已启用；资产缺失或导入失败时保留源节点。"""
    count = 0
    # 客餐厅家具、bed_180、客卫浴室柜及已审计可用的厨房/阳台家电；
    # bed_150 因 BlenderKit 候选导入后尺度异常，回退程序化床；
    # water_heater、range_hood、toilet 不启用；gas_stove 仅由 room-candidate staging 处理。
    supported_types = {
        'sofa_3seat', 'dining_table', 'dining_chair', 'plant_fiddle', 'bed_180', 'vanity',
        'washer', 'dryer', 'dishwasher', 'fridge',
    }
    # GLB 会为同一 furniture:<room>:<type>:<index> 导出 root 及多个 geometry
    # 子节点；只遍历稳定实例 anchor，避免每个 geometry 子节点重复导入资产。
    for obj in _furniture_instance_anchors(list(bpy.data.objects)).values():
        parts = obj.name.split(':')
        if len(parts) < 3:
            continue
        ftype = parts[2]
        if only_types is not None and ftype not in only_types:
            continue  # 调用方已隐藏（bare_shell），不再重建可移动件
        # 仅替换已审核且有真实资产的客餐厅家具；其余正式几何继续由主 GLB 提供。
        if ftype not in supported_types or ftype not in FURNITURE_GLB:
            continue
        glb_cfg = FURNITURE_GLB[ftype]
        if not config_dir:
            print(f'[dress_scene] WARN furniture asset config dir missing; keep source: {ftype}')
            continue
        glb_path = os.path.join(config_dir, glb_cfg['path'])
        if not os.path.exists(glb_path):
            print(f'[dress_scene] WARN furniture asset missing; keep source: {glb_path}')
            continue
        if glb_cfg.get('fabric_tex'):
            glb_cfg = {**glb_cfg, 'fabric_tex': os.path.join(config_dir, glb_cfg['fabric_tex'])}
        # 单实例家具若已存在 canonical 替代件，直接复用，避免重复 append。
        # 多实例家具（如餐椅）仍按正式实例逐个导入，不能误复用同一对象。
        instance_key = _furniture_instance_key(obj) or obj.name
        # 绿植可能同时出现在客厅和主卧；它们必须是两个独立对象，不能共享
        # 一个 canonical mesh。只有明确单实例的家具才允许按类型复用。
        canonical_name = f'asset:{ftype}:glb'
        reusable_types = {'sofa_3seat', 'dining_table', 'bed_180', 'vanity',
                          'washer', 'dryer', 'dishwasher', 'fridge'}
        if ftype in reusable_types:
            existing_asset = bpy.data.objects.get(canonical_name)
            if existing_asset is not None:
                obj['dress_replacement_source'] = True
                _set_recursive_hidden(obj, True)
                existing_asset.hide_render = False
                existing_asset.hide_viewport = False
                print(f'[dress_scene] furniture replacement reused: {canonical_name}')
                count += 1
                continue
        # 先确认真实资产导入成功，再隐藏正式源节点，避免资产缺失时丢家具。
        before_assets = set(bpy.data.objects)
        if not import_furniture_glb(glb_path, glb_cfg, block=obj, rot_fix=0):
            print(f'[dress_scene] WARN furniture asset import failed; keep source: {glb_path}')
            continue
        if ftype == 'plant_fiddle':
            imported_assets = [o for o in bpy.data.objects
                               if o not in before_assets and o.type == 'MESH']
            if imported_assets:
                # import_furniture_glb 已按 block 类型命名；改为稳定的实例名，
                # 使两个房间的真实绿植都可见且可审计。
                imported_assets[-1].name = f'asset:plant_fiddle:{instance_key}:glb'
        obj['dress_replacement_source'] = True
        obj.hide_render = True
        for child in obj.children_recursive:
            child.hide_render = True
        count += 1
    if count:
        print(f'[dress_scene] furniture replaced: {count} parts')
    return count


def place_extra_furniture(furniture_mats: dict, config_dir: str, plumbing: dict,
                          only_types: set | None = None) -> int:
    """LEGACY Blender 家具补摆几何旁路；not called by initialize_scene。

    正式家具几何由 shared/CLI GLB（GLB geometry source）提供；本函数仅保留作历史
    迁移参考。house.yaml 已摆位但 glb 尚未重新导出的家具类型：直接按坐标生成部件。
    glb 里已有 furniture:* 块的类型跳过（重新导出后自动失效，不会重复）。
    坐标：house.yaml 为 three 局部米制 (x, z, rotation°)；three(x,y,z) → Blender(x,-z,y)，rotation 同号映到 Blender Z。
    only_types：bare_shell 等工况的类型白名单（只生成定制柜等硬装件）。"""
    import math
    import yaml
    if not config_dir:
        return 0
    existing = set()
    for obj in bpy.data.objects:
        if obj.name.startswith('furniture:'):
            ps = obj.name.split(':')
            if len(ps) >= 3:
                existing.add(ps[2])
    house_path = os.path.join(config_dir, 'config', 'house.yaml')
    if not os.path.exists(house_path):
        return 0
    house = yaml.safe_load(open(house_path, encoding='utf-8'))
    count = 0
    for _room_id, items in (house.get('furnishings') or {}).items():
        for it in items or []:
            ftype = it.get('type')
            if ftype not in FURNITURE_PARTS or ftype in existing:
                continue
            if only_types is not None and ftype not in only_types:
                continue
            point_anchor = {
                'sink': 'faucet_kitchen_sink',
                'dishwasher': 'drain_kitchen_dishwasher',
            }.get(ftype)
            if point_anchor:
                anchor = plumbing.get(point_anchor)
                if not anchor:
                    print(f'[dress_scene] WARN: missing plumbing anchor {point_anchor}; skip {ftype}')
                    continue
                x, z = anchor['x'], anchor['z']
            else:
                if it.get('x') is None or it.get('z') is None:
                    continue
                x, z = it['x'], it['z']
            rz = math.radians(it.get('rotation', 0))
            cos_rz, sin_rz = math.cos(rz), math.sin(rz)
            bx, by = x, -z  # three → blender 水平面
            # 优先用真 3D 模型（.glb/.gltf）：与 replace_furniture 同一映射表
            glb_cfg = FURNITURE_GLB.get(ftype)
            if glb_cfg:
                glb_path = os.path.join(config_dir, glb_cfg['path'])
                if os.path.exists(glb_path):
                    if import_furniture_glb(glb_path, glb_cfg, loc_rz=((bx, by, 0.0), rz)):
                        count += 1
                        continue
            for part in FURNITURE_PARTS[ftype]:
                pname, tsize, tpos, mat_key = part[:4]
                shape = part[4] if len(part) > 4 else 'box'
                lx, ly, lz = tpos[0], -tpos[2], tpos[1]
                wx = bx + lx * cos_rz - ly * sin_rz
                wy = by + lx * sin_rz + ly * cos_rz
                wz = lz
                dx, dy, dz = tsize[0], tsize[2], tsize[1]
                if shape == 'cylinder':
                    bpy.ops.mesh.primitive_cylinder_add(radius=tsize[0] / 2, depth=tsize[1])
                else:
                    bpy.ops.mesh.primitive_cube_add(size=1.0)
                part = bpy.context.object
                part.name = f'asset:{ftype}:{pname}'
                part.dimensions = (dx, dy, dz)
                part.location = (wx, wy, wz)
                part.rotation_euler = (0, 0, rz)
                mat = furniture_mats.get(mat_key)
                if mat:
                    part.data.materials.append(mat)
                bevel = part.modifiers.new('Bevel', 'BEVEL')
                bevel.width = 0.015
                bevel.segments = 4
                bevel.limit_method = 'ANGLE'
                bevel.angle_limit = 0.523599
                count += 1
            # 定制柜柜门分缝（与 replace_furniture 同一布局表）
            count += _add_cabinet_seams(ftype, (bx, by, 0.0), rz, furniture_mats.get('door_gap'))
    if count:
        print(f'[dress_scene] extra furniture placed: {count} parts')
    return count


def add_ceiling(ceiling: list, ceiling_mats: dict) -> int:
    """LEGACY Blender 吊顶几何旁路；not called by initialize_scene。

    正式基础吊顶几何由 shared/CLI GLB（GLB geometry source）提供；本函数仅保留作
    历史迁移参考，从 render facts 生成 drop/aluminum_buckle 吊顶；ac_indoor 不在
    Blender 建实体。"""
    if not isinstance(ceiling, list):
        print('[dress_scene] WARN: facts.ceiling must be a list; skip ceiling construction')
        return 0
    count = 0
    for it in ceiling:
        if not isinstance(it, dict):
            print('[dress_scene] WARN: invalid ceiling fact; skip')
            continue
        typ, zone_id = it.get('type'), it.get('id', '<unknown>')
        if typ == 'ac_indoor':
            continue
        if typ not in ('drop', 'aluminum_buckle'):
            print(f'[dress_scene] WARN: ceiling {zone_id} has unsupported type {typ!r}; skip')
            continue
        area, thick = it.get('area'), it.get('thickness')
        if (not isinstance(area, list) or len(area) != 4
                or not all(isinstance(v, (int, float)) for v in area)
                or not isinstance(thick, (int, float)) or thick <= 0):
            print(f'[dress_scene] WARN: ceiling {zone_id} missing valid area/thickness; skip')
            continue
        x1, z1, x2, z2 = area
        w, d = x2 - x1, z2 - z1
        if w <= 0 or d <= 0:
            print(f'[dress_scene] WARN: ceiling {zone_id} has non-positive area; skip')
            continue
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        box = bpy.context.object
        box.name = f'ceiling:{zone_id}'
        box.dimensions = (w, d, thick)
        box.location = to_blender((x1 + x2) / 2, 2.8 - thick / 2, (z1 + z2) / 2)
        mat = ceiling_mats.get('aluminum_buckle' if typ == 'aluminum_buckle' else 'ceiling')
        if mat:
            box.data.materials.append(mat)
        count += 1
    if count:
        print(f'[dress_scene] ceiling facts: {count}')
    return count


def add_kitchen_cabinets(cream, quartz, plumbing: dict, gap=None) -> int:
    """LEGACY Blender 厨房几何旁路；not called by initialize_scene。

    厨房正式柜体、连续台面 bridge、开孔与家电位置由 shared/CLI GLB（GLB geometry
    source）提供；本函数仅保留作旧 Blender L 型橱柜的迁移参考。
    """

    def kbox(name, cx, cz, sx, sz, sy, yc, mat):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        b = bpy.context.object
        b.name = name
        b.dimensions = (sx, sz, sy)
        b.location = to_blender(cx, yc, cz)
        if mat:
            b.data.materials.append(mat)
        bev = b.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.01
        bev.segments = 3
        return 1

    def kgap(name, cx, cz, y_lo, y_hi, facing):
        # 柜门分缝条（不加 bevel：4mm 截面比 bevel 宽还小）。facing 'z'=贴在朝 ±z 的正面，
        # 截面 x=4mm/z=3mm；facing 'x'=贴在朝 ±x 的正面，截面 x=3mm/z=4mm
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        b = bpy.context.object
        b.name = name
        sx, sz = (0.004, 0.003) if facing == 'z' else (0.003, 0.004)
        b.dimensions = (sx, sz, y_hi - y_lo)
        b.location = to_blender(cx, (y_lo + y_hi) / 2, cz)
        if gap:
            b.data.materials.append(gap)
        return 1

    n = 0
    sink = plumbing.get('faucet_kitchen_sink')
    dishwasher = plumbing.get('drain_kitchen_dishwasher')
    sink_cutout = []
    if sink:
        sink_cutout = [(sink['x'], sink['z'], 0.70, 0.40)]
    else:
        print('[dress_scene] WARN: missing plumbing anchor faucet_kitchen_sink; skip kitchen sink cutout')
    if not dishwasher:
        print('[dress_scene] WARN: missing plumbing anchor drain_kitchen_dishwasher; dishwasher reserve remains cabinet-defined only')
    # 北墙地柜拆两段留洗碗机位 x∈[8.50,9.10]（柜体为既有非 point 几何；设备位置锚点仅用于明确预留标记）
    n += kbox('kitchen:base_n1', 7.86, 0.3, 1.28, 0.6, 0.85, 0.425, cream)
    n += kbox('kitchen:base_n2', 9.94, 0.3, 1.68, 0.6, 0.85, 0.425, cream)
    n += kbox('kitchen:base_e', 10.5, 1.15, 0.6, 1.1, 0.85, 0.425, cream)
    # 台面：北墙 3.6m 整片（洗碗机位 x∈[8.5,9.1] 上方台面连续，与真实安装一致；
    # 水槽开孔 0.70×0.40 @9.5,0.30 台下盆）+ 东墙 1.1m（灶具开孔 0.75×0.45 @10.5,1.18 嵌平）
    # 北墙是玻璃幕墙（curtain_run），挂不了吊柜——house.yaml「北墙玻璃幕只做落地柜+台面」，
    # 原 kitchen:wall_n 吊柜违反此约束（电气/家具铁律：玻璃幕不挂柜），已删
    def ktop(name, cx, cz, sx, sz, cutouts):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        t = bpy.context.object
        t.name = name
        t.dimensions = (sx, sz, 0.03)
        t.location = to_blender(cx, 0.865, cz)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        t.data.materials.append(quartz)
        for i, (ox, oz, ow, od) in enumerate(cutouts):
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            c = bpy.context.object
            c.name = f'{name}:cut{i}'
            c.dimensions = (ow, od, 0.1)
            c.location = to_blender(ox, 0.865, oz)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            mod = t.modifiers.new(f'cut{i}', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.object = c
            bpy.context.view_layer.objects.active = t
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.data.objects.remove(c)
        return 1

    n += ktop('kitchen:top_n', 9.0, 0.3, 3.6, 0.62, sink_cutout)
    n += ktop('kitchen:top_e', 10.5, 1.15, 0.62, 1.1, [(10.5, 1.18, 0.75, 0.45)])
    if dishwasher:
        n += kbox('kitchen:dishwasher_reserve', dishwasher['x'], dishwasher['z'], 0.02, 0.02, 0.02, 0.01, None)
    # 柜门分缝：北墙 run A 1.28m→3门（gap 7.65/8.08）/ run B 1.68m→3门（gap 9.66/10.22）/ 东墙 1.1m→2门
    if gap is not None:
        for gx in (7.65, 8.08, 9.66, 10.22):
            n += kgap(f'kitchen:gap_n{gx}', gx, 0.6, 0.0, 0.85, 'z')
        n += kgap('kitchen:gap_e1', 10.2, 1.15, 0.0, 0.85, 'x')
    print(f'[dress_scene] kitchen cabinets: {n}')
    return n


def _add_cylinder(name: str, radius: float, depth: float, location: tuple,
                  mat, vertices: int = 12) -> int:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=location)
    obj = bpy.context.object
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    return 1


def _add_shower_fixture(prefix: str, anchor: dict, mat) -> int:
    """由 plumbing anchor 生成低面数淋浴柱；不依赖房屋绝对坐标。"""
    x, z = float(anchor['x']), float(anchor['z'])
    top = float(anchor.get('height', 1.0))
    if not (0.3 <= top <= 2.5):
        print(f'[dress_scene] WARN: invalid shower anchor height {prefix}: {top}; skip')
        return 0
    count = 0
    count += _add_cylinder(f'{prefix}:column', 0.018, top - 0.08,
                           to_blender(x, (top - 0.08) / 2, z), mat)
    count += _add_cylinder(f'{prefix}:head', 0.09, 0.025,
                           to_blender(x, top + 0.04, z), mat)
    return count


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
    """LEGACY Blender 卫浴几何旁路；not called by initialize_scene。

    正式卫浴几何由 shared plumbing/overlay/furnishing GLB（GLB geometry source）提供；
    本函数仅保留作旧洁具与细节实现的迁移参考，初始化流程不得调用本函数。
    """
    ceramic = furniture_mats.get('ceramic')
    cream = furniture_mats.get('paint_cream')
    metal = furniture_mats.get('metal')
    towel_mat = furniture_mats.get('fabric_light')
    layout = master_bath_final_layout()

    def box(name, cx, cz, sx, sz, sy, yc, mat):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        b = bpy.context.object
        b.name = name
        b.dimensions = (sx, sz, sy)
        b.location = to_blender(cx, yc, cz)
        if mat:
            b.data.materials.append(mat)
        return 1

    n = 0

    def point(point_id):
        p = plumbing.get(point_id)
        if not p:
            print(f'[dress_scene] WARN: missing plumbing anchor {point_id}; skip associated bath fixture')
        return p

    # 淋浴柱与客卫屏风正式几何由 shared plumbing/overlay GLB 提供；
    # Blender dress 阶段不再从 shower anchors 重建淋浴柱或客卫屏风。
    mb_vanity, mb_toilet = point('faucet_mbath_vanity'), point('toilet_mbath')
    if mb_vanity:
        # DEC-043：anchor 是盆心 (0.26, 2.96)，一体台中心由声明式偏移得到 (0.55, 3.16)。
        x = float(mb_vanity['x']) + layout['vanity_center_from_anchor'][0]
        z = float(mb_vanity['z']) + layout['vanity_center_from_anchor'][1]
        vanity_w, vanity_d = layout['vanity_size']
        n += box('bath:mb_vanity', x, z, vanity_w, vanity_d, 0.80, 0.40, cream)
        n += box('bath:mb_basin', float(mb_vanity['x']), float(mb_vanity['z']), 0.45, 0.36, 0.12, 0.85, ceramic)
        n += box('bath:mb_mirror_cab', float(mb_vanity['x']), float(mb_vanity['z']), 0.45, 0.08, 0.70, 1.55, cream)
        n += box('bath:mb_mirror', float(mb_vanity['x']), float(mb_vanity['z']) - 0.05, 0.40, 0.02, 0.65, 1.55, metal)
        # 东半段为梳妆位；仅保留小型桌面件，不挤占整段台面。
        n += box('bath:mb_soap', x - 0.12, z - 0.08, 0.06, 0.06, 0.15, 0.925, ceramic)
        # 主卫半墙与长虹玻璃屏风由 shared overlay/GLB 提供，不在 Blender dress 阶段重建。
    if mb_toilet:
        x, z = mb_toilet['x'] - 0.30, mb_toilet['z']
        n += box('bath:mb_toilet', x, z, 0.55, 0.4, 0.4, 0.2, ceramic)
        n += box('bath:mb_tank', x + 0.20, z, 0.18, 0.42, 0.5, 0.55, ceramic)
    if mb_vanity and mb_toilet:
        x, z = mb_vanity['x'] - 0.02, (mb_vanity['z'] + mb_toilet['z']) / 2
        n += box('bath:mb_towel_bar', x, z, 0.03, 0.45, 0.03, 1.25, metal)
        n += box('bath:mb_towel', x - 0.03, z, 0.06, 0.28, 0.45, 1.05, towel_mat)

    gb_vanity, gb_toilet = point('faucet_gbath_vanity'), point('toilet_gbath')
    if gb_vanity:
        x, z = gb_vanity['x'] + 0.25, gb_vanity['z']
        n += box('bath:gb_vanity', x, z, 0.5, 0.8, 0.8, 0.4, cream)
        n += box('bath:gb_basin', x, z, 0.4, 0.5, 0.12, 0.85, ceramic)
        n += box('bath:gb_mirror_cab', x - 0.18, z, 0.14, 0.6, 0.7, 1.55, cream)
        n += box('bath:gb_mirror', x - 0.105, z, 0.02, 0.55, 0.65, 1.55, metal)
        n += box('bath:gb_soap', x - 0.10, z + 0.25, 0.06, 0.06, 0.15, 0.925, ceramic)
    if gb_toilet:
        x, z = gb_toilet['x'] + 0.35, gb_toilet['z']
        n += box('bath:gb_toilet', x, z, 0.55, 0.4, 0.4, 0.2, ceramic)
        n += box('bath:gb_tank', x - 0.25, z, 0.18, 0.42, 0.5, 0.55, ceramic)
    if gb_vanity:
        x, z = gb_vanity['x'] + 1.48, gb_vanity['z'] - 0.50
        n += box('bath:gb_towel_bar', x, z, 0.03, 0.45, 0.03, 1.25, metal)
        n += box('bath:gb_towel', x - 0.03, z, 0.06, 0.28, 0.45, 1.05, towel_mat)
    print(f'[dress_scene] bath fixtures: {n}')
    return n


def add_soft_decor(furniture_mats: dict, config_dir: str = '') -> int:
    """生成客餐厅 render-only staging：BlenderKit 茶几、地毯与既有挂画。

    正式装饰若要进入设计交付，必须迁移到 house/shared/GLB；本函数不产生正式设计几何。
    所有替代件沿用 house.yaml 的既有占位坐标，不改变 Web 几何、家具坐标或相机。
    """
    import mathutils
    count = 0

    def bevel(obj, width=0.01, segments=3):
        modifier = obj.modifiers.new('Bevel', 'BEVEL')
        modifier.width = width
        modifier.segments = segments
        modifier.limit_method = 'ANGLE'
        return modifier

    def staging_material(name, color, rough=0.75):
        mat = bpy.data.materials.get(name)
        return mat or new_principled(name, hex_rgb(color), rough=rough)

    def hide_existing(name_prefix):
        hidden = 0
        for obj in bpy.data.objects:
            if obj.name == name_prefix or obj.name.startswith(name_prefix + ':'):
                _set_recursive_hidden(obj, True)
                hidden += 1
        return hidden

    # 茶几：隐藏 shared/FURNITURE_PARTS 的原始实例，避免原两块 cylinder 与替代件重叠。
    for source in _furniture_instance_anchors(list(bpy.data.objects)).values():
        if _furniture_type_from_object(source) == 'coffee_table':
            source['dress_replacement_source'] = True
            _set_recursive_hidden(source, True)

    # 先隐藏历史 render-only 替代件；canonical BlenderKit 对象不参与清理，保证可重复调用。
    canonical_names = {'asset:coffee_table:blenderkit', 'asset:rug:living:blenderkit'}
    for prefix in ('asset:coffee_table', 'asset:rug:living'):
        for obj in bpy.data.objects:
            if obj.name not in canonical_names and (obj.name == prefix or obj.name.startswith(prefix + ':')):
                _set_recursive_hidden(obj, True)
    canonical_assets_present = all(bpy.data.objects.get(name) is not None for name in canonical_names)
    if canonical_assets_present:
        print('[dress_scene] soft decor canonical assets present; revalidate rug transform')

    def mark_real_asset(obj, role, source_path):
        _mark_render_only(obj, role)
        obj['geometrySource'] = 'blender_staging'
        obj['assetKind'] = 'REAL asset'
        obj['assetProvider'] = 'BlenderKit'
        obj['assetSource'] = source_path
        obj['formalWebGeometry'] = False

    def asset_report(obj, source_dims=None, source_rotation=None):
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        dims = tuple(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3))
        materials = [mat for mat in obj.data.materials if mat is not None]
        images = set()
        for mat in materials:
            image_texture_count = 0
            base_color_connected = False
            roughness = None
            if mat.use_nodes:
                for node in mat.node_tree.nodes:
                    if node.type == 'TEX_IMAGE':
                        image_texture_count += 1
                        if node.image is not None:
                            images.add(node.image)
                    if node.type == 'BSDF_PRINCIPLED':
                        base_color = node.inputs.get('Base Color')
                        base_color_connected = bool(base_color and base_color.is_linked)
                        roughness_input = node.inputs.get('Roughness')
                        roughness = roughness_input.default_value if roughness_input else None
            roughness_text = f'{roughness:.3f}' if roughness is not None else 'n/a'
            print(f'[dress_scene] asset material: {mat.name} '
                  f'image_textures={image_texture_count} '
                  f'base_color_connected={base_color_connected} '
                  f'roughness={roughness_text}')
        packed = sum(1 for image in images if image.packed_file is not None)
        rotation = tuple(round(v, 5) for v in obj.rotation_euler)
        source_text = ''
        if source_dims is not None:
            source_text = f' source_bbox=({source_dims[0]:.4f},{source_dims[1]:.4f},{source_dims[2]:.4f})'
        if source_rotation is not None:
            source_text += f' source_rotation=({source_rotation[0]:.5f},{source_rotation[1]:.5f},{source_rotation[2]:.5f})'
        print(f'[dress_scene] real asset: {obj.name}{source_text} '
              f'final_bbox=({dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}) '
              f'dimensions=({obj.dimensions.x:.4f},{obj.dimensions.y:.4f},{obj.dimensions.z:.4f}) '
              f'rotation=({rotation[0]:.5f},{rotation[1]:.5f},{rotation[2]:.5f}) '
              f'material_slots={len(obj.data.materials)} materials={len(materials)} '
              f'uv_layers={len(obj.data.uv_layers)} image_textures={len(images)} '
              f'packed_images={packed} z_thickness={dims[2]:.4f}')

    def add_bedroom_candidates():
        """按已导入的主卧 bed_180 世界包围盒摆放卧室 render-only 候选。

        mathutils 在此函数内显式导入，避免被其他局部作用域遮蔽。

        这里不读取或写回 house.yaml：床锚点和已成功导入床的 bbox 都来自当前
        Blender 场景。候选导入失败时不隐藏任何程序化床/床品回退。
        """
        import mathutils
        bed_objects = [o for o in bpy.data.objects
                       if o.type == 'MESH' and o.name.startswith('asset:bed_180:glb')]
        bed_anchors = [o for o in _furniture_instance_anchors(list(bpy.data.objects)).values()
                       if _furniture_type_from_object(o) == 'bed_180'
                       and 'master' in o.name.lower()]
        if not bed_objects or not bed_anchors:
            print('[dress_scene] bedroom candidates skipped: no successfully imported master bed_180')
            return 0
        bed = min(bed_objects, key=lambda o: min((o.location - a.location).length for a in bed_anchors))
        bed_anchor = min(bed_anchors, key=lambda a: (bed.location - a.location).length)
        source_path = os.path.join(config_dir, 'assets', 'furniture',
                                   'blenderkit_candidates', 'bedroom_missing')
        candidate_specs = (
            ('nightstand_midcentury.blend', 'nightstand_midcentury',
             {'width': 0.48}, 0.48, 'bedroom:nightstand_midcentury'),
            ('bedding_duvet_pillows.blend', 'bedding_duvet_pillows',
             {'width': 1.70}, 1.70, 'bedroom:bedding_duvet_pillows'),
        )
        bed_bb = [bed.matrix_world @ mathutils.Vector(c) for c in bed.bound_box]
        bed_dims = tuple(max(c[i] for c in bed_bb) - min(c[i] for c in bed_bb) for i in range(3))
        # helper 已将资产原点置于 bbox 中心；bed 的局部 x/y 是床宽/床深方向。
        local_bb = [mathutils.Vector(c) for c in bed.bound_box]
        local_min_x, local_max_x = min(c.x for c in local_bb), max(c.x for c in local_bb)
        local_min_y, local_max_y = min(c.y for c in local_bb), max(c.y for c in local_bb)
        head_y = local_min_y + (local_max_y - local_min_y) * 0.18
        side_gap = 0.08
        positions = (
            (local_min_x - side_gap - 0.24, head_y, 0.0),
            (local_max_x + side_gap + 0.24, head_y, 0.0),
        )
        added = 0
        for filename, slug, targets, width, role in candidate_specs:
            candidate_path = os.path.join(source_path, slug, filename)
            if not os.path.isfile(candidate_path):
                print(f'[dress_scene] WARN bedroom candidate missing; keep fallback: {candidate_path}')
                continue
            if slug == 'bedding_duvet_pillows':
                target_positions = ((0.0, (local_min_y + local_max_y) * 0.5, 0.0),)
            else:
                target_positions = positions
            existing = [o for o in bpy.data.objects
                        if o.name.startswith(f'asset:bedroom:{slug}')]
            if existing:
                for obj in existing:
                    _set_recursive_hidden(obj, False)
                    mark_real_asset(obj, role, candidate_path)
                    asset_report(obj, bed_dims)
                added += len(existing)
                continue
            imported_objects = []
            for index, local_pos in enumerate(target_positions):
                before = set(bpy.data.objects)
                world_pos = bed.matrix_world @ mathutils.Vector(local_pos)
                try:
                    imported = import_furniture_glb(
                        candidate_path, targets,
                        loc_rz=((world_pos.x, world_pos.y, world_pos.z),
                                bed.rotation_euler.z))
                except Exception as exc:
                    print(f'[dress_scene] WARN bedroom candidate import failed; keep fallback: '
                          f'{candidate_path}: {exc}')
                    continue
                new_meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
                if not imported or not new_meshes:
                    print(f'[dress_scene] WARN bedroom candidate import produced no mesh; keep fallback: '
                          f'{candidate_path}')
                    continue
                obj = new_meshes[-1]
                obj.name = f'asset:bedroom:{slug}:{index}'
                if slug == 'bedding_duvet_pillows':
                    obj.dimensions = (width, max(bed_dims[1] * 0.86, 0.1), max(bed_dims[2] * 0.18, 0.04))
                    bpy.context.view_layer.update()
                    obj.location = bed.matrix_world @ mathutils.Vector(local_pos)
                    obj.rotation_mode = 'QUATERNION'
                    obj.rotation_quaternion = bed.rotation_quaternion
                    obj.location.z = max(c.z for c in bed_bb) + 0.04
                else:
                    obj.rotation_mode = 'QUATERNION'
                    obj.rotation_quaternion = bed.rotation_quaternion
                    obj.location = world_pos
                    bpy.context.view_layer.update()
                    # 床头柜的 x/y 来自床 bbox；z 由导入对象自身 bbox 贴地，
                    # 不把床中心高度误当成柜脚高度。
                    obj_bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
                    obj.location.z -= min(c.z for c in obj_bb)
                bpy.context.view_layer.update()
                mark_real_asset(obj, role, candidate_path)
                asset_report(obj, bed_dims)
                imported_objects.append(obj)
                added += 1
            # 仅床品成功后隐藏程序化床品；床/床品失败均保留 fallback。
            if slug == 'bedding_duvet_pillows' and imported_objects:
                for child in bed_anchor.children_recursive:
                    if any(token in child.name.lower() for token in ('mattress', 'duvet', 'pillow')):
                        child.hide_render = True
                print('[dress_scene] bedroom bedding staging active; procedural bedding hidden')
        # 床头柜成功后仅隐藏对应程序化床头柜（若有），不影响床或动线。
        if any(o.name.startswith('asset:bedroom:nightstand_midcentury') for o in bpy.data.objects):
            for child in bed_anchor.children_recursive:
                if any(token in child.name.lower() for token in ('nightstand', 'bedside')):
                    child.hide_render = True
        return added

    add_bedroom_candidates()

    def prepare_rug(obj):
        """把 BlenderKit 地毯的最薄轴明确放到 Blender 竖直 Z，避免压成硬方盒。"""
        from mathutils import Quaternion
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        source_dims = tuple(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3))
        source_rotation = tuple(obj.rotation_euler)
        thin_axis = min(range(3), key=lambda i: source_dims[i])
        if thin_axis == 0:
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = Quaternion((0, 1, 0), math.pi / 2) @ obj.rotation_quaternion
            print('[dress_scene] rug axis diagnosis: source thin axis X; rotated to Blender vertical Z')
        elif thin_axis == 1:
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = Quaternion((1, 0, 0), math.pi / 2) @ obj.rotation_quaternion
            print('[dress_scene] rug axis diagnosis: source thin axis Y; rotated to Blender vertical Z')
        else:
            print('[dress_scene] rug axis diagnosis: source thin axis Z; no axis correction needed')
        bpy.context.view_layer.update()
        obj.dimensions = (2.20, 1.60, 0.015)
        bpy.context.view_layer.update()
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'BSDF_PRINCIPLED':
                    continue
                if 'Metallic' in node.inputs:
                    node.inputs['Metallic'].default_value = 0.0
                if 'Roughness' in node.inputs:
                    node.inputs['Roughness'].default_value = 0.86
                if 'Specular IOR Level' in node.inputs:
                    node.inputs['Specular IOR Level'].default_value = 0.25
                elif 'Specular' in node.inputs:
                    node.inputs['Specular'].default_value = 0.25
                if 'Coat Weight' in node.inputs:
                    node.inputs['Coat Weight'].default_value = 0.0
                elif 'Coat' in node.inputs:
                    node.inputs['Coat'].default_value = 0.0
        _set_recursive_hidden(obj, False)
        obj['rug_axis_corrected'] = True
        return source_dims, source_rotation

    import mathutils
    table_x, table_z = 10.2, 7.0
    asset_specs = (
        ('coffee_table.blend', 'asset:coffee_table:blenderkit',
         {'width': 0.85, 'height': 0.40}, (0.85, 0.48, 0.40), 0.40, 'soft_decor:coffee_table'),
        ('area_rug.blend', 'asset:rug:living:blenderkit',
         {'width': 2.20, 'height': 0.02}, (2.20, 1.60, 0.015), 0.014, 'soft_decor:rug'),
    )
    for filename, object_name, targets, final_dims, center_y, role in asset_specs:
        if canonical_assets_present and object_name not in canonical_names:
            continue
        source_path = os.path.join(config_dir, 'assets', 'furniture',
                                   'blenderkit_coffee_table' if 'coffee' in filename else 'blenderkit_area_rug',
                                   filename)
        existing_obj = bpy.data.objects.get(object_name)
        if existing_obj is not None:
            if object_name == 'asset:rug:living:blenderkit':
                source_dims, source_rotation = prepare_rug(existing_obj)
                existing_obj.location = to_blender(table_x, center_y, table_z)
                mark_real_asset(existing_obj, role, source_path)
                asset_report(existing_obj, source_dims, source_rotation)
            continue
        before = set(bpy.data.objects)
        imported = import_furniture_glb(source_path, targets,
                                        loc_rz=((table_x, -table_z, center_y), 0))
        new_meshes = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
        if not imported or not new_meshes:
            print(f'[dress_scene] WARN real asset import failed: {source_path}')
            continue
        obj = new_meshes[-1]
        obj.name = object_name
        source_dims = None
        source_rotation = None
        # 地毯必须先纠正 BlenderKit 源模型的薄轴，再设最终世界尺寸；否则
        # object.dimensions 会把错误轴压成 20mm 的深色硬板。
        if object_name == 'asset:rug:living:blenderkit':
            source_dims, source_rotation = prepare_rug(obj)
        else:
            # helper 贴地/等比缩放后，只对茶几做温和最终尺寸校正；中心保持原占位。
            obj.dimensions = final_dims
        obj.location = to_blender(table_x, center_y, table_z)
        bpy.context.view_layer.update()
        mark_real_asset(obj, role, source_path)
        asset_report(obj, source_dims, source_rotation)
        count += 1

    # 西墙挂画 x2：轻量木框 + 内嵌画面平面；画面用暖米/陶土程序材质，避免深色 cube 观感。
    def abstract_art_material(index):
        name = f'软装_挂画_暖米陶土_程序_{index}'
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        output.location = (520, 0)
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.location = (260, 0)
        bsdf.inputs['Roughness'].default_value = 0.68
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
        texcoord = nodes.new('ShaderNodeTexCoord')
        texcoord.location = (-720, 0)
        mapping = nodes.new('ShaderNodeMapping')
        mapping.location = (-540, 0)
        mapping.inputs['Scale'].default_value = (2.2, 3.8, 1.0)
        noise = nodes.new('ShaderNodeTexNoise')
        noise.location = (-320, 40)
        noise.inputs['Scale'].default_value = 2.8
        noise.inputs['Detail'].default_value = 5.0
        noise.inputs['Roughness'].default_value = 0.72
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.location = (-60, 80)
        ramp.color_ramp.interpolation = 'EASE'
        colors = (
            ('#e5d1b2', '#b96f52') if index == 0 else ('#d8c19d', '#985841')
        )
        ramp.color_ramp.elements[0].position = 0.28
        ramp.color_ramp.elements[0].color = (*hex_rgb(colors[0]), 1.0)
        ramp.color_ramp.elements[1].position = 0.70
        ramp.color_ramp.elements[1].color = (*hex_rgb(colors[1]), 1.0)
        bump = nodes.new('ShaderNodeBump')
        bump.location = (40, -150)
        bump.inputs['Strength'].default_value = 0.12
        bump.inputs['Distance'].default_value = 0.012
        links.new(texcoord.outputs['Generated'], mapping.inputs['Vector'])
        links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
        return mat

    wood = furniture_mats.get('wood_dark') or staging_material(
        '家具_wood_dark', '#3a2e26', rough=0.58
    )
    for i, z in enumerate((6.4, 7.6)):
        # 西墙沿 x 方向厚度，画面宽度沿 Blender Y（对应 three z）。
        cx, cy, cz = 7.245, -z, 1.5
        frame_specs = (
            ('top', (0.035, 0.045, 0.66), (0.0, 0.0, 0.277)),
            ('bottom', (0.035, 0.045, 0.66), (0.0, 0.0, -0.277)),
            ('left', (0.035, 0.51, 0.045), (0.0, -0.307, 0.0)),
            ('right', (0.035, 0.51, 0.045), (0.0, 0.307, 0.0)),
        )
        for side, dims, offset in frame_specs:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            edge = bpy.context.object
            edge.name = f'asset:art:{i}:frame:{side}'
            edge.dimensions = dims
            edge.location = (cx + offset[0], cy + offset[1], cz + offset[2])
            edge.data.materials.append(wood)
            bevel(edge, 0.012, 3)
            _mark_render_only(edge, 'soft_decor:art_frame')
            count += 1
        # 画面是嵌在木框后的真实平面，不使用深色实体 cube 作为主体。
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(cx + 0.006, cy, cz), rotation=(0, math.pi / 2, 0))
        picture = bpy.context.object
        picture.name = f'asset:art:{i}:picture_plane'
        # Plane 的局部 XY 经 Y 轴旋转后对应世界 Z/Y，匹配 0.56×0.46m 画面开口。
        picture.scale = (0.56, 0.46, 1.0)
        picture.data.materials.append(abstract_art_material(i))
        _mark_render_only(picture, 'soft_decor:artwork_plane')
        count += 1

    if count:
        print(f'[dress_scene] soft decor: {count} (coffee_table+rug+art; render-only)')
    return count


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
            return eng
        except TypeError:
            continue
    raise RuntimeError('no EEVEE engine id available')


CAMERA_SCENARIO_OVERRIDE_FIELDS = frozenset({'exposure', 'fill_light', 'fill_from_camera'})


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


def job_state(cam_cfg: dict, scenario: dict) -> dict:
    """纯逻辑地解析一个 render job 的可见性与可调参数。"""
    curtain_policy = scenario.get('curtainPolicy')
    if curtain_policy not in (None, 'hidden_for_bare_shell'):
        raise RuntimeError(f'BLOCKED: unknown curtainPolicy {curtain_policy!r} in scenario {scenario.get("id")}')
    bare_shell = scenario.get('id') == 'bare_shell'
    return {
        'bare_shell': bare_shell,
        'curtain_policy': curtain_policy,
        'lights_on': scenario.get('lights_on', True),
        'show_hvac': not bare_shell and bool(scenario.get('hvac_coordination', False)),
        'fill': cam_cfg.get('fill_light', scenario.get('fill_light')),
        'fill_from_camera': cam_cfg.get('fill_from_camera', False),
        'sheer_opacity': scenario.get('sheer_opacity', 0.15),
        'glass_ior': scenario.get('glass_ior'),
        'glass_tint': scenario.get('glass_tint'),
        'glass_coat': scenario.get('glass_coat', 0.0),
        'light_temp': scenario.get('light_temp', 6500),
        'sun': scenario.get('sun_direction'),
        'portal': scenario.get('window_portal'),
    }


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
    if engine.upper() == 'CYCLES':
        for node in mat.node_tree.nodes:
            if node.bl_idname == 'ShaderNodeMixShader':
                node.inputs[0].default_value = float(opacity)
    else:
        _set_material_value(mat, 'Alpha', max(0.1, float(opacity) * 2.0))


def fill_light_is_enabled(fill) -> bool:
    """补光只有正数数值才启用；0 明确表示关闭，避免默认能量泄漏。"""
    return isinstance(fill, (int, float)) and fill > 0


def _set_job_lights(runtime: dict, state: dict, cam_cfg: dict, scenario: dict) -> None:
    temp = state['light_temp']
    color = kelvin_to_rgb(temp)
    for obj in bpy.data.objects:
        if obj.type == 'LIGHT' and obj.name != 'fill_light':
            obj.hide_render = not state['lights_on']
            obj.data.energy = runtime['light_defaults'].get(obj.name, obj.data.energy) if state['lights_on'] else 0.0
            if state['lights_on']:
                obj.data.color = color
    fill_obj = bpy.data.objects.get('fill_light')
    if fill_obj:
        fill = state['fill']
        fill_enabled = fill_light_is_enabled(fill)
        fill_obj.hide_render = not fill_enabled
        if fill_enabled:
            fill_obj.data.energy = float(fill)
            fill_obj.data.color = color
            tgt = cam_cfg.get('target', [0, 0, 0])
            if state['fill_from_camera']:
                import mathutils as _mu
                pos = cam_cfg.get('position', [0, 1.6, 0])
                fill_obj.location = to_blender(pos[0], pos[1], pos[2])
                direction = _mu.Vector(to_blender(tgt[0], tgt[1], tgt[2])) - fill_obj.location
                fill_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
            else:
                fill_obj.location = to_blender(tgt[0], 2.5, tgt[2])
    sun = bpy.data.objects.get('Sun')
    if sun:
        sun.hide_render = not bool(state['sun'])
        if state['sun']:
            from mathutils import Vector
            sun.rotation_mode = 'QUATERNION'
            sun.rotation_quaternion = (-Vector(state['sun']).normalized()).to_track_quat('-Z', 'Y')
            sun.data.energy = scenario.get('sun_energy', 1.2)
            sun.data.color = kelvin_to_rgb(scenario.get('sun_temp', 3200))
    portal = bpy.data.objects.get('window_portal')
    if portal:
        spec = state['portal']
        portal.hide_render = not bool(spec)
        if spec:
            portal.data.energy = spec.get('energy', 1500.0)
            portal.data.color = kelvin_to_rgb(spec.get('temp', 6000))


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


def _job_light_audit() -> dict:
    """Return stable key light state for per-job render diagnostics."""
    result = {}
    for obj in bpy.data.objects:
        if obj.type != 'LIGHT':
            continue
        result[obj.name] = {
            'type': obj.data.type,
            'energy': round(float(obj.data.energy), 3),
            'hidden': bool(obj.hide_render),
        }
    return result


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


def initialize_scene(args: dict, cfg: dict, jobs: list[dict]) -> dict:
    """一次性创建 Blender 场景；返回供各 job 复用的运行时上下文。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args['glb'])
    facts = projection_facts(cfg)
    curtain_proj = curtain_projection_from_facts(facts)
    curtain_errors = validate_curtain_nodes((o.name for o in bpy.data.objects), curtain_proj)
    if curtain_errors:
        raise RuntimeError('BLOCKED: GLB curtain nodes do not match facts.presentation.curtains '
                           f'(snapshot {curtain_proj.get("snapshotSha256")}):\n  ' + '\n  '.join(curtain_errors))
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
    dress_tv_wall_low(config_dir)
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
    # 客餐厅家具、bed_180、客卫浴室柜及四类已验证家电用真实资产替换；其他正式家具/柜体继续由主 GLB 提供。
    # bed_150 候选因 BlenderKit 导入后尺度异常，明确回退程序化床；replace_furniture 只触碰上述白名单。
    # 失败时保留程序化 vanity/床，water_heater、range_hood、toilet 保持禁用。
    # gas_stove 候选由下一行 render-only staging 按当前 kitchen 东墙 anchor/bbox 接入，失败仍保留程序化 fallback。
    replace_furniture(furniture_mats, config_dir, only_types={
        'sofa_3seat', 'dining_table', 'dining_chair', 'plant_fiddle', 'bed_180', 'vanity',
        'washer', 'dryer', 'dishwasher', 'fridge'})
    # Render-only candidates use current Blender anchors/bboxes; formal layout and Web geometry remain untouched.
    stage_missing_room_candidates(config_dir)
    add_moldings(config_dir)
    rebuild_railings(mats)
    # 基础吊顶几何由 shared SceneBuilder/CLI GLB 提供；Blender 只保留材质后处理。
    # add_ceiling_finishing 暂为 render-only staging，客餐厅跌级/灯槽仍在下方保留。
    _add_pet_bump(cabinet_mat)
    # 厨房正式几何（柜体、连续台面 bridge、sink/cooktop cutouts、家电位置）
    # 由 shared/CLI GLB 提供；Blender 不再重建。add_kitchen_cabinets 保留为 LEGACY 迁移参考。
    # 正式卫浴几何由 shared plumbing/overlay/furnishing GLB 提供；Blender 仅保留 legacy 函数作迁移参考。
    add_soft_decor(furniture_mats, config_dir=config_dir)
    # 正式灯具外形由 shared/CLI GLB 提供；Blender 仅保留光源。
    add_lights(cfg, temp_override=6500)
    add_ceiling_finishing(mats, emit=True)
    if any(job['scenario'].get('hvac_coordination') for job in jobs):
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
            'config_dir': config_dir, 'curtain_proj': curtain_proj, 'counts': counts,
            'light_defaults': light_defaults, 'material_defaults': material_defaults, 'out_path': ''}


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
    print(f'[dress_scene] job_audit path={out_path} scenario={scenario.get("id")} camera={cam_cfg.get("id")} '
          f'engine={runtime["engine"]} effective_exposure={scene.view_settings.exposure:.3f} '
          f'view_transform={getattr(scene.view_settings, "view_transform", "<unavailable>")} '
          f'look={getattr(scene.view_settings, "look", "<unavailable>")} '
          f'hdri={json.dumps(runtime.get("last_hdri_status", {}), ensure_ascii=False, sort_keys=True)} '
          f'lights={json.dumps(_job_light_audit(), ensure_ascii=False, sort_keys=True)} '
          f'materials={json.dumps(runtime["stats"], ensure_ascii=False)}')
    bpy.ops.render.render(write_still=True)
    with open(out_path + '.meta.json', 'w', encoding='utf-8') as f:
        json.dump({'scenario': scenario.get('id'), 'camera': cam_cfg.get('id'),
                   'curtainPolicy': state['curtain_policy'] or 'as_snapshot',
                   'curtainSnapshotSha256': runtime['curtain_proj'].get('snapshotSha256')}, f,
                  ensure_ascii=False, indent=2)
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
    engine = args.get('engine', 'EEVEE')
    version = args.get('version', 'v1')
    out_dir = args.get('out-dir', '.')

    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    from dress_config import make_jobs
    jobs = make_jobs(cfg, version=version)
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
