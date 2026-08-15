"""
dress_scene.py — Blender 自动定妆管线 v2（批量 A/B 决策）
用法（WSL 调 Windows Blender）：
  "/mnt/e/Blender Foundation/Blender 5.2/blender.exe" --background --python scripts/blender/dress_scene.py -- \
    --glb "C:\\...\\house.glb" --config "C:\\...\\render-config.json" --engine EEVEE \
    --out-dir "C:\\...\\renders" --version v1 --config-dir "\\\\wsl.localhost\\Ubuntu\\home\\tao\\projects\\bontop-design-log"

坐标：glb 为 Three.js 米制（x 东 / y 高 / z 南）；glTF 导入 Blender 后 (x,y,z)_three → (x, -z, y)_blender。
材质/灯光全部按 objectId（节点名）声明式驱动，与 docs/dressing-map.md 同源。
机位×场景批量展开见 dress_config.py；材质从 materials.yaml appearance 生成见 materials_from_yaml.py。
"""
import bpy
import json
import math
import os
import sys

# 确保同目录的 dress_config / materials_from_yaml 可导入（Blender --python 不自动加脚本目录）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GLASS_IDS = {
    'west_curtain', 'kitchen_north_curtain', 'north_recess_curtain',
    'living_south_curtain', 'south_east_curtain',
}

LIGHT_ENERGY = {  # 瓦（Cycles/EEVEE 通用，先求氛围对再校绝对亮度）
    'pendant': 110.0,
    'dome': 55.0,
    'downlight': 22.0,
    'wall_lamp': 18.0,
    'led_strip': 45.0,
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


def classify(obj: bpy.types.Object) -> str:
    n = obj.name
    if n.startswith('molding:'):
        return 'wall'  # 石膏线用墙面材质（同色）
    if n.startswith('swatch:'):
        return 'skip'  # 候选色板自带专用色（add_swatches 生成），禁被 classify 刷色
    if n.startswith('asset:'):
        return 'skip'  # 导入家具资产保留自带材质（fixture-assets.yaml 接线，见 french-cream spec）
    if n.startswith('furniture:'):
        return 'furniture'
    # 家具组的子 mesh 未命名 → 沿父节点链找前缀
    parent = obj.parent
    while parent is not None:
        pn = parent.name
        if pn.startswith('furniture:'):
            return 'furniture'
        parent = parent.parent
    if n.endswith(':sheer'):
        return 'sheer'
    if n.endswith(':blackout') or n.endswith(':blinds'):
        return 'curtain_fabric'
    if n in GLASS_IDS or n.startswith('sliding_door') or 'glass_infill' in n:
        return 'glass'
    if n.startswith('floor:') or n.endswith('_floor'):
        return 'floor'
    if n.startswith('ceiling') or n.startswith('cz:'):
        return 'ceiling'
    if n.startswith('wall:') or n.startswith('wall_') or ':frame:' in n or n.startswith('wall_seg'):
        return 'wall'
    if '_bay' in n:
        return 'sill'
    if 'rail' in n:
        return 'railing'
    if n.startswith('d_') or n == 'door':
        return 'door'
    return 'default'


def build_materials(engine: str, sheer_opacity: float = 0.15) -> dict:
    is_cycles = engine.upper() == 'CYCLES'
    # EEVEE 默认无屏幕空间折射，transmission 渲成不透明 → 预览用 alpha 玻璃；Cycles 用真透射
    # LowE 玻璃：真透射 + 蓝绿微调 + 低辐射涂层 coat（Cycles）；EEVEE 预览用 alpha
    glass = (
        new_principled('硬装_LowE玻璃', hex_rgb('#c8e0dc'), rough=0.02, transmission=1.0, ior=1.5, coat=0.3)
        if is_cycles
        else new_principled('硬装_LowE玻璃', hex_rgb('#c8e0dc'), rough=0.05, alpha=0.25)
    )
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
        'glass': glass,
        'sheer': sheer,
        'curtain_fabric': new_principled('软装_遮光帘', hex_rgb('#d8d0c2'), rough=0.95),
        'furniture': new_principled('家具_暖灰', hex_rgb('#cbbfa9'), rough=0.8),
        'sill': new_principled('硬装_窗台石', hex_rgb('#d8d3c8'), rough=0.5),
        'railing': new_principled('硬装_栏杆', hex_rgb('#3a3d40'), rough=0.4, metallic=0.8),
        'door': new_principled('硬装_木门', hex_rgb('#8a6f52'), rough=0.6),
        'default': new_principled('默认_中性灰', hex_rgb('#bfbfbf'), rough=0.85),
    }


def assign_materials(mats: dict) -> dict:
    stats: dict[str, int] = {}
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        key = classify(obj)
        if key == 'skip':
            continue
        mat = mats[key]
        if obj.data.materials:
            for i in range(len(obj.data.materials)):
                obj.data.materials[i] = mat
        else:
            obj.data.materials.append(mat)
        stats[key] = stats.get(key, 0) + 1
    return stats


def to_blender(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def add_lights(cfg: dict, temp_override: float | None = None) -> int:
    count = 0
    for lp in cfg['lights']:
        energy = LIGHT_ENERGY.get(lp['type'], 15.0)
        # temp_override：材质评审工况用 6500K 中性白，避免 3000K 暖光污染色号判断
        color = kelvin_to_rgb(temp_override if temp_override is not None else lp.get('temp', 3000))
        if lp['type'] == 'led_strip':
            data = bpy.data.lights.new(lp['id'], type='AREA')
            data.shape = 'RECTANGLE'
            data.size = 2.4
            data.size_y = 0.1
        else:
            data = bpy.data.lights.new(lp['id'], type='POINT')
            data.shadow_soft_size = 0.05 if lp['type'] == 'downlight' else 0.15
        data.energy = energy
        data.color = color
        obj = bpy.data.objects.new(lp['id'], data)
        obj.location = to_blender(lp['x'], lp['height'], lp['z'])
        bpy.context.collection.objects.link(obj)
        count += 1
    return count


def add_light_fixtures(cfg: dict, temp_override: float | None = None) -> int:
    """实体灯具：吸顶盘/筒灯圈/吊灯(线+罩)/壁灯，灯罩自发光。光仍由 add_lights 的不可见光源提供。"""
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
    count = 0
    for lp in cfg['lights']:
        t = lp['type']
        x, z = lp.get('x'), lp.get('z')
        h = lp.get('height', 2.8)
        if x is None or z is None:
            continue
        if t == 'dome':
            bpy.ops.mesh.primitive_cylinder_add(radius=0.18, depth=0.06, location=to_blender(x, h - 0.03, z))
            o = bpy.context.object
            o.name = f'fixture:dome:{lp["id"]}'
            o.data.materials.append(diff_m)
            count += 1
        elif t == 'downlight':
            bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.02, location=to_blender(x, h - 0.01, z))
            o = bpy.context.object
            o.name = f'fixture:down:{lp["id"]}'
            o.data.materials.append(diff_m)
            count += 1
        elif t == 'pendant':
            hang = 1.7
            bpy.ops.mesh.primitive_cylinder_add(radius=0.006, depth=(h - hang), location=to_blender(x, (h + hang) / 2, z))
            bpy.context.object.name = f'fixture:pendant_cord:{lp["id"]}'
            bpy.ops.mesh.primitive_cone_add(radius1=0.16, radius2=0.05, depth=0.18, location=to_blender(x, hang, z))
            s = bpy.context.object
            s.name = f'fixture:pendant_shade:{lp["id"]}'
            s.data.materials.append(diff_m)
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
            o.data.materials.append(diff_m)
            count += 1
    if count:
        print(f'[dress_scene] light fixtures: {count}')
    return count


def add_sun(sun_dir: list[float]) -> None:
    """sun_dir: 指向太阳方向的单位向量（Blender 坐标 +X 东/+Y 北/+Z 上）。
    场景常量由 gen-render-config.ts 预计算；光线方向 = 太阳方向反向。"""
    from mathutils import Vector
    direction = Vector(sun_dir).normalized()
    data = bpy.data.lights.new('Sun', type='SUN')
    data.energy = 1.2
    data.color = kelvin_to_rgb(3200)  # 傍晚低太阳偏暖
    obj = bpy.data.objects.new('Sun', data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    bpy.context.collection.objects.link(obj)


def setup_world(engine: str, scenario: dict, config_dir: str | None = None) -> None:
    world = bpy.data.worlds.new('World') if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = _find_node(world.node_tree, 'ShaderNodeBackground')
    if bg is None:
        bg = world.node_tree.nodes.new('ShaderNodeBackground')
        out = _find_node(world.node_tree, 'ShaderNodeOutputWorld') or world.node_tree.nodes.new('ShaderNodeOutputWorld')
        world.node_tree.links.new(bg.outputs['Background'], out.inputs['Surface'])
    if engine.upper() == 'CYCLES':
        hdri = scenario.get('world_hdri')
        if hdri and config_dir:
            # HDRi 外景 + Light Path 分离：相机光线（透玻璃所见）用 HDRi 真外景；
            # 其余光线（环境照明）用可控纯色 world_color —— 房间不被 HDRi 颜色污染
            import os
            path = os.path.normpath(os.path.join(config_dir, hdri))
            env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
            env.image = bpy.data.images.load(path)
            lp = world.node_tree.nodes.new('ShaderNodeLightPath')
            # 外景可见性 = 相机光线 + 透射光线（透玻璃所见）+ 单次反射光线（玻璃/地面反射外景）
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


def add_sky_planes() -> None:
    """在每块外墙玻璃的室内侧前方放一块发光'天空'平面，模拟透过玻璃见蓝天。
    EEVEE 下世界光会染色天花板，故蓝天不作为环境光；
    plane 放在玻璃前（不透明、先渲染），避免多层透明排序遮挡。
    Cycles 下由真天光负责，该函数跳过。"""
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

    center = Vector((8.0, 3.5, 1.4))  # 户内大致中心，用于判断室内侧
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
        # 室内侧 = 靠近 center 的一侧
        if axis == 0:
            loc.x = mins.x + off if mins.x < center.x else maxs.x - off
        elif axis == 1:
            loc.y = mins.y + off if mins.y < center.y else maxs.y - off
        else:
            loc.z = maxs.z + off

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
            p.rotation_euler = (0, 0, 0)         # 水平
        p.scale = (max(size.y if axis != 1 else size.x, 0.2),
                   max(size.z, 0.2),
                   1.0)
        p.data.materials.append(mat)
        print(f'[dress_scene] sky plane for {obj.name} at {tuple(round(v,2) for v in loc)}')


def add_camera(cam_cfg: dict) -> None:
    from mathutils import Vector
    data = bpy.data.cameras.new(cam_cfg['id'])
    data.lens = cam_cfg.get('lens', 28)  # 缺省人眼等效；特写机位可配 35
    obj = bpy.data.objects.new(cam_cfg['id'], data)
    loc = Vector(to_blender(*cam_cfg['position']))
    target = Vector(to_blender(*cam_cfg['target']))
    obj.location = loc
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (target - loc).to_track_quat('-Z', 'Y')
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj


def add_swatches(scenario: dict) -> int:
    """候选色实体色板（材质评审工况）：Principled 纯色 rough 0.9 受场景光渲染，
    与被评材质同光同镜头同 tone transform → 眼睛直接比，禁用 emission。
    mode=floor 平放贴地（防 z-fighting y=0.002）；mode=vertical 立面（法线 +x 东，用于西墙前景）。
    坐标 three.js 系经 to_blender 转换。"""
    count = 0
    for i, sw in enumerate(scenario.get('swatches') or []):
        mat = new_principled(f'swatch_{i:02d}', hex_rgb(sw['hex']), rough=0.9)
        size = sw.get('size', 0.35)
        if sw.get('mode') == 'vertical':
            loc = to_blender(sw['x'], 1.3, sw['z'])
            rot = (0.0, math.pi / 2, 0.0)
        else:
            loc = to_blender(sw['x'], 0.002, sw['z'])
            rot = (0.0, 0.0, 0.0)
        bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
        p = bpy.context.object
        p.name = f'swatch:{sw.get("mode", "floor")}:{i:02d}'
        p.data.materials.append(mat)
        count += 1
    return count


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
        ('body', [1.8, 0.4, 0.4], [0, 0.2, 0], 'wood'),
        ('top', [1.8, 0.02, 0.42], [0, 0.41, 0], 'wood_dark'),
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
        ('cooktop', [0.75, 0.02, 0.45], [0, 0.86, 0], 'black_glass'),
        ('burner1', [0.16, 0.01, 0.16], [-0.18, 0.875, 0], 'metal'),
        ('burner2', [0.16, 0.01, 0.16], [0.18, 0.875, 0], 'metal'),
    ],
    'range_hood': [
        ('panel', [0.8, 0.5, 0.06], [0, 1.5, 0.12], 'metal'),
        ('duct', [0.4, 0.9, 0.35], [0, 2.2, 0], 'metal'),
    ],
    'sink': [
        ('rim', [0.74, 0.01, 0.44], [0, 0.86, 0], 'metal'),
        ('faucet_v', [0.03, 0.3, 0.03], [0, 1.0, -0.18], 'metal'),
        ('faucet_h', [0.03, 0.03, 0.2], [0, 1.14, -0.1], 'metal'),
    ],
}


def build_furniture_materials(hex_rgb_fn, new_principled_fn) -> dict:
    """法式奶油风家具材质：羊羔绒/亚麻/白漆木/浅木。"""
    mats = {}
    # 羊羔绒沙发面料（奶油色 + 细微织物纹理 bump）
    for name, color, rough in [
        ('fabric', '#d4cdb8', 0.9),       # 沙发主体（奶油灰）
        ('fabric_light', '#e8e0d2', 0.85), # 坐垫/靠垫（浅奶油）
        ('fabric_white', '#f5f0e6', 0.85), # 床品（白奶油）
        ('wood', '#c9a87e', 0.5),          # 浅橡木家具
        ('wood_dark', '#6b5d4a', 0.5),     # 深木腿/框架
        ('paint_cream', '#f2ede2', 0.4),   # 奶油白漆柜门/柜体
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
                    bump.inputs['Strength'].default_value = 0.12
                    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
                    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
            except Exception:
                pass
        mats[name] = mat
    mats['metal'] = new_principled_fn('家具_metal', hex_rgb_fn('#c8ccd0'), rough=0.35, metallic=1.0)
    mats['black_glass'] = new_principled_fn('家具_black_glass', hex_rgb_fn('#1a1a1c'), rough=0.15)
    mats['quartz'] = new_principled_fn('家具_quartz', hex_rgb_fn('#e8e6e0'), rough=0.25)
    mats['ceramic'] = new_principled_fn('家具_ceramic', hex_rgb_fn('#f8f8f6'), rough=0.1)
    return mats


def add_pbr_maps(mat, tex_dir, size=2.0, with_diffuse=False, normal_strength=0.5):
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
        if not os.path.exists(p):
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
            nt.links.new(dm.outputs['Color'], bsdf.inputs['Base Color'])
    return True


FURNITURE_GLB = {
    'sofa_3seat': 'assets/sofa_set.glb',
    'bed_180': 'assets/bed_soft_modern.glb',
    'bed_150': 'assets/bed_soft_modern.glb',
}


def import_furniture_glb(glb_path: str, target_width: float, block, rot_fix: float = 0) -> int:
    """导入 .glb 家具模型，归一化到 target_width，放到 block 位置。
    步骤：导入→合并→设原点→缩放→贴地→定位→旋转。"""
    import math
    import mathutils

    existing = set(obj.name for obj in bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    new_objs = [obj for obj in bpy.data.objects if obj.name not in existing and obj.type == 'MESH']
    if not new_objs:
        print(f'[dress_scene] WARN glb 导入无 mesh: {glb_path}')
        return 0

    bpy.ops.object.select_all(action='DESELECT')
    for obj in new_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = new_objs[0]

    if len(new_objs) > 1:
        bpy.ops.object.join()

    obj = bpy.context.active_object
    obj.name = f'asset:{block.name.split(":")[2] if ":" in block.name else "imported"}:glb'

    # 原点设到几何中心
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

    # 计算包围盒 → 缩放
    bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    model_width = max(c.x for c in bb) - min(c.x for c in bb)
    scale = target_width / model_width if model_width > 0.01 else 1.0
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # 定位 + 旋转（继承 block 的世界变换）
    mw = block.matrix_world
    obj.location.x = mw.translation.x
    obj.location.y = mw.translation.y
    obj.rotation_euler = mw.to_euler()
    obj.rotation_euler.z += math.radians(rot_fix)
    bpy.context.view_layer.update()
    # 旋转后重新算世界包围盒 → 贴地（保证旋转不抬升）
    bb2 = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    min_z = min(c.z for c in bb2)
    obj.location.z -= min_z

    # 材质豁免：asset: 前缀 → classify 返回 skip
    return 1


def replace_furniture(furniture_mats: dict, config_dir: str = '') -> int:
    """用精细几何替换色块家具：找到 furniture:* 组 → 隐藏 → 原位生成多部件几何。
    parts 格式: (name, three_size[x,y,z], three_pos[x,y,z], material_key)。
    坐标转换：three(x,y,z) → Blender(x,-z,y)，尺寸(x,z,y)。"""
    import math
    count = 0
    for obj in list(bpy.data.objects):
        name = obj.name
        if not name.startswith('furniture:'):
            continue
        parts = name.split(':')
        if len(parts) < 3:
            continue
        ftype = parts[2]
        if ftype not in FURNITURE_PARTS:
            continue
        # 隐藏色块组 + 子 mesh
        obj.hide_render = True
        for child in obj.children_recursive:
            child.hide_render = True
        # 优先用真 3D 模型（.glb）
        glb_rel = FURNITURE_GLB.get(ftype)
        if glb_rel and config_dir:
            glb_path = os.path.join(config_dir, glb_rel)
            if os.path.exists(glb_path):
                tw = {'sofa_3seat': 2.8, 'bed_180': 1.8, 'bed_150': 1.5,
                      'dining_table': 1.4, 'dining_chair': 0.45, 'tv_stand': 1.8}.get(ftype, 1.0)
                if import_furniture_glb(glb_path, tw, obj,
                                         rot_fix={'bed_180': 180, 'bed_150': 180}.get(ftype, 0)):
                    count += 1
                    continue
        # 读取世界坐标 + 旋转
        mw = obj.matrix_world
        loc = mw.translation
        euler = mw.to_euler()
        rz = euler.z
        cos_rz = math.cos(rz)
        sin_rz = math.sin(rz)
        # 生成部件
        for pname, tsize, tpos, mat_key in FURNITURE_PARTS[ftype]:
            # three local → Blender local
            lx, ly, lz = tpos[0], -tpos[2], tpos[1]
            # 绕 Z 旋转
            wx = loc.x + lx * cos_rz - ly * sin_rz
            wy = loc.y + lx * sin_rz + ly * cos_rz
            wz = loc.z + lz
            # Blender dimensions: three(x,y,z) → Blender(x,z,y)
            dx, dy, dz = tsize[0], tsize[2], tsize[1]
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            part = bpy.context.object
            part.name = f'asset:{ftype}:{pname}'
            part.dimensions = (dx, dy, dz)
            part.location = (wx, wy, wz)
            part.rotation_euler = (0, 0, rz)
            mat = furniture_mats.get(mat_key)
            if mat:
                part.data.materials.append(mat)
            # 倒角（消除 CG 直角感）+ 软件件细分平滑
            bevel = part.modifiers.new('Bevel', 'BEVEL')
            is_soft = any(k in pname for k in ('cushion', 'pillow', 'mattress', 'duvet'))
            bevel.width = 0.04 if is_soft else 0.015  # 软件 4cm 圆角，硬件 1.5cm
            bevel.segments = 4
            bevel.limit_method = 'ANGLE'
            bevel.angle_limit = 0.523599  # 30°
            if is_soft:
                subsurf = part.modifiers.new('Subsurf', 'SUBSURF')
                subsurf.levels = 2
                subsurf.render_levels = 2
                for poly in part.data.polygons:
                    poly.use_smooth = True
            count += 1
    if count:
        print(f'[dress_scene] furniture replaced: {count} parts')
    return count


def add_ceiling(config_dir: str, ceiling_mats: dict) -> int:
    """吊顶：读 ceiling.yaml，type=drop 的生成局部吊顶板（底面在 2.8-thickness）。"""
    import os
    import yaml as pyyaml
    path = os.path.join(config_dir, 'config', 'ceiling.yaml')
    if not os.path.exists(path):
        return 0
    with open(path, 'r', encoding='utf-8') as f:
        items = pyyaml.safe_load(f) or []
    count = 0
    for it in items:
        if it.get('type') != 'drop':
            continue
        area = it.get('area')
        if not area or len(area) < 4:
            continue
        x1, z1, x2, z2 = area
        thick = it.get('thickness', 0.3)
        w, d = x2 - x1, z2 - z1
        cx, cz = (x1 + x2) / 2, (z1 + z2) / 2
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        box = bpy.context.object
        box.name = f'ceiling:{it.get("id")}'
        box.dimensions = (w, d, thick)
        box.location = to_blender(cx, 2.8 - thick / 2, cz)
        mat = ceiling_mats.get('ceiling')
        if mat:
            box.data.materials.append(mat)
        count += 1
    if count:
        print(f'[dress_scene] ceiling drops: {count}')
    return count


def add_kitchen_cabinets(furniture_mats: dict) -> int:
    """厨房 L 型橱柜：北墙3.6水槽切配 + 东墙灶台（DEC-014），冰箱位(z>1.7)留空。
    厨房界 x[7.2,10.8] z[0,2.4]；Blender dims=(sx, sz, sy_height)。"""
    cream = furniture_mats.get('paint_cream')
    quartz = furniture_mats.get('quartz')

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

    n = 0
    n += kbox('kitchen:base_n', 9.0, 0.3, 3.6, 0.6, 0.85, 0.425, cream)
    n += kbox('kitchen:base_e', 10.5, 1.15, 0.6, 1.1, 0.85, 0.425, cream)
    n += kbox('kitchen:top_n', 9.0, 0.3, 3.6, 0.62, 0.03, 0.865, quartz)
    n += kbox('kitchen:top_e', 10.5, 1.15, 0.62, 1.1, 0.03, 0.865, quartz)
    n += kbox('kitchen:wall_n', 8.4, 0.18, 2.0, 0.35, 0.7, 1.85, cream)
    print(f'[dress_scene] kitchen cabinets: {n}')
    return n


def add_soft_decor(furniture_mats: dict) -> int:
    """软装点缀：客厅地毯+西墙挂画，提升真实感（决策渲染够用）。"""
    count = 0
    # 客厅地毯（沙发前）
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    rug = bpy.context.object
    rug.name = 'asset:rug:living'
    rug.dimensions = (2.2, 1.6, 0.03)
    rug.location = to_blender(10.2, 0.015, 7.0)
    bev = rug.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.01
    bev.segments = 2
    rug.data.materials.append(furniture_mats.get('fabric_light'))
    count += 1
    # 西墙挂画 x2
    for i, z in enumerate((6.4, 7.6)):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        frame = bpy.context.object
        frame.name = f'asset:art:{i}'
        frame.dimensions = (0.03, 0.6, 0.8)
        frame.location = to_blender(7.23, 1.5, z)
        frame.data.materials.append(furniture_mats.get('wood_dark'))
        count += 1
    if count:
        print(f'[dress_scene] soft decor: {count} (rug+art)')
    return count


def add_moldings(config_dir: str) -> int:
    """法式石膏线：从 model-geometry.yaml 读墙段坐标 + overlay.yaml suppress 列表，
    生成踢脚线(8cm) + 顶角线(10cm) + 挂镜线(2cm@1m)。仅实体墙（suppressed 跳过）。"""
    import yaml as pyyaml
    import math

    geo_path = os.path.join(config_dir, 'config', 'layout', 'model-geometry.yaml')
    overlay_path = os.path.join(config_dir, 'config', 'layout', 'overlay.yaml')
    if not os.path.exists(geo_path):
        return 0
    with open(geo_path, 'r', encoding='utf-8') as f:
        geo = pyyaml.safe_load(f)
    suppressed = set()
    if os.path.exists(overlay_path):
        with open(overlay_path, 'r', encoding='utf-8') as f:
            ov = pyyaml.safe_load(f)
        for s in ov.get('suppress', []):
            for w in (s.get('walls') or ([s['wall']] if s.get('wall') else [])):
                suppressed.add(w)
    verts = {v['id']: (v['x'], v['z']) for v in geo.get('vertices', [])}
    walls = geo.get('walls', [])
    cx, cz = 8.0, 6.0  # 房屋大致中心，判断室内侧
    MOLDINGS = [
        ('baseboard', 0.08, 0.0),
        ('crown', 0.10, 2.70),
        ('picture_rail', 0.02, 1.00),
    ]
    THICK = 0.025
    OFFSET = 0.07  # 墙厚/2 + 间隙
    count = 0
    for wall in walls:
        if wall['id'] in suppressed:
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
        for name, mh, base_y in MOLDINGS:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            box = bpy.context.object
            box.name = f'molding:{name}:{wall["id"]}'
            box.dimensions = (length, THICK, mh)
            box.location = to_blender(ox, base_y + mh / 2, oz)
            box.rotation_euler = (0, 0, angle)
            count += 1
    print(f'[dress_scene] moldings: {count} (baseboard+crown+picture_rail × {len(walls)} walls)')
    return count


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


def render_scene(args: dict, cfg: dict, cam_cfg: dict, scenario: dict, out_path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args['glb'])
    # 遮光帘状态配置驱动：blackout_state=open → 隐藏（视同拉开到两侧）；
    # 全宽不透明布若渲染会挡死玻璃，窗外天色完全看不见（决策渲染必须可见窗外）
    if scenario.get('blackout_state', 'open') == 'open':
        for o in bpy.data.objects:
            if o.name.endswith(':blackout'):
                o.hide_render = True
    scene = bpy.context.scene
    used_engine = set_engine(scene, args['engine'], samples=int(args.get('samples', 256)))
    sheer_opacity = scenario.get('sheer_opacity', 0.15)
    mats = build_materials(used_engine, sheer_opacity=sheer_opacity)
    from materials_from_yaml import load_scheme_materials
    if args.get('config-dir'):
        mats = load_scheme_materials(used_engine, mats, new_principled, hex_rgb,
                                     config_dir=args['config-dir'])
    else:
        print('[dress_scene] WARN: --config-dir 未传，跳过 materials.yaml 材质（使用基础材质）')
    stats = assign_materials(mats)
    furniture_mats = build_furniture_materials(hex_rgb, new_principled)
    tex_base = os.path.join(args.get('config-dir') or '', 'assets', 'textures')
    add_pbr_maps(mats.get('wall'), os.path.join(tex_base, 'painted_plaster_wall'),
                 size=2.5, with_diffuse=False, normal_strength=0.3)
    add_pbr_maps(furniture_mats.get('quartz'), os.path.join(tex_base, 'marble_01'),
                 size=3.0, with_diffuse=False, normal_strength=0.4)
    replace_furniture(furniture_mats, config_dir=args.get('config-dir') or '')
    add_moldings(args.get('config-dir') or '')
    add_ceiling(args.get('config-dir') or '', mats)
    add_kitchen_cabinets(furniture_mats)
    add_soft_decor(furniture_mats)
    swatch_count = add_swatches(scenario)
    # 补光可来自 scenario 或 camera（卧室灯少需补，客厅不需要）
    fill = scenario.get('fill_light') or cam_cfg.get('fill_light')
    if fill:
        fl = bpy.data.lights.new('fill_light', type='AREA')
        fl.shape = 'RECTANGLE'
        fl.size = 5.0
        fl.size_y = 5.0
        # fill_light 可为数字（瓦数）或 true（默认200）；特写用低瓦防过曝，全景用高瓦
        fl.energy = float(fill) if isinstance(fill, (int, float)) else 200.0
        fl.color = kelvin_to_rgb(scenario.get('light_temp', 6500))
        tgt = cam_cfg.get('target', [0, 0, 0])
        fl_obj = bpy.data.objects.new('fill_light', fl)
        fl_obj.location = to_blender(tgt[0], 2.5, tgt[2])
        bpy.context.collection.objects.link(fl_obj)
    if scenario.get('lights_on', True):
        add_lights(cfg, temp_override=scenario.get('light_temp'))
        add_light_fixtures(cfg, temp_override=scenario.get('light_temp'))
    sun_dir = scenario.get('sun_direction')
    if sun_dir:
        add_sun(sun_dir)
    setup_world(used_engine, scenario, config_dir=args.get('config-dir'))
    add_camera(cam_cfg)
    if used_engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        add_sky_planes()

    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = int(args.get('res', 100))
    scene.render.filepath = out_path
    # tone transform 配置驱动：氛围图 AgX（电影感）；材质评审 Standard（无调色，色号不失真）
    scene.view_settings.view_transform = scenario.get('view_transform', 'AgX')
    try:
        # 曝光配置驱动（scenario.exposure），缺省：Cycles 0.5 / EEVEE 0.6
        default_exposure = 0.5 if used_engine == 'CYCLES' else 0.6
        scene.view_settings.exposure = scenario.get('exposure', default_exposure)
    except Exception:
        pass
    try:
        scene.render.image_settings.file_format = 'PNG'
    except Exception:
        pass

    print(f'[dress_scene] {out_path} engine={used_engine} view_transform={scene.view_settings.view_transform} '
          f'swatches={swatch_count} materials={json.dumps(stats, ensure_ascii=False)}')
    bpy.ops.render.render(write_still=True)


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
    for job in jobs:
        cam_cfg = next(c for c in cfg['cameras'] if c['id'] == job['camera_id'])
        out_path = os.path.join(out_dir, job['out_name'] + '.png')
        render_scene(args, cfg, cam_cfg, job['scenario'], out_path)


main()
