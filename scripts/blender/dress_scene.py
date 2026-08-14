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
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = opacity
    nt.links.new(trans.outputs[0], mix.inputs[1])
    nt.links.new(bsdf.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes.get('Material Output').inputs['Surface'])
    return mat


def new_principled(name: str, color, rough: float, metallic: float = 0.0,
                   transmission: float = 0.0, ior: float = 1.5, alpha: float = 1.0,
                   coat: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
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
    glass = (
        new_principled('硬装_LowE玻璃', hex_rgb('#dce8e6'), rough=0.05, transmission=1.0, ior=1.5)
        if is_cycles
        else new_principled('硬装_LowE玻璃', hex_rgb('#dce8e6'), rough=0.08, alpha=0.25)
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


def add_lights(cfg: dict) -> int:
    count = 0
    for lp in cfg['lights']:
        energy = LIGHT_ENERGY.get(lp['type'], 15.0)
        color = kelvin_to_rgb(lp.get('temp', 3000))
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
    bg = world.node_tree.nodes.get('Background')
    if engine.upper() == 'CYCLES':
        hdri = scenario.get('world_hdri')
        if hdri and config_dir:
            # HDRi 外景 + Light Path 分离：相机光线（透玻璃所见）用 HDRi 真外景；
            # 其余光线（环境照明）用可控纯色 world_color —— 房间不被 HDRi 颜色污染
            import os
            path = os.path.join(config_dir, hdri)
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
    e = mat.node_tree.nodes.get('Principled BSDF')
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
    data.lens = 28  # 人眼等效焦距，避免广角显大（决策渲染规范）
    obj = bpy.data.objects.new(cam_cfg['id'], data)
    loc = Vector(to_blender(*cam_cfg['position']))
    target = Vector(to_blender(*cam_cfg['target']))
    obj.location = loc
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (target - loc).to_track_quat('-Z', 'Y')
    bpy.context.collection.objects.link(obj)
    bpy.context.scene.camera = obj


def set_engine(scene, engine: str) -> str:
    if engine.upper() == 'CYCLES':
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 256
        try:
            scene.cycles.use_denoising = True
        except Exception:
            pass
        try:
            scene.cycles.seed = 42  # 固定 seed，保证 A/B 同配置两次渲染一致
        except Exception:
            pass
        # 优先启用 GPU compute（HIP/OptiX），失败回退 CPU
        try:
            cprefs = bpy.context.preferences.addons['cycles'].preferences
            for backend in ('HIP', 'OPTIX', 'CUDA'):
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
    used_engine = set_engine(scene, args['engine'])
    sheer_opacity = scenario.get('sheer_opacity', 0.15)
    mats = build_materials(used_engine, sheer_opacity=sheer_opacity)
    from materials_from_yaml import load_scheme_materials
    if args.get('config-dir'):
        mats = load_scheme_materials(used_engine, mats, new_principled, hex_rgb,
                                     config_dir=args['config-dir'])
    else:
        print('[dress_scene] WARN: --config-dir 未传，跳过 materials.yaml 材质（使用基础材质）')
    stats = assign_materials(mats)
    if scenario.get('lights_on', True):
        add_lights(cfg)
    sun_dir = scenario.get('sun_direction')
    if sun_dir:
        add_sun(sun_dir)
    setup_world(used_engine, scenario, config_dir=args.get('config-dir'))
    add_camera(cam_cfg)
    if used_engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        add_sky_planes()

    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.filepath = out_path
    scene.view_settings.view_transform = 'AgX'
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

    print(f'[dress_scene] {out_path} engine={used_engine} materials={json.dumps(stats, ensure_ascii=False)}')
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
    print(f'[dress_scene] {len(jobs)} jobs (cameras×scenarios)')
    os.makedirs(out_dir, exist_ok=True)
    for job in jobs:
        cam_cfg = next(c for c in cfg['cameras'] if c['id'] == job['camera_id'])
        out_path = os.path.join(out_dir, job['out_name'] + '.png')
        render_scene(args, cfg, cam_cfg, job['scenario'], out_path)


main()
