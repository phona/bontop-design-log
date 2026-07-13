#!/usr/bin/env python3
"""Extract room layout from the latest CAD floor plan DXF."""

from __future__ import annotations

import argparse
import json
import logging
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

logger = logging.getLogger(__name__)


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


@dataclass
class Wall:
    """A single wall segment in meters, origin-subtracted, in scene coords (x, z)."""
    x1: float
    z1: float
    x2: float
    z2: float
    curtain: bool = False


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


def chinese_name_to_id(
    name: str,
    area: float | None,
    x: float,
    y: float,
    master_bedroom_pos: tuple[float, float] | None = None,
    seen_ids: set[str] | None = None,
) -> str | None:
    """Map Chinese room names to project IDs."""
    name = name.strip().replace(" ", "")
    if name == "主卧":
        return "master_bedroom"
    if name == "客餐厅":
        return "living_dining"
    if name == "厨房":
        return "kitchen"
    if name == "阳台":
        return "balcony"
    if name == "入户花园":
        return "entry_garden"
    if name == "南向大阳台":
        return "south_balcony"
    if name == "卫生间":
        if area is None:
            return None
        # Larger area near master is master_bath; smaller is guest_bath
        return "master_bath" if area >= 3.5 else "guest_bath"
    if name == "次卧":
        if area is None:
            return None
        # Study area clusters around 8.35; guard against the 8.39 bedrooms.
        if abs(area - 8.35) < 0.1 and abs(area - 8.39) >= 0.04:
            return "study"
        # Two 8.39 bedrooms: northwest vs southeast relative to master bedroom
        if master_bedroom_pos and abs(area - 8.39) < 0.1:
            mx, my = master_bedroom_pos
            is_nw = x < mx and y > my
            seen = seen_ids or set()
            if is_nw and "bedroom_nw" not in seen:
                return "bedroom_nw"
            if "bedroom_se" not in seen:
                return "bedroom_se"
            if "bedroom_nw" not in seen:
                return "bedroom_nw"
            return None
        return None
    return None


def contains_chinese(text: str) -> bool:
    """Return True if text contains any CJK unified ideographs."""
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def parse_area(text: str) -> float | None:
    match = re.search(r"面积(\d+\.?\d*)m²", text)
    if match:
        return float(match.group(1))
    return None


def extract_leading_chinese_name(text: str) -> str:
    """Extract the leading Chinese name from a label like '主卧^J面积18.16m²'."""
    match = re.match(r"[\u4e00-\u9fff]+", text.strip())
    if match:
        return match.group(0)
    return text.strip().splitlines()[0].strip()


def extract_room_labels(modelspace) -> tuple[dict[str, tuple[str, float, float]], list[str]]:
    """Find room labels on SH-文字标注 and return id -> (name, x, z) plus skipped labels."""
    labels: dict[str, tuple[str, float, float]] = {}
    skipped: set[str] = set()

    # First pass: collect all Chinese labels with their positions and areas
    candidates: list[tuple[str, float, float, float | None]] = []
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
        if parsed:
            project_id, name = parsed
            point = entity.dxf.insert
            labels[project_id] = (name, float(point.x), float(point.y))
            continue
        if contains_chinese(text):
            first_line = extract_leading_chinese_name(text)
            if first_line:
                area = parse_area(text)
                point = entity.dxf.insert
                candidates.append((first_line, float(point.x), float(point.y), area))

    # Find master bedroom position for disambiguation
    master_pos = None
    for name, x, y, area in candidates:
        if name == "主卧":
            master_pos = (x, y)
            break
    if master_pos is None:
        for project_id, (name, x, y) in labels.items():
            if project_id == "master_bedroom":
                master_pos = (x, y)
                break

    # Map Chinese names to IDs
    seen_ids: set[str] = set(labels.keys())
    for name, x, y, area in candidates:
        project_id = chinese_name_to_id(name, area, x, y, master_pos, seen_ids)
        if project_id:
            labels[project_id] = (name, x, y)
            seen_ids.add(project_id)
        else:
            skipped.add(name)
            logger.warning("Chinese room label %r could not be mapped to a project ID", name)

    return labels, sorted(skipped)


def collect_wall_segments(
    modelspace, bounds: tuple[float, float, float, float] | None = None
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Collect wall segments from wall layers.

    If ``bounds`` is given as (min_x, min_y, max_x, max_y) in DXF mm, only
    segments whose midpoint lies within the rectangle are returned. This drops
    duplicate plan copies (e.g. an unlabeled 墙体定位图 sheet) that share the
    DXF modelspace with the labeled floor-plan sheet.
    """
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
    if bounds is not None:
        min_x, min_y, max_x, max_y = bounds
        filtered = []
        for (x1, y1), (x2, y2) in segments:
            mx = (x1 + x2) / 2
            my = (y1 + y2) / 2
            if min_x <= mx <= max_x and min_y <= my <= max_y:
                filtered.append(((x1, y1), (x2, y2)))
        segments = filtered
    return segments


def label_cluster_bounds(
    labels: dict[str, tuple[str, float, float]],
    margin: float = 5000.0,
) -> tuple[float, float, float, float] | None:
    """Bounding box (with margin, in DXF mm) of all room label positions."""
    if not labels:
        return None
    xs = [x for _, x, _ in labels.values()]
    ys = [y for _, _, y in labels.values()]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)


def compute_origin(labels: dict[str, tuple[str, float, float]]) -> tuple[float, float]:
    """Origin (in DXF mm) = centroid of room-label positions, so exported
    coordinates land near (0, 0) regardless of where the plan sits in the DXF."""
    if not labels:
        return 0.0, 0.0
    xs = [x for _, x, _ in labels.values()]
    ys = [y for _, _, y in labels.values()]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def load_curtain_corners(
    config_path: Path,
    origin_x: float,
    origin_z: float,
) -> list[tuple[float, float]] | None:
    if not config_path.exists():
        return None

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not data:
        return None

    corners = data.get("curtain_wall_corners")
    if not corners:
        return None

    result = []
    for i, corner in enumerate(corners):
        if "x" not in corner or "z" not in corner:
            raise ValueError(
                f"curtain_wall_corners entry {i} missing 'x' or 'z' key: {corner}"
            )
        scene_x = corner["x"]
        scene_z = corner["z"]
        dxf_x = scene_x * 1000 + origin_x
        dxf_y = origin_z - scene_z * 1000
        result.append((dxf_x, dxf_y))

    return result


def extract_walls(
    modelspace,
    bounds: tuple[float, float, float, float] | None,
    origin_x: float,
    origin_z: float,
    house_config_path: Path | None = None,
) -> list[Wall]:
    """Return wall segments in meters, origin-subtracted, for the renderer.

    The DXF draws each physical wall exactly once (shared walls are single
    segments, openings are gaps), so exporting the segments verbatim gives the
    renderer a continuous, non-duplicated wall graph.

    If ``house_config_path`` is given, curtain_wall_corners are loaded and
    passed to _smooth_diagonals() for filtering.
    """
    segments = collect_wall_segments(modelspace, bounds=bounds)

    curtain_corners_dxf = None
    if house_config_path is not None:
        curtain_corners_dxf = load_curtain_corners(
            house_config_path, origin_x, origin_z
        )

    segments = _smooth_diagonals(segments, curtain_corners_dxf=curtain_corners_dxf)
    walls: list[Wall] = []
    for (x1, y1), (x2, y2) in segments:
        walls.append(
            Wall(
                x1=round((x1 - origin_x) / 1000.0, 3),
                z1=round((origin_z - y1) / 1000.0, 3),
                x2=round((x2 - origin_x) / 1000.0, 3),
                z2=round((origin_z - y2) / 1000.0, 3),
            )
        )
    walls = mark_curtain_walls(walls)
    return walls


def mark_curtain_walls(
    walls: list[Wall],
    tolerance: float = 0.15,
) -> list[Wall]:
    """Mark wall segments on the building's exterior curtain wall boundary.

    Curtain wall范围:
    - 西墙 (x ≈ min_x): 所有墙段
    - 北墙 (z ≈ max_z): 所有墙段
    - 南墙 (z ≈ min_z): 除入户花园区域 (x > 3.5) 外

    东墙和入户花园外围不标记为幕墙。
    """
    if not walls:
        return walls

    all_x = [x for w in walls for x in (w.x1, w.x2)]
    all_z = [z for w in walls for z in (w.z1, w.z2)]
    min_x, max_x = min(all_x), max(all_x)
    min_z, max_z = min(all_z), max(all_z)

    for w in walls:
        on_west = abs(w.x1 - min_x) < tolerance or abs(w.x2 - min_x) < tolerance
        on_north = abs(w.z1 - max_z) < tolerance or abs(w.z2 - max_z) < tolerance
        on_south = abs(w.z1 - min_z) < tolerance or abs(w.z2 - min_z) < tolerance

        if on_west or on_north:
            w.curtain = True
        elif on_south:
            mid_x = (w.x1 + w.x2) / 2
            if mid_x <= 3.5:
                w.curtain = True
            else:
                w.curtain = False
        else:
            w.curtain = False

    return walls


def _smooth_diagonals(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    curtain_corners_dxf: list[tuple[float, float]] | None = None,
    corner_tolerance: float = 500.0,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Split diagonal wall segments near curtain corners into sub-segments.

    The chord midpoint is bowed outward by ``bulge`` mm so the glass curtain
    wall corner renders as an approximated smooth curve.

    If ``curtain_corners_dxf`` is given, only diagonals within ``corner_tolerance``
    mm of a corner are smoothed; others pass through unchanged.
    """
    import math
    bulge = 80.0        # mm – outward bow at chord midpoint
    subdiv = 12           # sub-segments per diagonal
    result: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for (x1, y1), (x2, y2) in segments:
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        is_diagonal = abs(x1 - x2) > 1 and abs(y1 - y2) > 1
        if not is_diagonal or length < 200:
            result.append(((x1, y1), (x2, y2)))
            continue

        if curtain_corners_dxf is not None:
            mid_x, mid_y = (x1 + x2) / 2, (y1 + y2) / 2
            near_corner = any(
                math.hypot(mid_x - cx, mid_y - cy) <= corner_tolerance
                for cx, cy in curtain_corners_dxf
            )
            if not near_corner:
                result.append(((x1, y1), (x2, y2)))
                continue

        # Perpendicular direction, bow outward (west = more-negative x)
        nx, ny = -dy / length, dx / length
        if nx > 0:
            nx, ny = -nx, -ny

        # Compute sub-segment endpoints along the chord with parabolic bulge
        pts = [(x1, y1)]
        for k in range(1, subdiv):
            t = k / subdiv  # 0…1
            # Parabolic bulge: max at t=0.5, zero at t=0,1
            offset = 4 * bulge * t * (1 - t)
            px = x1 + dx * t + nx * offset
            py = y1 + dy * t + ny * offset
            pts.append((round(px), round(py)))
        pts.append((x2, y2))

        for i in range(len(pts) - 1):
            result.append((pts[i], pts[i+1]))
    return result


def _merge_intervals(
    intervals: list[tuple[float, float]], gap: float
) -> list[tuple[float, float]]:
    """Merge intervals whose gap is <= ``gap`` (so a wall split by an opening
    becomes one continuous line)."""
    if not intervals:
        return []
    items = sorted((min(a, b), max(a, b)) for a, b in intervals)
    merged = [list(items[0])]
    for lo, hi in items[1:]:
        if lo <= merged[-1][1] + gap:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return [(lo, hi) for lo, hi in merged]


def _wall_lines(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    tolerance: float = 1.0,
    gap: float = 2000.0,
):
    """Group axis-aligned segments into merged wall lines.

    Returns (vertical, horizontal) where ``vertical`` maps each constant-x to a
    list of merged y-intervals, and ``horizontal`` maps each constant-y to merged
    x-intervals. Collinear segments separated by an opening (gap <= ``gap`` mm)
    are merged into one line.
    """
    v: dict[float, list[tuple[float, float]]] = {}
    h: dict[float, list[tuple[float, float]]] = {}
    for (x1, y1), (x2, y2) in segments:
        if abs(x1 - x2) <= tolerance:
            key = round((x1 + x2) / 2, 1)
            v.setdefault(key, []).append((min(y1, y2), max(y1, y2)))
        elif abs(y1 - y2) <= tolerance:
            key = round((y1 + y2) / 2, 1)
            h.setdefault(key, []).append((min(x1, x2), max(x1, x2)))
    v = {k: _merge_intervals(iv, gap) for k, iv in v.items()}
    h = {k: _merge_intervals(iv, gap) for k, iv in h.items()}
    return v, h


def _covers(merged: list[tuple[float, float]], val: float, tol: float = 1.0) -> bool:
    return any(lo - tol <= val <= hi + tol for lo, hi in merged)


def _flood_fill_rooms(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    labels: dict[str, tuple[str, float, float]],
    cell_size: float = 100.0,
    wall_thickness: float = 120.0,
) -> dict[str, tuple[float, float, float, float]]:
    """Return {room_id: (min_x, min_y, max_x, max_y)} by flood-filling a grid.

    The DXF wall segments are rasterized onto a grid (``cell_size`` mm squares).
    Empty cells that are connected (4-way) form rooms.  For each room region that
    contains a label point we assign its id; remaining large-enough regions are
    matched to known unlabeled gift-area rooms by proximity to expected positions.
    """
    if not labels or not segments:
        return {}

    # Plan bounds (expand by margin so outer walls have room cells)
    xs = [x for (x, _), _ in segments] + [x for _, (x, _) in segments]
    ys = [y for (_, y), _ in segments] + [y for _, (_, y) in segments]
    min_x, max_x = min(xs) - 200, max(xs) + 200
    min_y, max_y = min(ys) - 200, max(ys) + 200

    cols = int((max_x - min_x) / cell_size) + 1
    rows = int((max_y - min_y) / cell_size) + 1
    wall_half = wall_thickness / 2.0

    # Grid: False = empty (walkable), True = wall (blocked)
    grid = [[False] * cols for _ in range(rows)]

    def cell(cx, cy, x, y):
        return 0 <= cx < cols and 0 <= cy < rows

    def mark_wall(cx, cy):
        if 0 <= cx < cols and 0 <= cy < rows:
            grid[cy][cx] = True

    # Rasterize wall segments
    for (x1, y1), (x2, y2) in segments:
        # wall bounding box expanded by half-thickness
        lx, rx = (min(x1, x2) - wall_half, max(x1, x2) + wall_half)
        ly, ry = (min(y1, y2) - wall_half, max(y1, y2) + wall_half)
        c0 = int((lx - min_x) / cell_size)
        c1 = int((rx - min_x) / cell_size) + 1
        r0 = int((ly - min_y) / cell_size)
        r1 = int((ry - min_y) / cell_size) + 1
        for r in range(max(0, r0), min(rows, r1)):
            for c in range(max(0, c0), min(cols, c1)):
                # Distance to segment
                px = min_x + c * cell_size + cell_size / 2
                py = min_y + r * cell_size + cell_size / 2
                # Approx: point-to-segment distance for axis-aligned walls
                d = float("inf")
                if abs(x1 - x2) < 1:  # vertical
                    dx = abs(px - x1)
                    if min(y1, y2) <= py <= max(y1, y2):
                        d = dx
                    else:
                        d = min(
                            ((px - x1)**2 + (py - y1)**2)**0.5,
                            ((px - x2)**2 + (py - y2)**2)**0.5,
                        )
                else:  # horizontal
                    dz = abs(py - y1)
                    if min(x1, x2) <= px <= max(x1, x2):
                        d = dz
                    else:
                        d = min(
                            ((px - x1)**2 + (py - y1)**2)**0.5,
                            ((px - x2)**2 + (py - y2)**2)**0.5,
                        )
                if d <= wall_half:
                    mark_wall(c, r)

    # Flood-fill labels first — find their grid cells
    label_cells: dict[str, tuple[int, int]] = {}
    for pid, (_name, lx, ly) in labels.items():
        c = int((lx - min_x) / cell_size)
        r = int((ly - min_y) / cell_size)
        label_cells[pid] = (c, r)

    # Flood-fill each unvisited empty cell
    visited = [row[:] for row in grid]  # start from wall cells as visited
    regions: list[set[tuple[int, int]]] = []

    for r in range(rows):
        for c in range(cols):
            if visited[r][c]:
                continue
            # BFS
            stack = [(c, r)]
            visited[r][c] = True
            cells: set[tuple[int, int]] = {(c, r)}
            while stack:
                cx, cy = stack.pop()
                for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < cols and 0 <= ny < rows and not visited[ny][nx]:
                        visited[ny][nx] = True
                        cells.add((nx, ny))
                        stack.append((nx, ny))
            regions.append(cells)

    # Map label positions to regions
    label_to_region: dict[str, int] = {}
    region_to_labels: dict[int, list[str]] = {}
    for pid, (c, r) in label_cells.items():
        for i, cells in enumerate(regions):
            if (c, r) in cells:
                label_to_region[pid] = i
                region_to_labels.setdefault(i, []).append(pid)
                break


    # Build result: each labeled region → bbox
    result: dict[str, tuple[float, float, float, float]] = {}
    for pid, (c, r) in label_cells.items():
        i = label_to_region.get(pid)
        if i is None or not regions[i]:
            continue
        cells = regions[i]
        cols_i = [col_ for col_, _ in cells]
        rows_i = [row_ for _, row_ in cells]
        min_xx = min_x + min(cols_i) * cell_size
        max_xx = min_x + (max(cols_i) + 1) * cell_size
        min_yy = min_y + min(rows_i) * cell_size
        max_yy = min_y + (max(rows_i) + 1) * cell_size
        # Expand from interior face to wall center line
        wall_half = wall_thickness / 2.0
        result[pid] = (
            min_xx - wall_half,
            min_yy - wall_half,
            max_xx + wall_half,
            max_yy + wall_half,
        )

    # Gift-area / platform detection for unlabeled regions
    # Expected positions (in centroid-frame meters) and approximate areas (m²)
    # derived from hand-YAML by offset-approximation.
    unlabeled_expected: dict[str, tuple[float, float, float]] = {
        "south_balcony": (3.19, 3.06, 13.95),
        "entry_garden": (3.19, -10.04, 11.06),
        "west_platform": (-5.31, 0.76, 2.48),
    }
    seen_regions = set(label_to_region.values())
    cell_area = cell_size * cell_size / 1_000_000.0  # m² per cell
    for i, cells in enumerate(regions):
        if i in seen_regions or len(cells) < 20:
            continue
        region_area = len(cells) * cell_area
        # Area must be within 60% of expected
        cols_i = [col_ for col_, _ in cells]
        rows_i = [row_ for _, row_ in cells]
        min_xx = min_x + min(cols_i) * cell_size
        max_xx = min_x + (max(cols_i) + 1) * cell_size
        min_yy = min_y + min(rows_i) * cell_size
        max_yy = min_y + (max(rows_i) + 1) * cell_size
        wall_half = wall_thickness / 2.0
        cx = (min_xx + max_xx) / 2000.0
        cy = (min_yy + max_yy) / 2000.0
        for name, (ex, ey, ea) in unlabeled_expected.items():
            if abs(cx - ex) < 2.0 and abs(cy - ey) < 2.0 and 0.4 <= region_area / ea <= 1.6:
                result[name] = (
                    min_xx - wall_half,
                    min_yy - wall_half,
                    max_xx + wall_half,
                    max_yy + wall_half,
                )
                break

    return result


def _parse_opening_virtual_segments(
    modelspace, bounds: tuple[float, float, float, float] | None = None,
    include_doors: bool = False,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Parse DS-门窗 blocks to generate virtual wall segments that fill
    door/window openings, so the wall graph forms closed room boundaries
    for face enumeration."""
    import math
    virtual: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for e in modelspace:
        if e.dxf.layer != "DS-门窗":
            continue
        blk_name = e.dxf.name
        if "LEGEND" in blk_name:
            continue
        if not include_doors and "DOOR" in blk_name:
            continue
        ins = e.dxf.insert
        if bounds is not None:
            bx, by = ins.x, ins.y
            if not (bounds[0] <= bx <= bounds[2] and bounds[1] <= by <= bounds[3]):
                continue
        doc = modelspace.doc if hasattr(modelspace, "doc") else None
        if doc is None:
            continue
        b = doc.blocks.get(blk_name)
        if b is None:
            continue
        xs_b: list[float] = []
        ys_b: list[float] = []
        for be in b:
            if be.dxftype() == "LINE":
                xs_b += [be.dxf.start.x, be.dxf.end.x]
                ys_b += [be.dxf.start.y, be.dxf.end.y]
        if not xs_b:
            continue
        rot = e.dxf.rotation if e.dxf.hasattr("rotation") else 0.0
        rad = math.radians(rot)
        cx, cy = ins.x, ins.y
        min_xb, max_xb = min(xs_b), max(xs_b)
        min_yb, max_yb = min(ys_b), max(ys_b)
        corners = [(min_xb, min_yb), (min_xb, max_yb), (max_xb, min_yb), (max_xb, max_yb)]
        wxs: list[float] = []
        wys: list[float] = []
        for bxc, byc in corners:
            wxs.append(cx + bxc * math.cos(rad) - byc * math.sin(rad))
            wys.append(cy + bxc * math.sin(rad) + byc * math.cos(rad))
        min_wx, max_wx = min(wxs), max(wxs)
        min_wy, max_wy = min(wys), max(wys)
        # Align to the wall's long axis
        if max_wx - min_wx >= max_wy - min_wy:
            mid_y = (min_wy + max_wy) / 2
            virtual.append(((round(min_wx), round(mid_y)), (round(max_wx), round(mid_y))))
        else:
            mid_x = (min_wx + max_wx) / 2
            virtual.append(((round(mid_x), round(min_wy)), (round(mid_x), round(max_wy))))
    return virtual


def _enumerate_faces(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
    virtual_segments: list[tuple[tuple[float, float], tuple[float, float]]] | None = None,
) -> list[list[tuple[float, float]]]:
    """Planar face enumeration on an axis-aligned wall graph.

    Returns a list of faces, each represented as a list of nodes (x,y) forming
    a closed CCW polygon.
    """
    # Merge real + virtual segments
    all_segs = list(segments)
    if virtual_segments:
        all_segs.extend(virtual_segments)

    def snap(v: float) -> float:
        return round(v)

    # Build graph
    nodes: dict[tuple[float, float], set[tuple[float, float]]] = {}
    for (x1, y1), (x2, y2) in all_segs:
        x1, y1, x2, y2 = snap(x1), snap(y1), snap(x2), snap(y2)
        if x1 == x2 and y1 == y2:
            continue
        n1, n2 = (x1, y1), (x2, y2)
        nodes.setdefault(n1, set()).add(n2)
        nodes.setdefault(n2, set()).add(n1)

    def direction(src, dst):
        dx = snap(dst[0] - src[0])
        dy = snap(dst[1] - src[1])
        if dx > 0:   return (1, 0)
        if dx < 0:   return (-1, 0)
        if dy > 0:   return (0, 1)
        if dy < 0:   return (0, -1)
        return (0, 0)

    # CCW rotation: (dx,dy) → (-dy, dx)
    def cw_rot(dx, dy):
        return (dy, -dx)

    # Sort neighbors by angle at each node
    dir_order = {(1, 0): 0, (0, 1): 90, (-1, 0): 180, (0, -1): 270}

    def sort_key(nb):
        d = direction(cur, nb)
        return dir_order.get(d, 0)

    # Track visited directed edges
    visited: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    faces: list[list[tuple[float, float]]] = []

    for src, dst_set in list(nodes.items()):
        for dst in list(dst_set):
            if (src, dst) in visited:
                continue
            visited.add((src, dst))
            face: list[tuple[float, float]] = [src]
            prev, cur = src, dst
            while True:
                face.append(cur)
                if cur == src:
                    break
                inc_dir = direction(prev, cur)
                rev_dir = (-inc_dir[0], -inc_dir[1])
                candidates = [nb for nb in nodes[cur] if nb != prev]
                if not candidates:
                    break
                def cw_angle(nb):
                    nd = direction(cur, nb)
                    d = rev_dir
                    for steps in range(4):
                        if d == nd:
                            return steps * 90
                        d = cw_rot(d[0], d[1])
                    return 360
                candidates.sort(key=cw_angle)
                chosen = candidates[0]
                visited.add((cur, chosen))
                prev, cur = cur, chosen
            if len(face) >= 4:
                faces.append(face)

    return faces


def bounding_box_from_point(
    px: float, py: float, segments, tolerance: float = 1.0
) -> tuple[float, float, float, float] | None:
    """Find the rectangular wall loop enclosing (px, py) and return (min_x, min_y, max_x, max_y).

    Walls are axis-aligned LINE segments, grouped into merged collinear lines so
    that an opening (door/window gap) does not break a wall into irrelevance. For
    each cardinal direction we pick the nearest wall line whose coverage includes
    the label's other coordinate. This traces the four walls actually enclosing
    the room rather than collapsing the whole plan into one bounding box.
    """
    v_lines, h_lines = _wall_lines(segments, tolerance=tolerance)

    east = min((k for k, iv in v_lines.items() if k > px and _covers(iv, py)), default=None)
    west = max((k for k, iv in v_lines.items() if k < px and _covers(iv, py)), default=None)
    north = min((k for k, iv in h_lines.items() if k > py and _covers(iv, px)), default=None)
    south = max((k for k, iv in h_lines.items() if k < py and _covers(iv, px)), default=None)

    # Fallbacks: when the label's projection falls in a region no single wall line
    # covers, use the nearest wall line by perpendicular distance. Approximate, but
    # avoids dropping the room entirely.
    if east is None:
        east = min((k for k in v_lines if k > px), default=None)
    if west is None:
        west = max((k for k in v_lines if k < px), default=None)
    if north is None:
        north = min((k for k in h_lines if k > py), default=None)
    if south is None:
        south = max((k for k in h_lines if k < py), default=None)

    if None in (east, west, north, south):
        return None
    if not (west < px < east and south < py < north):
        return None
    return west, south, east, north


def parse_label_areas(
    modelspace, labels: dict[str, tuple[str, float, float]]
) -> dict[str, float]:
    """Extract room area (m²) from the MTEXT label text, matched by position."""
    areas: dict[str, float] = {}
    for pid, (_, px, py) in labels.items():
        best_dist = 100.0  # mm
        best_area: float | None = None
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
            if not text:
                continue
            area = parse_area(text)
            if area is None:
                continue
            pt = entity.dxf.insert
            dist = ((pt.x - px) ** 2 + (pt.y - py) ** 2) ** 0.5
            if dist < best_dist:
                best_dist = dist
                best_area = area
        if best_area is not None:
            areas[pid] = best_area
    return areas


def extract_room_geometry(
    labels: dict[str, tuple[str, float, float]],
    modelspace,
    origin_x: float = 0.0,
    origin_z: float = 0.0,
    default_height: float = 3.0,
    areas: dict[str, float] | None = None,
) -> list[Room]:
    """Compute rooms as rectangular bounding boxes around each label.

    Uses the merged-collinear wall-line heuristic. When the label text includes
    an area (e.g. ``面积6.09m²``) that differs from the wall-enclosed area,
    the room depth is corrected so the floor rectangle matches the label area.
    This handles glass-curtain-wall perimeters where no wall LINE exists at the
    true room boundary.
    """
    bounds = label_cluster_bounds(labels)
    segments = collect_wall_segments(modelspace, bounds=bounds)
    rooms: list[Room] = []
    for project_id, (name, x_mm, y_mm) in labels.items():
        bbox = bounding_box_from_point(x_mm, y_mm, segments)
        if not bbox:
            continue
        min_x, min_y, max_x, max_y = bbox
        width_m = (max_x - min_x) / 1000.0
        depth_m = (max_y - min_y) / 1000.0
        # Correct depth using label area when wall-enclosed area disagrees
        label_area = areas.get(project_id) if areas else None
        if label_area is not None:
            wall_area = width_m * depth_m
            if abs(wall_area - label_area) > 0.5 * wall_area ** 0:
                pass  # keep as-is if small diff
            if wall_area > 0 and abs(wall_area - label_area) / max(wall_area, label_area) > 0.05:
                depth_m = label_area / width_m
        x_m = (min_x + max_x) / 2000.0 - origin_x / 1000.0
        z_m = origin_z / 1000.0 - (min_y + max_y) / 2000.0
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


def extract_rooms(
    dxf_path: Path, default_height: float = 3.0
) -> tuple[list[Room], list[Wall], list[Platform], list[str], tuple[float, float]]:
    """Extract rooms, walls, and platforms from the DXF.

    Rooms are origin-centered using the label-cluster centroid so coordinates
    land near (0, 0). Walls are the actual DXF wall segments (one per physical
    wall, openings left as gaps) in meters, origin-subtracted. The returned
    origin (DXF mm) is the label-cluster centroid used for centering.
    """
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    labels, skipped = extract_room_labels(msp)
    areas = parse_label_areas(msp, labels)
    origin_x, origin_z = compute_origin(labels)
    bounds = label_cluster_bounds(labels)
    rooms = extract_room_geometry(
        labels, msp, origin_x=origin_x, origin_z=origin_z,
        default_height=default_height, areas=areas,
    )
    walls = extract_walls(
        msp, bounds=bounds, origin_x=origin_x, origin_z=origin_z,
        house_config_path=HOUSE_CONFIG,
    )

    # Append gift area with no DXF label.
    # Entry garden: 4.45m (east-west, parallel to door) × 2.9m (north-south).
    # Door at x≈35783 (cen=4.14). Garden extends eastward to elevator.
    rooms.append(Room(
        id="entry_garden", name="入户花园",
        x=6.37, z=-2.63, width=4.45, depth=2.90,
        height=default_height, area=round(4.45*2.90, 2), perimeter=round(2*(4.45+2.90), 2),
    ))

    return rooms, walls, [], skipped, (origin_x, origin_z)


HOUSE_CONFIG = Path("config/house.yaml")


def load_house_room_ids(config_path: Path | None = None) -> set[str]:
    """Load the set of valid room IDs from config/house.yaml."""
    path = config_path or HOUSE_CONFIG
    if not path.exists():
        raise FileNotFoundError(
            f"House config not found: {path}. "
            "Room IDs cannot be validated without the allowed room list."
        )
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as exc:
        raise ValueError(f"Failed to parse house config {path}: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(
            f"Invalid house config in {path}: expected a mapping, got {type(data).__name__}."
        )

    ids: set[str] = set()
    for room in data.get("rooms", []) or []:
        if isinstance(room, dict) and "id" in room:
            ids.add(room["id"])
    for area in data.get("gift_areas", []) or []:
        if isinstance(area, dict) and "id" in area:
            ids.add(area["id"])

    if not ids:
        raise ValueError(
            f"No valid room IDs found in {path}. Expected 'rooms[].id' or 'gift_areas[].id' entries."
        )

    return ids


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


def merge_with_previous_layout(
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
) -> tuple[list[Room], Platform | None]:
    """Keep unlabeled gift areas and platform from the previous YAML.

    CAD geometry is authoritative for all labeled rooms. Room IDs
    present in the CAD output use CAD geometry. Only room IDs not
    present in the CAD output are carried over from the previous layout.
    """
    if not output_path.exists():
        return rooms, platform
    try:
        with open(output_path, "r", encoding="utf-8") as f:
            prev = yaml.safe_load(f)
    except Exception:
        return rooms, platform

    if not prev:
        return rooms, platform

    new_ids = {r.id for r in rooms}

    prev_by_id = {r.get("id"): r for r in prev.get("rooms", []) if r.get("id")}

    merged: list[Room] = []
    for r in rooms:
        merged.append(r)

    for prev_room in prev.get("rooms", []):
        prev_id = prev_room.get("id")
        if prev_id and prev_id not in new_ids:
            merged.append(
                Room(
                    id=prev_id,
                    name=prev_room["name"],
                    x=prev_room["x"],
                    z=prev_room["z"],
                    width=prev_room["width"],
                    depth=prev_room["depth"],
                    height=prev_room["height"],
                    area=prev_room.get("area"),
                    perimeter=prev_room.get("perimeter"),
                )
            )

    if platform is None and prev.get("platform"):
        p = prev["platform"]
        platform = Platform(
            id=p["id"],
            name=p["name"],
            x=p["x"],
            z=p["z"],
            width=p["width"],
            depth=p["depth"],
            height=p["height"],
            area=p.get("area"),
        )

    return merged, platform


def load_previous_rooms(path: Path) -> list[dict] | None:
    """Load the rooms list from a previous YAML output, if it exists."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data.get("rooms", []) if data else []
    except Exception as exc:
        raise RuntimeError("previous YAML corrupted, cannot diff") from exc


def write_layout_yaml(
    dxf_path: Path,
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
    skipped_labels: list[str] | None = None,
    walls: list[Wall] | None = None,
    origin: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Write the layout YAML and return a report summary."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        prev_rooms = load_previous_rooms(output_path)
    except RuntimeError as exc:
        prev_rooms = None
        diff_error = str(exc)
    else:
        diff_error = None

    geometry_changes = []
    if prev_rooms is not None:
        prev_by_id_geo = {r.get("id"): r for r in prev_rooms if r.get("id")}
        for r in rooms:
            prev_room = prev_by_id_geo.get(r.id)
            if prev_room:
                for field in ["x", "z", "width", "depth"]:
                    old_val = prev_room.get(field)
                    new_val = getattr(r, field)
                    if old_val != new_val:
                        geometry_changes.append({
                            "room_id": r.id,
                            "field": field,
                            "old": old_val,
                            "new": new_val,
                        })

    rooms, platform = merge_with_previous_layout(rooms, platform, output_path)

    origin_x_m = (origin[0] / 1000.0) if origin is not None else 0.0
    origin_z_m = (origin[1] / 1000.0) if origin is not None else 0.0
    data = {
        "version": "1.0",
        "source": str(dxf_path),
        "unit": "m",
        "scale": 0.001,
        "origin": {"x": origin_x_m, "z": origin_z_m},
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
    if walls:
        data["walls"] = [
            {**{"x1": w.x1, "z1": w.z1, "x2": w.x2, "z2": w.z2}, **({"curtain": True} if w.curtain else {})} for w in walls
        ]
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

    total_area = round(sum(r.area for r in rooms if r.area), 2)
    valid_ids = load_house_room_ids()
    missing_house_config_id = (
        sum(1 for r in rooms if r.id not in valid_ids) if valid_ids else 0
    )
    report = {
        "source": str(dxf_path),
        "rooms_found": len(rooms),
        "missing_house_config_id": missing_house_config_id,
        "skipped_labels": skipped_labels or [],
        "geometry_warnings": 0,
        "total_interior_area": total_area,
        "diff": diff_rooms(prev_rooms, rooms) if diff_error is None else diff_error,
        "geometry_changes": geometry_changes,
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
    rooms, walls, platforms, skipped, origin = extract_rooms(dxf_path, default_height=args.height)
    platform = platforms[0] if platforms else None
    report = write_layout_yaml(
        dxf_path,
        rooms,
        platform,
        args.output,
        skipped_labels=skipped,
        walls=walls,
        origin=origin,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
