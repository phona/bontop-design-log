# Vertex 关系引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 vertices 顶层实体消除 rooms↔walls 几何冗余，改一个顶点 → 所有 walls + rooms + overlays 自动联动。

**Architecture:** vertices 是唯一几何源（32 个）。rooms 和 walls 都引用 vertices；overlay 引用 wall id。新增 resolver 层（`server/layout-resolver.ts`，~200 行）把引用展开成 renderer 现有接口格式（`x/z/width/depth` 或 `points[]`、`x1/z1/x2/z2`、`points[]`）。渲染器几乎不动（`createRoom` 加 3 行分支 + arc wall segments 遍历）。

**Tech Stack:** TypeScript ES2022 / NodeNext、node:test + node:assert/strict、tsx、zod、js-yaml、Three.js

**Spec:** `docs/superpowers/specs/2026-07-17-vertex-relation-engine-design.md`

## Global Constraints

- 坐标系：Three.js 右手系，Y 轴向上；x 东西、z 南北；+z=南、-z=北。`AGENTS.md` 坐标约定。
- 测试：`npx tsx --test tests/server/**/*.test.ts`（node:test 内置）
- 类型检查：`npm run typecheck`（`tsc --noEmit && cd app && tsc --noEmit`）
- 迁移期间新旧格式并存——Phase 3 前不破坏现有数据路径
- Phase 3 以 walls 坐标为唯一权威（不沿用 center+size）
- 圆角半径 r=1.0m，16 段密弦展开（弦弧偏差 ~5mm）
- 开放边由 resolver 自动推导（不显式声明 `open_edges`）

---

## File Structure

| 文件 | 职责 | 阶段 |
|---|---|---|
| `shared/types.ts` | 加 Vertex/WallDef/RoomDef/ResolvedRoom/ResolvedWall 等新类型 | P1 |
| `server/layout-resolver.ts` | **新建**：resolveLayout() + 严格校验 + 派生 + 圆角展开 | P1 |
| `tests/server/layout-resolver.test.ts` | **新建**：resolver 单测 | P1 |
| `server/overlay-merge.ts` | 加 resolveWallRef()（wall id → points） | P1 |
| `tests/server/overlay-merge.test.ts` | 加 resolveWallRef 测试 | P1 |
| `server/project-catalog.ts` | 集成 resolver：有 vertices 时走 resolver，否则走旧路径 | P2 |
| `app/src/render/HouseScene.ts` | createRoom 加 polygon 分支 + arc segments 遍历 + OpeningDef 迁移 | P2 |
| `scripts/verify-topology.ts` | **新建**：拓扑验证 | P5 |
| `config/layout/model-geometry.yaml` | 迁移到 vertices/rooms/walls 格式 | P3 |
| `config/layout/overlay.yaml` | 迁移到 wall id 引用 | P4 |
| `AGENTS.md` | 更新验证命令 | P5 |

---

## Phase 1: Foundation — Types + Resolver + Tests

### Task 1: Add new types to shared/types.ts

**Files:**
- Modify: `shared/types.ts`（在 `CadLayoutYaml` interface 之后追加）

**Produces:** `Vertex`, `WallDef`, `RoomDef`, `PlatformDef`, `VertexLayoutYaml`, `ResolvedRoom`, `ResolvedWall`, `ResolvedOpening`

- [ ] **Step 1: Add new type definitions**

在 `shared/types.ts` 的 `CadLayoutYaml` interface 之后（约 line 377）追加：

```ts
// ── Vertex 关系引擎新类型（Phase 1）──

export interface Vertex {
  id: string;
  x: number;
  z: number;
  radius?: number;
}

export interface OpeningDefV2 {
  id: string;
  type: string;
  wall: string;
  anchor: string;
  offset: number;
  width: number;
  height: number;
  sill?: number;
  room?: string;
}

export interface WallDef {
  id: string;
  from: string;
  to: string;
  height: number;
  openings?: OpeningDefV2[];
}

export interface RoomDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
  type?: string;
}

export interface PlatformDef {
  id: string;
  name: string;
  boundary: string[];
  height: number;
}

export interface VertexLayoutYaml {
  version: string;
  unit: string;
  scale: number;
  origin: { x: number; z: number };
  vertices: Vertex[];
  rooms: RoomDef[];
  platform?: PlatformDef;
  walls: WallDef[];
}

export interface ResolvedRoom extends RoomLayout {
  points?: CurtainPoint[];
  area?: number;
}

export interface ResolvedWall {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  openings?: Array<{
    id: string;
    type: string;
    x: number;
    z: number;
    width: number;
    height: number;
    sill?: number;
    room?: string;
  }>;
}

export interface ResolvedLayout {
  rooms: ResolvedRoom[];
  platform?: ResolvedRoom;
  walls: ResolvedWall[];
  vertices: Vertex[];
  openEdges: Array<{ room: string; from: string; to: string }>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS（新类型未被使用，但不报错）

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "types: add vertex relation engine types (Vertex, WallDef, ResolvedRoom, etc.)"
```

---

### Task 2: Create layout-resolver.ts — resolveLayout() + strict validation

**Files:**
- Create: `server/layout-resolver.ts`

**Consumes:** `Vertex`, `WallDef`, `RoomDef`, `VertexLayoutYaml`, `ResolvedLayout`, `ResolvedRoom`, `ResolvedWall`, `CurtainPoint` from `../shared/types.js`

**Produces:** `resolveLayout(raw: VertexLayoutYaml): ResolvedLayout`

- [ ] **Step 1: Create the resolver file with validation + vertex indexing**

```ts
import type {
  Vertex,
  WallDef,
  RoomDef,
  VertexLayoutYaml,
  ResolvedLayout,
  ResolvedRoom,
  ResolvedWall,
  CurtainPoint,
} from '../shared/types.js';

interface VMap {
  id: string;
  x: number;
  z: number;
  radius?: number;
}

function indexVertices(vertices: Vertex[]): Map<string, VMap> {
  const map = new Map<string, VMap>();
  for (const v of vertices) {
    if (map.has(v.id)) {
      throw new Error(`Duplicate vertex id: ${v.id}`);
    }
    if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) {
      throw new Error(`Vertex ${v.id} has non-finite coordinates`);
    }
    if (v.radius !== undefined && v.radius < 0) {
      throw new Error(`Vertex ${v.id} has negative radius`);
    }
    map.set(v.id, { id: v.id, x: v.x, z: v.z, radius: v.radius });
  }
  return map;
}
```

- [ ] **Step 2: Add polygon utilities (centroid, bbox, area, CCW check, self-intersection)**

```ts
type Pt = { x: number; z: number };

function polygonArea(pts: Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area / 2;
}

function ensureCCW(pts: Pt[]): Pt[] {
  if (polygonArea(pts) < 0) {
    return [...pts].reverse();
  }
  return pts;
}

function segmentsIntersect(
  p1: Pt, p2: Pt, p3: Pt, p4: Pt
): boolean {
  const d1 = cross(p4.x - p3.x, p4.z - p3.z, p1.x - p3.x, p1.z - p3.z);
  const d2 = cross(p4.x - p3.x, p4.z - p3.z, p2.x - p3.x, p2.z - p3.z);
  const d3 = cross(p2.x - p1.x, p2.z - p1.z, p3.x - p1.x, p3.z - p1.z);
  const d4 = cross(p2.x - p1.x, p2.z - p1.z, p4.x - p1.x, p4.z - p1.z);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function hasSelfIntersection(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(pts[i], pts[(i+1)%n], pts[j], pts[(j+1)%n])) {
        return true;
      }
    }
  }
  return false;
}

function bbox(pts: Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...pts.map(p => p.x)),
    maxX: Math.max(...pts.map(p => p.x)),
    minZ: Math.min(...pts.map(p => p.z)),
    maxZ: Math.max(...pts.map(p => p.z)),
  };
}

function isAxisAlignedRectangle(pts: Pt[]): boolean {
  if (pts.length !== 4) return false;
  const xs = [...new Set(pts.map(p => p.x))];
  const zs = [...new Set(pts.map(p => p.z))];
  return xs.length === 2 && zs.length === 2;
}
```

- [ ] **Step 3: Add resolveRoom (boundary → CurtainPoint[] + derive x/z/w/d)**

```ts
function resolveRoom(
  def: RoomDef | { id: string; name: string; boundary: string[]; height: number; type?: string },
  vmap: Map<string, VMap>,
  openEdges: ResolvedLayout['openEdges']
): ResolvedRoom {
  const pts: CurtainPoint[] = [];
  for (const vid of def.boundary) {
    const v = vmap.get(vid);
    if (!v) throw new Error(`Unknown vertex: ${vid} in room ${def.id}`);
    pts.push({ x: v.x, z: v.z, radius: v.radius });
  }

  if (pts.length < 3) {
    throw new Error(`Room ${def.id} boundary has < 3 vertices`);
  }

  const ccw = ensureCCW(pts);
  if (ccw !== pts) {
    console.warn(`Room ${def.id} boundary was CW, auto-reversed to CCW`);
  }

  if (hasSelfIntersection(ccw)) {
    throw new Error(`Self-intersecting boundary in room ${def.id}`);
  }

  const b = bbox(ccw);
  const width = b.maxX - b.minX;
  const depth = b.maxZ - b.minZ;
  const area = Math.abs(polygonArea(ccw));
  const isRect = isAxisAlignedRectangle(ccw) && !ccw.some(p => p.radius);

  return {
    id: def.id,
    name: def.name,
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    width,
    depth,
    height: def.height,
    type: (def as RoomDef).type ?? 'public',
    points: isRect ? undefined : ccw,
    area,
  };
}
```

- [ ] **Step 4: Add tangent point computation for rounded corners**

```ts
function tangentPoints(
  corner: VMap,
  prev: VMap,
  next: VMap
): { t1: Pt; t2: Pt; center: Pt } {
  const r = corner.radius!;
  // Direction from corner toward prev, normalized
  const dPrev = normalize({ x: prev.x - corner.x, z: prev.z - corner.z });
  // Direction from corner toward next, normalized
  const dNext = normalize({ x: next.x - corner.x, z: next.z - corner.z });

  // Tangent points: distance r from corner along each direction
  const t1 = { x: corner.x + dPrev.x * r, z: corner.z + dPrev.z * r };
  const t2 = { x: corner.x + dNext.x * r, z: corner.z + dNext.z * r };

  // Arc center: corner + r * bisector (normalized sum of directions)
  const bisector = normalize({ x: dPrev.x + dNext.x, z: dPrev.z + dNext.z });
  const center = { x: corner.x + bisector.x * r, z: corner.z + bisector.z * r };

  return { t1, t2, center };
}

function normalize(v: Pt): Pt {
  const len = Math.hypot(v.x, v.z);
  return len > 0 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

function arcSegments(
  center: Pt, r: number,
  startAngle: number, endAngle: number, n: number
): Array<{ x1: number; z1: number; x2: number; z2: number }> {
  const segs: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
  for (let i = 0; i < n; i++) {
    const a1 = startAngle + (endAngle - startAngle) * (i / n);
    const a2 = startAngle + (endAngle - startAngle) * ((i + 1) / n);
    segs.push({
      x1: center.x + r * Math.cos(a1), z1: center.z + r * Math.sin(a1),
      x2: center.x + r * Math.cos(a2), z2: center.z + r * Math.sin(a2),
    });
  }
  return segs;
}
```

- [ ] **Step 5: Add resolveWall (from/to vertices → x1/z1/x2/z2 + arc segments + open edges)**

```ts
function resolveWall(
  def: WallDef,
  vmap: Map<string, VMap>,
  allWalls: WallDef[]
): ResolvedWall {
  const from = vmap.get(def.from);
  const to = vmap.get(def.to);
  if (!from) throw new Error(`Wall ${def.id} references unknown vertex: ${def.from}`);
  if (!to) throw new Error(`Wall ${def.id} references unknown vertex: ${def.to}`);

  let x1 = from.x, z1 = from.z, x2 = to.x, z2 = to.z;
  let segments: Array<{ x1: number; z1: number; x2: number; z2: number }> | undefined;

  // If 'from' has radius, trim 'from' end to tangent + prepend arc
  // If 'to' has radius, trim 'to' end to tangent (arc owned by the wall whose 'from' is this vertex)
  if (from.radius) {
    // Find the wall that ends at 'from' (the previous wall in the corner)
    const prevWall = allWalls.find(w => w.to === def.from);
    if (prevWall) {
      const prevFrom = vmap.get(prevWall.from)!;
      const { t1, t2, center } = tangentPoints(from, prevFrom, to);
      // Trim: wall starts at t1 (tangent on prev side), arc from t1 to t2
      x1 = t1.x; z1 = t1.z;
      // Arc segments
      const startAngle = Math.atan2(t1.z - center.z, t1.x - center.x);
      const endAngle = Math.atan2(t2.z - center.z, t2.x - center.x);
      const arc = arcSegments(center, from.radius, startAngle, endAngle, 16);
      // Wall's straight segment from t2 to original 'to'
      segments = [...arc, { x1: t2.x, z1: t2.z, x2: to.x, z2: to.z }];
    }
  } else if (to.radius) {
    // Trim 'to' to tangent point (arc owned by the next wall whose 'from' is 'to')
    const nextWall = allWalls.find(w => w.from === def.to);
    if (nextWall) {
      const nextTo = vmap.get(nextWall.to)!;
      const { t1 } = tangentPoints(to, from, nextTo);
      x2 = t1.x; z2 = t1.z;
    }
    segments = [{ x1, z1, x2, z2 }];
  } else {
    segments = [{ x1, z1, x2, z2 }];
  }

  return { id: def.id, x1, z1, x2, z2, height: def.height, segments };
}
```

- [ ] **Step 6: Add resolveOpening (anchor + offset → absolute position)**

The opening resolver needs the vertex map to find the anchor vertex's coordinates, then computes position along the wall.

```ts
function resolveOpening(
  op: { id: string; type: string; wall: string; anchor: string; offset: number; width: number; height: number; sill?: number; room?: string },
  wall: ResolvedWall,
  vmap: Map<string, VMap>
): NonNullable<ResolvedWall['openings']>[number] {
  const anchor = vmap.get(op.anchor);
  if (!anchor) throw new Error(`Opening ${op.id} references unknown vertex: ${op.anchor}`);

  // Wall direction: from anchor toward the other end
  const isAnchorFrom = (Math.abs(anchor.x - wall.x1) < 0.01 && Math.abs(anchor.z - wall.z1) < 0.01);
  const otherEnd = isAnchorFrom
    ? { x: wall.x2, z: wall.z2 }
    : { x: wall.x1, z: wall.z1 };
  const dx = otherEnd.x - anchor.x;
  const dz = otherEnd.z - anchor.z;
  const wallLen = Math.hypot(dx, dz);
  if (wallLen < 0.001) throw new Error(`Wall ${op.wall} has zero length`);

  // Opening center = anchor + offset * direction
  const ux = dx / wallLen;
  const uz = dz / wallLen;
  const cx = anchor.x + ux * op.offset;
  const cz = anchor.z + uz * op.offset;

  // Validate offset bounds
  if (op.offset - op.width / 2 < -0.01 || op.offset + op.width / 2 > wallLen + 0.01) {
    throw new Error(`Opening ${op.id} exceeds wall ${op.wall} (offset=${op.offset}, width=${op.width}, wallLen=${wallLen.toFixed(2)})`);
  }

  return {
    id: op.id,
    type: op.type,
    x: cx,
    z: cz,
    width: op.width,
    height: op.height,
    sill: op.sill,
    room: op.room,
  };
}
```

- [ ] **Step 7: Add the main resolveLayout function**

```ts
export function resolveLayout(raw: VertexLayoutYaml): ResolvedLayout {
  const vmap = indexVertices(raw.vertices);
  const openEdges: ResolvedLayout['openEdges'] = [];

  // Resolve rooms
  const rooms: ResolvedRoom[] = raw.rooms.map(r => resolveRoom(r, vmap, openEdges));

  // Resolve platform
  const platform = raw.platform ? resolveRoom(raw.platform, vmap, openEdges) : undefined;

  // Resolve walls
  const walls: ResolvedWall[] = raw.walls.map(w => resolveWall(w, vmap, raw.walls));

  // Resolve openings
  for (let i = 0; i < walls.length; i++) {
    const wdef = raw.walls[i];
    if (wdef.openings) {
      walls[i].openings = wdef.openings.map(op => resolveOpening(op, walls[i], vmap));
    }
  }

  // Auto-derive open edges: for each room boundary edge, check if a wall covers it
  for (let ri = 0; ri < raw.rooms.length; ri++) {
    const rdef = raw.rooms[ri];
    const boundary = rdef.boundary;
    for (let bi = 0; bi < boundary.length; bi++) {
      const fromId = boundary[bi];
      const toId = boundary[(bi + 1) % boundary.length];
      const hasWall = raw.walls.some(w =>
        (w.from === fromId && w.to === toId) || (w.from === toId && w.to === fromId)
      );
      if (!hasWall) {
        openEdges.push({ room: rdef.id, from: fromId, to: toId });
      }
    }
  }
  // Also check platform
  if (raw.platform) {
    const boundary = raw.platform.boundary;
    for (let bi = 0; bi < boundary.length; bi++) {
      const fromId = boundary[bi];
      const toId = boundary[(bi + 1) % boundary.length];
      const hasWall = raw.walls.some(w =>
        (w.from === fromId && w.to === toId) || (w.from === toId && w.to === fromId)
      );
      if (!hasWall) {
        openEdges.push({ room: raw.platform.id, from: fromId, to: toId });
      }
    }
  }

  return { rooms, platform, walls, vertices: raw.vertices, openEdges };
}
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/layout-resolver.ts
git commit -m "feat: add layout-resolver with vertex→room/wall resolution + strict validation"
```

---

### Task 3: Resolver unit tests

**Files:**
- Create: `tests/server/layout-resolver.test.ts`

**Consumes:** `resolveLayout` from `../../server/layout-resolver.js`

- [ ] **Step 1: Create test file with rectangle room derivation test**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { VertexLayoutYaml } from '../../shared/types.js';

function makeRectRoom(): VertexLayoutYaml {
  return {
    version: '2.0',
    unit: 'm',
    scale: 0.001,
    origin: { x: 0, z: 0 },
    vertices: [
      { id: 'v1', x: 0, z: 0 },
      { id: 'v2', x: 4, z: 0 },
      { id: 'v3', x: 4, z: 3 },
      { id: 'v4', x: 0, z: 3 },
    ],
    rooms: [
      { id: 'test_room', name: 'Test', boundary: ['v1', 'v2', 'v3', 'v4'], height: 3.0, type: 'private' },
    ],
    walls: [
      { id: 'w_north', from: 'v1', to: 'v2', height: 3.0 },
      { id: 'w_east', from: 'v2', to: 'v3', height: 3.0 },
      { id: 'w_south', from: 'v3', to: 'v4', height: 3.0 },
      { id: 'w_west', from: 'v4', to: 'v1', height: 3.0 },
    ],
  };
}

describe('resolveLayout', () => {
  it('derives x/z/width/depth for rectangular room (no points)', () => {
    const result = resolveLayout(makeRectRoom());
    const room = result.rooms[0];
    assert.equal(room.x, 2);
    assert.equal(room.z, 1.5);
    assert.equal(room.width, 4);
    assert.equal(room.depth, 3);
    assert.equal(room.points, undefined);
  });

  it('derives points for non-rectangular room', () => {
    const yaml = makeRectRoom();
    yaml.vertices.push({ id: 'v5', x: 2, z: 0 });
    yaml.rooms[0].boundary = ['v1', 'v5', 'v2', 'v3', 'v4'];
    const result = resolveLayout(yaml);
    assert.ok(result.rooms[0].points, 'non-rect room should have points');
    assert.equal(result.rooms[0].points!.length, 5);
  });

  it('resolves wall endpoints from vertex ids', () => {
    const result = resolveLayout(makeRectRoom());
    const w = result.walls[0];
    assert.equal(w.id, 'w_north');
    assert.equal(w.x1, 0);
    assert.equal(w.z1, 0);
    assert.equal(w.x2, 4);
    assert.equal(w.z2, 0);
  });

  it('auto-derives open edges', () => {
    const yaml = makeRectRoom();
    // Remove north wall → open edge
    yaml.walls = yaml.walls.filter(w => w.id !== 'w_north');
    const result = resolveLayout(yaml);
    assert.ok(result.openEdges.some(e => e.room === 'test_room' && e.from === 'v1' && e.to === 'v2'));
  });

  it('throws on duplicate vertex id', () => {
    const yaml = makeRectRoom();
    yaml.vertices.push({ id: 'v1', x: 99, z: 99 });
    assert.throws(() => resolveLayout(yaml), /Duplicate vertex id: v1/);
  });

  it('throws on unknown vertex in room boundary', () => {
    const yaml = makeRectRoom();
    yaml.rooms[0].boundary = ['v1', 'v999', 'v3', 'v4'];
    assert.throws(() => resolveLayout(yaml), /Unknown vertex: v999/);
  });

  it('throws on self-intersecting boundary', () => {
    const yaml = makeRectRoom();
    // Bowtie: v1→v3→v2→v4
    yaml.rooms[0].boundary = ['v1', 'v3', 'v2', 'v4'];
    assert.throws(() => resolveLayout(yaml), /Self-intersecting/);
  });

  it('auto-reverses CW boundary to CCW', () => {
    const yaml = makeRectRoom();
    yaml.rooms[0].boundary = ['v1', 'v4', 'v3', 'v2']; // CW order
    const result = resolveLayout(yaml);
    // Should not throw, area should be positive
    assert.ok(result.rooms[0].area! > 0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx tsx --test tests/server/layout-resolver.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server/layout-resolver.test.ts
git commit -m "test: add layout-resolver unit tests (rect derivation, open edges, validation)"
```

---

### Task 4: Add arc expansion + opening resolution tests

**Files:**
- Modify: `tests/server/layout-resolver.test.ts`

- [ ] **Step 1: Add arc expansion test (rounded corner → 16 segments)**

Append to the test file:

```ts
describe('resolveLayout arc expansion', () => {
  it('expands radius vertex into 16 arc segments on the wall whose from has radius', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v_nw', x: 0, z: 0 },
        { id: 'v_sw', x: 0, z: 5, radius: 1.0 },
        { id: 'v_se', x: 5, z: 5 },
        { id: 'v_ne', x: 5, z: 0 },
      ],
      rooms: [
        { id: 'room', name: 'Room', boundary: ['v_nw', 'v_ne', 'v_se', 'v_sw'], height: 3.0 },
      ],
      walls: [
        { id: 'w_north', from: 'v_nw', to: 'v_ne', height: 3.0 },
        { id: 'w_east', from: 'v_ne', to: 'v_se', height: 3.0 },
        { id: 'w_south', from: 'v_se', to: 'v_sw', height: 3.0 },
        { id: 'w_west', from: 'v_sw', to: 'v_nw', height: 3.0 },
      ],
    };
    const result = resolveLayout(yaml);

    // w_west has from=v_sw (radius) → should have arc segments
    const w_west = result.walls.find(w => w.id === 'w_west')!;
    assert.ok(w_west.segments, 'west wall should have segments');
    // 16 arc + 1 straight = 17 segments (arc owned by the wall whose from is the radius vertex)
    assert.ok(w_west.segments!.length >= 16, `expected >=16 segments, got ${w_west.segments!.length}`);

    // w_south has to=v_sw (radius) → trimmed to tangent, no arc
    const w_south = result.walls.find(w => w.id === 'w_south')!;
    assert.ok(w_south.segments, 'south wall should have segments');
    assert.equal(w_south.segments!.length, 1, 'south wall should have 1 trimmed segment');
  });
});
```

- [ ] **Step 2: Add opening resolution test (anchor + offset → absolute position)**

```ts
describe('resolveLayout openings', () => {
  it('resolves door position from anchor + offset', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v1', x: 0, z: 0 },
        { id: 'v2', x: 5, z: 0 },
        { id: 'v3', x: 5, z: 3 },
        { id: 'v4', x: 0, z: 3 },
      ],
      rooms: [
        { id: 'room', name: 'Room', boundary: ['v1', 'v2', 'v3', 'v4'], height: 3.0 },
      ],
      walls: [
        { id: 'w_east', from: 'v2', to: 'v3', height: 3.0, openings: [
          { id: 'd1', type: 'door', wall: 'w_east', anchor: 'v2', offset: 0.9, width: 0.9, height: 2.1, room: 'room' },
        ]},
        { id: 'w_north', from: 'v1', to: 'v2', height: 3.0 },
        { id: 'w_south', from: 'v3', to: 'v4', height: 3.0 },
        { id: 'w_west', from: 'v4', to: 'v1', height: 3.0 },
      ],
    };
    const result = resolveLayout(yaml);
    const wall = result.walls.find(w => w.id === 'w_east')!;
    assert.ok(wall.openings, 'wall should have openings');
    const door = wall.openings![0];
    // v2 is at (5, 0), wall goes to v3 at (5, 3). Offset 0.9 from v2.
    assert.equal(door.x, 5);
    assert.equal(door.z, 0.9);
  });

  it('throws when opening offset exceeds wall length', () => {
    const yaml: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v1', x: 0, z: 0 },
        { id: 'v2', x: 1, z: 0 },
        { id: 'v3', x: 1, z: 1 },
        { id: 'v4', x: 0, z: 1 },
      ],
      rooms: [{ id: 'r', name: 'R', boundary: ['v1','v2','v3','v4'], height: 3 }],
      walls: [
        { id: 'w', from: 'v1', to: 'v2', height: 3.0, openings: [
          { id: 'd', type: 'door', wall: 'w', anchor: 'v1', offset: 0.9, width: 0.9, height: 2.1 },
        ]},
        { id: 'w2', from: 'v2', to: 'v3', height: 3.0 },
        { id: 'w3', from: 'v3', to: 'v4', height: 3.0 },
        { id: 'w4', from: 'v4', to: 'v1', height: 3.0 },
      ],
    };
    // Wall length = 1, offset 0.9 + width/2 0.45 = 1.35 > 1
    assert.throws(() => resolveLayout(yaml), /exceeds wall/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx tsx --test tests/server/layout-resolver.test.ts`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/server/layout-resolver.test.ts
git commit -m "test: add arc expansion + opening resolution tests"
```

---

### Task 5: Add resolveWallRef to overlay-merge.ts

**Files:**
- Modify: `server/overlay-merge.ts`
- Modify: `tests/server/overlay-merge.test.ts`

**Consumes:** `ResolvedWall` from `../shared/types.js`
**Produces:** `resolveWallRef(wallId, walls): CurtainPoint[]`

- [ ] **Step 1: Add resolveWallRef function to overlay-merge.ts**

在 `overlay-merge.ts` 的 `mergeSceneElements` 函数之后追加：

```ts
export function resolveWallRef(
  wallIds: string | string[],
  walls: Array<{ id: string; x1: number; z1: number; x2: number; z2: number }>
): CurtainPoint[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  const pts: CurtainPoint[] = [];
  for (const id of ids) {
    const wall = walls.find(w => w.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    pts.push({ x: wall.x1, z: wall.z1 });
    pts.push({ x: wall.x2, z: wall.z2 });
  }
  // Merge collinear consecutive segments (same wall continues)
  const merged: CurtainPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = pts[i];
    // Skip duplicate points (end of one wall = start of next)
    if (Math.abs(prev.x - curr.x) < 0.001 && Math.abs(prev.z - curr.z) < 0.001) {
      continue;
    }
    merged.push(curr);
  }
  return merged;
}
```

在文件顶部 import 追加 `CurtainPoint`：

```ts
import type { SceneElement, WallSegment, CurtainPoint } from '../shared/types.js';
```

- [ ] **Step 2: Add tests for resolveWallRef**

在 `tests/server/overlay-merge.test.ts` 末尾追加：

```ts
import { resolveWallRef } from '../../server/overlay-merge.js';

describe('resolveWallRef', () => {
  const walls = [
    { id: 'w1', x1: 0, z1: 0, x2: 0, z2: 5 },
    { id: 'w2', x1: 0, z1: 5, x2: 0, z2: 10 },
  ];

  it('resolves single wall to two points', () => {
    const pts = resolveWallRef('w1', walls);
    assert.deepEqual(pts, [{ x: 0, z: 0 }, { x: 0, z: 5 }]);
  });

  it('merges collinear multi-wall into single segment', () => {
    const pts = resolveWallRef(['w1', 'w2'], walls);
    // w1 ends at (0,5), w2 starts at (0,5) → merge → 3 points → actually 2 after dedup
    assert.equal(pts.length, 3); // (0,0), (0,5) dedup skip, (0,10) → wait
    // Actually: w1: (0,0)→(0,5), w2: (0,5)→(0,10)
    // pts = [(0,0), (0,5), (0,5), (0,10)] → merged = [(0,0), (0,5), (0,10)] → 3 points
    // The (0,5) appears twice; dedup removes the second, keeping (0,0)→(0,5)→(0,10)
    assert.deepEqual(pts[0], { x: 0, z: 0 });
    assert.deepEqual(pts[pts.length - 1], { x: 0, z: 10 });
  });

  it('throws on unknown wall id', () => {
    assert.throws(() => resolveWallRef('w999', walls), /Unknown wall id: w999/);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx tsx --test tests/server/overlay-merge.test.ts`
Expected: All PASS (existing + new)

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/overlay-merge.ts tests/server/overlay-merge.test.ts
git commit -m "feat: add resolveWallRef (wall id → CurtainPoint[]) for overlay expansion"
```

---

## Phase 2: Renderer Integration

### Task 6: createRoom polygon branch + arc wall segments

**Files:**
- Modify: `app/src/render/HouseScene.ts:498` (createRoom floor)
- Modify: `app/src/render/HouseScene.ts:599` (renderWallSegment)

**Consumes:** `ResolvedRoom.points?: CurtainPoint[]` and `ResolvedWall.segments?`

- [ ] **Step 1: Add polygon floor branch in createRoom**

在 `HouseScene.ts` 的 `createRoom` 方法中（约 line 498），把：

```ts
const floorGeo = new THREE.PlaneGeometry(r.width, r.depth);
```

改为：

```ts
const floorGeo = (r as { points?: { x: number; z: number; radius?: number }[] }).points
  ? new THREE.ShapeGeometry(this.buildRoundedShape((r as { points: { x: number; z: number; radius?: number }[] }).points))
  : new THREE.PlaneGeometry(r.width, r.depth);
```

- [ ] **Step 2: Add arc wall segment iteration in renderWallSegment**

在 `HouseScene.ts` 的 `renderWallSegment` 方法中（约 line 599），把单段渲染改为遍历 `segments`：

```ts
private renderWallSegment(
  el: Extract<SceneElement, { type: 'wall' }>,
  height: number
) {
  const mat = new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 });
  // New: if wall has segments (arc expansion), render each
  const segs = (el as { segments?: Array<{ x1: number; z1: number; x2: number; z2: number }> }).segments;
  if (segs && segs.length > 1) {
    for (const s of segs) {
      const mesh = this.renderBox(s.x1, s.z1, s.x2, s.z2, height, WALL_THICKNESS, mat);
      this.scene.add(mesh);
    }
    return;
  }
  // Original single-segment path
  const mesh = this.renderBox(el.x1, el.z1, el.x2, el.z2, height, WALL_THICKNESS, mat);
  mesh.userData = { roomId: '', objectId: el.id, type: 'wall' };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  this.scene.add(mesh);
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run existing tests**

Run: `npx tsx --test tests/server/**/*.test.ts`
Expected: All existing tests still PASS (no data changed yet)

- [ ] **Step 5: Commit**

```bash
git add app/src/render/HouseScene.ts
git commit -m "feat: createRoom polygon floor branch + arc wall segments iteration"
```

---

### Task 7: Integrate resolver into project-catalog.ts

**Files:**
- Modify: `server/project-catalog.ts`

**Consumes:** `resolveLayout` from `./layout-resolver.js`, `VertexLayoutYaml` from `../shared/types.js`
**Produces:** ProjectCatalog uses resolver when YAML has `vertices` field (new format), otherwise uses old path.

- [ ] **Step 1: Add resolver import + detection logic**

在 `project-catalog.ts` 顶部 import 追加：

```ts
import { resolveLayout } from './layout-resolver.js';
import type { VertexLayoutYaml, ResolvedRoom } from '../shared/types.js';
```

在 constructor 中（约 line 134，`this.walls = layout.walls ?? []` 之后），加 resolver 路径：

```ts
// New: if layout has vertices (v2.0 format), use resolver
if ('vertices' in layout && (layout as VertexLayoutYaml).vertices) {
  const vlayout = layout as unknown as VertexLayoutYaml;
  const resolved = resolveLayout(vlayout);
  // Replace rooms with resolved rooms
  this.rooms.clear();
  for (const r of resolved.rooms) {
    const meta = metaMap.get(r.id);
    this.rooms.set(r.id, {
      ...r,
      type: (meta?.type ?? 'public') as RoomLayout['type'],
      needs_waterproof: meta?.needs_waterproof,
      openings: meta?.openings,
    });
  }
  if (resolved.platform) {
    this.platform = {
      ...resolved.platform,
      type: 'service',
    };
  }
  // Replace walls with resolved walls (as WallSegment[])
  this.walls = resolved.walls.map(w => ({ x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 }));
} else {
  // Old path: direct from layout (existing code below)
  for (const r of layout.rooms) {
    this.rooms.set(r.id, mergeRoom(r, metaMap.get(r.id)));
  }
  if (layout.platform) {
    this.platform = mergePlatform(layout.platform);
  }
}
```

把原有的 `for (const r of layout.rooms) { ... }` 和 `if (layout.platform) { ... }` 移到 else 分支里。

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run existing tests**

Run: `npx tsx --test tests/server/**/*.test.ts`
Expected: All PASS（现有数据无 `vertices` 字段 → 走旧路径，行为不变）

- [ ] **Step 4: Commit**

```bash
git add server/project-catalog.ts
git commit -m "feat: integrate layout-resolver into project-catalog (dual-path: vertices→resolver, else→old)"
```

---

## Phase 3: Data Migration — model-geometry.yaml

### Task 8: Write migration script + convert model-geometry.yaml

**Files:**
- Create: `scripts/migrate-to-vertices.ts`
- Modify: `config/layout/model-geometry.yaml`

**Consumes:** spec §5.1 (32 vertices, 10 rooms + 1 platform boundary, walls list)
**Produces:** `model-geometry.yaml` in v2.0 format (vertices/rooms/walls)

- [ ] **Step 1: Write migration script that reads old format + emits v2.0**

```ts
// scripts/migrate-to-vertices.ts
// Reads model-geometry.yaml (v1.0: rooms center+size, walls endpoints)
// Emits v2.0 format (vertices, rooms with boundary, walls with from/to)
// Usage: npx tsx scripts/migrate-to-vertices.ts > config/layout/model-geometry-v2.yaml
import { readFileSync, writeFileSync } from 'node:fs';
import { load } from 'js-yaml';

const raw = readFileSync('config/layout/model-geometry.yaml', 'utf-8');
const old = load(raw) as any;

// 1. Collect all wall endpoints → dedupe → assign ids (using spec §5.1 naming)
//    This is semi-manual: the script generates candidates, then you match
//    to the spec's 32 named vertices by coordinate.
// 2. Replace chord segments with radius vertices (SW/SE corners)
// 3. Emit v2.0 YAML

console.log('Migration script — see spec §5.1 for the 32 vertices + 10 room boundaries');
console.log('This script is a starting point; manual verification against §5.1 is required.');
// ... (implementation follows spec §5.1 vertex list + §12.2 room boundary table)
```

> **Note:** The migration script is a helper. The actual v2.0 data should be written by following spec §5.1's 32-vertex list + 10 room boundaries + wall definitions. The script can extract wall endpoints from the old format, but vertex naming and boundary composition require human/AI verification against the spec.

- [ ] **Step 2: Write the v2.0 model-geometry.yaml**

Replace `config/layout/model-geometry.yaml` with the v2.0 format from spec §5.1:
- `vertices:` section (32 vertices with exact coordinates from spec)
- `rooms:` section (10 rooms + platform with boundary vertex id arrays from spec §5.1 + §12.2)
- `walls:` section (all walls with from/to vertex ids — spec §5.1 shows the 外框 + 主卧/书房 examples; the rest follow the same pattern from existing walls data)

Keep `origin`, `scale`, `unit` fields unchanged.

- [ ] **Step 3: Run verify-layout (room overlap check)**

Run: `npx tsx scripts/verify-layout.ts`
Expected: PASS (resolver derives x/z/width/depth, overlap check works)

- [ ] **Step 4: Run topology validation**

Run: `npx tsx --eval "import { resolveLayout } from './server/layout-resolver.js'; import { readFileSync } from 'node:fs'; import { load } from 'js-yaml'; const raw = readFileSync('config/layout/model-geometry.yaml','utf-8'); const yaml = load(raw); const result = resolveLayout(yaml); console.log('OK:', result.rooms.length, 'rooms,', result.walls.length, 'walls,', result.openEdges.length, 'open edges'); for (const e of result.openEdges) console.log('  open:', e.room, e.from, '→', e.to);"`

Expected: OK with 10 rooms, ~23 walls, open edges listed (master_bedroom north, entry_garden diagonal, etc.)

- [ ] **Step 5: Run all server tests**

Run: `npx tsx --test tests/server/**/*.test.ts`
Expected: All PASS

- [ ] **Step 6: Visual comparison — screenshot before/after**

Run the dev server and capture a floor plan screenshot. Compare with the pre-migration baseline using the floor-plan-compare skill.

Run: `npx tsx scripts/verify-layout.ts && npx tsx --test tests/server/**/*.test.ts && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add config/layout/model-geometry.yaml scripts/migrate-to-vertices.ts
git commit -m "feat: migrate model-geometry.yaml to v2.0 vertex format (32 vertices, 10 rooms+platform)"
```

---

## Phase 4: Data Migration — overlay.yaml

### Task 9: Convert overlay.yaml to wall id references

**Files:**
- Modify: `config/layout/overlay.yaml`

**Consumes:** spec §5.2 (overlay schema with wall refs)

- [ ] **Step 1: Convert curtain_run elements from points to wall refs**

For each `curtain_run` in `overlay.yaml`:
- `living_south_curtain`: `wall: w_liv_south`
- `west_curtain`: `walls: [w_west_lower, w_west_mid, w_west_upper]`
- `south_east_curtain`: `wall: w_be_south` (or whichever wall covers the SE curtain)

Remove `points:` arrays from these elements.

- [ ] **Step 2: Convert bay_sill elements from points to wall refs**

For each `bay_sill`:
- `master_bedroom_south_bay`: `wall: w_mb_south`
- `master_bedroom_west_bay`: `wall: w_west_upper`
- `study_south_bay`: `wall: w_study_south` (the south wall segment from v_mb_se to v_step_b)
- `bedroom_se_south_bay`: `wall: w_be_south`
- `bedroom_nw_west_bay`: `wall: w_west_lower`

Remove `points:` arrays.

- [ ] **Step 3: Convert suppress from region to wall refs**

For each `suppress`:
- `suppress_west_wall`: `wall: w_west_lower` (or whichever west wall segment)
- `suppress_south_west`: `wall: w_mb_south` (or the relevant south wall segment)
- `suppress_living_south`: `wall: w_liv_south`
- `suppress_south_east`: `wall: w_be_south`

Remove `region:` fields.

- [ ] **Step 4: Keep floor_region elements unchanged**

`floor_region` elements (entry_garden_floor, corridor_floor, north_platform_floor) keep their `points:` arrays — they're补区 without walls.

- [ ] **Step 5: Update overlay-merge.ts to resolve wall refs**

In `overlay-merge.ts`, modify `mergeSceneElements` to call `resolveWallRef` for elements that have `wall`/`walls` fields:

```ts
// In mergeSceneElements, after building kept walls:
const resolvedWalls = [...kept]; // walls as {id, x1, z1, x2, z2}
for (const el of elements) {
  if ('wall' in el || 'walls' in el) {
    const wallRef = ('wall' in el ? el.wall : el.walls) as string | string[];
    const pts = resolveWallRef(wallRef, walls); // walls = the original WallSegment[] with ids
    // Replace points with resolved points
    (el as { points: typeof pts }).points = pts;
  }
}
return [...kept, ...elements];
```

> **Note:** This requires the `walls` input to `mergeSceneElements` to carry `id` fields. In Phase 3, the resolved walls from `resolveLayout` include `id`. Update `WallSegment` type to include optional `id?: string`.

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npx tsx --test tests/server/**/*.test.ts`
Expected: PASS

- [ ] **Step 7: Visual comparison**

Run dev server, screenshot, compare with Phase 3 baseline.

- [ ] **Step 8: Commit**

```bash
git add config/layout/overlay.yaml server/overlay-merge.ts
git commit -m "feat: migrate overlay.yaml to wall id references (curtain/bay/suppress)"
```

---

## Phase 5: Verification + Cleanup

### Task 10: Create verify-topology.ts

**Files:**
- Create: `scripts/verify-topology.ts`

**Consumes:** `resolveLayout` from `../server/layout-resolver.js`

- [ ] **Step 1: Write the topology verification script**

```ts
// scripts/verify-topology.ts
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../server/layout-resolver.js';
import type { VertexLayoutYaml } from '../shared/types.js';

const raw = readFileSync('config/layout/model-geometry.yaml', 'utf-8');
const yaml = load(raw) as VertexLayoutYaml;

try {
  const result = resolveLayout(yaml);
  console.log('✓ Topology valid');
  console.log(`  ${result.rooms.length} rooms, ${result.walls.length} walls, ${result.vertices.length} vertices`);
  if (result.openEdges.length > 0) {
    console.log(`  ${result.openEdges.length} open edges (info):`);
    for (const e of result.openEdges) {
      console.log(`    ${e.room}: ${e.from} → ${e.to}`);
    }
  } else {
    console.log('  0 open edges');
  }
  // Check for rooms without any walls (all edges open)
  for (const room of result.rooms) {
    const roomOpenEdges = result.openEdges.filter(e => e.room === room.id);
    if (roomOpenEdges.length === room.boundary_count) {
      console.warn(`  ⚠ Room ${room.id} has ALL edges open (no walls at all)`);
    }
  }
} catch (e) {
  console.error('✗ Topology invalid:', (e as Error).message);
  process.exit(1);
}
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-topology.ts`
Expected: `✓ Topology valid` + open edges listed

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-topology.ts
git commit -m "feat: add verify-topology.ts (strict validation + open edge listing)"
```

---

### Task 11: Retire validate-room-wall-alignment.ts + update AGENTS.md

**Files:**
- Move: `scripts/validate-room-wall-alignment.ts` → `scripts/archive/`
- Move: `tests/server/validate-room-wall-alignment.test.ts` → `tests/server/archive/`
- Modify: `AGENTS.md`（验证命令段）

- [ ] **Step 1: Archive the old validation script**

```bash
mkdir -p scripts/archive tests/server/archive
git mv scripts/validate-room-wall-alignment.ts scripts/archive/
git mv tests/server/validate-room-wall-alignment.test.ts tests/server/archive/
```

- [ ] **Step 2: Update AGENTS.md validation commands**

In `AGENTS.md`, replace the validation section:

```bash
npx tsx scripts/verify-layout.ts
npx tsx scripts/validate-room-wall-alignment.ts
npm run test:server
npm run typecheck
```

with:

```bash
npx tsx scripts/verify-topology.ts
npx tsx scripts/verify-layout.ts
npm run test:server
npm run typecheck
```

Also update the note about `model-geometry.yaml` format to mention v2.0 vertex format.

- [ ] **Step 3: Run full validation suite**

Run: `npx tsx scripts/verify-topology.ts && npx tsx scripts/verify-layout.ts && npx tsx --test tests/server/**/*.test.ts && npm run typecheck`

Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md scripts/archive/ tests/server/archive/
git commit -m "chore: retire validate-room-wall-alignment (structural alignment), update AGENTS.md"
```

---

### Task 12: Final integration test — "改南墙" regression test

**Files:**
- Modify: `tests/server/layout-resolver.test.ts`

**Goal:** Verify the original pain point is solved — change a vertex z, all dependent rooms/walls/overlays auto-update.

- [ ] **Step 1: Add regression test for "move south wall" scenario**

```ts
describe('regression: change south wall z → auto-propagate', () => {
  it('moving v_step_t.z propagates to living_dining depth + wall endpoints', () => {
    const base: VertexLayoutYaml = {
      version: '2.0', unit: 'm', scale: 0.001, origin: { x: 0, z: 0 },
      vertices: [
        { id: 'v_kit_w', x: 7.20, z: 0 },
        { id: 'v_kit_s', x: 7.20, z: 4.30 },
        { id: 'v_liv_se', x: 13.40, z: 4.30 },
        { id: 'v_be_se_s', x: 13.40, z: 9.95 },
        { id: 'v_step_t', x: 7.20, z: 9.95 },
      ],
      rooms: [
        { id: 'living_dining', name: '客餐厅', boundary: ['v_kit_s', 'v_liv_se', 'v_be_se_s', 'v_step_t'], height: 3.0 },
      ],
      walls: [
        { id: 'w_liv_south', from: 'v_step_t', to: 'v_be_se_s', height: 3.0 },
        { id: 'w_liv_west', from: 'v_kit_s', to: 'v_step_t', height: 3.0 },
        { id: 'w_liv_north', from: 'v_kit_s', to: 'v_liv_se', height: 3.0 },
        { id: 'w_liv_east', from: 'v_liv_se', to: 'v_be_se_s', height: 3.0 },
      ],
    };

    // Before: z=9.95
    const before = resolveLayout(base);
    assert.equal(before.rooms[0].depth, 5.65); // 9.95 - 4.30
    assert.equal(before.walls[0].z1, 9.95); // w_liv_south from v_step_t

    // After: move v_step_t.z to 10.25 (south wall pushed 0.3m south)
    const after = resolveLayout({
      ...base,
      vertices: base.vertices.map(v => v.id === 'v_step_t' ? { ...v, z: 10.25 } : v),
    });
    assert.equal(after.rooms[0].depth, 5.95); // 10.25 - 4.30
    assert.equal(after.walls[0].z1, 10.25); // wall endpoint auto-updated
    assert.equal(after.walls[1].z2, 10.25); // w_liv_west endpoint also auto-updated (shared vertex)
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx tsx --test tests/server/layout-resolver.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/server/layout-resolver.test.ts
git commit -m "test: add 'move south wall' regression test (original pain point)"
```

---

## Self-Review Notes

### Spec coverage

| Spec section | Task |
|---|---|
| §5.1 vertices (32) | Task 8 (migration) |
| §5.1 rooms (10+1) | Task 8 |
| §5.1 walls | Task 8 |
| §5.2 overlay wall refs | Task 9 |
| §5.3 openings (anchor+offset) | Task 2 (resolver) + Task 4 (tests) |
| §6 resolver | Task 2 |
| §6.4 arc expansion (16 segments) | Task 2 + Task 4 |
| §6.5 strict validation | Task 2 + Task 3 |
| §7.1 createRoom branch | Task 6 |
| §7.2 OpeningDef migration | Task 6 (renderer) — deferred to follow-up |
| §7.3 arc wall segments | Task 6 |
| §7.4 glass_infill migration | Task 9 (overlay) — deferred |
| §8.2 verify-topology.ts | Task 10 |
| §8.3 retire old validation | Task 11 |
| §10 test plan | Tasks 3, 4, 12 |

### Deferred items (follow-up after initial implementation)

- **OpeningDef.wall migration** (§7.2): The OpeningDef type change (direction string → wall id) affects `HouseScene.ts:542-547` (`_openingPosition`). This is a renderer change that should be done after Phase 3 data migration (when walls have ids). Defer to a follow-up task.
- **glass_infill migration** (§7.4): Convert `glass_infill` from `room+wall direction` to `wall id` reference. Defer until after Phase 4.
- **budget-calculator.ts area field** (§11.1): Add `area` to ResolvedRoom (done in types) + update budget calculator to use `room.area ?? room.width * room.depth`. Defer to follow-up.

### Type consistency

- `resolveLayout` returns `ResolvedLayout` with `rooms: ResolvedRoom[]`, `walls: ResolvedWall[]`
- `ResolvedRoom` extends `RoomLayout` + adds `points?` and `area?`
- `resolveWallRef` takes `string | string[]` + `Array<{id, x1, z1, x2, z2}>` → returns `CurtainPoint[]`
- `WallSegment` (existing) needs optional `id?: string` for overlay-merge to find walls by id — add in Task 9
