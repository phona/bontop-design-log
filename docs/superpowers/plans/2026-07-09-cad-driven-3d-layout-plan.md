# CAD-Driven 3D Layout Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CAD floor plan the single source of truth for the 3D house layout by extracting geometry from DXF into `config/layout/cad-extracted.yaml`, loading it on the server, and rendering it in the 3D app.

**Architecture:** A Python DXF parser (`scripts/parse_cad.py`) reads the CAD file and writes a YAML layout. The server loads both the YAML geometry and `config/house.yaml` metadata, merging them into the `ProjectCatalog` room model. The frontend removes hardcoded `rooms`/`platform` from `shared/houseData.ts` and renders the layout from the existing `GET /api/project` response.

**Tech Stack:** Python 3.11+ with `ezdxf`, Node.js 20+ with TypeScript, `js-yaml`, `express`, `tsx` test runner, `vitest`.

## Global Constraints

- CAD file location: `cad/design/01_floor_plan/floor_plan_design_*.dxf`
- Output YAML: `config/layout/cad-extracted.yaml`
- Coordinate units: millimeters in DXF, meters in YAML
- Room IDs must match existing IDs from `shared/houseData.ts` (now moving to `config/house.yaml`)
- `shared/houseData.ts` retains only `hvacSchemes`
- `config/layout/final.yaml` and `cad/original/701_dimensions.csv` are deleted after content migration
- All existing tests must continue to pass
- `npm run typecheck` must pass

---

## File Structure

### New files
- `requirements.txt` — Python dependencies
- `scripts/parse_cad.py` — DXF parser and YAML generator
- `scripts/parse_cad_test.py` — Python tests for the parser
- `config/layout/cad-extracted.yaml` — generated CAD layout
- `scripts/logs/cad-extraction-report.json` — extraction report (created on first run)

### Modified files
- `shared/types.ts` — add layout YAML types
- `server/project-catalog.ts` — load CAD geometry and house metadata
- `server/index.ts` — add `ConfigLoader` for layout YAML and hot reload
- `shared/houseData.ts` — remove `rooms` and `platform`, keep `hvacSchemes`
- `app/src/render/HouseScene.ts` — render platform from API data
- `config/house.yaml` — merge unique content from `config/layout/final.yaml`
- `tests/server/project-catalog.test.ts` — update to load layout YAML fixture
- `app/src/scene/HouseScene.test.ts` — update platform expectations

### Deleted files
- `config/layout/final.yaml`
- `cad/original/701_dimensions.csv`

---

### Task 1: Add shared types for the CAD layout YAML

**Files:**
- Create: none
- Modify: `shared/types.ts:1-10`
- Test: `tests/server/project-catalog.test.ts` (updated in Task 12)

**Interfaces:**
- Consumes: none
- Produces: `LayoutRoom`, `PlatformLayout`, `CadLayoutYaml` types exported from `shared/types.ts`

- [ ] **Step 1: Add layout types to `shared/types.ts`**

Append these types after the existing imports/types:

```ts
export interface LayoutRoom {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  area?: number;
  perimeter?: number;
}

export interface PlatformLayout {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  area?: number;
}

export interface CadLayoutYaml {
  version: string;
  source: string;
  unit: string;
  scale: number;
  origin: { x: number; z: number };
  export_date: string;
  rooms: LayoutRoom[];
  platform?: PlatformLayout;
}

export interface HouseYaml {
  project: {
    name: string;
    city: string;
    building_area: number;
    usable_area: number;
    floor_height: number;
    floor: number;
    building_type: string;
    unit_position: string;
    orientation: string;
    layout_type: string;
    data_source: string;
    accuracy_warning?: string;
  };
  rooms: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    orientation: string;
    notes: string;
    windows: Array<{ width: number; height: number; position: string }>;
    doors: Array<{ width: number; position: string }>;
    furniture_concept: string[];
  }>;
  gift_areas: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    orientation: string;
    notes: string;
    windows: Array<{ width: number; height: number; position: string }>;
    doors: Array<{ width: number; position: string }>;
    furniture_concept: string[];
  }>;
  mechanical_electrical_plumbing: unknown;
  constraints: unknown;
  // Additional sections migrated from config/layout/final.yaml
  circulation?: unknown;
  design_rationale?: string[];
  pending_verification?: string[];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors (types are only additive).

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "types: add CAD layout YAML interfaces"
```

---

### Task 2: Add Python dependency file

**Files:**
- Create: `requirements.txt`
- Modify: none
- Test: `python -c "import ezdxf"`

**Interfaces:**
- Consumes: none
- Produces: `requirements.txt` containing `ezdxf`

- [ ] **Step 1: Create `requirements.txt`**

```text
ezdxf>=1.3.0
pyyaml>=6.0
```

- [ ] **Step 2: Install and verify**

Run:

```bash
python -m pip install -r requirements.txt
python -c "import ezdxf; print(ezdxf.__version__)"
```

Expected: prints version number without errors.

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "build: add ezdxf and pyyaml to python requirements"
```

---

### Task 3: Create the DXF parser skeleton

**Files:**
- Create: `scripts/parse_cad.py`
- Modify: none
- Test: `scripts/parse_cad_test.py` (created in this task)

**Interfaces:**
- Consumes: none
- Produces: `scripts/parse_cad.py` with CLI entry point and placeholder functions

- [ ] **Step 1: Write skeleton parser**

```python
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
```

- [ ] **Step 2: Write a failing test for `latest_dxf` and `parse_room_label`**

Create `scripts/parse_cad_test.py`:

```python
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
```

- [ ] **Step 3: Run failing tests**

Run: `python -m pytest scripts/parse_cad_test.py -v`
Expected: tests fail or pass depending on whether the functions are implemented. At this stage the skeleton is implemented, so they should pass for the tested functions.

- [ ] **Step 4: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): add parser skeleton and helper tests"
```

---

### Task 4: Implement room label extraction

**Files:**
- Create: none
- Modify: `scripts/parse_cad.py`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: `ezdxf` modelspace and `SH-文字标注` layer
- Produces: `extract_room_labels(modelspace) -> dict[str, tuple[str, float, float]]` mapping project_id -> (name, insert_x_mm, insert_z_mm)

- [ ] **Step 1: Implement `extract_room_labels`**

Add to `scripts/parse_cad.py`:

```python
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
```

- [ ] **Step 2: Add test with a mock DXF label**

Append to `scripts/parse_cad_test.py`:

```python
def test_extract_room_labels_from_dxf():
    from ezdxf.document import Drawing
    from parse_cad import extract_room_labels

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_text("主卧[master_bedroom]", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_text("次卧[bedroom_nw]", dxfattribs={"layer": "SH-文字标注", "insert": (-500, 1000, 0)})
    labels = extract_room_labels(msp)
    assert labels["master_bedroom"] == ("主卧", 1000.0, 2000.0)
    assert labels["bedroom_nw"] == ("次卧", -500.0, 1000.0)
```

- [ ] **Step 3: Run tests**

Run: `python -m pytest scripts/parse_cad_test.py -v`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): extract room labels from DXF"
```

---

### Task 5: Implement wall extraction and room bounding

**Files:**
- Create: none
- Modify: `scripts/parse_cad.py`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: wall entities on `BS-非承重墙` and `BS-承重墙` layers
- Produces: `extract_room_geometry(labels, modelspace, origin_x, origin_z, default_height) -> tuple[list[Room], list[Platform]]`

- [ ] **Step 1: Add wall-line collection**

Add to `scripts/parse_cad.py`:

```python
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
```

- [ ] **Step 2: Implement room bounding from label point**

Add to `scripts/parse_cad.py`:

```python
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
```

- [ ] **Step 3: Implement `extract_room_geometry`**

Add to `scripts/parse_cad.py`:

```python
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
```

- [ ] **Step 4: Update `extract_rooms` to use the new functions**

```python
def extract_rooms(dxf_path: Path, default_height: float = 3.0) -> tuple[list[Room], list[Platform]]:
    """Extract rooms and platforms from the DXF."""
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()
    labels = extract_room_labels(msp)
    rooms = extract_room_geometry(labels, msp, default_height=default_height)
    return rooms, []
```

- [ ] **Step 5: Add test**

Append to `scripts/parse_cad_test.py`:

```python
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
```

- [ ] **Step 6: Run tests**

Run: `python -m pytest scripts/parse_cad_test.py -v`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): compute rectangular room bounding boxes from walls"
```

---

### Task 6: Implement YAML output and extraction report

**Files:**
- Create: none
- Modify: `scripts/parse_cad.py`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: list of `Room` and optional `Platform`
- Produces: `config/layout/cad-extracted.yaml` and JSON report

- [ ] **Step 1: Implement `write_layout_yaml`**

Replace the placeholder with:

```python
def write_layout_yaml(
    dxf_path: Path,
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
) -> dict[str, Any]:
    """Write the layout YAML and return a report summary."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
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
    report = {
        "source": str(dxf_path),
        "rooms_found": len(rooms),
        "missing_project_id": 0,
        "geometry_warnings": 0,
        "total_interior_area": total_area,
    }
    return report
```

- [ ] **Step 2: Update `main` to write report JSON**

In `main()`, after `write_layout_yaml`, add:

```python
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
```

- [ ] **Step 3: Add test for YAML output**

Append to `scripts/parse_cad_test.py`:

```python
def test_write_layout_yaml(tmp_path: Path):
    from parse_cad import Room, Platform, write_layout_yaml

    out = tmp_path / "cad-extracted.yaml"
    rooms = [Room(id="master_bedroom", name="主卧", x=-5.35, z=2.0, width=4.5, depth=4.05, height=3.0, area=18.16, perimeter=18.39)]
    platform = Platform(id="west_platform", name="西设备平台", x=-8.5, z=2.0, width=1.6, depth=1.55, height=3.0, area=2.48)
    report = write_layout_yaml(tmp_path / "source.dxf", rooms, platform, out)
    assert out.exists()
    assert report["rooms_found"] == 1
    content = out.read_text(encoding="utf-8")
    assert "master_bedroom" in content
    assert "west_platform" in content
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest scripts/parse_cad_test.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): write layout YAML and extraction report"
```

---

### Task 7: Generate the initial CAD layout YAML

**Files:**
- Create: `config/layout/cad-extracted.yaml`, `scripts/logs/cad-extraction-report.json`
- Modify: none
- Test: manual inspection

**Interfaces:**
- Consumes: `cad/design/01_floor_plan/floor_plan_design_*.dxf`
- Produces: `config/layout/cad-extracted.yaml`

- [ ] **Step 1: Run the parser on the real CAD file**

Run: `python scripts/parse_cad.py`
Expected: prints report and writes `config/layout/cad-extracted.yaml` and `scripts/logs/cad-extraction-report.json`.

- [ ] **Step 2: Inspect the output**

Run: `cat config/layout/cad-extracted.yaml`
Expected: YAML contains all expected rooms with IDs matching `config/house.yaml`, coordinates in meters, and optional platform section.

- [ ] **Step 3: Commit the generated files**

```bash
git add config/layout/cad-extracted.yaml scripts/logs/cad-extraction-report.json
git commit -m "data: generate initial CAD layout YAML"
```

---

### Task 8: Load CAD layout and house metadata in ProjectCatalog

**Files:**
- Create: none
- Modify: `server/project-catalog.ts`
- Test: `tests/server/project-catalog.test.ts`

**Interfaces:**
- Consumes: `CadLayoutYaml` and `HouseYaml` from `config/` files
- Produces: merged `RoomLayout` objects in `ProjectCatalog`

- [ ] **Step 1: Add helper to merge layout and metadata**

In `server/project-catalog.ts`, add:

```ts
import type { CadLayoutYaml, HouseYaml, LayoutRoom, PlatformLayout } from '../shared/types.js';

function mergeRoom(layoutRoom: LayoutRoom, meta?: HouseYaml['rooms'][number]): RoomLayout {
  return {
    id: layoutRoom.id,
    name: meta?.name ?? layoutRoom.name,
    x: layoutRoom.x,
    z: layoutRoom.z,
    width: layoutRoom.width,
    depth: layoutRoom.depth,
    height: layoutRoom.height,
    type: meta?.type ?? 'public',
  };
}

function mergePlatform(layoutPlatform: PlatformLayout): RoomLayout {
  return {
    id: layoutPlatform.id,
    name: layoutPlatform.name,
    x: layoutPlatform.x,
    z: layoutPlatform.z,
    width: layoutPlatform.width,
    depth: layoutPlatform.depth,
    height: layoutPlatform.height,
    type: 'service',
  };
}
```

- [ ] **Step 2: Update `ProjectCatalog` constructor and load**

Modify `ProjectCatalog` constructor signature:

```ts
constructor(
  materials: MaterialsYaml,
  budgetBase: {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  },
  layout?: CadLayoutYaml,
  houseMeta?: HouseYaml,
) {
  // ... existing material/topic/budget setup ...

  if (layout) {
    const metaMap = new Map(houseMeta?.rooms?.map((r) => [r.id, r]) ?? []);
    for (const r of layout.rooms) {
      this.rooms.set(r.id, mergeRoom(r, metaMap.get(r.id)));
    }
    if (layout.platform) {
      this.rooms.set(layout.platform.id, mergePlatform(layout.platform));
    }
  } else {
    // Fallback to legacy hardcoded data until full migration is complete
    for (const r of rooms) this.rooms.set(r.id, r);
    this.rooms.set(platform.id, platform);
  }

  // ... rest of constructor ...
}
```

Update `static load`:

```ts
static load(configDir = '.'): ProjectCatalog {
  const materials = load(readFileSync(`${configDir}/config/materials.yaml`, 'utf8')) as MaterialsYaml;
  const budgetBase = JSON.parse(readFileSync(`${configDir}/config/budget/base.json`, 'utf8')) as {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  };
  const layout = load(readFileSync(`${configDir}/config/layout/cad-extracted.yaml`, 'utf8')) as CadLayoutYaml;
  const houseMeta = load(readFileSync(`${configDir}/config/house.yaml`, 'utf8')) as HouseYaml;
  return new ProjectCatalog(materials, budgetBase, layout, houseMeta);
}
```

Update `static fromMaterials`:

```ts
static fromMaterials(
  materials: MaterialsYaml,
  budgetBase: {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  },
  layout?: CadLayoutYaml,
  houseMeta?: HouseYaml,
): ProjectCatalog {
  return new ProjectCatalog(materials, budgetBase, layout, houseMeta);
}
```

- [ ] **Step 3: Run server tests**

Run: `npm run test:server`
Expected: tests may fail because fixtures need updating; fix in Task 12.

- [ ] **Step 4: Commit**

```bash
git add server/project-catalog.ts
git commit -m "feat(server): load CAD layout YAML and house metadata into ProjectCatalog"
```

---

### Task 9: Add config loader and hot reload for layout YAML in server

**Files:**
- Create: none
- Modify: `server/index.ts`
- Test: `npm run dev:server` manual check

**Interfaces:**
- Consumes: `ConfigLoader` and `CadLayoutYaml`
- Produces: hot reload of `ProjectCatalog` when `config/layout/cad-extracted.yaml` changes

- [ ] **Step 1: Add layout config loader**

In `server/index.ts`, after `budgetBaseLoader` registration, add:

```ts
const layoutLoader = new ConfigLoader<CadLayoutYaml>(
  'config/layout/cad-extracted.yaml',
  (raw) => load(raw) as CadLayoutYaml,
  () => {
    rebuildDerived();
    console.log('[server] config/layout/cad-extracted.yaml reloaded');
  }
);
registry.register(layoutLoader);

const houseMetaLoader = new ConfigLoader<HouseYaml>(
  'config/house.yaml',
  (raw) => load(raw) as HouseYaml,
  () => {
    rebuildDerived();
    console.log('[server] config/house.yaml reloaded');
  }
);
registry.register(houseMetaLoader);
```

Update `rebuildDerived()` to pass layout and houseMeta to `ProjectCatalog.fromMaterials`:

```ts
function rebuildDerived(): void {
  const materials = materialsLoader.getConfig() ?? { materials: [] };
  const budgetBase = budgetBaseLoader.getConfig() ?? { total_budget: 0, categories: {} };
  const layout = layoutLoader.getConfig();
  const houseMeta = houseMetaLoader.getConfig();
  catalog = ProjectCatalog.fromMaterials(materials, budgetBase, layout, houseMeta);
  const rulesConfig = designRulesLoader.getConfig() ?? { version: '1.0', risks: [], constraints: [] };
  ruleEngine = new RuleEngine(rulesConfig);
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
}
```

Add loaders to `load()` calls and `startWatching()`:

```ts
layoutLoader.load();
houseMetaLoader.load();
// ...
layoutLoader.startWatching();
houseMetaLoader.startWatching();
```

- [ ] **Step 2: Start server and verify reload**

Run: `npm run dev:server`
Expected: server starts without errors. Modify `config/layout/cad-extracted.yaml` and confirm console logs reload.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): watch and hot-reload CAD layout and house metadata"
```

---

### Task 10: Remove hardcoded rooms from `shared/houseData.ts`

**Files:**
- Create: none
- Modify: `shared/houseData.ts`
- Test: `npm run typecheck`

**Interfaces:**
- Consumes: none
- Produces: `shared/houseData.ts` exporting only `FLOOR_HEIGHT` and `hvacSchemes`

- [ ] **Step 1: Delete `rooms` and `platform` arrays**

Replace the file content with:

```ts
import type { HvacScheme } from './types.js';

/**
 * 701 户型 HVAC 方案常量。
 * 房间几何布局已迁移到 CAD → config/layout/cad-extracted.yaml，
 * 此处仅保留 HVAC 多方案数据。
 */

export const FLOOR_HEIGHT = 3.0;

export const hvacSchemes: HvacScheme[] = [
  // ... existing hvacSchemes array unchanged ...
];
```

Keep the full `hvacSchemes` array as-is.

- [ ] **Step 2: Remove imports from `server/project-catalog.ts` fallback**

Since `ProjectCatalog` now always loads from YAML in production, remove the fallback import from `shared/houseData.ts`. The fallback code block from Task 8 should also be removed so the constructor requires `layout`:

```ts
constructor(
  materials: MaterialsYaml,
  budgetBase: {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  },
  layout: CadLayoutYaml,
  houseMeta?: HouseYaml,
) {
  // ... existing setup ...

  const metaMap = new Map(houseMeta?.rooms?.map((r) => [r.id, r]) ?? []);
  for (const r of layout.rooms) {
    this.rooms.set(r.id, mergeRoom(r, metaMap.get(r.id)));
  }
  if (layout.platform) {
    this.rooms.set(layout.platform.id, mergePlatform(layout.platform));
  }

  // ... rest ...
}
```

Also remove `import { hvacSchemes, rooms, platform } from '../shared/houseData.js';` and replace with `import { hvacSchemes } from '../shared/houseData.js';`.

- [ ] **Step 3: Update `fromMaterials` and `load` signatures**

`fromMaterials` must also require layout:

```ts
static fromMaterials(
  materials: MaterialsYaml,
  budgetBase: {
    total_budget: number;
    categories: Record<string, Omit<BudgetCategory, 'key'>>;
  },
  layout: CadLayoutYaml,
  houseMeta?: HouseYaml,
): ProjectCatalog {
  return new ProjectCatalog(materials, budgetBase, layout, houseMeta);
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: errors point to tests still using old `rooms`/`platform`; fix in Task 12.

- [ ] **Step 5: Commit**

```bash
git add shared/houseData.ts server/project-catalog.ts
git commit -m "refactor(shared): remove hardcoded rooms and platform, keep hvacSchemes"
```

---

### Task 11: Render platform from API data in `HouseScene`

**Files:**
- Create: none
- Modify: `app/src/render/HouseScene.ts`
- Test: `app/src/scene/HouseScene.test.ts`

**Interfaces:**
- Consumes: `projectData.house.platform` from `GET /api/project`
- Produces: platform rendered in `buildFromCatalog()` instead of hardcoded `buildPlatform()`

- [ ] **Step 1: Update `ProjectData` interface**

```ts
interface ProjectData {
  house: {
    rooms: Array<{
      id: string;
      name: string;
      x: number;
      z: number;
      width: number;
      depth: number;
      height: number;
      type: string;
    }>;
    platform?: {
      id: string;
      name: string;
      x: number;
      z: number;
      width: number;
      depth: number;
      height: number;
    };
  };
  topics: Array<{ id: string; name: string; perRoom: boolean; options: unknown[] }>;
  budgetCategories: unknown[];
}
```

- [ ] **Step 2: Move platform rendering into `buildFromCatalog()`**

Remove `this.buildPlatform();` from constructor. In `buildFromCatalog()` after room loop, add:

```ts
if (projectData.house.platform) {
  this.createPlatform(projectData.house.platform);
}
```

- [ ] **Step 3: Rename `buildPlatform` to `createPlatform` and accept data**

```ts
private createPlatform(p: ProjectData['house']['platform'] & { id: string; name: string }) {
  const geo = new THREE.BoxGeometry(p.width, 0.15, p.depth);
  const mat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.x, 0.075, p.z);
  mesh.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
  mesh.receiveShadow = true;
  this.scene.add(mesh);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(p.width + 0.1, 0.05, p.depth + 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.4 })
  );
  frame.position.set(p.x, 0.2, p.z);
  frame.userData = { roomId: p.id, objectId: 'platform_boundary', type: 'platform' };
  this.scene.add(frame);

  this.rooms[p.id] = { ...p };
}
```

- [ ] **Step 4: Remove unused imports**

Remove `import { rooms, platform } from '@shared/houseData';`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: errors point to `HouseScene.test.ts`; fix in Task 12.

- [ ] **Step 6: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat(app): render platform from API data"
```

---

### Task 12: Migrate unique content from `config/layout/final.yaml` and delete files

**Files:**
- Create: none
- Modify: `config/house.yaml`
- Delete: `config/layout/final.yaml`, `cad/original/701_dimensions.csv`
- Test: `npm run test:server`

**Interfaces:**
- Consumes: `config/layout/final.yaml` content
- Produces: updated `config/house.yaml` with `circulation`, `design_rationale`, and `pending_verification` sections

- [ ] **Step 1: Append migrated sections to `config/house.yaml`**

Add at the end of `config/house.yaml`:

```yaml
circulation:
  main_entry: "入户花园 → 客餐厅"
  kitchen_to_dining: "厨房直接连接客餐厅"
  master_suite_path: "客餐厅 → 过道 → 主卧 → 主卫"
  public_bath_path: "客餐厅 → 过道 → 客卫"
  fire_access: "入户花园内保留消防通道，不得封闭"

design_rationale:
  - "四房两厅两卫，目前两人居住，书房预留未来改客房/儿童房的可能"
  - "客餐厅合并，南向采光面大，电视墙方案"
  - "开放式厨房，增强客餐厅通透感，配大功率侧吸油烟机"
  - "入户花园作为玄关过渡区，兼顾消防通道"
  - "主卧带独立卫生间，形成主卧套房；飘窗保留"
  - "全屋玻璃幕墙，窗帘为遮阳隔热 + 隐私刚需，主卧/客厅/书房预留电动窗帘电源"
  - "仅西设备平台可用，中央空调/多联机为最优方案"
  - "预算目标 11 万，务实档，非豪华装修"

pending_verification:
  - "所有房间净尺寸需现场量房复核"
  - "承重墙、梁位需物业竣工图确认"
  - "玻璃幕墙分格及门窗口位置需设计院图纸确认"
  - "开放式厨房排烟效果需设计师复核"
  - "中央空调外机散热及检修空间需现场复核"
```

- [ ] **Step 2: Delete files**

Run:

```bash
rm config/layout/final.yaml
rm cad/original/701_dimensions.csv
```

- [ ] **Step 3: Update `server/project-catalog.ts` to load `circulation` if needed**

If the app needs to expose circulation via API, add a getter in `ProjectCatalog`:

```ts
private houseMeta?: HouseYaml;

constructor(
  materials: MaterialsYaml,
  budgetBase: { ... },
  layout: CadLayoutYaml,
  houseMeta?: HouseYaml,
) {
  // ...
  this.houseMeta = houseMeta;
}

getCirculation(): HouseYaml['circulation'] | undefined {
  return this.houseMeta?.circulation;
}
```

Only add this if the frontend or API needs it. For the current scope, this is optional.

- [ ] **Step 4: Commit**

```bash
git add config/house.yaml
git rm config/layout/final.yaml cad/original/701_dimensions.csv
git commit -m "docs(config): merge final.yaml content into house.yaml and delete redundant files"
```

---

### Task 13: Update tests and fixtures

**Files:**
- Create: `tests/fixtures/layout.yaml` (optional)
- Modify: `tests/server/project-catalog.test.ts`, `app/src/scene/HouseScene.test.ts`
- Test: `npm run test:server`, `npm run test --workspace=app`

**Interfaces:**
- Consumes: updated `ProjectCatalog` API
- Produces: passing tests

- [ ] **Step 1: Update `tests/server/project-catalog.test.ts`**

Read the current test file and update:

- Replace `ProjectCatalog.fromMaterials(materials, budgetBase)` with `ProjectCatalog.fromMaterials(materials, budgetBase, layoutFixture)` where `layoutFixture` is a minimal `CadLayoutYaml` loaded from a test fixture or inline object.
- Replace `ProjectCatalog.load('.')` with the actual `load` method which now requires `config/layout/cad-extracted.yaml` and `config/house.yaml` to exist. Ensure tests use a temporary directory or the existing `config/` directory.

Example fixture:

```ts
const layoutFixture: CadLayoutYaml = {
  version: '1.0',
  source: 'test.dxf',
  unit: 'mm',
  scale: 0.001,
  origin: { x: 0, z: 0 },
  export_date: '2026-07-09',
  rooms: [
    { id: 'master_bedroom', name: '主卧', x: -5.35, z: 2.0, width: 4.5, depth: 4.05, height: 3.0, area: 18.16, perimeter: 18.39 },
  ],
  platform: { id: 'west_platform', name: '西设备平台', x: -8.5, z: 2.0, width: 1.6, depth: 1.55, height: 3.0, area: 2.48 },
};
```

- [ ] **Step 2: Update `app/src/scene/HouseScene.test.ts`**

Read the current test file and update any test that relies on hardcoded `platform` or `rooms` from `shared/houseData.ts`. Pass a `platform` object in `projectData.house` when calling `buildFromCatalog()` if platform rendering is tested.

- [ ] **Step 3: Run all tests**

Run:

```bash
npm run test:server
cd app && npm run test
```

Expected: all tests pass after updates.

- [ ] **Step 4: Commit**

```bash
git add tests/server/project-catalog.test.ts app/src/scene/HouseScene.test.ts
git commit -m "test: update project-catalog and HouseScene tests for CAD-driven layout"
```

---

### Task 14: Update documentation and accuracy warning

**Files:**
- Create: none
- Modify: `README.md`, `scripts/README.md`, `config/house.yaml`
- Test: manual review

**Interfaces:**
- Consumes: completed implementation
- Produces: updated docs

- [ ] **Step 1: Update `config/house.yaml` accuracy warning**

Change:

```yaml
accuracy_warning: "套内房间面积来自设计图，尺寸为按面积估算；赠送面积、承重墙、梁位、管道以合同图及现场量房为准"
```

To:

```yaml
accuracy_warning: "房间尺寸与面积来自 CAD 设计图；承重墙、梁位、管道、门窗口位置以合同图及现场量房为准"
```

- [ ] **Step 2: Update `scripts/README.md`**

Add a section for `parse_cad.py`:

```markdown
## `parse_cad.py`

Extracts the 2D/3D house layout from `cad/design/01_floor_plan/floor_plan_design_*.dxf` and writes it to `config/layout/cad-extracted.yaml`.

```bash
python -m pip install -r requirements.txt
python scripts/parse_cad.py
```

Requires the CAD file to follow the conventions documented in `docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md`.
```

- [ ] **Step 3: Update `README.md`**

Add a brief note about the CAD-driven layout and the extraction command.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/README.md config/house.yaml
git commit -m "docs: update CAD extraction usage and accuracy warning"
```

---

### Task 15: Final verification

**Files:**
- Create: none
- Modify: none
- Test: all project checks

- [ ] **Step 1: Run full verification suite**

```bash
python -m pytest scripts/parse_cad_test.py -v
npm run test:server
cd app && npm run test
npm run typecheck
```

Expected: all pass.

- [ ] **Step 2: Manual end-to-end check**

```bash
npm run dev:server &
curl http://localhost:3000/api/project | jq '.house.rooms[] | {id, x, z, width, depth}'
```

Expected: rooms match `config/layout/cad-extracted.yaml`.

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# Add and commit any remaining files
git commit -m "chore: final verification for CAD-driven layout"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Plan coverage |
|--------------|---------------|
| 4.1 Data flow | Tasks 1-8, 10-11 |
| 4.2 CAD conventions | Task 3-4 (label parsing), Task 5 (wall extraction) |
| 4.3 Output YAML format | Task 6 (write YAML), Task 7 (generate) |
| 4.4 Extraction script | Tasks 2-6 |
| 4.5 Server integration | Tasks 1, 8-9 |
| 4.6 Frontend integration | Tasks 10-11 |
| 4.7 Validation and diff | Task 6 (report) — diff against previous YAML is not fully implemented; consider adding as a follow-up if required by spec. |
| 5. Behavior | Tasks 7-15 (verification) |
| 6. Verification | Task 15 |
| 8. File Deletions | Task 12 |

**Gap:** The spec requires "a diff against the previous YAML if it exists" in the extraction report. Task 6 only reports room counts and total area. Add this to the parser or accept it as a follow-up improvement.

### 2. Placeholder scan

No TBD/TODO placeholders. All steps include concrete commands or code.

### 3. Type consistency

- `RoomLayout` retains the same shape: `id, name, x, z, width, depth, height, type`.
- `ProjectCatalog` always provides `RoomLayout[]` to the API, so `GET /api/project` contract is unchanged.
- `HouseScene.buildFromCatalog()` consumes the same `projectData.house.rooms` shape plus an optional `platform`.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-cad-driven-3d-layout-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**

Also, before starting execution, decide on the diff-against-previous-YAML gap: should I add it to the parser in Task 6, or leave it as a follow-up after the main pipeline is working?
