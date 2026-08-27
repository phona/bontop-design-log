import sys
from pathlib import Path

sys.path.insert(0, '.')
from materials_from_yaml import resolve_external_pbr, resolve_floor_overrides, resolve_scheme

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


def test_projection_floor_overrides_are_independent_of_scheme_floor():
    scheme = {'selections': {'floor': {'default': 'missing_01'}, 'paint': {'default': 'latex_paint_01'}}}
    floor = {'default': 'floor_tile_01', 'roomOverrides': {'master_bath': 'floor_tile_01'}}
    resolved = resolve_scheme(scheme, MATS, floor)
    assert resolved['floor'] == 'floor_tile_01'
    assert resolved['wall'] == 'latex_paint_01'
    assert resolve_floor_overrides(floor, MATS) == {'master_bath': 'floor_tile_01'}


def test_floor_overrides_skip_unknown_materials():
    assert resolve_floor_overrides({'roomOverrides': {'master_bath': 'unknown'}}, MATS) == {}


def _touch_pbr(root: Path, *names: str):
    tex_dir = root / 'assets' / 'textures' / 'kit_wall'
    tex_dir.mkdir(parents=True, exist_ok=True)
    for name in names:
        (tex_dir / name).touch()


def test_external_pbr_preserves_color_and_requires_non_color_maps(tmp_path):
    _touch_pbr(tmp_path, 'normal.jpg', 'rough.jpg')
    spec = resolve_external_pbr({
        'type': 'external_pbr',
        'texture_id': 'kit_wall',
        'color': '#e8e1d2',
        'base_color_mode': 'preserve_color',
    }, str(tmp_path))
    assert spec['preserve_color'] is True
    assert spec['paths'] == {
        'normal': str(tmp_path / 'assets' / 'textures' / 'kit_wall' / 'normal.jpg'),
        'roughness': str(tmp_path / 'assets' / 'textures' / 'kit_wall' / 'rough.jpg'),
    }
    assert spec['errors'] == []


def test_external_pbr_explicit_resources_and_optional_channels(tmp_path):
    _touch_pbr(tmp_path, 'normal.jpg', 'rough.jpg')
    (tmp_path / 'ao.png').touch()
    spec = resolve_external_pbr({
        'type': 'blenderkit_pbr',
        'resource_root': 'assets/textures/kit_wall',
        'resources': {
            'normal': 'assets/textures/kit_wall/normal.jpg',
            'roughness': 'assets/textures/kit_wall/rough.jpg',
            'ao': 'ao.png',
            'bump': 'missing-bump.png',
        },
        'base_color_mode': 'preserve_color',
    }, str(tmp_path))
    assert spec['errors'] == []
    assert 'ao' in spec['paths']
    assert 'bump' not in spec['paths']
    assert any('optional bump' in warning for warning in spec['warnings'])


def test_external_pbr_accepts_diffuse_alias(tmp_path):
    _touch_pbr(tmp_path, 'normal.jpg', 'rough.jpg')
    (tmp_path / 'diffuse.png').touch()
    spec = resolve_external_pbr({
        'type': 'external_pbr',
        'texture_id': 'kit_wall',
        'resources': {'diffuse': 'diffuse.png'},
    }, str(tmp_path))
    assert spec['errors'] == []
    assert spec['paths']['base_color'] == str(tmp_path / 'diffuse.png')


def test_external_pbr_missing_required_resource_is_explicit(tmp_path):
    spec = resolve_external_pbr({
        'type': 'external_pbr',
        'texture_id': 'not_downloaded',
        'base_color_mode': 'preserve_color',
    }, str(tmp_path))
    assert any('required normal' in error for error in spec['errors'])
    assert any('required roughness' in error for error in spec['errors'])


def test_external_pbr_rejects_resource_root_escape(tmp_path):
    spec = resolve_external_pbr({
        'type': 'external_pbr',
        'resource_root': '../outside',
        'base_color_mode': 'preserve_color',
    }, str(tmp_path))
    assert any('under config_dir' in error for error in spec['errors'])
    assert spec['paths'] == {}


if __name__ == '__main__':
    test_resolve_scheme_basic()
    test_resolve_scheme_skips_missing()
    test_resolve_scheme_empty()
    test_projection_floor_overrides_are_independent_of_scheme_floor()
    test_floor_overrides_skip_unknown_materials()
    print('PASS')
