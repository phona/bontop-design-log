"""Formal world, HDRI and sky-plane helpers extracted from dress_scene."""
from __future__ import annotations

import math
import os
from typing import Any, Callable


def setup_world(engine: str, scenario: dict, config_dir: str | None = None, *,
                bpy_module: Any, hex_rgb_fn: Callable,
                srgb_to_linear_tuple_fn: Callable) -> dict:
    hdri_status = {'loaded': False, 'path': None, 'reason': 'not_configured'}
    world = bpy_module.data.worlds.new('World') if not bpy_module.data.worlds else bpy_module.data.worlds[0]
    bpy_module.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes.clear()
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    out = world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs['Background'], out.inputs['Surface'])
    if engine.upper() == 'CYCLES':
        hdri = scenario.get('world_hdri')
        if hdri and config_dir:
            path = os.path.normpath(os.path.join(config_dir, hdri))
            hdri_status['path'] = hdri
            try:
                if not os.path.isfile(path):
                    raise FileNotFoundError(path)
                env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
                env.image = bpy_module.data.images.load(path)
                hdri_status.update(loaded=True, reason='loaded')
                print(f'[dress_scene] world HDRI: scenario={scenario.get("id", "unknown")} path={hdri} status=loaded')
            except Exception as exc:
                hdri_status['reason'] = type(exc).__name__
                print(f'[dress_scene] WARN world HDRI fallback: scenario={scenario.get("id", "unknown")} path={hdri} reason={hdri_status["reason"]}')
            if hdri_status['loaded']:
                if scenario.get('world_hdri_lighting'):
                    bg.inputs['Color'].default_value = (*hex_rgb_fn(scenario.get('world_color', '#808080')), 1.0)
                    bg.inputs['Strength'].default_value = scenario.get('world_strength', 1.0)
                    cam_str = scenario.get('world_hdri_camera_strength')
                    if cam_str is not None:
                        bg_cam = world.node_tree.nodes.new('ShaderNodeBackground')
                        camera_tint = scenario.get('world_hdri_camera_tint')
                        if isinstance(camera_tint, dict) and camera_tint.get('color'):
                            tint_mix = world.node_tree.nodes.new('ShaderNodeMixRGB')
                            tint_mix.blend_type = 'MIX'
                            tint_mix.inputs['Fac'].default_value = camera_tint.get('strength', 0.0)
                            world.node_tree.links.new(env.outputs['Color'], tint_mix.inputs['Color1'])
                            tint_mix.inputs['Color2'].default_value = (*hex_rgb_fn(camera_tint['color']), 1.0)
                            world.node_tree.links.new(tint_mix.outputs['Color'], bg_cam.inputs['Color'])
                        else:
                            world.node_tree.links.new(env.outputs['Color'], bg_cam.inputs['Color'])
                        bg_cam.inputs['Strength'].default_value = cam_str
                        lp2 = world.node_tree.nodes.new('ShaderNodeLightPath')
                        add1 = world.node_tree.nodes.new('ShaderNodeMath'); add1.operation = 'ADD'
                        world.node_tree.links.new(lp2.outputs['Is Camera Ray'], add1.inputs[0])
                        world.node_tree.links.new(lp2.outputs['Is Transmission Ray'], add1.inputs[1])
                        add2 = world.node_tree.nodes.new('ShaderNodeMath'); add2.operation = 'ADD'
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
                add1 = world.node_tree.nodes.new('ShaderNodeMath'); add1.operation = 'ADD'
                world.node_tree.links.new(lp.outputs['Is Camera Ray'], add1.inputs[0])
                world.node_tree.links.new(lp.outputs['Is Transmission Ray'], add1.inputs[1])
                add2 = world.node_tree.nodes.new('ShaderNodeMath'); add2.operation = 'ADD'
                world.node_tree.links.new(add1.outputs[0], add2.inputs[0])
                world.node_tree.links.new(lp.outputs['Is Singular Ray'], add2.inputs[1])
                mix = world.node_tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MIX'
                mix.inputs['Color1'].default_value = (*hex_rgb_fn(scenario.get('world_color', '#3a5a8f')), 1.0)
                world.node_tree.links.new(add2.outputs[0], mix.inputs['Fac'])
                world.node_tree.links.new(env.outputs['Color'], mix.inputs['Color2'])
                world.node_tree.links.new(mix.outputs['Color'], bg.inputs['Color'])
                bg.inputs['Strength'].default_value = scenario.get('world_strength', 0.8)
                return hdri_status
        elif scenario.get('world_color'):
            bg.inputs['Color'].default_value = (*hex_rgb_fn(scenario['world_color']), 1.0)
            bg.inputs['Strength'].default_value = scenario.get('world_strength', 0.3)
        else:
            sky = world.node_tree.nodes.new('ShaderNodeTexSky')
            sky.sky_type = 'HOSEK_WILKIE'
            sky.sun_direction = tuple(scenario.get('sun_direction') or [0, 0, 1])
            sky.sun_intensity = 1.2
            try: sky.sun_size = 0.02
            except Exception: pass
            world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
            bg.inputs['Strength'].default_value = 1.0
    else:
        bg.inputs['Color'].default_value = (*srgb_to_linear_tuple_fn((0.85, 0.87, 0.90)), 1.0)
        bg.inputs['Strength'].default_value = 0.25
        hdri = scenario.get('world_hdri')
        if hdri and config_dir:
            path = os.path.normpath(os.path.join(config_dir, hdri))
            hdri_status['path'] = hdri
            try:
                if not os.path.isfile(path):
                    raise FileNotFoundError(path)
                env = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
                env.image = bpy_module.data.images.load(path)
                bg_cam = world.node_tree.nodes.new('ShaderNodeBackground')
                bg_cam.inputs['Strength'].default_value = scenario.get('world_hdri_camera_strength', 1.0)
                world.node_tree.links.new(env.outputs['Color'], bg_cam.inputs['Color'])
                lp = world.node_tree.nodes.new('ShaderNodeLightPath')
                mix = world.node_tree.nodes.new('ShaderNodeMixShader')
                world.node_tree.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
                world.node_tree.links.new(bg.outputs['Background'], mix.inputs[1])
                world.node_tree.links.new(bg_cam.outputs['Background'], mix.inputs[2])
                world.node_tree.links.new(mix.outputs[0], out.inputs['Surface'])
                hdri_status.update(loaded=True, reason='loaded_camera_background')
                print(f'[dress_scene] world HDRI camera background: scenario={scenario.get("id", "unknown")} path={hdri} status=loaded')
            except Exception as exc:
                hdri_status['reason'] = type(exc).__name__
                print(f'[dress_scene] WARN EEVEE world HDRI camera background fallback: scenario={scenario.get("id", "unknown")} path={hdri} reason={hdri_status["reason"]}; using neutral world background')
    return hdri_status


def add_sky_planes(hdri_status: dict | None = None, *, bpy_module: Any,
                   glass_ids: set[str], find_node_fn: Callable,
                   srgb_to_linear_tuple_fn: Callable,
                   scenario: dict | None = None) -> None:
    """Create canonical glass sky planes once, then update and toggle them per job.

    The stable ``sky_plane:<glass object name>`` key makes repeated job calls
    idempotent. HDRI remains authoritative when loaded, and material_review
    never uses the blue fallback planes.
    """
    use_fallback = not (hdri_status and hdri_status.get('loaded'))
    if scenario and scenario.get('id') == 'material_review':
        use_fallback = False
    existing = [o for o in bpy_module.data.objects if o.name.startswith('sky_plane:')]
    for plane in existing:
        plane.hide_render = not use_fallback
    if not use_fallback:
        reason = 'material_review' if scenario and scenario.get('id') == 'material_review' else 'HDRI loaded'
        print(f'[dress_scene] sky fallback: disabled ({reason})')
        return

    from mathutils import Vector

    mat = next((m for m in bpy_module.data.materials if m.name == '天_傍晚天空'), None)
    if mat is None:
        mat = bpy_module.data.materials.new('天_傍晚天空')
    mat.use_nodes = True
    e = find_node_fn(mat.node_tree, 'ShaderNodeBsdfPrincipled')
    if e is None:
        e = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        out = find_node_fn(mat.node_tree, 'ShaderNodeOutputMaterial') or mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(e.outputs['BSDF'], out.inputs['Surface'])
    e.inputs['Emission Color'].default_value = (*srgb_to_linear_tuple_fn((0.55, 0.65, 0.92)), 1.0)
    e.inputs['Emission Strength'].default_value = 1.2
    try: mat.use_backface_culling = False
    except Exception: pass
    center = Vector((8.0, -3.5, 1.4))
    def is_glass_object(obj):
        return obj.name in glass_ids or any(obj.name.startswith(f'{glass_id}:part=') for glass_id in glass_ids)

    for obj in bpy_module.data.objects:
        if obj.type != 'MESH' or not is_glass_object(obj):
            continue
        c = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
        mins = Vector((min(v.x for v in c), min(v.y for v in c), min(v.z for v in c)))
        maxs = Vector((max(v.x for v in c), max(v.y for v in c), max(v.z for v in c)))
        size = maxs - mins
        axis = list(size).index(min(size)); off = 0.12; loc = (mins + maxs) / 2.0
        if axis == 0: loc.x = maxs.x + off if center.x > maxs.x else mins.x - off
        elif axis == 1: loc.y = maxs.y + off if center.y > maxs.y else mins.y - off
        else: loc.z = maxs.z + off if center.z > maxs.z else mins.z - off
        plane_name = f'sky_plane:{obj.name}'
        p = next((item for item in bpy_module.data.objects if item.name == plane_name), None)
        if p is None or p.type != 'MESH':
            bpy_module.ops.mesh.primitive_plane_add(size=1.0, location=loc)
            p = bpy_module.context.object
            p.name = plane_name
            if p.name not in bpy_module.context.scene.collection.objects:
                bpy_module.context.scene.collection.objects.link(p)
        else:
            p.location = loc
        p.hide_render = False
        if axis == 0: p.rotation_euler = (0, 1.5708 if loc.x < center.x else -1.5708, 0)
        elif axis == 1: p.rotation_euler = (-1.5708 if loc.y < center.y else 1.5708, 0, 0)
        else: p.rotation_euler = (0, 0, 0 if loc.z < center.z else math.pi)
        p.scale = (max(size.y if axis != 1 else size.x, 0.2), max(size.z, 0.2), 1.0)
        if p.data.materials:
            p.data.materials[0] = mat
        else:
            p.data.materials.append(mat)
        print(f'[dress_scene] sky plane for {obj.name} at {tuple(round(v,2) for v in loc)}')
