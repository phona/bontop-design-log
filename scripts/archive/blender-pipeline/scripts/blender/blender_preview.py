"""Pure preview-scope helpers with an optional Blender-object boundary.

The module deliberately does not import :mod:`bpy`.  Scope resolution,
selection, and statistics therefore run in ordinary Python tests; Blender
objects are supported through their normal attributes and custom properties.

A scope may be ``None``/``"all"``, a comma-separated string, or a mapping.
Mapping selectors are ``rooms``, ``roles``, ``types``, ``names``, and
``prefixes``; each accepts a scalar or an iterable.  ``exclude`` may contain
another scope (or selector mapping), and ``include_hidden`` controls whether
objects already hidden by Blender remain eligible.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
import re
from typing import Any


_SELECTOR_KEYS = ("rooms", "roles", "types", "names", "prefixes")
_SCOPE_KEYS = set(_SELECTOR_KEYS) | {"exclude", "include_hidden", "hidden"}
_TOKEN_RE = re.compile(r"^(rooms?|roles?|types?|names?|prefixes?)\s*[:=]\s*(.+)$", re.I)
_FURNITURE_RE = re.compile(r"^furniture:([^:]+):([^:]+)")
_FLOOR_RE = re.compile(r"^floor:([^:.]+)")
_ROLE_RE = re.compile(r"(?:^|:)role=([^:]+)")
_ARCHITECTURE_PREFIXES = (
    "wall:",
    "floor:",
    "ceiling:",
    "window:",
    "curtain:",
    "glass:",
    "door:",
    "curtain_run:",
    "glass_infill",
    "shower_screen:",
    "hinged_glass_door:",
    "sliding_door:",
)
_ARCHITECTURE_NAMES = frozenset({
    "west_curtain",
    "kitchen_north_curtain",
    "living_south_curtain",
    "north_recess_curtain",
    "south_east_curtain",
    "d_kit_balc",
})
_ARCHITECTURE_GEOMETRY_SOURCES = frozenset({
    "architecture",
    "architectural",
    "building",
    "building_geometry",
    "cad",
    "dxf",
    "formal",
    "formal_geometry",
    "formal_web_geometry",
    "house_geometry",
    "layout",
    "model_geometry",
    "procedural_architecture",
    "shared_architecture",
})
_ARCHITECTURE_TYPES = frozenset({
    "architecture",
    "architectural",
    "building",
    "ceiling",
    "door",
    "floor",
    "floor_region",
    "roof",
    "wall",
    "wall_run",
    "window",
})
_NON_ARCHITECTURE_TYPES = frozenset({"curtain", "furniture", "hvac", "plumbing"})
_ARCHITECTURE_ROLES = frozenset({
    "architecture",
    "architectural",
    "building",
    "ceiling",
    "door",
    "floor",
    "roof",
    "wall",
    "window",
})


def _values(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, Mapping):
        return tuple(str(key) for key, enabled in value.items() if enabled)
    try:
        return tuple(str(item).strip() for item in value if str(item).strip())
    except TypeError:
        return (str(value).strip(),) if str(value).strip() else ()


def _canonical_selector(value: Any) -> frozenset[str]:
    return frozenset(_values(value))


def _empty_scope() -> dict[str, Any]:
    return {
        "rooms": frozenset(),
        "roles": frozenset(),
        "types": frozenset(),
        "names": frozenset(),
        "prefixes": frozenset(),
        "exclude": {key: frozenset() for key in _SELECTOR_KEYS},
        "include_hidden": False,
    }


def _merge_selector(target: dict[str, Any], key: str, value: Any) -> None:
    if key not in _SELECTOR_KEYS:
        return
    target[key] = frozenset(set(target[key]) | set(_canonical_selector(value)))


def parse_scope(scope: Any = None) -> dict[str, Any]:
    """Normalize a preview scope into a deterministic, JSON-like structure.

    Strings use ``all``/``*`` for no restriction and selector tokens such as
    ``room:living_dining`` or ``role:sofa``.  A bare token is treated as a
    room, which makes ``"living_dining"`` convenient without weakening
    explicit mappings.
    """
    result = _empty_scope()
    if scope is None or scope is True:
        return result
    if scope is False:
        result["names"] = frozenset({"__no_object_matches__"})
        return result

    if isinstance(scope, str):
        tokens = [token.strip() for token in scope.split(",") if token.strip()]
        for token in tokens:
            if token.lower() in {"all", "*", "full"}:
                continue
            match = _TOKEN_RE.match(token)
            if match:
                key = match.group(1).lower().rstrip("s") + "s"
                _merge_selector(result, key, match.group(2))
            elif token.startswith("!") or token.startswith("-"):
                result["exclude"]["names"] = frozenset(
                    set(result["exclude"]["names"]) | {token[1:]}
                )
            else:
                _merge_selector(result, "rooms", token)
        return result

    if not isinstance(scope, Mapping):
        raise TypeError("preview scope must be None, a string, or a mapping")

    for key in _SELECTOR_KEYS:
        _merge_selector(result, key, scope.get(key))
    if "room" in scope:
        _merge_selector(result, "rooms", scope["room"])
    if "role" in scope:
        _merge_selector(result, "roles", scope["role"])
    if "type" in scope:
        _merge_selector(result, "types", scope["type"])
    if "name" in scope:
        _merge_selector(result, "names", scope["name"])
    if "prefix" in scope:
        _merge_selector(result, "prefixes", scope["prefix"])
    result["include_hidden"] = bool(scope.get("include_hidden", scope.get("hidden", False)))

    excluded = scope.get("exclude")
    if excluded is not None:
        parsed_excluded = parse_scope(excluded)
        for key in _SELECTOR_KEYS:
            result["exclude"][key] = parsed_excluded[key]
    for key in _SELECTOR_KEYS:
        for alias in (f"exclude_{key}", f"excluded_{key}"):
            if alias in scope:
                result["exclude"][key] = frozenset(
                    set(result["exclude"][key]) | set(_canonical_selector(scope[alias]))
                )
    return result


resolve_scope = parse_scope


def _prop(obj: Any, *keys: str) -> Any:
    for key in keys:
        try:
            value = obj.get(key)
        except (AttributeError, TypeError):
            value = None
        if value is not None:
            return value
        value = getattr(obj, key, None)
        if value is not None:
            return value
    return None


def object_scope_fields(obj: Any) -> dict[str, str | None]:
    """Extract stable room/role/type fields from a Blender-like object."""
    name = str(getattr(obj, "name", ""))
    room = _prop(obj, "room", "room_id", "roomId", "roomID")
    role = _prop(obj, "role", "renderRole", "materialRole", "assetRole")
    object_type = _prop(obj, "type", "object_type", "objectType") or getattr(obj, "type", None)
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
            parts = name.split(":")
            if len(parts) > 1:
                role = parts[1]
    return {
        "name": name,
        "room": str(room) if room is not None else None,
        "role": str(role) if role is not None else None,
        "type": str(object_type) if object_type is not None else None,
    }


def _matches(value: str | None, selectors: frozenset[str], *, prefix: bool = False) -> bool:
    if not selectors:
        return False
    if value is None:
        return False
    return any(value.startswith(item) if prefix else value == item for item in selectors)


def _selected_by(scope: Mapping[str, Any], fields: Mapping[str, str | None]) -> bool:
    tests = (
        _matches(fields["room"], scope["rooms"]),
        _matches(fields["role"], scope["roles"]),
        _matches(fields["type"], scope["types"]),
        _matches(fields["name"], scope["names"]),
        _matches(fields["name"], scope["prefixes"], prefix=True),
    )
    active = any(scope[key] for key in _SELECTOR_KEYS)
    return any(tests) if active else True


def _excluded_by(scope: Mapping[str, Any], fields: Mapping[str, str | None]) -> bool:
    excluded = scope.get("exclude", {})
    return (
        _matches(fields["room"], excluded.get("rooms", frozenset()))
        or _matches(fields["role"], excluded.get("roles", frozenset()))
        or _matches(fields["type"], excluded.get("types", frozenset()))
        or _matches(fields["name"], excluded.get("names", frozenset()))
        or _matches(fields["name"], excluded.get("prefixes", frozenset()), prefix=True)
    )


def _is_architecture(obj: Any, fields: Mapping[str, str | None]) -> bool:
    """Identify formal building geometry before applying preview filters.

    Blender's built-in ``Object.type`` is ``MESH`` for walls, floors, and
    furniture alike, so it cannot be used as the architectural type.  Formal
    building objects also commonly have no room tag (shared walls, corridors,
    and house-wide roof/ceiling pieces); those objects must not be treated as
    out-of-scope merely because their room is unknown.
    """
    name = fields["name"]
    if name in _ARCHITECTURE_NAMES or name.startswith(_ARCHITECTURE_PREFIXES) \
            or any(name.startswith(f"{architecture_name}:part=") for architecture_name in _ARCHITECTURE_NAMES):
        return True

    semantic_type = str(fields["type"] or "").strip().lower()
    if semantic_type in _NON_ARCHITECTURE_TYPES:
        return False
    semantic_role = _prop(obj, "renderRole", "materialRole", "assetRole", "role")
    if semantic_type in _ARCHITECTURE_TYPES \
            or str(semantic_role).strip().lower() in _ARCHITECTURE_ROLES:
        return True

    if bool(_prop(obj, "formalWebGeometry", "formal_web_geometry")):
        return True
    geometry_source = _prop(obj, "geometrySource", "geometry_source")
    if geometry_source is not None:
        source = str(geometry_source).strip().lower().replace("-", "_").replace(" ", "_")
        if source in _ARCHITECTURE_GEOMETRY_SOURCES or "architect" in source:
            return True

    # Formal GLB building nodes may carry only sourceClass and a generic name.
    # Do not extend this fallback to furniture/assets or render-only staging.
    # A formal architectural object may still carry a room tag (for example a
    # wall segment shared by two rooms), so room presence must not disqualify it.
    source_class = str(_prop(obj, "sourceClass", "source_class") or "").strip().lower()
    return source_class == "formal" and not name.startswith(("furniture:", "asset:"))


def preview_object_decision(obj: Any, scope: Any = None) -> dict[str, Any]:
    """Return a non-mutating keep/crop decision and its reason."""
    normalized = parse_scope(scope)
    fields = object_scope_fields(obj)
    if _is_architecture(obj, fields):
        return {"keep": True, "crop": False, "reason": "always_keep_architecture", **fields}
    hidden = bool(getattr(obj, "hide_render", False) or getattr(obj, "hide_viewport", False))
    if hidden and not normalized["include_hidden"]:
        return {"keep": False, "crop": True, "reason": "already_hidden", **fields}
    if _excluded_by(normalized, fields):
        return {"keep": False, "crop": True, "reason": "excluded", **fields}
    if not _selected_by(normalized, fields):
        return {"keep": False, "crop": True, "reason": "outside_scope", **fields}
    return {"keep": True, "crop": False, "reason": "in_scope", **fields}


def should_keep_object(obj: Any, scope: Any = None) -> bool:
    """Return whether ``obj`` belongs in the preview, without changing it."""
    return bool(preview_object_decision(obj, scope)["keep"])


def filter_objects(objects: Iterable[Any], scope: Any = None) -> list[Any]:
    """Return objects retained by a scope; the input objects are untouched."""
    return [obj for obj in objects if should_keep_object(obj, scope)]


def preview_statistics(objects: Iterable[Any], scope: Any = None) -> dict[str, Any]:
    """Count total, retained, and cropped objects with stable breakdowns."""
    decisions = [preview_object_decision(obj, scope) for obj in objects]
    kept = [item for item in decisions if item["keep"]]
    cropped = [item for item in decisions if item["crop"]]

    def counts(items: Iterable[Mapping[str, Any]], key: str) -> dict[str, int]:
        values = (str(item[key]) if item[key] is not None else "<unknown>"
                  for item in items)
        return dict(sorted(Counter(values).items()))

    return {
        "object_count": len(decisions),
        "kept_count": len(kept),
        "cropped_count": len(cropped),
        "kept_by_type": counts(kept, "type"),
        "cropped_by_type": counts(cropped, "type"),
        "kept_by_room": counts(kept, "room"),
        "cropped_by_room": counts(cropped, "room"),
        "cropped_by_reason": counts(cropped, "reason"),
    }


def _remove_mesh(meshes: Any, mesh: Any) -> None:
    """Remove a mesh from Blender or a small fake collection used in tests."""
    try:
        meshes.remove(mesh, do_unlink=True)
    except TypeError:
        meshes.remove(mesh)


def safe_cleanup_orphan_meshes(bpy_module: Any) -> dict[str, int]:
    """Remove only safe, preview-only orphan mesh datablocks.

    A candidate has no users, is not linked from another library, and does not
    use a fake user.  ``bpy_module`` is explicit so ordinary Python tests can
    provide a fake ``data.meshes`` collection.  Materials and images are never
    inspected or modified.
    """
    meshes = bpy_module.data.meshes
    snapshot = list(meshes)
    candidates = [
        mesh for mesh in snapshot
        if getattr(mesh, "users", None) == 0
        and getattr(mesh, "library", None) is None
        and not bool(getattr(mesh, "use_fake_user", False))
    ]
    removed = 0
    for mesh in candidates:
        try:
            _remove_mesh(meshes, mesh)
        except (AttributeError, RuntimeError, TypeError, ValueError):
            continue
        removed += 1
    return {
        "candidates": len(candidates),
        "removed": removed,
        "skipped": len(snapshot) - len(candidates),
    }


def safe_delete_preview_objects(
    objects: Iterable[Any],
    scope: Any = None,
    *,
    action: str = "delete",
) -> dict[str, Any]:
    """Delete or hide out-of-scope mesh/empty objects without touching architecture.

    ``objects`` may be a Blender collection or a plain iterable used by tests.
    Architectural objects are always retained, regardless of scope.  Objects of
    other Blender types are also retained because this helper only operates on
    ``MESH`` and ``EMPTY`` objects.  ``action`` is either ``"delete"`` or
    ``"hide"``; deletion uses the supplied collection's ``remove`` method and
    supports both Blender datablocks and ordinary mutable test collections.
    """
    if action not in {"delete", "hide"}:
        raise ValueError("action must be 'delete' or 'hide'")

    snapshot = list(objects)
    decisions = [preview_object_decision(obj, scope) for obj in snapshot]
    actionable = [
        (obj, decision)
        for obj, decision in zip(snapshot, decisions)
        if decision["reason"] in {"already_hidden", "outside_scope", "excluded"}
        and decision["type"].upper() in {"MESH", "EMPTY"}
    ]
    deleted = 0
    hidden = 0
    failed = 0

    for obj, _ in actionable:
        try:
            if action == "hide":
                hide_set = getattr(obj, "hide_set", None)
                if callable(hide_set):
                    hide_set(True)
                setattr(obj, "hide_render", True)
                setattr(obj, "hide_viewport", True)
                hidden += 1
            else:
                try:
                    objects.remove(obj, do_unlink=True)
                except TypeError:
                    objects.remove(obj)
                deleted += 1
        except (AttributeError, RuntimeError, TypeError, ValueError):
            failed += 1

    kept = [decision for decision in decisions if decision["keep"]]
    cropped = [decision for decision in decisions if decision["crop"]]

    def counts(items: Iterable[Mapping[str, Any]], key: str) -> dict[str, int]:
        values = (str(item[key]) if item[key] is not None else "<unknown>" for item in items)
        return dict(sorted(Counter(values).items()))

    stats = {
        "object_count": len(decisions),
        "kept_count": len(kept),
        "cropped_count": len(cropped),
        "kept_by_type": counts(kept, "type"),
        "cropped_by_type": counts(cropped, "type"),
        "kept_by_room": counts(kept, "room"),
        "cropped_by_room": counts(cropped, "room"),
        "cropped_by_reason": counts(cropped, "reason"),
        "action": action,
        "actionable_count": len(actionable),
        "deleted_count": deleted,
        "hidden_count": hidden,
        "failed_count": failed,
        "skipped_count": len(snapshot) - len(actionable),
    }
    return stats


# Short aliases useful to Blender scripts and callers migrating from ad-hoc code.
object_decision = preview_object_decision
statistics = preview_statistics


__all__ = [
    "filter_objects",
    "object_decision",
    "object_scope_fields",
    "parse_scope",
    "preview_object_decision",
    "preview_statistics",
    "resolve_scope",
    "safe_cleanup_orphan_meshes",
    "safe_delete_preview_objects",
    "should_keep_object",
    "statistics",
]


if __name__ == "__main__":
    raise SystemExit("blender_preview is a library module; import it from a Blender script")
