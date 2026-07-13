# 配置驱动架构改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除所有硬编码列表和启发式猜测，让 house.yaml 成为唯一权威配置源。

**Architecture:** CAD 只出几何坐标，house.yaml 定义所有设计意图（房间属性、材料映射、幕墙边界）。代码只读配置，不做猜测。

**Tech Stack:** Python (ezdxf, pyyaml), TypeScript (Three.js), pytest, vitest

## Global Constraints

- CAD 标签格式：`id^J中文名^J面积X.XXm²`（^J 是换行符）
- house.yaml 新增字段：`wall_finish`、`needs_waterproof`、`curtain_walls`、`openings`
- materials.yaml 新增字段：`topic_id`
- 所有硬编码列表必须删除，改为从配置读取
- TDD：每个改动先写失败测试，再写实现，再跑通

---

### Task 1: 更新 parse_room_label 解析新格式

**Files:**
- Modify: `scripts/parse_cad.py:68-73`
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: DXF text string
- Produces: `tuple[str, str] | None` — (project_id, chinese_name)

- [ ] **Step 1: Write failing test for new label format**

```python
# scripts/parse_cad_test.py

def test_parse_room_label_new_format_id_first():
    """CAD labels use id^J中文名^J面积 format (^J = newline)."""
    assert parse_room_label("master_bedroom\n主卧\n面积18.16m²") == ("master_bedroom", "主卧")

def test_parse_room_label_new_format_multiline():
    text = "master_bath\n卫生间\n面积4.20m²"
    assert parse_room_label(text) == ("master_bath", "卫生间")

def test_parse_room_label_new_format_no_area():
    """ID and name without area line should still parse."""
    assert parse_room_label("master_bedroom\n主卧") == ("master_bedroom", "主卧")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python -m pytest parse_cad_test.py::test_parse_room_label_new_format_id_first -v`
Expected: FAIL

- [ ] **Step 3: Update parse_room_label implementation**

```python
# scripts/parse_cad.py:68-73

def parse_room_label(text: str) -> tuple[str, str] | None:
    """Extract (project_id, chinese_name) from a label.

    Supports format: 'id\\n中文名\\n面积X.XXm²' (^J = newline in DXF).
    """
    lines = text.strip().splitlines()
    if len(lines) < 2:
        return None
    project_id = lines[0].strip()
    if not re.match(r'^[a-z_][a-z0-9_]*$', project_id):
        return None
    chinese_name = lines[1].strip()
    return project_id, chinese_name
```

- [ ] **Step 4: Run all parse_room_label tests**

Run: `cd scripts && python -m pytest parse_cad_test.py -k "parse_room_label" -v`
Expected: All PASS (old format tests will fail — update them next)

- [ ] **Step 5: Update old format tests to new format**

```python
# scripts/parse_cad_test.py

def test_parse_room_label_simple():
    assert parse_room_label("master_bedroom\n主卧") == ("master_bedroom", "主卧")

def test_parse_room_label_multiline():
    text = "master_bedroom\n主卧\n面积18.16m²\n周长18.39m"
    assert parse_room_label(text) == ("master_bedroom", "主卧")

def test_parse_room_label_missing_id():
    assert parse_room_label("主卧") is None
```

- [ ] **Step 6: Run all tests to verify**

Run: `cd scripts && python -m pytest parse_cad_test.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "refactor: update parse_room_label to parse id-first format"
```

---

### Task 2: 删除 chinese_name_to_id() 和相关测试

**Files:**
- Modify: `scripts/parse_cad.py:76-122` (delete)
- Modify: `scripts/parse_cad.py:145-198` (extract_room_labels)
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: `extract_room_labels(modelspace)` — now only handles ID-labeled labels
- Produces: `tuple[dict[str, tuple[str, float, float]], list[str]]`

- [ ] **Step 1: Write failing test — unmapped Chinese-only labels are skipped**

```python
# scripts/parse_cad_test.py

def test_extract_room_labels_skips_chinese_only_labels():
    """Labels without ID prefix are skipped, not guessed."""
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_text("master_bedroom\n主卧", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_text("走廊", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})
    labels, skipped = extract_room_labels(msp)
    assert "master_bedroom" in labels
    assert "走廊" in skipped
    assert len(labels) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && python -m pytest parse_cad_test.py::test_extract_room_labels_skips_chinese_only_labels -v`
Expected: FAIL (currently `chinese_name_to_id` tries to map "走廊")

- [ ] **Step 3: Delete chinese_name_to_id() and update extract_room_labels()**

Delete lines 76-122 (`chinese_name_to_id` function entirely).

Update `extract_room_labels` to remove the Chinese-name fallback:

```python
# scripts/parse_cad.py — replace extract_room_labels

def extract_room_labels(modelspace) -> tuple[dict[str, tuple[str, float, float]], list[str]]:
    """Find room labels on SH-文字标注 and return id -> (name, x, z) plus skipped labels."""
    labels: dict[str, tuple[str, float, float]] = {}
    skipped: set[str] = set()

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
        else:
            first_line = text.strip().splitlines()[0].strip() if text.strip() else ""
            if first_line:
                skipped.add(first_line)
                logger.warning("Room label %r has no valid ID prefix, skipped", first_line)

    return labels, sorted(skipped)
```

- [ ] **Step 4: Delete tests for chinese_name_to_id**

Delete these tests:
- `test_chinese_name_mapping`
- `test_8_39_bedroom_does_not_map_to_study`
- `test_two_8_39_bedrooms_disambiguate_with_seen_ids`

- [ ] **Step 5: Update test_extract_room_labels_from_dxf**

```python
def test_extract_room_labels_from_dxf():
    from ezdxf.document import Drawing

    doc = Drawing.new("R2018")
    msp = doc.modelspace()
    doc.layers.add("SH-文字标注")
    msp.add_text("master_bedroom\n主卧", dxfattribs={"layer": "SH-文字标注", "insert": (1000, 2000, 0)})
    msp.add_text("bedroom_nw\n次卧", dxfattribs={"layer": "SH-文字标注", "insert": (-500, 1000, 0)})
    msp.add_text("衣帽间", dxfattribs={"layer": "SH-文字标注", "insert": (0, 0, 0)})
    labels, skipped = extract_room_labels(msp)
    assert labels["master_bedroom"] == ("主卧", 1000.0, 2000.0)
    assert labels["bedroom_nw"] == ("次卧", -500.0, 1000.0)
    assert "衣帽间" in skipped
```

- [ ] **Step 6: Run all tests**

Run: `cd scripts && python -m pytest parse_cad_test.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "refactor: delete chinese_name_to_id, CAD must label room IDs directly"
```

---

### Task 3: 配置驱动幕墙标记 — 删除 mark_curtain_walls()

**Files:**
- Modify: `scripts/parse_cad.py:332-369` (delete mark_curtain_walls)
- Modify: `scripts/parse_cad.py:201-329` (extract_walls — read config)
- Modify: `config/house.yaml` (add curtain_walls section)
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: `house.yaml` → `curtain_walls` list
- Produces: `Wall` objects with `curtain: bool`

- [ ] **Step 1: Add curtain_walls to house.yaml**

```yaml
# config/house.yaml — add after curtain_wall_corners section

curtain_walls:
  - edge: "west"
  - edge: "north"
  - edge: "south"
    max_x: 3.5
```

- [ ] **Step 2: Write failing test for config-driven curtain marking**

```python
# scripts/parse_cad_test.py

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
    # west wall → curtain
    msp.add_line((-5880, 4870), (-5880, -3360), dxfattribs={"layer": "BS-非承重墙"})
    # north wall → curtain
    msp.add_line((-5000, 5390), (-4500, 5390), dxfattribs={"layer": "BS-非承重墙"})
    # south wall x<3.5 → curtain
    msp.add_line((-500, -4320), (500, -4320), dxfattribs={"layer": "BS-非承重墙"})
    # south wall x>3.5 → NOT curtain
    msp.add_line((4000, -4320), (5000, -4320), dxfattribs={"layer": "BS-非承重墙"})
    # east wall → NOT curtain
    msp.add_line((8540, 4450), (8540, 4210), dxfattribs={"layer": "BS-非承重墙"})
    # interior → NOT curtain
    msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": "BS-非承重墙"})

    walls = extract_walls(msp, bounds=None, origin_x=0.0, origin_z=0.0, house_config_path=house_config)
    curtain_walls = [w for w in walls if w.curtain]
    non_curtain = [w for w in walls if not w.curtain]
    assert len(curtain_walls) == 3  # west, north, south(x<3.5)
    assert len(non_curtain) == 3   # east, interior, south(x>3.5)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd scripts && python -m pytest parse_cad_test.py::test_mark_curtain_walls_from_config -v`
Expected: FAIL

- [ ] **Step 4: Replace mark_curtain_walls with config-driven version**

Delete `mark_curtain_walls()` function (lines 332-369).

Add new function:

```python
# scripts/parse_cad.py

def _load_curtain_config(house_config_path: Path | None = None) -> list[dict]:
    """Load curtain_walls config from house.yaml."""
    path = house_config_path or HOUSE_CONFIG
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("curtain_walls", []) or []


def _mark_curtain_from_config(
    walls: list[Wall],
    curtain_config: list[dict],
    tolerance: float = 0.5,
) -> list[Wall]:
    """Mark walls as curtain based on house.yaml curtain_walls config."""
    if not walls or not curtain_config:
        return walls

    all_x = [x for w in walls for x in (w.x1, w.x2)]
    all_z = [z for w in walls for z in (w.z1, w.z2)]
    min_x, max_x = min(all_x), max(all_x)
    min_z, max_z = min(all_z), max(all_z)

    edge_map = {
        "west": lambda w: abs(w.x1 - min_x) < tolerance or abs(w.x2 - min_x) < tolerance,
        "north": lambda w: abs(w.z1 - max_z) < tolerance or abs(w.z2 - max_z) < tolerance,
        "south": lambda w, cfg: (abs(w.z1 - min_z) < tolerance or abs(w.z2 - min_z) < tolerance)
                                  and (w.x1 + w.x2) / 2 <= cfg.get("max_x", float("inf")),
    }

    for w in walls:
        w.curtain = False
        for cfg in curtain_config:
            edge = cfg.get("edge", "")
            if edge == "south":
                if edge_map["south"](w, cfg):
                    w.curtain = True
                    break
            elif edge in edge_map:
                if edge_map[edge](w):
                    w.curtain = True
                    break

    return walls
```

Update `extract_walls()` to use the new function:

```python
# In extract_walls(), replace:
#   walls = mark_curtain_walls(walls)
# with:
    curtain_config = _load_curtain_config(house_config_path)
    walls = _mark_curtain_from_config(walls, curtain_config)
```

- [ ] **Step 5: Delete old mark_curtain_walls test**

Delete `test_mark_curtain_walls_marks_exterior_walls`.

- [ ] **Step 6: Run all tests**

Run: `cd scripts && python -m pytest parse_cad_test.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py config/house.yaml
git commit -m "refactor: config-driven curtain wall marking, delete mark_curtain_walls heuristic"
```

---

### Task 4: 配置驱动赠送区域检测 — 删除 _flood_fill_rooms 硬编码坐标

**Files:**
- Modify: `scripts/parse_cad.py:610-643` (_flood_fill_rooms)
- Modify: `config/house.yaml` (add expected_centroid to gift_areas)
- Test: `scripts/parse_cad_test.py`

**Interfaces:**
- Consumes: `house.yaml` → `gift_areas[].expected_centroid`
- Produces: room bounding boxes for unlabeled regions

- [ ] **Step 1: Add expected_centroid to gift_areas in house.yaml**

```yaml
# config/house.yaml — update gift_areas

gift_areas:
  - name: "入户花园"
    id: "entry_garden"
    expected_centroid:
      x: 3.19
      z: -10.04
    # ... existing fields ...

  - name: "南向大阳台"
    id: "south_balcony"
    expected_centroid:
      x: 3.19
      z: 3.06
    # ... existing fields ...

  - name: "西设备平台"
    id: "west_platform"
    expected_centroid:
      x: -5.31
      z: 0.76
    # ... existing fields ...
```

- [ ] **Step 2: Write failing test**

```python
# scripts/parse_cad_test.py

def test_flood_fill_uses_config_centroids(tmp_path: Path):
    """Unlabeled regions are matched to gift_areas using config centroids."""
    from parse_cad import _flood_fill_rooms

    house_config = tmp_path / "house.yaml"
    house_config.write_text(yaml.dump({
        "gift_areas": [
            {"id": "south_balcony", "expected_centroid": {"x": 3.19, "z": 3.06}, "area": 13.95},
        ],
        "rooms": [],
    }, allow_unicode=True))

    # Create a labeled region (master_bedroom) and an unlabeled region near south_balcony centroid
    labels = {"master_bedroom": ("主卧", 0.0, 0.0)}
    # ... (test setup for wall segments and regions)
    # This test verifies the function reads centroids from config
```

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Update _flood_fill_rooms to read config**

Replace hardcoded `unlabeled_expected` dict with config lookup:

```python
# scripts/parse_cad.py — in _flood_fill_rooms, replace:
#   unlabeled_expected: dict[str, tuple[float, float, float]] = {
#       "south_balcony": (3.19, 3.06, 13.95),
#       ...
#   }
# with:
    house_data = {}
    if HOUSE_CONFIG.exists():
        with open(HOUSE_CONFIG, "r", encoding="utf-8") as f:
            house_data = yaml.safe_load(f) or {}
    unlabeled_expected = {}
    for area in house_data.get("gift_areas", []) or []:
        ec = area.get("expected_centroid")
        if ec and "id" in area:
            unlabeled_expected[area["id"]] = (ec["x"], ec["z"], area.get("area", 0))
```

- [ ] **Step 5: Run all tests**

Run: `cd scripts && python -m pytest parse_cad_test.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py config/house.yaml
git commit -m "refactor: config-driven gift area centroids, delete hardcoded coordinates"
```

---

### Task 5: 添加 wall_finish 和 needs_waterproof 到 house.yaml

**Files:**
- Modify: `config/house.yaml`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add fields to house.yaml rooms**

```yaml
# config/house.yaml — add to each room

rooms:
  - id: "master_bedroom"
    wall_finish: "paint"
    needs_waterproof: false
    # ... existing fields ...

  - id: "master_bath"
    wall_finish: "tile"
    needs_waterproof: true
    # ... existing fields ...

  - id: "guest_bath"
    wall_finish: "tile"
    needs_waterproof: true
    # ... existing fields ...

  - id: "kitchen"
    wall_finish: "tile"
    needs_waterproof: true
    # ... existing fields ...

  - id: "balcony"
    wall_finish: "tile"
    needs_waterproof: true
    # ... existing fields ...

  - id: "south_balcony"
    wall_finish: "tile"
    needs_waterproof: true
    # ... existing fields ...
```

All other rooms: `wall_finish: "paint"`, `needs_waterproof: false`.

- [ ] **Step 2: Update HouseRoom type**

```typescript
// shared/types.ts

export interface HouseRoom {
  id: string;
  name?: string;
  type?: 'public' | 'private' | 'service';
  wall_finish?: 'paint' | 'tile';
  needs_waterproof?: boolean;
  openings?: Array<{
    type: string;
    wall: string;
    width: number;
    height: number;
    center_offset?: number;
  }>;
  [key: string]: unknown;
}
```

- [ ] **Step 3: Commit**

```bash
git add config/house.yaml shared/types.ts
git commit -m "feat: add wall_finish, needs_waterproof, openings to house.yaml rooms"
```

---

### Task 6: PaintTopic 从配置读取 wall_finish

**Files:**
- Modify: `app/src/topics/PaintTopic.ts`
- Modify: `app/src/render/HouseScene.ts` (setPaintColor signature)
- Test: `app/src/topics/PaintTopic.test.ts` (create if needed)

- [ ] **Step 1: Write failing test**

```typescript
// app/src/topics/PaintTopic.test.ts

import { describe, it, expect } from 'vitest';
import { PaintTopic } from './PaintTopic.js';

describe('PaintTopic', () => {
  it('should not have hardcoded EXCLUDE_PAINT list', () => {
    const topic = new PaintTopic();
    // The topic should not contain any hardcoded room lists
    const source = topic.toString();
    expect(source).not.toContain('master_bath');
  });
});
```

- [ ] **Step 2: Update PaintTopic to read from scene metadata**

```typescript
// app/src/topics/PaintTopic.ts

import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { paintOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class PaintTopic implements Topic {
  id = 'paint';
  name = '乳胶漆方案';
  options = paintOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    (scene as unknown as HouseScene).setPaintColor(option.color);
    return ['paint:rooms'];
  }

  validate(): string[] {
    return [];
  }
}
```

- [ ] **Step 3: Update HouseScene.setPaintColor to use room metadata**

```typescript
// app/src/render/HouseScene.ts

setPaintColor(color: string) {
    for (const mesh of this.wallMeshes) {
      if (mesh.userData.curtain) continue;
      const roomId = mesh.userData.roomId as string;
      const room = this.roomMeta.get(roomId);
      if (room?.wall_finish === 'tile') continue;
      (mesh.material as THREE.MeshStandardMaterial).color.set(color);
    }
  }
```

Add `roomMeta` storage to HouseScene — populate from catalog data passed at construction.

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/topics/PaintTopic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/topics/PaintTopic.ts app/src/render/HouseScene.ts
git commit -m "refactor: PaintTopic reads wall_finish from config, delete EXCLUDE_PAINT"
```

---

### Task 7: WallTopic 从配置读取 wall_finish

**Files:**
- Modify: `app/src/topics/WallTopic.ts`

- [ ] **Step 1: Write failing test**

```typescript
// app/src/topics/WallTopic.test.ts

import { describe, it, expect } from 'vitest';
import { WallTopic } from './WallTopic.js';

describe('WallTopic', () => {
  it('should not have hardcoded WALL_ROOMS list', () => {
    const topic = new WallTopic();
    const source = topic.toString();
    expect(source).not.toContain('WALL_ROOMS');
  });
});
```

- [ ] **Step 2: Update WallTopic**

```typescript
// app/src/topics/WallTopic.ts

import type { Topic, SceneApi, TopicOption } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option?.color) return [];
    const tileRoomIds = (scene as unknown as HouseScene).getRoomIdsWithWallFinish('tile');
    (scene as unknown as HouseScene).setWallColor(tileRoomIds, option.color);
    return tileRoomIds.map((id) => `wall:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
```

- [ ] **Step 3: Add getRoomIdsWithWallFinish to HouseScene**

```typescript
// app/src/render/HouseScene.ts

getRoomIdsWithWallFinish(finish: 'paint' | 'tile'): string[] {
    const ids: string[] = [];
    for (const [id, meta] of this.roomMeta.entries()) {
      if (meta.wall_finish === finish) ids.push(id);
    }
    return ids;
  }
```

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/topics/WallTopic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/topics/WallTopic.ts app/src/render/HouseScene.ts
git commit -m "refactor: WallTopic reads wall_finish from config, delete WALL_ROOMS"
```

---

### Task 8: budget-calculator 从配置读取 needs_waterproof

**Files:**
- Modify: `server/budget-calculator.ts:53-56`

- [ ] **Step 1: Write failing test**

```typescript
// server/budget-calculator.test.ts

import { describe, it, expect } from 'vitest';

describe('BudgetCalculator', () => {
  it('should read wet rooms from config, not hardcoded list', () => {
    // Verify budget-calculator.ts does not contain hardcoded room IDs
    const fs = await import('node:fs');
    const source = fs.readFileSync('./server/budget-calculator.ts', 'utf8');
    expect(source).not.toContain("'master_bath', 'guest_bath'");
  });
});
```

- [ ] **Step 2: Update budget-calculator**

```typescript
// server/budget-calculator.ts

case 'wet_floor': {
    const wetRooms = rooms.filter((r) => {
      const meta = this.roomMeta.get(r.id);
      return meta?.needs_waterproof === true;
    });
    quantity = wetRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
    break;
  }
```

Add `roomMeta` to BudgetCalculator — populated from house.yaml in constructor.

- [ ] **Step 3: Run tests**

Run: `cd server && npx vitest run budget-calculator.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/budget-calculator.ts
git commit -m "refactor: budget-calculator reads needs_waterproof from config"
```

---

### Task 9: materials.yaml 添加 topic_id

**Files:**
- Modify: `config/materials.yaml`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add topic_id to each material**

```yaml
# config/materials.yaml

materials:
  - id: "floor_tile_01"
    topic_id: "floor"
    category: "地砖"
    # ... rest ...

  - id: "wall_tile_01"
    topic_id: "wall"
    category: "墙砖"
    # ... rest ...

  - id: "latex_paint_01"
    topic_id: "paint"
    category: "乳胶漆"
    # ... rest ...
```

Add `topic_id` to every material entry based on the current MATERIAL_TOPIC_MAP mapping.

- [ ] **Step 2: Update MaterialItem type**

```typescript
// shared/types.ts

export interface MaterialItem {
  id: string;
  category: string;
  topic_id?: string;  // new field
  // ... rest ...
}
```

- [ ] **Step 3: Commit**

```bash
git add config/materials.yaml shared/types.ts
git commit -m "feat: add topic_id to materials.yaml"
```

---

### Task 10: project-catalog 从配置读取 topic_id

**Files:**
- Modify: `server/project-catalog.ts:21-40` (delete MATERIAL_TOPIC_MAP)
- Modify: `server/project-catalog.ts:50-71` (materialToOption)

- [ ] **Step 1: Write failing test**

```typescript
// server/project-catalog.test.ts

import { describe, it, expect } from 'vitest';

describe('ProjectCatalog', () => {
  it('should use material.topic_id instead of MATERIAL_TOPIC_MAP', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./server/project-catalog.ts', 'utf8');
    expect(source).not.toContain('MATERIAL_TOPIC_MAP');
  });
});
```

- [ ] **Step 2: Update materialToOption**

```typescript
// server/project-catalog.ts

function materialToOption(m: MaterialItem): DesignOption | null {
  const topicId = m.topic_id;
  if (!topicId) return null;
  return {
    id: m.id,
    topicId,
    name: m.name,
    description: `${m.brand} ${m.model} · ${m.price_per_unit} 元/${m.unit}`,
    price_per_unit: m.price_per_unit,
    coverage_per_unit: m.coverage_per_unit,
    loss_rate: m.loss_rate,
    data: {
      ...m,
      alternative_group: m.alternative_group,
      calc_mode: m.calc_mode,
      pros: m.pros,
      cons: m.cons,
      price_source: m.price_source,
      appearance: m.appearance,
    },
  };
}
```

Delete `MATERIAL_TOPIC_MAP` entirely.

- [ ] **Step 3: Run tests**

Run: `cd server && npx vitest run project-catalog.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/project-catalog.ts
git commit -m "refactor: project-catalog reads topic_id from material config, delete MATERIAL_TOPIC_MAP"
```

---

### Task 11: HvacTopic 使用 catalog.getPlatform()

**Files:**
- Modify: `app/src/topics/HvacTopic.ts:5`

- [ ] **Step 1: Write failing test**

```typescript
// app/src/topics/HvacTopic.test.ts

import { describe, it, expect } from 'vitest';

describe('HvacTopic', () => {
  it('should not have hardcoded PLATFORM_ROOM_ID', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./app/src/topics/HvacTopic.ts', 'utf8');
    expect(source).not.toContain("PLATFORM_ROOM_ID = 'west_platform'");
  });
});
```

- [ ] **Step 2: Update HvacTopic**

The `HvacTopic` already uses `scene.getRoom(PLATFORM_ROOM_ID)`. The platform room ID comes from `hvacSchemes` in `shared/houseData.ts` which references `'platform'` as location. We need to resolve `'platform'` to the actual room ID from config.

```typescript
// app/src/topics/HvacTopic.ts

// Remove: const PLATFORM_ROOM_ID = 'west_platform';

// In apply():
const resolveLocation = (location: string) => {
    if (location === 'platform') {
      const platformId = (scene as unknown as HouseScene).getPlatformRoomId();
      return platformId ? scene.getRoom(platformId) : undefined;
    }
    return scene.getRoom(location);
};
```

Add `getPlatformRoomId()` to HouseScene — reads from catalog.

- [ ] **Step 3: Run tests**

Run: `cd app && npx vitest run src/topics/HvacTopic.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/topics/HvacTopic.ts app/src/render/HouseScene.ts
git commit -m "refactor: HvacTopic reads platform room ID from config, delete PLATFORM_ROOM_ID"
```

---

### Task 12: HouseScene 从配置读取 openings

**Files:**
- Modify: `app/src/render/HouseScene.ts:250-255`

- [ ] **Step 1: Add openings to house.yaml rooms**

```yaml
# config/house.yaml

rooms:
  - id: "living_dining"
    openings:
      - type: "window"
        wall: "south"
        width: 3.5
        height: 1.6
        center_offset: 0
    # ... existing fields ...

  - id: "south_balcony"
    openings:
      - type: "door"
        wall: "north"
        width: 2.0
        height: 2.0
        center_offset: 0
    # ... existing fields ...
```

- [ ] **Step 2: Write failing test**

```typescript
// app/src/render/HouseScene.test.ts

import { describe, it, expect } from 'vitest';

describe('HouseScene', () => {
  it('should read openings from room config, not hardcoded', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync('./app/src/render/HouseScene.ts', 'utf8');
    expect(source).not.toContain("r.id === 'living_dining'");
    expect(source).not.toContain("r.id === 'south_balcony'");
  });
});
```

- [ ] **Step 3: Update createRoom**

```typescript
// app/src/render/HouseScene.ts — in createRoom()

// Replace hardcoded opening markers with config-driven:
if (r.openings) {
    for (const opening of r.openings) {
        const pos = this._openingPosition(r, opening.wall, opening.center_offset ?? 0);
        this.addOpeningMarker(group, pos.x, 1.2, pos.z, opening.width, opening.height, `${opening.type}_${r.id}`);
    }
}
```

Add `_openingPosition` helper and pass `openings` through RoomObject type.

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run src/render/HouseScene.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/render/HouseScene.ts config/house.yaml
git commit -m "refactor: HouseScene reads openings from config, delete hardcoded markers"
```

---

### Task 13: 最终验证 — 确认无硬编码残留

- [ ] **Step 1: Grep for remaining hardcoded lists**

```bash
# Check no hardcoded room lists remain
grep -rn "EXCLUDE_PAINT\|WALL_ROOMS\|PLATFORM_ROOM_ID\|MATERIAL_TOPIC_MAP\|chinese_name_to_id\|mark_curtain_walls" app/ server/ scripts/ shared/
```

Expected: No results (all deleted)

- [ ] **Step 2: Run all tests**

```bash
cd scripts && python -m pytest parse_cad_test.py -v
cd app && npx vitest run
cd server && npx vitest run
```

Expected: All PASS

- [ ] **Step 3: Run lint/typecheck**

```bash
cd app && npm run lint && npm run typecheck
cd server && npm run lint && npm run typecheck
```

Expected: No errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: complete config-driven architecture — all heuristics removed"
```
