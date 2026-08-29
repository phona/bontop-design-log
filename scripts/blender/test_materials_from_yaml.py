import sys
import types
from pathlib import Path

sys.path.insert(0, '.')
from materials_from_yaml import (
    build_yaml_materials,
    resolve_external_pbr,
    resolve_floor_overrides,
    resolve_render_role_profiles,
    resolve_scheme,
    FIXTURE_FACTORY_ROLES,
)
from wood_texture import ensure_wood_textures

class _Socket:
    def __init__(self):
        self.default_value = None
        self.links = []


class _SocketMap(dict):
    def __getitem__(self, key):
        return self.setdefault(key, _Socket())

    def get(self, key, default=None):
        return dict.get(self, key, default)


class _Node:
    def __init__(self, bl_idname):
        self.bl_idname = bl_idname
        self.inputs = _SocketMap()
        self.outputs = _SocketMap()
        if bl_idname == 'ShaderNodeBsdfPrincipled':
            for name in ('Base Color', 'Roughness', 'Metallic', 'Transmission Weight', 'IOR',
                         'Coat Weight', 'Alpha', 'Normal'):
                self.inputs[name] = _Socket()
        self.wave_type = None
        self.bands_direction = None


class _Nodes(list):
    def new(self, bl_idname):
        node = _Node(bl_idname)
        self.append(node)
        return node


class _Links:
    def new(self, output, input_socket):
        input_socket.links.append(output)


class _NodeTree:
    def __init__(self):
        self.nodes = _Nodes([_Node('ShaderNodeBsdfPrincipled'), _Node('ShaderNodeOutputMaterial')])
        self.links = _Links()


class _Material:
    def __init__(self, name):
        self.name = name
        self.node_tree = _NodeTree()


class _Materials:
    def new(self, name):
        return _Material(name)


def _install_bpy_stub(monkeypatch):
    monkeypatch.setitem(sys.modules, 'bpy', types.SimpleNamespace(data=types.SimpleNamespace(materials=_Materials())))


MATS = {
    'floor_tile_01': {'id': 'floor_tile_01', 'appearance': {'type': 'wood_plank', 'color': '#c49a6c'}},
    'latex_paint_01': {'id': 'latex_paint_01', 'appearance': {'type': 'solid_color', 'color': '#f7f5ef'}},
    'sofa_3seat_01': {'id': 'sofa_3seat_01', 'appearance': {'type': 'solid_color', 'color': '#8a6f52'}},
    'missing_01': {'id': 'missing_01', 'appearance': {'type': 'solid_color', 'color': '#000000'}},
}


def test_render_role_profiles_resolve_records_and_appearance():
    spec = resolve_render_role_profiles(MATS, {
        'tv_frame': 'latex_paint_01',
        'fabric': 'sofa_3seat_01',
    })
    assert spec['errors'] == []
    assert spec['roles']['tv_frame']['material_id'] == 'latex_paint_01'
    assert spec['roles']['fabric']['appearance']['color'] == '#8a6f52'
    assert spec['roles']['tv_frame']['pbr'] == {
        'type': 'solid_color', 'texture_id': None, 'resource_root': None,
        'resources': {}, 'tile_size': None, 'tint': None,
        'normal_strength': 1.0, 'preserve_base_color': False, 'profile': None,
    }


def test_render_role_profiles_reject_unknown_role_and_material():
    spec = resolve_render_role_profiles(MATS, {
        'not_a_glb_role': 'latex_paint_01',
        'tv_screen': 'missing_material',
        'fabric': '',
    })
    assert 'unknown render role' in '; '.join(spec['errors'])
    assert 'unknown material' in '; '.join(spec['errors'])
    assert 'must reference a material id' in '; '.join(spec['errors'])
    assert spec['roles'] == {}


def test_render_role_profiles_missing_config_is_explicit_warning():
    spec = resolve_render_role_profiles(MATS, None)
    assert spec['errors'] == []
    assert spec['roles'] == {}
    assert spec['warnings'] == ['render_roles is not configured']


def test_render_role_profiles_descriptor_preserves_pbr_application_inputs():
    mats = {
        'kit': {'id': 'kit', 'appearance': {
            'type': 'external_pbr', 'texture_id': 'wall_kit',
            'resource_root': 'assets/textures/wall_kit',
            'resources': {'normal': 'normal.png'}, 'tile_size': 2.5,
            'tint': '#d8c0a0', 'normal_strength': 0.6,
            'base_color_mode': 'preserve_color',
        }},
    }
    spec = resolve_render_role_profiles(mats, {'fabric': 'kit'})
    assert spec['errors'] == []
    assert spec['roles']['fabric']['pbr'] == {
        'type': 'external_pbr', 'texture_id': 'wall_kit',
        'resource_root': 'assets/textures/wall_kit',
        'resources': {'normal': 'normal.png'}, 'tile_size': 2.5,
        'tint': '#d8c0a0', 'normal_strength': 0.6,
        'preserve_base_color': True, 'profile': None,
    }


def test_render_role_profiles_marks_unknown_appearance_type():
    mats = {'bad': {'id': 'bad', 'appearance': {'type': 'future_shader'}}}
    spec = resolve_render_role_profiles(mats, {'fabric': 'bad'})
    assert spec['errors'] == []
    assert spec['roles']['fabric']['pbr']['unsupported'] is True


def test_real_yaml_render_role_contract_and_glazing_profiles():
    import yaml
    root = Path(__file__).resolve().parents[2]
    doc = yaml.safe_load((root / 'config' / 'materials.yaml').read_text())
    mats = {item['id']: item for item in doc['materials']}
    spec = resolve_render_role_profiles(mats, doc['render_roles'])
    assert spec['errors'] == []
    assert set(FIXTURE_FACTORY_ROLES) <= set(spec['roles'])
    exterior = mats['curtain_wall_01']['appearance']
    assert exterior['profile'] == 'low_e'
    assert 'fluted' not in exterior
    assert 'bump' not in exterior
    assert spec['roles']['fluted_glass']['appearance']['profile'] == 'fluted'
    assert spec['roles']['shower_glass']['appearance']['profile'] == 'shower_glass'
    assert spec['roles']['mirror']['appearance']['profile'] == 'mirror'


def test_required_render_role_contract_reports_missing_roles():
    spec = resolve_render_role_profiles(MATS, {'fabric': 'sofa_3seat_01'}, {'mirror'})
    assert any('missing required render roles: mirror' in error for error in spec['errors'])


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


def test_project_floor_default_is_the_wood_plank_material():
    import yaml

    root = Path(__file__).resolve().parents[2]
    materials = yaml.safe_load((root / 'config' / 'materials.yaml').read_text())['materials']
    floor = next(material for material in materials if material['id'] == 'floor_pbr_tile_612')
    assert floor['topic_id'] == 'floor'
    assert floor['appearance']['type'] == 'wood_plank'
    assert floor['appearance']['plank_mm'] == [600, 1200]


def test_floor_resolver_covers_default_and_room_override_without_cross_contamination():
    floor = {
        'default': 'floor_pbr_tile_612',
        'roomOverrides': {'master_bath': 'floor_tile_01'},
    }
    mats = {**MATS, 'floor_pbr_tile_612': {
        'id': 'floor_pbr_tile_612',
        'appearance': {'type': 'wood_plank', 'plank_mm': [600, 1200]},
    }}
    assert resolve_scheme({'selections': {}}, mats, floor)['floor'] == 'floor_pbr_tile_612'
    assert resolve_floor_overrides(floor, mats) == {'master_bath': 'floor_tile_01'}


def test_bundle_root_wood_cache_generates_and_reuses_three_pngs(tmp_path):
    bundle = tmp_path / 'bundle'
    cache = bundle / 'renders' / 'blender' / 'textures'
    appearance = {'type': 'wood_plank', 'color': '#c49a6c', 'pattern': 'straight', 'plank_mm': [600, 1200], 'finish': 'soft', 'seed': 42}
    first = ensure_wood_textures('floor_pbr_tile_612', appearance, str(cache), canvas=128)
    second = ensure_wood_textures('floor_pbr_tile_612', appearance, str(cache), canvas=128)
    assert first == second
    assert all(Path(path).is_file() and Path(path).parent == cache for path in first[:3])
    assert [Path(path).suffix for path in first[:3]] == ['.png', '.png', '.png']


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
