"""Pure HVAC coordination helpers: no Blender installation required."""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
bpy_stub = types.ModuleType('bpy')
bpy_stub.types = types.SimpleNamespace(Object=object)
sys.modules.setdefault('bpy', bpy_stub)

from dress_scene import hvac_diagram, hvac_reference_constraints, hvac_route_segments  # noqa: E402


DIAGRAM = {
    'reference_constraints': [{
        'id': 'south_band', 'status': 'inferred',
        'source': 'survey/neighbor_ys01_original_structure_2025-06.png',
        'uncertainty_m': 0.15, 'not_for_construction': True,
        'range': {'x1': 1, 'x2': 2, 'z1': 3, 'z2': 3.2},
        'reference_beam_bottom_y': 2.73, 'reason': 'neighbor reference',
        'survey_confirmation': 'measure own beam',
    }],
    'anchors': [
        {'id': 'outdoor', 'position': {'x': 1, 'y': 0.35, 'z': 2}},
        {'id': 'bend', 'position': {'x': 2, 'y': 2.5, 'z': 2}},
        {'id': 'branch_master', 'position': {'x': 2.5, 'y': 2.5, 'z': 2}},
    ],
    'terminals': [
        {'id': 'indoor', 'position': {'x': 3, 'y': 2.85, 'z': 2}},
        {'id': 'indoor_master', 'position': {'x': 4, 'y': 2.85, 'z': 2}},
    ],
    'routes': [
        {'id': 'trunk', 'status': 'inferred', 'from': 'outdoor', 'via': ['bend'], 'to': 'indoor'},
        {'id': 'master_branch', 'status': 'inferred', 'from': 'bend', 'via': ['branch_master'], 'to': 'indoor_master'},
    ],
}


def test_only_implemented_hvac_exposes_diagram():
    assert hvac_diagram({'hvac': {'status': 'implemented', 'diagram': DIAGRAM}}) == DIAGRAM
    assert hvac_diagram({'hvac': {'status': 'unimplemented'}}) is None
    assert hvac_diagram({}) is None


def test_reference_constraints_are_explicitly_gated_and_keep_only_safe_neighbor_references():
    facts = {'hvac': {'status': 'implemented', 'diagram': DIAGRAM}}
    assert hvac_reference_constraints(facts, show_constraints=False) == []
    assert hvac_reference_constraints(facts, show_constraints=True) == DIAGRAM['reference_constraints']
    bad = {**DIAGRAM, 'reference_constraints': [
        {**DIAGRAM['reference_constraints'][0], 'status': 'confirmed'},
        {**DIAGRAM['reference_constraints'][0], 'id': 'wrong-source', 'source': 'own-survey'},
    ]}
    assert hvac_reference_constraints({'hvac': {'status': 'implemented', 'diagram': bad}}, show_constraints=True) == []


def test_route_segments_follow_declared_refs_and_via_points():
    segments = hvac_route_segments(DIAGRAM)
    assert len(segments) == 4
    assert segments[0]['route']['id'] == 'trunk'
    assert segments[0]['start'] == {'x': 1, 'y': 0.35, 'z': 2}
    assert segments[1]['end'] == {'x': 3, 'y': 2.85, 'z': 2}
    assert segments[2]['route']['id'] == 'master_branch'
    assert segments[3]['end'] == {'x': 4, 'y': 2.85, 'z': 2}


def test_unresolved_route_is_not_inferred():
    bad = {**DIAGRAM, 'routes': [{'id': 'bad', 'from': 'outdoor', 'to': 'missing'}]}
    assert hvac_route_segments(bad) == []


if __name__ == '__main__':
    test_only_implemented_hvac_exposes_diagram()
    test_reference_constraints_are_explicitly_gated_and_keep_only_safe_neighbor_references()
    test_route_segments_follow_declared_refs_and_via_points()
    test_unresolved_route_is_not_inferred()
    print('OK')
