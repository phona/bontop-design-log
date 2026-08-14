import sys
sys.path.insert(0, '.')
from dress_config import make_jobs

CONFIG = {
    'scenarios': [
        {'id': 'blue_hour', 'sun_direction': None, 'world_color': '#3a5a8f', 'world_strength': 0.5},
        {'id': 'night', 'sun_direction': None, 'world_color': '#060a14', 'world_strength': 0.06},
    ],
    'cameras': [
        {'id': 'living_sofa_glass', 'position': [10.3, 1.55, 2.9], 'target': [9.6, 1.2, 8.6]},
        {'id': 'master_bed_looking_glass', 'position': [3.4, 1.55, 6.4], 'target': [1.5, 1.0, 9.8]},
    ],
}


def test_make_jobs_count():
    jobs = make_jobs(CONFIG, version='v1')
    assert len(jobs) == 4, f'expected 4 jobs, got {len(jobs)}'


def test_make_jobs_filename_and_scenario():
    jobs = make_jobs(CONFIG, version='v1')
    names = [j['out_name'] for j in jobs]
    assert 'v1__living_sofa_glass__blue_hour' in names
    assert 'v1__master_bed_looking_glass__night' in names
    bh = next(j for j in jobs if j['scenario_id'] == 'blue_hour')
    assert bh['scenario']['world_color'] == '#3a5a8f'
    assert bh['scenario']['world_strength'] == 0.5


if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename_and_scenario()
    print('PASS')
