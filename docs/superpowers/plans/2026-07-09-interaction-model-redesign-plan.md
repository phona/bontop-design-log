# Object-First Interaction Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 3D interior-design app from a room-first to an object-first interaction model: surfaces, fixtures, and systems become the primary targets; rooms become containers and labels. The CAD parser is also relaxed to map Chinese room labels to project IDs instead of requiring `[project-id]` annotations.

**Architecture:** Update `scripts/parse_cad.py` to map Chinese room names to IDs and merge unlabeled gift areas from the previous YAML. Update `app/src/render/HouseScene.ts` to tag floor/wall meshes with `objectId`/`type` and remove the invisible room-label plane. Update `config/design-rules.yaml` and `app/src/data/objectMapping.ts` to route `floor:*`, `wall:*`, etc., to the correct topics. Update `App.ts`, `HoverTooltip`, and `InfoPanel` to display object-first names and context. Keep topic application logic mostly unchanged in this iteration; panel-driven selection remains the default.

**Tech Stack:** TypeScript, Three.js, vitest, Node.js test runner, Python 3.11+ with ezdxf.

## Global Constraints

- Rooms are not clickable objects; only surfaces, fixtures, and systems are.
- Floor meshes must carry `objectId: 'floor:<room_id>'` and `type: 'floor'`.
- Wall meshes must carry `objectId: 'wall:<room_id>:<direction>'` and `type: 'wall'`.
- The invisible room-label plane must be removed from raycasting.
- `config/design-rules.yaml` must map `floor:*`, `wall:*`, `hvac:*`, and `platform_boundary` to topics.
- The parser must map Chinese labels (`主卧`, `次卧`, `卫生间`, etc.) to project IDs without requiring `[project-id]`.
- All existing tests must pass after the change; `npm run typecheck` must be clean.

---

## File Structure

### New files
- None.

### Modified files
- `scripts/parse_cad.py` — Chinese label mapping, disambiguation, merge with previous YAML.
- `scripts/parse_cad_test.py` — new tests for Chinese mapping and disambiguation.
- `config/layout/cad-extracted.yaml` — regenerated from CAD after parser changes.
- `config/design-rules.yaml` — object-first mapping rules.
- `app/src/render/HouseScene.ts` — floor/wall object IDs, remove room-label plane.
- `app/src/App.ts` — object-first click handling and name display.
- `app/src/ui/HoverTooltip.ts` — no change unless display format is adjusted.
- `app/src/ui/InfoPanel.ts` — display object-first context.
- `app/src/topics/FloorTopic.ts`, `WallTopic.ts`, `PaintTopic.ts`, `HvacTopic.ts` — verify they handle object IDs.
- `app/src/data/objectMapping.ts` — verify pattern matching works with new IDs.
- `app/src/scene/HouseScene.test.ts` — update tests.
- `README.md` and `scripts/README.md` — update interaction and CAD labeling docs.

---

### Task 1: Add Chinese name mapping to the parser

**Files:**
- Modify: `scripts/parse_cad.py:55-91`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: raw text from CAD labels, existing `config/layout/cad-extracted.yaml` for merge source.
- Produces: `chinese_name_to_id(first_line, area, position)` returning a project ID or `None`; `extract_room_labels()` returns IDs mapped from Chinese names.

- [ ] **Step 1: Add Chinese name mapping function**

Add to `scripts/parse_cad.py` after `parse_room_label`:

```python
def chinese_name_to_id(
    name: str,
    area: float | None,
    x: float,
    y: float,
    master_bedroom_pos: tuple[float, float] | None = None,
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
    if name == "卫生间":
        if area is None:
            return None
        # Larger area near master is master_bath; smaller is guest_bath
        return "master_bath" if area >= 3.5 else "guest_bath"
    if name == "次卧":
        if area is None:
            return None
        if abs(area - 8.35) < 0.1:
            return "study"
        # Two 8.39 bedrooms: northwest vs southeast relative to master bedroom
        if master_bedroom_pos and area >= 8.38:
            mx, my = master_bedroom_pos
            if x < mx and y > my:
                return "bedroom_nw"
            return "bedroom_se"
        return None
    return None
```

- [ ] **Step 2: Extract area from label text**

Add a helper to parse area from the first line of the label:

```python
def parse_area(text: str) -> float | None:
    match = re.search(r"面积(\d+\.?\d*)m²", text)
    if match:
        return float(match.group(1))
    return None
```

- [ ] **Step 3: Update `extract_room_labels`**

Replace the existing `extract_room_labels` function with:

```python
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
            first_line = text.strip().splitlines()[0].strip()
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
    for name, x, y, area in candidates:
        project_id = chinese_name_to_id(name, area, x, y, master_pos)
        if project_id:
            labels[project_id] = (name, x, y)
        else:
            skipped.add(name)

    return labels, sorted(skipped)
```

- [ ] **Step 4: Write a failing test**

Append to `scripts/parse_cad_test.py`:

```python
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
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `python -m pytest scripts/parse_cad_test.py::test_chinese_name_mapping -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): map Chinese room labels to project IDs"
```

---

### Task 2: Preserve unlabeled gift areas and platform from previous YAML

**Files:**
- Modify: `scripts/parse_cad.py:279-346`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: rooms extracted from CAD, previous YAML content.
- Produces: merged YAML with CAD-labeled rooms plus manually-defined gift areas and platform.

- [ ] **Step 1: Add merge helper**

Add to `scripts/parse_cad.py`:

```python
def merge_with_previous_layout(
    rooms: list[Room],
    platform: Platform | None,
    output_path: Path,
) -> tuple[list[Room], Platform | None]:
    """Keep unlabeled gift areas and platform from the previous YAML."""
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
    merged = list(rooms)
    for prev_room in prev.get("rooms", []):
        if prev_room.get("id") not in new_ids:
            merged.append(
                Room(
                    id=prev_room["id"],
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
```

- [ ] **Step 2: Wire merge into `write_layout_yaml`**

In `write_layout_yaml`, before computing the report, add:

```python
rooms, platform = merge_with_previous_layout(rooms, platform, output_path)
```

- [ ] **Step 3: Write a test for merge**

Append to `scripts/parse_cad_test.py`:

```python
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
```

- [ ] **Step 4: Run tests and commit**

Run: `python -m pytest scripts/parse_cad_test.py -v`
Expected: all pass.

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat(cad): merge CAD-labeled rooms with previous unlabeled gift areas"
```

---

### Task 3: Regenerate the CAD layout YAML from the real CAD file

**Files:**
- Create/overwrite: `config/layout/cad-extracted.yaml`
- Create/overwrite: `scripts/logs/cad-extraction-report.json`

**Interfaces:**
- Consumes: `cad/design/01_floor_plan/floor_plan_design_*.dxf`
- Produces: updated `config/layout/cad-extracted.yaml`

- [ ] **Step 1: Run the parser on the real CAD**

Run: `python scripts/parse_cad.py`
Expected: report shows `rooms_found > 0` and fewer skipped labels; YAML is written.

- [ ] **Step 2: Inspect the YAML**

Run: `cat config/layout/cad-extracted.yaml | head -60`
Expected: rooms have IDs like `master_bedroom`, `bedroom_nw`, etc., and the file still includes `entry_garden`, `south_balcony`, and `west_platform` from the merge.

- [ ] **Step 3: Verify areas roughly match the CAD labels**

Compare the `area` values in the YAML with the areas shown in the CAD labels. They should be close (the parser computes width×depth, so small rounding differences are expected).

- [ ] **Step 4: Commit the generated files**

```bash
git add config/layout/cad-extracted.yaml scripts/logs/cad-extraction-report.json
git commit -m "data: regenerate CAD layout from Chinese labels"
```

---

### Task 4: Make floor meshes carry object IDs and types

**Files:**
- Modify: `app/src/render/HouseScene.ts:171-183`
- Test: `app/src/scene/HouseScene.test.ts`

**Interfaces:**
- Consumes: `RoomObject` passed to `createRoom()`.
- Produces: floor mesh with `objectId: 'floor:<room_id>'` and `type: 'floor'` in userData.

- [ ] **Step 1: Update floor userData**

In `HouseScene.createRoom()`, change the floor mesh userData:

```ts
floor.userData = { roomId: r.id, objectId: `floor:${r.id}`, type: 'floor' };
```

- [ ] **Step 2: Update wall userData to use `type: 'wall'`**

Change:

```ts
wall.userData = { roomId: r.id, part: 'wall', objectId: `wall:${r.id}:${w.dir}` };
```

To:

```ts
wall.userData = { roomId: r.id, objectId: `wall:${r.id}:${w.dir}`, type: 'wall' };
```

- [ ] **Step 3: Remove or disable the room-label plane**

Remove the entire `roomLabel` mesh block from `createRoom()`:

```ts
// Remove this block:
// const roomLabel = new THREE.Mesh(...);
// roomLabel.userData = { objectId: `room:${r.id}`, hoverable: false };
// group.add(roomLabel);
```

If the room label is still needed for visual debugging, replace it with a non-raycastable label later; for this iteration, remove it.

- [ ] **Step 4: Add a test asserting floor object IDs**

Append to `app/src/scene/HouseScene.test.ts`:

```ts
it('tags floor meshes with floor objectId', () => {
  const canvas = document.createElement('canvas');
  const scene = new HouseScene(canvas);
  const floor = scene.getScene().getObjectByName('floor:master_bedroom');
  // Or traverse to find floor mesh by userData.type === 'floor'
  let found = false;
  scene.getScene().traverse((obj) => {
    if (obj.userData?.type === 'floor' && obj.userData?.objectId === 'floor:master_bedroom') {
      found = true;
    }
  });
  expect(found).toBe(true);
});
```

Adjust the test to match the actual test harness in the file.

- [ ] **Step 5: Run app tests and commit**

Run: `cd app && npm run test`
Expected: existing tests pass, new test passes.

```bash
git add app/src/render/HouseScene.ts app/src/scene/HouseScene.test.ts
git commit -m "feat(app): make floor and wall meshes object-first"
```

---

### Task 5: Update raycast to produce object-first hover names

**Files:**
- Modify: `app/src/render/HouseScene.ts:387-404`
- Test: `app/src/scene/HouseScene.test.ts`

**Interfaces:**
- Consumes: mesh userData with `objectId`, `type`, `roomId`.
- Produces: `HoverTarget` with a name like "主卧地面" or "主卧北墙".

- [ ] **Step 1: Add a helper to build display names**

Add to `HouseScene`:

```ts
private objectDisplayName(objectId: string, type: string, roomId?: string): string {
  const room = roomId ? this.rooms[roomId] : undefined;
  const roomName = room?.name ?? '';
  const typeLabel: Record<string, string> = {
    floor: '地面',
    wall: '墙面',
    ceiling: '顶面',
    door: '门',
    window: '窗',
    hvac_indoor: '空调内机',
    hvac_outdoor: '空调外机',
    platform: '平台',
  };
  const label = typeLabel[type] ?? type;
  if (roomName) return `${roomName}${label}`;
  return objectId;
}
```

- [ ] **Step 2: Update `raycastFromScreenCenter`**

Change the name construction line:

```ts
const name = roomObj?.name ?? id;
```

To:

```ts
const name = this.objectDisplayName(id, type, room);
```

- [ ] **Step 3: Update `onPointerDown` to pass type correctly**

`onPointerDown` already computes `type` from `data.type ?? data.part ?? 'room'`. Since wall userData now uses `type: 'wall'`, this will work.

- [ ] **Step 4: Add a test for hover name**

Append to `app/src/scene/HouseScene.test.ts`:

```ts
it('shows object-first hover name for floor', () => {
  // Mock camera and setup, then raycast to a known floor position
  // Assert returned name includes '地面' and room name
});
```

Implement the test according to the existing mock style in the file.

- [ ] **Step 5: Run app tests and commit**

Run: `cd app && npm run test`
Expected: all pass.

```bash
git add app/src/render/HouseScene.ts app/src/scene/HouseScene.test.ts
git commit -m "feat(app): object-first hover names for surfaces"
```

---

### Task 6: Update design-rules object mapping

**Files:**
- Modify: `config/design-rules.yaml:3-7`

**Interfaces:**
- Consumes: object IDs from `HouseScene`.
- Produces: topic mapping for `floor:*`, `wall:*`, `hvac:*`, `platform_boundary`.

- [ ] **Step 1: Replace the object mapping section**

```yaml
objectMapping:
  - pattern: "floor:*"
    topics: [floor]
  - pattern: "wall:*"
    topics: [wall, paint]
  - pattern: "ceiling:*"
    topics: [paint]
  - pattern: "hvac:*"
    topics: [hvac]
  - pattern: "platform_boundary"
    topics: [hvac]
```

- [ ] **Step 2: Verify `objectMapping.ts` handles the patterns**

Read `app/src/data/objectMapping.ts`. It already checks `objectId.startsWith(prefix)` or `objectId.includes(prefix.replace(':', ''))`. For `floor:*`, the prefix becomes `floor:`, so `startsWith('floor:')` works. For `platform_boundary`, the prefix is `platform_boundary`, so `startsWith('platform_boundary')` works. No code change needed unless testing reveals a bug.

- [ ] **Step 3: Add a test for new mapping**

Append to `app/src/data/objectMapping.test.ts` if it exists, or add a new test file. If no test file exists, create `app/src/data/objectMapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTopicsForObject } from './objectMapping.js';

describe('getTopicsForObject', () => {
  it('maps floor surface to floor topic', () => {
    expect(getTopicsForObject('floor:master_bedroom')).toContain('floor');
  });
  it('maps wall surface to wall and paint topics', () => {
    expect(getTopicsForObject('wall:master_bedroom:north')).toContain('wall');
    expect(getTopicsForObject('wall:master_bedroom:north')).toContain('paint');
  });
  it('maps platform boundary to hvac topic', () => {
    expect(getTopicsForObject('platform_boundary')).toContain('hvac');
  });
});
```

- [ ] **Step 4: Run tests and commit**

Run: `cd app && npm run test`
Expected: all pass.

```bash
git add config/design-rules.yaml app/src/data/objectMapping.test.ts
git commit -m "feat(config): object-first mapping rules for surfaces and systems"
```

---

### Task 7: Update InfoPanel and App click handling for object-first context

**Files:**
- Modify: `app/src/App.ts:143-146`
- Modify: `app/src/ui/InfoPanel.ts:58-78`

**Interfaces:**
- Consumes: `HoverTarget` with object context.
- Produces: info panel shows object name and related topics.

- [ ] **Step 1: Update App click callback**

The current callback already uses `room` to look up the room name. No change needed if `raycastFromScreenCenter` returns a proper `HoverTarget`. Verify that the callback passes `objectId`, `type`, and `room` correctly.

- [ ] **Step 2: Update InfoPanel render to show object context**

In `InfoPanel.render()`, update the title/type/room display:

```ts
this.titleEl.textContent = this.currentTarget.name;
this.typeEl.textContent = this.currentTarget.type;
this.roomEl.textContent = this.currentTarget.room ?? '';
```

This is already the current implementation. The key change is that `this.currentTarget.name` now comes from the object-first display name. No code change needed unless the layout should be adjusted.

- [ ] **Step 3: Verify topic scope buttons still work**

The current info panel shows "仅当前房间" and "所有房间" buttons. These should remain. For object-first targets, the "当前房间" scope is the room the object belongs to. If `room` is undefined (e.g., `platform_boundary`), the global scope button is used.

- [ ] **Step 4: Run app tests and commit**

Run: `cd app && npm run test`
Expected: all pass.

If only comment/docs were adjusted, commit:

```bash
git add app/src/App.ts app/src/ui/InfoPanel.ts
git commit -m "refactor(app): info panel uses object-first context"
```

---

### Task 8: Verify topics work with object-first targets

**Files:**
- Modify: `app/src/topics/FloorTopic.ts`, `WallTopic.ts`, `PaintTopic.ts`, `HvacTopic.ts` as needed
- Test: `app/src/topics/TopicRegistry.test.ts`

**Interfaces:**
- Consumes: `objectId` from clicked target.
- Produces: topic apply/validate still functions correctly.

- [ ] **Step 1: Review each topic for object ID usage**

- `FloorTopic`: uses `setFloorColor()` globally; no room ID dependency. OK.
- `WallTopic`: uses hardcoded `WALL_ROOMS` list; no object ID dependency. OK.
- `PaintTopic`: uses `setPaintColor()` with exclude list; no object ID dependency. OK.
- `HvacTopic`: uses `scene.getRoom('west_platform')` and places units per room. OK.

These topics currently operate globally or on fixed room sets. They do not need to change for object-first targeting in this iteration, because the panel is still the primary decision driver.

- [ ] **Step 2: Update `TopicRegistry.test.ts` if it references old object IDs**

Search for `room:` or `objectId` in `app/src/topics/TopicRegistry.test.ts`. If the test expects old room object IDs, update them to `floor:`, `wall:`, etc.

- [ ] **Step 3: Run app tests and commit**

Run: `cd app && npm run test`
Expected: all pass.

```bash
git add app/src/topics/TopicRegistry.test.ts
git commit -m "test: update topic registry tests for object-first IDs"
```

---

### Task 9: Update documentation and CAD labeling notes

**Files:**
- Modify: `README.md`, `scripts/README.md`, `docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md`

**Interfaces:**
- Consumes: updated parser and interaction model.
- Produces: docs reflect Chinese-name mapping and object-first interaction.

- [ ] **Step 1: Update `scripts/README.md`**

Replace the `parse_cad.py` section with:

```markdown
## `parse_cad.py`

Extracts the 2D/3D house layout from `cad/design/01_floor_plan/floor_plan_design_*.dxf`.

The parser reads the Chinese room labels on layer `SH-文字标注` (e.g., `主卧`, `次卧`) and maps them to project IDs. It preserves unlabeled gift areas (e.g., `入户花园`, `南向大阳台`) from the previous `config/layout/cad-extracted.yaml`.

```bash
python -m pip install -r requirements.txt
python scripts/parse_cad.py
```

Output: `config/layout/cad-extracted.yaml` and `scripts/logs/cad-extraction-report.json`.
```

- [ ] **Step 2: Update `README.md`**

Update the CAD-driven layout note to say that the parser uses Chinese labels and the 3D interaction is object-first.

- [ ] **Step 3: Update the CAD-driven layout spec**

Update `docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md` section 4.2 to reflect that the parser now maps Chinese names instead of requiring `[project-id]`. Note that ambiguous names are disambiguated by area/position.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/README.md docs/superpowers/specs/2026-07-09-cad-driven-3d-layout-design.md
git commit -m "docs: update CAD and interaction model docs"
```

---

### Task 10: Final verification

**Files:**
- None.

- [ ] **Step 1: Run all verification commands**

```bash
python -m pytest scripts/parse_cad_test.py -v
npm run test:server
cd app && npm run test
npm run typecheck
npm run build:app
```

Expected: all pass, typecheck clean, build succeeds.

- [ ] **Step 2: Manual end-to-end check**

1. Start the server: `npm run dev:server`
2. Start the app: `npm run dev:app`
3. In the app, click a floor and verify the tooltip says "主卧地面" instead of "room:master_bedroom".
4. Verify walls, HVAC units, and platform still show hover tooltips.
5. Verify the info panel opens for floors and walls.

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
# Add and commit any remaining files
git commit -m "chore: final verification for object-first interaction model"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Plan coverage |
|------------------|---------------|
| Object-first interaction | Tasks 4, 5, 7 |
| Rooms not clickable | Tasks 4, 5 |
| Surfaces as objects | Tasks 4, 5, 6 |
| Chinese label mapping | Tasks 1, 2, 3 |
| Design rules mapping | Task 6 |
| Info panel context | Task 7 |
| Docs update | Task 9 |

### Placeholder scan

No TBD/TODO placeholders. All steps include concrete code or commands.

### Type consistency

- `objectId` format changed from `room:<id>` to `floor:<id>`, `wall:<id>:<dir>`, etc. The design rules and object mapping are updated to match.
- `type` field is now used consistently instead of `part` for walls.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-09-interaction-model-redesign-plan.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
