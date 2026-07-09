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
    assert parse_room_label("主卧[master_bedroom]") == ("master_bedroom", "主卧")


def test_parse_room_label_multiline():
    text = "主卧[master_bedroom]\n面积18.16m²\n周长18.39m"
    assert parse_room_label(text) == ("master_bedroom", "主卧")


def test_parse_room_label_missing_id():
    assert parse_room_label("主卧") is None


def test_extract_room_labels_from_dxf():
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_text("主卧[master_bedroom]", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_text("次卧[bedroom_nw]", dxfattribs={"layer": "SH-文字标注", "insert": (-500, 1000, 0)})
    msp.add_text("衣帽间", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})
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
    msp.add_text("主卧[master_bedroom]", dxfattribs={"layer": "SH-文字标注", "insert": (4500, 2000, 0)})
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
    assert report["diff"] == [
        "master_bedroom: x -5.30 → -5.35, width 4.45 → 4.50, area 18.02 → 18.16"
    ]


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


def test_chinese_name_mapping():
    from parse_cad import chinese_name_to_id
    assert chinese_name_to_id("主卧", 18.16, 0, 0) == "master_bedroom"
    assert chinese_name_to_id("客餐厅", 35.2, 0, 0) == "living_dining"
    assert chinese_name_to_id("厨房", 6.09, 0, 0) == "kitchen"
    assert chinese_name_to_id("阳台", 2.42, 0, 0) == "balcony"
    assert chinese_name_to_id("卫生间", 4.53, 0, 0) == "master_bath"
    assert chinese_name_to_id("卫生间", 2.66, 0, 0) == "guest_bath"
    assert chinese_name_to_id("次卧", 8.35, 0, 0) == "study"
    assert chinese_name_to_id("次卧", 8.39, -1, 1, (0, 0)) == "bedroom_nw"
    assert chinese_name_to_id("次卧", 8.39, 1, -1, (0, 0)) == "bedroom_se"
    assert chinese_name_to_id("走廊", 10.0, 0, 0) is None


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

