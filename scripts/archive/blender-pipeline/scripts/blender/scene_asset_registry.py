"""Declarative Blender asset provenance registry and metadata compatibility helpers."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping

DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parents[2] / "data" / "scene-asset-registry.json"
SOURCE_CLASSES = {"formal", "replacement", "render_only", "fallback"}
REQUIRED_ROLES = ("sofa_3seat", "dining_table", "dining_chair", "plant_fiddle", "coffee_table", "tv_wall_low", "rug")
BUILTIN_REGISTRY = {
    "schema": "bontop.scene-asset-registry", "version": 1,
    "entries": {role: {"source_policy": ["formal", "replacement", "fallback"], "replacement_exclusive": False}
                for role in REQUIRED_ROLES},
}
BUILTIN_REGISTRY["entries"]["coffee_table"]["source_policy"] = ["formal", "replacement", "render_only", "fallback"]
BUILTIN_REGISTRY["entries"]["tv_wall_low"]["source_policy"] = ["formal", "replacement", "render_only", "fallback"]
BUILTIN_REGISTRY["entries"]["rug"]["source_policy"] = ["formal", "render_only", "fallback"]
BUILTIN_REGISTRY["scope"] = "living_dining_core_assets"
BUILTIN_REGISTRY["description"] = "客餐厅核心资产 registry；仅声明客餐厅及其核心软装资产，不覆盖全屋。"


def validate_registry(registry: Any, required_roles=REQUIRED_ROLES) -> dict[str, Any]:
    warnings: list[str] = []
    errors: list[str] = []
    if not isinstance(registry, dict):
        return {"warnings": [], "errors": ["registry must be a JSON object"]}
    if registry.get("schema") != "bontop.scene-asset-registry":
        errors.append("registry schema must be bontop.scene-asset-registry")
    if registry.get("version") != 1:
        errors.append("registry version must be 1")
    entries = registry.get("entries")
    if not isinstance(entries, dict):
        errors.append("registry entries must be an object")
        entries = {}
    for role in required_roles:
        if role not in entries:
            warnings.append(f"registry missing role: {role}")
    for role, entry in entries.items():
        if not isinstance(role, str) or not isinstance(entry, dict):
            errors.append(f"registry entry {role!r} must be an object")
            continue
        policies = entry.get("source_policy", [])
        if not isinstance(policies, list) or any(policy not in SOURCE_CLASSES for policy in policies):
            errors.append(f"registry entry {role!r} has invalid source_policy")
        if not isinstance(entry.get("replacement_exclusive", False), bool):
            errors.append(f"registry entry {role!r} replacement_exclusive must be boolean")
    return {"warnings": sorted(set(warnings)), "errors": sorted(set(errors))}


def load_registry(root: str | os.PathLike[str] | None = None, *, strict: bool = False) -> dict[str, Any]:
    base = Path(root) if root else DEFAULT_REGISTRY_PATH.parent.parent
    path = base / "data" / "scene-asset-registry.json"
    if Path(root or "").name == "scene-asset-registry.json":
        path = Path(root)  # type: ignore[arg-type]
    try:
        with path.open(encoding="utf-8") as handle:
            registry = json.load(handle)
    except (OSError, TypeError, ValueError) as exc:
        if strict:
            raise FileNotFoundError(f"scene asset registry unavailable: {path}: {exc}") from exc
        registry = json.loads(json.dumps(BUILTIN_REGISTRY))
        registry["_diagnostics"] = {"warnings": [f"registry unavailable: {path}: {type(exc).__name__}: {exc}; using builtin declaration"], "errors": []}
        return registry
    diagnostics = validate_registry(registry)
    registry["_diagnostics"] = diagnostics
    if strict and diagnostics["errors"]:
        raise ValueError("invalid scene asset registry: " + "; ".join(diagnostics["errors"]))
    return registry


def registry_entry(registry: Mapping[str, Any], role: Any) -> dict[str, Any] | None:
    entries = registry.get("entries", {})
    entry = entries.get(str(role)) if isinstance(entries, Mapping) else None
    if not isinstance(entry, Mapping):
        return None
    result = dict(entry)
    # Include registry identity in every audit entry without changing legacy fields.
    if registry.get("scope") is not None:
        result["registry_scope"] = registry.get("scope")
    if registry.get("description") is not None:
        result["registry_description"] = registry.get("description")
    return result


def assert_source_allowed(registry: Mapping[str, Any], role: Any, source_class: str,
                          *, formal_instance_key: Any = None) -> dict[str, Any]:
    """Enforce a role's declared source policy before writing runtime metadata."""
    role_name = {
        "soft_decor:coffee_table": "coffee_table",
        "soft_decor:rug": "rug",
        "tv_wall_low:blenderkit_sideboard": "tv_wall_low",
    }.get(str(role or ""), str(role or ""))
    entry = registry_entry(registry, role_name)
    if entry is None:
        raise ValueError(f"registry missing role/source policy: {role_name!r}")
    if source_class not in SOURCE_CLASSES:
        raise ValueError(f"unknown sourceClass for role {role_name!r}: {source_class!r}")
    policies = entry.get("source_policy")
    if not isinstance(policies, list) or source_class not in policies:
        allowed = ", ".join(str(item) for item in policies) if isinstance(policies, list) else "<invalid>"
        raise ValueError(f"registry source policy mismatch: role {role_name!r} disallows {source_class!r}; allowed={allowed}")
    key = normalize_formal_instance_key(formal_instance_key)
    declared_key = normalize_formal_instance_key(entry.get("formalInstanceKey"))
    if declared_key and key and declared_key != key:
        raise ValueError(f"registry formal instance key mismatch: role {role_name!r}; declared={declared_key!r}, got={key!r}")
    return entry


def registry_relation(registry: Mapping[str, Any], role: Any, relation_name: str | None = None) -> Any:
    """Return a declared relation/key; callers must not infer it from asset names."""
    entry = registry_entry(registry, role)
    if entry is None:
        return None
    if relation_name is None:
        return entry.get("relation")
    relation = entry.get("relation")
    return relation.get(relation_name) if isinstance(relation, Mapping) else None


def _get(obj: Any, name: str, default: Any = None) -> Any:
    try:
        return obj.get(name, default)
    except (AttributeError, TypeError):
        return default


def normalize_formal_instance_key(value: Any) -> str | None:
    text = str(value or "")
    parts = text.split(":")
    if len(parts) >= 4 and parts[0] == "furniture":
        return ":".join(parts[:4])
    if len(parts) == 3:
        return f"furniture:{text}"
    return None


def write_asset_metadata(obj: Any, *, source_class: str, formal_instance_key: Any = None,
                         source_id: Any = None, fallback_of: Any = None,
                         formal_web_geometry: bool = False, role: Any = None,
                         registry: Mapping[str, Any] | None = None) -> Any:
    if source_class not in SOURCE_CLASSES:
        raise ValueError(f"unknown sourceClass: {source_class}")
    key = normalize_formal_instance_key(formal_instance_key)
    if registry is not None and registry_entry(registry, role) is not None:
        assert_source_allowed(registry, role, source_class, formal_instance_key=key)
    elif role is not None and source_class not in SOURCE_CLASSES:
        raise ValueError(f"unknown sourceClass for role {role!r}: {source_class!r}")
    obj["formalInstanceKey"] = key
    if key is not None:
        obj["instance_key"] = key
    obj["sourceId"] = str(source_id) if source_id is not None else None
    if source_id is not None:
        obj["assetSource"] = os.path.normpath(str(source_id))
    obj["sourceClass"] = source_class
    obj["fallbackOf"] = fallback_of
    obj["formalWebGeometry"] = bool(formal_web_geometry)
    # Legacy properties remain authoritative for older scene tooling.
    if source_class == "render_only":
        obj["render_only"] = True
        obj["geometrySource"] = "blender_staging"
    elif source_class in {"replacement", "fallback"}:
        obj["dress_replacement_source"] = source_class == "replacement"
        obj["geometrySource"] = "blend_asset" if source_class == "replacement" else "procedural"
    if role is not None:
        obj["assetRole"] = str(role)
    return obj


def read_asset_metadata(obj: Any) -> dict[str, Any]:
    render_only = bool(_get(obj, "render_only", _get(obj, "renderOnly", False)))
    geometry = _get(obj, "geometrySource", _get(obj, "geometry_source"))
    replacement = bool(_get(obj, "dress_replacement_source", _get(obj, "replacement_source", False)))
    source_class = _get(obj, "sourceClass", _get(obj, "source_class"))
    if source_class not in SOURCE_CLASSES:
        source_class = "render_only" if render_only or geometry == "blender_staging" else ("replacement" if replacement else "formal")
    key = normalize_formal_instance_key(_get(obj, "formalInstanceKey", _get(obj, "instance_key", _get(obj, "furnitureInstanceKey"))))
    source_id = _get(obj, "sourceId", _get(obj, "assetSource", _get(obj, "asset_source")))
    return {
        "sourceClass": source_class,
        "formalInstanceKey": key,
        "sourceId": source_id,
        "fallbackOf": _get(obj, "fallbackOf", _get(obj, "fallback_of")),
        "formalWebGeometry": bool(_get(obj, "formalWebGeometry", _get(obj, "formal_web_geometry", False))),
    }
