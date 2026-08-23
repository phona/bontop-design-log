"""
dress_scene.py — Blender 自动定妆管线 v2（批量 A/B 决策）
用法（WSL 调 Windows Blender）：
  "/mnt/e/Blender Foundation/Blender 5.2/blender.exe" --background --python scripts/blender/dress_scene.py -- \
    --glb "C:\\...\\house.glb" --config "C:\\...\\render-config.json" --engine EEVEE \
    --out-dir "C:\\...\\renders" --version v1 --config-dir "\\\\wsl.localhost\\Ubuntu\\home\\tao\\projects\\bontop-design-log"

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

# 确保同目录的 dress_config / materials_from_yaml 可导入（Blender --python 不自动加脚本目录）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

GLASS_IDS = {
    'west_curtain', 'kitchen_north_curtain', 'north_recess_curtain',
    'living_south_curtain', 'south_east_curtain',
}

# 厨卫/阳台墙面贴砖：GLB 墙段命名 wall:seg:N:room=r1|r2（export-gltf exportName，
# 房间归属来自 model-geometry 墙→房间拓扑），命中湿区即挂 mats['wall_tile']
WET_ROOM_IDS = {'kitchen', 'master_bath', 'guest_bath', 'balcony'}
_WALL_SEG_ROOM_RE = re.compile(r'^wall:seg:\d+:room=([a-z0-9_|]+)')


def _wall_seg_rooms(name: str) -> set:
    """解析墙段导出名的房间归属（容差 Blender 重名 .NNN 后缀：正则只吃到 | 与字母数字）。"""
    m = _WALL_SEG_ROOM_RE.match(name)
    if not m:
        return set()
    return {r for r in m.group(1).split('|') if r}

LIGHT_ENERGY = {  # 瓦（Cycles/EEVEE 通用，先求氛围对再校绝对亮度）
    'pendant': 110.0,
    'dome': 55.0,
    'downlight': 22.0,
    'wall_lamp': 18.0,
    'led_strip': 25.0,
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
    trans = nt.nodes.new('ShaderNodeBsdfTransparent')
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMixShader')
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
        mat = mats.get(key)
        if mat is None:
            # wall_tile 仅在 scheme 选了墙砖时生成；否则湿区墙段回退乳胶漆
            mat = mats['wall'] if key == 'wall_tile' else mats['default']
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
            data.shadow_soft_size = 0.25 if lp['type'] == 'downlight' else 0.15
        data.energy = energy
        data.color = color
        obj = bpy.data.objects.new(lp['id'], data)
        # led_strip 贴墙放会打出眩光斑 → 离墙 0.15m 且朝向房间（本项目仅西墙灯带，法线 +x 朝东）
        off = 0.15 if lp['type'] == 'led_strip' else 0.0
        # dome 高度=净高（2.8）时点光源正好嵌进天花网格被整体遮挡（书房北墙全黑确诊案例，
        # v24 降到 2.55 后房间恢复照明）→ dome 一律下沉 0.25m 到天花以下
        h = lp['height'] - 0.25 if lp['type'] == 'dome' else lp['height']
        obj.location = to_blender(lp['x'] + off, h, lp['z'])
        if lp['type'] == 'led_strip':
            import math as _m
            obj.rotation_euler = (0, -_m.radians(90), 0)
        bpy.context.collection.objects.link(obj)
        count += 1
    return count


def add_light_fixtures(cfg: dict, temp_override: float | None = None, emit: bool = True) -> int:
    """实体灯具：吸顶盘/筒灯圈/吊灯(线+罩)/壁灯。光仍由 add_lights 的不可见光源提供。
    emit=False（daylight 等关灯工况）时灯罩不自发光，仅保留形体——吊灯是风格锚点，白天也得看见。"""
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


def add_ceiling_finishing(furniture_mats: dict, emit: bool = True) -> int:
    """顶面完成度 staging（DEC-027 评估件）：客餐厅浅跌级边吊 + 灯槽 + 长条风口。
    仅渲染评估，不改 ceiling.yaml；设计审查通过后再落成配置。
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
    vent_m = new_principled('顶面_风口', hex_rgb('#2a2a2a'), rough=0.5, metallic=0.3)

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
        count += 1
    # 灯槽（跌级内侧顶上，南北两条，自发光朝上洗顶）
    for y in (-2.55, -9.65):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(10.3, y, 2.81))
        o = bpy.context.object
        o.name = 'asset:ceiling:cove'
        o.dimensions = (6.0, 0.05, 0.02)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(cove_m)
        count += 1
    # 长条风口（客厅，整合进跌级南侧）
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(10.3, -8.6, 2.79))
    o = bpy.context.object
    o.name = 'asset:ceiling:vent'
    o.dimensions = (2.4, 0.15, 0.02)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(vent_m)
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
            # world_hdri_lighting=true 时（白天工况）不做分离：真天空直接照明室内，
            # 南向大玻璃幕墙的天光漫射本来就是白天的主光源（蓝/黄染色在白天即真实）
            import os
            path = os.path.normpath(os.path.join(config_dir, hdri))
            env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
            env.image = bpy.data.images.load(path)
            if scenario.get('world_hdri_lighting'):
                cam_str = scenario.get('world_hdri_camera_strength')
                if cam_str is not None:
                    # 内外光比分控：照明用高强度 HDR，相机直看窗外用低强度
                    # （否则室内曝光正确时窗外必然过曝成白墙）
                    bg_cam = world.node_tree.nodes.new('ShaderNodeBackground')
                    world.node_tree.links.new(env.outputs['Color'], bg_cam.inputs['Color'])
                    bg_cam.inputs['Strength'].default_value = cam_str
                    lp2 = world.node_tree.nodes.new('ShaderNodeLightPath')
                    # 窗外可见性 = 相机光线 + 透射（透玻璃所见）+ 单次反射（地面/玻璃反射外景）
                    add1 = world.node_tree.nodes.new('ShaderNodeMath')
                    add1.operation = 'ADD'
                    world.node_tree.links.new(lp2.outputs['Is Camera Ray'], add1.inputs[0])
                    world.node_tree.links.new(lp2.outputs['Is Transmission Ray'], add1.inputs[1])
                    add2 = world.node_tree.nodes.new('ShaderNodeMath')
                    add2.operation = 'ADD'
                    world.node_tree.links.new(add1.outputs[0], add2.inputs[0])
                    world.node_tree.links.new(lp2.outputs['Is Singular Ray'], add2.inputs[1])
                    mix2 = world.node_tree.nodes.new('ShaderNodeMixShader')
                    out2 = _find_node(world.node_tree, 'ShaderNodeOutputWorld') or world.node_tree.nodes.new('ShaderNodeOutputWorld')
                    # Fac=0→输入1(照明强)、Fac=1→输入2(窗外可见弱)
                    world.node_tree.links.new(add2.outputs[0], mix2.inputs[0])
                    world.node_tree.links.new(bg.outputs['Background'], mix2.inputs[1])
                    world.node_tree.links.new(bg_cam.outputs['Background'], mix2.inputs[2])
                    world.node_tree.links.new(mix2.outputs[0], out2.inputs['Surface'])
                else:
                    world.node_tree.links.new(env.outputs['Color'], bg.inputs['Color'])
                bg.inputs['Strength'].default_value = scenario.get('world_strength', 1.0)
                return
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
    # 入户花园可移动换鞋站（成品鞋柜 + 自立洞洞板）
    'garden_entry_station': [
        ('shoe_body', [1.1, 0.78, 0.34], [0, 0.42, 0], 'wood'),
        ('shoe_top', [1.14, 0.04, 0.38], [0, 0.83, 0], 'wood_dark'),
        ('pegboard', [1.1, 1.05, 0.04], [0, 1.38, -0.15], 'metal_black'),
        ('stand_l', [0.05, 1.85, 0.05], [-0.5, 0.925, -0.15], 'metal_black'),
        ('stand_r', [0.05, 1.85, 0.05], [0.5, 0.925, -0.15], 'metal_black'),
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
    # 西墙 TV 区（z=6.90-9.00，悬空低柜 + 深胡桃背板）
    # 背板 z=+0.17：rotation 270° 下局部 +z 翻向世界 -x（贴墙侧）；
    # 原 -0.17 把背板翻到房间侧，把 tv_65 面板（z=0）整个挡住（v33 正视机位电视不可见）
    'tv_wall_low': [
        ('low', [2.1, 0.35, 0.4], [0, 0.325, 0], 'wood_dark'),
        ('back', [2.1, 1.6, 0.05], [0, 1.3, 0.08], 'wood_dark'),
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


FURNITURE_GLB = {
    # 中古胡桃方向（DEC-2026-08-20-025/026）：Poly Haven CC0，清单见 assets/SOURCES.md
    # width/height 为目标尺寸（米）：缩放系数取 width/模型宽 与 height/模型高 的较小者，
    # 防止模型长宽比与目标槽位不一致时拉飞高度（wooden_table_02 按宽缩会顶到 0.99m）
    # tint: 可选，对导入材质做乘色（如中色木桌压成深胡桃）
    # DEC-026：沙发/餐椅/茶几换 BlenderKit 现代中古款（Burrard 直排+细腿、
    # 藤编细腿餐椅、Noguchi 黑座玻璃圆几），弃 Chesterfield/高背拉扣/工业方几
    # 布纹底图 col_2（灰蓝）× #a36954 乘色 ≈ 目标深棕 #3a2e26（乘色反推）
    'sofa_3seat': {'path': 'assets/furniture/burrard_sofa/burrard_sofa.blend', 'width': 2.3, 'height': 0.8, 'tint': '#a36954', 'tint_mode': 'solid', 'fabric_tex': 'assets/textures/fabric_pattern_07', 'fabric_soften': 0.55},
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
    # 床 GLB（bed_soft_modern）暂不进管线：headless 下导入姿态不稳（baked 倾角+辅助 Cube，
    # 见 docs/renders/pipeline-acceptance.md v16 节），回退程序化床体；待 GUI Blender 定姿后再启用
}


def import_furniture_glb(glb_path: str, targets: dict, block=None, loc_rz=None, rot_fix: float = 0) -> int:
    """导入 .glb/.gltf 家具模型，归一化缩放后放置。
    targets: {'width': 米, 'height': 米, 'tint': '#hex'}（均可省），缩放取各约束的较小值；
    tint 时对每个导入材质的 Base Color 前插 MULTIPLY 节点（保纹理、压色调）。
    放置：block（继承其世界变换）或 loc_rz=((x,y,z), rz)（Blender 坐标，用于 place_extra_furniture）。
    步骤：导入→剥骨架→合并→设原点→缩放→tint→贴地→定位→旋转。"""
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

    # 原点设到几何中心
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')

    # 计算包围盒 → 缩放（宽/高约束取小，防长宽比失真）
    bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    model_w = max(c.x for c in bb) - min(c.x for c in bb)
    model_h = max(c.z for c in bb) - min(c.z for c in bb)
    scales = []
    if targets.get('width') and model_w > 0.01:
        scales.append(targets['width'] / model_w)
    if targets.get('height') and model_h > 0.01:
        scales.append(targets['height'] / model_h)
    scale = min(scales) if scales else 1.0
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


def replace_furniture(furniture_mats: dict, config_dir: str = '', only_types: set | None = None) -> int:
    """用精细几何替换色块家具：找到 furniture:* 组 → 隐藏 → 原位生成多部件几何。
    parts 格式: (name, three_size[x,y,z], three_pos[x,y,z], material_key)。
    坐标转换：three(x,y,z) → Blender(x,-z,y)，尺寸(x,z,y)。
    only_types：bare_shell 等工况的类型白名单（只重建定制柜等硬装件，其余保持隐藏）。"""
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
        if only_types is not None and ftype not in only_types:
            continue  # 调用方已隐藏（bare_shell），不再重建可移动件
        if ftype not in FURNITURE_PARTS:
            # 专用构建器覆盖的类型（add_kitchen_cabinets）：隐藏 glb 色块避免双重几何压色
            if ftype in ('kitchen_cabinet_run',):
                obj.hide_render = True
                for child in obj.children_recursive:
                    child.hide_render = True
            continue
        # 隐藏色块组 + 子 mesh
        obj.hide_render = True
        for child in obj.children_recursive:
            child.hide_render = True
        # 优先用真 3D 模型（.glb/.gltf）
        glb_cfg = FURNITURE_GLB.get(ftype)
        if glb_cfg and config_dir:
            glb_path = os.path.join(config_dir, glb_cfg['path'])
            if glb_cfg.get('fabric_tex'):
                glb_cfg = {**glb_cfg, 'fabric_tex': os.path.join(config_dir, glb_cfg['fabric_tex'])}
            if os.path.exists(glb_path):
                # 床 GLB 原生床头朝 +Y，与 block yaw 直接对齐，无需补正（旧 180 为悬案误值）
                if import_furniture_glb(glb_path, glb_cfg, block=obj, rot_fix=0):
                    count += 1
                    continue
        # 读取世界坐标 + 旋转
        mw = obj.matrix_world
        loc = mw.translation
        euler = mw.to_euler()
        rz = euler.z
        cos_rz = math.cos(rz)
        sin_rz = math.sin(rz)
        # 生成部件（part 第 5 元素可选 shape='cylinder'，如圆茶几面）
        for part in FURNITURE_PARTS[ftype]:
            pname, tsize, tpos, mat_key = part[:4]
            shape = part[4] if len(part) > 4 else 'box'
            # three local → Blender local
            lx, ly, lz = tpos[0], -tpos[2], tpos[1]
            # 绕 Z 旋转
            wx = loc.x + lx * cos_rz - ly * sin_rz
            wy = loc.y + lx * sin_rz + ly * cos_rz
            wz = loc.z + lz
            # Blender dimensions: three(x,y,z) → Blender(x,z,y)
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
        # 定制柜柜门分缝（400-500mm 标准门宽，正面假凹槽细缝）
        count += _add_cabinet_seams(ftype, (loc.x, loc.y, loc.z), rz, furniture_mats.get('door_gap'))
    if count:
        print(f'[dress_scene] furniture replaced: {count} parts')
    return count


def place_extra_furniture(furniture_mats: dict, config_dir: str, only_types: set | None = None) -> int:
    """house.yaml 已摆位但 glb 尚未重新导出的家具类型：直接按坐标生成部件。
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
            if it.get('x') is None or it.get('z') is None:
                continue
            rz = math.radians(it.get('rotation', 0))
            cos_rz, sin_rz = math.cos(rz), math.sin(rz)
            bx, by = it['x'], -it['z']  # three → blender 水平面
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


def add_sheer_panels(config_dir: str, mats: dict) -> int:
    """纱帘"拉上"staging：overlay 的 curtain_run closed=false 表示拉开（glb 里玻璃幕是裸的），
    居家感渲染需要拉上的纱帘 → 沿指定幕墙生成纱帘薄板（室内侧偏 0.08m）。
    只处理客厅南墙（主视角覆盖面），墙线段读 model-geometry（唯一权威源）。"""
    import math
    import yaml
    if not config_dir:
        return 0
    geo_path = os.path.join(config_dir, 'config', 'layout', 'model-geometry.yaml')
    if not os.path.exists(geo_path):
        return 0
    geo = yaml.safe_load(open(geo_path, encoding='utf-8'))
    mat = mats.get('sheer')
    if mat is None:
        return 0
    V = {v['id']: (v['x'], v['z']) for v in geo.get('vertices', [])}
    # (wall_id, 室内侧偏移方向 three(dx,dz))；南墙 w_liv_south 室内在北侧 → (0,-0.08)
    panels = [('w_liv_south', (0.0, -0.08))]
    count = 0
    for wid, (ox, oz) in panels:
        wall = next((w for w in geo.get('walls', []) if w.get('id') == wid), None)
        if not wall:
            continue
        x1, z1 = V[wall['from']]
        x2, z2 = V[wall['to']]
        length = math.hypot(x2 - x1, z2 - z1)
        cx, cz = (x1 + x2) / 2 + ox, (z1 + z2) / 2 + oz
        angle_b = math.atan2(-(z2 - z1), x2 - x1)  # three→blender 水平面方向角
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        o = bpy.context.object
        o.name = f'asset:sheer:{wid}'
        o.dimensions = (length, 0.02, 2.8)  # blender: x长 y厚 z高
        o.location = to_blender(cx, 1.4, cz)
        o.rotation_euler = (0, 0, angle_b)
        o.data.materials.append(mat)
        count += 1
    if count:
        print(f'[dress_scene] sheer panels: {count}')
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


def add_kitchen_cabinets(cream, quartz, gap=None) -> int:
    """厨房 L 型橱柜：北墙3.6水槽切配 + 东墙灶台（DEC-014），冰箱位(z>1.7)留空。
    厨房界 x[7.2,10.8] z[0,2.4]；Blender dims=(sx, sz, sy_height)。
    cream/quartz 由调用方传入（优先 scheme 的 cabinet/countertop 材质）。
    gap：柜门分缝条材质（4mm 宽假凹槽），缺省不分缝。"""

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
    # 北墙地柜拆两段留洗碗机位 x∈[8.50,9.10]（2026-08-23；dishwasher 由 place_extra_furniture 生成，
    # 紧贴水槽柜 x≥9.10 西侧，上下水就近）
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

    n += ktop('kitchen:top_n', 9.0, 0.3, 3.6, 0.62, [(9.5, 0.30, 0.70, 0.40)])
    n += ktop('kitchen:top_e', 10.5, 1.15, 0.62, 1.1, [(10.5, 1.18, 0.75, 0.45)])
    # 柜门分缝：北墙 run A 1.28m→3门（gap 7.65/8.08）/ run B 1.68m→3门（gap 9.66/10.22）/ 东墙 1.1m→2门
    if gap is not None:
        for gx in (7.65, 8.08, 9.66, 10.22):
            n += kgap(f'kitchen:gap_n{gx}', gx, 0.6, 0.0, 0.85, 'z')
        n += kgap('kitchen:gap_e1', 10.2, 1.15, 0.0, 0.85, 'x')
    print(f'[dress_scene] kitchen cabinets: {n}')
    return n


def add_bath_fixtures(furniture_mats: dict) -> int:
    """卫浴洁具+细节：洗手台+盆+马桶+镜柜+毛巾杆+台盆小件。
    点位对齐 house.yaml furnishings（2026-08-21 主卫终版：主卫东墙干区台盆 z=2.80/马桶 z=1.50、
    客卫西墙台盆 z=3.50/马桶 z=2.50）；此前硬编码为 DEC-019 旧点位已过期（2026-08-23 修正）。
    挂墙件只挂实体墙：主卫东墙 w_mbath_east、客卫西墙 w_gbath_west/东墙 w_gbath_east；
    主卫北墙为玻璃幕墙（suppressed），不挂任何件。"""
    ceramic = furniture_mats.get('ceramic')
    cream = furniture_mats.get('paint_cream')
    metal = furniture_mats.get('metal')
    towel_mat = furniture_mats.get('fabric_light')

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
    # 主卫（x 0–2.60, z 1.10–3.26；西侧淋浴湿区，东侧干区贴 w_mbath_east）
    n += box('bath:mb_vanity', 2.35, 2.80, 0.5, 0.8, 0.8, 0.4, cream)      # 80cm 台盆柜贴东墙，南缘 z=3.20 齐隔墙北脸
    n += box('bath:mb_basin', 2.35, 2.80, 0.4, 0.6, 0.12, 0.85, ceramic)
    n += box('bath:mb_toilet', 2.30, 1.50, 0.55, 0.4, 0.4, 0.2, ceramic)   # 贴东墙面朝西，对齐给水 z=1.5
    n += box('bath:mb_tank', 2.50, 1.50, 0.18, 0.42, 0.5, 0.55, ceramic)
    n += box('bath:mb_mirror_cab', 2.53, 2.80, 0.14, 0.6, 0.7, 1.55, cream)   # 镜柜挂东墙（台盆上方）
    n += box('bath:mb_mirror', 2.455, 2.80, 0.02, 0.55, 0.65, 1.55, metal)    # 镜面
    n += box('bath:mb_towel_bar', 2.58, 2.15, 0.03, 0.45, 0.03, 1.25, metal)  # 毛巾杆：东墙台盆/马桶之间空段
    n += box('bath:mb_towel', 2.55, 2.15, 0.06, 0.28, 0.45, 1.05, towel_mat)
    n += box('bath:mb_soap', 2.45, 3.05, 0.06, 0.06, 0.15, 0.925, ceramic)    # 台盆角洗手液瓶
    # 客卫（x 5.60–7.10, z 2.20–4.30；台盆/马桶贴西墙 w_gbath_west）
    n += box('bath:gb_vanity', 5.85, 3.5, 0.5, 0.8, 0.8, 0.4, cream)
    n += box('bath:gb_basin', 5.85, 3.5, 0.4, 0.5, 0.12, 0.85, ceramic)
    n += box('bath:gb_toilet', 5.95, 2.50, 0.55, 0.4, 0.4, 0.2, ceramic)   # 贴西墙面朝东，对齐给水 z=2.5
    n += box('bath:gb_tank', 5.70, 2.50, 0.18, 0.42, 0.5, 0.55, ceramic)
    n += box('bath:gb_mirror_cab', 5.67, 3.50, 0.14, 0.6, 0.7, 1.55, cream)   # 镜柜挂西墙（台盆上方）
    n += box('bath:gb_mirror', 5.745, 3.50, 0.02, 0.55, 0.65, 1.55, metal)
    n += box('bath:gb_towel_bar', 7.08, 3.00, 0.03, 0.45, 0.03, 1.25, metal)  # 毛巾杆：东墙 w_gbath_east
    n += box('bath:gb_towel', 7.05, 3.00, 0.06, 0.28, 0.45, 1.05, towel_mat)
    n += box('bath:gb_soap', 5.75, 3.75, 0.06, 0.06, 0.15, 0.925, ceramic)
    print(f'[dress_scene] bath fixtures: {n}')
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


def rebuild_railings(mats: dict) -> int:
    """GLB 里的 railing_run 是 app 侧 ExtrudeGeometry 实心挤出的整片薄板（HouseScene.renderRailingRun），
    渲染成一整面深色护墙板（entry_overview 左墙"黑色墙裙"= entry_garden_north_railing 确诊）。
    设计意图是通透栏杆 → 隐藏实心板，按世界包围盒重建：顶扶手 + 竖杆（净距 0.11m，住宅栏杆规范上限）。
    弧线栏杆（vrv_nw_railing）包围盒两轴都长，无法用直线段重建 → 跳过并告警。"""
    import mathutils
    rail_mat = mats.get('railing')
    rebuilt = 0
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or 'railing' not in obj.name or obj.name.startswith('railing:'):
            continue
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        xs = [c.x for c in corners]
        ys = [c.y for c in corners]
        zs = [c.z for c in corners]
        dx, dy = max(xs) - min(xs), max(ys) - min(ys)
        z0, z1 = min(zs), max(zs)
        if dx > 0.5 and dy > 0.5:
            print(f'[dress_scene] WARN: 弧线栏杆 {obj.name} 跳过重建（保留实心板）')
            continue
        obj.hide_render = True
        along_x = dx >= dy
        length = max(dx, dy)
        cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
        h = z1 - z0

        def bar(name: str, ln: float, wd: float, ht: float, px: float, py: float, pz: float) -> None:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            b = bpy.context.object
            b.name = name
            b.dimensions = (ln, wd, ht) if along_x else (wd, ln, ht)
            b.location = (px, py, pz)
            if rail_mat:
                b.data.materials.append(rail_mat)

        # 顶扶手（0.06 宽 × 0.05 厚，顶面与栏板齐平）
        bar(f'railing:{obj.name}:handrail', length, 0.06, 0.05, cx, cy, z1 - 0.025)
        # 竖杆 0.02 见方，净距 ≤0.11m
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


def render_scene(args: dict, cfg: dict, cam_cfg: dict, scenario: dict, out_path: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args['glb'])
    # 硬装裸房验收工况：隐藏一切可移动家具/软装（沙发/床/桌椅/绿植/落地灯/冰箱等），
    # 只留硬装（墙地顶/定制柜/门窗/灯具/卫浴洁具/厨房橱柜）。保留清单见 BARE_SHELL_KEEP。
    bare_shell = scenario.get('id') == 'bare_shell'
    if bare_shell:
        for o in bpy.data.objects:
            if not o.name.startswith('furniture:'):
                continue
            ps = o.name.split(':')
            ftype = ps[2] if len(ps) >= 3 else ''
            if ftype in BARE_SHELL_KEEP:
                continue
            o.hide_render = True
            for child in o.children_recursive:
                child.hide_render = True
    # 遮光帘状态配置驱动：blackout_state=open → 隐藏（视同拉开到两侧）；
    # 全宽不透明布若渲染会挡死玻璃，窗外天色完全看不见（决策渲染必须可见窗外）
    if scenario.get('blackout_state', 'open') == 'open':
        for o in bpy.data.objects:
            if o.name.endswith(':blackout'):
                o.hide_render = True
    # 纱帘状态配置驱动：sheer_state=open → 隐藏 GLB 内的 :sheer 对象（视同收起），
    # 并跳过下方 add_sheer_panels 的补充纱帘。bare_shell 同样隐藏（纱帘属软装）。
    # daylight 西晒时太阳直射会把整面纱帘打成白色柔光箱，窗外 HDRI 完全看不见。
    sheer_open = scenario.get('sheer_state', 'closed') == 'open'
    if sheer_open or bare_shell:
        for o in bpy.data.objects:
            if o.name.endswith(':sheer'):
                o.hide_render = True
    scene = bpy.context.scene
    used_engine = set_engine(scene, args['engine'], samples=int(args.get('samples', 256)))
    sheer_opacity = scenario.get('sheer_opacity', 0.15)
    mats = build_materials(used_engine, sheer_opacity=sheer_opacity)
    from materials_from_yaml import load_scheme_materials
    if args.get('config-dir'):
        mats = load_scheme_materials(used_engine, mats, new_principled, hex_rgb,
                                     config_dir=args['config-dir'],
                                     color_overrides=_parse_mat_overrides(args.get('mat-override')))
    else:
        print('[dress_scene] WARN: --config-dir 未传，跳过 materials.yaml 材质（使用基础材质）')
    stats = assign_materials(mats)
    furniture_mats = build_furniture_materials(hex_rgb, new_principled)
    tex_base = os.path.join(args.get('config-dir') or '', 'assets', 'textures')
    add_pbr_maps(mats.get('wall'), os.path.join(tex_base, 'painted_plaster_wall'),
                 size=2.5, with_diffuse=False, normal_strength=0.3)
    countertop_mat = mats.get('countertop') or furniture_mats.get('quartz')
    cabinet_mat = mats.get('cabinet') or furniture_mats.get('paint_cream')
    # 石英石台面保持素面（真实石英石即素色；marble_01 深脉纹挂 diffuse 显脏，v20 试过回退）：
    # 只挂 normal+rough 微肌理，不动色号
    add_pbr_maps(countertop_mat, os.path.join(tex_base, 'marble_01'),
                 size=3.0, with_diffuse=False, normal_strength=0.4)
    add_pbr_maps(furniture_mats.get('wood'), os.path.join(tex_base, 'oak_veneer_01'),
                 size=1.0, with_diffuse=True, normal_strength=0.3)
    # 深胡桃程序件（TV背板/开放格/低柜/茶几面/柜门拉手）：橡木 diff 乘色压深胡桃，出木纹
    add_pbr_maps(furniture_mats.get('wood_dark'), os.path.join(tex_base, 'oak_veneer_02'),
                 size=1.2, with_diffuse=True, normal_strength=0.3, tint='#503e2e')
    # 床品只挂 bump 不开 diffuse：保白色床品口径（SOURCES.md）；布纹底图 col_2 供沙发乘色用
    add_pbr_maps(furniture_mats.get('fabric_white'), os.path.join(tex_base, 'fabric_pattern_07'),
                 size=0.35, with_diffuse=False, normal_strength=1.0)
    # 玻璃参数场景级覆盖：daylight 室内被太阳+portal 打得很亮，Low-E 玻璃（IOR 1.5 + coat 0.3）
    # 会把窗变成镜子（反射亮室内盖过窗外 HDRI）。glass_ior≈1.02 近零反射，只留透射外景。
    if scenario.get('glass_ior'):
        g = mats.get('glass')
        if g and g.use_nodes:
            bsdf = _find_node(g.node_tree, 'ShaderNodeBsdfPrincipled')
            if bsdf:
                bsdf.inputs['IOR'].default_value = float(scenario['glass_ior'])
                if 'Coat Weight' in bsdf.inputs:
                    bsdf.inputs['Coat Weight'].default_value = float(scenario.get('glass_coat', 0.0))
    # 玻璃 tint 场景级覆盖（超白玻对比 daylight_clear）：替换玻璃 base color 为中性近无色，
    # 其余参数（IOR/透射/阴影直通）不动，与默认 Low-E 青绿 #c8e0dc 同机位对比
    if scenario.get('glass_tint'):
        g = mats.get('glass')
        if g and g.use_nodes:
            bsdf = _find_node(g.node_tree, 'ShaderNodeBsdfPrincipled')
            if bsdf:
                bsdf.inputs['Base Color'].default_value = (*hex_rgb(scenario['glass_tint']), 1.0)
    # 硬装补充贴图：木门木纹（乘色保色号）、遮光帘布纹、窗台石石材肌理
    add_pbr_maps(mats.get('door'), os.path.join(tex_base, 'oak_veneer_01'),
                 size=1.0, with_diffuse=True, normal_strength=0.3, tint='#8a6f52')
    add_pbr_maps(mats.get('curtain_fabric'), os.path.join(tex_base, 'fabric_pattern_07'),
                 size=0.5, with_diffuse=False, normal_strength=0.6)
    add_pbr_maps(mats.get('sill'), os.path.join(tex_base, 'marble_01'),
                 size=1.5, with_diffuse=False, normal_strength=0.3)
    add_pbr_maps(furniture_mats.get('fabric'), os.path.join(tex_base, 'fabric_pattern_07'),
                 size=0.35, with_diffuse=False, normal_strength=1.0)
    replace_furniture(furniture_mats, config_dir=args.get('config-dir') or '',
                      only_types=BARE_SHELL_KEEP if bare_shell else None)
    place_extra_furniture(furniture_mats, args.get('config-dir') or '',
                          only_types=BARE_SHELL_KEEP if bare_shell else None)
    add_moldings(args.get('config-dir') or '')
    rebuild_railings(mats)
    add_ceiling(args.get('config-dir') or '', mats)
    # 厨房橱柜挂 scheme 柜门材质：PET 肤感（哑光+细微 bump，与定制柜同一饰面口径）
    _add_pet_bump(cabinet_mat)
    add_kitchen_cabinets(cabinet_mat, countertop_mat, gap=furniture_mats.get('door_gap'))
    add_bath_fixtures(furniture_mats)
    if not bare_shell:
        add_soft_decor(furniture_mats)  # 地毯/挂画属软装，裸房验收不出现
    # 纱帘状态配置驱动：sheer_state=open → 不生成（视同收起）。bare_shell 同为软装不生成。
    # daylight 西晒时太阳直射会把整面纱帘打成白色柔光箱，窗外 HDRI 完全看不见，
    # 想看外景的工况应设 sheer_state: open。
    if not bare_shell and scenario.get('sheer_state', 'closed') != 'open':
        add_sheer_panels(args.get('config-dir') or '', mats)
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
        if cam_cfg.get('fill_from_camera'):
            # 相机同轴补光：放机位、对准 target。用于高柜挡死顶灯的房间（如书房 bookshelf
            # 把 55W dome 的光影投满北墙），默认的"target 正上方垂直向下"只照亮地面，
            # 墙面全黑且灯平面贴天花会在墙顶炸出高光带
            import mathutils as _mu
            pos = cam_cfg.get('position', [0, 1.6, 0])
            fl_obj.location = to_blender(pos[0], pos[1], pos[2])
            direction = _mu.Vector(to_blender(tgt[0], tgt[1], tgt[2])) - fl_obj.location
            fl_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        else:
            fl_obj.location = to_blender(tgt[0], 2.5, tgt[2])
        bpy.context.collection.objects.link(fl_obj)
    if scenario.get('lights_on', True):
        add_lights(cfg, temp_override=scenario.get('light_temp'))
    # 灯具实体始终建模（白天不开灯也要看见吊灯/吸顶灯形体），自发光仅在开灯工况
    add_light_fixtures(cfg, temp_override=scenario.get('light_temp'),
                       emit=scenario.get('lights_on', True))
    # 顶面完成度 staging（DEC-027 评估件：浅跌级+灯槽+风口）
    add_ceiling_finishing(mats, emit=scenario.get('lights_on', True))
    sun_dir = scenario.get('sun_direction')
    if sun_dir:
        add_sun(sun_dir, energy=scenario.get('sun_energy', 1.2), temp=scenario.get('sun_temp', 3200))
    if scenario.get('window_portal'):
        add_window_portal(scenario['window_portal'])
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
        # 曝光配置驱动：机位级 cam_cfg.exposure 优先，其次 scenario.exposure，
        # 缺省：Cycles 0.5 / EEVEE 0.6。机位级用于正对玻璃幕的相机
        # （master_bed_looking_glass：灰世界光透玻璃直灌镜头，全局曝光下整面过曝）
        default_exposure = 0.5 if used_engine == 'CYCLES' else 0.6
        scene.view_settings.exposure = cam_cfg.get('exposure', scenario.get('exposure', default_exposure))
    except Exception:
        pass
    try:
        scene.render.image_settings.file_format = 'PNG'
    except Exception:
        pass

    print(f'[dress_scene] {out_path} engine={used_engine} view_transform={scene.view_settings.view_transform} '
          f'materials={json.dumps(stats, ensure_ascii=False)}')
    bpy.ops.render.render(write_still=True)


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
    for job in jobs:
        cam_cfg = next(c for c in cfg['cameras'] if c['id'] == job['camera_id'])
        out_path = os.path.join(out_dir, job['out_name'] + '.png')
        render_scene(args, cfg, cam_cfg, job['scenario'], out_path)


if __name__ == '__main__':
    main()
