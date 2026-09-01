import copy
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dress_config import make_jobs

bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)
from dress_scene import (  # noqa: E402
    _set_eevee_samples,
    effective_camera_config,
)
from blender_render_only import (  # noqa: E402
    STUDY_WORK_DETAIL_FITNESS_TYPES,
    study_work_detail_fitness_objects,
    study_work_detail_should_hide_fitness,
)

CONFIG = {
    'scenarios': [
        {'id': 'blue_hour', 'sun_direction': None, 'world_color': '#3a5a8f', 'world_strength': 0.5},
        {'id': 'night', 'sun_direction': None, 'world_color': '#060a14', 'world_strength': 0.06},
        {'id': 'material_review', 'sun_direction': None, 'world_color': '#808080', 'world_strength': 0.3},
        {'id': 'hvac_coordination', 'sun_direction': None, 'world_color': '#808080', 'world_strength': 0.3, 'hvac_coordination': True},
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
    assert len(jobs) == 9, f'expected 9 jobs, got {len(jobs)}'


def test_make_jobs_filename_and_scenario():
    jobs = make_jobs(CONFIG, version='v1')
    names = [j['out_name'] for j in jobs]
    assert 'v1__living_sofa_glass__blue_hour' in names
    assert 'v1__master_bed_looking_glass__night' in names
    bh = next(j for j in jobs if j['scenario_id'] == 'blue_hour')
    assert bh['scenario']['world_color'] == '#3a5a8f'
    assert bh['scenario']['world_strength'] == 0.5


def test_make_jobs_scenario_filter():
    jobs = make_jobs(CONFIG, version='v1', scenario_id='night')
    assert len(jobs) == 2
    assert {job['scenario_id'] for job in jobs} == {'night'}
    assert {job['camera_id'] for job in jobs} == {'living_sofa_glass', 'master_bed_looking_glass'}


def test_make_jobs_camera_scenario_filter():
    jobs = make_jobs(CONFIG, version='v1')
    closeup = [j for j in jobs if j['camera_id'] == 'living_floor_closeup']
    assert [j['scenario_id'] for j in closeup] == ['material_review'], \
        f'closeup camera should only render material_review, got {[j["scenario_id"] for j in closeup]}'
    # 无过滤字段的相机出全部工况
    pan = [j for j in jobs if j['camera_id'] == 'living_sofa_glass']
    assert len(pan) == 4


def test_hvac_coordination_is_explicit_scenario_flag():
    scenario = next(item for item in CONFIG['scenarios'] if item['id'] == 'hvac_coordination')
    normal = next(item for item in CONFIG['scenarios'] if item['id'] == 'material_review')
    assert scenario['hvac_coordination'] is True
    assert normal.get('hvac_coordination', False) is False


def test_study_work_detail_fitness_policy_is_camera_specific():
    assert study_work_detail_should_hide_fitness('study_work_detail') is True
    assert study_work_detail_should_hide_fitness('study_overview') is False
    assert study_work_detail_should_hide_fitness('bedroom_se_relation') is False
    assert study_work_detail_should_hide_fitness('entry') is False


def test_study_work_detail_fitness_objects_include_real_glb_keys_and_children():
    class Obj:
        def __init__(self, name, parent=None, **properties):
            self.name = name
            self.parent = parent
            self.properties = properties

        def get(self, key, default=None):
            return self.properties.get(key, default)

    objects = []
    for index, furniture_type in enumerate(sorted(STUDY_WORK_DETAIL_FITNESS_TYPES)):
        root = Obj(f'furniture:bedroom_se:{"hash" + str(index)}:part={furniture_type}')
        child = Obj(f'furniture:bedroom_se:{"hash" + str(index)}:part=frame', parent=root)
        objects.extend((root, child))
    property_root = Obj(
        'mesh:fitness:part',
        objectId='furniture:study:fitness_hash:part=barbell_olympic',
    )
    property_child = Obj('mesh:plate', parent=property_root)
    other_room = Obj('furniture:bedroom_nw:squat_rack:0')
    unrelated = Obj('furniture:study:desk:0')
    selected = study_work_detail_fitness_objects(
        objects + [property_root, property_child, other_room, unrelated],
    )
    assert selected == objects + [property_root, property_child]
    assert STUDY_WORK_DETAIL_FITNESS_TYPES == {
        'squat_rack', 'bench_adjustable', 'barbell_olympic', 'rubber_training_mat',
    }


def test_effective_camera_config_matches_scenario_and_has_priority():
    camera = {
        'id': 'living_west_wall', 'exposure': 0.2, 'fill_light': 10,
        'scenario_overrides': {'blue_hour': {'exposure': -0.5, 'fill_light': 40, 'fill_from_camera': True}},
    }
    effective = effective_camera_config(camera, {'id': 'blue_hour', 'exposure': 0.5, 'fill_light': 80})
    assert effective['exposure'] == 0.2
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
    assert effective['exposure'] == 0.2
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


def test_set_eevee_samples():
    scene = types.SimpleNamespace(eevee=types.SimpleNamespace(taa_render_samples=64))
    _set_eevee_samples(scene, 8)
    assert scene.eevee.taa_render_samples == 8


def test_set_eevee_samples_rejects_zero():
    scene = types.SimpleNamespace(eevee=types.SimpleNamespace(taa_render_samples=64))
    with pytest.raises(ValueError):
        _set_eevee_samples(scene, 0)


if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename_and_scenario()
    test_make_jobs_camera_scenario_filter()
    test_effective_camera_config_matches_scenario_and_has_priority()
    print('PASS')
