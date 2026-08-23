import copy
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dress_config import make_jobs

bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)
from dress_scene import effective_camera_config  # noqa: E402

CONFIG = {
    'scenarios': [
        {'id': 'blue_hour', 'sun_direction': None, 'world_color': '#3a5a8f', 'world_strength': 0.5},
        {'id': 'night', 'sun_direction': None, 'world_color': '#060a14', 'world_strength': 0.06},
        {'id': 'material_review', 'sun_direction': None, 'world_color': '#808080', 'world_strength': 0.3},
    ],
    'cameras': [
        {'id': 'living_sofa_glass', 'position': [10.3, 1.55, 2.9], 'target': [9.6, 1.2, 8.6]},
        {'id': 'master_bed_looking_glass', 'position': [3.4, 1.55, 6.4], 'target': [1.5, 1.0, 9.8]},
        {'id': 'living_floor_closeup', 'position': [9.9, 1.4, 6.1], 'target': [9.3, 0.0, 7.4],
         'lens': 35, 'scenarios': ['material_review']},
    ],
}


def test_make_jobs_count():
    jobs = make_jobs(CONFIG, version='v1')
    assert len(jobs) == 7, f'expected 7 jobs, got {len(jobs)}'


def test_make_jobs_filename_and_scenario():
    jobs = make_jobs(CONFIG, version='v1')
    names = [j['out_name'] for j in jobs]
    assert 'v1__living_sofa_glass__blue_hour' in names
    assert 'v1__master_bed_looking_glass__night' in names
    bh = next(j for j in jobs if j['scenario_id'] == 'blue_hour')
    assert bh['scenario']['world_color'] == '#3a5a8f'
    assert bh['scenario']['world_strength'] == 0.5


def test_make_jobs_camera_scenario_filter():
    jobs = make_jobs(CONFIG, version='v1')
    closeup = [j for j in jobs if j['camera_id'] == 'living_floor_closeup']
    assert [j['scenario_id'] for j in closeup] == ['material_review'], \
        f'closeup camera should only render material_review, got {[j["scenario_id"] for j in closeup]}'
    # 无过滤字段的相机出全部工况
    pan = [j for j in jobs if j['camera_id'] == 'living_sofa_glass']
    assert len(pan) == 3


def test_effective_camera_config_matches_scenario_and_has_priority():
    camera = {
        'id': 'living_west_wall', 'exposure': 0.2, 'fill_light': 10,
        'scenario_overrides': {'blue_hour': {'exposure': -0.5, 'fill_light': 40, 'fill_from_camera': True}},
    }
    effective = effective_camera_config(camera, {'id': 'blue_hour', 'exposure': 0.5, 'fill_light': 80})
    assert effective['exposure'] == -0.5
    assert effective['fill_light'] == 40
    assert effective['fill_from_camera'] is True


def test_effective_camera_config_rejects_illegal_fields_and_does_not_mutate_inputs(capsys):
    camera = {
        'id': 'camera', 'exposure': 0.2,
        'scenario_overrides': {'blue_hour': {'exposure': -0.5, 'world_color': '#000000', 'lights_on': False}},
    }
    original = copy.deepcopy(camera)
    scenario = {'id': 'blue_hour', 'world_color': '#3a5a8f', 'lights_on': True}
    effective = effective_camera_config(camera, scenario)
    assert effective['exposure'] == -0.5
    assert 'world_color' not in effective
    assert 'lights_on' not in effective
    assert camera == original
    assert scenario == {'id': 'blue_hour', 'world_color': '#3a5a8f', 'lights_on': True}
    assert 'ignored fields: lights_on, world_color' in capsys.readouterr().out


def test_effective_camera_config_without_matching_override_is_unchanged():
    camera = {'id': 'camera', 'exposure': 0.2, 'scenario_overrides': {'night': {'exposure': -0.5}}}
    effective = effective_camera_config(camera, {'id': 'blue_hour', 'exposure': 0.5})
    assert effective == camera
    assert effective is not camera


if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename_and_scenario()
    test_make_jobs_camera_scenario_filter()
    test_effective_camera_config_matches_scenario_and_has_priority()
    print('PASS')
