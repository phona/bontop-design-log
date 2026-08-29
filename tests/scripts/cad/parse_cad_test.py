import logging
import os
import sys
import tempfile
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts' / 'cad'))

from parse_cad import (
    extract_room_labels,
    extract_room_geometry,
    latest_dxf,
    load_house_room_ids,
    parse_args,
    parse_room_label,
    merge_with_previous_layout,
    write_layout_yaml,
    OUTPUT_YAML,
    Room,
    Platform,
)


def test_latest_dxf_returns_most_recent_file():
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        old = d / "floor_plan_design_2026-07-01.dxf"
        new = d / "floor_plan_design_2026-07-05.dxf"
        old.write_text("old")
        new.write_text("new")
        # Ensure distinct mtimes so the most-recent sort is deterministic.
        base_mtime = old.stat().st_mtime
        os.utime(old, (base_mtime, base_mtime))
        os.utime(new, (base_mtime + 2, base_mtime + 2))
        assert latest_dxf(d) == new


def test_latest_dxf_raises_when_no_dxf():
    with tempfile.TemporaryDirectory() as tmp:
        with pytest.raises(FileNotFoundError):
            latest_dxf(Path(tmp))


def test_parse_room_label_simple():
    assert parse_room_label("master_bedroom\n主卧") == ("master_bedroom", "主卧")


def test_parse_room_label_multiline():
    text = "master_bedroom\n主卧\n面积18.16m²\n周长18.39m"
    assert parse_room_label(text) == ("master_bedroom", "主卧")


def test_parse_room_label_missing_id():
    assert parse_room_label("主卧") is None


def test_parse_room_label_new_format_id_first():
    """CAD labels use id^J中文名^J面积 format (^J = newline)."""
    assert parse_room_label("master_bedroom\n主卧\n面积18.16m²") == ("master_bedroom", "主卧")


def test_parse_room_label_new_format_multiline():
    text = "master_bath\n卫生间\n面积4.20m²"
    assert parse_room_label(text) == ("master_bath", "卫生间")


def test_parse_room_label_new_format_no_area():
    """ID and name without area line should still parse."""
    assert parse_room_label("master_bedroom\n主卧") == ("master_bedroom", "主卧")


def test_extract_room_labels_from_dxf():
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_mtext("master_bedroom\n主卧", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_mtext("bedroom_nw\n次卧", dxfattribs={"layer": "SH-文字标注", "insert": (-500, 1000, 0)})
    msp.add_mtext("衣帽间", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})
    labels, skipped = extract_room_labels(msp)
    assert labels["master_bedroom"] == ("主卧", 1000.0, 2000.0)
    assert labels["bedroom_nw"] == ("次卧", -500.0, 1000.0)
    assert "衣帽间" in skipped


def test_extract_room_geometry():
    from ezdxf.document import Drawing
    from parse_cad import extract_room_geometry

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    doc.layers.add("BS-非承重墙")
    msp.add_mtext("master_bedroom\n主卧", dxfattribs={"layer": "SH-文字标注", "insert": (4500, 2000, 0)})
    msp.add_line((2000, 0), (7000, 0), dxfattribs={"layer": "BS-非承重墙"})
    msp.add_line((7000, 0), (7000, 4000), dxfattribs={"layer": "BS-非承重墙"})
    msp.add_line((7000, 4000), (2000, 4000), dxfattribs={"layer": "BS-非承重墙"})
    msp.add_line((2000, 4000), (2000, 0), dxfattribs={"layer": "BS-非承重墙"})
    labels = {"master_bedroom": ("主卧", 4500.0, 2000.0)}
    rooms = extract_room_geometry(labels, msp)
    assert len(rooms) == 1
    r = rooms[0]
    assert r.id == "master_bedroom"
    assert r.width == 5.0
    assert r.depth == 4.0


def test_write_layout_yaml(tmp_path: Path):
    out = tmp_path / "model-geometry-from-cad.yaml"
    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    platform = Platform(
        id="west_platform",
        name="西设备平台",
        x=-8.5,
        z=2.0,
        width=1.6,
        depth=1.55,
        height=3.0,
        area=2.48,
    )
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, platform, out)
    assert out.exists()
    assert report["rooms_found"] == 1
    content = out.read_text(encoding="utf-8")
    assert "master_bedroom" in content
    assert "west_platform" in content


def test_write_layout_yaml_no_previous_diff(tmp_path: Path):
    out = tmp_path / "model-geometry-from-cad.yaml"
    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, out)
    assert report["diff"] == "no previous layout to diff against"


def test_write_layout_yaml_diff_changes(tmp_path: Path):
    out = tmp_path / "model-geometry-from-cad.yaml"
    previous = {
        "version": "1.0",
        "rooms": [
            {
                "id": "master_bedroom",
                "name": "主卧",
                "x": -5.30,
                "z": 2.0,
                "width": 4.45,
                "depth": 4.05,
                "height": 3.0,
                "area": 18.02,
                "perimeter": 18.39,
            }
        ],
    }
    with open(out, "w", encoding="utf-8") as f:
        yaml.dump(previous, f, allow_unicode=True, sort_keys=False, default_flow_style=False)

    rooms = [
        Room(
            id="bedroom_nw",
            name="西北次卧",
            x=-5.35,
            z=-3.5,
            width=3.0,
            depth=2.8,
            height=3.0,
            area=8.39,
            perimeter=11.6,
        )
    ]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, out)
    assert report["diff"] == ["bedroom_nw: added"]


def test_load_house_room_ids_from_config():
    ids = load_house_room_ids()
    assert "master_bedroom" in ids
    assert "bedroom_nw" in ids
    assert "entry_garden" in ids
    assert "south_balcony" in ids
    assert "west_platform" in ids


def test_load_house_room_ids_missing_config(tmp_path: Path):
    missing = tmp_path / "missing.yaml"
    with pytest.raises(FileNotFoundError, match="House config not found"):
        load_house_room_ids(missing)


def test_load_house_room_ids_malformed_config(tmp_path: Path):
    malformed = tmp_path / "malformed.yaml"
    malformed.write_text("rooms: [not a mapping", encoding="utf-8")
    with pytest.raises(ValueError, match="Failed to parse house config"):
        load_house_room_ids(malformed)


def test_load_house_room_ids_empty_config(tmp_path: Path):
    empty = tmp_path / "empty.yaml"
    empty.write_text("rooms: []\ngift_areas: []\n", encoding="utf-8")
    with pytest.raises(ValueError, match="No valid room IDs found"):
        load_house_room_ids(empty)


def test_write_layout_yaml_corrupted_previous(tmp_path: Path):
    out = tmp_path / "model-geometry-from-cad.yaml"
    out.write_text("not valid yaml: [", encoding="utf-8")
    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, out)
    assert report["diff"] == "previous YAML corrupted, cannot diff"


def test_write_layout_yaml_reports_skipped_labels(tmp_path: Path):
    out = tmp_path / "model-geometry-from-cad.yaml"
    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    skipped = ["衣帽间", "杂物间"]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, out, skipped_labels=skipped)
    assert report["skipped_labels"] == skipped


def test_merge_keeps_unlabeled_rooms(tmp_path: Path):
    from parse_cad import Room, merge_with_previous_layout, write_layout_yaml

    output = tmp_path / "layout.yaml"
    prev = {
        "version": "1.0",
        "source": "old.dxf",
        "unit": "m",
        "scale": 0.001,
        "origin": {"x": 0, "z": 0},
        "export_date": "2026-07-09",
        "rooms": [
            {
                "id": "entry_garden",
                "name": "入户花园",
                "x": 0,
                "z": -8.8,
                "width": 6.7,
                "depth": 1.65,
                "height": 3.0,
                "area": 11.06,
                "perimeter": 16.7,
            }
        ],
        "platform": {
            "id": "west_platform",
            "name": "西设备平台",
            "x": -8.5,
            "z": 2.0,
            "width": 1.6,
            "depth": 1.55,
            "height": 3.0,
            "area": 2.48,
        },
    }
    output.write_text(yaml.dump(prev), encoding="utf-8")

    rooms = [Room(id="master_bedroom", name="主卧", x=0, z=0, width=1, depth=1, height=3, area=1, perimeter=4)]
    merged_rooms, platform = merge_with_previous_layout(rooms, None, output)
    assert len(merged_rooms) == 2
    assert any(r.id == "entry_garden" for r in merged_rooms)
    assert platform is not None
    assert platform.id == "west_platform"


def test_merge_does_not_overwrite_cad_extracted_room(tmp_path: Path):
    from parse_cad import merge_with_previous_layout

    output = tmp_path / "layout.yaml"
    previous = {
        "version": "1.0",
        "rooms": [
            {
                "id": "master_bedroom",
                "name": "主卧",
                "x": 0.0,
                "z": 0.0,
                "width": 10.0,
                "depth": 10.0,
                "height": 3.0,
                "area": 100.0,
                "perimeter": 40.0,
            }
        ],
    }
    output.write_text(yaml.dump(previous), encoding="utf-8")

    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    merged_rooms, _ = merge_with_previous_layout(rooms, None, output)
    assert len(merged_rooms) == 1
    master = next(r for r in merged_rooms if r.id == "master_bedroom")
    assert master.x == -5.35
    assert master.z == 2.0
    assert master.width == 4.5
    assert master.depth == 4.05
    assert master.area == 18.16
    assert master.perimeter == 18.39
    assert master.name == "主卧"


def test_extract_room_labels_skips_chinese_only_labels():
    """Labels without ID prefix are skipped, not guessed."""
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_mtext("master_bedroom\n主卧", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_text("走廊", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})
    labels, skipped = extract_room_labels(msp)
    assert "master_bedroom" in labels
    assert "走廊" in skipped
    assert len(labels) == 1


def test_extract_room_labels_logs_warning_for_unmapped_label(caplog):
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_text("走廊", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})

    with caplog.at_level(logging.WARNING, logger="parse_cad"):
        labels, skipped = extract_room_labels(msp)
        assert "走廊" in skipped
        assert any("走廊" in rec.message for rec in caplog.records)


def test_cad_geometry_is_authoritative(tmp_path: Path):
    """CAD-extracted geometry must be used, not overwritten by previous YAML."""
    from parse_cad import merge_with_previous_layout

    output = tmp_path / "layout.yaml"
    previous = {
        "version": "1.0",
        "rooms": [
            {
                "id": "master_bedroom",
                "name": "主卧",
                "x": 0.0,
                "z": 0.0,
                "width": 10.0,
                "depth": 10.0,
                "height": 3.0,
                "area": 100.0,
                "perimeter": 40.0,
            }
        ],
    }
    output.write_text(yaml.dump(previous), encoding="utf-8")

    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.5,
            z=2.0,
            width=4.6,
            depth=4.0,
            height=3.0,
            area=None,
            perimeter=None,
        )
    ]
    platform = Platform(
        id="west_platform",
        name="西设备平台",
        x=-8.5,
        z=2.0,
        width=1.6,
        depth=1.55,
        height=3.0,
        area=2.48,
    )
    merged, _ = merge_with_previous_layout(rooms, platform, output)
    mb = next((r for r in merged if r.id == "master_bedroom"), None)
    assert mb is not None
    assert mb.x == -5.5
    assert mb.width == 4.6


def test_output_flag(tmp_path: Path):
    """--output flag writes to custom path."""
    custom_out = tmp_path / "custom" / "output.yaml"
    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, custom_out)
    assert custom_out.exists()
    assert "master_bedroom" in custom_out.read_text(encoding="utf-8")


def test_collect_wall_segments_filters_to_labeled_copy():
    """When the DXF contains a duplicate unlabeled plan copy, only wall segments
    whose midpoint lies within the labeled-copy bounds are returned."""
    from ezdxf.document import Drawing

    from parse_cad import collect_wall_segments

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # labeled copy around x=30000
    msp.add_line((29000, 0), (31000, 0), dxfattribs={"layer": "BS-非承重墙"})
    # duplicate unlabeled copy around x=0 (e.g. the 墙体定位图 sheet)
    msp.add_line((-1000, 0), (1000, 0), dxfattribs={"layer": "BS-非承重墙"})
    bounds = (27000, -5000, 40000, 5000)
    segs = collect_wall_segments(msp, bounds=bounds)
    assert len(segs) == 1
    assert segs[0] == ((29000.0, 0.0), (31000.0, 0.0))


def test_extract_walls_returns_origin_subtracted_meters():
    """Wall segments are exported in meters, origin-subtracted, axis-aligned."""
    from ezdxf.document import Drawing

    from parse_cad import CadAnchor, extract_walls

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # vertical wall at x=3000mm, y[1000,5000]; origin (1000,1000)mm -> x=2.0m z[0,4]
    msp.add_line((3000, 1000), (3000, 5000), dxfattribs={"layer": "BS-非承重墙"})
    anchor = CadAnchor(origin_x=1000.0, origin_y=1000.0, frame=(0, 0, 5000, 6000))
    walls = extract_walls(msp, anchor)
    assert len(walls) == 1
    w = walls[0]
    assert (w.x1, w.z1, w.x2, w.z2) == (2.0, 0.0, 2.0, -4.0)


def test_write_layout_yaml_includes_walls_and_origin(tmp_path: Path):
    """YAML output contains the walls list and the computed origin."""
    out = tmp_path / "model-geometry-from-cad.yaml"
    rooms = [
        Room(id="master_bedroom", name="主卧", x=-5.35, z=2.0, width=4.5, depth=4.05,
             height=3.0, area=18.16, perimeter=18.39)
    ]
    from parse_cad import Wall

    walls = [Wall(x1=0.0, z1=0.0, x2=5.0, z2=0.0)]
    report = write_layout_yaml(
        tmp_path / "source.dxf", rooms, None, out,
        walls=walls, origin=(3000.0, 2000.0),
    )
    data = yaml.safe_load(out.read_text(encoding="utf-8"))
    assert report["rooms_found"] == 1
    assert "walls" in data and len(data["walls"]) == 1
    assert data["walls"][0]["x1"] == 0.0
    assert data["origin"]["x"] == 3.0
    assert data["origin"]["z"] == 2.0


def test_extract_room_geometry_uses_merged_wall_line_across_opening_gap():
    """A wall split by an opening (window/door gap) must still be detected as the
    room boundary via its merged line, instead of falling back to a closer spur
    wall that does not span the label."""
    from ezdxf.document import Drawing

    from parse_cad import extract_room_geometry

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    walls = [
        (0, 0, 5000, 0),                      # south
        (0, 4000, 2000, 4000), (3000, 4000, 5000, 4000),  # north, window gap [2000,3000]
        (0, 0, 0, 4000), (5000, 0, 5000, 4000),           # west, east
        (0, 3000, 1000, 3000),               # closer spur that does NOT span label x=2500
    ]
    for x1, y1, x2, y2 in walls:
        msp.add_line((x1, y1), (x2, y2), dxfattribs={"layer": "BS-非承重墙"})
    labels = {"master_bedroom": ("主卧", 2500.0, 2000.0)}
    rooms = extract_room_geometry(labels, msp)
    assert len(rooms) == 1
    assert rooms[0].depth == 4.0


def test_enumerate_faces_simple_rectangle():
    """A single closed rectangle → one interior face."""
    from parse_cad import _enumerate_faces

    segs = [((0, 0), (5, 0)), ((5, 0), (5, 4)), ((5, 4), (0, 4)), ((0, 4), (0, 0))]
    faces = _enumerate_faces(segs)
    assert len(faces) >= 1
    # Find the smallest face (the interior)
    interiors = [f for f in faces if f[0] != f[-1] or len(f) >= 4]
    # Look for the face that has area (a closed loop)
    for f in faces:
        if len(f) >= 5:  # minimal CCW rectangle has 5 nodes (start repeated)
            # Check it's the right size: x in [0,5], y in [0,4]
            xs = [p[0] for p in f]
            ys = [p[1] for p in f]
            if min(xs) == 0 and max(xs) == 5 and min(ys) == 0 and max(ys) == 4:
                return
    assert False, "no valid interior face found"


def test_enumerate_faces_two_adjacent_rooms():
    """Two rooms sharing a wall → two interior faces."""
    from parse_cad import _enumerate_faces

    segs = [
        ((0, 0), (5, 0)), ((5, 0), (9, 0)),
        ((0, 4), (5, 4)), ((5, 4), (9, 4)),
        ((0, 0), (0, 4)), ((5, 0), (5, 4)), ((9, 0), (9, 4)),
    ]
    faces = _enumerate_faces(segs)
    # Should find exactly 3 faces: room A, room B, and exterior (or more)
    interior_faces = [f for f in faces if len(f) >= 5]
    assert len(interior_faces) >= 2
    # Verify at least one has xs in [0,5] and one in [5,9]
    xs_ranges = [(min(p[0] for p in f), max(p[0] for p in f)) for f in interior_faces]
    has_room_a = any((lo, hi) == (0, 5) for lo, hi in xs_ranges)
    has_room_b = any((lo, hi) == (5, 9) for lo, hi in xs_ranges)
    assert has_room_a, f"no room A in {xs_ranges}"
    assert has_room_b, f"no room B in {xs_ranges}"


def test_extract_room_geometry_finds_per_room_rectangle_not_whole_plan():
    """Two adjacent rooms must each get their own rectangle, not the union bbox.

    Reproduces the real DXF bug where the 10m-window min/max heuristic swallowed
    the entire plan into every room. With a proper nearest-wall-per-direction
    trace, each room is bounded by the four walls enclosing its label.
    """
    from ezdxf.document import Drawing

    from parse_cad import extract_room_geometry

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # Room A: x[0,5000] y[0,4000]; Room B: x[5000,9000] y[0,4000] (share wall at x=5000)
    walls = [
        (0, 0, 5000, 0), (5000, 0, 9000, 0),
        (0, 4000, 5000, 4000), (5000, 4000, 9000, 4000),
        (0, 0, 0, 4000), (5000, 0, 5000, 4000), (9000, 0, 9000, 4000),
    ]
    for x1, y1, x2, y2 in walls:
        msp.add_line((x1, y1), (x2, y2), dxfattribs={"layer": "BS-非承重墙"})
    labels = {
        "master_bedroom": ("主卧", 2500.0, 2000.0),
        "bedroom_nw": ("次卧", 7000.0, 2000.0),
    }
    rooms = extract_room_geometry(labels, msp)
    by_id = {r.id: r for r in rooms}
    assert by_id["master_bedroom"].width == 5.0
    assert by_id["master_bedroom"].depth == 4.0
    assert by_id["bedroom_nw"].width == 4.0
    assert by_id["bedroom_nw"].depth == 4.0





def test_geometry_changes_in_report(tmp_path: Path):
    """Report includes geometry_changes when CAD differs from previous YAML."""
    out = tmp_path / "model-geometry-from-cad.yaml"
    previous = {
        "version": "1.0",
        "rooms": [
            {
                "id": "master_bedroom",
                "name": "主卧",
                "x": -5.30,
                "z": 2.5,
                "width": 4.45,
                "depth": 4.05,
                "height": 3.0,
                "area": 18.02,
                "perimeter": 18.39,
            }
        ],
    }
    with open(out, "w", encoding="utf-8") as f:
        yaml.dump(previous, f, allow_unicode=True, sort_keys=False, default_flow_style=False)

    rooms = [
        Room(
            id="master_bedroom",
            name="主卧",
            x=-5.35,
            z=2.0,
            width=4.5,
            depth=4.05,
            height=3.0,
            area=18.16,
            perimeter=18.39,
        )
    ]
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, None, out)
    changes = report.get("geometry_changes", [])
    assert len(changes) > 0
    field_ids = {(c["room_id"], c["field"]) for c in changes}
    assert ("master_bedroom", "x") in field_ids
    assert ("master_bedroom", "z") in field_ids





def test_flood_fill_reads_centroids_from_config(tmp_path: Path, monkeypatch):
    """_flood_fill_rooms reads expected_centroid from house.yaml, not hardcoded."""
    from parse_cad import _flood_fill_rooms
    import parse_cad

    house_config = tmp_path / "house.yaml"
    house_config.write_text(yaml.dump({
        "gift_areas": [
            {"id": "south_balcony", "expected_centroid": {"x": 3.19, "z": 3.06}, "area": 13.95},
            {"id": "entry_garden", "expected_centroid": {"x": 3.19, "z": -10.04}, "area": 11.06},
            {"id": "west_platform", "expected_centroid": {"x": -5.31, "z": 0.76}, "area": 2.48},
        ],
        "rooms": [],
    }, allow_unicode=True), encoding="utf-8")

    monkeypatch.setattr(parse_cad, "HOUSE_CONFIG", house_config)

    labels = {"master_bedroom": ("主卧", -3000.0, -3000.0)}
    segs = [
        ((-6000, -6000), (0, -6000)),
        ((0, -6000), (0, 0)),
        ((0, 0), (-6000, 0)),
        ((-6000, 0), (-6000, -6000)),
        ((1000, 1000), (5500, 1000)),
        ((5500, 1000), (5500, 5500)),
        ((5500, 5500), (1000, 5500)),
        ((1000, 5500), (1000, 1000)),
    ]
    result = _flood_fill_rooms(segs, labels)
    assert "master_bedroom" in result
    assert "south_balcony" in result


def test_load_cad_anchor_valid(tmp_path: Path):
    from parse_cad import load_cad_anchor
    p = tmp_path / "cad-anchor.yaml"
    p.write_text(
        "version: 1\n"
        "dxf_origin: {x: 31642.04, y: -12484.34}\n"
        "dxf_frame: {min_x: 25500, min_y: -18200, max_x: 40500, max_y: -7900}\n",
        encoding="utf-8",
    )
    anchor = load_cad_anchor(p)
    assert anchor.origin_x == 31642.04
    assert anchor.origin_y == -12484.34
    assert anchor.frame == (25500.0, -18200.0, 40500.0, -7900.0)


def test_load_cad_anchor_missing_file_fails_loud(tmp_path: Path):
    from parse_cad import load_cad_anchor
    with pytest.raises(FileNotFoundError, match="cad-anchor"):
        load_cad_anchor(tmp_path / "nope.yaml")


def test_load_cad_anchor_missing_field_fails_loud(tmp_path: Path):
    from parse_cad import load_cad_anchor
    p = tmp_path / "cad-anchor.yaml"
    p.write_text("version: 1\ndxf_origin: {x: 1.0, y: 2.0}\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_cad_anchor(p)





def _write_anchor(tmp_path: Path, ox: float, oy: float,
                  frame: tuple[float, float, float, float]) -> Path:
    p = tmp_path / "cad-anchor.yaml"
    p.write_text(
        f"version: 1\n"
        f"dxf_origin: {{x: {ox}, y: {oy}}}\n"
        f"dxf_frame: {{min_x: {frame[0]}, min_y: {frame[1]}, "
        f"max_x: {frame[2]}, max_y: {frame[3]}}}\n",
        encoding="utf-8",
    )
    return p


def test_extract_walls_uses_anchor_origin():
    """墙体坐标 = (DXF - 锚点原点) / 1000，y 轴翻转。"""
    from parse_cad import CadAnchor, extract_walls

    class FakeLine:
        def __init__(self, s, e):
            self.dxf = type("D", (), {})()
            self.dxf.layer = "BS-非承重墙"
            self.dxf.start = type("P", (), {"x": s[0], "y": s[1]})()
            self.dxf.end = type("P", (), {"x": e[0], "y": e[1]})()
        def dxftype(self):
            return "LINE"

    anchor = CadAnchor(origin_x=30000.0, origin_y=-10000.0,
                       frame=(25000.0, -20000.0, 40000.0, -5000.0))
    msp = [FakeLine((31000.0, -12000.0), (33000.0, -12000.0))]
    walls = extract_walls(msp, anchor)
    assert len(walls) == 1
    assert (walls[0].x1, walls[0].z1) == (1.0, 2.0)
    assert (walls[0].x2, walls[0].z2) == (3.0, 2.0)


def test_extract_walls_frame_filters_duplicate_copy():
    """图框外的重复图纸副本墙线被排除。"""
    from parse_cad import CadAnchor, extract_walls

    class FakeLine:
        def __init__(self, s, e):
            self.dxf = type("D", (), {})()
            self.dxf.layer = "BS-非承重墙"
            self.dxf.start = type("P", (), {"x": s[0], "y": s[1]})()
            self.dxf.end = type("P", (), {"x": e[0], "y": e[1]})()
        def dxftype(self):
            return "LINE"

    anchor = CadAnchor(origin_x=30000.0, origin_y=-10000.0,
                       frame=(25000.0, -20000.0, 40000.0, -5000.0))
    inside = FakeLine((31000.0, -12000.0), (33000.0, -12000.0))
    duplicate_copy = FakeLine((5000.0, -12000.0), (7000.0, -12000.0))
    walls = extract_walls([inside, duplicate_copy], anchor)
    assert len(walls) == 1


def test_extract_has_no_hardcoded_entry_garden():
    """extract() 源码不得硬编码任何房间几何。"""
    src = Path("scripts/cad/parse_cad.py").read_text(encoding="utf-8")
    assert 'id="entry_garden"' not in src
    assert "compute_origin" not in src
    assert "label_cluster_bounds" not in src


def test_wall_dataclass_is_pure_geometry():
    """Wall 只允许纯几何字段——出现意图字段（如 curtain）即失败。"""
    from dataclasses import fields
    from parse_cad import Wall
    assert {f.name for f in fields(Wall)} == {"x1", "z1", "x2", "z2"}


def test_walls_yaml_output_contains_only_geometry_fields(tmp_path: Path):
    from parse_cad import Room, Wall, write_layout_yaml
    rooms = [Room(id="r1", name="房", x=0, z=0, width=1, depth=1, height=3, area=1.0, perimeter=4.0)]
    walls = [Wall(x1=0, z1=0, x2=1, z2=0)]
    out = tmp_path / "layout.yaml"
    write_layout_yaml(
        tmp_path / "source.dxf", rooms, None, out,
        walls=walls, origin=(0.0, 0.0),
    )
    data = yaml.safe_load(out.read_text(encoding="utf-8"))
    for w in data["walls"]:
        assert set(w.keys()) == {"x1", "z1", "x2", "z2"}, f"意图字段泄漏: {w}"


def test_no_intent_guessing_code_in_parse_cad():
    """铁律守卫：parse_cad.py 不得包含任何幕墙分类/最外侧判定/弧化合成代码。"""
    src = Path("scripts/cad/parse_cad.py").read_text(encoding="utf-8")
    for banned in ["curtain", "_is_outermost", "_smooth_diagonals", "bulge"]:
        assert banned not in src, f"禁止的意图猜测标识重新出现: {banned}"


def test_committed_layout_walls_share_frame_with_rooms():
    """守卫：model-geometry.yaml 的 walls 与 rooms 必须在同一坐标系。

    2026-07-14 曾发生 origin 静默塌陷导致 walls 跑到 30 米外。
    """
    data = yaml.safe_load(
        Path("config/layout/model-geometry.yaml").read_text(encoding="utf-8")
    )
    rooms, walls = data["rooms"], data.get("walls", [])
    assert walls, "model-geometry.yaml 应包含墙体"
    vertices = {vertex["id"]: vertex for vertex in data["vertices"]}
    wall_vertices = [
        vertices[vertex_id]
        for wall in walls
        for vertex_id in (wall["from"], wall["to"])
    ]
    wx = [vertex["x"] for vertex in wall_vertices]
    wz = [vertex["z"] for vertex in wall_vertices]
    if all({"x", "z", "width", "depth"} <= room.keys() for room in rooms):
        rx = [v for r in rooms for v in (r["x"] - r["width"] / 2, r["x"] + r["width"] / 2)]
        rz = [v for r in rooms for v in (r["z"] - r["depth"] / 2, r["z"] + r["depth"] / 2)]
    else:
        room_vertices = [
            vertices[vertex_id]
            for room in rooms
            for vertex_id in room["boundary"]
        ]
        rx = [vertex["x"] for vertex in room_vertices]
        rz = [vertex["z"] for vertex in room_vertices]
    # 墙体包围盒必须覆盖房间包围盒（允许 1m 出入）
    assert min(wx) <= min(rx) + 1.0 and max(wx) >= max(rx) - 1.0
    assert min(wz) <= min(rz) + 1.0 and max(wz) >= max(rz) - 1.0
    # 户型宽不超过 20m —— 双副本会把范围撑到 37m
    assert max(wx) - min(wx) < 20.0
    assert max(wz) - min(wz) < 20.0


def test_collapse_double_wall_segments_merges_parallel_lines():
    """Two parallel wall lines 200mm apart should collapse to a single centerline."""
    from parse_cad import collapse_double_wall_segments

    segments = [
        ((0, 0), (0, 5000)),          # vertical at x=0
        ((200, 0), (200, 5000)),      # vertical at x=200
        ((1000, 5000), (6000, 5000)), # horizontal at y=5000
        ((1000, 4800), (6000, 4800)), # horizontal at y=4800
    ]
    collapsed = collapse_double_wall_segments(segments, max_double_gap=300.0)
    # After collapse there should be only two segments, one vertical and one horizontal.
    assert len(collapsed) == 2
    vertical = next((s for s in collapsed if abs(s[0][0] - s[1][0]) < 1), None)
    horizontal = next((s for s in collapsed if abs(s[0][1] - s[1][1]) < 1), None)
    assert vertical is not None
    assert (vertical[0][0] + vertical[1][0]) / 2 == 100.0
    assert horizontal is not None
    assert (horizontal[0][1] + horizontal[1][1]) / 2 == 4900.0


def test_collapse_double_wall_segments_is_idempotent_for_single_lines():
    """Single wall lines should not be moved or duplicated."""
    from parse_cad import collapse_double_wall_segments

    segments = [
        ((0, 0), (0, 5000)),
        ((5000, 1000), (5000, 6000)),
    ]
    collapsed = collapse_double_wall_segments(segments)
    assert len(collapsed) == 2
    assert ((0, 0), (0, 5000)) in collapsed
    assert ((5000, 1000), (5000, 6000)) in collapsed


def test_parse_cad_default_output_does_not_overwrite_model_geometry(tmp_path: Path, monkeypatch):
    """默认输出必须避开人工维护的 model-geometry.yaml。"""
    # 模拟存在 model-geometry.yaml
    model = tmp_path / "config" / "layout" / "model-geometry.yaml"
    model.parent.mkdir(parents=True)
    model.write_text("version: '1.0'\n", encoding="utf-8")

    assert OUTPUT_YAML.name != "model-geometry.yaml" or OUTPUT_YAML != Path("config/layout/model-geometry.yaml")
    # 默认 CLI 输出不应指向权威模型路径
    args = parse_args([])
    assert args.output.resolve() != Path("config/layout/model-geometry.yaml").resolve()

