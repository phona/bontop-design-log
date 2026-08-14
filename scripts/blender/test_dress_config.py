import sys
sys.path.insert(0, '.')
from dress_config import make_jobs

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


if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename_and_scenario()
    test_make_jobs_camera_scenario_filter()
    print('PASS')
