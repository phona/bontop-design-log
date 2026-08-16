"""从 materials.yaml 的 appearance 字段生成 Blender 程序化材质（不下载贴图）。

主题映射（scheme selections -> classify() 的 key）：
  floor/paint/wall/curtain/... → floor/wall/ceiling/curtain_fabric/furniture/...
classify() 见 dress_scene.py。
注意：bpy 仅在构建函数内延迟导入，纯逻辑函数（resolve_scheme）可脱离 Blender 单测。
"""
import os


def resolve_scheme(scheme: dict, mats: dict) -> dict[str, str]:
    """把 current-scheme.json 的 selections 映射为 classify key -> material_id。
    仅保留在材质库中存在的条目；无 coverage 的主题不产出。"""
    sel = scheme.get('selections', {})
    alias = {
        'floor': 'floor',
        'bedroom_floor': 'floor',
        'paint': 'wall',
        'wall': 'wall',
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
    return resolved


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
        try:
            brick.offset = 0.0  # 直铺无错缝（默认 0.5=running bond）
            brick.offset_frequency = 0
        except Exception:
            pass  # 部分版本 offset 是只读或不存在
        # Blender 5.0 输入顺序：[0]Vector [1]Color1 [2]Color2 [3]Mortar [4]Scale [5]MortarSize [6]Smooth [7]Bias [8]BrickW [9]RowH
        brick.inputs[1].default_value = (1, 1, 1, 1)  # Color1 (白=不暗化砖面)
        brick.inputs[2].default_value = (1, 1, 1, 1)  # Color2
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


def build_yaml_materials(mats: dict, resolved: dict, helpers: dict,
                         cache_dir: str | None = None,
                         config_dir: str | None = None) -> dict:
    """resolved: classify_key -> material_id。返回 classify_key -> bpy material。
    helpers 注入 new_principled/hex_rgb，避免与 dress_scene 循环依赖。
    cache_dir: 木纹贴图缓存目录（wood_plank 时必需）。
    config_dir: 项目根目录（pbr_texture 时找 assets/textures/）。"""
    import bpy
    out: dict = {}
    np_ = helpers['new_principled']
    hex_rgb = helpers['hex_rgb']
    for key, mid in resolved.items():
        rec = mats[mid]
        app = rec.get('appearance', {})
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
            mat = np_(f'方案_{mid}', color, rough=0.2 if finish != 'matte' else 0.5, coat=0.3)
        else:
            mat = np_(f'方案_{mid}', color, rough=rough)
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


def load_scheme_materials(engine: str, mats: dict, new_principled, hex_rgb,
                          config_dir: str | None = None) -> dict:
    """从 config/materials.yaml + data/current-scheme.json 生成材质并覆盖同名 key。
    engine 保留供未来贴图/程序化纹理分引擎使用。
    config_dir: 项目根目录（含 config/ 与 data/），缺省回退到脚本上级三级。"""
    import json
    import yaml as pyyaml

    if config_dir is None:
        config_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    mats_path = os.path.join(config_dir, 'config', 'materials.yaml')
    scheme_path = os.path.join(config_dir, 'data', 'current-scheme.json')
    with open(mats_path, 'r', encoding='utf-8') as f:
        mats_yaml = {m['id']: m for m in pyyaml.safe_load(f)['materials']}
    if os.path.exists(scheme_path):
        with open(scheme_path, 'r', encoding='utf-8') as f:
            scheme = json.load(f)
    else:
        scheme = {}
    resolved = resolve_scheme(scheme, mats_yaml)
    helpers = {'new_principled': new_principled, 'hex_rgb': hex_rgb}
    tex_cache = os.path.join(config_dir, 'renders', 'blender', 'textures')
    yaml_mats = build_yaml_materials(mats_yaml, resolved, helpers, cache_dir=tex_cache,
                                     config_dir=config_dir)
    mats.update(yaml_mats)
    return mats
