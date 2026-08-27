"""dress_scene.classify 墙段房间归属单测：wall:seg:N:room= 命中湿区 → wall_tile。
bpy 仅在函数体内使用，stub 顶层导入即可脱离 Blender 运行。"""
import math
import os
from pathlib import Path
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)

from dress_scene import (  # noqa: E402
    _curtain_hide_render_snapshot,
    _restore_curtain_hide_render,
    bare_shell_should_hide,
    classify,
    effective_camera_config,
    parse_molding_declarations,
    room_boundary_wall_ids,
    fill_light_is_enabled,
    floor_room_id,
    job_state,
    plumbing_by_id,
    projection_facts,
    curved_railing_path,
    railing_bbox_is_rebuildable,
    master_bath_final_layout,
    uniform_asset_scale,
    BLENDERKIT_PBR_CONTRACT,
    _blenderkit_pbr_assignments,
    FURNITURE_GLB,
    FURNITURE_PARTS,
)


def _obj(name):
    return types.SimpleNamespace(name=name, parent=None)


def test_wet_room_wall_gets_tile():
    assert classify(_obj('wall:seg:3:room=kitchen|living_dining')) == 'wall_tile'
    assert classify(_obj('wall:seg:7:room=master_bath')) == 'wall_tile'
    assert classify(_obj('wall:seg:9:room=balcony')) == 'wall_tile'


def test_dry_room_wall_stays_paint():
    assert classify(_obj('wall:seg:1:room=living_dining|study')) == 'wall'
    assert classify(_obj('wall:seg:2')) == 'wall'  # 无归属（旧 GLB）


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
    assert classify(_obj('west_curtain')) == 'glass'
    assert classify(_obj('living_south_curtain')) == 'glass'


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
        ('living_from_entry', 'daylight'): 0.35,
        ('living_floor_mid', 'material_review'): 0.35,
        ('living_floor_mid', 'daylight'): 0.35,
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


def test_effective_camera_config_keeps_nonzero_explicit_camera_exposure():
    effective = effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0.2},
        {'id': 'material_review', 'exposure': 1.5},
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
        {'id': 'living_from_entry'}, {'id': 'bare_shell', 'exposure': 1.5},
    )
    assert effective['exposure'] == 0.35


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
        {'id': 'material_review', 'exposure': 1.5},
    )
    assert effective['exposure'] == -0.2


def test_effective_camera_config_preserves_explicit_and_scenario_override_priority():
    assert effective_camera_config(
        {'id': 'living_from_entry', 'exposure': -0.2}, {'id': 'material_review'},
    )['exposure'] == -0.2
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0.2},
        {'id': 'material_review', 'exposure': 1.5},
    )['exposure'] == 0.2
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview',
         'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 1.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview', 'exposure': 0,
         'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 1.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'bedroom_nw_overview'}, {'id': 'daylight', 'exposure': 1.5},
    )['exposure'] == 1.5
    assert effective_camera_config(
        {'id': 'master_bath_overview', 'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 1.5},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'living_floor_mid', 'scenario_overrides': {'daylight': {'exposure': 0.1}}},
        {'id': 'daylight'},
    )['exposure'] == 0.1
    assert effective_camera_config(
        {'id': 'living_sofa_glass', 'scenario_overrides': {'material_review': {'exposure': 0.1}}},
        {'id': 'material_review', 'exposure': 1.5},
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
