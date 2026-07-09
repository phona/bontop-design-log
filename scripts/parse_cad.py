#!/usr/bin/env python3
"""Extract room layout from the latest CAD floor plan DXF."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import ezdxf
import yaml

CAD_DIR = Path("cad/design/01_floor_plan")
OUTPUT_YAML = Path("config/layout/cad-extracted.yaml")
REPORT_JSON = Path("scripts/logs/cad-extraction-report.json")


@dataclass
class Room:
    id: str
    name: str
    x: float
    z: float
    width: float
    depth: float
    height: float
    area: float | None
    perimeter: float | None


@dataclass
class Platform:
    id: str
    name: str
    x: float
    z: float
    width: float
    depth: float
    height: float
    area: float | None


def latest_dxf(cad_dir: Path) -> Path:
    """Return the most recently modified floor_plan DXF in cad_dir."""
    files = sorted(cad_dir.glob("floor_plan_design_*.dxf"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise FileNotFoundError(f"No floor_plan_design_*.dxf found in {cad_dir}")
    return files[-1]


def parse_room_label(text: str) -> tuple[str, str] | None:
    """Extract (project_id, chinese_name) from a label like '主卧[master_bedroom]'."""
    match = re.search(r"([^\[\n]+?)\[([a-z_][a-z0-9_]*)\]", text)
    if not match:
        return None
    return match.group(2).strip(), match.group(1).strip()


def extract_room_labels(modelspace) -> dict[str, tuple[str, float, float]]:
    """Find room labels on SH-文字标注 and return id -> (name, x_mm, z_mm)."""
    labels: dict[str, tuple[str, float, float]] = {}
    for entity in modelspace:
        if entity.dxf.layer != "SH-文字标注":
            continue
        text = ""
        if entity.dxftype() == "TEXT":
            text = entity.dxf.text
        elif entity.dxftype() == "MTEXT":
            text = entity.text
        else:
            continue
        parsed = parse_room_label(text)
        if not parsed:
            continue
        project_id, name = parsed
        point = entity.dxf.insert
        labels[project_id] = (name, float(point.x), float(point.y))
    return labels


def extract_rooms(dxf_path: Path, default_height: float = 3.0) -> tuple[list[Room], list[Platform]]:
    """Placeholder: extract rooms and platforms from the DXF."""
    return [], []


def write_layout_yaml(
    dxf_path: Path,
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
) -> dict[str, Any]:
    """Placeholder: write the layout YAML."""
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract house layout from CAD DXF")
    parser.add_argument("--cad-dir", type=Path, default=CAD_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_YAML)
    parser.add_argument("--report", type=Path, default=REPORT_JSON)
    parser.add_argument("--height", type=float, default=3.0, help="Default room height in meters")
    args = parser.parse_args()

    dxf_path = latest_dxf(args.cad_dir)
    print(f"CAD extraction report")
    print(dxf_path)
    rooms, platforms = extract_rooms(dxf_path, default_height=args.height)
    platform = platforms[0] if platforms else None
    report = write_layout_yaml(dxf_path, rooms, platform, args.output)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
