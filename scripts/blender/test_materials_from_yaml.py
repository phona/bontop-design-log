import sys
sys.path.insert(0, '.')
from materials_from_yaml import resolve_scheme

MATS = {
    'floor_tile_01': {'id': 'floor_tile_01', 'appearance': {'type': 'wood_plank', 'color': '#c49a6c'}},
    'latex_paint_01': {'id': 'latex_paint_01', 'appearance': {'type': 'solid_color', 'color': '#f7f5ef'}},
    'sofa_3seat_01': {'id': 'sofa_3seat_01', 'appearance': {'type': 'solid_color', 'color': '#8a6f52'}},
    'missing_01': {'id': 'missing_01', 'appearance': {'type': 'solid_color', 'color': '#000000'}},
}


def test_resolve_scheme_basic():
    scheme = {
        'selections': {
            'floor': {'default': 'floor_tile_01'},
            'paint': {'default': 'latex_paint_01'},
            'sofa': {'default': 'sofa_3seat_01'},
        }
    }
    resolved = resolve_scheme(scheme, MATS)
    assert resolved == {'floor': 'floor_tile_01', 'wall': 'latex_paint_01', 'furniture': 'sofa_3seat_01'}, resolved


def test_resolve_scheme_skips_missing():
    scheme = {'selections': {'floor': {'default': 'not_in_library_xyz'}, 'hvac': {'default': 'A2'}}}
    resolved = resolve_scheme(scheme, MATS)
    assert 'floor' not in resolved
    assert 'hvac' not in resolved


def test_resolve_scheme_empty():
    assert resolve_scheme({}, MATS) == {}
    assert resolve_scheme({'selections': {}}, MATS) == {}


if __name__ == '__main__':
    test_resolve_scheme_basic()
    test_resolve_scheme_skips_missing()
    test_resolve_scheme_empty()
    print('PASS')
