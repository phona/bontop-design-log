"""Pure-logic tests for blender_preview; Blender is not required."""
from __future__ import annotations

from pathlib import Path
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))

from blender_preview import (  # noqa: E402
    preview_object_decision,
    preview_statistics,
    safe_cleanup_orphan_meshes,
)


def _obj(name: str, *, room: str | None = None, object_type: str = "MESH",
         role: str | None = None, hidden: bool = False, **metadata) -> SimpleNamespace:
    props = dict(metadata)
    if room is not None:
        props["room"] = room
    if role is not None:
        props["role"] = role
    return SimpleNamespace(
        name=name,
        type=object_type,
        hide_render=hidden,
        hide_viewport=False,
        get=props.get,
    )


class _FakeMeshes(list):
    def remove(self, mesh, *, do_unlink=False):
        self.unlink_requested = do_unlink
        super().remove(mesh)


class _FakeBpy:
    def __init__(self, meshes):
        self.data = SimpleNamespace(meshes=_FakeMeshes(meshes))


def _mesh(name: str, *, users: int = 0, fake_user: bool = False, linked: bool = False):
    return SimpleNamespace(
        name=name,
        users=users,
        use_fake_user=fake_user,
        library=SimpleNamespace(name="linked.blend") if linked else None,
    )


def test_cleanup_orphan_meshes_uses_fake_bpy_and_preserves_referenced_meshes():
    orphan = _mesh("orphan", users=0)
    referenced = _mesh("referenced", users=1)
    fake_user = _mesh("fake-user", fake_user=True)
    linked = _mesh("linked", linked=True)
    bpy = _FakeBpy([orphan, referenced, fake_user, linked])

    assert safe_cleanup_orphan_meshes(bpy) == {
        "candidates": 1,
        "removed": 1,
        "skipped": 3,
    }
    assert bpy.data.meshes == [referenced, fake_user, linked]
    assert bpy.data.meshes.unlink_requested is True


def test_room_scope_keeps_matching_room_and_crops_other_rooms():
    in_scope = _obj("furniture:living_dining:sofa:0", room="living_dining")
    outside_scope = _obj("furniture:bedroom_nw:bed:0", room="bedroom_nw")

    assert preview_object_decision(in_scope, {"rooms": "living_dining"}) == {
        "keep": True,
        "crop": False,
        "reason": "in_scope",
        "name": "furniture:living_dining:sofa:0",
        "room": "living_dining",
        "role": "sofa",
        "type": "MESH",
    }
    decision = preview_object_decision(outside_scope, "room:living_dining")
    assert decision["keep"] is False
    assert decision["crop"] is True
    assert decision["reason"] == "outside_scope"


def test_room_scope_always_keeps_architectural_objects():
    architectural = [
        _obj("wall:living_dining:north", room="bedroom_nw"),
        _obj("floor:living_dining", room="bedroom_nw"),
        _obj("ceiling:house", room=None),
    ]

    decisions = [preview_object_decision(obj, {"rooms": "living_dining"})
                 for obj in architectural]

    assert [decision["keep"] for decision in decisions] == [True, True, True]
    assert [decision["reason"] for decision in decisions] == [
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
    ]


def test_glass_architecture_names_are_kept_but_curtain_state_is_not_architecture():
    architectural = [
        _obj("west_curtain", room="bedroom_nw"),
        _obj("west_curtain:part=w_mb_south", room="bedroom_nw"),
        _obj("curtain_run:west_curtain", room="bedroom_nw"),
        _obj("glass_infill:foo", room="bedroom_nw"),
    ]
    curtain_state = _obj("curtain_master_south:sheer:deployed", room="bedroom_nw")

    architectural_decisions = [
        preview_object_decision(obj, {"rooms": "living_dining"})
        for obj in architectural
    ]
    curtain_state_decision = preview_object_decision(
        curtain_state,
        {"rooms": "living_dining"},
    )

    assert [decision["reason"] for decision in architectural_decisions] == [
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
    ]
    assert curtain_state_decision["reason"] != "always_keep_architecture"
    assert curtain_state_decision["keep"] is False


def test_formal_architecture_without_room_metadata_is_kept():
    objects = [
        _obj("wall:seg:42", sourceClass="formal", object_type="wall"),
        _obj("building_shell", sourceClass="formal", object_type="MESH"),
        _obj("window:master_south", sourceClass="formal", object_type="window"),
        _obj("floor:master_bedroom", sourceClass="formal", object_type="floor"),
        _obj("asset:master_bedroom:bed", sourceClass="formal"),
    ]

    decisions = [preview_object_decision(obj, {"rooms": "master_bedroom"}) for obj in objects]

    assert [decision["keep"] for decision in decisions] == [True, True, True, True, False]
    assert [decision["reason"] for decision in decisions] == [
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
        "outside_scope",
    ]


def test_glb_architecture_types_are_kept_but_curtain_and_furniture_are_cropped():
    objects = [
        _obj("glb_node_wall", room="other_room", type="wall"),
        _obj("glb_node_floor", room="other_room", type="floor_region"),
        _obj("glb_node_wall_run", room="other_room", type="wall_run"),
        _obj("glb_node_curtain", room="other_room", type="curtain"),
        _obj("furniture:other_room:sofa:0", room="other_room", type="furniture"),
    ]

    decisions = [preview_object_decision(obj, {"rooms": "master_bedroom"}) for obj in objects]

    assert [decision["keep"] for decision in decisions] == [True, True, True, False, False]
    assert [decision["reason"] for decision in decisions] == [
        "always_keep_architecture",
        "always_keep_architecture",
        "always_keep_architecture",
        "outside_scope",
        "outside_scope",
    ]


def test_external_objects_are_counted_as_cropped_with_breakdown():
    objects = [
        _obj("furniture:living_dining:sofa:0", room="living_dining"),
        _obj("external:bedroom_nw:imported-lamp", room="bedroom_nw"),
        _obj("external:garden:reference", room="garden"),
        _obj("external:unknown:mesh"),
    ]

    assert preview_statistics(objects, {"rooms": "living_dining"}) == {
        "object_count": 4,
        "kept_count": 1,
        "cropped_count": 3,
        "kept_by_type": {"MESH": 1},
        "cropped_by_type": {"MESH": 3},
        "kept_by_room": {"living_dining": 1},
        "cropped_by_room": {"<unknown>": 1, "bedroom_nw": 1, "garden": 1},
        "cropped_by_reason": {"outside_scope": 3},
    }


def test_statistics_distinguish_hidden_excluded_and_outside_objects():
    objects = [
        _obj("furniture:living_dining:sofa:0", room="living_dining"),
        _obj("furniture:living_dining:lamp:0", room="living_dining", role="lamp"),
        _obj("external:bedroom_nw:hidden", room="bedroom_nw", hidden=True),
        _obj("external:bedroom_nw:bed", room="bedroom_nw"),
        _obj("wall:living_dining:north", room="bedroom_nw"),
    ]

    assert preview_statistics(
        objects,
        {"rooms": "living_dining", "exclude": {"roles": "lamp"}},
    ) == {
        "object_count": 5,
        "kept_count": 2,
        "cropped_count": 3,
        "kept_by_type": {"MESH": 2},
        "cropped_by_type": {"MESH": 3},
        "kept_by_room": {"bedroom_nw": 1, "living_dining": 1},
        "cropped_by_room": {"bedroom_nw": 2, "living_dining": 1},
        "cropped_by_reason": {
            "already_hidden": 1,
            "excluded": 1,
            "outside_scope": 1,
        },
    }


def test_statistics_include_hidden_can_retain_hidden_object():
    objects = [_obj("external:living_dining:hidden", room="living_dining", hidden=True)]

    assert preview_statistics(objects, {"rooms": "living_dining"})["cropped_by_reason"] == {
        "already_hidden": 1,
    }
    assert preview_statistics(
        objects,
        {"rooms": "living_dining", "include_hidden": True},
    ) == {
        "object_count": 1,
        "kept_count": 1,
        "cropped_count": 0,
        "kept_by_type": {"MESH": 1},
        "cropped_by_type": {},
        "kept_by_room": {"living_dining": 1},
        "cropped_by_room": {},
        "cropped_by_reason": {},
    }


if __name__ == "__main__":
    test_cleanup_orphan_meshes_uses_fake_bpy_and_preserves_referenced_meshes()
    test_room_scope_keeps_matching_room_and_crops_other_rooms()
    test_room_scope_always_keeps_architectural_objects()
    test_glass_architecture_names_are_kept_but_curtain_state_is_not_architecture()
    test_formal_architecture_without_room_metadata_is_kept()
    test_glb_architecture_types_are_kept_but_curtain_and_furniture_are_cropped()
    test_external_objects_are_counted_as_cropped_with_breakdown()
    test_statistics_distinguish_hidden_excluded_and_outside_objects()
    test_statistics_include_hidden_can_retain_hidden_object()
    print("PASS")
