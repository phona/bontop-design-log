# 3D 渲染玻璃幕墙 - 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 3D 场景中用半透明玻璃材质渲染玻璃幕墙，与普通墙体区分。

**Architecture:** CAD 解析阶段自动标记幕墙墙段（`curtain: true`），渲染阶段根据标记选择材质。数据驱动，渲染代码只读。

**Tech Stack:** Python (ezdxf, PyYAML), TypeScript (Three.js), pytest

## Global Constraints

- CAD 是权威数据源，配置只做微调
- `curtain` 为可选字段，缺失时视为普通墙体（向后兼容）
- 幕墙范围：西墙 (x≈-5.88)、北墙 (z≈5.39)、南墙 (z≈-4.32 除入户花园 x>3.5)
- 东墙 (x≈8.54) + 入户花园外围不是幕墙
- 玻璃材质：`MeshPhysicalMaterial`, color=0x88ccff, opacity=0.3, roughness=0.05, metalness=0.1, DoubleSide

---

### Task 1: 类型定义 — `WallSegment` 增加 `curtain` 字段

**Files:**
- Modify: `shared/types.ts:319-324`

**Interfaces:**
- Produces: `WallSegment` 接口增加可选 `curtain?: boolean` 字段

- [ ] **Step 1: 修改 `WallSegment` 接口**

```typescript
export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  curtain?: boolean;  // 可选，玻璃幕墙标记
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd /home/tao/projects/bontop-design-log && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "types: add optional curtain field to WallSegment"
```

---

### Task 2: 解析层 — `parse_cad.py` 增加幕墙标记逻辑

**Files:**
- Modify: `scripts/parse_cad.py` (add `mark_curtain_walls()` function, integrate into `extract_walls()`)
- Test: `scripts/parse_cad_test.py` (add new tests)

**Interfaces:**
- Consumes: `Wall` objects from `extract_walls()`
- Produces: `mark_curtain_walls(walls, tolerance=0.15)` function that returns walls with `curtain` field set

- [ ] **Step 1: 写测试 - 幕墙标记函数**

```python
def test_mark_curtain_walls_marks_exterior_walls():
    """Walls on west/north/south boundaries are marked as curtain walls,
    except south walls in the entry garden area (x > 3.5)."""
    from parse_cad import Wall, mark_curtain_walls

    walls = [
        Wall(x1=-5.88, z1=4.87, x2=-5.85, z2=4.93),   # west boundary → curtain
        Wall(x1=-5.00, z1=5.39, x2=-4.50, z2=5.39),   # north boundary → curtain
        Wall(x1=-0.50, z1=-4.32, x2=0.50, z2=-4.32),  # south boundary → curtain
        Wall(x1=4.00, z1=-4.32, x2=5.00, z2=-4.32),   # south but x>3.5 → NOT curtain
        Wall(x1=8.54, z1=4.45, x2=8.54, z2=4.21),     # east boundary → NOT curtain
        Wall(x1=0.00, z1=0.00, x2=1.00, z2=0.00),     # interior → NOT curtain
    ]
    result = mark_curtain_walls(walls)
    assert result[0].curtain is True   # west
    assert result[1].curtain is True   # north
    assert result[2].curtain is True   # south (x<3.5)
    assert result[3].curtain is False  # south (x>3.5, entry garden)
    assert result[4].curtain is False  # east
    assert result[5].curtain is False  # interior
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /home/tao/projects/bontop-design-log/scripts && python -m pytest parse_cad_test.py::test_mark_curtain_walls_marks_exterior_walls -v
```

Expected: FAIL (function not defined)

- [ ] **Step 3: 实现 `mark_curtain_walls()` 函数**

在 `scripts/parse_cad.py` 中添加（在 `extract_walls()` 之后）：

```python
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
    
    # Calculate building bounds
    all_x = [x for w in walls for x in (w.x1, w.x2)]
    all_z = [z for w in walls for z in (w.z1, w.z2)]
    min_x, max_x = min(all_x), max(all_x)
    min_z, max_z = min(all_z), max(all_z)
    
    for w in walls:
        # Check if wall is on boundary
        on_west = abs(w.x1 - min_x) < tolerance and abs(w.x2 - min_x) < tolerance
        on_north = abs(w.z1 - max_z) < tolerance and abs(w.z2 - max_z) < tolerance
        on_south = abs(w.z1 - min_z) < tolerance and abs(w.z2 - min_z) < tolerance
        
        if on_west or on_north:
            w.curtain = True
        elif on_south:
            # Exclude entry garden area (x > 3.5)
            mid_x = (w.x1 + w.x2) / 2
            if mid_x <= 3.5:
                w.curtain = True
            else:
                w.curtain = False
        else:
            w.curtain = False
    
    return walls
```

- [ ] **Step 4: 修改 `Wall` dataclass 增加 `curtain` 字段**

在 `scripts/parse_cad.py:51-56` 修改：

```python
@dataclass
class Wall:
    """A single wall segment in meters, origin-subtracted, in scene coords (x, z)."""
    x1: float
    z1: float
    x2: float
    z2: float
    curtain: bool = False  # 玻璃幕墙标记
```

- [ ] **Step 5: 集成到 `extract_walls()`**

在 `scripts/parse_cad.py:272` 之后调用：

```python
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
```

- [ ] **Step 6: 运行测试验证通过**

```bash
cd /home/tao/projects/bontop-design-log/scripts && python -m pytest parse_cad_test.py::test_mark_curtain_walls_marks_exterior_walls -v
```

Expected: PASS

- [ ] **Step 7: 运行所有测试确保无回归**

```bash
cd /home/tao/projects/bontop-design-log && python -m pytest scripts/parse_cad_test.py -v
```

- [ ] **Step 8: Commit**

```bash
git add scripts/parse_cad.py scripts/parse_cad_test.py
git commit -m "feat: add curtain wall marking logic to parse_cad.py"
```

---

### Task 3: 渲染层 — `HouseScene.ts` 支持玻璃材质

**Files:**
- Modify: `app/src/render/HouseScene.ts:259-287` (createWalls function)

**Interfaces:**
- Consumes: `WallSegment` with optional `curtain` field (from Task 1)
- Produces: `createWalls()` renders curtain walls with glass material

- [ ] **Step 1: 添加玻璃材质常量**

在 `app/src/render/HouseScene.ts` 顶部（`DEFAULT_PAINT` 之后）添加：

```typescript
const CURTAIN_WALL_COLOR = 0x88ccff;
const CURTAIN_WALL_OPACITY = 0.3;
```

- [ ] **Step 2: 修改 `createWalls()` 支持玻璃材质**

```typescript
private createWalls(walls: WallSegment[], height: number) {
  const wallMat = new THREE.MeshStandardMaterial({
    color: DEFAULT_PAINT,
    roughness: 0.85,
  });
  const curtainWallMat = new THREE.MeshPhysicalMaterial({
    color: CURTAIN_WALL_COLOR,
    transparent: true,
    opacity: CURTAIN_WALL_OPACITY,
    roughness: 0.05,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  
  for (let i = 0; i < walls.length; i++) {
    const { x1, z1, x2, z2, curtain } = walls[i];
    const cx = (x1 + x2) / 2;
    const cz = (z1 + z2) / 2;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.sqrt(dx * dx + dz * dz);
    const geo = new THREE.BoxGeometry(
      Math.max(length, WALL_THICKNESS),
      height,
      WALL_THICKNESS
    );
    const mat = curtain ? curtainWallMat.clone() : wallMat.clone();
    const wall = new THREE.Mesh(geo, mat);
    wall.position.set(cx, height / 2, cz);
    if (length > WALL_THICKNESS) {
      wall.rotation.y = Math.atan2(dz, dx);
    }
    wall.userData = { type: 'wall', objectId: `wall:seg:${i}`, curtain: !!curtain };
    wall.castShadow = !curtain;  // 玻璃不投射阴影
    wall.receiveShadow = true;
    this.scene.add(wall);
    this.wallMeshes.push(wall);
  }
}
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
cd /home/tao/projects/bontop-design-log && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat: render curtain walls with transparent glass material"
```

---

### Task 4: 验证 — 重新生成数据并检查效果

**Files:**
- Verify: `config/layout/cad-extracted.yaml` (regenerate and check)

**Interfaces:**
- Consumes: All previous tasks

- [ ] **Step 1: 重新运行 parse_cad.py**

```bash
cd /home/tao/projects/bontop-design-log && python scripts/parse_cad.py
```

- [ ] **Step 2: 检查幕墙标记**

```bash
cd /home/tao/projects/bontop-design-log && python -c "
import yaml
with open('config/layout/cad-extracted.yaml') as f:
    data = yaml.safe_load(f)

walls = data['walls']
curtain_count = sum(1 for w in walls if w.get('curtain'))
print(f'Curtain walls: {curtain_count} / {len(walls)}')

# Check specific areas
print()
print('=== West wall (should be curtain) ===')
for w in walls:
    if abs(w['x1'] - (-5.88)) < 0.1 and abs(w['x2'] - (-5.88)) < 0.1:
        print(f'  [{w.get(\"curtain\", False)}] ({w[\"x1\"]:.3f}, {w[\"z1\"]:.3f}) -> ({w[\"x2\"]:.3f}, {w[\"z2\"]:.3f})')

print()
print('=== East wall (should NOT be curtain) ===')
for w in walls:
    if abs(w['x1'] - 8.54) < 0.1 and abs(w['x2'] - 8.54) < 0.1:
        print(f'  [{w.get(\"curtain\", False)}] ({w[\"x1\"]:.3f}, {w[\"z1\"]:.3f}) -> ({w[\"x2\"]:.3f}, {w[\"z2\"]:.3f})')

print()
print('=== South wall entry garden area (x>3.5, should NOT be curtain) ===')
for w in walls:
    if abs(w['z1'] - (-4.32)) < 0.1 and abs(w['z2'] - (-4.32)) < 0.1:
        mid_x = (w['x1'] + w['x2']) / 2
        if mid_x > 3.5:
            print(f'  [{w.get(\"curtain\", False)}] ({w[\"x1\"]:.3f}, {w[\"z1\"]:.3f}) -> ({w[\"x2\"]:.3f}, {w[\"z2\"]:.3f})  mid_x={mid_x:.2f}')
"
```

Expected: 
- West wall segments: `curtain: true`
- East wall segments: `curtain: false` or missing
- South wall entry garden (x>3.5): `curtain: false`

- [ ] **Step 3: Commit 更新后的 cad-extracted.yaml**

```bash
git add config/layout/cad-extracted.yaml
git commit -m "chore: regenerate cad-extracted.yaml with curtain wall markers"
```

---

## 验证清单

- [ ] `WallSegment` 类型有可选 `curtain` 字段
- [ ] `parse_cad.py` 的 `mark_curtain_walls()` 正确标记西/北/南墙（除入户花园）
- [ ] 东墙和入户花园外围不标记为幕墙
- [ ] `HouseScene.ts` 的 `createWalls()` 根据 `curtain` 字段选择材质
- [ ] 玻璃幕墙显示为半透明浅蓝色（opacity 0.3）
- [ ] 普通墙体保持不透明灰白色
- [ ] 所有测试通过：`python -m pytest scripts/parse_cad_test.py -v`
- [ ] TypeScript 编译通过：`npx tsc --noEmit`
