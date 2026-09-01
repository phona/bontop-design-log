"""Formal Blender lighting helpers extracted from dress_scene.

This module is intentionally Blender-aware only at call time: callers inject the
Blender module and coordinate/color helpers so it can be imported by offline
unit tests without importing dress_scene (and without a circular import).
"""
from __future__ import annotations

from typing import Any, Callable


LIGHT_ENERGY = {
    'pendant': 110.0,
    'dome': 55.0,
    'downlight': 22.0,
    'wall_lamp': 18.0,
    'led_strip': 25.0,
    'track_light': 45.0,
}


def kelvin_to_rgb(k: float) -> tuple[float, float, float]:
    import math
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


def add_lights(cfg: dict, temp_override: float | None = None, *, bpy_module: Any,
               to_blender_fn: Callable, kelvin_to_rgb_fn: Callable = kelvin_to_rgb) -> int:
    count = 0
    for lp in cfg['lights']:
        energy = LIGHT_ENERGY.get(lp['type'], 15.0)
        color = kelvin_to_rgb_fn(temp_override if temp_override is not None else lp.get('temp', 3000))
        if lp['type'] == 'track_light':
            track = lp.get('track')
            if not track:
                raise ValueError(f"track_light {lp['id']} requires detailed track config")
            from mathutils import Vector
            resolved_heads = track.get('resolvedHeads')
            if not isinstance(resolved_heads, list) or not resolved_heads:
                raise ValueError(f"track_light {lp['id']} requires resolvedHeads in generated render config")
            for index, head in enumerate(resolved_heads, start=1):
                data = bpy_module.data.lights.new(f'{lp["id"]}/head:{index}', type='SPOT')
                data.energy = track['energy']
                data.color = color
                data.spot_size = track['beam']
                data.spot_blend = 0.45
                obj = bpy_module.data.objects.new(f'{lp["id"]}/head:{index}', data)
                obj.location = to_blender_fn(head['position']['x'], head['position']['y'], head['position']['z'])
                target = bpy_module.data.objects.new(f'{lp["id"]}/target:{index}', None)
                target.location = to_blender_fn(head['target']['x'], head['target']['y'], head['target']['z'])
                bpy_module.context.collection.objects.link(obj)
                bpy_module.context.collection.objects.link(target)
                direction = Vector(to_blender_fn(head['direction']['x'], head['direction']['y'], head['direction']['z'])).normalized()
                obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
                count += 1
            continue
        if lp['type'] == 'led_strip':
            data = bpy_module.data.lights.new(lp['id'], type='AREA')
            data.shape = 'RECTANGLE'
            data.size = 2.4
            data.size_y = 0.1
        else:
            data = bpy_module.data.lights.new(lp['id'], type='POINT')
            data.shadow_soft_size = 0.25 if lp['type'] == 'downlight' else 0.15
        data.energy = energy
        data.color = color
        obj = bpy_module.data.objects.new(lp['id'], data)
        off = 0.15 if lp['type'] == 'led_strip' else 0.0
        h = lp['height'] - 0.25 if lp['type'] == 'dome' else lp['height']
        if lp['type'] == 'downlight' and lp.get('recessed'):
            h -= 0.03
        obj.location = to_blender_fn(lp['x'] + off, h, lp['z'])
        if lp['type'] == 'led_strip':
            import math
            obj.rotation_euler = (0, -math.radians(90), 0)
        bpy_module.context.collection.objects.link(obj)
        count += 1
    return count


def add_window_portal(portal: dict, *, bpy_module: Any, to_blender_fn: Callable,
                      kelvin_to_rgb_fn: Callable = kelvin_to_rgb) -> None:
    import math
    data = bpy_module.data.lights.new('window_portal', type='AREA')
    data.shape = 'RECTANGLE'
    data.size = portal.get('width', 6.0)
    data.size_y = portal.get('height', 2.6)
    data.energy = portal.get('energy', 1500.0)
    data.color = kelvin_to_rgb_fn(portal.get('temp', 6000))
    obj = bpy_module.data.objects.new('window_portal', data)
    obj.location = to_blender_fn(portal.get('x', 10.3), portal.get('y', 2.2), portal.get('z', 11.0))
    obj.rotation_euler = (math.radians(90), 0, 0)
    obj.visible_camera = False
    obj.visible_transmission = False
    bpy_module.context.collection.objects.link(obj)


def add_sun(sun_dir: list[float], energy: float = 1.2, temp: int = 3200, *,
            bpy_module: Any, kelvin_to_rgb_fn: Callable = kelvin_to_rgb) -> None:
    from mathutils import Vector
    direction = -Vector(sun_dir).normalized()
    data = bpy_module.data.lights.new('Sun', type='SUN')
    data.energy = energy
    data.color = kelvin_to_rgb_fn(temp)
    obj = bpy_module.data.objects.new('Sun', data)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    bpy_module.context.collection.objects.link(obj)


def fill_light_is_enabled(fill) -> bool:
    return isinstance(fill, (int, float)) and fill > 0


def job_state(cam_cfg: dict, scenario: dict) -> dict:
    curtain_policy = scenario.get('curtainPolicy')
    if curtain_policy not in (None, 'hidden_for_bare_shell'):
        raise RuntimeError(f"BLOCKED: unknown curtainPolicy {curtain_policy!r} in scenario {scenario.get('id')}")
    bare_shell = scenario.get('id') == 'bare_shell'
    return {
        'bare_shell': bare_shell,
        'curtain_policy': curtain_policy,
        'lights_on': scenario.get('lights_on', True),
        'show_hvac': not bare_shell and bool(scenario.get('hvac_coordination', False)),
        'fill': cam_cfg.get('fill_light', scenario.get('fill_light')),
        'fill_from_camera': cam_cfg.get('fill_from_camera', False),
        'sheer_opacity': cam_cfg.get('sheer_opacity', scenario.get('sheer_opacity', 0.15)),
        'glass_ior': scenario.get('glass_ior'),
        'glass_tint': scenario.get('glass_tint'),
        'glass_coat': scenario.get('glass_coat', 0.0),
        'light_temp': scenario.get('light_temp', 6500),
        'sun': scenario.get('sun_direction'),
        'portal': scenario.get('window_portal'),
    }


def _set_job_lights(runtime: dict, state: dict, cam_cfg: dict, scenario: dict, *,
                    bpy_module: Any, to_blender_fn: Callable,
                    kelvin_to_rgb_fn: Callable = kelvin_to_rgb) -> None:
    color = kelvin_to_rgb_fn(state['light_temp'])
    for obj in bpy_module.data.objects:
        if obj.type == 'LIGHT' and obj.name != 'fill_light':
            obj.hide_render = not state['lights_on']
            obj.data.energy = runtime['light_defaults'].get(obj.name, obj.data.energy) if state['lights_on'] else 0.0
            if state['lights_on']:
                obj.data.color = color
    fill_obj = bpy_module.data.objects.get('fill_light')
    if fill_obj:
        fill = state['fill']
        fill_enabled = fill_light_is_enabled(fill)
        fill_obj.hide_render = not fill_enabled
        if fill_enabled:
            fill_obj.data.energy = float(fill)
            fill_obj.data.color = color
            tgt = cam_cfg.get('target', [0, 0, 0])
            if state['fill_from_camera']:
                import mathutils
                pos = cam_cfg.get('position', [0, 1.6, 0])
                fill_obj.location = to_blender_fn(pos[0], pos[1], pos[2])
                direction = mathutils.Vector(to_blender_fn(tgt[0], tgt[1], tgt[2])) - fill_obj.location
                fill_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
            else:
                fill_obj.location = to_blender_fn(tgt[0], 2.5, tgt[2])
    sun = bpy_module.data.objects.get('Sun')
    if sun:
        sun.hide_render = not bool(state['sun'])
        if state['sun']:
            from mathutils import Vector
            sun.rotation_mode = 'QUATERNION'
            sun.rotation_quaternion = (-Vector(state['sun']).normalized()).to_track_quat('-Z', 'Y')
            sun.data.energy = scenario.get('sun_energy', 1.2)
            sun.data.color = kelvin_to_rgb_fn(scenario.get('sun_temp', 3200))
    portal = bpy_module.data.objects.get('window_portal')
    if portal:
        spec = state['portal']
        portal.hide_render = not bool(spec)
        if spec:
            portal.data.energy = spec.get('energy', 1500.0)
            portal.data.color = kelvin_to_rgb_fn(spec.get('temp', 6000))


def job_light_audit(*, bpy_module: Any) -> dict:
    result = {}
    for obj in bpy_module.data.objects:
        if obj.type != 'LIGHT':
            continue
        result[obj.name] = {
            'type': obj.data.type,
            'energy': round(float(obj.data.energy), 3),
            'hidden': bool(obj.hide_render),
        }
    return result


# Backward-compatible private spelling for callers that import the helper.
_job_light_audit = job_light_audit
