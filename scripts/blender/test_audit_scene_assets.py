"""Offline tests for audit_scene_assets; no Blender installation required."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_scene_assets import (  # noqa: E402
    _parse_args,
    _select_job,
    _uses_dressed_scene,
    audit_mesh_object,
    audit_scene,
    aggregate_visible_sources,
    bbox_info,
    classify_object,
    format_report,
)


class VecMatrix:
    def __matmul__(self, point):
        return point


class Socket:
    def __init__(self, value=None, links=()):
        self.default_value = value
        self.links = list(links)


class Node:
    def __init__(self, name, node_type, image=None, inputs=None):
        self.name = name
        self.type = node_type
        self.bl_idname = "ShaderNodeBsdfPrincipled" if node_type == "BSDF_PRINCIPLED" else node_type
        self.image = image
        self.inputs = inputs or {}


class Image:
    def __init__(self, name, filepath, packed=False):
        self.name = name
        self.filepath = filepath
        self.filepath_raw = filepath
        self.packed_file = object() if packed else None


def _scene_object(name="asset:sofa:glb", **props):
    image = Image("fabric", "//fabric.jpg", packed=True)
    tex = Node("Fabric Texture", "TEX_IMAGE", image=image)
    base = Socket((0.2, 0.3, 0.4, 1), links=[SimpleNamespace(
        from_node=tex, from_socket=SimpleNamespace(name="Color")
    )])
    normal = Socket((0, 0, 0, 1))
    rough = Socket(0.7)
    principled = Node("Principled BSDF", "BSDF_PRINCIPLED",
                      inputs={"Base Color": base, "Normal": normal, "Roughness": rough})
    material = SimpleNamespace(name="Fabric", use_nodes=True,
                               node_tree=SimpleNamespace(nodes=[tex, principled]))
    data = SimpleNamespace(vertices=[1, 2, 3], polygons=[1],
                           materials=[material], uv_layers=[SimpleNamespace(name="UVMap")])
    obj = SimpleNamespace(
        name=name, type="MESH", parent=None, matrix_world=VecMatrix(),
        bound_box=[(0, 0, 0), (2, 0, 0), (0, 1, 0), (2, 1, 0),
                   (0, 0, 0.8), (2, 0, 0.8), (0, 1, 0.8), (2, 1, 0.8)],
        data=data, hide_render=False, hide_viewport=False,
        get=lambda key, default=None: props.get(key, default),
    )
    return obj


def test_bbox_and_asset_fields_are_world_space_and_deterministic():
    obj = _scene_object(roomId="living_dining", assetProvider="BlenderKit",
                        assetSource="assets/furniture/sofa.blend")
    assert bbox_info(obj) == {
        "min": [0.0, 0.0, 0.0], "max": [2.0, 1.0, 0.8],
        "dimensions": [2.0, 1.0, 0.8],
    }
    result = audit_mesh_object(obj)
    assert result["room"] == "living_dining"
    assert result["role"] == "sofa"
    assert result["classification"] == "REAL_ASSET_TEXTURED"
    assert result["mesh"]["uv_layer_count"] == 1
    assert result["image_texture_count"] == 1
    assert result["packed_image_count"] == 1
    assert result["materials"][0]["principled"][0]["channels"]["Base Color"]["connected"] is True


def test_explicit_render_only_wins_over_real_asset_metadata():
    obj = _scene_object(render_only=True, geometrySource="blender_staging",
                        assetProvider="BlenderKit", assetSource="candidate.blend")
    assert classify_object(obj) == (
        "RENDER_ONLY_PLACEHOLDER", "explicit render_only/blender_staging marker"
    )


def test_scene_and_jsonl_protocol_contain_summary_assets_and_end():
    mesh = _scene_object(assetProvider="BlenderKit")
    light = SimpleNamespace(name="Key", type="LIGHT")
    report = audit_scene(SimpleNamespace(data=SimpleNamespace(objects=[light, mesh])), "scene.blend")
    assert report["scene"]["object_count"] == 2
    assert report["scene"]["mesh_count"] == 1
    lines = format_report(report, "jsonl").splitlines()
    records = [json.loads(line) for line in lines]
    assert records[0]["kind"] == "scene_summary"
    assert records[1]["kind"] == "asset"
    assert records[-1] == {"kind": "scene_end", "asset_count": 1, "warnings": [], "errors": []}


def test_instance_key_comes_from_parent_and_aggregates_mesh_children():
    parent = SimpleNamespace(
        name="furniture:living_dining:sofa:3",
        parent=None,
        get=lambda key, default=None: default,
    )
    visible = _scene_object("sofa:seat", assetProvider="BlenderKit")
    visible.parent = parent
    hidden = _scene_object("sofa:leg", assetProvider="LocalLibrary")
    hidden.parent = parent
    hidden.hide_viewport = True

    report = audit_scene(SimpleNamespace(data=SimpleNamespace(objects=[hidden, parent, visible])))

    assert [asset["instance_key"] for asset in report["assets"]] == [
        "furniture:living_dining:sofa:3",
        "furniture:living_dining:sofa:3",
    ]
    summary = report["instance_summary"]["furniture:living_dining:sofa:3"]
    assert summary["mesh_count"] == 2
    assert summary["visible_mesh_count"] == 1
    assert summary["classifications"] == ["REAL_ASSET_TEXTURED"]
    assert summary["asset_providers"] == ["BlenderKit", "LocalLibrary"]
    assert summary["material_count"] == 2
    assert summary["unique_material_count"] == 1
    assert summary["image_texture_count"] == 2
    assert summary["unique_image_count"] == 1
    assert summary["packed_image_count"] == 2


def test_instance_key_can_be_read_from_mesh_name():
    obj = _scene_object("furniture:bedroom:bed:0:headboard")
    result = audit_mesh_object(obj)
    assert result["instance_key"] == "furniture:bedroom:bed:0"


def _source_asset(key, name, source_kind="formal", source=None, **extra):
    asset = {
        "instance_key": key,
        "name": name,
        "asset_source": source,
        "geometry_source": "blender_staging" if source_kind == "render-only" else "glb",
        "render_only": source_kind == "render-only",
        "replacement_source": source_kind == "replacement",
        "hide_render": False,
        "hide_viewport": False,
    }
    asset.update(extra)
    return asset


def test_visible_source_aggregation_distinguishes_formal_replacement_and_render_only():
    key = "furniture:living_dining:sofa:0"
    conflicts, summary = aggregate_visible_sources([
        _source_asset(key, "formal", source="formal.glb"),
        _source_asset(key, "replacement", "replacement", source="candidate.blend"),
        _source_asset(key, "staging", "render-only", source="staging.blend"),
    ])
    assert key in conflicts
    assert summary[key]["formal_source_count"] == 1
    assert summary[key]["replacement_source_count"] == 1
    assert summary[key]["render_only_source_count"] == 1


def test_visible_source_aggregation_does_not_merge_same_type_across_rooms():
    assets = [
        _source_asset("furniture:living:sofa:0", "living", source="living.glb"),
        _source_asset("furniture:bedroom:sofa:0", "bedroom", source="bedroom.glb"),
    ]
    conflicts, summary = aggregate_visible_sources(assets)
    assert conflicts == {}
    assert set(summary) == {"furniture:living:sofa:0", "furniture:bedroom:sofa:0"}


def test_single_formal_and_single_replacement_are_not_conflicts():
    formal = _source_asset("furniture:living:table:0", "formal", source="formal.glb")
    replacement = _source_asset("furniture:living:chair:0", "replacement", "replacement", source="chair.glb")
    conflicts, summary = aggregate_visible_sources([formal, replacement])
    assert conflicts == {}
    assert summary[formal["instance_key"]]["formal_source_count"] == 1
    assert summary[replacement["instance_key"]]["replacement_source_count"] == 1


def test_procedural_node_material_is_not_claimed_as_real_asset():
    obj = _scene_object()
    assert classify_object(obj, []) == (
        "PROCEDURAL_MESH", "no real-asset metadata; mesh treated as procedural"
    )


def test_dressed_scene_mode_requires_glb_and_config():
    raw = _parse_args(["--glb", "house.glb", "--config", "render.json",
                       "--config-dir", ".", "--engine", "CYCLES",
                       "--camera", "hero", "--scenario", "day"])
    assert _uses_dressed_scene(raw) is True
    assert raw.engine == "CYCLES"
    assert raw.camera == "hero"
    assert raw.scenario == "day"
    assert _uses_dressed_scene(_parse_args(["--glb", "house.glb"])) is False


def test_select_job_defaults_to_first_and_filters_declared_ids():
    jobs = [
        {"camera_id": "wide", "scenario_id": "day", "scenario": {"id": "day"}},
        {"camera_id": "hero", "scenario_id": "night", "scenario": {"id": "night"}},
    ]
    assert _select_job(jobs)["camera_id"] == "wide"
    assert _select_job(jobs, camera_id="hero", scenario_id="night")["scenario_id"] == "night"
    try:
        _select_job(jobs, camera_id="missing")
    except ValueError as exc:
        assert "camera=missing" in str(exc)
    else:
        raise AssertionError("missing job should fail")
