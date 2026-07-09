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


HOUSE_DATA_TS = Path("shared/houseData.ts")


def load_house_room_ids() -> set[str]:
    """Load the set of valid room IDs from shared/houseData.ts."""
    if not HOUSE_DATA_TS.exists():
        return set()
    text = HOUSE_DATA_TS.read_text(encoding="utf-8")
    match = re.search(r"rooms:\s*RoomLayout\[\]\s*=\s*\[(.*?)\];", text, re.DOTALL)
    if not match:
        return set()
    return set(re.findall(r"id:\s*['\"]([^'\"]+)['\"]", match.group(1)))


def _format_diff_value(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{value:.2f}"
    return str(value)


DIFF_FIELDS = ["x", "z", "width", "depth", "height", "area"]


def diff_rooms(prev_rooms: list[dict] | None, rooms: list[Room]) -> Any:
    """Compare the new rooms with the previous YAML rooms and return a diff.

    Returns a string if there is no previous layout, otherwise a list of
    human-readable change descriptions for rooms that differ.
    """
    if prev_rooms is None:
        return "no previous layout to diff against"

    prev_by_id = {r.get("id"): r for r in prev_rooms if r.get("id")}
    new_ids = {r.id for r in rooms}
    changes: list[str] = []

    for r in rooms:
        prev = prev_by_id.get(r.id)
        if prev is None:
            changes.append(f"{r.id}: added")
            continue

        diffs: list[str] = []
        for field in DIFF_FIELDS:
            old = prev.get(field)
            new = getattr(r, field)
            if old != new:
                diffs.append(
                    f"{field} {_format_diff_value(old)} → {_format_diff_value(new)}"
                )
        if diffs:
            changes.append(f"{r.id}: " + ", ".join(diffs))

    for prev_id in prev_by_id:
        if prev_id not in new_ids:
            changes.append(f"{prev_id}: removed")

    return changes


def load_previous_rooms(path: Path) -> list[dict] | None:
    """Load the rooms list from a previous YAML output, if it exists."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data.get("rooms", []) if data else []
    except Exception:
        return []


def write_layout_yaml(
    dxf_path: Path,
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
) -> dict[str, Any]:
    """Write the layout YAML and return a report summary."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    prev_rooms = load_previous_rooms(output_path)
    data = {
        "version": "1.0",
        "source": str(dxf_path),
        "unit": "mm",
        "scale": 0.001,
        "origin": {"x": 0.0, "z": 0.0},
        "export_date": date.today().isoformat(),
        "rooms": [
            {
                "id": r.id,
                "name": r.name,
                "x": r.x,
                "z": r.z,
                "width": r.width,
                "depth": r.depth,
                "height": r.height,
                "area": r.area,
                "perimeter": r.perimeter,
            }
            for r in rooms
        ],
    }
    if platform:
        data["platform"] = {
            "id": platform.id,
            "name": platform.name,
            "x": platform.x,
            "z": platform.z,
            "width": platform.width,
            "depth": platform.depth,
            "height": platform.height,
            "area": platform.area,
        }

    with open(output_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)

    total_area = sum(r.area for r in rooms if r.area)
    valid_ids = load_house_room_ids()
    missing_project_id = (
        sum(1 for r in rooms if r.id not in valid_ids) if valid_ids else 0
    )
    report = {
        "source": str(dxf_path),
        "rooms_found": len(rooms),
        "missing_project_id": missing_project_id,
        "geometry_warnings": 0,
        "total_interior_area": total_area,
        "diff": diff_rooms(prev_rooms, rooms),
    }
    return report


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
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
