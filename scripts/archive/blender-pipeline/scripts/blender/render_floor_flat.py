"""真实尺度平铺预览：6x4.5m 平面顶视正交，对比两种地板贴图的大面积效果。"""
import bpy
import os
import sys
import math
import argparse


def get_args():
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--config-dir', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--samples', type=int, default=24)
    ap.add_argument('--ids', default='floor_pbr_straight,floor_pbr_herringbone')
    return ap.parse_args(argv)


def main():
    args = get_args()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import yaml
    from materials_from_yaml import _build_pbr_textured

    cfg_dir = os.path.normpath(args.config_dir)
    data = yaml.safe_load(open(os.path.join(cfg_dir, 'config', 'materials.yaml'), encoding='utf-8'))
    apps = {m['id']: m.get('appearance', {}) for m in data.get('materials', [])}

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    W, H = 6.0, 4.5
    mesh = bpy.data.meshes.new('flat')
    mesh.from_pydata([(-W/2, -H/2, 0), (W/2, -H/2, 0), (W/2, H/2, 0), (-W/2, H/2, 0)], [], [(0, 1, 2, 3)])
    uvl = mesh.uv_layers.new()
    for i, uv in enumerate([(0, 0), (W, 0), (W, H), (0, H)]):
        uvl.data[i].uv = uv
    plane = bpy.data.objects.new('flat', mesh)
    bpy.context.collection.objects.link(plane)

    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.55, 0.55, 1)
    bg.inputs['Strength'].default_value = 1.0

    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 3.0
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (math.radians(25), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = W
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = (0, 0, 5)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 960
    scene.view_settings.view_transform = 'AgX'

    for mid in [i.strip() for i in args.ids.split(',')]:
        out = f"flat_{mid.replace('floor_pbr_', '')}.png"
        mat = _build_pbr_textured(mid, apps[mid], cfg_dir)
        plane.data.materials.clear()
        plane.data.materials.append(mat)
        scene.render.filepath = os.path.normpath(os.path.join(args.out_dir, out))
        bpy.ops.render.render(write_still=True)
        print('[floor_flat] Saved:', scene.render.filepath)


main()
