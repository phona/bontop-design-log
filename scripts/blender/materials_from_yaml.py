"""从 materials.yaml 的 appearance 字段生成 Blender 程序化材质（不下载贴图）。

主题映射（scheme selections -> classify() 的 key）：
  floor/paint/wall/curtain/... → floor/wall/ceiling/curtain_fabric/furniture/...
classify() 见 dress_scene.py。
注意：bpy 仅在构建函数内延迟导入，纯逻辑函数（resolve_scheme）可脱离 Blender 单测。
"""
import os


_EXTERNAL_PBR_CHANNELS = ('base_color', 'normal', 'roughness', 'ao', 'bump')
_EXTERNAL_PBR_DEFAULT_FILES = {
    'base_color': 'diff.jpg',
    'normal': 'normal.jpg',
    'roughness': 'rough.jpg',
    'ao': 'ao.jpg',
    'bump': 'bump.jpg',
}

RENDER_ROLE_NAMES = frozenset({
    'exterior_glazing', 'fluted_glass', 'shower_glass', 'mirror',
    'tv_frame', 'tv_screen', 'cabinet_body', 'door_front', 'door_seam',
    'drawer_front', 'back_panel', 'frame', 'top_filler', 'plinth', 'shelf',
    'hardware', 'countertop', 'end_panel', 'fixture_diffuser', 'fixture_track',
    'fixture_metal', 'cove_light', 'ceramic', 'fabric', 'weight_plate',
    'upholstery', 'floor_protection', 'cabinet_foot', 'cabinet_support',
    'safety_bar', 'railing',
})

# Must stay aligned with shared/render/FixtureFactory.ts materialRole output.
FIXTURE_FACTORY_ROLES = frozenset({
    'cabinet_body', 'door_front', 'door_seam', 'drawer_front', 'back_panel',
    'frame', 'top_filler', 'plinth', 'shelf', 'hardware', 'countertop',
    'end_panel', 'tv_frame', 'tv_screen', 'fixture_diffuser', 'fixture_track',
    'fixture_metal', 'cove_light', 'ceramic', 'fabric', 'weight_plate',
    'upholstery', 'floor_protection', 'cabinet_foot', 'cabinet_support',
    'safety_bar', 'railing', 'mirror',
})


def _role_pbr_application(appearance: dict) -> dict:
    """Return the Blender-free application contract for one appearance record.

    This describes inputs to the existing Blender builders; it intentionally
    contains no node topology.  Keeping this contract data-only also makes
    missing-resource and unknown-type behavior testable without ``bpy``.
    """
    app = dict(appearance or {})
    typ = app.get('type', 'solid_color')
    descriptor = {
        'type': typ,
        'texture_id': app.get('texture_id'),
        'resource_root': app.get('resource_root'),
        'resources': dict(app.get('resources') or {}) if isinstance(app.get('resources'), dict) else {},
        'tile_size': app.get('tile_size'),
        'tint': app.get('tint'),
        'normal_strength': app.get('normal_strength', 1.0),
        'preserve_base_color': app.get('base_color_mode', 'texture') == 'preserve_color',
        'profile': app.get('profile'),
    }
    if typ not in {'solid_color', 'wood_plank', 'pbr_texture', 'external_pbr',
                   'blenderkit_pbr', 'ceramic_tile_v2'}:
        descriptor['unsupported'] = True
    return descriptor


def resolve_render_role_profiles(materials: dict, render_roles: dict | None,
                                 required_roles: set[str] | frozenset[str] | None = None) -> dict:
    """Resolve YAML ``render_roles`` to validated material records.

    This is deliberately Blender-free: it validates only the role/material
    contract and returns the original appearance plus a data-only PBR
    application descriptor for the node builder. Shader topology stays in
    Python so YAML remains an asset/profile manifest.
    """
    result = {'roles': {}, 'warnings': [], 'errors': []}
    if render_roles is None:
        result['warnings'].append('render_roles is not configured')
        return result
    if not isinstance(render_roles, dict):
        result['errors'].append('render_roles must be an object')
        return result
    if not isinstance(materials, dict):
        result['errors'].append('materials must be an object keyed by material id')
        return result
    for role, material_id in render_roles.items():
        if not isinstance(role, str) or not role.strip():
            result['errors'].append(f'invalid render role: {role!r}')
            continue
        if role not in RENDER_ROLE_NAMES:
            result['errors'].append(f'unknown render role: {role}')
            continue
        if not isinstance(material_id, str) or not material_id.strip():
            result['errors'].append(f'render role {role} must reference a material id')
            continue
        record = materials.get(material_id)
        if not isinstance(record, dict):
            result['errors'].append(f'render role {role} references unknown material: {material_id}')
            continue
        appearance = record.get('appearance')
        if appearance is not None and not isinstance(appearance, dict):
            result['errors'].append(f'material {material_id} appearance must be an object')
            continue
        resolved_appearance = appearance or {'type': 'solid_color'}
        result['roles'][role] = {
            'role': role,
            'material_id': material_id,
            'record': record,
            'appearance': resolved_appearance,
            'pbr': _role_pbr_application(resolved_appearance),
        }
    if required_roles:
        missing = sorted(set(required_roles) - set(result['roles']))
        if missing:
            result['errors'].append(
                'missing required render roles: ' + ', '.join(missing)
            )
    return result


def resolve_external_pbr(app: dict, config_dir: str) -> dict:
    """解析 external_pbr appearance，纯逻辑且不加载 Blender。

    资源默认位于 ``assets/textures/<texture_id>/``；也可用
    ``resources`` 显式指定通道路径（相对 ``config_dir``）。
    ``base_color_mode: preserve_color`` 保留 appearance.color，只要求
    normal + roughness；ao/bump 为可选通道。返回 paths/warnings/errors，
    调用方必须显式处理 errors，不应静默吞掉声明错误。
    """
    if not isinstance(app, dict):
        return {'paths': {}, 'warnings': [], 'errors': ['appearance must be an object'],
                'preserve_color': False}
    warnings: list[str] = []
    errors: list[str] = []
    texture_id = app.get('texture_id')
    resources = app.get('resources', {})
    if resources is None:
        resources = {}
    if not isinstance(resources, dict):
        errors.append('resources must be an object')
        resources = {}
    resource_root = app.get('resource_root')
    if resource_root is None:
        if not isinstance(texture_id, str) or not texture_id.strip():
            errors.append('texture_id or resource_root is required')
            resource_root = ''
        else:
            resource_root = os.path.join(config_dir, 'assets', 'textures', texture_id)
    elif not isinstance(resource_root, str) or not resource_root.strip():
        errors.append('resource_root must be a non-empty string')
        resource_root = ''
    elif not os.path.isabs(resource_root):
        resource_root = os.path.join(config_dir, resource_root)
    resource_root = os.path.normpath(resource_root) if resource_root else ''
    config_root = os.path.abspath(config_dir)
    if resource_root and not os.path.isabs(app.get('resource_root', '') or ''):
        if os.path.commonpath((config_root, os.path.abspath(resource_root))) != config_root:
            errors.append('resource_root must remain under config_dir')
            resource_root = ''

    paths: dict[str, str] = {}
    resource_aliases = {'base_color': ('base_color', 'diffuse')}
    for channel in _EXTERNAL_PBR_CHANNELS:
        declared = next((resources[name] for name in resource_aliases.get(channel, (channel,))
                         if name in resources), None)
        if declared is None:
            path = os.path.join(resource_root, _EXTERNAL_PBR_DEFAULT_FILES[channel]) if resource_root else ''
        elif not isinstance(declared, str) or not declared.strip():
            errors.append(f'{channel} resource path must be a non-empty string')
            continue
        else:
            path = declared if os.path.isabs(declared) else os.path.join(config_dir, declared)
        path = os.path.normpath(path) if path else ''
        if path:
            paths[channel] = path

    preserve_color = app.get('base_color_mode', 'texture') == 'preserve_color'
    required = ('normal', 'roughness') if preserve_color else ('base_color', 'normal', 'roughness')
    for channel in required:
        path = paths.get(channel)
        if not path:
            errors.append(f'missing required {channel} resource')
        elif not os.path.isfile(path):
            errors.append(f'missing required {channel} resource: {path}')
    for channel in ('base_color', 'normal', 'roughness', 'ao', 'bump'):
        if channel in required or channel not in paths:
            continue
        if not os.path.isfile(paths[channel]):
            warnings.append(f'missing optional {channel} resource: {paths[channel]}')
            paths.pop(channel)
    if preserve_color and 'base_color' in paths:
        warnings.append('base_color resource ignored because base_color_mode=preserve_color')
        paths.pop('base_color')
    return {'paths': paths, 'warnings': warnings, 'errors': errors,
            'preserve_color': preserve_color, 'texture_id': texture_id}


def resolve_scheme(scheme: dict, mats: dict, floor: dict | None = None) -> dict[str, str]:
    """把 non-floor current scheme 与可选 projection floor 映射为 classify key -> material_id。
    floor 不传时保留旧的纯逻辑调用兼容；Blender loader 必须显式传 projection floor。"""
    sel = scheme.get('selections', {})
    alias = {
        'paint': 'wall',
        # 墙砖独立成 'wall_tile' key：GLB 墙段命名 wall:seg:N:room=r1|r2 带房间归属，
        # dress_scene.classify 只给厨卫/阳台（WET_ROOM_IDS）墙段挂砖，其余墙面仍吃 paint 乳胶漆
        'wall': 'wall_tile',
        'curtain': 'curtain_fabric',
        'cabinet': 'cabinet',
        'countertop': 'countertop',
        'sofa': 'furniture',
        'bed': 'furniture',
        'dining_table': 'furniture',
        'dining_chair': 'furniture',
        'tv_stand': 'furniture',
        'desk': 'furniture',
        'chair': 'furniture',
        'bookshelf': 'furniture',
        'shoe_cabinet': 'furniture',
        'coffee_table': 'furniture',
        'wardrobe': 'furniture',
    }
    resolved: dict[str, str] = {}
    for topic, v in sel.items():
        mid = v.get('default') if isinstance(v, dict) else v
        if not isinstance(mid, str) or mid not in mats:
            continue
        key = alias.get(topic)
        if key is None:
            continue
        resolved[key] = mid
    if floor is None:
        legacy_floor = sel.get('floor') or sel.get('bedroom_floor')
        floor_mid = legacy_floor.get('default') if isinstance(legacy_floor, dict) else legacy_floor
        if isinstance(floor_mid, str) and floor_mid in mats:
            resolved['floor'] = floor_mid
    else:
        floor_mid = floor.get('default')
        if isinstance(floor_mid, str) and floor_mid in mats:
            resolved['floor'] = floor_mid
    return resolved


def resolve_floor_overrides(floor: dict, mats: dict) -> dict[str, str]:
    """从 render projection 解析 roomId -> material_id，不读取 current scheme。
    未知 material 仅告警并忽略；调用方会继续给该 room 默认地材。"""
    overrides = floor.get('roomOverrides', {}) if isinstance(floor, dict) else {}
    if not isinstance(overrides, dict):
        print('[materials] WARN facts.materials.floor.roomOverrides must be an object')
        return {}
    out = {}
    for room_id, mid in overrides.items():
        if not isinstance(room_id, str) or not isinstance(mid, str):
            print(f'[materials] WARN invalid floor override {room_id!r}: {mid!r}')
            continue
        if mid not in mats:
            print(f'[materials] WARN floor override {room_id} references unknown material {mid}')
            continue
        out[room_id] = mid
    return out


def _build_wood_textured(mid: str, app: dict, cache_dir: str):
    """wood_plank：生成程序化三通道贴图（与 three.js TextureFactory 同源），
    Mapping 缩放 1/worldSize，GLB 米制 UV 直接平铺。"""
    import bpy
    from wood_texture import ensure_wood_textures

    d, n, r, S = ensure_wood_textures(mid, app, cache_dir)
    mat = bpy.data.materials.new(f'方案_{mid}')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'), None) \
            or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = 0.15

    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1.0 / S, 1.0 / S, 1.0)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])

    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(d)
    tex.interpolation = 'Cubic'
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    rtex = nt.nodes.new('ShaderNodeTexImage')
    rtex.image = bpy.data.images.load(r)
    rtex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(mapping.outputs['Vector'], rtex.inputs['Vector'])
    nt.links.new(rtex.outputs['Color'], bsdf.inputs['Roughness'])

    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = bpy.data.images.load(n)
    ntex.image.colorspace_settings.name = 'Non-Color'
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = 0.5
    nt.links.new(mapping.outputs['Vector'], ntex.inputs['Vector'])
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def _build_pbr_textured(mid: str, app: dict, config_dir: str):
    """加载下载好的 PBR 贴图（diffuse/normal/rough）构建材质。
    Poly Haven/ambientCG 等 CC0 扫描件，替掉程序化木纹。
    tile_size: 每张贴图覆盖的世界尺寸（米），控制平铺密度。
    tint: 可选乘色统一色调。"""
    import bpy
    import os

    tex_id = app.get('texture_id', mid)
    tex_dir = os.path.normpath(os.path.join(config_dir, 'assets', 'textures', tex_id))
    tile_size = app.get('tile_size', 2.0)

    mat = bpy.data.materials.new(f'方案_{mid}')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'), None) \
            or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0

    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1.0 / tile_size, 1.0 / tile_size, 1.0)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])

    # Diffuse
    diff_path = os.path.join(tex_dir, 'diff.jpg')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(diff_path)
    tex.interpolation = 'Cubic'
    nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])

    # tint 乘色（可选）
    tint = app.get('tint')
    # 砖缝叠加（可选）：Brick 纹理生成规则网格暗线，模拟木纹砖砖缝
    grout = app.get('grout')
    if grout:
        tile_w = app.get('tile_width', 0.15)
        tile_l = app.get('tile_length', 0.9)
        grout_mapping = nt.nodes.new('ShaderNodeMapping')
        grout_mapping.inputs['Scale'].default_value = (1.0 / tile_w, 1.0 / tile_l, 1.0)
        nt.links.new(uv.outputs['UV'], grout_mapping.inputs['Vector'])
        brick = nt.nodes.new('ShaderNodeTexBrick')
        # mapping 已把 UV 换算成"砖单位"（1 单位=1 块砖），这里把砖机网格对齐到 1×1：
        brick.inputs[8].default_value = 1.0  # Brick Width = 1 砖宽
        brick.inputs[9].default_value = 1.0  # Row Height = 1 砖长
        if not app.get('grout_stagger'):
            try:
                brick.offset = 0.0  # 直铺无错缝（grout_stagger=true 时保留默认 0.5 步步高错缝）
                brick.offset_frequency = 0
            except Exception:
                pass  # 部分版本 offset 是只读或不存在
        # Blender 5.0 输入顺序：[0]Vector [1]Color1 [2]Color2 [3]Mortar [4]Scale [5]MortarSize [6]Smooth [7]Bias [8]BrickW [9]RowH
        # Color1/Color2 按砖随机二选一 → 板间深浅混铺（cell_tone_lo/hi），真实木纹砖多版面混包效果
        lo = float(app.get('cell_tone_lo', 1.0))
        hi = float(app.get('cell_tone_hi', 1.0))
        brick.inputs[1].default_value = (lo, lo, lo, 1)  # Color1（深版）
        brick.inputs[2].default_value = (hi, hi, hi, 1)  # Color2（浅版）
        gv = app.get('grout_value', 0.2)
        brick.inputs[3].default_value = (gv, gv, gv, 1)  # Mortar (深灰=砖缝)
        brick.inputs[4].default_value = 1.0  # Scale
        brick.inputs[5].default_value = app.get('grout_frac', 0.02)  # Mortar Size（砖缝占砖宽比例）
        nt.links.new(grout_mapping.outputs['Vector'], brick.inputs['Vector'])
        grout_mul = nt.nodes.new('ShaderNodeMixRGB')
        grout_mul.blend_type = 'MULTIPLY'
        grout_mul.inputs['Fac'].default_value = 1.0
        nt.links.new(tex.outputs['Color'], grout_mul.inputs['Color1'])
        nt.links.new(brick.outputs['Color'], grout_mul.inputs['Color2'])
        diff_out = grout_mul.outputs['Color']
    else:
        diff_out = tex.outputs['Color']
    if tint:
        from dress_scene import hex_rgb as _hex_rgb
        mul = nt.nodes.new('ShaderNodeMixRGB')
        # COLOR=保留纹理亮度/木纹、染目标色号（对准色号）; MULTIPLY=乘色偏暗（旧）
        mul.blend_type = app.get('tint_mode', 'COLOR')
        mul.inputs['Fac'].default_value = 1.0
        nt.links.new(diff_out, mul.inputs['Color1'])
        mul.inputs['Color2'].default_value = (*_hex_rgb(tint), 1.0)
        nt.links.new(mul.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        nt.links.new(diff_out, bsdf.inputs['Base Color'])
    # 釉面 coat（可选）
    coat = app.get('coat', 0.0)
    if coat and 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = coat
        if 'Coat Roughness' in bsdf.inputs:
            bsdf.inputs['Coat Roughness'].default_value = 0.1

    # Roughness（appearance.roughness 覆盖贴图：柔光砖/漆面等需要精确光泽度的场景）
    rough_override = app.get('roughness')
    if rough_override is not None:
        bsdf.inputs['Roughness'].default_value = float(rough_override)
    else:
        rough_path = os.path.join(tex_dir, 'rough.jpg')
        rtex = nt.nodes.new('ShaderNodeTexImage')
        rtex.image = bpy.data.images.load(rough_path)
        rtex.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], rtex.inputs['Vector'])
        nt.links.new(rtex.outputs['Color'], bsdf.inputs['Roughness'])

    # Normal (OpenGL)
    norm_path = os.path.join(tex_dir, 'normal.jpg')
    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = bpy.data.images.load(norm_path)
    ntex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(mapping.outputs['Vector'], ntex.inputs['Vector'])
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.inputs['Strength'].default_value = app.get('normal_strength', 1.0)
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def _build_external_pbr(mid: str, app: dict, config_dir: str, color):
    """构建声明式 external_pbr/BlenderKit PBR 材质。

    资源解析和存在性校验由 resolve_external_pbr 完成；必需通道缺失直接
    抛出，由 build_yaml_materials 负责记录告警并回退。可选 AO/bump 缺失
    已由解析器剔除并仅产生 warning。
    """
    import bpy

    spec = resolve_external_pbr(app, config_dir)
    for warning in spec['warnings']:
        print(f'[materials] WARN external PBR {mid}: {warning}')
    if spec['errors']:
        raise ValueError('; '.join(spec['errors']))

    mat = bpy.data.materials.new(f'方案_{mid}')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = (next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'), None)
               or nt.nodes.new('ShaderNodeOutputMaterial'))
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Metallic'].default_value = 0.0

    mapping = nt.nodes.new('ShaderNodeMapping')
    tile_size = float(app.get('tile_size', 2.0))
    if tile_size <= 0:
        raise ValueError('tile_size must be greater than zero')
    mapping.inputs['Scale'].default_value = (1.0 / tile_size, 1.0 / tile_size, 1.0)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])

    def image(channel: str):
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(spec['paths'][channel])
        tex.interpolation = 'Cubic'
        if channel != 'base_color':
            tex.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
        return tex

    if spec['preserve_color']:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    else:
        nt.links.new(image('base_color').outputs['Color'], bsdf.inputs['Base Color'])

    rough = image('roughness')
    nt.links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    normal_map = nt.nodes.new('ShaderNodeNormalMap')
    normal_map.inputs['Strength'].default_value = float(app.get('normal_strength', 1.0))
    nt.links.new(image('normal').outputs['Color'], normal_map.inputs['Color'])
    normal_socket = normal_map.outputs['Normal']

    if 'bump' in spec['paths']:
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = float(app.get('bump_strength', 0.15))
        bump.inputs['Distance'].default_value = float(app.get('bump_distance', 0.001))
        nt.links.new(image('bump').outputs['Color'], bump.inputs['Height'])
        nt.links.new(normal_socket, bump.inputs['Normal'])
        normal_socket = bump.outputs['Normal']
    nt.links.new(normal_socket, bsdf.inputs['Normal'])

    if 'ao' in spec['paths']:
        ao = image('ao')
        # AO 仅压暗基色，不改变保色模式的声明；Multiply 保留项目颜色/贴图色。
        multiply = nt.nodes.new('ShaderNodeMixRGB')
        multiply.blend_type = 'MULTIPLY'
        multiply.inputs['Fac'].default_value = 1.0
        if spec['preserve_color']:
            multiply.inputs['Color1'].default_value = (*color, 1.0)
        else:
            # base_color 节点可通过其已连接的输入作为 Color1。
            base_link = next((link for link in bsdf.inputs['Base Color'].links), None)
            if base_link is None:
                multiply.inputs['Color1'].default_value = (*color, 1.0)
            else:
                nt.links.new(base_link.from_socket, multiply.inputs['Color1'])
        nt.links.new(ao.outputs['Color'], multiply.inputs['Color2'])
        nt.links.new(multiply.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def _build_ceramic_tile(mid: str, app: dict, np_, color):
    """ceramic_tile_v2：釉面砖纯色基底 + Brick 纹理程序化砖缝。
    300x600mm 普通错缝（pattern: basket 简化为默认 0.5 步步高错缝，不过度设计）；
    砖缝比砖面略深略灰，法线细微 bump。砖色保持 appearance.color 不变。"""
    import bpy
    finish = app.get('finish', 'soft')
    mat = np_(f'方案_{mid}', color, rough=0.2 if finish != 'matte' else 0.5, coat=0.3)
    try:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
        if bsdf is None:
            return mat
        tile_w = app.get('tile_width', 0.3)   # 砖宽（横缝间距）
        tile_h = app.get('tile_height', 0.6)  # 砖高（竖缝间距）
        uv = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1.0 / tile_w, 1.0 / tile_h, 1.0)
        nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
        brick = nt.nodes.new('ShaderNodeTexBrick')
        # mapping 已把 UV 换算成"砖单位"（1 单位=1 块砖），砖机网格对齐到 1×1：
        # [0]Vector [1]Color1 [2]Color2 [3]Mortar [4]Scale [5]MortarSize [6]Smooth [7]Bias [8]BrickW [9]RowH
        brick.inputs[8].default_value = 1.0  # Brick Width = 1 砖宽
        brick.inputs[9].default_value = 1.0  # Row Height = 1 砖高
        brick.inputs[1].default_value = (*color, 1)  # Color1
        brick.inputs[2].default_value = (*color, 1)  # Color2（同版无色差）
        g = tuple(c * 0.72 for c in color)  # 砖缝：比砖面略深略灰
        brick.inputs[3].default_value = (*g, 1)  # Mortar
        brick.inputs[5].default_value = app.get('grout_frac', 0.01)  # 砖缝占砖宽比例（300mm×1%≈3mm）
        nt.links.new(mapping.outputs['Vector'], brick.inputs['Vector'])
        nt.links.new(brick.outputs['Color'], bsdf.inputs['Base Color'])
        # 砖缝微凹：1-Fac 使砖面凸起、缝下陷，细 bump 出网格阴影
        sub = nt.nodes.new('ShaderNodeMath')
        sub.operation = 'SUBTRACT'
        sub.inputs[0].default_value = 1.0
        nt.links.new(brick.outputs['Fac'], sub.inputs[1])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.2
        bump.inputs['Distance'].default_value = 0.001
        nt.links.new(sub.outputs[0], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    except Exception as e:
        print(f'[materials] WARN 砖缝网格生成失败({mid}): {e} → 回退纯色釉面')
    return mat


_GLASS_PROFILE_DEFAULTS = {
    'low_e': {'roughness': 0.02, 'transmission': 1.0, 'ior': 1.5, 'coat': 0.3},
    'fluted': {'roughness': 0.2, 'transmission': 0.75, 'ior': 1.5, 'coat': 0.0},
    'shower_glass': {'roughness': 0.12, 'transmission': 0.9, 'ior': 1.45, 'coat': 0.0},
    'mirror': {'roughness': 0.08, 'metallic': 0.75, 'ior': 1.5, 'coat': 0.0},
}


def _apply_principled_appearance(mat, appearance: dict, color, rough: float):
    """Apply YAML appearance/profile values to the material's Principled node."""
    nt = mat.node_tree
    bsdf = next((node for node in nt.nodes
                 if node.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        return
    profile = appearance.get('profile')
    params = dict(_GLASS_PROFILE_DEFAULTS.get(profile, {}))
    params['roughness'] = appearance.get('roughness', params.get('roughness', rough))
    for name in ('metallic', 'transmission', 'ior', 'coat', 'alpha'):
        if name in appearance:
            params[name] = appearance[name]
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = float(params['roughness'])
    if 'Metallic' in bsdf.inputs and 'metallic' in params:
        bsdf.inputs['Metallic'].default_value = float(params['metallic'])
    transmission = params.get('transmission')
    if transmission is not None:
        socket = bsdf.inputs.get('Transmission Weight') or bsdf.inputs.get('Transmission')
        if socket is not None:
            socket.default_value = float(transmission)
    if 'IOR' in bsdf.inputs and 'ior' in params:
        bsdf.inputs['IOR'].default_value = float(params['ior'])
    if 'Coat Weight' in bsdf.inputs and 'coat' in params:
        bsdf.inputs['Coat Weight'].default_value = float(params['coat'])
    if 'Alpha' in bsdf.inputs and 'alpha' in params:
        bsdf.inputs['Alpha'].default_value = float(params['alpha'])


def _add_fluted_bump(mat, appearance: dict) -> None:
    """Add vertical procedural flutes only to the explicit fluted profile."""
    nt = mat.node_tree
    bsdf = next((node for node in nt.nodes
                 if node.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    if bsdf is None:
        return
    coord = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = float(appearance.get('flute_scale', 55.0))
    wave.inputs['Distortion'].default_value = 0.0
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = float(appearance.get('flute_bump_strength', 0.22))
    bump.inputs['Distance'].default_value = float(appearance.get('flute_bump_distance', 0.004))
    nt.links.new(coord.outputs['UV'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])


def build_yaml_materials(mats: dict, resolved: dict, helpers: dict,
                         cache_dir: str | None = None,
                         config_dir: str | None = None,
                         color_overrides: dict | None = None,
                         role_profiles: dict | None = None) -> dict:
    """resolved: classify_key -> material_id。返回 classify_key -> bpy material。
    helpers 注入 new_principled/hex_rgb，避免与 dress_scene 循环依赖。
    cache_dir: 木纹贴图缓存目录（wood_plank 时必需）。
    config_dir: 项目根目录（pbr_texture 时找 assets/textures/）。
    color_overrides: classify_key -> hex，候选色号循环评审（dress_scene --mat-override）；
    覆盖 appearance.color（带 tint 的 PBR 同步覆盖 tint），在贴图生成前生效。"""
    import bpy
    out: dict = {}
    np_ = helpers['new_principled']
    hex_rgb = helpers['hex_rgb']
    for key, mid in resolved.items():
        rec = mats[mid]
        app = rec.get('appearance', {})
        if role_profiles and key in role_profiles:
            profile = role_profiles[key]
            mid = profile['material_id']
            rec = profile['record']
            app = profile['appearance']
        if color_overrides and key in color_overrides:
            app = dict(app)
            app['color'] = color_overrides[key]
            if 'tint' in app:
                app['tint'] = color_overrides[key]
        typ = app.get('type', 'solid_color')
        color = hex_rgb(app.get('color', '#bfbfbf'))
        finish = app.get('finish', 'soft')
        rough = {'glossy': 0.15, 'soft': 0.35, 'matte': 0.6}.get(finish, 0.4)
        if key in ('wall', 'ceiling'):
            rough = 0.9
        if typ == 'pbr_texture' and config_dir:
            try:
                mat = _build_pbr_textured(mid, app, config_dir)
            except Exception as e:
                print(f'[materials] WARN PBR 贴图加载失败({mid}): {e} → 回退纯色')
                mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ in ('external_pbr', 'blenderkit_pbr') and config_dir:
            try:
                mat = _build_external_pbr(mid, app, config_dir, color)
            except Exception as e:
                print(f'[materials] WARN external PBR 资源加载失败({mid}): {e} → 回退纯色')
                mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ == 'wood_plank' and cache_dir:
            try:
                mat = _build_wood_textured(mid, app, cache_dir)
            except Exception as e:
                print(f'[materials] WARN 木纹贴图生成失败({mid}): {e} → 回退纯色')
                mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ == 'wood_plank':
            mat = np_(f'方案_{mid}', color, rough=rough, coat=0.15)
        elif typ == 'solid_color':
            mat = np_(f'方案_{mid}', color, rough=rough)
        elif typ == 'ceramic_tile_v2':
            mat = _build_ceramic_tile(mid, app, np_, color)
        else:
            mat = np_(f'方案_{mid}', color, rough=rough)
        if app.get('profile') in _GLASS_PROFILE_DEFAULTS:
            _apply_principled_appearance(mat, app, color, rough)
            if app.get('profile') == 'fluted':
                _add_fluted_bump(mat, app)
        # 墙面漆面微纹理（橙皮纹）：细微程序化 bump，不下载贴图
        if key == 'wall' and typ == 'solid_color':
            try:
                nt = mat.node_tree
                bsdf2 = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
                if bsdf2 is not None:
                    noise = nt.nodes.new('ShaderNodeTexNoise')
                    noise.inputs['Scale'].default_value = 80.0
                    noise.inputs['Detail'].default_value = 2.0
                    bump = nt.nodes.new('ShaderNodeBump')
                    bump.inputs['Strength'].default_value = 0.02
                    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
                    nt.links.new(bump.outputs['Normal'], bsdf2.inputs['Normal'])
            except Exception:
                pass
        out[key] = mat
    return out


def load_scheme_materials(engine: str, mats: dict, new_principled, hex_rgb, facts: dict,
                          config_dir: str | None = None,
                          color_overrides: dict | None = None) -> tuple[dict, dict, dict]:
    """构建 scheme 材质、分房地材及正式 GLB role profiles。
    `facts.materials.floor` 是 Blender 唯一的 floor 选择输入；current-scheme 仅供 non-floor topics。
    返回 (所有 classify 材质, roomId -> floor Blender material, role -> profile)。"""
    import json
    import yaml as pyyaml

    if config_dir is None:
        config_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    mats_path = os.path.join(config_dir, 'config', 'materials.yaml')
    scheme_path = os.path.join(config_dir, 'data', 'current-scheme.json')
    floor = facts.get('materials', {}).get('floor') if isinstance(facts, dict) else None
    if not isinstance(floor, dict):
        raise ValueError('render facts missing materials.floor')
    with open(mats_path, 'r', encoding='utf-8') as f:
        materials_doc = pyyaml.safe_load(f)
    mats_yaml = {m['id']: m for m in materials_doc['materials']}
    role_spec = resolve_render_role_profiles(
        mats_yaml, materials_doc.get('render_roles'), FIXTURE_FACTORY_ROLES
    )
    for warning in role_spec['warnings']:
        print(f'[materials] WARN {warning}')
    if role_spec['errors']:
        raise ValueError('invalid render_roles: ' + '; '.join(role_spec['errors']))
    role_profiles = role_spec['roles']
    if os.path.exists(scheme_path):
        with open(scheme_path, 'r', encoding='utf-8') as f:
            scheme = json.load(f)
    else:
        scheme = {}
    resolved = resolve_scheme(scheme, mats_yaml, floor)
    overrides = resolve_floor_overrides(floor, mats_yaml)
    helpers = {'new_principled': new_principled, 'hex_rgb': hex_rgb}
    tex_cache = os.path.join(config_dir, 'renders', 'blender', 'textures')
    default_floor_id = resolved.get('floor')
    default_floor_record = mats_yaml.get(default_floor_id, {}) if default_floor_id else {}
    default_floor_name = default_floor_record.get('name') if isinstance(default_floor_record, dict) else None
    default_floor_label = f'{default_floor_id or "<none>"}/{default_floor_name or "<unnamed>"}'
    override_summary = ', '.join(f'{room_id}={mid}' for room_id, mid in sorted(overrides.items())) or '<none>'
    print(f'[materials] floor default={default_floor_label}; room overrides={override_summary}')
    print(f'[materials] wood texture cache={os.path.abspath(tex_cache)}')
    yaml_mats = build_yaml_materials(mats_yaml, resolved, helpers, cache_dir=tex_cache,
                                     config_dir=config_dir, color_overrides=color_overrides,
                                     role_profiles=role_profiles)
    role_resolved = {role: profile['material_id'] for role, profile in role_profiles.items()}
    role_mats = build_yaml_materials(mats_yaml, role_resolved, helpers, cache_dir=tex_cache,
                                     config_dir=config_dir, color_overrides=color_overrides,
                                     role_profiles=role_profiles)
    mats.update(yaml_mats)
    mats.update(role_mats)
    floor_mats = {}
    for room_id, mid in overrides.items():
        key = f'floor:{room_id}'
        room_override = build_yaml_materials(
            mats_yaml, {key: mid}, helpers, cache_dir=tex_cache, config_dir=config_dir,
            color_overrides=color_overrides,
        )
        floor_mats[room_id] = room_override[key]
    return mats, floor_mats, role_profiles
