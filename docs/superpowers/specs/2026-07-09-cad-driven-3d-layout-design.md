# Design: CAD-Driven 3D Layout Pipeline

## 1. Background

The 3D interior-design app currently renders the house layout from a hardcoded `rooms` array in `shared/houseData.ts`. This array duplicates the floor-plan information that already lives in the CAD file `cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf`. When the designer changes a room size, moves a wall, or renames a room in CAD, a developer must manually edit `shared/houseData.ts` to keep the 3D scene in sync. This is error-prone and creates drift between the authoritative design and the interactive preview.

## 2. Goal

Make the CAD file the single source of truth for the 2D/3D layout of the house. After the change, any layout update that is made in CAD and saved in `cad/design/01_floor_plan/` will automatically flow into the 3D scene by re-running the extraction script.

## 3. Scope

### In scope

- Read `cad/design/01_floor_plan/floor_plan_design_*.dxf` and extract the room layout.
- Generate a structured YAML layout file at `config/layout/cad-extracted.yaml`.
- Load the YAML layout in `server/project-catalog.ts` and expose it via the existing API.
- Replace `shared/houseData.ts` hardcoded room geometry with runtime data from the server.
- Add DXF parsing script `scripts/parse_cad.py` and keep it maintainable.
- Document the CAD conventions the designer must follow.
- Add validation and diff reporting to the extraction script.
- Update or add tests for the new pipeline.

### Out of scope

- Changing materials, finishes, or furniture selection logic.
- Changing the budget calculation or rule engine.
- Replacing HVAC placement data in `shared/houseData.ts` (the `hvacSchemes` array stays).
- CAD feature extraction beyond rectangles, walls, room labels, and the outdoor platform (e.g., no window/door polygons, no electrical symbols).

## 4. Design

### 4.1 Data flow

```text
cad/design/01_floor_plan/floor_plan_design_*.dxf
        │
        ▼
scripts/parse_cad.py
        │
        ▼
config/layout/cad-extracted.yaml
        │
        ▼
server/project-catalog.ts
        │
        ▼
GET /api/project
        │
        ▼
app/src/render/HouseScene.ts
```

### 4.2 CAD conventions

The designer must follow the conventions below for the extraction script to run without manual intervention.

| Layer | Meaning | Geometry type |
|-------|---------|---------------|
| `SH-文字标注` | Room labels and area annotations | `TEXT` / `MTEXT` |
| `BS-非承重墙` | Non-load-bearing walls | `LINE` / `LWPOLYLINE` |
| `BS-承重墙` | Load-bearing walls | `LINE` / `LWPOLYLINE` |
| `SH-尺寸标注` | Dimension lines and numeric labels | `DIMENSION` / `TEXT` (optional) |
| `0` / other | Construction helpers | Ignored |

Room labels are written on layer `SH-文字标注` in Chinese. The parser reads the Chinese room name (e.g., `主卧`, `客餐厅`, `厨房`) and maps it to a project ID. It also extracts the optional `面积` and `周长` annotations when they are present.

For example:

```text
主卧
面积18.16m²
周长18.39m
```

The parser recognizes the following Chinese names and maps them to project IDs:

- `主卧` → `master_bedroom`
- `客餐厅` → `living_dining`
- `厨房` → `kitchen`
- `阳台` → `balcony`
- `卫生间` → `master_bath` or `guest_bath` (disambiguated by area and proximity to the `主卧` label)
- `次卧` → `bedroom_nw`, `bedroom_se`, or `study` (disambiguated by area and position relative to the `主卧` label)
- `入户花园` → `entry_garden`
- `南向大阳台` → `south_balcony`
- `西设备平台` / `西侧平台` → `west_platform`

Ambiguous names, such as multiple `次卧` labels or two `卫生间`, are disambiguated by their area and position relative to the `主卧` label. The parser still accepts the legacy `[project-id]` annotation for backward compatibility, but designers should not rely on it.

Each room must be enclosed by a closed wall polyline or a set of connected `LINE` segments. A room is defined as the rectangular bounding box of its inner wall surface. The first version of the parser supports only rectangular rooms; non-rectangular rooms produce a warning and must be corrected in CAD or manually added to the YAML.

### 4.3 Output YAML format

`config/layout/cad-extracted.yaml` is the contract between the CAD and the server. Its schema is:

```yaml
version: "1.0"
source: "cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf"
unit: "mm"
scale: 0.001                # converts mm to meters
origin: { x: 0, z: 0 }      # entrance door center in CAD coordinates
export_date: "2026-07-09"
rooms:
  - id: master_bedroom
    name: "主卧"
    x: -5.35
    z: 2.0
    width: 4.5
    depth: 4.05
    height: 3.0
    area: 18.16
    perimeter: 18.39
  - id: bedroom_nw
    name: "西北次卧"
    x: -5.35
    z: -3.5
    width: 3.0
    depth: 2.8
    height: 3.0
    area: 16.88
    perimeter: 16.5
platform:
  id: west_platform
  name: "西侧平台"
  x: -8.15
  z: 0
  width: 1.5
  depth: 10.0
  height: 0.15
  area: 15.0
```

All coordinate values are in meters relative to the entrance door. Room `x` and `z` refer to the center of the room floor. `width` is the X-axis dimension, `depth` is the Z-axis dimension. `height` comes from `config/house.yaml` (default 3.0 m) unless the CAD dimension layer provides a ceiling height.

### 4.4 Extraction script `scripts/parse_cad.py`

The script uses the lightweight DXF library `ezdxf` (added to `requirements.txt` or documented for manual install) and performs the following steps:

1. Open the latest `cad/design/01_floor_plan/floor_plan_design_*.dxf` by file modification time.
2. Select the active floor plan. If multiple floor plan blocks/layouts are present (e.g., 墙体定位图 and 平面布置图), prefer the one named `墙体定位图`.
3. Find all room labels on `SH-文字标注` and parse the `[project-id]`.
4. Build wall edges from `BS-非承重墙` and `BS-承重墙`.
5. For each labeled room, find the closed wall loop around the label insertion point and compute its bounding box.
6. Convert millimeter coordinates to meters and translate by the chosen origin.
7. Detect the outdoor platform from an optional label or from the largest rectangle outside the main wall perimeter.
8. Write `config/layout/cad-extracted.yaml`.
9. Print a summary report: rooms found, missing IDs, ambiguous labels, area mismatches, and a diff against the previous YAML if it exists.

The script exits with a non-zero status if any required room is missing or if geometry cannot be extracted, so the CI step fails early.

### 4.5 Server integration

`server/project-catalog.ts` currently loads `config/house.yaml` for metadata. It will be extended to:

1. Load `config/layout/cad-extracted.yaml` after `config/house.yaml`.
2. Merge the YAML rooms into the `ProjectCatalog` house model. Room metadata from `house.yaml` (name override, furniture, MEP, notes) is kept; geometry is overwritten by the CAD YAML.
3. Validate that every room in the CAD YAML has a matching entry in `config/house.yaml` metadata (or vice versa) and warn if a room is orphaned.
4. Expose the merged rooms through the existing `GET /api/project` response shape so that `HouseScene.buildFromCatalog()` requires no API changes.

Example merged room object returned to the app:

```json
{
  "id": "master_bedroom",
  "name": "主卧",
  "x": -5.35,
  "z": 2.0,
  "width": 4.5,
  "depth": 4.05,
  "height": 3.0,
  "area": 18.16,
  "furniture": [...]
}
```

### 4.6 Frontend integration

`HouseScene.buildFromCatalog()` already reads `projectData.house.rooms`. Therefore, the only frontend changes are:

1. Remove the hardcoded `rooms` and `platform` geometry from `shared/houseData.ts`.
2. Keep `hvacSchemes` in `shared/houseData.ts` because HVAC placement is still hand-authored.
3. Ensure that `HouseScene.createRoom()` uses the runtime `x, z, width, depth, height` values and that the origin matches the entrance door.
4. Verify the platform is rendered when `house.platform` is present.

No changes are needed to `HouseScene.raycastFromScreenCenter()`, `HoverTooltip`, or the info-panel logic.

### 4.7 Validation and diff

`scripts/parse_cad.py` must output a report similar to the following:

```text
CAD extraction report
cad/design/01_floor_plan/floor_plan_design_2026-07-05.dxf

Rooms found: 10
Missing project-id: 0
Geometry warnings: 0
Total interior area: 105.2 m²

Diff vs config/layout/cad-extracted.yaml:
  master_bedroom: x -5.30 → -5.35, width 4.45 → 4.50
  bedroom_nw: unchanged

Warnings: none
```

The script will also write a machine-readable summary to `scripts/logs/cad-extraction-report.json` (creating `scripts/logs/` if necessary) for optional CI inspection.

## 5. Behavior

After the change:

- The 3D house layout matches the CAD floor plan without hand-editing `shared/houseData.ts`.
- Adding or renaming a room in CAD and running `scripts/parse_cad.py` updates the 3D scene.
- If the designer violates the labeling convention, the extraction script reports the exact problem and exits with a non-zero status.
- The existing `/api/project` response continues to work; the 3D app does not need to change its data contract.
- The `config/house.yaml` accuracy warning can be relaxed or removed because dimensions are now sourced from CAD rather than estimated from area.

## 6. Verification

1. Run `python scripts/parse_cad.py` and confirm `config/layout/cad-extracted.yaml` is generated.
2. Inspect the extraction report for missing rooms or geometry warnings.
3. Start the server: `npm run dev:server` and query `GET /api/project`. Confirm room coordinates match the YAML.
4. Start the app: `npm run dev:app`. Confirm the 3D rooms align with the CAD floor plan.
5. Run backend tests: `npm run test:server`.
6. Run frontend tests: `npm run test --workspace=app`.
7. Run typecheck: `npm run typecheck`.

## 7. Non-Goals

- No changes to the first-person or orbit camera behavior.
- No changes to the hover tooltip or object selection logic.
- No changes to the rule engine or budget calculation.
- No support for non-rectangular rooms in the first version.
- No automatic two-way sync from the app back to CAD.

## 8. Phased Rollout

### Phase 1: DXF extraction script
- Add `scripts/parse_cad.py`.
- Generate `config/layout/cad-extracted.yaml`.
- Add extraction report and optional CI step.

### Phase 2: Server loading
- Update `server/project-catalog.ts` to load the CAD YAML.
- Merge CAD geometry with `config/house.yaml` metadata.
- Update server tests.

### Phase 3: Frontend wiring
- Remove hardcoded room/platform geometry from `shared/houseData.ts`.
- Keep `hvacSchemes` and verify platform rendering.
- Update frontend tests.

### Phase 4: Documentation and cleanup
- Document CAD conventions for the designer.
- Update `config/house.yaml` accuracy warning.
- Add extraction script usage to `scripts/README.md` and `README.md`.
- Merge the unique content from `config/layout/final.yaml` (`circulation`, `design_rationale`, `mep_strategy`, `pending_verification`) into `config/house.yaml`, then delete `config/layout/final.yaml`.
- Delete `cad/original/701_dimensions.csv` because CAD becomes the authoritative geometry source.

## 9. File Deletions

The following files become redundant once CAD is the source of truth and will be deleted as part of Phase 4:

| File | Reason |
|------|--------|
| `config/layout/final.yaml` | Its room/gift geometry is superseded by `config/layout/cad-extracted.yaml`; its unique design context (`circulation`, `design_rationale`, `mep_strategy`, `pending_verification`) is merged into `config/house.yaml` before deletion. |
| `cad/original/701_dimensions.csv` | Manual dimension fragments are replaced by the CAD floor plan. |

No other files are deleted. `config/house.yaml` remains the metadata source, and `shared/houseData.ts` is reduced but kept for `hvacSchemes`.
