"""Formal furniture asset import and replacement helpers.

Dependencies are supplied through :func:`configure`; this module never imports
dress_scene, so it can be loaded independently by Blender diagnostics/tests.
"""
from __future__ import annotations
import json
import math
import os

bpy = None
hex_rgb = None
_find_node = None
new_principled = None
_set_recursive_hidden = None
_hide_furniture_instance_family = None
_mark_render_only = None
_is_render_only = None
add_pbr_maps = None
fixture_material_role = None
_furniture_instance_anchors = None
_furniture_instance_key = None
FURNITURE_PARTS = {}
CABINET_SEAM_PANELS = {}

def configure(*, bpy_module, hex_rgb_fn, find_node_fn, new_principled_fn,
              set_recursive_hidden_fn, hide_furniture_instance_family_fn,
              mark_render_only_fn, is_render_only_fn,
              add_pbr_maps_fn, fixture_material_role_fn,
              furniture_instance_anchors_fn, furniture_instance_key_fn,
              furniture_parts=None, cabinet_seam_panels=None):
    global bpy, hex_rgb, _find_node, new_principled, _set_recursive_hidden
    global _hide_furniture_instance_family
    global _mark_render_only, _is_render_only, add_pbr_maps, fixture_material_role
    global _furniture_instance_anchors, _furniture_instance_key
    global FURNITURE_PARTS, CABINET_SEAM_PANELS
    bpy = bpy_module
    hex_rgb = hex_rgb_fn
    _find_node = find_node_fn
    new_principled = new_principled_fn
    _set_recursive_hidden = set_recursive_hidden_fn
    _hide_furniture_instance_family = hide_furniture_instance_family_fn
    _mark_render_only = mark_render_only_fn
    _is_render_only = is_render_only_fn
    add_pbr_maps = add_pbr_maps_fn
    fixture_material_role = fixture_material_role_fn
    _furniture_instance_anchors = furniture_instance_anchors_fn
    _furniture_instance_key = furniture_instance_key_fn
    FURNITURE_PARTS = furniture_parts or {}
    CABINET_SEAM_PANELS = cabinet_seam_panels or {}

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
    instance_key = _furniture_instance_key(source)
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
        for formal_obj in bpy.data.objects:
            if _furniture_instance_key(formal_obj) == instance_key:
                formal_obj['dress_replacement_source'] = True
        _hide_furniture_instance_family(instance_key, True)
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
    for formal_obj in bpy.data.objects:
        if _furniture_instance_key(formal_obj) == instance_key:
            formal_obj['dress_replacement_source'] = True
    _hide_furniture_instance_family(instance_key, True)
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
            existing_key = existing_asset.get('instance_key') if existing_asset is not None else None
            if existing_asset is not None and existing_key == instance_key:
                obj['dress_replacement_source'] = True
                existing_asset['instance_key'] = instance_key
                existing_asset['dress_replacement_source'] = True
                _hide_furniture_instance_family(instance_key, True)
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
        imported_assets = [o for o in bpy.data.objects
                           if o not in before_assets and o.type == 'MESH']
        for imported_asset in imported_assets:
            imported_asset['instance_key'] = instance_key
            imported_asset['dress_replacement_source'] = True
        if ftype == 'plant_fiddle' and imported_assets:
            # import_furniture_glb 已按 block 类型命名；改为稳定的实例名，
            # 使两个房间的真实绿植都可见且可审计。
            imported_assets[-1].name = f'asset:plant_fiddle:{instance_key}:glb'
        obj['dress_replacement_source'] = True
        _hide_furniture_instance_family(instance_key, True)
        count += 1
    if count:
        print(f'[dress_scene] furniture replaced: {count} parts')
    return count


