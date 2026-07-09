import os
import tempfile
from pathlib import Path

import pytest

from parse_cad import latest_dxf, parse_room_label


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
