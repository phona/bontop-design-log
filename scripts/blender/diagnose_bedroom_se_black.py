import bpy
import json
import math
import os
import sys
from mathutils import Vector

GLB = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 1 else 'tmp/baselines/house-20260826.glb'
OUT = sys.argv[sys.argv.index('--') + 2] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 2 else 'tmp/bedroom-se-diagnostic.png'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(GLB))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 960
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
if scene.world is None:
    scene.world = bpy.data.worlds.new('diagnostic_world')
scene.world.color = (0.12, 0.12, 0.12)

# Three camera coordinates: (x, y-height, z) -> Blender (x, -z, y-height)
def bcoord(p):
    return Vector((p[0], -p[2], p[1]))
cam_data = bpy.data.cameras.new('diagnostic_camera')
cam = bpy.data.objects.new('diagnostic_camera', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = bcoord((15.9, 1.5, 6.2))
target = bcoord((14.0, 1.2, 9.2))
direction = target - cam.location
cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
cam_data.lens = 24
cam_data.sensor_width = 36
scene.camera = cam

# Basic light so the diagnostic render is not all-black.
ld = bpy.data.lights.new('diag_key', 'AREA'); ld.energy = 1200; ld.shape = 'DISK'; ld.size = 5
lo = bpy.data.objects.new('diag_key', ld); bpy.context.collection.objects.link(lo); lo.location = bcoord((14, 3.0, 8))
lo.rotation_euler = (bcoord((14, 0, 8)) - lo.location).to_track_quat('-Z', 'Y').to_euler()


def bbox(obj):
    try:
        pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        return tuple(round(v, 3) for v in (min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts), min(p.z for p in pts), max(p.z for p in pts)))
    except Exception:
        return None

def mat_info(mat):
    if not mat: return None
    out = {'name': mat.name, 'use_nodes': bool(mat.use_nodes)}
    if mat.use_nodes:
        bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            c = bsdf.inputs.get('Base Color')
            out['base_color'] = tuple(round(x, 4) for x in c.default_value) if c and not c.is_linked else 'linked'
            out['roughness'] = round(bsdf.inputs['Roughness'].default_value, 4) if bsdf.inputs.get('Roughness') else None
            out['metallic'] = round(bsdf.inputs['Metallic'].default_value, 4) if bsdf.inputs.get('Metallic') else None
            out['alpha'] = round(bsdf.inputs['Alpha'].default_value, 4) if bsdf.inputs.get('Alpha') else None
        out['nodes'] = [n.type for n in mat.node_tree.nodes]
    return out

print('DIAG GLB', os.path.abspath(GLB))
print('SCENE objects', len(bpy.data.objects), 'meshes', sum(o.type == 'MESH' for o in bpy.data.objects))
print('CAMERA blender_location', tuple(round(x, 4) for x in cam.location), 'target', tuple(round(x, 4) for x in target), 'lens', cam_data.lens)
print('--- BEDROOM_SE OBJECTS ---')
for o in bpy.data.objects:
    if 'bedroom_se' in o.name.lower() or 'study' in o.name.lower() or 'curtain_study' in o.name.lower():
        print('OBJ', o.name, 'type=', o.type, 'hide_render=', o.hide_render, 'hide_viewport=', o.hide_viewport, 'parent=', o.parent.name if o.parent else None, 'bbox=', bbox(o))
        if o.type == 'MESH':
            print('  MATS', [mat_info(m) for m in o.data.materials])
print('--- DARK MATERIALS ON ALL MESHES ---')
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    infos = [mat_info(m) for m in o.data.materials]
    dark = [x for x in infos if x and isinstance(x.get('base_color'), tuple) and max(x['base_color'][:3]) < 0.08]
    if dark:
        print('DARK', o.name, 'hide_render=', o.hide_render, 'bbox=', bbox(o), 'mats=', dark)

# Ray casts through a grid on the right half of the output. Record first and all hits.
print('--- CAMERA RAY HITS ---')
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
for py in (0.25, 0.38, 0.50, 0.62, 0.75):
    for px in (0.58, 0.66, 0.74, 0.82, 0.90):
        ndc_x, ndc_y = px, py
        # camera view direction from normalized sensor coordinates
        ray = cam.data.view_frame(scene=scene)
        # view_frame order is top-left, bottom-left, bottom-right, top-right
        top_left, bottom_left, bottom_right, top_right = ray
        horiz = top_right - top_left
        vert = bottom_left - top_left
        local = top_left + horiz * ndc_x + vert * ndc_y
        direction = (cam.matrix_world.to_3x3() @ local).normalized()
        origin = cam.matrix_world.translation
        hits = []
        o = origin.copy(); d = direction.copy()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for _ in range(5):
            ok, loc, normal, face, hit_obj, matrix = scene.ray_cast(depsgraph, o, d)
            if not ok: break
            hits.append((hit_obj.name, tuple(round(x, 3) for x in loc), round((loc-o).length, 3), hit_obj.hide_render))
            o = loc + d * 0.002
        print('RAY', f'{px:.2f},{py:.2f}', hits)

scene.render.filepath = os.path.abspath(OUT)
bpy.ops.render.render(write_still=True)
print('RENDER', scene.render.filepath)
# Sample rendered image statistics by coarse cells; black cells are useful to correlate with ray grid.
img = bpy.data.images.get('Render Result')
if img:
    pix = list(img.pixels)
    w, h = img.size
    for py in (0.25, 0.38, 0.50, 0.62, 0.75):
        row=[]
        for px in (0.58, 0.66, 0.74, 0.82, 0.90):
            x=min(w-1,max(0,int(px*w))); y=min(h-1,max(0,int((1-py)*h)))
            i=(y*w+x)*4; row.append(tuple(round(pix[i+j],3) for j in range(3) if i+j < len(pix)))
        print('PIX', f'{py:.2f}', row)
print('DONE')
