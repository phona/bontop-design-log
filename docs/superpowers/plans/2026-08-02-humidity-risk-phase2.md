# 二期：湿度风险评估 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现南宁回南天场景下的静态湿度结露/发霉风险评估：房间级评分 + 重点表面评分，经 REST/MCP 暴露结论，客户端以风险热力叠加 + 高风险表面脉冲标记 + 点击因子拆解展示。

**Architecture:** `shared/humidity-model.ts` 纯函数评分（湿源/通风/朝向/回南天冷表面因子，加性索引 0–100）复用一期的 `extractApertures` 推导朝向；服务端在现有 `analysis-service.ts`/`analysis-routes.ts` 扩展 `computeHumidityAnalysis` + `GET /api/analysis/humidity` + MCP `get_humidity_risks`；客户端 `HumidityOverlay`（仿 `DaylightHeatmap` 的材质克隆-换回模式）+ `HumidityButton` 入口 + 面板回南天提示条接线。

**Tech Stack:** TypeScript 5.5、Three.js 0.166（app）、Express + zod 4 + MCP SDK（server）、vitest 4 + jsdom（app 测试）、node:test + supertest（server 测试）。

## Global Constraints

- 铁律：湿度因子声明只来自 `config/environment.yaml` 的 `humidity:` 段（一期已建好，含 rooms/surfaces 声明）；代码不推断意图。
- 坐标系与一期一致：`+x=东, +z=南`；方位角自北顺时针。北向带 = 方位角 ∈ [315°, 360°] ∪ [0°, 45°]。
- 评分模型（spec §5，初始权重，测试保证单调性）：
  - 湿源 moisture：low 0 / medium +15 / high +30
  - 通风 ventilation：cross −10 / open −5 / range_hood −5 / mechanical 0 / single_side +10
  - 朝向：房间有 ≥1 采光面且**全部**朝北 → +10，否则 0
  - 回南天冷表面：房间声明 `cold_surface` 且日期在 `huinan_window` 内 → +20
  - 分级：<25 low / 25–50 medium / >50 high；总分 clamp 0–100
  - 未声明房间：默认 `{moisture: low, ventilation: single_side}`，结论 `declared: false`
  - 重点表面 = 房间分 + kind 修正：slab +15（仅回南天窗口内）/ ext_wall +10 / corner +10，同分级，clamp 0–100
- REST 响应形状（spec §7.1）：`{ confidence: 'estimated', huinanActive: boolean, rooms: [{id, name, score, tier, factors: [{label, delta}], declared}], surfaces: [{id, room, kind, faces?, score, tier}] }`（`faces` 为一期 spec 基础上的附加字段，供客户端定位标记）。
- 服务端导入 shared 用 `../shared/xxx.js`；app 用 `@shared/xxx` 别名。
- 零新快捷键；入口为 `#humidity-btn` 按钮（含 CSS，一期教训：按钮必须带定位样式）。
- 不加代码注释；有分号；2 空格缩进。
- 每任务跑对应测试；全部完成后必须跑 `npm run verify:all && npm run test:server && npm run test:app && npm run typecheck`。

## File Structure

| 文件 | 职责 |
|---|---|
| `shared/humidity-model.ts`（新建） | 房间/表面评分纯函数、分级、`isInHuinanWindow` |
| `server/analysis-service.ts`（改） | 追加 `computeHumidityAnalysis` + `humidityAdvisories` |
| `server/analysis-routes.ts`（改） | 追加 `GET /humidity?date=MM-DD`（date 缺省 = 服务器当前日期） |
| `server/mcp-server.ts`（改） | 注册 `get_humidity_risks` 工具 |
| `app/src/render/analysis/HumidityOverlay.ts`（新建） | 风险热力着色 + 高风险表面脉冲标记 + 点击因子面板 |
| `app/src/ui/HumidityButton.ts`（新建） | 仿 SunlightButton 的入口按钮绑定 |
| `app/index.html`（改） | `#sunlight-btn` 后追加 `#humidity-btn` |
| `app/style.css`（改） | `#humidity-btn` 定位样式 + `#humidity-info-panel` 样式 |
| `app/src/App.ts`（改） | setupHumidity 接线 + onDateChange 合并湿度刷新与回南天提示 + renderLoop 脉冲 |
| 测试：`tests/server/shared/humidity-model.test.ts`、`tests/server/analysis-humidity.test.ts`（新建）；`tests/server/mcp.test.ts`（改）；`app/src/render/analysis/HumidityOverlay.test.ts`、`app/src/ui/HumidityButton.test.ts`（新建） |

---

### Task 1: `shared/humidity-model.ts` 评分模型

**Files:**
- Create: `shared/humidity-model.ts`
- Test: `tests/server/shared/humidity-model.test.ts`

**Interfaces:**
- Consumes: `WindowAperture`（`shared/glazing.ts`，一期 Task 3）
- Produces:
  ```ts
  type Moisture = 'low' | 'medium' | 'high'
  type Ventilation = 'cross' | 'open' | 'range_hood' | 'mechanical' | 'single_side'
  type Tier = 'low' | 'medium' | 'high'
  interface HumidityRoomDecl { moisture: Moisture; ventilation: Ventilation; cold_surface?: string }
  interface HumiditySurfaceDecl { id: string; room: string; kind: 'slab' | 'ext_wall' | 'corner'; faces?: string }
  interface HumidityFactor { label: string; delta: number }
  interface RoomHumidity { roomId: string; score: number; tier: Tier; factors: HumidityFactor[]; declared: boolean }
  interface SurfaceHumidity { id: string; room: string; kind: 'slab' | 'ext_wall' | 'corner'; faces?: string; score: number; tier: Tier }
  interface HuinanWindow { start: string; end: string }   // 'MM-DD'
  isInHuinanWindow(date: { month: number; day: number }, window: HuinanWindow): boolean
  toTier(score: number): Tier
  analyzeHumidity(opts: {
    roomIds: string[];
    apertures: WindowAperture[];
    roomDecls?: Record<string, HumidityRoomDecl>;
    surfaceDecls?: HumiditySurfaceDecl[];
    date: { month: number; day: number };
    huinanWindow: HuinanWindow;
  }): { rooms: RoomHumidity[]; surfaces: SurfaceHumidity[] }
  ```
- Consumed by: Task 2（服务端）、Task 5（客户端回南天提示）

- [ ] **Step 1: 写失败测试**

Create `tests/server/shared/humidity-model.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHumidity, isInHuinanWindow, toTier } from '../../../shared/humidity-model.js';
import type { WindowAperture } from '../../../shared/glazing.js';

const WINDOW = { start: '02-15', end: '04-15' };
const HUINAN_DATE = { month: 3, day: 15 };
const DRY_DATE = { month: 12, day: 22 };

function aperture(roomId: string, azimuthDeg: number): WindowAperture {
  return { id: `${roomId}-win`, roomId, azimuthDeg, midpoint: { x: 0, z: 0 } };
}

function scoreOf(rooms: ReturnType<typeof analyzeHumidity>['rooms'], roomId: string): number {
  const r = rooms.find((x) => x.roomId === roomId);
  assert.ok(r, `room ${roomId} present`);
  return r!.score;
}

describe('isInHuinanWindow', () => {
  it('窗口内/外/边界', () => {
    assert.equal(isInHuinanWindow(HUINAN_DATE, WINDOW), true);
    assert.equal(isInHuinanWindow(DRY_DATE, WINDOW), false);
    assert.equal(isInHuinanWindow({ month: 2, day: 15 }, WINDOW), true);
    assert.equal(isInHuinanWindow({ month: 4, day: 15 }, WINDOW), true);
    assert.equal(isInHuinanWindow({ month: 4, day: 16 }, WINDOW), false);
  });
});

describe('toTier', () => {
  it('边界：<25 low / 25-50 medium / >50 high', () => {
    assert.equal(toTier(24), 'low');
    assert.equal(toTier(25), 'medium');
    assert.equal(toTier(50), 'medium');
    assert.equal(toTier(51), 'high');
  });
});

describe('analyzeHumidity 房间评分', () => {
  it('湿源单调性：high > medium > low', () => {
    const decls = {
      a: { moisture: 'high', ventilation: 'mechanical' },
      b: { moisture: 'medium', ventilation: 'mechanical' },
      c: { moisture: 'low', ventilation: 'mechanical' },
    } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a', 'b', 'c'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.ok(scoreOf(rooms, 'a') > scoreOf(rooms, 'b'));
    assert.ok(scoreOf(rooms, 'b') > scoreOf(rooms, 'c'));
  });

  it('通风单调性：cross < mechanical < single_side', () => {
    const decls = {
      a: { moisture: 'medium', ventilation: 'cross' },
      b: { moisture: 'medium', ventilation: 'mechanical' },
      c: { moisture: 'medium', ventilation: 'single_side' },
    } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a', 'b', 'c'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.ok(scoreOf(rooms, 'a') < scoreOf(rooms, 'b'));
    assert.ok(scoreOf(rooms, 'b') < scoreOf(rooms, 'c'));
  });

  it('仅北向采光 +10；南向不得分；无采光面不得分', () => {
    const decls = { a: { moisture: 'low', ventilation: 'mechanical' } } as const;
    const north = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 0), aperture('a', 350)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const south = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 180)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const mixed = analyzeHumidity({ roomIds: ['a'], apertures: [aperture('a', 0), aperture('a', 180)], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const none = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(north.rooms, 'a'), 10);
    assert.equal(scoreOf(south.rooms, 'a'), 0);
    assert.equal(scoreOf(mixed.rooms, 'a'), 0);
    assert.equal(scoreOf(none.rooms, 'a'), 0);
  });

  it('回南天冷表面：窗口内 +20，窗口外 0', () => {
    const decls = { a: { moisture: 'low', ventilation: 'open', cold_surface: 'slab' } } as const;
    const inWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: HUINAN_DATE, huinanWindow: WINDOW });
    const outWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(inWin.rooms, 'a'), 15);
    assert.equal(scoreOf(outWin.rooms, 'a'), 0);
  });

  it('未声明房间走默认（low + single_side = 10）且 declared=false', () => {
    const { rooms } = analyzeHumidity({ roomIds: ['x'], apertures: [], date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(rooms, 'x'), 10);
    assert.equal(rooms[0].declared, false);
  });

  it('声明房间 declared=true 且 factors 含非零因子', () => {
    const decls = { a: { moisture: 'high', ventilation: 'single_side' } } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    const r = rooms[0];
    assert.equal(r.declared, true);
    assert.equal(r.score, 40);
    assert.deepEqual(r.factors.map((f) => f.delta).sort((m, n) => m - n), [10, 30]);
  });

  it('分数 clamp 到 0-100', () => {
    const decls = { a: { moisture: 'low', ventilation: 'cross' } } as const;
    const { rooms } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(scoreOf(rooms, 'a'), 0);
  });
});

describe('analyzeHumidity 重点表面', () => {
  const surfaceDecls = [
    { id: 'slab1', room: 'a', kind: 'slab' as const },
    { id: 'wall1', room: 'a', kind: 'ext_wall' as const, faces: 'north' },
    { id: 'corner1', room: 'a', kind: 'corner' as const },
  ];

  it('slab 仅窗口内 +15', () => {
    const decls = { a: { moisture: 'medium', ventilation: 'mechanical' } } as const;
    const inWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: HUINAN_DATE, huinanWindow: WINDOW });
    const outWin = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(inWin.surfaces.find((s) => s.id === 'slab1')!.score, 30);
    assert.equal(outWin.surfaces.find((s) => s.id === 'slab1')!.score, 15);
  });

  it('ext_wall +10 / corner +10，携带 faces', () => {
    const decls = { a: { moisture: 'medium', ventilation: 'mechanical' } } as const;
    const { surfaces } = analyzeHumidity({ roomIds: ['a'], apertures: [], roomDecls: decls, surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.score, 25);
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.faces, 'north');
    assert.equal(surfaces.find((s) => s.id === 'corner1')!.score, 25);
  });

  it('表面所属房间未声明时按默认房间分计算', () => {
    const { surfaces } = analyzeHumidity({ roomIds: ['a'], apertures: [], surfaceDecls, date: DRY_DATE, huinanWindow: WINDOW });
    assert.equal(surfaces.find((s) => s.id === 'wall1')!.score, 20);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/shared/humidity-model.test.ts`
Expected: FAIL — `Cannot find module '../../../shared/humidity-model.js'`

- [ ] **Step 3: 实现 `shared/humidity-model.ts`**

```ts
import type { WindowAperture } from './glazing.js';

export type Moisture = 'low' | 'medium' | 'high';
export type Ventilation = 'cross' | 'open' | 'range_hood' | 'mechanical' | 'single_side';
export type Tier = 'low' | 'medium' | 'high';

export interface HumidityRoomDecl {
  moisture: Moisture;
  ventilation: Ventilation;
  cold_surface?: string;
}

export interface HumiditySurfaceDecl {
  id: string;
  room: string;
  kind: 'slab' | 'ext_wall' | 'corner';
  faces?: string;
}

export interface HumidityFactor {
  label: string;
  delta: number;
}

export interface RoomHumidity {
  roomId: string;
  score: number;
  tier: Tier;
  factors: HumidityFactor[];
  declared: boolean;
}

export interface SurfaceHumidity {
  id: string;
  room: string;
  kind: 'slab' | 'ext_wall' | 'corner';
  faces?: string;
  score: number;
  tier: Tier;
}

export interface HuinanWindow {
  start: string;
  end: string;
}

const MOISTURE_SCORE: Record<Moisture, number> = { low: 0, medium: 15, high: 30 };
const VENTILATION_SCORE: Record<Ventilation, number> = {
  cross: -10,
  open: -5,
  range_hood: -5,
  mechanical: 0,
  single_side: 10,
};
const DEFAULT_DECL: HumidityRoomDecl = { moisture: 'low', ventilation: 'single_side' };

function clampScore(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function mmdd(date: { month: number; day: number }): string {
  return `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function isInHuinanWindow(date: { month: number; day: number }, window: HuinanWindow): boolean {
  const d = mmdd(date);
  return d >= window.start && d <= window.end;
}

export function toTier(score: number): Tier {
  if (score < 25) return 'low';
  if (score <= 50) return 'medium';
  return 'high';
}

function isNorthBand(azimuthDeg: number): boolean {
  return azimuthDeg >= 315 || azimuthDeg <= 45;
}

export function analyzeHumidity(opts: {
  roomIds: string[];
  apertures: WindowAperture[];
  roomDecls?: Record<string, HumidityRoomDecl>;
  surfaceDecls?: HumiditySurfaceDecl[];
  date: { month: number; day: number };
  huinanWindow: HuinanWindow;
}): { rooms: RoomHumidity[]; surfaces: SurfaceHumidity[] } {
  const huinanActive = isInHuinanWindow(opts.date, opts.huinanWindow);

  const rooms: RoomHumidity[] = opts.roomIds.map((roomId) => {
    const declared = opts.roomDecls?.[roomId] !== undefined;
    const decl = opts.roomDecls?.[roomId] ?? DEFAULT_DECL;
    const factors: HumidityFactor[] = [];

    const moistureDelta = MOISTURE_SCORE[decl.moisture];
    if (moistureDelta !== 0) factors.push({ label: '湿源', delta: moistureDelta });

    const ventDelta = VENTILATION_SCORE[decl.ventilation];
    if (ventDelta !== 0) factors.push({ label: '通风', delta: ventDelta });

    const roomAps = opts.apertures.filter((a) => a.roomId === roomId);
    const northOnly = roomAps.length > 0 && roomAps.every((a) => isNorthBand(a.azimuthDeg));
    if (northOnly) factors.push({ label: '朝向（仅北向采光）', delta: 10 });

    if (decl.cold_surface && huinanActive) {
      factors.push({ label: '回南天冷表面', delta: 20 });
    }

    const score = clampScore(factors.reduce((sum, f) => sum + f.delta, 0));
    return { roomId, score, tier: toTier(score), factors, declared };
  });

  const scoreByRoom = new Map(rooms.map((r) => [r.roomId, r.score]));
  const surfaces: SurfaceHumidity[] = (opts.surfaceDecls ?? []).map((s) => {
    const roomScore = scoreByRoom.get(s.room) ?? 0;
    let mod = 0;
    if (s.kind === 'slab') mod = huinanActive ? 15 : 0;
    if (s.kind === 'ext_wall') mod = 10;
    if (s.kind === 'corner') mod = 10;
    const score = clampScore(roomScore + mod);
    return { id: s.id, room: s.room, kind: s.kind, faces: s.faces, score, tier: toTier(score) };
  });

  return { rooms, surfaces };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/shared/humidity-model.test.ts`
Expected: PASS（12 tests）

- [ ] **Step 5: 提交**

```bash
git add shared/humidity-model.ts tests/server/shared/humidity-model.test.ts
git commit -m "feat(humidity): room and surface condensation risk scoring model"
```

---

### Task 2: 服务端 `computeHumidityAnalysis` + `GET /api/analysis/humidity`

**Files:**
- Modify: `server/analysis-service.ts`（追加 `computeHumidityAnalysis` + `humidityAdvisories`）
- Modify: `server/analysis-routes.ts`（追加 `/humidity` 路由）
- Test: `tests/server/analysis-humidity.test.ts`

**Interfaces:**
- Consumes: `analyzeHumidity`（Task 1）、`extractApertures`（一期）、`EnvironmentConfig.humidity`（一期 schema）、`mergeSceneElements`、`ProjectCatalog`
- Produces:
  ```ts
  computeHumidityAnalysis(catalog, overlay, env, date): {
    confidence: 'estimated'; huinanActive: boolean;
    rooms: Array<{ id; name; score; tier; factors; declared }>;
    surfaces: Array<{ id; room; kind; faces?; score; tier }>;
  }
  humidityAdvisories(analysis: ReturnType<typeof computeHumidityAnalysis>): string[]
  ```
  `GET /api/analysis/humidity?date=MM-DD`：date 缺省 = 服务器当前日期；非法 → 400；env 缺失 → 503。
- Consumed by: Task 3（MCP）、Task 4（客户端）

- [ ] **Step 1: 写失败测试**

Create `tests/server/analysis-humidity.test.ts`:

```ts
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { createAnalysisRouter } from '../../server/analysis-routes.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { parseEnvironment } from '../../shared/environment-schema.js';

describe('GET /api/analysis/humidity', () => {
  let app: express.Express;
  const env = parseEnvironment(readFileSync('config/environment.yaml', 'utf8'));
  const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));

  before(() => {
    const catalog = ProjectCatalog.load('.');
    app = express();
    app.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => env, getOverlay: () => overlay })
    );
  });

  it('回南天日期：huinanActive=true，master_bath 评分 30（medium）', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=03-15');
    assert.equal(res.status, 200);
    assert.equal(res.body.confidence, 'estimated');
    assert.equal(res.body.huinanActive, true);
    const mbath = res.body.rooms.find((r: { id: string }) => r.id === 'master_bath');
    assert.equal(mbath.score, 30);
    assert.equal(mbath.tier, 'medium');
    assert.equal(mbath.declared, true);
    assert.ok(Array.isArray(mbath.factors));
  });

  it('entry_garden 回南天内得冷表面 +20（15-5+20=30），窗口外为 10', async () => {
    const inWin = await request(app).get('/api/analysis/humidity?date=03-15');
    const outWin = await request(app).get('/api/analysis/humidity?date=12-22');
    const eg = (body: { rooms: Array<{ id: string; score: number }> }) =>
      body.rooms.find((r) => r.id === 'entry_garden')!.score;
    assert.equal(eg(inWin.body), 30);
    assert.equal(eg(outWin.body), 10);
    assert.equal(outWin.body.huinanActive, false);
  });

  it('未声明房间 declared=false（master_bedroom 默认 10 分）', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=12-22');
    const mb = res.body.rooms.find((r: { id: string }) => r.id === 'master_bedroom');
    assert.equal(mb.declared, false);
    assert.equal(mb.score, 10);
  });

  it('表面：entry_garden_slab 窗口内 45 / 窗口外 25', async () => {
    const inWin = await request(app).get('/api/analysis/humidity?date=03-15');
    const outWin = await request(app).get('/api/analysis/humidity?date=12-22');
    const slab = (body: { surfaces: Array<{ id: string; score: number }> }) =>
      body.surfaces.find((s) => s.id === 'entry_garden_slab')!.score;
    assert.equal(slab(inWin.body), 45);
    assert.equal(slab(outWin.body), 25);
  });

  it('缺省日期返回当前日期形状合法', async () => {
    const res = await request(app).get('/api/analysis/humidity');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.rooms));
    assert.ok(res.body.rooms.length > 0);
  });

  it('非法 date → 400', async () => {
    const res = await request(app).get('/api/analysis/humidity?date=13-40');
    assert.equal(res.status, 400);
  });

  it('environment 未加载 → 503', async () => {
    const catalog = ProjectCatalog.load('.');
    const bare = express();
    bare.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => undefined, getOverlay: () => overlay })
    );
    const res = await request(bare).get('/api/analysis/humidity?date=03-15');
    assert.equal(res.status, 503);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/analysis-humidity.test.ts`
Expected: FAIL — 404（路由不存在）

- [ ] **Step 3: 扩展 `server/analysis-service.ts`**

在文件顶部 import 区追加：

```ts
import { analyzeHumidity } from '../shared/humidity-model.js';
```

文件末尾追加：

```ts
export function computeHumidityAnalysis(
  catalog: ProjectCatalog,
  overlay: OverlayConfig | undefined,
  env: EnvironmentConfig,
  date: { month: number; day: number }
) {
  const elements = mergeSceneElements(catalog.getWalls(), overlay);
  const rooms = catalog.getRooms();
  const centers = rooms.map((r) => ({ id: r.id, x: r.x, z: r.z }));
  const apertures = extractApertures(elements, centers, catalog.getWalls());

  const result = analyzeHumidity({
    roomIds: rooms.map((r) => r.id),
    apertures,
    roomDecls: env.humidity?.rooms,
    surfaceDecls: env.humidity?.surfaces,
    date,
    huinanWindow: env.climate.huinan_window,
  });

  const nameById = new Map(rooms.map((r) => [r.id, r.name]));
  return {
    confidence: 'estimated' as const,
    huinanActive: result.rooms.length > 0
      ? (() => {
          const mmdd = `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
          return mmdd >= env.climate.huinan_window.start && mmdd <= env.climate.huinan_window.end;
        })()
      : false,
    rooms: result.rooms.map((r) => ({
      id: r.roomId,
      name: nameById.get(r.roomId) ?? r.roomId,
      score: r.score,
      tier: r.tier,
      factors: r.factors,
      declared: r.declared,
    })),
    surfaces: result.surfaces,
  };
}

export function humidityAdvisories(
  analysis: ReturnType<typeof computeHumidityAnalysis>
): string[] {
  const advisories: string[] = [];
  for (const room of analysis.rooms) {
    if (room.tier === 'high') {
      advisories.push(`「${room.name}」湿度风险高（${room.score} 分）：建议配置除湿机并检查通风路径`);
    }
  }
  for (const surface of analysis.surfaces) {
    if (surface.tier !== 'high' && surface.score < 40) continue;
    if (surface.kind === 'slab') {
      advisories.push(`重点表面 ${surface.id}（地面，${surface.score} 分）：回南天结露高风险，建议地面防潮处理 + 除湿机就近取电`);
    } else if (surface.kind === 'ext_wall') {
      advisories.push(`重点表面 ${surface.id}（外墙，${surface.score} 分）：建议内墙防霉涂料`);
    } else {
      advisories.push(`重点表面 ${surface.id}（角部热桥，${surface.score} 分）：建议局部保温处理`);
    }
  }
  if (analysis.huinanActive) {
    advisories.push('当前日期处于回南天窗口（02-15 ~ 04-15），冷表面结露因子已生效');
  }
  return advisories;
}
```

- [ ] **Step 4: 扩展 `server/analysis-routes.ts`**

import 区将 `computeSunlightAnalysis` 一行改为：

```ts
import { computeSunlightAnalysis, computeHumidityAnalysis } from './analysis-service.js';
```

在 `router.get('/sunlight', ...)` 块之后追加：

```ts
  router.get('/humidity', (req, res) => {
    const env = deps.getEnvironment();
    if (!env) {
      res.status(503).json({ error: 'config/environment.yaml not loaded' });
      return;
    }
    let date: { month: number; day: number };
    if (req.query.date !== undefined) {
      const parsed = parseDateParam(req.query.date as string);
      if (!parsed) {
        res.status(400).json({ error: 'date must be MM-DD' });
        return;
      }
      date = parsed;
    } else {
      const now = new Date();
      date = { month: now.getMonth() + 1, day: now.getDate() };
    }
    res.json(computeHumidityAnalysis(deps.catalog, deps.getOverlay(), env, date));
  });
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/server/analysis-humidity.test.ts && npx tsx --test tests/server/analysis.test.ts`
Expected: PASS（新 7 个 + 一期 4 个不回归）

- [ ] **Step 6: 提交**

```bash
git add server/analysis-service.ts server/analysis-routes.ts tests/server/analysis-humidity.test.ts
git commit -m "feat(server): humidity risk analysis API with huinan-window awareness"
```

---

### Task 3: MCP 工具 `get_humidity_risks`

**Files:**
- Modify: `server/mcp-server.ts`
- Modify: `tests/server/mcp.test.ts`

**Interfaces:**
- Consumes: `computeHumidityAnalysis` + `humidityAdvisories`（Task 2）
- Produces: MCP 工具 `get_humidity_risks({ date?: 'MM-DD' })` → 文本（风险排序 + 因子 + 对策建议）

- [ ] **Step 1: 写失败测试**

在 `tests/server/mcp.test.ts` 末尾追加：

```ts
  it('get_humidity_risks 返回风险摘要与建议', async () => {
    const result = await client.callTool({ name: 'get_humidity_risks', arguments: { date: '03-15' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.includes('master_bath'));
    assert.ok(content[0].text.includes('回南天'));
  });

  it('get_humidity_risks 非法 date 返回错误文本', async () => {
    const result = await client.callTool({ name: 'get_humidity_risks', arguments: { date: '99-99' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('error'));
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/mcp.test.ts`
Expected: FAIL — 新测试报工具不存在（既有测试 PASS）

- [ ] **Step 3: 修改 `server/mcp-server.ts`**

import 区将一期所加的 `computeSunlightAnalysis` 一行改为：

```ts
import { computeSunlightAnalysis, computeHumidityAnalysis, humidityAdvisories } from './analysis-service.js';
```

在 `get_sunlight_analysis` 注册块之后追加：

```ts
  server.registerTool(
    'get_humidity_risks',
    {
      title: 'Get humidity risk assessment',
      description:
        'Static condensation/mold risk assessment per room and key surface (Nanning huinan-tian focused). Returns scores, tiers, factor breakdowns and countermeasure advisories. Date defaults to today; use 02-15~04-15 dates to activate huinan cold-surface factors.',
      inputSchema: z.object({
        date: z.string().optional().describe('MM-DD, default today'),
      }),
    },
    async (args) => {
      const env = deps.getEnvironment?.();
      if (!env) return text({ error: 'config/environment.yaml not loaded' });
      let date: { month: number; day: number };
      if (args.date !== undefined) {
        const m = /^(\d{2})-(\d{2})$/.exec(args.date);
        if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) {
          return text({ error: 'date must be MM-DD' });
        }
        date = { month: Number(m[1]), day: Number(m[2]) };
      } else {
        const now = new Date();
        date = { month: now.getMonth() + 1, day: now.getDate() };
      }
      const analysis = computeHumidityAnalysis(catalog, deps.getOverlay?.(), env, date);
      return text({ ...analysis, advisories: humidityAdvisories(analysis) });
    }
  );
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/mcp.test.ts`
Expected: PASS（含新增 2 个）

- [ ] **Step 5: 提交**

```bash
git add server/mcp-server.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add get_humidity_risks tool with advisories"
```

---

### Task 4: `HumidityOverlay` 风险叠加层

**Files:**
- Create: `app/src/render/analysis/HumidityOverlay.ts`
- Test: `app/src/render/analysis/HumidityOverlay.test.ts`

**Interfaces:**
- Consumes: `GET /api/analysis/humidity?date=MM-DD`（Task 2）、`HouseScene.getFloorMeshes()`/`rooms`/`scene`/`renderer`/`raycastRoomAtPointer()`
- Produces:
  ```ts
  class HumidityOverlay {
    constructor(houseScene: HouseScene)
    toggle(): Promise<void>
    isActive(): boolean
    refresh(date: string): Promise<void>
    updatePulse(): void
  }
  ```
  行为：floor 材质按 tier 着色（低绿 `#48bb78` / 中黄 `#ecc94b` / 高红 `#f56565`，transparent opacity 0.35，材质克隆-换回模式同一期修复后的 DaylightHeatmap）；high tier 表面 → 脉冲 sprite 标记（slab y=0.3 / ext_wall y=1.4 / corner y=1.4，置于所属房间中心）；激活期间点击 canvas → `raycastRoomAtPointer()` → `#humidity-info-panel` 显示房间因子拆解；`updatePulse()` 由 renderLoop 每帧调用（标记缩放 `1 + 0.2·sin(phase)`）。

- [ ] **Step 1: 写失败测试**

Create `app/src/render/analysis/HumidityOverlay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  return {
    Color: class { constructor(public hex: number | string = 0) {} set(h: number | string) { this.hex = h; return this; } },
    MeshStandardMaterial: class {
      color = { set: vi.fn(), hex: 0 };
      transparent = false;
      opacity = 1;
      clone() { return this; }
    },
    Sprite: class {
      position = new Vector3();
      scale = { x: 1, y: 1, z: 1, set: vi.fn() };
      visible = true;
      constructor(public material: unknown) {}
    },
    SpriteMaterial: class { constructor(public opts: unknown) {} dispose = vi.fn(); },
    CanvasTexture: class { constructor(public canvas: unknown) {} dispose = vi.fn(); },
    Vector3,
  };
});

import { HumidityOverlay } from './HumidityOverlay.js';

const BODY = {
  confidence: 'estimated',
  huinanActive: true,
  rooms: [
    { id: 'master_bath', name: '主卫', score: 55, tier: 'high', factors: [{ label: '湿源', delta: 30 }], declared: true },
    { id: 'living_dining', name: '客餐厅', score: 10, tier: 'low', factors: [], declared: true },
  ],
  surfaces: [
    { id: 'entry_garden_slab', room: 'master_bath', kind: 'slab', score: 60, tier: 'high' },
    { id: 'living_north_wall', room: 'living_dining', kind: 'ext_wall', faces: 'north', score: 20, tier: 'low' },
  ],
};

function makeHouseScene() {
  const floorMat = { color: { set: vi.fn(), hex: 0 }, transparent: false, opacity: 1, clone: vi.fn() };
  const floor = { userData: { roomId: 'master_bath' }, material: floorMat };
  const domElement = document.createElement('canvas');
  return {
    getFloorMeshes: () => [floor],
    rooms: { master_bath: { x: 2, z: 3, width: 2.6, depth: 4 }, living_dining: { x: 9, z: 7, width: 6, depth: 5 } },
    scene: { add: vi.fn(), remove: vi.fn() },
    renderer: { domElement },
    raycastRoomAtPointer: vi.fn(() => 'master_bath'),
    _floor: floor,
    _domElement: domElement,
  };
}

describe('HumidityOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => BODY })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('toggle 开启：拉取数据、按 tier 着色、高风险表面加标记', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    expect(overlay.isActive()).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/analysis/humidity?date=03-15');
    expect(hs._floor.material.color.set).toHaveBeenCalledWith('#f56565');
    expect(hs._floor.material.transparent).toBe(true);
    expect(hs.scene.add).toHaveBeenCalled();
  });

  it('toggle 关闭：恢复材质、移除标记、隐藏面板', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    await overlay.toggle();
    expect(overlay.isActive()).toBe(false);
    expect(hs._floor.material).toBe(hs._floor.material);
    expect(hs.scene.remove).toHaveBeenCalled();
  });

  it('点击房间显示因子面板', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    hs._domElement.dispatchEvent(new Event('click'));
    const panel = document.getElementById('humidity-info-panel');
    expect(panel).toBeTruthy();
    expect(panel!.innerHTML).toContain('主卫');
    expect(panel!.innerHTML).toContain('湿源');
  });

  it('res.ok=false 时不着色', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    expect(hs._floor.material.color.set).not.toHaveBeenCalled();
  });

  it('refresh 使用新日期', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    await overlay.refresh('12-22');
    expect(fetch).toHaveBeenLastCalledWith('/api/analysis/humidity?date=12-22');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/render/analysis/HumidityOverlay.test.ts`
Expected: FAIL — `Cannot find module './HumidityOverlay.js'`

- [ ] **Step 3: 实现 `app/src/render/analysis/HumidityOverlay.ts`**

```ts
import * as THREE from 'three';
import type { HouseScene } from '../HouseScene.js';

const TIER_COLORS: Record<string, string> = {
  low: '#48bb78',
  medium: '#ecc94b',
  high: '#f56565',
};

const OVERLAY_OPACITY = 0.35;
const DEFAULT_DATE = '03-15';

interface RoomResult {
  id: string;
  name: string;
  score: number;
  tier: string;
  factors: Array<{ label: string; delta: number }>;
  declared: boolean;
}

interface SurfaceResult {
  id: string;
  room: string;
  kind: string;
  faces?: string;
  score: number;
  tier: string;
}

export class HumidityOverlay {
  private active = false;
  private date = DEFAULT_DATE;
  private originalMaterials = new Map<THREE.Mesh, THREE.Material>();
  private markers: THREE.Sprite[] = [];
  private roomsResult: RoomResult[] = [];
  private panel: HTMLDivElement | null = null;
  private pulsePhase = 0;
  private boundOnClick: () => void;

  constructor(private houseScene: HouseScene) {
    this.boundOnClick = () => this.onClick();
  }

  isActive(): boolean {
    return this.active;
  }

  async toggle(): Promise<void> {
    if (this.active) {
      this.deactivate();
    } else {
      await this.activate();
    }
  }

  async refresh(date: string): Promise<void> {
    this.date = date;
    if (this.active) {
      this.restoreFloors();
      this.clearMarkers();
      await this.applyAnalysis();
    }
  }

  updatePulse(): void {
    if (!this.active || this.markers.length === 0) return;
    this.pulsePhase += 0.08;
    const s = 1.2 * (1 + 0.2 * Math.sin(this.pulsePhase));
    for (const marker of this.markers) {
      marker.scale.set(s, s, 1);
    }
  }

  private async activate(): Promise<void> {
    await this.applyAnalysis();
    this.houseScene.renderer.domElement.addEventListener('click', this.boundOnClick);
    this.active = true;
  }

  private deactivate(): void {
    this.restoreFloors();
    this.clearMarkers();
    this.hidePanel();
    this.houseScene.renderer.domElement.removeEventListener('click', this.boundOnClick);
    this.active = false;
  }

  private async applyAnalysis(): Promise<void> {
    const res = await fetch(`/api/analysis/humidity?date=${this.date}`);
    if (!res.ok) return;
    const data = (await res.json()) as { rooms: RoomResult[]; surfaces: SurfaceResult[] };
    this.roomsResult = data.rooms;
    const byId = new Map(data.rooms.map((r) => [r.id, r]));

    for (const mesh of this.houseScene.getFloorMeshes()) {
      const roomId = mesh.userData.roomId as string | undefined;
      if (!roomId) continue;
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, (mesh.material as THREE.MeshStandardMaterial).clone());
      }
      const result = byId.get(roomId);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(TIER_COLORS[result?.tier ?? 'low']);
      mat.transparent = true;
      mat.opacity = OVERLAY_OPACITY;
    }

    for (const surface of data.surfaces) {
      if (surface.tier !== 'high') continue;
      const room = (this.houseScene.rooms as Record<string, { x: number; z: number }>)[surface.room];
      if (!room) continue;
      const y = surface.kind === 'slab' ? 0.3 : 1.4;
      this.markers.push(this.makeMarker(surface, room.x, y, room.z));
    }
  }

  private makeMarker(surface: SurfaceResult, x: number, y: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f56565';
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff5f5';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(x, y, z);
    sprite.scale.set(1.2, 1.2, 1);
    this.houseScene.scene.add(sprite);
    return sprite;
  }

  private restoreFloors(): void {
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material;
    }
    this.originalMaterials.clear();
  }

  private clearMarkers(): void {
    for (const marker of this.markers) {
      this.houseScene.scene.remove(marker);
      const material = marker.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.markers = [];
  }

  private onClick(): void {
    const roomId = this.houseScene.raycastRoomAtPointer();
    const room = roomId ? this.roomsResult.find((r) => r.id === roomId) : undefined;
    if (!room) {
      this.hidePanel();
      return;
    }
    this.showPanel(room);
  }

  private showPanel(room: RoomResult): void {
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'humidity-info-panel';
      document.body.appendChild(this.panel);
    }
    const tierLabel: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };
    const factors = room.factors.length > 0
      ? room.factors.map((f) => `<div class="humidity-factor"><span>${f.label}</span><span>${f.delta > 0 ? '+' : ''}${f.delta}</span></div>`).join('')
      : '<div class="humidity-factor"><span>无显著风险因子</span><span>0</span></div>';
    this.panel.innerHTML = `
      <div class="humidity-info-header">
        <span>${room.name} · ${tierLabel[room.tier] ?? room.tier} · ${room.score} 分</span>
        <button id="humidity-info-close">×</button>
      </div>
      <div class="humidity-factors">${factors}</div>
      ${room.declared ? '' : '<div class="humidity-undeclared">未声明湿度因子，使用默认值</div>'}
    `;
    this.panel.style.display = 'block';
    this.panel.querySelector('#humidity-info-close')?.addEventListener('click', () => this.hidePanel());
  }

  private hidePanel(): void {
    if (this.panel) this.panel.style.display = 'none';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/render/analysis/HumidityOverlay.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add app/src/render/analysis/HumidityOverlay.ts app/src/render/analysis/HumidityOverlay.test.ts
git commit -m "feat(analysis): humidity risk overlay with tier coloring, markers and factor panel"
```

---

### Task 5: `HumidityButton` + index.html + CSS + App 接线

**Files:**
- Create: `app/src/ui/HumidityButton.ts`
- Modify: `app/index.html`
- Modify: `app/style.css`
- Modify: `app/src/App.ts`
- Test: `app/src/ui/HumidityButton.test.ts`

**Interfaces:**
- Consumes: `HumidityOverlay`（Task 4）、`isInHuinanWindow`（Task 1，经 `@shared/humidity-model`）、`SunlightPanel.setHuinanHint`（一期）
- Produces: `HumidityButton`（与 SunlightButton 同构）；App `setupHumidity()`；`onDateChange` 最终合并回调（setDate + 日照热力图 refresh + 湿度 refresh + 回南天提示）；renderLoop 调 `humidityOverlay.updatePulse()`。

- [ ] **Step 1: 写失败测试**

Create `app/src/ui/HumidityButton.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HumidityButton } from './HumidityButton.js';

describe('HumidityButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="humidity-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击触发 onToggle', () => {
    let toggled = false;
    const btn = new HumidityButton({ onToggle: () => { toggled = true; }, getActive: () => false });
    (document.getElementById('humidity-btn') as HTMLButtonElement).click();
    expect(toggled).toBe(true);
    btn.sync();
  });

  it('active 状态加高亮 class', () => {
    const btn = new HumidityButton({ onToggle: () => {}, getActive: () => true });
    btn.sync();
    expect((document.getElementById('humidity-btn') as HTMLButtonElement).classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new HumidityButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/ui/HumidityButton.test.ts`
Expected: FAIL — `Cannot find module './HumidityButton.js'`

- [ ] **Step 3: 实现 `app/src/ui/HumidityButton.ts`**

```ts
export class HumidityButton {
  private el: HTMLButtonElement;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: { onToggle: () => void; getActive: () => boolean }) {
    this.onToggle = opts.onToggle;
    this.getActive = opts.getActive;
    const el = document.getElementById('humidity-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('HumidityButton: #humidity-btn element not found in DOM');
    }
    this.el = el;
    this.el.addEventListener('click', () => this.onToggle());
    this.sync();
  }

  sync(): void {
    this.el.classList.toggle('active', this.getActive());
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/ui/HumidityButton.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 修改 `app/index.html`**

在 `<button id="sunlight-btn" title="日照模拟">日照</button>` 之后追加：

```html
    <button id="humidity-btn" title="湿度风险">湿度</button>
```

- [ ] **Step 6: 修改 `app/style.css`**

在 `#sunlight-btn.active` 规则块之后追加：

```css
#humidity-btn {
  position: fixed;
  top: 50px;
  right: 176px;
  background: rgba(20, 20, 30, 0.85);
  color: #ddd;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  z-index: 90;
  transition: background 0.2s, border-color 0.2s;
}

#humidity-btn:hover {
  background: rgba(40, 40, 60, 0.95);
  border-color: #88aaff;
}

#humidity-btn.active {
  background: rgba(60, 100, 180, 0.9);
  border-color: #88ccff;
  color: #fff;
}

#humidity-info-panel {
  position: fixed;
  left: 16px;
  bottom: 60px;
  z-index: 900;
  background: #1a1a2e;
  color: #e0e0e0;
  border-radius: 10px;
  padding: 12px 14px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  width: 240px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  display: none;
}

#humidity-info-panel .humidity-info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  margin-bottom: 8px;
}

#humidity-info-panel #humidity-info-close {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
}

#humidity-info-panel .humidity-factor {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  border-bottom: 1px solid #2a2a3e;
}

#humidity-info-panel .humidity-undeclared {
  margin-top: 8px;
  color: #8888aa;
  font-size: 12px;
}
```

- [ ] **Step 7: 修改 `app/src/App.ts`**

import 区追加：

```ts
import { HumidityOverlay } from './render/analysis/HumidityOverlay.js';
import { HumidityButton } from './ui/HumidityButton.js';
import { isInHuinanWindow } from '@shared/humidity-model';
```

字段区（`daylightHeatmap` 附近）追加：

```ts
  private humidityOverlay: HumidityOverlay | null = null;
  private humidityButton: HumidityButton | null = null;
```

`start()` 中 `this.setupSunlight();` 之后追加：

```ts
    this.setupHumidity();
```

类中新增私有方法：

```ts
  private setupHumidity(): void {
    this.humidityOverlay = new HumidityOverlay(this.houseScene);

    this.humidityButton = new HumidityButton({
      onToggle: () => {
        void this.humidityOverlay?.toggle().then(() => this.humidityButton?.sync());
      },
      getActive: () => this.humidityOverlay?.isActive() ?? false,
    });

    const huinanWindow = this.projectData?.environment?.climate?.huinan_window as
      | { start: string; end: string }
      | undefined;
    this.sunlightPanel.onDateChange((month, day) => {
      this.sunlightSystem?.setDate(month, day);
      const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      this.sunlightPanelDate = date;
      void this.daylightHeatmap?.refresh(date);
      void this.humidityOverlay?.refresh(date);
      if (huinanWindow) {
        this.sunlightPanel.setHuinanHint(isInHuinanWindow({ month, day }, huinanWindow));
      }
    });
  }
```

并在字段区追加（供合并回调记录当前面板日期）：

```ts
  private sunlightPanelDate = '12-22';
```

**同时删除** `setupSunlight()` 内一期所加的 `onDateChange` 注册（即 `this.sunlightPanel.onDateChange((month, day) => { this.sunlightSystem?.setDate(month, day); ... daylightHeatmap.refresh ... });` 整块）——单回调覆盖式，最终版在 `setupHumidity()` 中统一注册。`setupSunlight()` 保留其余内容（onHourChange/onPlayToggle/onHeatmapToggle/按钮）。

renderLoop 中一期所加 sunlight 块之后追加：

```ts
    this.humidityOverlay?.updatePulse();
```

（`updatePulse` 内部已按 active 与标记数量自守卫。）

- [ ] **Step 8: 运行全量 app 测试 + typecheck**

Run: `npm run test:app && npm run typecheck`
Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add app/src/ui/HumidityButton.ts app/src/ui/HumidityButton.test.ts app/index.html app/style.css app/src/App.ts
git commit -m "feat(app): wire humidity risk overlay with entry button and huinan hint"
```

---

### Task 6: 端到端验证与文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全量验证（铁律）**

Run: `npm run verify:all && npm run test:server && npm run test:app && npm run typecheck`
Expected: 全部 PASS。

- [ ] **Step 2: 无头冒烟**

后台启动 `npm run dev:server`，等待监听后（端口以输出为准；curl 需 `--noproxy '*'`）：

```bash
curl -s --noproxy '*' 'localhost:PORT/api/analysis/humidity?date=03-15'
```

Expected: JSON 含 `huinanActive: true`，`master_bath` score=30 tier=medium，`entry_garden_slab` score=45；`rooms` 中 `master_bedroom` declared=false。

```bash
curl -s --noproxy '*' 'localhost:PORT/api/analysis/humidity?date=12-22'
```

Expected: `huinanActive: false`，`entry_garden` score=10。

验证后停掉后台进程。

- [ ] **Step 3: 更新 README**

在一期所加的 `### 日照模拟` 小节之后追加：

```markdown
### 湿度风险评估

点击"湿度"按钮：各房间按结露/发霉风险等级着色（绿低/黄中/红高），高风险重点表面（回南天地面、朝北外墙、热桥角部）以脉冲标记显示，点击房间查看因子拆解。回南天窗口（02-15~04-15）内冷表面因子自动生效，日照面板会显示提示条。分析数据：`GET /api/analysis/humidity?date=MM-DD`，MCP 工具 `get_humidity_risks`。湿度因子声明见 `config/environment.yaml` 的 `humidity:` 段。
```

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: humidity risk assessment usage notes"
```

---

## Self-Review 结论

- **Spec 覆盖**：§5 模型（权重/分级/表面/默认值）→ Task 1；§7 REST 形状 + 503/400 + confidence → Task 2；§7 MCP `get_humidity_risks` → Task 3；§6.3 叠加层（tier 着色 opacity 0.35 / 脉冲标记 / 点击因子拆解）→ Task 4；§6.1 HumidityButton 入口 + 零快捷键 → Task 5；§6.2 回南天提示条二期启用 → Task 5（onDateChange 合并回调）；§8 declared:false 标注 → Task 1/2；§9 测试（单调性/窗口/默认）→ Task 1 内嵌。
- **占位符扫描**：无 TBD/TODO；所有代码块完整。
- **类型一致性**：`RoomHumidity/SurfaceHumidity/HuinanWindow`（Task 1）在 Task 2/5 引用一致；`computeHumidityAnalysis`/`humidityAdvisories` 签名 Task 2 定义、Task 3 调用一致；`HumidityOverlay` API（toggle/isActive/refresh/updatePulse）Task 4 定义、Task 5 消费一致；`isInHuinanWindow` Task 1 定义、Task 5 经 `@shared/humidity-model` 导入一致；按钮类名/DOM id/CSS 选择器（`#humidity-btn`、`#humidity-info-panel`）跨 Task 一致。
- **一期教训吸收**：按钮含 CSS 定位（Task 5 Step 6）；fetch `res.ok` 守卫（Task 4 实现内）；材质克隆-换回恢复（Task 4）；sprite dispose（Task 4 clearMarkers）。
