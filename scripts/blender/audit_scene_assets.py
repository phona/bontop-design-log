"""Read-only final Blender scene asset audit.

Run inside Blender background mode, for example::

    blender --background --python scripts/blender/audit_scene_assets.py -- \
      --blend renders/final.blend --out tmp/scene-assets.json
    blender --background --python scripts/blender/audit_scene_assets.py -- \
      --glb house.glb --format jsonl

The auditor never saves or edits the input scene. It reports one mesh asset per
object, plus scene counts and material/image diagnostics. ``bpy`` is imported
lazily so the pure helpers can be tested with normal Python.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene_asset_registry import (  # noqa: E402
    load_registry,
    read_asset_metadata,
    registry_entry,
)


_DRESS_SCENE_PATH = Path(__file__).with_name("dress_scene.py")


def _uses_dressed_scene(args: argparse.Namespace) -> bool:
    """Return whether auditing must execute the Blender dressing pipeline."""
    return bool(args.glb and args.config)


def _select_job(jobs: Iterable[Mapping[str, Any]], camera_id: str | None = None,
                scenario_id: str | None = None) -> dict[str, Any]:
    """Select one declared job without guessing an undeclared camera/scenario."""
    candidates = [dict(job) for job in jobs
                  if (camera_id is None or job.get("camera_id") == camera_id)
                  and (scenario_id is None or job.get("scenario_id") == scenario_id)]
    if not candidates:
        requested = []
        if camera_id is not None:
            requested.append(f"camera={camera_id}")
        if scenario_id is not None:
            requested.append(f"scenario={scenario_id}")
        suffix = f" ({', '.join(requested)})" if requested else ""
        raise ValueError(f"no render job matches{suffix}")
    return candidates[0]


def _load_dress_scene_module() -> Any:
    """Load dress_scene.py only from Blender execution, never at module import."""
    spec = importlib.util.spec_from_file_location("bontop_audit_dress_scene", _DRESS_SCENE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load dress_scene.py from {_DRESS_SCENE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_config(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    if not isinstance(config, dict):
        raise ValueError("--config must contain a JSON object")
    return config

SCHEMA = "bontop.scene-asset-audit"
SCHEMA_VERSION = 1
CLASSIFICATIONS = (
    "REAL_ASSET_TEXTURED",
    "REAL_ASSET_UNTEXTURED",
    "PROCEDURAL_MESH",
    "PROCEDURAL_MATERIAL",
    "RENDER_ONLY_PLACEHOLDER",
)

_ROLE_RE = re.compile(r"(?:^|:)role=([^:]+)")
_FURNITURE_RE = re.compile(r"^furniture:([^:]+):([^:]+)")
_INSTANCE_KEY_RE = re.compile(r"(?:^|:)furniture:([^:]+):([^:]+):([^:.]+)")
_INSTANCE_KEY_PARTS_RE = re.compile(r"^([^:]+):([^:]+):([^:.]+)$")
_FLOOR_RE = re.compile(r"^floor:([^:.]+)")


def _normalize_instance_key(value: Any) -> str | None:
    """Normalize exporter names and legacy custom properties to one instance key."""
    text = str(value or "")
    match = _INSTANCE_KEY_RE.search(text)
    if match:
        return f"furniture:{match.group(1)}:{match.group(2)}:{match.group(3)}"
    match = _INSTANCE_KEY_PARTS_RE.match(text)
    if match:
        return f"furniture:{match.group(1)}:{match.group(2)}:{match.group(3)}"
    return None


def _json_value(value: Any) -> Any:
    """Convert Blender scalar/vector values to stable JSON primitives."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, Mapping):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    try:
        return [_json_value(v) for v in value]
    except TypeError:
        return str(value)


def _prop(obj: Any, *names: str) -> Any:
    for name in names:
        try:
            value = obj.get(name)
        except (AttributeError, TypeError):
            value = None
        if value is not None:
            return _json_value(value)
    return None


def _instance_key(obj: Any) -> str | None:
    """Find a stable furniture instance key on an object or its parent chain."""
    current = obj
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        for value in (getattr(current, "name", ""),
                      _prop(current, "instance_key", "instanceKey", "furnitureInstanceKey")):
            key = _normalize_instance_key(value)
            if key is not None:
                return key
        current = getattr(current, "parent", None)
    return None


def _name_parts(obj: Any) -> tuple[str | None, str | None]:
    """Extract room/role from explicit properties or stable exporter names."""
    room = _prop(obj, "roomId", "room_id", "room", "roomID")
    role = _prop(obj, "role", "renderRole", "materialRole", "assetRole")
    name = str(getattr(obj, "name", ""))
    if room is None:
        match = _FURNITURE_RE.match(name)
        if match:
            room = match.group(1)
        else:
            match = _FLOOR_RE.match(name)
            if match:
                room = match.group(1)
    if role is None:
        match = _ROLE_RE.search(name)
        if match:
            role = match.group(1)
        elif name.startswith("furniture:"):
            match = _FURNITURE_RE.match(name)
            if match:
                role = match.group(2)
        elif name.startswith("asset:"):
            fields = name.split(":")
            if len(fields) > 1:
                role = fields[1]
    parent = getattr(obj, "parent", None)
    if (room is None or role is None) and parent is not None:
        parent_room, parent_role = _name_parts(parent)
        room = room if room is not None else parent_room
        role = role if role is not None else parent_role
    return (str(room) if room is not None else None,
            str(role) if role is not None else None)


def _transform_point(obj: Any, point: Iterable[float]) -> tuple[float, float, float]:
    matrix = getattr(obj, "matrix_world", None)
    if matrix is not None:
        try:
            transformed = matrix @ point
            return tuple(float(transformed[i]) for i in range(3))
        except (TypeError, IndexError, KeyError):
            pass
    return tuple(float(point[i]) for i in range(3))


def bbox_info(obj: Any) -> dict[str, list[float]] | None:
    corners = getattr(obj, "bound_box", None)
    if not corners:
        return None
    points = [_transform_point(obj, corner) for corner in corners]
    mins = [min(p[i] for p in points) for i in range(3)]
    maxs = [max(p[i] for p in points) for i in range(3)]
    return {
        "min": [round(v, 6) for v in mins],
        "max": [round(v, 6) for v in maxs],
        "dimensions": [round(maxs[i] - mins[i], 6) for i in range(3)],
    }


def _socket_info(socket: Any) -> dict[str, Any]:
    links = list(getattr(socket, "links", ()) or ())
    result: dict[str, Any] = {
        "connected": bool(links),
        "default_value": _json_value(getattr(socket, "default_value", None)),
        "links": [],
    }
    for link in links:
        source = getattr(link, "from_node", None)
        from_socket = getattr(link, "from_socket", None)
        result["links"].append({
            "from_node": getattr(source, "name", None),
            "from_type": getattr(source, "type", None),
            "from_socket": getattr(from_socket, "name", None),
        })
    return result


def image_info(image: Any) -> dict[str, Any]:
    raw = getattr(image, "filepath_raw", None)
    filepath = getattr(image, "filepath", None)
    path = str(raw or filepath or "")
    # Blender's // path is relative to the current .blend; abspath is useful
    # evidence but does not assert that the file exists.
    absolute = None
    if path:
        try:
            absolute = os.path.abspath(path[2:] if path.startswith("//") else path)
        except (OSError, TypeError):
            absolute = path
    return {
        "name": getattr(image, "name", None),
        "filepath": path or None,
        "absolute_filepath": absolute,
        "exists": bool(absolute and os.path.isfile(absolute)),
        "packed": getattr(image, "packed_file", None) is not None,
    }


def material_info(material: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": getattr(material, "name", None),
        "use_nodes": bool(getattr(material, "use_nodes", False)),
        "nodes": [],
        "principled": [],
        "image_textures": [],
    }
    if not result["use_nodes"]:
        return result
    node_tree = getattr(material, "node_tree", None)
    nodes = list(getattr(node_tree, "nodes", ()) or ())
    result["nodes"] = sorted({getattr(node, "type", None) for node in nodes})
    seen_images: set[int] = set()
    for node in nodes:
        node_type = getattr(node, "type", None)
        if node_type == "TEX_IMAGE" or getattr(node, "bl_idname", None) == "ShaderNodeTexImage":
            image = getattr(node, "image", None)
            entry = {
                "node": getattr(node, "name", None),
                "image": image_info(image) if image is not None else None,
            }
            result["image_textures"].append(entry)
        if node_type != "BSDF_PRINCIPLED" and getattr(node, "bl_idname", None) != "ShaderNodeBsdfPrincipled":
            continue
        inputs = getattr(node, "inputs", {})
        channels: dict[str, Any] = {}
        for channel in ("Base Color", "Normal", "Roughness"):
            try:
                socket = inputs.get(channel)
            except AttributeError:
                socket = None
            channels[channel] = _socket_info(socket) if socket is not None else None
        result["principled"].append({"node": getattr(node, "name", None), "channels": channels})
    result["image_textures"].sort(key=lambda x: (x["node"] or ""))
    result["principled"].sort(key=lambda x: (x["node"] or ""))
    return result


def _mesh_materials(obj: Any) -> list[Any]:
    data = getattr(obj, "data", None)
    return [m for m in list(getattr(data, "materials", ()) or ()) if m is not None]


def _has_image_texture(materials: Iterable[Any]) -> bool:
    return any(info["image_textures"] and any(
        item["image"] is not None for item in info["image_textures"]
    ) for info in (material_info(m) for m in materials))


def classify_object(obj: Any, materials: Iterable[Any] | None = None) -> tuple[str, str]:
    materials = list(materials if materials is not None else _mesh_materials(obj))
    render_only = bool(_prop(obj, "render_only", "renderOnly"))
    geometry_source = _prop(obj, "geometrySource", "geometry_source")
    asset_kind = str(_prop(obj, "assetKind", "asset_kind") or "").lower()
    provider = _prop(obj, "assetProvider", "asset_provider")
    source = _prop(obj, "assetSource", "asset_source")
    if render_only or geometry_source == "blender_staging":
        return "RENDER_ONLY_PLACEHOLDER", "explicit render_only/blender_staging marker"
    is_real = bool(provider or source or "real" in asset_kind or str(geometry_source).lower() in {
        "glb", "gltf", "blend_asset", "asset"
    })
    if is_real:
        return ("REAL_ASSET_TEXTURED" if _has_image_texture(materials) else "REAL_ASSET_UNTEXTURED",
                "explicit asset provider/source metadata")
    if str(geometry_source).lower() in {"procedural", "blender", "blender_generated", "blender_staging"}:
        return "PROCEDURAL_MESH", "explicit procedural geometry source"
    if materials and any(material_info(m)["use_nodes"] for m in materials):
        return "PROCEDURAL_MATERIAL", "node material without real-asset metadata"
    return "PROCEDURAL_MESH", "no real-asset metadata; mesh treated as procedural"


_ROLE_ALIASES = {
    "sofa": "sofa_3seat",
    "table": "dining_table",
    "chair": "dining_chair",
    "plant": "plant_fiddle",
}


def _registry_role(role: Any) -> str | None:
    if role is None:
        return None
    value = str(role)
    return _ROLE_ALIASES.get(value, value)


def audit_mesh_object(obj: Any, registry: Mapping[str, Any] | None = None) -> dict[str, Any]:
    materials = _mesh_materials(obj)
    classification, reason = classify_object(obj, materials)
    room, role = _name_parts(obj)
    metadata = read_asset_metadata(obj)
    registry_role = _registry_role(role)
    entry = registry_entry(registry or {}, registry_role) if registry_role else None
    source_class = metadata["sourceClass"]
    source_policy = entry.get("source_policy") if entry else None
    data = getattr(obj, "data", None)
    uv_layers = list(getattr(data, "uv_layers", ()) or ())
    mat_infos = [material_info(m) for m in materials]
    images = [item["image"] for info in mat_infos for item in info["image_textures"] if item["image"]]
    image_values = {json.dumps(item, sort_keys=True, ensure_ascii=False): item for item in images}
    image_list = [image_values[k] for k in sorted(image_values)]
    return {
        "kind": "asset",
        "name": getattr(obj, "name", None),
        "type": getattr(obj, "type", None),
        "parent": getattr(getattr(obj, "parent", None), "name", None),
        "instance_key": metadata["formalInstanceKey"] or _instance_key(obj),
        "formalInstanceKey": metadata["formalInstanceKey"] or _instance_key(obj),
        "room": room,
        "role": role,
        "registry_entry": entry,
        "source_policy": source_policy,
        "source_class": source_class,
        "source_id": metadata["sourceId"],
        "fallback_of": metadata["fallbackOf"],
        "geometry_source": _prop(obj, "geometrySource", "geometry_source"),
        "asset_provider": _prop(obj, "assetProvider", "asset_provider"),
        "asset_source": metadata["sourceId"] or _prop(obj, "assetSource", "asset_source"),
        "asset_kind": _prop(obj, "assetKind", "asset_kind"),
        "formal_web_geometry": metadata["formalWebGeometry"],
        "replacement_source": bool(_prop(obj, "dress_replacement_source", "replacement_source")),
        "dress_replacement_source": bool(_prop(obj, "dress_replacement_source")),
        "render_only": bool(_prop(obj, "render_only", "renderOnly")),
        "dress_dynamic": bool(_prop(obj, "dress_dynamic", "dressDynamic")),
        "classification": classification,
        "classification_reason": reason,
        "hide_render": bool(getattr(obj, "hide_render", False)),
        "hide_viewport": bool(getattr(obj, "hide_viewport", False)),
        "bbox": bbox_info(obj),
        "mesh": {
            "vertices": len(list(getattr(data, "vertices", ()) or ())),
            "polygons": len(list(getattr(data, "polygons", ()) or ())),
            "material_slots": len(list(getattr(data, "materials", ()) or ())),
            "uv_layers": [getattr(layer, "name", str(layer)) for layer in uv_layers],
            "uv_layer_count": len(uv_layers),
        },
        "materials": mat_infos,
        "images": image_list,
        "image_texture_count": sum(len(info["image_textures"]) for info in mat_infos),
        "packed_image_count": sum(1 for image in image_list if image["packed"]),
    }


def _instance_summary(assets: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Aggregate mesh diagnostics by the resolved furniture instance key."""
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for asset in assets:
        key = asset.get("instance_key")
        if key is not None:
            grouped.setdefault(str(key), []).append(asset)

    summary: dict[str, dict[str, Any]] = {}
    for key in sorted(grouped):
        members = grouped[key]
        materials = [material for asset in members for material in asset["materials"]]
        images = [image for asset in members for image in asset["images"]]
        material_values = {
            json.dumps(material, sort_keys=True, ensure_ascii=False): material
            for material in materials
        }
        image_values = {
            json.dumps(image, sort_keys=True, ensure_ascii=False): image
            for image in images
        }
        summary[key] = {
            "mesh_count": len(members),
            "visible_mesh_count": sum(
                not asset["hide_render"] and not asset["hide_viewport"]
                for asset in members
            ),
            "classifications": sorted({asset["classification"] for asset in members}),
            "asset_providers": sorted({
                str(asset["asset_provider"])
                for asset in members
                if asset["asset_provider"] is not None
            }),
            "material_count": len(materials),
            "unique_material_count": len(material_values),
            "image_texture_count": sum(asset["image_texture_count"] for asset in members),
            "unique_image_count": len(image_values),
            "packed_image_count": sum(asset["packed_image_count"] for asset in members),
        }
    return summary


def _source_kind(asset: Mapping[str, Any]) -> str:
    """Classify one audited mesh without treating render-only staging as a replacement."""
    if asset.get("source_class") == "render_only" or asset.get("render_only") or asset.get("geometry_source") == "blender_staging":
        return "render-only"
    if asset.get("source_class") == "replacement" or asset.get("dress_replacement_source") or asset.get("replacement_source"):
        return "replacement"
    return "formal"


def aggregate_visible_sources(assets: Iterable[Mapping[str, Any]], registry: Mapping[str, Any] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Aggregate source provenance by formal furniture instance key.

    Mesh children are deduplicated by source identity, while visibility is kept at
    source level.  This deliberately keys replacements by the full room/type/index
    key, never by furniture type alone.
    """
    grouped: dict[str, dict[str, dict[str, dict[str, Any]]]] = {}
    for asset in assets:
        key = asset.get("instance_key")
        if key is None or asset.get("hide_render") or asset.get("hide_viewport"):
            continue
        key = str(key)
        kind = _source_kind(asset)
        source = asset.get("asset_source")
        if source is None:
            source = f"{kind}:{key}"
        source = str(source)
        grouped.setdefault(key, {}).setdefault(kind, {})[source] = {
            "source": source,
            "objects": [],
        }
        grouped[key][kind][source]["objects"].append(asset.get("name"))

    conflicts: dict[str, Any] = {}
    replacement_summary: dict[str, Any] = {}
    for key in sorted(grouped):
        by_kind = grouped[key]
        for sources in by_kind.values():
            for entry in sources.values():
                entry["objects"] = sorted(name for name in entry["objects"] if name is not None)
        formal = list(by_kind.get("formal", {}).values())
        replacement = list(by_kind.get("replacement", {}).values())
        render_only = list(by_kind.get("render-only", {}).values())
        replacement_summary[key] = {
            "formal_sources": formal,
            "replacement_sources": replacement,
            "render_only_sources": render_only,
            "formal_source_count": len(formal),
            "replacement_source_count": len(replacement),
            "render_only_source_count": len(render_only),
        }
        if len(formal) + len(replacement) > 1:
            conflicts[key] = {
                "instance_key": key,
                "reason": "multiple visible formal/replacement sources",
                "formal_sources": formal,
                "replacement_sources": replacement,
            }
    return conflicts, replacement_summary


def audit_scene(bpy_module: Any, input_path: str | None = None, registry_root: str | None = None) -> dict[str, Any]:
    registry = load_registry(registry_root)
    objects = sorted(list(getattr(bpy_module.data, "objects", ()) or ()),
                     key=lambda obj: (getattr(obj, "name", ""), getattr(obj, "type", "")))
    mesh_objects = [obj for obj in objects if getattr(obj, "type", None) == "MESH"]
    assets = [audit_mesh_object(obj, registry) for obj in mesh_objects]
    counts: dict[str, int] = {}
    for obj in objects:
        typ = str(getattr(obj, "type", "UNKNOWN"))
        counts[typ] = counts.get(typ, 0) + 1
    class_counts: dict[str, int] = {}
    for asset in assets:
        key = asset["classification"]
        class_counts[key] = class_counts.get(key, 0) + 1
    images = [image for asset in assets for image in asset["images"]]
    visible_source_conflicts, replacement_summary = aggregate_visible_sources(assets, registry)
    warnings = list(registry.get("_diagnostics", {}).get("warnings", []))
    errors = list(registry.get("_diagnostics", {}).get("errors", []))
    for asset in assets:
        if asset["role"] and asset["registry_entry"] is None:
            warnings.append(f"registry unknown role: {asset['role']}")
        if asset["source_class"] not in (asset["source_policy"] or ("formal", "replacement", "render_only", "fallback")):
            warnings.append(f"registry source policy mismatch: {asset['role']} -> {asset['source_class']}")
    for key in visible_source_conflicts:
        role = next((asset["role"] for asset in assets if asset["instance_key"] == key), None)
        entry = registry_entry(registry, _registry_role(role)) if role else None
        if entry and entry.get("replacement_exclusive"):
            errors.append(f"registry replacement_exclusive conflict: {key}")

    for asset in assets:
        for image in asset["images"]:
            if not image["packed"] and not image["exists"]:
                warnings.append(f"missing image path: {asset['name']} -> {image['filepath']}")
    return {
        "schema": SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "input": os.path.abspath(input_path) if input_path else None,
        "scene": {
            "object_count": len(objects),
            "mesh_count": len(mesh_objects),
            "objects_by_type": dict(sorted(counts.items())),
            "assets_by_classification": dict(sorted(class_counts.items())),
            "unique_image_count": len({json.dumps(i, sort_keys=True) for i in images}),
            "packed_image_count": sum(1 for image in images if image["packed"]),
        },
        "assets": assets,
        "instance_summary": _instance_summary(assets),
        "visible_source_conflicts": visible_source_conflicts,
        "replacement_summary": replacement_summary,
        "warnings": sorted(set(warnings)),
        "errors": sorted(set(errors)),
    }


def format_report(report: dict[str, Any], output_format: str) -> str:
    if output_format == "json":
        return json.dumps(report, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    lines = [{"kind": "scene_summary", **{k: v for k, v in report.items() if k != "assets"}}]
    lines.extend(report["assets"])
    lines.append({"kind": "scene_end", "asset_count": len(report["assets"]), "warnings": report["warnings"], "errors": report["errors"]})
    return "".join(json.dumps(line, ensure_ascii=False, sort_keys=False) + "\n" for line in lines)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only Blender scene asset audit")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--blend", help="saved .blend scene")
    group.add_argument("--glb", help=".glb/.gltf scene to import")
    parser.add_argument("--config", help="dress_scene render-config.json; enables final-scene audit for --glb")
    parser.add_argument("--config-dir", help="project root passed to dress_scene for assets/config")
    parser.add_argument("--engine", choices=("EEVEE", "CYCLES"), default="EEVEE")
    parser.add_argument("--camera", help="camera id to select when --config is used")
    parser.add_argument("--scenario", help="scenario id to select when --config is used")
    parser.add_argument("--out", help="output JSON/JSONL path; defaults to stdout")
    parser.add_argument("--format", choices=("json", "jsonl"), default="json")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        if "--" in sys.argv:
            argv = sys.argv[sys.argv.index("--") + 1:]
        else:
            argv = sys.argv[1:]
    args = _parse_args(argv)
    try:
        import bpy  # type: ignore[import-not-found]
        source = args.blend or args.glb
        if args.blend:
            if args.config:
                raise ValueError("--config is supported only with --glb")
            bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.blend), load_ui=False)
        elif _uses_dressed_scene(args):
            dress_scene = _load_dress_scene_module()
            cfg = _load_config(os.path.abspath(args.config))
            dress_config = importlib.import_module("dress_config")
            jobs = dress_config.make_jobs(cfg, version="audit")
            job = _select_job(jobs, args.camera, args.scenario)
            camera = next(c for c in cfg.get("cameras", [])
                          if c.get("id") == job["camera_id"])
            dress_args = {
                "glb": os.path.abspath(args.glb),
                "engine": args.engine,
                "config-dir": (os.path.abspath(args.config_dir)
                                if args.config_dir else ""),
            }
            runtime = dress_scene.initialize_scene(dress_args, cfg, jobs)
            cam_cfg = dress_scene.effective_camera_config(camera, job["scenario"])
            dress_scene._apply_job_state(runtime, cam_cfg, job["scenario"])
        else:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
        report = audit_scene(bpy, source, args.config_dir or os.getcwd())
        text = format_report(report, args.format)
        if args.out:
            output = Path(args.out)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(text, encoding="utf-8")
        else:
            sys.stdout.write(text)
        return 0
    except Exception as exc:
        print(f"audit_scene_assets: error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
