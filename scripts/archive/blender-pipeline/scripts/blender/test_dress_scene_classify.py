"""dress_scene.classify 墙段房间归属单测：wall:seg:N:room= 命中湿区 → wall_tile。
bpy 仅在函数体内使用，stub 顶层导入即可脱离 Blender 运行。"""
import inspect
import math
import os
from pathlib import Path
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)

import blender_assets
import blender_environment
import blender_lighting
import blender_render_only
import dress_scene
from dress_scene import (  # noqa: E402
    _curtain_hide_render_snapshot,
    _mark_render_only,
    _restore_curtain_hide_render,
    _is_render_only,
    bare_shell_should_hide,
    classify,
    effective_camera_config,
    parse_molding_declarations,
    room_boundary_wall_ids,
    fill_light_is_enabled,
    floor_room_id,
    floor_material_label,
    select_floor_material,
    assign_materials,
    job_state,
    plumbing_by_id,
    projection_facts,
    curved_railing_path,
    railing_bbox_is_rebuildable,
    _railing_has_shared_parts,
    master_bath_final_layout,
    uniform_asset_scale,
    BLENDERKIT_PBR_CONTRACT,
    _blenderkit_pbr_assignments,
    FURNITURE_GLB,
    FURNITURE_PARTS,
    FIXTURE_MATERIAL_ROLES,
)


def test_master_bedroom_staging_keeps_only_north_nightstand():
    source = inspect.getsource(blender_render_only.stage_missing_room_candidates)
    assert 'north_nightstand_position' in source
    assert 'target_positions = (north_nightstand_position,)' in source
    assert 'local_max_x + side_gap + 0.24' not in source
    assert '南床头由独立干式梳妆台' in source


def test_master_bedroom_procedural_recipes_cover_dressing_and_washbasin_semantics():
    assert {'master_dressing_table', 'dressing_stool', 'mb_washbasin_cabinet'} <= set(FURNITURE_PARTS)
    assert any(part[0] == 'tabletop_mirror' for part in FURNITURE_PARTS['master_dressing_table'])
    assert any(part[0] == 'plug_in_light' for part in FURNITURE_PARTS['master_dressing_table'])
    assert any(part[0] == 'east_storage' for part in FURNITURE_PARTS['mb_washbasin_cabinet'])
    assert not any('knee' in part[0] or 'dresser' in part[0] for part in FURNITURE_PARTS['mb_washbasin_cabinet'])


def test_study_render_scope_is_room_or_related_camera_only():
    assert blender_render_only.study_render_scope_visible('study', 'study_overview') is True
    assert blender_render_only.study_render_scope_visible('living_dining', 'study_overview') is False
    assert blender_render_only.study_render_scope_visible(None, 'study_work_detail') is True
    assert blender_render_only.study_render_scope_visible(None, 'parent_bedroom') is True
    assert blender_render_only.study_render_scope_visible(None, 'living_overview') is False


def test_study_staging_contract_is_render_only_and_anchor_based():
    source = inspect.getsource(blender_render_only.stage_study_bedroom)
    candidate = inspect.getsource(blender_render_only._stage_study_bed_candidate)
    marker = inspect.getsource(blender_render_only._mark_study_render_only)
    assert "furniture:study:bed_150:0" in source
    assert "bedroom_missing', 'bed_150', 'bed_150.blend" in candidate
    assert "source_class='render_only'" in marker
    assert "formal_web_geometry=False" in marker
    assert "assetProvider" in marker
    assert "electrical" not in source
    assert "house.yaml" not in source


def test_study_candidate_uniform_scale_uses_measured_bbox_width():
    assert blender_render_only._study_candidate_scale(3.0) == 0.5
    assert blender_render_only._study_candidate_scale(0.0) == 0.0


def test_study_staging_names_are_canonical_for_idempotent_reuse():
    source = inspect.getsource(blender_render_only.stage_study_bedroom)
    reset = inspect.getsource(dress_scene._reset_job_visibility)
    assert "asset:study:bedding:" in source
    assert "asset:study:reading_lamp:" in source
    assert "study staging already present" in source
    assert "dress_dynamic" in reset
    assert "study staging visibility" in inspect.getsource(dress_scene._apply_job_state)


def test_study_bedding_uses_soft_canonical_geometry_without_new_lighting():
    source = inspect.getsource(blender_render_only.stage_study_bedroom)
    assert "bedding_created = []" in source
    assert "_study_bedding_ready" in source
    assert "if bedding_complete:" in source
    assert "remove_incomplete_bedding(existing_bedding + bedding_created)" in source
    assert "hide_formal_bedding()" in source
    for name in (
        "asset:study:bedding:mattress",
        "asset:study:bedding:sheet",
        "asset:study:bedding:quilt",
        "asset:study:bedding:pillow:left",
        "asset:study:bedding:pillow:right",
    ):
        assert name in source
    assert "canonical_roles =" in source
    assert "_study_bedding_complete" in source
    assert "add_rounded_box" in source
    assert "Soft rounded edge" in source
    assert "add_quilt" in source
    assert "subdivision_ripple_drape" in source
    assert "add_pillow" in source
    assert "ellipsoid_subdivision" in source
    assert "contact_shadow" in source
    assert "Reading-light staging remains intentionally skipped" in source
    assert "primitive_cube_add" in source
    assert "bedding_count = len(existing_bedding) + len(bedding_created)" in source
    assert "reading_lamp" in source
    assert "bedding=5" not in source


def test_study_bedding_ready_requires_all_canonical_objects_and_valid_geometry_version():
    class Bedding:
        def __init__(self, version):
            self.version = version

        def get(self, key, default=None):
            return self.version if key == 'bedding_geometry_version' else default

    ready = blender_render_only._study_bedding_ready
    assert ready([Bedding(3)] * 5, 5, 3) is True
    assert ready([Bedding(3)] * 4, 5, 3) is False
    assert ready([Bedding(3), Bedding(2), Bedding(3), Bedding(3), Bedding(3)], 5, 3) is False


def test_study_pillow_scale_is_local_and_preserves_horizontal_dimensions():
    scale = blender_render_only._study_pillow_local_scale((0.54, 0.36, 0.14), 0.35)
    assert scale[:2] == (0.54, 0.36)
    assert 0.14 <= scale[2] <= 0.15
    source = inspect.getsource(blender_render_only.stage_study_bedroom)
    assert 'obj.rotation_quaternion = anchor.matrix_world.to_quaternion() @' in source
    assert 'obj.scale = _study_pillow_local_scale(dimensions, collapse)' in source
    assert 'obj.dimensions = dimensions' not in source.split('def add_pillow', 1)[1].split('def add_quilt', 1)[0]
    assert 'bedding_geometry_version = 3' in source


def test_study_bedding_complete_keeps_fallback_for_partial_or_exception_sets():
    class Bedding:
        def __init__(self, version):
            self.version = version

        def get(self, key, default=None):
            return self.version if key == 'bedding_geometry_version' else default

    complete = [Bedding(3)] * 5
    assert blender_render_only._study_bedding_complete([], complete, 5, 3) is True
    assert blender_render_only._study_bedding_complete([], complete[:2], 5, 3) is False
    assert blender_render_only._study_bedding_complete(complete[:4], [], 5, 3) is False
    assert blender_render_only._study_bedding_complete([], [], 5, 3) is False


def test_study_staging_reuses_canonical_bedding_family():
    source = inspect.getsource(blender_render_only.stage_study_bedroom)
    assert "existing_bedding =" in source
    assert "remove_incomplete_bedding" in source
    assert "existing_lamp =" in source
    assert "if not existing_bedding:" in source
    assert "return bedding_count + len(existing_lamp)" in source


def test_asset_and_render_only_modules_are_independent_compatibility_boundaries():
    assert 'dress_scene' not in blender_assets.__dict__
    assert 'dress_scene' not in blender_render_only.__dict__
    assert math.isclose(blender_assets.uniform_asset_scale(3.5, 1.0, {'width': 2.8, 'height': 0.8}), 0.8)
    assert callable(blender_assets.import_furniture_glb)
    assert callable(blender_assets.replace_furniture)
    assert callable(blender_render_only.add_soft_decor)
    assert callable(blender_render_only.stage_missing_room_candidates)


def test_replace_furniture_room_ids_is_optional_and_preserves_legacy_calls():
    blender_assets.configure(
        bpy_module=types.SimpleNamespace(data=types.SimpleNamespace(objects=[])),
        hex_rgb_fn=lambda value: (0.0, 0.0, 0.0),
        find_node_fn=lambda *args: None, new_principled_fn=lambda *args, **kwargs: None,
        set_recursive_hidden_fn=lambda *args: None,
        hide_furniture_instance_family_fn=lambda *args: 0,
        mark_render_only_fn=lambda *args: None,
        is_render_only_fn=lambda obj: False, add_pbr_maps_fn=lambda *args, **kwargs: True,
        fixture_material_role_fn=lambda name: 'cabinet_body',
        furniture_instance_anchors_fn=lambda objects: {},
        furniture_instance_key_fn=lambda obj: None,
    )
    signature = inspect.signature(blender_assets.replace_furniture)
    assert signature.parameters['room_ids'].default is None
    assert blender_assets.replace_furniture({}) == 0
    assert blender_assets.replace_furniture({}, '', {'sofa_3seat'}) == 0
    assert blender_assets.replace_furniture({}, '', only_types={'sofa_3seat'}, room_ids={'living_dining'}) == 0


def test_replace_furniture_room_ids_filters_anchors_before_asset_work():
    class ObjectCollection(list):
        def get(self, name):
            return next((obj for obj in self if obj.name == name), None)

    class FakeObject:
        def __init__(self, name):
            self.name = name

    living = FakeObject('furniture:living_dining:sofa_3seat:0')
    bedroom = FakeObject('furniture:master_bedroom:sofa_3seat:0')
    calls = []
    blender_assets.configure(
        bpy_module=types.SimpleNamespace(data=types.SimpleNamespace(objects=ObjectCollection([living, bedroom]))),
        hex_rgb_fn=lambda value: (0.0, 0.0, 0.0),
        find_node_fn=lambda *args: None, new_principled_fn=lambda *args, **kwargs: None,
        set_recursive_hidden_fn=lambda *args: None,
        hide_furniture_instance_family_fn=lambda *args: 0,
        mark_render_only_fn=lambda *args: None,
        is_render_only_fn=lambda obj: False, add_pbr_maps_fn=lambda *args, **kwargs: True,
        fixture_material_role_fn=lambda name: 'cabinet_body',
        furniture_instance_anchors_fn=lambda objects: {
            'living': living, 'bedroom': bedroom,
        },
        furniture_instance_key_fn=lambda obj: obj.name,
    )
    original_import = blender_assets.import_furniture_glb
    original_exists = blender_assets.os.path.exists
    blender_assets.import_furniture_glb = lambda path, cfg, block=None, rot_fix=0: calls.append(block) or False
    blender_assets.os.path.exists = lambda path: True
    try:
        assert blender_assets.replace_furniture({}, '/assets', room_ids={'living_dining'}) == 0
    finally:
        blender_assets.import_furniture_glb = original_import
        blender_assets.os.path.exists = original_exists
    assert calls == [living]


def test_extracted_modules_receive_all_runtime_dependencies():
    is_render_only = lambda obj: False
    add_pbr_maps = lambda *args, **kwargs: True
    fixture_role = lambda name: 'cabinet_body'
    blender_assets.configure(
        bpy_module=bpy_stub, hex_rgb_fn=lambda value: (0.0, 0.0, 0.0),
        find_node_fn=lambda *args: None, new_principled_fn=lambda *args, **kwargs: None,
        set_recursive_hidden_fn=lambda *args: None,
        hide_furniture_instance_family_fn=lambda *args: 0,
        mark_render_only_fn=lambda *args: None,
        is_render_only_fn=is_render_only, add_pbr_maps_fn=add_pbr_maps,
        fixture_material_role_fn=fixture_role, furniture_instance_anchors_fn=lambda objects: {},
        furniture_instance_key_fn=lambda obj: None,
    )
    blender_render_only.configure(
        bpy_module=bpy_stub, hex_rgb_fn=lambda value: (0.0, 0.0, 0.0),
        new_principled_fn=lambda *args, **kwargs: None, import_furniture_glb_fn=lambda *args, **kwargs: 0,
        set_recursive_hidden_fn=lambda *args: None,
        hide_furniture_instance_family_fn=lambda *args: 0,
        mark_render_only_fn=lambda *args: None,
        is_render_only_fn=is_render_only, furniture_instance_anchors_fn=lambda objects: {},
        furniture_instance_key_fn=lambda obj: None,
        furniture_type_from_object_fn=lambda obj: None, to_blender_fn=lambda *args: (0.0, 0.0, 0.0),
    )
    assert blender_assets._is_render_only is is_render_only
    assert blender_assets.add_pbr_maps is add_pbr_maps
    assert blender_assets.fixture_material_role is fixture_role
    assert blender_render_only._is_render_only is is_render_only


def test_lighting_environment_split_keeps_compatibility_surface():
    assert dress_scene.add_lights.__module__ == 'dress_scene'
    assert callable(dress_scene.add_lights)
    assert not hasattr(blender_lighting, 'add_light_fixtures')
    assert 'add_light_fixtures' not in blender_lighting.__dict__
    assert dress_scene.kelvin_to_rgb is blender_lighting.kelvin_to_rgb
    assert dress_scene.job_state is blender_lighting.job_state
    assert hasattr(blender_environment, 'setup_world')
    assert hasattr(blender_environment, 'add_sky_planes')


def _obj(name):
    return types.SimpleNamespace(name=name, parent=None)


def test_shared_railing_presence_skips_legacy_rebuild_policy():
    handrail = types.SimpleNamespace(name='r:part=handrail:role=railing', children_recursive=(), get=lambda key, default=None: {'part': 'handrail'}.get(key, default))
    bar = types.SimpleNamespace(name='r:part=bar:0:role=railing', children_recursive=(), get=lambda key, default=None: {'part': 'bar:0'}.get(key, default))
    root = types.SimpleNamespace(name='entry_garden_north_railing', children_recursive=(handrail, bar), get=lambda key, default=None: {'type': 'railing_run'}.get(key, default))
    assert _railing_has_shared_parts(root) is True

    legacy = types.SimpleNamespace(name='entry_garden_north_railing', children_recursive=(), get=lambda key, default=None: default)
    assert _railing_has_shared_parts(legacy) is False


def test_fixture_roles_cover_factory_outputs_and_classify_from_stable_names():
    expected = {
        'drawer_front', 'back_panel', 'frame', 'weight_plate', 'upholstery',
        'floor_protection', 'cabinet_foot', 'cabinet_support', 'safety_bar', 'mirror',
        'cooktop_burner',
    }
    assert expected <= set(FIXTURE_MATERIAL_ROLES)
    for role in expected:
        assert classify(_obj(f'fixture:part=x:role={role}')) == role


def test_unknown_fixture_role_is_blocked_with_audit_context():
    try:
        classify(_obj('fixture:part=x:role=not_declared'))
    except RuntimeError as exc:
        assert 'unknown fixture material role' in str(exc)
        assert 'not_declared' in str(exc)
        assert 'fixture:part=x:role=not_declared' in str(exc)
    else:
        raise AssertionError('unknown fixture role must be blocked')


def test_cooktop_burner_material_is_built_with_distinct_metal_contract(monkeypatch):
    calls = []

    def fake_principled(name, color, rough, metallic=0.0, **kwargs):
        material = {'name': name, 'color': color, 'roughness': rough, 'metallic': metallic}
        calls.append(material)
        return material

    monkeypatch.setattr(dress_scene, 'new_principled', fake_principled)
    monkeypatch.setattr(dress_scene, 'new_sheer_transparent', lambda name, color, opacity: {'name': name})
    mats = dress_scene.build_materials('EEVEE')
    burner = mats['cooktop_burner']
    assert burner['name'] == '灶台_炉圈'
    assert burner['roughness'] == 0.32
    assert burner['metallic'] == 0.75
    assert calls.count(burner) == 1
    assert mats['fixture_metal']['name'] == '灯具_金属'
    assert mats['hardware']['name'] == '柜体_五金'


def test_tv_fixture_roles_classify_from_stable_export_names():
    assert classify(_obj('tv_65:part=frame:role=tv_frame')) == 'tv_frame'
    assert classify(_obj('tv_65:part=screen:role=tv_screen')) == 'tv_screen'


def test_shared_lighting_fixture_roles_classify_from_stable_export_names():
    assert classify(_obj('electrical:lamp:part=shade:role=fixture_diffuser')) == 'fixture_diffuser'
    assert classify(_obj('electrical:lamp:part=track:role=fixture_track')) == 'fixture_track'
    assert classify(_obj('electrical:lamp:part=cord:role=fixture_metal')) == 'fixture_metal'
    assert classify(_obj('electrical:lamp:part=strip:role=cove_light')) == 'cove_light'


def test_formal_furniture_roles_classify_from_stable_export_names():
    assert classify(_obj('furniture:bath:part=toilet:role=ceramic')) == 'ceramic'
    assert classify(_obj('furniture:bath:part=towel:role=fabric')) == 'fabric'


def test_wet_room_wall_gets_tile():
    assert classify(_obj('wall:seg:3:room=kitchen|living_dining')) == 'wall_tile'
    assert classify(_obj('wall:seg:7:room=master_bath')) == 'wall_tile'
    assert classify(_obj('wall:seg:9:room=balcony')) == 'wall_tile'


def test_dry_room_wall_stays_paint():
    assert classify(_obj('wall:seg:1:room=living_dining|study')) == 'wall'
    assert classify(_obj('wall:seg:2')) == 'wall'  # 无归属（旧 GLB）


def test_floor_material_room_override_wins_over_default():
    default = object()
    override = object()
    assert select_floor_material({'floor': default}, {'master_bedroom': override}, 'master_bedroom') is override


def test_floor_material_missing_room_override_falls_back_to_default():
    default = object()
    assert select_floor_material({'floor': default}, {'living_dining': object()}, 'master_bedroom') is default


def test_floor_material_missing_default_preserves_fallback_signal():
    assert select_floor_material({}, {}, 'master_bedroom') is None


def test_floor_material_label_is_safe_for_diagnostics():
    assert floor_material_label(types.SimpleNamespace(name='方案_floor_pbr_tile_612')) == '方案_floor_pbr_tile_612'
    assert floor_material_label(object()) == '<unnamed>'
    assert floor_material_label(None) == '<none>'


def test_assign_materials_applies_default_and_room_override_to_final_meshes():
    default = object()
    override = object()
    fallback = object()
    slots = []
    def mesh(name):
        return types.SimpleNamespace(name=name, parent=None, type='MESH', data=types.SimpleNamespace(materials=slots.copy()))
    objects = [mesh('floor:living_dining'), mesh('floor:master_bath'), mesh('floor:guest_bath')]
    blender_module = dress_scene.bpy
    original_data = getattr(blender_module, 'data', None)
    blender_module.data = types.SimpleNamespace(objects=objects)
    try:
        stats = assign_materials({'floor': default, 'default': fallback}, {'master_bath': override})
        assert stats == {'floor': 3}
        assert objects[0].data.materials == [default]
        assert objects[1].data.materials == [override]
        assert objects[2].data.materials == [default]
    finally:
        if original_data is None:
            del blender_module.data
        else:
            blender_module.data = original_data


def test_assign_materials_falls_back_only_when_global_floor_is_missing(capsys):
    fallback = object()
    obj = types.SimpleNamespace(name='floor:living_dining', parent=None, type='MESH', data=types.SimpleNamespace(materials=[]))
    blender_module = dress_scene.bpy
    original_data = getattr(blender_module, 'data', None)
    blender_module.data = types.SimpleNamespace(objects=[obj])
    try:
        assign_materials({'default': fallback}, {})
    finally:
        if original_data is None:
            del blender_module.data
        else:
            blender_module.data = original_data
    assert obj.data.materials == [fallback]
    assert "role 'floor' missing; fallback to 'default'" in capsys.readouterr().out


def test_blender_duplicate_suffix_tolerated():
    # Blender 重名自动加 .NNN：正则只吃到字母数字/_|，后缀不影响解析
    assert classify(_obj('wall:seg:3:room=guest_bath.001')) == 'wall_tile'


def test_other_wall_names_unchanged():
    assert classify(_obj('wall:living_dining:north')) == 'wall'
    assert classify(_obj('molding:living:d01')) == 'wall'


def test_molding_declarations_are_explicit_and_suppress_is_not_a_declaration():
    assert parse_molding_declarations({
        'suppress': [{'wall': 'w_liv_south'}],
    }) == []
    assert parse_molding_declarations({
        'moldings': [
            {'type': 'baseboard', 'wall': 'w_ent_south_w'},
            {'type': 'crown', 'walls': ['w_mb_south', 'w_st_south']},
            {'type': 'picture_rail', 'room': 'living_dining'},
            {'type': 'unknown', 'wall': 'w_east_upper'},
            {'type': 'baseboard'},
        ],
    }) == [
        {'type': 'baseboard', 'wall': 'w_ent_south_w'},
        {'type': 'crown', 'wall': 'w_mb_south'},
        {'type': 'crown', 'wall': 'w_st_south'},
        {'type': 'picture_rail', 'room': 'living_dining'},
    ]


def test_room_boundary_wall_ids_match_only_exact_boundary_edges():
    geometry = {
        'rooms': [
            {'id': 'room_a', 'boundary': ['v1', 'v2', 'v3']},
            {'id': 'room_b', 'boundary': ['v2', 'v4', 'v3']},
        ],
        'walls': [
            {'id': 'w12', 'from': 'v1', 'to': 'v2'},
            {'id': 'w23', 'from': 'v3', 'to': 'v2'},
            {'id': 'w31', 'from': 'v3', 'to': 'v1'},
            {'id': 'w24', 'from': 'v2', 'to': 'v4'},
            {'id': 'w_spur', 'from': 'v1', 'to': 'v4'},
        ],
    }
    assert room_boundary_wall_ids(geometry, 'room_a') == ['w12', 'w23', 'w31']
    assert room_boundary_wall_ids(geometry, 'room_b') == ['w23', 'w24']
    assert room_boundary_wall_ids(geometry, 'missing') == []


def test_curtain_nodes_classify_by_layer():
    # 契约 <id>:<layer>:<variant>[:segment]：sheer→纱材质，blackout/blinds→布料
    assert classify(_obj('curtain_living_south:sheer:deployed')) == 'sheer'
    assert classify(_obj('curtain_living_south:sheer:gathered:left')) == 'sheer'
    assert classify(_obj('curtain_living_south:blackout:deployed')) == 'curtain_fabric'
    assert classify(_obj('curtain_living_south:blackout:gathered:right')) == 'curtain_fabric'
    assert classify(_obj('curtain_mbath_corner:blinds:deployed')) == 'curtain_fabric'
    assert classify(_obj('curtain_mbath_corner:blinds:gathered')) == 'curtain_fabric'
    # Blender 重名 .NNN 后缀不影响分类
    assert classify(_obj('curtain_living_south:sheer:deployed.001')) == 'sheer'
    # 玻璃幕节点（无冒号、含 curtain 字样）不受影响
    assert classify(_obj('west_curtain')) == 'exterior_glazing'
    assert classify(_obj('west_curtain:part=w_mb_south')) == 'exterior_glazing'
    assert classify(_obj('living_south_curtain')) == 'exterior_glazing'
    assert classify(_obj('sliding_door:sd01:pane:0')) == 'fluted_glass'
    assert classify(_obj('shower_screen:gbath')) == 'shower_glass'
    assert classify(_obj('bath:mb_mirror')) == 'mirror'


def test_bare_shell_visibility_hides_render_only_staging():
    class RenderOnlyObject:
        name = 'asset:ceiling:drop'
        parent = None

        @staticmethod
        def get(key, default=None):
            return {'render_only': True}.get(key, default)

    assert bare_shell_should_hide(RenderOnlyObject()) is True


def test_bare_shell_visibility_uses_furniture_type_and_parent_chain():
    kept = _obj('furniture:unit:wardrobe_180')
    hidden = _obj('furniture:unit:sofa_3seat')
    child = _obj('asset:sofa:glb')
    child.parent = hidden
    fixed = _obj('wall:custom_cabinet')
    assert bare_shell_should_hide(kept) is False
    assert bare_shell_should_hide(hidden) is True
    assert bare_shell_should_hide(child) is True
    assert bare_shell_should_hide(fixed) is False
    assert bare_shell_should_hide(_obj('asset:art:0')) is True


def test_bare_shell_hides_independent_movable_appliances_but_keeps_hardscape_assets():
    for appliance in ('fridge', 'washer', 'dryer', 'dishwasher', 'gas_stove',
                      'range_hood', 'water_heater'):
        assert bare_shell_should_hide(_obj(f'asset:{appliance}:glb')) is True
    assert bare_shell_should_hide(_obj('asset:kitchen_cabinet_run:glb')) is False
    assert bare_shell_should_hide(_obj('asset:wall_tile:glb')) is False


def test_curtain_hide_render_snapshot_restores_original_node_and_child_states():
    child = _obj('curtain_living_south:sheer:deployed:mesh')
    child.hide_render = True
    curtain = _obj('curtain_living_south:sheer:deployed')
    curtain.hide_render = False
    curtain.children_recursive = (child,)
    other = _obj('wall:plain')
    other.hide_render = True
    objects = (curtain, child, other)
    snapshot = _curtain_hide_render_snapshot(objects)
    curtain.hide_render = True
    child.hide_render = False
    _restore_curtain_hide_render(objects, snapshot)
    assert curtain.hide_render is False
    assert child.hide_render is True
    assert other.hide_render is True


def test_tv_wall_low_only_generates_independent_low_cabinet():
    parts = FURNITURE_PARTS['tv_wall_low']
    assert [part[0] for part in parts] == ['low']
    assert parts[0][3] == 'wood_dark'
    assert parts[0][1][1] < 0.5


def test_dec043_master_bath_layout_is_final_and_readable():
    layout = master_bath_final_layout()
    assert layout['vanity_size'] == (1.10, 0.50)
    assert layout['vanity_center_from_anchor'] == (0.29, 0.20)
    assert layout['partition_x'] == 1.11
    assert layout['partition_height'] == 1.05
    assert layout['screen_height_range'] == (1.05, 2.10)
    assert layout['screen_height_range'][0] == layout['partition_height']


def test_ceiling_finishing_staging_is_explicitly_render_only():
    source = (Path(__file__).resolve().with_name('dress_scene.py')).read_text()
    finishing = source.split('def add_ceiling_finishing', 1)[1].split('\ndef ', 1)[0]
    assert finishing.count("_mark_ceiling_finishing(o)") == 2
    assert finishing.count("o.name = 'asset:ceiling:drop'") == 1
    assert finishing.count("o.name = 'asset:ceiling:cove'") == 1
    assert "obj['render_only'] = True" in source
    assert "obj['geometrySource'] = 'blender_staging'" in source
    assert "_mark_render_only(obj, 'ceiling_finishing')" in source
    assert 'render-only staging' in finishing
    assert '正式设计清单或 GLB' in finishing


def test_ceiling_finishing_marker_sets_all_required_properties_without_bpy():
    from dress_scene import _mark_ceiling_finishing

    class FakeObject:
        def __init__(self):
            self.properties = {}

        def __setitem__(self, key, value):
            self.properties[key] = value

    obj = FakeObject()
    _mark_ceiling_finishing(obj)
    assert obj.properties == {
        'render_only': True,
        'geometrySource': 'blender_staging',
        'renderRole': 'ceiling_finishing',
    }


def test_soft_decor_staging_marks_rug_and_art_without_changing_geometry():
    source = (Path(__file__).resolve().with_name('blender_render_only.py')).read_text()
    soft_decor = source.split('def add_soft_decor', 1)[1].split('\ndef ', 1)[0]
    assert "'soft_decor:rug'" in soft_decor
    assert "'soft_decor:art_frame'" in soft_decor
    assert "'soft_decor:artwork_plane'" in soft_decor
    assert '_mark_render_only' in soft_decor
    assert '正式装饰若要进入设计交付，必须迁移到 house/shared/GLB' in soft_decor


def test_render_only_marker_and_visibility_logic_do_not_mark_formal_objects():
    class FakeObject:
        def __init__(self):
            self.properties = {}
            self.name = 'furniture:unit:wardrobe_180'
            self.parent = None

        def __getitem__(self, key):
            return self.properties[key]

        def get(self, key, default=None):
            return self.properties.get(key, default)

        def __setitem__(self, key, value):
            self.properties[key] = value

    staging = FakeObject()
    _mark_render_only(staging, 'soft_decor:rug')
    assert staging.properties == {
        'render_only': True,
        'geometrySource': 'blender_staging',
        'renderRole': 'soft_decor:rug',
    }
    assert _is_render_only(staging) is True
    assert bare_shell_should_hide(staging) is True

    formal = FakeObject()
    assert _is_render_only(formal) is False
    assert bare_shell_should_hide(formal) is False
    assert formal.properties == {}

    source = (Path(__file__).resolve().with_name('dress_scene.py')).read_text()
    dynamic = source.split('def _tag_dynamic_objects', 1)[1].split('\ndef ', 1)[0]
    assert 'or _is_render_only(obj)' in dynamic
    assert "obj['dress_dynamic'] = True" in dynamic


def test_blender_initialization_uses_shared_glb_and_explicit_render_only_postprocessing():
    source = (Path(__file__).resolve().with_name('dress_scene.py')).read_text()
    legacy_source = (Path(__file__).resolve().with_name('legacy_geometry.py')).read_text()
    initialize_scene = source.split('def initialize_scene', 1)[1].split('\ndef ', 1)[0]
    legacy_functions = (
        'place_extra_furniture', 'add_bath_fixtures', 'add_ceiling',
        'add_kitchen_cabinets',
    )
    assert '_configure_asset_modules()' in initialize_scene
    assert initialize_scene.index('read_factory_settings') < initialize_scene.index('_configure_asset_modules()')
    for function_name in legacy_functions:
        assert f'{function_name}(' not in initialize_scene
        assert f'def {function_name}(' in source
        assert f'def {function_name}(' in legacy_source
        function_source = source.split(f'def {function_name}(', 1)[1].split('\ndef ', 1)[0]
        assert 'Compatibility wrapper' in function_source
        assert 'LEGACY' in legacy_source.split(f'def {function_name}(', 1)[1].split('\ndef ', 1)[0]
    assert 'def _add_cabinet_seams(' in legacy_source
    assert 'def _add_cabinet_seams(' in source
    assert source.split('def _add_cabinet_seams(', 1)[1].split('\ndef ', 1)[0].count('bpy.ops') == 0
    assert legacy_source.count('def place_extra_furniture(') == 1
    assert legacy_source.count('def add_bath_fixtures(') == 1
    assert 'replace_furniture(' in initialize_scene
    assert 'add_lights(' in initialize_scene
    assert 'add_soft_decor(' in initialize_scene
    assert 'add_ceiling_finishing(' in initialize_scene
    assert 'add_moldings(' in initialize_scene
    assert 'rebuild_railings(' in initialize_scene
    assert '厨房正式几何（柜体、连续台面 bridge、sink/cooktop cutouts、家电位置）' in initialize_scene
    assert '由 shared/CLI GLB 提供；Blender 不再重建' in initialize_scene
    assert '正式卫浴几何由 shared plumbing/overlay/furnishing GLB 提供' in initialize_scene
    assert '正式灯具外形由 shared/CLI GLB 提供' in initialize_scene
    assert '基础吊顶几何由 shared SceneBuilder/CLI GLB 提供' in initialize_scene
    assert 'add_ceiling_finishing 暂为 render-only staging' in initialize_scene
    railing = source.split('def rebuild_railings', 1)[1].split('\ndef ', 1)[0]
    assert 'Prefer shared railing parts' in railing
    assert 'LEGACY solid fallback only when absent' in railing
    assert "ftype in ('kitchen_cabinet_run',)" not in source
    assert 'kitchen_cabinet_run' in source
    assert 'def _add_shower_fixture' in source
    assert 'def _add_shower_fixture' in legacy_source
    bath_fixtures = source.split('def add_bath_fixtures', 1)[1].split('\ndef ', 1)[0]
    assert "_add_shower_fixture('bath:mb_shower'" not in bath_fixtures
    assert "_add_shower_fixture('bath:gb_shower'" not in bath_fixtures
    assert '_add_guest_shower_screen' not in source
    assert 'bath:gb_shower_screen' not in source


def test_guest_shower_screen_is_declared_in_shared_overlay():
    overlay = (Path(__file__).resolve().parents[2] / 'config' / 'layout' / 'overlay.yaml').read_text()
    declaration = overlay.split('id: shower_screen_gbath', 1)[1].split('\n\n', 1)[0]
    assert 'type: shower_screen' in declaration
    assert 'points: [{ x: 7.10, z: 2.80 }, { x: 6.30, z: 2.80 }]' in declaration
    assert 'height: 1.95' in declaration
    assert 'sill: 0' in declaration


def test_master_bath_screen_geometry_is_not_rebuilt_in_blender_dress():
    source = (Path(__file__).resolve().with_name('dress_scene.py')).read_text()
    assert "bath:mb_partition" not in source
    assert "bath:mb_shower_screen" not in source
    assert 'shared overlay/GLB' in source


def test_sofa_target_is_28m_and_bbox_scale_preserves_low_profile():
    target = FURNITURE_GLB['sofa_3seat']
    assert target['width'] == 2.8
    assert target['height'] == 0.8
    # Burrard source bbox example: width-limited scaling would exceed neither target.
    assert uniform_asset_scale(2.8, 0.75, target) == 1.0
    assert math.isclose(uniform_asset_scale(3.5, 1.0, target), 0.8)


def test_effective_camera_config_applies_reviewed_camera_scenario_defaults():
    expected = {
        ('corridor_view', 'material_review'): -0.5,
        ('bedroom_nw_overview', 'material_review'): -0.5,
        ('bedroom_nw_overview', 'bare_shell'): -0.5,
        ('bedroom_floor_closeup', 'material_review'): 1.0,
        ('master_bath_overview', 'material_review'): -0.25,
        ('master_bath_overview', 'bare_shell'): -0.25,
        ('balcony_overview', 'material_review'): 0.0,
        ('living_from_entry', 'bare_shell'): 0.35,
        ('living_from_entry', 'material_review'): 0.35,
        ('living_floor_mid', 'material_review'): 0.35,
        ('living_sofa_glass', 'material_review'): -0.35,
        ('living_sofa_glass', 'bare_shell'): -0.35,
        ('living_sofa_glass', 'hvac_coordination'): -0.35,
    }
    for (camera_id, scenario_id), exposure in expected.items():
        assert effective_camera_config({'id': camera_id}, {'id': scenario_id})['exposure'] == exposure
    assert effective_camera_config({'id': 'balcony_overview'}, {'id': 'daylight'}) == {'id': 'balcony_overview'}


def test_effective_camera_config_applies_default_before_scenario_exposure():
    effective = effective_camera_config(
        {'id': 'master_bath_overview'}, {'id': 'material_review', 'exposure': 1.5},
    )
    assert effective['exposure'] == -0.25


def test_effective_camera_config_applies_default_when_camera_exposure_is_zero():
    for scenario_id in ('material_review', 'bare_shell'):
        effective = effective_camera_config(
            {'id': 'bedroom_nw_overview', 'exposure': 0},
            {'id': scenario_id, 'exposure': 1.5},
        )
        assert effective['exposure'] == -0.5


def test_effective_camera_config_applies_daylight_clear_sheer_opacity_override():
    effective = effective_camera_config(
        {'id': 'living_from_entry', 'scenario_overrides': {
            'daylight_clear': {'sheer_opacity': 0.45},
        }},
        {'id': 'daylight_clear'},
    )
    assert effective['sheer_opacity'] == 0.45


def test_effective_camera_config_keeps_nonzero_explicit_camera_exposure():
    effective = effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0.2},
        {'id': 'material_review', 'exposure': 0.5},
    )
    assert effective['exposure'] == 0.2


def test_approved_blenderkit_maps_follow_the_normal_rough_only_contract():
    project_root = Path(__file__).resolve().parents[2]
    expected = {
        'blenderkit_plain_natural_blackout': ('curtain_fabric', '#d8d0c2'),
        'blenderkit_light_oak_wood': ('wood_dark', '#503e2e'),
    }
    assert {item['texture_id'] for item in BLENDERKIT_PBR_CONTRACT} == set(expected)
    for item in BLENDERKIT_PBR_CONTRACT:
        texture_id = item['texture_id']
        texture_dir = project_root / 'assets' / 'textures' / texture_id
        assert (texture_dir / 'normal.jpg').is_file()
        assert (texture_dir / 'rough.jpg').is_file()
        assert not (texture_dir / 'diff.jpg').exists()
        assert item['with_diffuse'] is False
        assert item['tint'] is None
        assert item['base_color'] == expected[texture_id][1]

    assignments = _blenderkit_pbr_assignments(
        {'curtain_fabric': 'curtain-mat'}, {'wood_dark': 'wood-mat'},
    )
    assert [(row[0], row[1], row[3], row[5]) for row in assignments] == [
        ('wood-mat', 'blenderkit_light_oak_wood', False, None),
        ('curtain-mat', 'blenderkit_plain_natural_blackout', False, None),
    ]


def test_effective_camera_config_applies_bare_shell_default_before_scenario_exposure():
    effective = effective_camera_config(
        {'id': 'master_bath_overview'}, {'id': 'bare_shell', 'exposure': 1.5},
    )
    assert effective['exposure'] == -0.25


def test_living_from_entry_bare_shell_default_before_scenario_exposure():
    effective = effective_camera_config(
        {'id': 'living_from_entry'}, {'id': 'bare_shell', 'exposure': 0.5},
    )
    assert effective['exposure'] == 0.35


def test_daylight_living_cameras_use_scene_exposure_without_plus_035_override():
    daylight = {'id': 'daylight', 'exposure': -0.5}
    assert effective_camera_config({'id': 'living_from_entry'}, daylight)['exposure'] == -0.5
    assert effective_camera_config({'id': 'living_floor_mid'}, daylight)['exposure'] == -0.5


def test_living_from_entry_bare_shell_preserves_explicit_override_priority():
    assert effective_camera_config(
        {'id': 'living_from_entry', 'exposure': -0.2},
        {'id': 'bare_shell', 'exposure': 1.5},
    )['exposure'] == -0.2
    assert effective_camera_config(
        {'id': 'living_from_entry', 'scenario_overrides': {'bare_shell': {'exposure': 0.1}}},
        {'id': 'bare_shell', 'exposure': 1.5},
    )['exposure'] == 0.1


def test_effective_camera_config_prefers_explicit_camera_over_default_and_scenario_exposure():
    effective = effective_camera_config(
        {'id': 'living_from_entry', 'exposure': -0.2},
        {'id': 'material_review', 'exposure': 0.5},
    )
    assert effective['exposure'] == -0.2


def test_effective_camera_config_preserves_explicit_and_scenario_override_priority():
    assert effective_camera_config(
        {'id': 'living_from_entry', 'exposure': -0.2}, {'id': 'material_review'},
    )['exposure'] == -0.2
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0.2},
        {'id': 'material_review', 'exposure': 0.5},
    )['exposure'] == 0.2
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview',
         'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 0.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0,
         'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 0.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview'}, {'id': 'daylight', 'exposure': 1.5},
    )['exposure'] == 1.5
    assert effective_camera_config(
        {'id': 'master_bath_overview', 'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 0.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'living_floor_mid', 'scenario_overrides': {'daylight': {'exposure': 0.1}}},
        {'id': 'daylight'},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'living_sofa_glass', 'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 0.5},
    )['exposure'] == 0.1


def test_effective_camera_config_uses_scenario_exposure_without_matching_default():
    assert effective_camera_config(
        {'id': 'balcony_overview'}, {'id': 'daylight', 'exposure': 1.5},
    )['exposure'] == 1.5


def test_fill_light_zero_is_disabled_without_fallback_energy():
    assert fill_light_is_enabled(0) is False
    assert fill_light_is_enabled(80) is True
    assert fill_light_is_enabled(None) is False
    assert fill_light_is_enabled('80') is False


def test_job_state_resolves_visibility_and_explicit_zero_override():
    state = job_state(
        {'fill_light': 0, 'fill_from_camera': True},
        {'id': 'bare_shell', 'curtainPolicy': 'hidden_for_bare_shell',
         'lights_on': False, 'hvac_coordination': True, 'sheer_opacity': 0.22,
         'glass_ior': 1.02, 'glass_tint': '#ffffff'},
    )
    assert state['bare_shell'] is True
    assert state['curtain_policy'] == 'hidden_for_bare_shell'
    assert state['fill'] == 0
    assert state['fill_from_camera'] is True
    assert state['lights_on'] is False
    assert state['show_hvac'] is False
    assert state['sheer_opacity'] == 0.22
    assert state['glass_ior'] == 1.02


def test_job_state_defaults_and_rejects_unknown_curtain_policy():
    state = job_state({}, {'id': 'daylight'})
    assert state['lights_on'] is True
    assert state['show_hvac'] is False
    assert state['fill'] is None
    assert state['sheer_opacity'] == 0.15
    try:
        job_state({}, {'id': 'bad', 'curtainPolicy': 'guess'})
    except RuntimeError as exc:
        assert 'unknown curtainPolicy' in str(exc)
    else:
        raise AssertionError('unknown curtain policy must be blocked')


def test_floor_room_id_requires_stable_export_tag():
    assert floor_room_id('floor:master_bath') == 'master_bath'
    assert floor_room_id('floor:guest_bath.001') == 'guest_bath'
    assert floor_room_id('kitchen_floor') is None
    assert floor_room_id('floor:master_bath:fragment') is None


def test_projection_facts_and_plumbing_reject_missing_or_invalid_points():
    assert projection_facts({}) == {}
    facts = projection_facts({'facts': {'plumbing': [
        {'id': 'faucet_mbath_vanity', 'x': 2.6, 'z': 2.8},
        {'id': 'toilet_mbath', 'x': 'bad', 'z': 1.5},
    ]}})
    assert plumbing_by_id(facts) == {'faucet_mbath_vanity': {'id': 'faucet_mbath_vanity', 'x': 2.6, 'z': 2.8}}


def test_unrebuildable_curved_railing_is_classified_for_hiding():
    assert railing_bbox_is_rebuildable(0.1, 4.5) is True
    assert railing_bbox_is_rebuildable(4.5, 0.1) is True
    assert railing_bbox_is_rebuildable(1.0, 1.0) is False


def test_curved_railing_path_requires_sufficient_monotonic_mesh_evidence():
    assert curved_railing_path([(0.0, 0.0)] * 7) == []
    assert curved_railing_path([(0.00, 0.0), (0.01, 0.1), (0.02, 0.2), (0.03, 0.3),
                                (0.04, 0.4), (0.05, 0.5), (0.06, 0.6), (0.07, 0.7)]) == []
    path = curved_railing_path([(x * 0.1, x * x * 0.002) for x in range(8)])
    assert len(path) == 8
    assert path[0][0] == 0.0
    assert math.isclose(path[-1][0], 0.7)


if __name__ == '__main__':
    test_wet_room_wall_gets_tile()
    test_dry_room_wall_stays_paint()
    test_blender_duplicate_suffix_tolerated()
    test_other_wall_names_unchanged()
    test_floor_room_id_requires_stable_export_tag()
    test_projection_facts_and_plumbing_reject_missing_or_invalid_points()
    test_curtain_nodes_classify_by_layer()
    print('OK')
