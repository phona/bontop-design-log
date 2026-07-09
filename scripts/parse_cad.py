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


def collect_wall_segments(modelspace) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Collect all wall segments from wall layers."""
    segments = []
    wall_layers = {"BS-非承重墙", "BS-承重墙"}
    for entity in modelspace:
        if entity.dxf.layer not in wall_layers:
            continue
        if entity.dxftype() == "LINE":
            start = (float(entity.dxf.start.x), float(entity.dxf.start.y))
            end = (float(entity.dxf.end.x), float(entity.dxf.end.y))
            segments.append((start, end))
        elif entity.dxftype() == "LWPOLYLINE":
            points = list(entity.vertices_in_wcs())
            for i in range(len(points) - 1):
                p1 = (float(points[i][0]), float(points[i][1]))
                p2 = (float(points[i + 1][0]), float(points[i + 1][1]))
                segments.append((p1, p2))
    return segments


def bounding_box_from_point(px: float, py: float, segments, tolerance: float = 100.0) -> tuple[float, float, float, float] | None:
    """Find the closed rectangular wall loop around (px, py) and return (min_x, min_y, max_x, max_y)."""
    # Collect all unique endpoints
    endpoints: set[tuple[float, float]] = set()
    for s in segments:
        endpoints.add(s[0])
        endpoints.add(s[1])

    # Find the nearest four endpoints forming a rectangle around the point
    candidates = [p for p in endpoints if abs(p[0] - px) < 10000 and abs(p[1] - py) < 10000]
    if len(candidates) < 4:
        return None

    xs = [p[0] for p in candidates]
    ys = [p[1] for p in candidates]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    # Heuristic: the point should lie inside the rectangle
    if not (min_x <= px <= max_x and min_y <= py <= max_y):
        return None

    return min_x, min_y, max_x, max_y


def extract_room_geometry(
    labels: dict[str, tuple[str, float, float]],
    modelspace,
    origin_x: float = 0.0,
    origin_z: float = 0.0,
    default_height: float = 3.0,
) -> list[Room]:
    """Compute rooms as rectangular bounding boxes around each label."""
    segments = collect_wall_segments(modelspace)
    rooms: list[Room] = []
    for project_id, (name, x_mm, y_mm) in labels.items():
        bbox = bounding_box_from_point(x_mm, y_mm, segments)
        if not bbox:
            continue
        min_x, min_y, max_x, max_y = bbox
        width_m = (max_x - min_x) / 1000.0
        depth_m = (max_y - min_y) / 1000.0
        x_m = (min_x + max_x) / 2000.0 - origin_x / 1000.0
        z_m = (min_y + max_y) / 2000.0 - origin_z / 1000.0
        rooms.append(
            Room(
                id=project_id,
                name=name,
                x=round(x_m, 3),
                z=round(z_m, 3),
                width=round(width_m, 3),
                depth=round(depth_m, 3),
                height=default_height,
                area=round(width_m * depth_m, 2),
                perimeter=round(2 * (width_m + depth_m), 2),
            )
        )
    return rooms


def extract_rooms(dxf_path: Path, default_height: float = 3.0) -> tuple[list[Room], list[Platform]]:
    """Extract rooms and platforms from the DXF."""
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    labels = extract_room_labels(msp)
    rooms = extract_room_geometry(labels, msp, default_height=default_height)
    return rooms, []


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
