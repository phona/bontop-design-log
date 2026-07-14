import logging
import os
import tempfile
from pathlib import Path

import pytest
import yaml

from parse_cad import (
    extract_room_labels,
    extract_room_geometry,
    latest_dxf,
    load_house_room_ids,
    parse_room_label,
    merge_with_previous_layout,
    write_layout_yaml,
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
    out = tmp_path / "cad-extracted.yaml"
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
    out = tmp_path / "cad-extracted.yaml"
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
    out = tmp_path / "cad-extracted.yaml"
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
    out = tmp_path / "cad-extracted.yaml"
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
    out = tmp_path / "cad-extracted.yaml"
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


def test_compute_origin_is_label_centroid():
    """Origin is the mean of all room-label positions so coords land near (0,0)."""
    from parse_cad import compute_origin

    labels = {
        "a": ("A", 0.0, 0.0),
        "b": ("B", 6000.0, 4000.0),
    }
    ox, oz = compute_origin(labels)
    assert ox == 3000.0
    assert oz == 2000.0


def test_extract_walls_returns_origin_subtracted_meters():
    """Wall segments are exported in meters, origin-subtracted, axis-aligned."""
    from ezdxf.document import Drawing

    from parse_cad import extract_walls

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # vertical wall at x=3000mm, y[1000,5000]; origin (1000,1000)mm -> x=2.0m z[0,4]
    msp.add_line((3000, 1000), (3000, 5000), dxfattribs={"layer": "BS-非承重墙"})
    walls = extract_walls(msp, bounds=None, origin_x=1000.0, origin_z=1000.0)
    assert len(walls) == 1
    w = walls[0]
    assert (w.x1, w.z1, w.x2, w.z2) == (2.0, 0.0, 2.0, -4.0)


def test_write_layout_yaml_includes_walls_and_origin(tmp_path: Path):
    """YAML output contains the walls list and the computed origin."""
    out = tmp_path / "cad-extracted.yaml"
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


def test_smooth_diagonals_without_corners_keeps_original_behavior():
    """When curtain_corners_dxf is None, all diagonals >= 200mm are smoothed."""
    from parse_cad import _smooth_diagonals

    segments = [
        ((0, 0), (1000, 0)),      # horizontal, skip
        ((0, 0), (0, 1000)),      # vertical, skip
        ((0, 0), (500, 500)),     # diagonal 707mm, should smooth
    ]
    result = _smooth_diagonals(segments)
    assert result[0] == ((0, 0), (1000, 0))
    assert result[1] == ((0, 0), (0, 1000))
    assert len(result) == 14  # 2 unchanged + 12 sub-segments


def test_smooth_diagonals_with_corners_filters_by_distance():
    """Only diagonals near a curtain corner are smoothed."""
    from parse_cad import _smooth_diagonals

    segments = [
        ((0, 0), (500, 500)),     # diagonal near corner at (250, 250), should smooth
        ((10000, 10000), (10500, 10500)),  # diagonal far from corner, should NOT smooth
    ]
    corners = [(250, 250)]  # DXF mm
    result = _smooth_diagonals(segments, curtain_corners_dxf=corners)
    assert len(result) == 13  # 12 sub-segments + 1 unchanged


def test_geometry_changes_in_report(tmp_path: Path):
    """Report includes geometry_changes when CAD differs from previous YAML."""
    out = tmp_path / "cad-extracted.yaml"
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


def test_mark_curtain_walls_from_config(tmp_path: Path):
    """Curtain walls are marked based on house.yaml config, not boundary detection."""
    from ezdxf.document import Drawing
    from parse_cad import extract_walls

    house_config = tmp_path / "house.yaml"
    house_config.write_text(yaml.dump({
        "curtain_walls": [
            {"edge": "west"},
            {"edge": "north"},
            {"edge": "south", "max_x": 3.5},
        ],
        "curtain_wall_corners": [],
    }, allow_unicode=True))

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    # West wall: from SW corner (-5.88, -5.39) to NW corner (-5.88, 5.39)
    msp.add_line((-5880, 5390), (-5880, -5390), dxfattribs={"layer": "BS-非承重墙"})
    # North wall: from NW corner (-5.88, 5.39) to (-4.5, 5.39)
    msp.add_line((-5880, -5390), (-4500, -5390), dxfattribs={"layer": "BS-非承重墙"})
    # South wall: from SW corner (-5.88, -5.39) to (0.5, -5.39) - x<3.5, has corner endpoint
    msp.add_line((-5880, 5390), (500, 5390), dxfattribs={"layer": "BS-非承重墙"})
    # South wall: from (4, -5.39) to (5, -5.39) - x>3.5, NOT curtain (no corner endpoint either)
    msp.add_line((4000, 5390), (5000, 5390), dxfattribs={"layer": "BS-非承重墙"})
    # East wall: NOT curtain
    msp.add_line((8540, 4450), (8540, 4210), dxfattribs={"layer": "BS-非承重墙"})
    # Interior wall: NOT curtain
    msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": "BS-非承重墙"})

    walls = extract_walls(msp, bounds=None, origin_x=0.0, origin_z=0.0, house_config_path=house_config)
    curtain_walls = [w for w in walls if w.curtain]
    non_curtain = [w for w in walls if not w.curtain]
    assert len(curtain_walls) == 3  # west, north, south(x<3.5)
    assert len(non_curtain) == 3   # east, interior, south(x>3.5)


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


def test_extract_walls_loads_curtain_corners_from_config(tmp_path: Path):
    """extract_walls loads curtain_wall_corners from house.yaml and filters smoothing."""
    from ezdxf.document import Drawing
    from parse_cad import extract_walls

    house_config = tmp_path / "house.yaml"
    house_config.write_text(yaml.dump({
        "curtain_wall_corners": [
            {"x": 0.25, "z": 0.25},
        ]
    }, allow_unicode=True))

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("BS-非承重墙")
    msp.add_line((0, 0), (500, 500), dxfattribs={"layer": "BS-非承重墙"})
    msp.add_line((10000, 10000), (10500, 10500), dxfattribs={"layer": "BS-非承重墙"})

    walls = extract_walls(
        msp, bounds=None, origin_x=0.0, origin_z=0.0,
        house_config_path=house_config,
    )
    assert len(walls) == 13

