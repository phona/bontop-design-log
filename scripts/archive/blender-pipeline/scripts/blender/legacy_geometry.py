"""Legacy Blender geometry escape hatches.

The formal render path is supplied by shared/CLI GLB geometry.  These helpers
remain available only for historical callers and are deliberately configured
through dependency injection so this module never imports ``dress_scene``.
"""
from __future__ import annotations

import math
import os


bpy = None
_to_blender = None
FURNITURE_PARTS = {}
FURNITURE_GLB = {}
CABINET_SEAM_PANELS = {}
_import_furniture_glb = None
_master_bath_final_layout = None


def configure(*, bpy_module, to_blender_fn, furniture_parts=None, furniture_glb=None,
              cabinet_seam_panels=None, import_furniture_glb_fn=None,
              master_bath_final_layout_fn=None):
    """Inject Blender and the small set of compatibility dependencies."""
    global bpy, _to_blender, FURNITURE_PARTS, FURNITURE_GLB, CABINET_SEAM_PANELS
    global _import_furniture_glb, _master_bath_final_layout
    bpy = bpy_module
    _to_blender = to_blender_fn
    FURNITURE_PARTS = furniture_parts or {}
    FURNITURE_GLB = furniture_glb or {}
    CABINET_SEAM_PANELS = cabinet_seam_panels or {}
    _import_furniture_glb = import_furniture_glb_fn
    _master_bath_final_layout = master_bath_final_layout_fn


def _add_cabinet_seams(ftype: str, base, rz: float, gap_mat) -> int:
    """在定制柜正面生成柜门分缝条。base=(bx,by,bz) Blender 世界坐标（柜体块原点），
    rz 为绕 Z 旋转。缝条 4mm 宽、3mm 深（半嵌入门板正面），深色哑光读出凹槽阴影。"""
    panels = CABINET_SEAM_PANELS.get(ftype)
    if not panels or gap_mat is None:
        return 0
    cos_rz, sin_rz = math.cos(rz), math.sin(rz)
    bx, by, bz = base
    n = 0
    for (x0, x1, y0, y1, fz) in panels:
        w = x1 - x0
        doors = max(1, round(w / 0.45))
        for k in range(1, doors):
            sx = x0 + w * k / doors
            sy = (y0 + y1) / 2
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


def place_extra_furniture(furniture_mats: dict, config_dir: str, plumbing: dict,
                          only_types: set | None = None) -> int:
    """LEGACY Blender 家具补摆几何旁路；not called by initialize_scene。

    正式家具几何由 shared/CLI GLB（GLB geometry source）提供；本函数仅保留作历史
    迁移参考。house.yaml 已摆位但 glb 尚未重新导出的家具类型：直接按坐标生成部件。
    glb 里已有 furniture:* 块的类型跳过（重新导出后自动失效，不会重复）。
    坐标：house.yaml 为 three 局部米制 (x, z, rotation°)；three(x,y,z) → Blender(x,-z,y)，rotation 同号映到 Blender Z。
    only_types：bare_shell 等工况的类型白名单（只生成定制柜等硬装件）。"""
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
            bx, by = x, -z
            glb_cfg = FURNITURE_GLB.get(ftype)
            if glb_cfg:
                glb_path = os.path.join(config_dir, glb_cfg['path'])
                if os.path.exists(glb_path):
                    if _import_furniture_glb(glb_path, glb_cfg, loc_rz=((bx, by, 0.0), rz)):
                        count += 1
                        continue
            for part_spec in FURNITURE_PARTS[ftype]:
                pname, tsize, tpos, mat_key = part_spec[:4]
                shape = part_spec[4] if len(part_spec) > 4 else 'box'
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
        box.location = _to_blender((x1 + x2) / 2, 2.8 - thick / 2, (z1 + z2) / 2)
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
        b.location = _to_blender(cx, yc, cz)
        if mat:
            b.data.materials.append(mat)
        bev = b.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.01
        bev.segments = 3
        return 1

    def kgap(name, cx, cz, y_lo, y_hi, facing):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        b = bpy.context.object
        b.name = name
        sx, sz = (0.004, 0.003) if facing == 'z' else (0.003, 0.004)
        b.dimensions = (sx, sz, y_hi - y_lo)
        b.location = _to_blender(cx, (y_lo + y_hi) / 2, cz)
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
    n += kbox('kitchen:base_n1', 7.86, 0.3, 1.28, 0.6, 0.85, 0.425, cream)
    n += kbox('kitchen:base_n2', 9.94, 0.3, 1.68, 0.6, 0.85, 0.425, cream)
    n += kbox('kitchen:base_e', 10.5, 1.15, 0.6, 1.1, 0.85, 0.425, cream)

    def ktop(name, cx, cz, sx, sz, cutouts):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        t = bpy.context.object
        t.name = name
        t.dimensions = (sx, sz, 0.03)
        t.location = _to_blender(cx, 0.865, cz)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        t.data.materials.append(quartz)
        for i, (ox, oz, ow, od) in enumerate(cutouts):
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            c = bpy.context.object
            c.name = f'{name}:cut{i}'
            c.dimensions = (ow, od, 0.1)
            c.location = _to_blender(ox, 0.865, oz)
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
                           _to_blender(x, (top - 0.08) / 2, z), mat)
    count += _add_cylinder(f'{prefix}:head', 0.09, 0.025,
                           _to_blender(x, top + 0.04, z), mat)
    return count


def add_bath_fixtures(furniture_mats: dict, plumbing: dict) -> int:
    """LEGACY Blender 卫浴几何旁路；not called by initialize_scene。

    正式卫浴几何由 shared plumbing/overlay/furnishing GLB（GLB geometry source）提供；
    本函数仅保留作旧洁具与细节实现的迁移参考，初始化流程不得调用本函数。
    """
    ceramic = furniture_mats.get('ceramic')
    cream = furniture_mats.get('paint_cream')
    metal = furniture_mats.get('metal')
    towel_mat = furniture_mats.get('fabric_light')
    layout = _master_bath_final_layout()

    def box(name, cx, cz, sx, sz, sy, yc, mat):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        b = bpy.context.object
        b.name = name
        b.dimensions = (sx, sz, sy)
        b.location = _to_blender(cx, yc, cz)
        if mat:
            b.data.materials.append(mat)
        return 1

    n = 0

    def point(point_id):
        p = plumbing.get(point_id)
        if not p:
            print(f'[dress_scene] WARN: missing plumbing anchor {point_id}; skip associated bath fixture')
        return p

    mb_vanity, mb_toilet = point('faucet_mbath_vanity'), point('toilet_mbath')
    if mb_vanity:
        x = float(mb_vanity['x']) + layout['vanity_center_from_anchor'][0]
        z = float(mb_vanity['z']) + layout['vanity_center_from_anchor'][1]
        vanity_w, vanity_d = layout['vanity_size']
        n += box('bath:mb_vanity', x, z, vanity_w, vanity_d, 0.80, 0.40, cream)
        n += box('bath:mb_basin', float(mb_vanity['x']), float(mb_vanity['z']), 0.45, 0.36, 0.12, 0.85, ceramic)
        n += box('bath:mb_mirror_cab', float(mb_vanity['x']), float(mb_vanity['z']), 0.45, 0.08, 0.70, 1.55, cream)
        n += box('bath:mb_mirror', float(mb_vanity['x']), float(mb_vanity['z']) - 0.05, 0.40, 0.02, 0.65, 1.55, metal)
        n += box('bath:mb_soap', x - 0.12, z - 0.08, 0.06, 0.06, 0.15, 0.925, ceramic)
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
