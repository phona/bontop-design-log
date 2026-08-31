"""Render-only candidate and soft-decoration staging helpers.

All Blender dependencies are injected with :func:`configure`; no formal
project data is written by this module and it never imports dress_scene.
"""
from __future__ import annotations
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scene_asset_registry import registry_relation, write_asset_metadata  # noqa: E402

ASSET_REGISTRY = None

bpy = None
hex_rgb = None
new_principled = None
import_furniture_glb = None
_set_recursive_hidden = None
_hide_furniture_instance_family = None
_mark_render_only = None
_is_render_only = None
_furniture_instance_anchors = None
_furniture_instance_key = None
_furniture_type_from_object = None
to_blender = None
GLASS_IDS = set()
FURNITURE_GLB = {}

def configure(*, bpy_module, hex_rgb_fn, new_principled_fn,
              import_furniture_glb_fn, set_recursive_hidden_fn,
              hide_furniture_instance_family_fn,
              mark_render_only_fn, is_render_only_fn,
              furniture_instance_anchors_fn, furniture_instance_key_fn,
              furniture_type_from_object_fn, to_blender_fn,
              glass_ids=None, furniture_glb=None, asset_registry=None):
    global bpy, hex_rgb, new_principled, import_furniture_glb
    global _set_recursive_hidden, _hide_furniture_instance_family
    global _mark_render_only, _is_render_only
    global _furniture_instance_anchors, _furniture_instance_key
    global _furniture_type_from_object, to_blender, GLASS_IDS, FURNITURE_GLB, ASSET_REGISTRY
    bpy = bpy_module
    hex_rgb = hex_rgb_fn
    new_principled = new_principled_fn
    import_furniture_glb = import_furniture_glb_fn
    _set_recursive_hidden = set_recursive_hidden_fn
    _hide_furniture_instance_family = hide_furniture_instance_family_fn
    _mark_render_only = mark_render_only_fn
    _is_render_only = is_render_only_fn
    _furniture_instance_anchors = furniture_instance_anchors_fn
    _furniture_instance_key = furniture_instance_key_fn
    _furniture_type_from_object = furniture_type_from_object_fn
    to_blender = to_blender_fn
    GLASS_IDS = set(glass_ids or ())
    FURNITURE_GLB = furniture_glb or {}
    ASSET_REGISTRY = asset_registry

def _world_bbox_for_objects(objects):
    """Return the world-space bbox of mesh objects, or None when unavailable."""
    import mathutils
    corners = []
    for obj in objects:
        if getattr(obj, 'type', None) != 'MESH':
            continue
        corners.extend(obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box)
    if not corners:
        return None
    return tuple(
        (min(c[i] for c in corners), max(c[i] for c in corners))
        for i in range(3)
    )


def _report_render_only_asset(obj, label: str, source_path: str, source_bbox=None) -> None:
    """Print the staging evidence required for post-render asset auditing."""
    bbox = _world_bbox_for_objects([obj])
    if bbox is None:
        print(f'[dress_scene] real asset audit: {label} has no mesh bbox source={source_path}')
        return
    dims = tuple(hi - lo for lo, hi in bbox)
    materials = [mat for mat in obj.data.materials if mat is not None]
    images = set()
    image_texture_count = 0
    for mat in materials:
        material_images = []
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE':
                    image_texture_count += 1
                    if node.image is not None:
                        images.add(node.image)
                        material_images.append(node.image.name)
        print(f'[dress_scene] asset material: {label} material={mat.name} '
              f'image_textures={len(material_images)} images={material_images}')
    packed_images = sum(1 for image in images if image.packed_file is not None)
    source_text = ''
    if source_bbox is not None:
        source_dims = tuple(hi - lo for lo, hi in source_bbox)
        source_text = f' source_bbox=({source_dims[0]:.4f},{source_dims[1]:.4f},{source_dims[2]:.4f})'
    print(f'[dress_scene] real asset audit: {label} source={source_path}{source_text} '
          f'final_bbox=({dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}) '
          f'dimensions=({obj.dimensions.x:.4f},{obj.dimensions.y:.4f},{obj.dimensions.z:.4f}) '
          f'material_slots={len(obj.data.materials)} materials={[mat.name for mat in materials]} '
          f'uv_layers={len(obj.data.uv_layers)} image_textures={image_texture_count} '
          f'images={len(images)} packed_images={packed_images}')


def _mark_candidate_asset(obj, role: str, source_path: str, metadata_path: str | None = None) -> None:
    write_asset_metadata(
        obj, source_class='render_only', source_id=os.path.normpath(source_path),
        formal_instance_key=_furniture_instance_key(obj), formal_web_geometry=False,
        role=role, registry=ASSET_REGISTRY,
    )
    obj['assetProvider'] = 'BlenderKit'
    obj['assetKind'] = 'REAL asset'
    if metadata_path and os.path.isfile(metadata_path):
        try:
            with open(metadata_path, encoding='utf-8') as metadata_file:
                metadata = json.load(metadata_file)
            obj['candidateMetadata'] = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
            for key in ('uuid', 'file_id', 'file_type', 'asset_type', 'license', 'validation_status', 'download_status'):
                value = metadata.get(key)
                if value is not None:
                    obj[f'candidate_{key}'] = str(value)
        except (OSError, TypeError, ValueError) as exc:
            print(f'[dress_scene] WARN candidate metadata unreadable; continue staging: '
                  f'{metadata_path}: {type(exc).__name__}: {exc}')


def stage_missing_room_candidates(config_dir: str) -> int:
    """Stage reviewed BlenderKit candidates without changing formal layout data.

    Positions come only from current furniture anchors or named plumbing bboxes.
    Every candidate is render-only; a missing or failed import leaves the existing
    formal/procedural fallback visible.
    """
    import mathutils
    if not config_dir:
        print('[dress_scene] room candidates skipped: config dir missing')
        return 0

    root = os.path.join(config_dir, 'assets', 'furniture', 'blenderkit_candidates')
    candidates = (
        {
            'name': 'asset:guest_bath:mirror_cabinet_simple',
            'role': 'guest_bath:mirror_cabinet_simple',
            'path': os.path.join(root, 'bathrooms', 'mirror_cabinet_simple', 'mirror_cabinet_simple.blend'),
            'anchor_type': 'vanity', 'room_token': 'guest_bath', 'mode': 'above',
            'hide_tokens': ('mirror_cab',),
        },
        {
            'name': 'asset:entry_garden:shoe_cabinet_black',
            'role': 'entry_garden:shoe_cabinet_black',
            'path': os.path.join(root, 'public', 'shoe_cabinet_black', 'shoe_cabinet_black.blend'),
            'anchor_type': 'garden_entry_station', 'room_token': 'entry_garden', 'mode': 'east',
            'hide_tokens': ('shoe_body', 'door_', 'pull_', 'shoe_top'),
        },
        {
            'name': 'asset:kitchen:gas_stove_cooktop',
            'role': 'kitchen:gas_stove_cooktop',
            # 目录当前仅有 metadata.json；模型缺失时只记录 fallback，不伪造 REAL asset。
            'path': os.path.join(root, 'kitchen_missing', 'gas_stove_cooktop', 'gas_stove_cooktop.blend'),
            'metadata_path': os.path.join(root, 'kitchen_missing', 'gas_stove_cooktop', 'metadata.json'),
            'anchor_type': 'gas_stove', 'room_token': 'kitchen', 'mode': 'surface',
            'hide_tokens': ('gas_stove', 'cooktop', 'burner'),
        },
        {
            'name': 'asset:study:bedroom_desk',
            'role': 'study:bedroom_desk',
            'path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'bedroom_desk.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'metadata.json'),
            'anchor_type': 'desk', 'room_token': 'study', 'mode': 'ground',
            'hide_tokens': ('desk',),
        },
        {
            'name': 'asset:study:office_chair',
            'role': 'study:office_chair',
            'path': os.path.join(root, 'bedroom_missing', 'office_chair', 'office_chair.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'office_chair', 'metadata.json'),
            'anchor_type': 'chair', 'room_token': 'study', 'mode': 'ground',
            'hide_tokens': ('chair',),
        },
        {
            'name': 'asset:bedroom_nw:desk',
            'role': 'bedroom_nw:desk',
            'path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'bedroom_desk.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'bedroom_desk', 'metadata.json'),
            'anchor_type': 'desk', 'room_token': 'bedroom_nw', 'mode': 'ground',
            'fit_anchor_bbox': True, 'hide_tokens': ('desk', 'desktop', 'tabletop'),
        },
        {
            'name': 'asset:bedroom_nw:chair',
            'role': 'bedroom_nw:chair',
            'path': os.path.join(root, 'bedroom_missing', 'office_chair', 'office_chair.blend'),
            'metadata_path': os.path.join(root, 'bedroom_missing', 'office_chair', 'metadata.json'),
            'anchor_type': 'chair', 'room_token': 'bedroom_nw', 'mode': 'ground',
            'fit_anchor_bbox': True, 'hide_tokens': ('chair', 'seat', 'caster', 'wheel'),
        },
        {
            'name': 'asset:living_dining:mid_century_lounge_chair',
            'role': 'living_dining:mid_century_lounge_chair',
            'path': os.path.join(root, 'public', 'mid_century_lounge_chair',
                                 'mid_century_lounge_chair.blend'),
            'metadata_path': os.path.join(root, 'public', 'mid_century_lounge_chair',
                                          'metadata.json'),
            'anchor_type': 'sofa_3seat', 'room_token': 'living_dining',
            'mode': 'living_lounge_chair', 'hide_tokens': ('lounge_chair', 'armchair', 'accent_chair'),
        },
    )

    public_candidates = (
        {
            'name': 'asset:living_dining:side_table_wood',
            'role': 'living_dining:side_table_wood',
            'path': os.path.join(root, 'public', 'side_table_wood', 'side_table_wood.blend'),
            'metadata_path': os.path.join(root, 'public', 'side_table_wood', 'metadata.json'),
        },
        {
            'name': 'asset:living_dining:wall_art_botanical',
            'role': 'living_dining:wall_art_botanical',
            'path': os.path.join(root, 'public', 'wall_art_botanical', 'wall_art_botanical.blend'),
            'metadata_path': os.path.join(root, 'public', 'wall_art_botanical', 'metadata.json'),
        },
    )

    # Bookshelf staging is floor-standing and can only follow an existing shelf/open-rack
    # anchor.  It never derives a position from house.yaml or attaches to a wall/glazing node.
    bookshelf_path = os.path.join(root, 'bedroom_missing', 'bookshelf', 'bookshelf.blend')
    bookshelf_metadata_path = os.path.join(root, 'bedroom_missing', 'bookshelf', 'metadata.json')
    bookshelf_specs = (
        ('bedroom_nw', 'asset:bedroom_nw:bookshelf', 'bedroom_nw:bookshelf', ('shelf', 'open_shelf', 'open_rack')),
        ('study', 'asset:study:bookshelf', 'study:bookshelf', ('shelf', 'open_shelf', 'open_rack')),
    )

    # Bathroom staging deliberately uses only the already exported room anchors/bboxes.
    # No house.yaml, furnishing coordinates, Web geometry, cameras, or lights are touched.
    bathroom_assets = (
        ('master_bath', 'toilet', 'toilet_wall_hung', 'toilet_wall_hung.blend', 'ground', ('toilet',)),
        ('guest_bath', 'toilet', 'toilet_wall_hung', 'toilet_wall_hung.blend', 'ground', ('toilet',)),
        ('master_bath', 'shower', 'shower_set', 'shower_set.blend', 'ground', (), 'shower_mbath'),
        ('guest_bath', 'shower', 'shower_set', 'shower_set.blend', 'ground', (), 'shower_gbath'),
        ('guest_bath', 'faucet', 'bathroom_faucet_black', 'bathroom_faucet_black.blend', 'surface', (), 'faucet_gbath_vanity'),
        ('master_bath', 'towel_set', 'towel_rail', 'towel_rail.blend', 'center', ('towel',)),
        ('guest_bath', 'towel_set', 'towel_rail', 'towel_rail.blend', 'center', ('towel',)),
    )
    staged = 0
    candidate_metadata_paths = {
        spec['name']: spec.get('metadata_path') for spec in candidates
        if spec.get('metadata_path')
    }
    candidate_metadata_paths.update({
        name: bookshelf_metadata_path for _, name, _, _ in bookshelf_specs
    })
    candidate_metadata_paths.update({
        spec['name']: spec['metadata_path'] for spec in public_candidates
    })

    def remove_new(before):
        for obj in [o for o in bpy.data.objects if o not in before]:
            bpy.data.objects.remove(obj, do_unlink=True)

    def stage_one(spec, anchor, anchor_bbox, path, mode, hide_tokens, fit_anchor_bbox=False):
        nonlocal staged
        name = spec
        metadata_path = candidate_metadata_paths.get(name)
        existing = bpy.data.objects.get(name)
        if existing is not None:
            _set_recursive_hidden(existing, False)
            _mark_candidate_asset(existing, spec.split(':', 2)[-1], path, metadata_path)
            _report_render_only_asset(existing, spec.split(':', 2)[-1], path, anchor_bbox)
            staged += 1
            return
        center = tuple((lo + hi) / 2 for lo, hi in anchor_bbox)
        rotation = anchor.matrix_world.to_quaternion() if anchor is not None else mathutils.Quaternion()
        before = set(bpy.data.objects)
        try:
            imported = import_furniture_glb(
                path, {'width': max(0.25, min(0.75, anchor_bbox[0][1] - anchor_bbox[0][0]))},
                loc_rz=((center[0], center[1], center[2]), rotation.to_euler().z))
        except Exception as exc:
            remove_new(before)
            print(f'[dress_scene] WARN room candidate import failed; keep fallback: '
                  f'{path}: {type(exc).__name__}: {exc}')
            return
        meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        if not imported or not meshes:
            remove_new(before)
            print(f'[dress_scene] WARN bathroom candidate produced no mesh; keep fallback: {path}')
            return
        obj = meshes[-1]
        obj.name = name
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = rotation
        bpy.context.view_layer.update()
        bbox = _world_bbox_for_objects([obj])
        if bbox is None:
            print(f'[dress_scene] WARN bathroom candidate has no bbox; keep fallback: {path}')
            return
        obj.location.x, obj.location.y = center[0], center[1]
        lo_z, hi_z = bbox[2]
        if mode == 'ground':
            obj.location.z -= lo_z
        elif mode == 'surface':
            obj.location.z += anchor_bbox[2][1] - lo_z + 0.01
        elif mode in {'living_lounge', 'living_lounge_chair'}:
            # Derive all horizontal placement candidates from the formal sofa bbox.
            # The chair additionally protects other living furniture and the solid TV wall;
            # the existing side-table path retains its original sofa/table/rug checks.
            candidate_width = bbox[0][1] - bbox[0][0]
            candidate_depth = bbox[1][1] - bbox[1][0]
            sofa_cx = (anchor_bbox[0][0] + anchor_bbox[0][1]) / 2
            sofa_cy = (anchor_bbox[1][0] + anchor_bbox[1][1]) / 2
            sofa_positions = (
                (anchor_bbox[0][1] + candidate_width / 2 + 0.12, sofa_cy),
                (anchor_bbox[0][0] - candidate_width / 2 - 0.12, sofa_cy),
                (sofa_cx, anchor_bbox[1][1] + candidate_depth / 2 + 0.12),
                (sofa_cx, anchor_bbox[1][0] - candidate_depth / 2 - 0.12),
            )
            protected = []
            for protected_obj in bpy.data.objects:
                if protected_obj is obj or protected_obj.type != 'MESH':
                    continue
                protected_type = _furniture_type_from_object(protected_obj)
                protected_name = protected_obj.name
                name_lower = protected_name.lower()
                living_furniture = (
                    mode == 'living_lounge_chair'
                    and 'living_dining' in name_lower
                    and protected_type is not None
                )
                lounge_piece = protected_type in {'sofa_3seat', 'coffee_table'}
                living_rug = protected_name.startswith('asset:rug:living')
                solid_tv_wall = (
                    mode == 'living_lounge_chair'
                    and not _is_render_only(protected_obj)
                    and protected_name not in GLASS_IDS
                    and not protected_name.startswith('curtain_run:')
                    and (name_lower.startswith('furniture:living_dining:tv_wall_low:')
                         or name_lower.startswith('furniture:living_dining:wall_cabinet_tall:')
                         or 'tv_wall' in name_lower)
                )
                if not (living_furniture or lounge_piece or living_rug or solid_tv_wall):
                    continue
                protected_bbox = _world_bbox_for_objects([protected_obj])
                if protected_bbox is not None:
                    protected.append((protected_name, protected_bbox))
            placed = None
            for px, py in sofa_positions:
                obj.location.x, obj.location.y = px, py
                bpy.context.view_layer.update()
                trial_bbox = _world_bbox_for_objects([obj])
                if trial_bbox is None:
                    continue
                overlaps = [name for name, other_bbox in protected if all(
                    min(trial_bbox[i][1], other_bbox[i][1])
                    - max(trial_bbox[i][0], other_bbox[i][0]) > 0.02
                    for i in (0, 1))]
                if not overlaps:
                    placed = trial_bbox
                    break
            if placed is None:
                remove_new(before)
                print(f'[dress_scene] WARN living lounge candidate has no clear sofa-side bbox; '
                      f'keep fallback: {path}')
                return
            lo_z = placed[2][0]
            obj.location.z -= lo_z
        else:  # towel rail follows the existing towel_set bbox center.
            obj.location.z += center[2] - (lo_z + hi_z) / 2
        bpy.context.view_layer.update()
        placed_bbox = _world_bbox_for_objects([obj])
        if fit_anchor_bbox and placed_bbox is not None:
            anchor_width = anchor_bbox[0][1] - anchor_bbox[0][0]
            anchor_depth = anchor_bbox[1][1] - anchor_bbox[1][0]
            placed_width = placed_bbox[0][1] - placed_bbox[0][0]
            placed_depth = placed_bbox[1][1] - placed_bbox[1][0]
            if placed_width > anchor_width + 0.05 or placed_depth > anchor_depth + 0.05:
                remove_new(before)
                print(f'[dress_scene] WARN room candidate does not fit anchor; keep fallback: '
                      f'{path} placed=({placed_width:.3f},{placed_depth:.3f}) '
                      f'anchor=({anchor_width:.3f},{anchor_depth:.3f})')
                return
        role = name.split(':', 2)[-1]
        _mark_candidate_asset(obj, role, path, metadata_path)
        _report_render_only_asset(obj, role, path, anchor_bbox)
        hidden = []
        for child in bpy.data.objects:
            if child is anchor or not child.name.startswith(anchor.name + ':'):
                continue
            if any(token in child.name.lower() for token in hide_tokens):
                child['dress_replacement_source'] = True
                _set_recursive_hidden(child, True)
                hidden.append(child.name)
        print(f'[dress_scene] bathroom candidate staged: {obj.name} anchor={anchor.name} '
              f'anchor_bbox={anchor_bbox} hidden_duplicates={hidden}')
        staged += 1

    for spec in candidates:
        path = spec['path']
        if not os.path.isfile(path):
            if spec.get('metadata_path'):
                print(f'[dress_scene] WARN room candidate missing; keep fallback: {path} '
                      f'(metadata={spec["metadata_path"]})')
            else:
                print(f'[dress_scene] WARN room candidate missing; keep fallback: {path}')
            continue
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if _furniture_type_from_object(a) == spec['anchor_type']
                   and spec['room_token'] in a.name.lower()]
        if not anchors:
            print(f'[dress_scene] WARN room candidate skipped: no {spec["room_token"]} '
                  f'{spec["anchor_type"]} anchor')
            continue
        anchor = anchors[0]
        family = [o for o in bpy.data.objects if o is anchor or o.name.startswith(anchor.name + ':')]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN room candidate skipped: anchor has no mesh bbox: {anchor.name}')
            continue
        if spec['mode'] == 'above':
            # Existing mirror cabinet behavior: align over vanity, without hiding vanity.
            stage_one(spec['name'], anchor, bbox, path, 'surface', spec['hide_tokens'])
        elif spec['mode'] == 'east':
            stage_one(spec['name'], anchor, bbox, path, 'ground', spec['hide_tokens'])
            obj = bpy.data.objects.get(spec['name'])
            if obj:
                obj.location.x = bbox[0][1] + obj.dimensions.x / 2 + 0.08
        else:
            stage_one(spec['name'], anchor, bbox, path, spec['mode'], spec['hide_tokens'],
                      spec.get('fit_anchor_bbox', False))

    # Public-area side table: derive every placement input from the formal living sofa bbox.
    side_table_spec = public_candidates[0]
    side_table_path = side_table_spec['path']
    if not os.path.isfile(side_table_path):
        print(f'[dress_scene] WARN public candidate missing; keep fallback: {side_table_path}')
    else:
        sofa_anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                        if _furniture_type_from_object(a) == 'sofa_3seat'
                        and 'living_dining' in a.name.lower()]
        if not sofa_anchors:
            print('[dress_scene] WARN side table candidate skipped: no reliable living_dining sofa anchor; '
                  'keep fallback')
        else:
            sofa_anchor = sofa_anchors[0]
            sofa_family = [o for o in bpy.data.objects
                           if o is sofa_anchor or o.name.startswith(sofa_anchor.name + ':')]
            sofa_bbox = _world_bbox_for_objects(sofa_family)
            if sofa_bbox is None:
                print(f'[dress_scene] WARN side table candidate skipped: sofa has no mesh bbox: '
                      f'{sofa_anchor.name}')
            else:
                stage_one(side_table_spec['name'], sofa_anchor, sofa_bbox, side_table_path,
                          'living_lounge', ('side_table', 'end_table'), False)
                if bpy.data.objects.get(side_table_spec['name']) is not None:
                    for duplicate in bpy.data.objects:
                        if duplicate is bpy.data.objects.get(side_table_spec['name']):
                            continue
                        if duplicate.name.startswith(('asset:side_table', 'asset:end_table')):
                            duplicate['dress_replacement_source'] = True
                            _set_recursive_hidden(duplicate, True)

    # Wall art may only attach to a reliable solid TV-wall/west-wall bbox. Never use
    # curtain/glazing objects or infer a wall from room coordinates; no wall means skip.
    art_spec = public_candidates[1]
    art_path = art_spec['path']
    if not os.path.isfile(art_path):
        print(f'[dress_scene] WARN public candidate missing; keep fallback: {art_path}')
    else:
        # Plant-themed art requires independently confirmed public-area furniture bboxes;
        # without sofa and coffee-table evidence, do not infer a wall placement.
        sofa_anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                        if _furniture_type_from_object(a) == 'sofa_3seat'
                        and 'living_dining' in a.name.lower()]
        sofa_anchor = sofa_anchors[0] if sofa_anchors else None
        sofa_family = ([o for o in bpy.data.objects
                        if o is sofa_anchor or o.name.startswith(sofa_anchor.name + ':')]
                       if sofa_anchor else [])
        sofa_bbox = _world_bbox_for_objects(sofa_family)
        coffee_objects = [o for o in bpy.data.objects
                          if o.type == 'MESH' and not _is_render_only(o)
                          and (_furniture_type_from_object(o) == 'coffee_table'
                               or o.name.startswith('asset:coffee_table'))]
        coffee_bbox = _world_bbox_for_objects(coffee_objects)
        if sofa_bbox is None or coffee_bbox is None:
            print('[dress_scene] WARN wall art candidate skipped: reliable living_dining sofa and '
                  'coffee_table bboxes required; keep fallback')
            wall_candidates = []
        else:
            wall_candidates = []
        for obj in bpy.data.objects:
            if obj.type != 'MESH' or _is_render_only(obj):
                continue
            name_lower = obj.name.lower()
            if obj.name in GLASS_IDS or obj.name.startswith('curtain_run:'):
                continue
            is_tv_wall = (name_lower.startswith('furniture:living_dining:tv_wall_low:')
                          or name_lower.startswith('furniture:living_dining:wall_cabinet_tall:')
                          or 'tv_wall' in name_lower)
            is_west_wall = ('west_wall' in name_lower or name_lower.startswith('wall:west')
                            or name_lower.startswith('wall_west'))
            if is_tv_wall or is_west_wall:
                wall_candidates.append(obj)
        if sofa_bbox is None or coffee_bbox is None:
            wall_candidates = []
        wall_anchor = wall_candidates[0] if wall_candidates else None
        wall_bbox = _world_bbox_for_objects([wall_anchor]) if wall_anchor is not None else None
        if wall_anchor is None or wall_bbox is None:
            print('[dress_scene] WARN wall art candidate skipped: no reliable solid TV/west wall bbox; '
                  'keep fallback')
        else:
            name = art_spec['name']
            existing = bpy.data.objects.get(name)
            if existing is not None:
                _set_recursive_hidden(existing, False)
                _mark_candidate_asset(existing, art_spec['role'], art_path,
                                      art_spec['metadata_path'])
                _report_render_only_asset(existing, art_spec['role'], art_path, wall_bbox)
                staged += 1
            else:
                before = set(bpy.data.objects)
                try:
                    imported = import_furniture_glb(
                        art_path, {'width': 0.72, 'height': 1.05},
                        loc_rz=((0.0, 0.0, 0.0), wall_anchor.matrix_world.to_euler().z))
                except Exception as exc:
                    remove_new(before)
                    print(f'[dress_scene] WARN wall art candidate import failed; keep fallback: '
                          f'{art_path}: {type(exc).__name__}: {exc}')
                    imported = 0
                meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
                if imported and meshes:
                    art = meshes[-1]
                    art.name = name
                    art.rotation_mode = 'QUATERNION'
                    art.rotation_quaternion = wall_anchor.matrix_world.to_quaternion()
                    bpy.context.view_layer.update()
                    art_bbox = _world_bbox_for_objects([art])
                    wall_span = (wall_bbox[0][1] - wall_bbox[0][0],
                                 wall_bbox[1][1] - wall_bbox[1][0])
                    wall_normal_axis = 0 if wall_span[0] <= wall_span[1] else 1
                    wall_tangent_axis = 1 - wall_normal_axis
                    if art_bbox is None or wall_span[wall_normal_axis] > 0.35:
                        remove_new(before)
                        print('[dress_scene] WARN wall art candidate skipped: wall bbox is not a '
                              'reliable thin solid face; keep fallback')
                    else:
                        # Derive the face and tangent from the solid wall bbox, while the
                        # sofa/coffee-table midpoint supplies the public-area target.
                        art_normal = art_bbox[wall_normal_axis][1] - art_bbox[wall_normal_axis][0]
                        art_tangent = art_bbox[wall_tangent_axis][1] - art_bbox[wall_tangent_axis][0]
                        sofa_center = tuple((lo + hi) / 2 for lo, hi in sofa_bbox)
                        coffee_center = tuple((lo + hi) / 2 for lo, hi in coffee_bbox)
                        target_tangent = (sofa_center[wall_tangent_axis] + coffee_center[wall_tangent_axis]) / 2
                        tangent_lo, tangent_hi = wall_bbox[wall_tangent_axis]
                        art.location[wall_tangent_axis] = max(
                            tangent_lo + art_tangent / 2,
                            min(tangent_hi - art_tangent / 2, target_tangent))
                        wall_mid = sum(wall_bbox[wall_normal_axis]) / 2
                        toward_room = 1 if sofa_center[wall_normal_axis] > wall_mid else -1
                        face = wall_bbox[wall_normal_axis][1] if toward_room > 0 else wall_bbox[wall_normal_axis][0]
                        art.location[wall_normal_axis] = face + toward_room * (art_normal / 2 + 0.025)
                        art.location.z = wall_bbox[2][1] + (art_bbox[2][1] - art_bbox[2][0]) / 2 + 0.35
                        bpy.context.view_layer.update()
                        placed_bbox = _world_bbox_for_objects([art])
                        protected = [sofa_bbox, coffee_bbox]
                        protected += [_world_bbox_for_objects([o]) for o in bpy.data.objects
                                      if o.name.startswith('asset:rug:living') and o is not art]
                        overlaps = [other for other in protected if other is not None and placed_bbox is not None
                                     and all(min(placed_bbox[i][1], other[i][1])
                                             - max(placed_bbox[i][0], other[i][0]) > 0.02
                                             for i in (0, 1))]
                        if placed_bbox is None or overlaps:
                            remove_new(before)
                            print('[dress_scene] WARN wall art candidate skipped: placement overlaps '
                                  'living furniture/rug; keep fallback')
                        else:
                            _mark_candidate_asset(art, art_spec['role'], art_path,
                                                  art_spec['metadata_path'])
                            _report_render_only_asset(art, art_spec['role'], art_path, wall_bbox)
                            staged += 1
                            print(f'[dress_scene] wall art candidate staged: {art.name} '
                                  f'wall_anchor={wall_anchor.name} wall_bbox={wall_bbox} '
                                  f'sofa_bbox={sofa_bbox} coffee_bbox={coffee_bbox}')
                elif imported:
                    remove_new(before)
                    print(f'[dress_scene] WARN wall art candidate produced no mesh; keep fallback: '
                          f'{art_path}')

    # Stage the bookshelf only from a reliable shelf/open-rack anchor. The anchor
    # world bbox supplies both placement and width; no wall or room-coordinate guess.
    for room_token, name, role, anchor_types in bookshelf_specs:
        if not os.path.isfile(bookshelf_path):
            print(f'[dress_scene] WARN bookshelf candidate missing; keep fallback: {bookshelf_path} '
                  f'(metadata={bookshelf_metadata_path})')
            break
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if room_token in a.name.lower()
                   and (_furniture_type_from_object(a) or '').lower() in anchor_types]
        if not anchors:
            print(f'[dress_scene] WARN bookshelf candidate skipped: no reliable {room_token} '
                  f'shelf/open-rack anchor; keep fallback')
            continue
        anchor = anchors[0]
        family = [o for o in bpy.data.objects if o is anchor or o.name.startswith(anchor.name + ':')]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN bookshelf candidate skipped: anchor has no mesh bbox: {anchor.name}')
            continue
        stage_one(name, anchor, bbox, bookshelf_path, 'ground', anchor_types, True)
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        # A bookshelf must not occupy protected glazing or a door opening. Since
        # staging is render-only, reject and remove the candidate rather than move it.
        protected = []
        for protected_obj in bpy.data.objects:
            if protected_obj.type != 'MESH':
                continue
            protected_name = protected_obj.name
            if protected_name in GLASS_IDS or protected_name.startswith('curtain_run:') \
                    or protected_name.startswith('d_') or protected_name.startswith('door'):
                protected_bbox = _world_bbox_for_objects([protected_obj])
                candidate_bbox = _world_bbox_for_objects([obj])
                if protected_bbox is not None and candidate_bbox is not None and all(
                        min(candidate_bbox[i][1], protected_bbox[i][1])
                        - max(candidate_bbox[i][0], protected_bbox[i][0]) > 0.02
                        for i in range(3)):
                    protected.append(protected_name)
        if protected:
            bpy.data.objects.remove(obj, do_unlink=True)
            for child in bpy.data.objects:
                if child.name.startswith(anchor.name + ':') and child.get('dress_replacement_source'):
                    child['dress_replacement_source'] = False
                    _set_recursive_hidden(child, False)
            staged = max(0, staged - 1)
            print(f'[dress_scene] WARN bookshelf candidate protected-geometry conflict; '
                  f'keep fallback: room={room_token} anchor={anchor.name} conflicts={protected}')
            continue
        print(f'[dress_scene] bookshelf candidate staged: {obj.name} anchor={anchor.name} '
              f'anchor_bbox={bbox}')

    for room, kind, folder, filename, mode, hide_tokens, *anchor_hint in bathroom_assets:
        path = os.path.join(root, 'bathrooms', folder, filename)
        if not os.path.isfile(path):
            print(f'[dress_scene] WARN bathroom candidate missing; keep fallback: {path}')
            continue
        room_key = room.lower()
        anchors = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                   if room_key in a.name.lower() and _furniture_type_from_object(a) == kind]
        anchor = anchors[0] if anchors else None
        if anchor is None and anchor_hint and anchor_hint[0] == 'faucet_gbath_vanity':
            anchor = bpy.data.objects.get('plumbing:faucet_gbath_vanity')
        if anchor is None and anchor_hint and anchor_hint[0].startswith('shower_'):
            anchor = bpy.data.objects.get(f'plumbing:{anchor_hint[0]}')
        if anchor is None and kind == 'towel_set':
            towels = [a for a in _furniture_instance_anchors(list(bpy.data.objects)).values()
                      if room_key in a.name.lower() and _furniture_type_from_object(a) == 'towel_set']
            anchor = towels[0] if towels else None
        if anchor is None:
            print(f'[dress_scene] WARN bathroom candidate skipped: no reliable {room} {kind} anchor; keep fallback')
            continue
        family = [anchor] + list(anchor.children_recursive) if _furniture_type_from_object(anchor) else [anchor]
        bbox = _world_bbox_for_objects(family)
        if bbox is None:
            print(f'[dress_scene] WARN bathroom candidate skipped: no bbox for {anchor.name}; keep fallback')
            continue
        name = f'asset:{room}:{kind}'
        stage_one(name, anchor, bbox, path, mode, hide_tokens)

    if staged:
        print(f'[dress_scene] room candidates staged: {staged}')
    return staged

def add_soft_decor(furniture_mats: dict, config_dir: str = '') -> int:
    """生成客餐厅 render-only staging：BlenderKit 茶几、地毯与既有挂画。

    正式装饰若要进入设计交付，必须迁移到 house/shared/GLB；本函数不产生正式设计几何。
    所有替代件沿用 house.yaml 的既有占位坐标，不改变 Web 几何、家具坐标或相机。
    """
    import mathutils
    count = 0

    def bevel(obj, width=0.01, segments=3):
        modifier = obj.modifiers.new('Bevel', 'BEVEL')
        modifier.width = width
        modifier.segments = segments
        modifier.limit_method = 'ANGLE'
        return modifier

    def staging_material(name, color, rough=0.75):
        mat = bpy.data.materials.get(name)
        return mat or new_principled(name, hex_rgb(color), rough=rough)

    def hide_existing(name_prefix):
        hidden = 0
        for obj in bpy.data.objects:
            if obj.name == name_prefix or obj.name.startswith(name_prefix + ':'):
                _set_recursive_hidden(obj, True)
                hidden += 1
        return hidden

    # 茶几：隐藏 shared/FURNITURE_PARTS 的原始实例，避免原两块 cylinder 与替代件重叠。
    for source in _furniture_instance_anchors(list(bpy.data.objects)).values():
        if _furniture_type_from_object(source) == 'coffee_table':
            key = _furniture_instance_key(source)
            for formal_obj in bpy.data.objects:
                if _furniture_instance_key(formal_obj) == key:
                    formal_obj['dress_replacement_source'] = True
            _hide_furniture_instance_family(key, True)

    # 先隐藏历史 render-only 替代件；canonical BlenderKit 对象不参与清理，保证可重复调用。
    canonical_names = {'asset:coffee_table:blenderkit', 'asset:rug:living:blenderkit'}
    for prefix in ('asset:coffee_table', 'asset:rug:living'):
        for obj in bpy.data.objects:
            if obj.name not in canonical_names and (obj.name == prefix or obj.name.startswith(prefix + ':')):
                _set_recursive_hidden(obj, True)
    canonical_assets_present = all(bpy.data.objects.get(name) is not None for name in canonical_names)
    if canonical_assets_present:
        print('[dress_scene] soft decor canonical assets present; revalidate rug transform')

    def mark_real_asset(obj, role, source_path, formal_key=None):
        registry_role = 'coffee_table' if role == 'soft_decor:coffee_table' else 'rug'
        relation = registry_relation(ASSET_REGISTRY or {}, registry_role) or {}
        declared_key = (ASSET_REGISTRY or {}).get('entries', {}).get(registry_role, {}).get('formalInstanceKey')
        formal_key = formal_key or declared_key
        source_relation = relation.get('sourceRelation') if isinstance(relation, dict) else None
        if not source_relation:
            source_relation = 'living_dining:coffee_table_anchor' if registry_role == 'coffee_table' else 'living_dining:rug:preview:0'
        write_asset_metadata(
            obj, source_class='render_only', source_id=source_path,
            formal_instance_key=formal_key,
            formal_web_geometry=False, role=role, registry=ASSET_REGISTRY,
        )
        obj['attachmentKey'] = source_relation
        obj['sourceRelation'] = source_relation
        obj['assetKind'] = 'REAL asset'
        obj['assetProvider'] = 'BlenderKit'

    def asset_report(obj, source_dims=None, source_rotation=None):
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        dims = tuple(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3))
        materials = [mat for mat in obj.data.materials if mat is not None]
        images = set()
        for mat in materials:
            image_texture_count = 0
            base_color_connected = False
            roughness = None
            if mat.use_nodes:
                for node in mat.node_tree.nodes:
                    if node.type == 'TEX_IMAGE':
                        image_texture_count += 1
                        if node.image is not None:
                            images.add(node.image)
                    if node.type == 'BSDF_PRINCIPLED':
                        base_color = node.inputs.get('Base Color')
                        base_color_connected = bool(base_color and base_color.is_linked)
                        roughness_input = node.inputs.get('Roughness')
                        roughness = roughness_input.default_value if roughness_input else None
            roughness_text = f'{roughness:.3f}' if roughness is not None else 'n/a'
            print(f'[dress_scene] asset material: {mat.name} '
                  f'image_textures={image_texture_count} '
                  f'base_color_connected={base_color_connected} '
                  f'roughness={roughness_text}')
        packed = sum(1 for image in images if image.packed_file is not None)
        rotation = tuple(round(v, 5) for v in obj.rotation_euler)
        source_text = ''
        if source_dims is not None:
            source_text = f' source_bbox=({source_dims[0]:.4f},{source_dims[1]:.4f},{source_dims[2]:.4f})'
        if source_rotation is not None:
            source_text += f' source_rotation=({source_rotation[0]:.5f},{source_rotation[1]:.5f},{source_rotation[2]:.5f})'
        print(f'[dress_scene] real asset: {obj.name}{source_text} '
              f'final_bbox=({dims[0]:.4f},{dims[1]:.4f},{dims[2]:.4f}) '
              f'dimensions=({obj.dimensions.x:.4f},{obj.dimensions.y:.4f},{obj.dimensions.z:.4f}) '
              f'rotation=({rotation[0]:.5f},{rotation[1]:.5f},{rotation[2]:.5f}) '
              f'material_slots={len(obj.data.materials)} materials={len(materials)} '
              f'uv_layers={len(obj.data.uv_layers)} image_textures={len(images)} '
              f'packed_images={packed} z_thickness={dims[2]:.4f}')

    def add_bedroom_candidates():
        """按已导入的主卧 bed_180 世界包围盒摆放卧室 render-only 候选。

        mathutils 在此函数内显式导入，避免被其他局部作用域遮蔽。

        这里不读取或写回 house.yaml：床锚点和已成功导入床的 bbox 都来自当前
        Blender 场景。候选导入失败时不隐藏任何程序化床/床品回退。
        """
        import mathutils
        bed_objects = [o for o in bpy.data.objects
                       if o.type == 'MESH' and o.name.startswith('asset:bed_180:glb')]
        bed_anchors = [o for o in _furniture_instance_anchors(list(bpy.data.objects)).values()
                       if _furniture_type_from_object(o) == 'bed_180'
                       and 'master' in o.name.lower()]
        if not bed_objects or not bed_anchors:
            print('[dress_scene] bedroom candidates skipped: no successfully imported master bed_180')
            return 0
        bed = min(bed_objects, key=lambda o: min((o.location - a.location).length for a in bed_anchors))
        bed_anchor = min(bed_anchors, key=lambda a: (bed.location - a.location).length)
        source_path = os.path.join(config_dir, 'assets', 'furniture',
                                   'blenderkit_candidates', 'bedroom_missing')
        candidate_specs = (
            ('nightstand_midcentury.blend', 'nightstand_midcentury',
             {'width': 0.48}, 0.48, 'bedroom:nightstand_midcentury'),
            ('bedding_duvet_pillows.blend', 'bedding_duvet_pillows',
             {'width': 1.70}, 1.70, 'bedroom:bedding_duvet_pillows'),
        )
        bed_bb = [bed.matrix_world @ mathutils.Vector(c) for c in bed.bound_box]
        bed_dims = tuple(max(c[i] for c in bed_bb) - min(c[i] for c in bed_bb) for i in range(3))
        # helper 已将资产原点置于 bbox 中心；bed 的局部 x/y 是床宽/床深方向。
        local_bb = [mathutils.Vector(c) for c in bed.bound_box]
        local_min_x, local_max_x = min(c.x for c in local_bb), max(c.x for c in local_bb)
        local_min_y, local_max_y = min(c.y for c in local_bb), max(c.y for c in local_bb)
        head_y = local_min_y + (local_max_y - local_min_y) * 0.18
        side_gap = 0.08
        positions = (
            (local_min_x - side_gap - 0.24, head_y, 0.0),
            (local_max_x + side_gap + 0.24, head_y, 0.0),
        )
        added = 0
        for filename, slug, targets, width, role in candidate_specs:
            candidate_path = os.path.join(source_path, slug, filename)
            if not os.path.isfile(candidate_path):
                print(f'[dress_scene] WARN bedroom candidate missing; keep fallback: {candidate_path}')
                continue
            if slug == 'bedding_duvet_pillows':
                target_positions = ((0.0, (local_min_y + local_max_y) * 0.5, 0.0),)
            else:
                target_positions = positions
            existing = [o for o in bpy.data.objects
                        if o.name.startswith(f'asset:bedroom:{slug}')]
            if existing:
                for obj in existing:
                    _set_recursive_hidden(obj, False)
                    mark_real_asset(obj, role, candidate_path)
                    asset_report(obj, bed_dims)
                added += len(existing)
                continue
            imported_objects = []
            for index, local_pos in enumerate(target_positions):
                before = set(bpy.data.objects)
                world_pos = bed.matrix_world @ mathutils.Vector(local_pos)
                try:
                    imported = import_furniture_glb(
                        candidate_path, targets,
                        loc_rz=((world_pos.x, world_pos.y, world_pos.z),
                                bed.rotation_euler.z))
                except Exception as exc:
                    print(f'[dress_scene] WARN bedroom candidate import failed; keep fallback: '
                          f'{candidate_path}: {exc}')
                    continue
                new_meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
                if not imported or not new_meshes:
                    print(f'[dress_scene] WARN bedroom candidate import produced no mesh; keep fallback: '
                          f'{candidate_path}')
                    continue
                obj = new_meshes[-1]
                obj.name = f'asset:bedroom:{slug}:{index}'
                if slug == 'bedding_duvet_pillows':
                    obj.dimensions = (width, max(bed_dims[1] * 0.86, 0.1), max(bed_dims[2] * 0.18, 0.04))
                    bpy.context.view_layer.update()
                    obj.location = bed.matrix_world @ mathutils.Vector(local_pos)
                    obj.rotation_mode = 'QUATERNION'
                    obj.rotation_quaternion = bed.rotation_quaternion
                    obj.location.z = max(c.z for c in bed_bb) + 0.04
                else:
                    obj.rotation_mode = 'QUATERNION'
                    obj.rotation_quaternion = bed.rotation_quaternion
                    obj.location = world_pos
                    bpy.context.view_layer.update()
                    # 床头柜的 x/y 来自床 bbox；z 由导入对象自身 bbox 贴地，
                    # 不把床中心高度误当成柜脚高度。
                    obj_bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
                    obj.location.z -= min(c.z for c in obj_bb)
                bpy.context.view_layer.update()
                mark_real_asset(obj, role, candidate_path)
                asset_report(obj, bed_dims)
                imported_objects.append(obj)
                added += 1
            # 仅床品成功后隐藏程序化床品；床/床品失败均保留 fallback。
            if slug == 'bedding_duvet_pillows' and imported_objects:
                for child in bed_anchor.children_recursive:
                    if any(token in child.name.lower() for token in ('mattress', 'duvet', 'pillow')):
                        child.hide_render = True
                print('[dress_scene] bedroom bedding staging active; procedural bedding hidden')
        # 床头柜成功后仅隐藏对应程序化床头柜（若有），不影响床或动线。
        if any(o.name.startswith('asset:bedroom:nightstand_midcentury') for o in bpy.data.objects):
            for child in bed_anchor.children_recursive:
                if any(token in child.name.lower() for token in ('nightstand', 'bedside')):
                    child.hide_render = True
        return added

    add_bedroom_candidates()

    def prepare_rug(obj):
        """把 BlenderKit 地毯的最薄轴明确放到 Blender 竖直 Z，避免压成硬方盒。"""
        from mathutils import Quaternion
        bb = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        source_dims = tuple(max(c[i] for c in bb) - min(c[i] for c in bb) for i in range(3))
        source_rotation = tuple(obj.rotation_euler)
        thin_axis = min(range(3), key=lambda i: source_dims[i])
        if thin_axis == 0:
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = Quaternion((0, 1, 0), math.pi / 2) @ obj.rotation_quaternion
            print('[dress_scene] rug axis diagnosis: source thin axis X; rotated to Blender vertical Z')
        elif thin_axis == 1:
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = Quaternion((1, 0, 0), math.pi / 2) @ obj.rotation_quaternion
            print('[dress_scene] rug axis diagnosis: source thin axis Y; rotated to Blender vertical Z')
        else:
            print('[dress_scene] rug axis diagnosis: source thin axis Z; no axis correction needed')
        bpy.context.view_layer.update()
        obj.dimensions = (2.20, 1.60, 0.015)
        bpy.context.view_layer.update()
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type != 'BSDF_PRINCIPLED':
                    continue
                if 'Metallic' in node.inputs:
                    node.inputs['Metallic'].default_value = 0.0
                if 'Roughness' in node.inputs:
                    node.inputs['Roughness'].default_value = 0.86
                if 'Specular IOR Level' in node.inputs:
                    node.inputs['Specular IOR Level'].default_value = 0.25
                elif 'Specular' in node.inputs:
                    node.inputs['Specular'].default_value = 0.25
                if 'Coat Weight' in node.inputs:
                    node.inputs['Coat Weight'].default_value = 0.0
                elif 'Coat' in node.inputs:
                    node.inputs['Coat'].default_value = 0.0
        _set_recursive_hidden(obj, False)
        obj['rug_axis_corrected'] = True
        return source_dims, source_rotation

    import mathutils
    table_x, table_z = 10.2, 7.0
    asset_specs = (
        ('coffee_table.blend', 'asset:coffee_table:blenderkit',
         {'width': 0.85, 'height': 0.40}, (0.85, 0.48, 0.40), 0.40, 'soft_decor:coffee_table'),
        ('area_rug.blend', 'asset:rug:living:blenderkit',
         {'width': 2.20, 'height': 0.02}, (2.20, 1.60, 0.015), 0.014, 'soft_decor:rug'),
    )
    for filename, object_name, targets, final_dims, center_y, role in asset_specs:
        if canonical_assets_present and object_name not in canonical_names:
            continue
        source_path = os.path.join(config_dir, 'assets', 'furniture',
                                   'blenderkit_coffee_table' if 'coffee' in filename else 'blenderkit_area_rug',
                                   filename)
        existing_obj = bpy.data.objects.get(object_name)
        if existing_obj is not None:
            if object_name == 'asset:coffee_table:blenderkit':
                coffee_sources = [anchor for anchor in _furniture_instance_anchors(list(bpy.data.objects)).values()
                                  if _furniture_type_from_object(anchor) == 'coffee_table'
                                  and 'living_dining' in anchor.name.lower()]
                if coffee_sources:
                    key = _furniture_instance_key(coffee_sources[0])
                    for formal_obj in bpy.data.objects:
                        if _furniture_instance_key(formal_obj) == key:
                            formal_obj['dress_replacement_source'] = True
                    _hide_furniture_instance_family(key, True)
            if object_name == 'asset:rug:living:blenderkit':
                source_dims, source_rotation = prepare_rug(existing_obj)
                existing_obj.location = to_blender(table_x, center_y, table_z)
                mark_real_asset(existing_obj, role, source_path,
                                formal_key=('furniture:living_dining:coffee_table:0'
                                            if object_name == 'asset:coffee_table:blenderkit' else None))
                asset_report(existing_obj, source_dims, source_rotation)
            continue
        if not os.path.isfile(source_path):
            print(f'[dress_scene] WARN soft decor asset missing; keep fallback: {source_path}')
            continue
        before = set(bpy.data.objects)
        imported = import_furniture_glb(source_path, targets,
                                        loc_rz=((table_x, -table_z, center_y), 0))
        new_meshes = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'MESH']
        if not imported or not new_meshes:
            print(f'[dress_scene] WARN real asset import failed: {source_path}')
            continue
        obj = new_meshes[-1]
        obj.name = object_name
        source_dims = None
        source_rotation = None
        # 地毯必须先纠正 BlenderKit 源模型的薄轴，再设最终世界尺寸；否则
        # object.dimensions 会把错误轴压成 20mm 的深色硬板。
        if object_name == 'asset:rug:living:blenderkit':
            source_dims, source_rotation = prepare_rug(obj)
        else:
            # helper 贴地/等比缩放后，只对茶几做温和最终尺寸校正；中心保持原占位。
            obj.dimensions = final_dims
        obj.location = to_blender(table_x, center_y, table_z)
        bpy.context.view_layer.update()
        mark_real_asset(obj, role, source_path,
                        formal_key=('furniture:living_dining:coffee_table:0'
                                    if object_name == 'asset:coffee_table:blenderkit' else None))
        asset_report(obj, source_dims, source_rotation)
        count += 1

    # 西墙挂画 x2：轻量木框 + 内嵌画面平面；画面用暖米/陶土程序材质，避免深色 cube 观感。
    def abstract_art_material(index):
        name = f'软装_挂画_暖米陶土_程序_{index}'
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        output.location = (520, 0)
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.location = (260, 0)
        bsdf.inputs['Roughness'].default_value = 0.68
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
        texcoord = nodes.new('ShaderNodeTexCoord')
        texcoord.location = (-720, 0)
        mapping = nodes.new('ShaderNodeMapping')
        mapping.location = (-540, 0)
        mapping.inputs['Scale'].default_value = (2.2, 3.8, 1.0)
        noise = nodes.new('ShaderNodeTexNoise')
        noise.location = (-320, 40)
        noise.inputs['Scale'].default_value = 2.8
        noise.inputs['Detail'].default_value = 5.0
        noise.inputs['Roughness'].default_value = 0.72
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.location = (-60, 80)
        ramp.color_ramp.interpolation = 'EASE'
        colors = (
            ('#e5d1b2', '#b96f52') if index == 0 else ('#d8c19d', '#985841')
        )
        ramp.color_ramp.elements[0].position = 0.28
        ramp.color_ramp.elements[0].color = (*hex_rgb(colors[0]), 1.0)
        ramp.color_ramp.elements[1].position = 0.70
        ramp.color_ramp.elements[1].color = (*hex_rgb(colors[1]), 1.0)
        bump = nodes.new('ShaderNodeBump')
        bump.location = (40, -150)
        bump.inputs['Strength'].default_value = 0.12
        bump.inputs['Distance'].default_value = 0.012
        links.new(texcoord.outputs['Generated'], mapping.inputs['Vector'])
        links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
        links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
        links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
        return mat

    wood = furniture_mats.get('wood_dark') or staging_material(
        '家具_wood_dark', '#3a2e26', rough=0.58
    )
    for i, z in enumerate((6.4, 7.6)):
        # 西墙沿 x 方向厚度，画面宽度沿 Blender Y（对应 three z）。
        cx, cy, cz = 7.245, -z, 1.5
        frame_specs = (
            ('top', (0.035, 0.045, 0.66), (0.0, 0.0, 0.277)),
            ('bottom', (0.035, 0.045, 0.66), (0.0, 0.0, -0.277)),
            ('left', (0.035, 0.51, 0.045), (0.0, -0.307, 0.0)),
            ('right', (0.035, 0.51, 0.045), (0.0, 0.307, 0.0)),
        )
        for side, dims, offset in frame_specs:
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            edge = bpy.context.object
            edge.name = f'asset:art:{i}:frame:{side}'
            edge.dimensions = dims
            edge.location = (cx + offset[0], cy + offset[1], cz + offset[2])
            edge.data.materials.append(wood)
            bevel(edge, 0.012, 3)
            _mark_render_only(edge, 'soft_decor:art_frame')
            count += 1
        # 画面是嵌在木框后的真实平面，不使用深色实体 cube 作为主体。
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(cx + 0.006, cy, cz), rotation=(0, math.pi / 2, 0))
        picture = bpy.context.object
        picture.name = f'asset:art:{i}:picture_plane'
        # Plane 的局部 XY 经 Y 轴旋转后对应世界 Z/Y，匹配 0.56×0.46m 画面开口。
        picture.scale = (0.56, 0.46, 1.0)
        picture.data.materials.append(abstract_art_material(i))
        _mark_render_only(picture, 'soft_decor:artwork_plane')
        count += 1

    if count:
        print(f'[dress_scene] soft decor: {count} (coffee_table+rug+art; render-only)')
    return count


