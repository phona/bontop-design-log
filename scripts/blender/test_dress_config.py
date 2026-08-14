import sys
sys.path.insert(0, '.')
from dress_config import make_jobs

CONFIG = {
    'sun': [-0.954, 0.29, -0.077],
    'scenarios': [
        {'id': 'blue_hour', 'sun_direction': [-0.954, 0.29, -0.077]},
        {'id': 'night', 'sun_direction': [-0.734, 0.466, -0.494]},
    ],
    'cameras': [
        {'id': 'living_sofa_glass', 'position': [10.3, 1.55, 2.9], 'target': [9.6, 1.2, 8.6]},
        {'id': 'master_bed_looking_glass', 'position': [2.6, 1.5, 7.9], 'target': [2.8, 1.2, 9.4]},
    ],
}


def test_make_jobs_count():
    jobs = make_jobs(CONFIG, version='v1')
    assert len(jobs) == 4, f'expected 4 jobs, got {len(jobs)}'


def test_make_jobs_filename_and_direction():
    jobs = make_jobs(CONFIG, version='v1')
    names = [j['out_name'] for j in jobs]
    assert 'v1__living_sofa_glass__blue_hour' in names
    assert 'v1__master_bed_looking_glass__night' in names
    bh = next(j for j in jobs if j['scenario_id'] == 'blue_hour')
    assert bh['sun_direction'] == [-0.954, 0.29, -0.077]


def test_make_jobs_fallback_sun():
    cfg = dict(CONFIG)
    cfg['scenarios'] = [{'id': 'x'}]
    jobs = make_jobs(cfg, version='v1')
    assert jobs[0]['sun_direction'] == CONFIG['sun']


if __name__ == '__main__':
    test_make_jobs_count()
    test_make_jobs_filename_and_direction()
    test_make_jobs_fallback_sun()
    print('PASS')
