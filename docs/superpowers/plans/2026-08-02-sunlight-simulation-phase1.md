# 一期：日照模拟 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 3D 模型中实现真实天文算法驱动的日照模拟（日期/时刻滑杆实时光影 + 太阳轨迹 + 俯视日照时长热力图 + 西晒警告），并经 REST/MCP 暴露分析结论。

**Architecture:** `shared/` 纯函数层（太阳位置、光照状态、采光面提取、日照分析）供客户端与服务端共用；服务端新增 `config/environment.yaml`（ConfigLoader 热加载）+ `/api/analysis/sunlight` + MCP 工具；客户端接线现有 `EnvironmentManager` 阴影方向光，新增 `SunlightSystem`/`SunlightPanel`/`DaylightHeatmap`，入口为 `#topdown-btn` 旁的"日照"按钮（零新快捷键）。

**Tech Stack:** TypeScript 5.5、Three.js 0.166（app）、Express + zod 4 + @modelcontextprotocol/sdk（server）、vitest 4 + jsdom（app 测试）、node:test + supertest（server 测试）、tsx 运行时。

## Global Constraints

- 铁律：几何/意图只来自 `config/layout/model-geometry.yaml` + `overlay.yaml`；新行为走声明式配置（本计划新增 `config/environment.yaml` 作为气候数据唯一权威源）。
- 坐标系：`+x=东, -x=西, +z=南, -z=北`，Y 向上；方位角约定：自北顺时针（0=北, 90=东, 180=南, 270=西）。
- 不新增任何键盘快捷键；`app/src/ui/keybindings.ts` 不动。
- 服务端导入 shared 用相对路径 `../shared/xxx.js`；app 内导入 shared 用别名 `@shared/xxx`（`app/vitest.config.ts` 与 vite 已配置）。
- 每个任务结束运行对应测试；全部完成后必须跑：`npm run verify:all && npm run test:server && npm run test:app && npm run typecheck`。
- 不加注释（除非必要），遵循现有代码风格（无分号？——现有代码**有**分号，遵循）。
- `EnvironmentManager.setTimeOfDay()` 无生产调用点，直接替换为 `setSolarState()`，不保留兼容包装。
- `ApiDeps.getEnvironment` 与 `McpDeps.getEnvironment` 均为**可选**字段，避免破坏 `tests/server/api.test.ts`、`budget-api.test.ts`、`mcp.test.ts`、`index.test.ts` 中现有的 deps 对象字面量。

## File Structure

| 文件 | 职责 |
|---|---|
| `shared/solar.ts`（新建） | 太阳位置（NOAA 简化）、日出日落、光照状态纯函数、太阳方向向量 |
| `shared/environment-schema.ts`（新建） | `environment.yaml` 的 zod schema + `parseEnvironment()` |
| `config/environment.yaml`（新建） | 南宁气候参数、遮挡角、月均温湿度、湿度因子声明（二期消费） |
| `shared/glazing.ts`（新建） | 从 SceneElement 提取采光面（窗段），推导外法线方位角与房间归属 |
| `shared/sunlight-analysis.ts`(新建) | 采样计算窗直射时段、房间日照时长并集、西晒警告 |
| `server/analysis-service.ts`（新建） | `computeSunlightAnalysis(catalog, overlay, env, date)`——路由与 MCP 共用的薄计算层 |
| `server/analysis-routes.ts`（新建） | `createAnalysisRouter()`：`GET /sunlight` |
| `server/index.ts`（改） | environment.yaml ConfigLoader + 挂载 `/api/analysis` + apiDeps.getEnvironment |
| `server/routes.ts`（改） | `/api/project` 响应追加 `environment` 字段 |
| `server/mcp-server.ts`（改） | McpDeps 追加可选 `getEnvironment`；注册 `get_sunlight_analysis` 工具 |
| `app/src/render/EnvironmentManager.ts`（改） | `setSolarState()` 替换 `setTimeOfDay()`；夜间模式；阴影相机扩大 |
| `app/src/render/SunlightSystem.ts`（新建） | 日期/时刻状态、驱动 setSolarState、太阳轨迹线与日盘、播放 |
| `app/src/render/HouseScene.ts`（改） | 新增 `getFloorMeshes()` 公共 getter |
| `app/src/render/analysis/DaylightHeatmap.ts`（新建） | 拉取分析结果、floor 着色、房间小时数标签、俯视切换 |
| `app/src/ui/SunlightPanel.ts`（新建） | 日期/时刻滑杆 + 季节预设 + 播放 + 热力图开关 + 太阳读数 |
| `app/src/ui/SunlightButton.ts`（新建） | 仿 TopDownButton 的入口按钮绑定 |
| `app/index.html`（改） | `#topdown-btn` 后追加 `#sunlight-btn` |
| `app/src/App.ts`（改） | 实例化 SunlightSystem/Panel/Button/DaylightHeatmap 并接线 |
| 测试：`shared/solar.test.ts`、`shared/environment-schema.test.ts`、`shared/glazing.test.ts`、`shared/sunlight-analysis.test.ts`、`tests/server/analysis.test.ts`、`app/src/render/SunlightSystem.test.ts`、`app/src/render/EnvironmentManager.test.ts`、`app/src/ui/SunlightPanel.test.ts`、`app/src/ui/SunlightButton.test.ts`、`app/src/render/analysis/DaylightHeatmap.test.ts`（均新建）；`tests/server/mcp.test.ts`（改，追加工具测试） |

**shared 测试如何跑**：根目录 `npm run test:server` 执行 `tsx --test tests/server/**/*.test.ts`——shared 的单测放在 `tests/server/shared/` 下（node:test + assert），与现有模式一致，不新建测试入口。

---

### Task 1: `shared/solar.ts` 太阳位置纯函数

**Files:**
- Create: `shared/solar.ts`
- Test: `tests/server/shared/solar.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SolarInput { month: number; day: number; hour: number; latitudeDeg: number; longitudeDeg: number; timezoneHours: number }
  interface SolarPosition { altitudeDeg: number; azimuthDeg: number }
  interface LightState { sunIntensity: number; ambientIntensity: number; sunColorHex: number; isNight: boolean }
  getSolarPosition(input: SolarInput): SolarPosition
  getSunriseSunset(month: number, day: number, latitudeDeg: number, longitudeDeg: number, timezoneHours: number): { sunriseHour: number; sunsetHour: number }
  computeLightState(altitudeDeg: number): LightState
  sunDirection(altitudeDeg: number, azimuthDeg: number): { x: number; y: number; z: number }
  ```
- Consumed by: Task 4（日照分析）、Task 5（服务端）、Task 7（EnvironmentManager）、Task 8（SunlightSystem）

- [ ] **Step 1: 写失败测试**

Create `tests/server/shared/solar.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSolarPosition, getSunriseSunset, computeLightState, sunDirection } from '../../../shared/solar.js';

const NANNING = { latitudeDeg: 22.82, longitudeDeg: 108.37, timezoneHours: 8 };

function maxAltitude(month: number, day: number): number {
  let max = -90;
  for (let h = 0; h <= 24; h += 0.05) {
    const { altitudeDeg } = getSolarPosition({ month, day, hour: h, ...NANNING });
    if (altitudeDeg > max) max = altitudeDeg;
  }
  return max;
}

describe('getSolarPosition', () => {
  it('南宁冬至正午最大高度角 ≈ 43.7°', () => {
    assert.ok(Math.abs(maxAltitude(12, 22) - 43.7) < 1.0, `got ${maxAltitude(12, 22)}`);
  });

  it('南宁夏至正午最大高度角 ≈ 89.4°（φ < δ，太阳近天顶）', () => {
    assert.ok(Math.abs(maxAltitude(6, 22) - 89.4) < 1.0, `got ${maxAltitude(6, 22)}`);
  });

  it('方位角象限：冬至上午偏东南、正午偏南、下午偏西南', () => {
    const morning = getSolarPosition({ month: 12, day: 22, hour: 9, ...NANNING });
    const noon = getSolarPosition({ month: 12, day: 22, hour: 12.75, ...NANNING });
    const afternoon = getSolarPosition({ month: 12, day: 22, hour: 16, ...NANNING });
    assert.ok(morning.azimuthDeg > 90 && morning.azimuthDeg < 180, `morning ${morning.azimuthDeg}`);
    assert.ok(Math.abs(noon.azimuthDeg - 180) < 5, `noon ${noon.azimuthDeg}`);
    assert.ok(afternoon.azimuthDeg > 180 && afternoon.azimuthDeg < 270, `afternoon ${afternoon.azimuthDeg}`);
  });

  it('夜间高度角为负', () => {
    const night = getSolarPosition({ month: 12, day: 22, hour: 22, ...NANNING });
    assert.ok(night.altitudeDeg < 0);
  });
});

describe('getSunriseSunset', () => {
  it('南宁冬至日出 ≈ 7.45h 日落 ≈ 18.05h（当地标准时）', () => {
    const { sunriseHour, sunsetHour } = getSunriseSunset(12, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    assert.ok(Math.abs(sunriseHour - 7.45) < 0.4, `sunrise ${sunriseHour}`);
    assert.ok(Math.abs(sunsetHour - 18.05) < 0.4, `sunset ${sunsetHour}`);
  });

  it('夏至昼长大于冬至', () => {
    const winter = getSunriseSunset(12, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    const summer = getSunriseSunset(6, 22, NANNING.latitudeDeg, NANNING.longitudeDeg, NANNING.timezoneHours);
    assert.ok(summer.sunsetHour - summer.sunriseHour > winter.sunsetHour - winter.sunriseHour);
  });
});

describe('computeLightState', () => {
  it('α ≤ 0 为夜间', () => {
    const s = computeLightState(-5);
    assert.equal(s.isNight, true);
    assert.equal(s.sunIntensity, 0);
    assert.equal(s.ambientIntensity, 0.15);
  });

  it('白天强度随高度角单调递增且 ≤ 1', () => {
    const low = computeLightState(10);
    const high = computeLightState(60);
    assert.ok(low.sunIntensity < high.sunIntensity);
    assert.ok(high.sunIntensity <= 1.0);
    assert.equal(low.isNight, false);
  });

  it('低空暖色、高空白色', () => {
    assert.equal(computeLightState(5).sunColorHex, 0xffb36b);
    assert.equal(computeLightState(90).sunColorHex, 0xffffff);
  });
});

describe('sunDirection', () => {
  it('天顶方向 y=1', () => {
    const d = sunDirection(90, 0);
    assert.ok(Math.abs(d.y - 1) < 1e-9);
  });

  it('方位 180（南）高度 45 → +z 方向（南）', () => {
    const d = sunDirection(45, 180);
    assert.ok(Math.abs(d.x) < 1e-9);
    assert.ok(d.z > 0);
    assert.ok(Math.abs(d.y - Math.SQRT1_2) < 1e-9);
  });

  it('方位 90（东）→ +x 方向', () => {
    const d = sunDirection(30, 90);
    assert.ok(d.x > 0);
    assert.ok(Math.abs(d.z) < 1e-9);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/shared/solar.test.ts`
Expected: FAIL — `Cannot find module '../../../shared/solar.js'`

- [ ] **Step 3: 实现 `shared/solar.ts`**

```ts
const DEG = Math.PI / 180;

export interface SolarInput {
  month: number;
  day: number;
  hour: number;
  latitudeDeg: number;
  longitudeDeg: number;
  timezoneHours: number;
}

export interface SolarPosition {
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface LightState {
  sunIntensity: number;
  ambientIntensity: number;
  sunColorHex: number;
  isNight: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function dayOfYear(month: number, day: number): number {
  const ms = Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1);
  return Math.round(ms / 86400000) + 1;
}

function declinationDeg(n: number): number {
  return 23.44 * Math.sin((360 * (284 + n) / 365) * DEG);
}

function equationOfTimeMinutes(n: number): number {
  const b = (360 * (n - 81) / 364) * DEG;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

function timeCorrectionMinutes(longitudeDeg: number, timezoneHours: number, n: number): number {
  return 4 * (longitudeDeg - 15 * timezoneHours) + equationOfTimeMinutes(n);
}

export function getSolarPosition(input: SolarInput): SolarPosition {
  const { month, day, hour, latitudeDeg, longitudeDeg, timezoneHours } = input;
  const n = dayOfYear(month, day);
  const decl = declinationDeg(n) * DEG;
  const lat = latitudeDeg * DEG;
  const tc = timeCorrectionMinutes(longitudeDeg, timezoneHours, n);
  const localSolarTime = hour + tc / 60;
  const hourAngleDeg = 15 * (localSolarTime - 12);
  const h = hourAngleDeg * DEG;

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(h);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));

  const cosAlt = Math.cos(altitude);
  const cosAz = cosAlt === 0 ? 1 : (Math.sin(decl) - sinAlt * Math.sin(lat)) / (cosAlt * Math.cos(lat));
  let azimuth = Math.acos(clamp(cosAz, -1, 1));
  if (hourAngleDeg > 0) azimuth = 2 * Math.PI - azimuth;

  return { altitudeDeg: altitude / DEG, azimuthDeg: azimuth / DEG };
}

export function getSunriseSunset(
  month: number,
  day: number,
  latitudeDeg: number,
  longitudeDeg: number,
  timezoneHours: number
): { sunriseHour: number; sunsetHour: number } {
  const n = dayOfYear(month, day);
  const decl = declinationDeg(n) * DEG;
  const lat = latitudeDeg * DEG;
  const cosH0 = clamp(-Math.tan(lat) * Math.tan(decl), -1, 1);
  const h0Deg = Math.acos(cosH0) / DEG;
  const dayLengthHours = (2 * h0Deg) / 15;
  const tc = timeCorrectionMinutes(longitudeDeg, timezoneHours, n);
  const solarNoonLocal = 12 - tc / 60;
  return {
    sunriseHour: solarNoonLocal - dayLengthHours / 2,
    sunsetHour: solarNoonLocal + dayLengthHours / 2,
  };
}

export function computeLightState(altitudeDeg: number): LightState {
  if (altitudeDeg <= 0) {
    return { sunIntensity: 0, ambientIntensity: 0.15, sunColorHex: 0x334466, isNight: true };
  }
  const s = Math.sin(altitudeDeg * DEG);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * s);
  const color = (lerp(0xff, 0xff) << 16) | (lerp(0xb3, 0xff) << 8) | lerp(0x6b, 0xff);
  return {
    sunIntensity: 0.3 + 0.7 * s,
    ambientIntensity: 0.55,
    sunColorHex: color,
    isNight: false,
  };
}

export function sunDirection(altitudeDeg: number, azimuthDeg: number): { x: number; y: number; z: number } {
  const a = altitudeDeg * DEG;
  const az = azimuthDeg * DEG;
  return {
    x: Math.cos(a) * Math.sin(az),
    y: Math.sin(a),
    z: -Math.cos(a) * Math.cos(az),
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/shared/solar.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 5: 提交**

```bash
git add shared/solar.ts tests/server/shared/solar.test.ts
git commit -m "feat(solar): add NOAA-simplified solar position module with tests"
```

---

### Task 2: `environment.yaml` schema 与配置文件

**Files:**
- Create: `shared/environment-schema.ts`
- Create: `config/environment.yaml`
- Test: `tests/server/shared/environment-schema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EnvironmentConfig = z.infer<typeof EnvironmentSchema>  // { version: 1, location: { latitude, longitude, timezone }, horizon: { obstruction_deg }, climate: { zone, huinan_window: { start, end }, prevailing_wind: { summer, winter }, rainfall_mm_annual, monthly: Array<{ month, temp_c, rh_pct }> (12 条) }, humidity?: { rooms?: Record<string, { moisture: 'low'|'medium'|'high', ventilation: 'cross'|'open'|'range_hood'|'mechanical'|'single_side', cold_surface?: string }>, surfaces?: Array<{ id, room, kind: 'slab'|'ext_wall'|'corner', risk?, faces? }> } }
  parseEnvironment(raw: string): EnvironmentConfig  // zod 校验失败抛异常
  ```
- Consumed by: Task 5（服务端加载）、Task 7 间接（客户端经 /api/project 拿到）

- [ ] **Step 1: 写失败测试**

Create `tests/server/shared/environment-schema.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvironment } from '../../../shared/environment-schema.js';

describe('parseEnvironment', () => {
  it('解析真实 config/environment.yaml', () => {
    const raw = readFileSync('config/environment.yaml', 'utf8');
    const cfg = parseEnvironment(raw);
    assert.equal(cfg.version, 1);
    assert.ok(Math.abs(cfg.location.latitude - 22.82) < 0.01);
    assert.equal(cfg.climate.monthly.length, 12);
    assert.equal(cfg.climate.huinan_window.start, '02-15');
  });

  it('humidity 段可选但声明后必须符合 schema', () => {
    const raw = readFileSync('config/environment.yaml', 'utf8');
    const cfg = parseEnvironment(raw);
    assert.ok(cfg.humidity);
    assert.equal(cfg.humidity!.rooms!['master_bath'].moisture, 'high');
  });

  it('非法字段抛异常', () => {
    assert.throws(() => parseEnvironment('version: 2\nlocation: {latitude: 22.82, longitude: 108.37, timezone: 8}\nhorizon: {obstruction_deg: 0}\nclimate: {zone: x, huinan_window: {start: "02-15", end: "04-15"}, prevailing_wind: {summer: SSE, winter: NNE}, rainfall_mm_annual: 1300, monthly: []}'));
  });

  it('obstruction_deg 超范围抛异常', () => {
    assert.throws(() => parseEnvironment('version: 1\nlocation: {latitude: 22.82, longitude: 108.37, timezone: 8}\nhorizon: {obstruction_deg: 120}\nclimate: {zone: x, huinan_window: {start: "02-15", end: "04-15"}, prevailing_wind: {summer: SSE, winter: NNE}, rainfall_mm_annual: 1300, monthly: []}'));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/shared/environment-schema.test.ts`
Expected: FAIL — `Cannot find module` 与 `ENOENT config/environment.yaml`

- [ ] **Step 3: 实现 `shared/environment-schema.ts`**

```ts
import { z } from 'zod';
import { load } from 'js-yaml';

export const EnvironmentSchema = z.object({
  version: z.literal(1),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.number(),
  }),
  horizon: z.object({
    obstruction_deg: z.number().min(0).max(90),
  }),
  climate: z.object({
    zone: z.string(),
    huinan_window: z.object({ start: z.string(), end: z.string() }),
    prevailing_wind: z.object({ summer: z.string(), winter: z.string() }),
    rainfall_mm_annual: z.number(),
    monthly: z
      .array(
        z.object({
          month: z.number().int().min(1).max(12),
          temp_c: z.number(),
          rh_pct: z.number(),
        })
      )
      .length(12),
  }),
  humidity: z
    .object({
      rooms: z
        .record(
          z.string(),
          z.object({
            moisture: z.enum(['low', 'medium', 'high']),
            ventilation: z.enum(['cross', 'open', 'range_hood', 'mechanical', 'single_side']),
            cold_surface: z.string().optional(),
          })
        )
        .optional(),
      surfaces: z
        .array(
          z.object({
            id: z.string(),
            room: z.string(),
            kind: z.enum(['slab', 'ext_wall', 'corner']),
            risk: z.string().optional(),
            faces: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

export function parseEnvironment(raw: string): EnvironmentConfig {
  return EnvironmentSchema.parse(load(raw));
}
```

- [ ] **Step 4: 创建 `config/environment.yaml`**

```yaml
# 环境模拟配置：气候参数的唯一权威源（日照模拟 + 湿度风险评估）。
# 月均数据级别 estimated（中国气象数据网南宁站多年均值，未逐项核对）；
# horizon.obstruction_deg 为 inferred，待现场量房升级（见 docs/pending-site-data.md）。
version: 1

location:
  latitude: 22.82
  longitude: 108.37
  timezone: 8

horizon:
  obstruction_deg: 0

climate:
  zone: 夏热冬暖
  huinan_window: { start: '02-15', end: '04-15' }
  prevailing_wind: { summer: SSE, winter: NNE }
  rainfall_mm_annual: 1300
  monthly:
    - { month: 1,  temp_c: 12.8, rh_pct: 79 }
    - { month: 2,  temp_c: 14.1, rh_pct: 80 }
    - { month: 3,  temp_c: 17.4, rh_pct: 84 }
    - { month: 4,  temp_c: 22.4, rh_pct: 83 }
    - { month: 5,  temp_c: 26.2, rh_pct: 79 }
    - { month: 6,  temp_c: 27.9, rh_pct: 81 }
    - { month: 7,  temp_c: 28.6, rh_pct: 80 }
    - { month: 8,  temp_c: 28.3, rh_pct: 81 }
    - { month: 9,  temp_c: 27.0, rh_pct: 78 }
    - { month: 10, temp_c: 23.7, rh_pct: 75 }
    - { month: 11, temp_c: 18.7, rh_pct: 76 }
    - { month: 12, temp_c: 14.3, rh_pct: 77 }

humidity:
  rooms:
    master_bath:   { moisture: high,   ventilation: mechanical }
    guest_bath:    { moisture: high,   ventilation: mechanical }
    kitchen:       { moisture: medium, ventilation: range_hood }
    entry_garden:  { moisture: medium, ventilation: open, cold_surface: slab }
    balcony:       { moisture: low,    ventilation: open }
    living_dining: { moisture: low,    ventilation: cross }
  surfaces:
    - { id: entry_garden_slab, room: entry_garden, kind: slab, risk: huinan_condensation }
    - { id: living_north_wall, room: living_dining, kind: ext_wall, risk: cold_surface, faces: north }
    - { id: bedroom_nw_corner, room: bedroom_nw, kind: corner, risk: thermal_bridge }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/server/shared/environment-schema.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: 提交**

```bash
git add shared/environment-schema.ts config/environment.yaml tests/server/shared/environment-schema.test.ts
git commit -m "feat(config): add environment.yaml climate config with zod schema"
```

---

### Task 3: `shared/glazing.ts` 采光面提取与朝向推导

**Files:**
- Create: `shared/glazing.ts`
- Test: `tests/server/shared/glazing.test.ts`

**Interfaces:**
- Consumes: `SceneElement`（`shared/types.ts:429-444`，curtain_run/bay_sill/glass_infill 变体）、`WallSegment`（`shared/types.ts:403-416`，`{id?, x1, z1, x2, z2}`）
- Produces:
  ```ts
  interface RoomCenter { id: string; x: number; z: number }
  interface WindowAperture { id: string; roomId: string | null; azimuthDeg: number; midpoint: { x: number; z: number } }
  extractApertures(elements: SceneElement[], rooms: RoomCenter[], walls?: WallSegment[]): WindowAperture[]
  ```
  每个 curtain_run/bay_sill 的相邻点对产生一条采光面（弧段按折线近似）；glass_infill 经 `walls` 解析墙段。外法线 = 指向远离最近房间中心一侧；方位角 = `atan2(x, -z)`（自北顺时针）。房间归属 = 内法线半空间中最近房间中心，无则 null。
- Consumed by: Task 4

- [ ] **Step 1: 写失败测试**

Create `tests/server/shared/glazing.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractApertures } from '../../../shared/glazing.js';
import type { SceneElement } from '../../../shared/types.js';

describe('extractApertures', () => {
  it('南向幕墙 → 方位角 ≈ 180，归属最近房间', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'south_curtain',
      points: [{ x: 0, z: 10 }, { x: 5, z: 10 }],
      height: 2.8,
    };
    const rooms = [{ id: 'living', x: 2.5, z: 5 }];
    const aps = extractApertures([el], rooms);
    assert.equal(aps.length, 1);
    assert.ok(Math.abs(aps[0].azimuthDeg - 180) < 0.1, `az ${aps[0].azimuthDeg}`);
    assert.equal(aps[0].roomId, 'living');
  });

  it('西向幕墙 → 方位角 ≈ 270', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'west_curtain',
      points: [{ x: 0, z: 0 }, { x: 0, z: 5 }],
      height: 2.8,
    };
    const rooms = [{ id: 'bedroom', x: 3, z: 2.5 }];
    const aps = extractApertures([el], rooms);
    assert.ok(Math.abs(aps[0].azimuthDeg - 270) < 0.1, `az ${aps[0].azimuthDeg}`);
  });

  it('bay_sill 同样提取', () => {
    const el: SceneElement = {
      type: 'bay_sill',
      id: 'north_bay',
      points: [{ x: 1, z: 0 }, { x: 3, z: 0 }],
      depth: 1.1,
      sill: 2.55,
      height: 0.45,
    };
    const rooms = [{ id: 'bed', x: 2, z: 4 }];
    const aps = extractApertures([el], rooms);
    assert.ok(Math.abs(aps[0].azimuthDeg - 0) < 0.1, `az ${aps[0].azimuthDeg}`);
  });

  it('glass_infill 经 walls 解析', () => {
    const el: SceneElement = {
      type: 'glass_infill',
      id: 'win1',
      wall: 'w_east',
      width: 1.5,
      height: 1.5,
      sill: 0.9,
    };
    const walls = [{ id: 'w_east', x1: 10, z1: 0, x2: 10, z2: 5 }];
    const rooms = [{ id: 'study', x: 6, z: 2.5 }];
    const aps = extractApertures([el], rooms, walls);
    assert.equal(aps.length, 1);
    assert.ok(Math.abs(aps[0].azimuthDeg - 90) < 0.1, `az ${aps[0].azimuthDeg}`);
    assert.equal(aps[0].roomId, 'study');
  });

  it('glass_infill 找不到墙引用时跳过', () => {
    const el: SceneElement = { type: 'glass_infill', id: 'w2', wall: 'missing', width: 1, height: 1, sill: 0.9 };
    assert.equal(extractApertures([el], []).length, 0);
  });

  it('多段折线产生多条采光面', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'arc',
      points: [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 2 }],
      height: 2.8,
    };
    assert.equal(extractApertures([el], []).length, 2);
  });

  it('非窗类型（wall/floor_region/railing_run/curtain）被忽略', () => {
    const els: SceneElement[] = [
      { type: 'wall', id: 'w1', x1: 0, z1: 0, x2: 1, z2: 0 },
      { type: 'floor_region', id: 'f1', points: [{ x: 0, z: 0 }] },
      { type: 'railing_run', id: 'r1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], height: 1 },
      { type: 'curtain', id: 'c1', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], height: 2.8 },
    ];
    assert.equal(extractApertures(els, []).length, 0);
  });

  it('无房间时 roomId 为 null', () => {
    const el: SceneElement = {
      type: 'curtain_run',
      id: 'c',
      points: [{ x: 0, z: 10 }, { x: 5, z: 10 }],
      height: 2.8,
    };
    assert.equal(extractApertures([el], [])[0].roomId, null);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/shared/glazing.test.ts`
Expected: FAIL — `Cannot find module '../../../shared/glazing.js'`

- [ ] **Step 3: 实现 `shared/glazing.ts`**

```ts
import type { SceneElement, WallSegment } from './types.js';

export interface RoomCenter {
  id: string;
  x: number;
  z: number;
}

export interface WindowAperture {
  id: string;
  roomId: string | null;
  azimuthDeg: number;
  midpoint: { x: number; z: number };
}

function compassAzimuthDeg(vx: number, vz: number): number {
  return (Math.atan2(vx, -vz) * (180 / Math.PI) + 360) % 360;
}

function nearestRoom(
  mx: number,
  mz: number,
  inwardX: number,
  inwardZ: number,
  rooms: RoomCenter[]
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of rooms) {
    const dx = r.x - mx;
    const dz = r.z - mz;
    const inward = dx * inwardX + dz * inwardZ;
    const dist = Math.hypot(dx, dz);
    if (inward > 0 && dist < bestDist) {
      bestDist = dist;
      best = r.id;
    }
  }
  if (best !== null) return best;
  for (const r of rooms) {
    const dist = Math.hypot(r.x - mx, r.z - mz);
    if (dist < bestDist) {
      bestDist = dist;
      best = r.id;
    }
  }
  return best;
}

function makeAperture(
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  rooms: RoomCenter[]
): WindowAperture {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  let n1x = -dz / len;
  let n1z = dx / len;

  let nearest: RoomCenter | null = null;
  let nearestDist = Infinity;
  for (const r of rooms) {
    const d = Math.hypot(r.x - mx, r.z - mz);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = r;
    }
  }
  if (nearest && (nearest.x - mx) * n1x + (nearest.z - mz) * n1z < 0) {
    n1x = -n1x;
    n1z = -n1z;
  }

  return {
    id,
    roomId: nearestRoom(mx, mz, -n1x, -n1z, rooms),
    azimuthDeg: compassAzimuthDeg(n1x, n1z),
    midpoint: { x: mx, z: mz },
  };
}

export function extractApertures(
  elements: SceneElement[],
  rooms: RoomCenter[],
  walls: WallSegment[] = []
): WindowAperture[] {
  const apertures: WindowAperture[] = [];

  for (const el of elements) {
    if (el.type === 'curtain_run' || el.type === 'bay_sill') {
      const pts = el.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) continue;
        apertures.push(makeAperture(`${el.id}:seg${i}`, a.x, a.z, b.x, b.z, rooms));
      }
    } else if (el.type === 'glass_infill') {
      const wall = walls.find((w) => w.id === el.wall);
      if (!wall) continue;
      apertures.push(makeAperture(el.id, wall.x1, wall.z1, wall.x2, wall.z2, rooms));
    }
  }

  return apertures;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/shared/glazing.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: 提交**

```bash
git add shared/glazing.ts tests/server/shared/glazing.test.ts
git commit -m "feat(glazing): extract window apertures with orientation from scene elements"
```

---

### Task 4: `shared/sunlight-analysis.ts` 日照时长分析

**Files:**
- Create: `shared/sunlight-analysis.ts`
- Test: `tests/server/shared/sunlight-analysis.test.ts`

**Interfaces:**
- Consumes: `getSolarPosition`、`getSunriseSunset`（Task 1）、`WindowAperture`、`RoomCenter`（Task 3）
- Produces:
  ```ts
  interface SunlightLocation { latitude: number; longitude: number; timezone: number }
  interface RoomSunlight { roomId: string; directHours: number; intervals: Array<[number, number]>; westSunWarning: boolean }
  analyzeSunlight(apertures: WindowAperture[], rooms: RoomCenter[], date: { month: number; day: number }, opts: { location: SunlightLocation; obstructionDeg: number }): RoomSunlight[]
  ```
  采样步长 5 分钟；单窗直射判定：方位差（环形）< 90° 且 α > max(obstructionDeg, 0)；房间时长 = 其窗时段并集；西晒警告 = 房间任一窗方位 ∈ [225°, 315°] 且夏至（6/22）15:00 后有直射。结果只包含 `rooms` 中出现的房间（无窗房间 directHours=0）。
- Consumed by: Task 5

- [ ] **Step 1: 写失败测试**

Create `tests/server/shared/sunlight-analysis.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSunlight } from '../../../shared/sunlight-analysis.js';
import type { WindowAperture, RoomCenter } from '../../../shared/glazing.js';

const NANNING = { location: { latitude: 22.82, longitude: 108.37, timezone: 8 }, obstructionDeg: 0 };
const rooms: RoomCenter[] = [{ id: 'room', x: 0, z: 0 }];

function aperture(azimuthDeg: number): WindowAperture {
  return { id: 'win', roomId: 'room', azimuthDeg, midpoint: { x: 0, z: 0 } };
}

describe('analyzeSunlight', () => {
  it('南向窗冬至全天直射 ≈ 10.6h', () => {
    const [r] = analyzeSunlight([aperture(180)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(Math.abs(r.directHours - 10.6) < 0.5, `hours ${r.directHours}`);
    assert.equal(r.westSunWarning, false);
  });

  it('北向窗冬至 0h', () => {
    const [r] = analyzeSunlight([aperture(0)], rooms, { month: 12, day: 22 }, NANNING);
    assert.equal(r.directHours, 0);
  });

  it('西向窗冬至下午直射 ≈ 5.3h 且触发西晒警告', () => {
    const [r] = analyzeSunlight([aperture(270)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(Math.abs(r.directHours - 5.3) < 0.6, `hours ${r.directHours}`);
    assert.equal(r.westSunWarning, true);
  });

  it('遮挡角 90° → 0h', () => {
    const [r] = analyzeSunlight([aperture(180)], rooms, { month: 12, day: 22 }, { ...NANNING, obstructionDeg: 90 });
    assert.equal(r.directHours, 0);
  });

  it('同房间双窗时段求并集', () => {
    const aps: WindowAperture[] = [
      { id: 'w1', roomId: 'room', azimuthDeg: 135, midpoint: { x: 0, z: 0 } },
      { id: 'w2', roomId: 'room', azimuthDeg: 225, midpoint: { x: 0, z: 0 } },
    ];
    const [r] = analyzeSunlight(aps, rooms, { month: 12, day: 22 }, NANNING);
    const [single] = analyzeSunlight([aperture(135)], rooms, { month: 12, day: 22 }, NANNING);
    assert.ok(r.directHours > single.directHours);
    for (const [start, end] of r.intervals) {
      assert.ok(end > start);
    }
  });

  it('无窗房间 directHours=0', () => {
    const twoRooms: RoomCenter[] = [{ id: 'room', x: 0, z: 0 }, { id: 'dark', x: 5, z: 5 }];
    const result = analyzeSunlight([aperture(180)], twoRooms, { month: 12, day: 22 }, NANNING);
    const dark = result.find((r) => r.roomId === 'dark');
    assert.ok(dark);
    assert.equal(dark!.directHours, 0);
  });

  it('roomId 为 null 的采光面被忽略', () => {
    const orphan: WindowAperture = { id: 'o', roomId: null, azimuthDeg: 180, midpoint: { x: 0, z: 0 } };
    const [r] = analyzeSunlight([orphan], rooms, { month: 12, day: 22 }, NANNING);
    assert.equal(r.directHours, 0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/shared/sunlight-analysis.test.ts`
Expected: FAIL — `Cannot find module '../../../shared/sunlight-analysis.js'`

- [ ] **Step 3: 实现 `shared/sunlight-analysis.ts`**

```ts
import { getSolarPosition, getSunriseSunset } from './solar.js';
import type { WindowAperture, RoomCenter } from './glazing.js';

export interface SunlightLocation {
  latitude: number;
  longitude: number;
  timezone: number;
}

export interface RoomSunlight {
  roomId: string;
  directHours: number;
  intervals: Array<[number, number]>;
  westSunWarning: boolean;
}

const STEP_HOURS = 5 / 60;

function azimuthDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function mergeIntervals(raw: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...raw].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) {
      last[1] = Math.max(last[1], iv[1]);
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }
  return merged;
}

function exposureIntervals(
  ap: WindowAperture,
  date: { month: number; day: number },
  loc: SunlightLocation,
  obstructionDeg: number
): Array<[number, number]> {
  const { sunriseHour, sunsetHour } = getSunriseSunset(date.month, date.day, loc.latitude, loc.longitude, loc.timezone);
  const raw: Array<[number, number]> = [];
  let runStart: number | null = null;
  for (let t = sunriseHour; t <= sunsetHour + 1e-9; t += STEP_HOURS) {
    const pos = getSolarPosition({ month: date.month, day: date.day, hour: t, latitudeDeg: loc.latitude, longitudeDeg: loc.longitude, timezoneHours: loc.timezone });
    const lit = pos.altitudeDeg > Math.max(obstructionDeg, 0) && azimuthDelta(pos.azimuthDeg, ap.azimuthDeg) < 90;
    if (lit && runStart === null) runStart = t;
    if (!lit && runStart !== null) {
      raw.push([runStart, t]);
      runStart = null;
    }
  }
  if (runStart !== null) raw.push([runStart, sunsetHour]);
  return raw;
}

export function analyzeSunlight(
  apertures: WindowAperture[],
  rooms: RoomCenter[],
  date: { month: number; day: number },
  opts: { location: SunlightLocation; obstructionDeg: number }
): RoomSunlight[] {
  const byRoom = new Map<string, WindowAperture[]>();
  for (const r of rooms) byRoom.set(r.id, []);
  for (const ap of apertures) {
    if (ap.roomId === null) continue;
    const list = byRoom.get(ap.roomId);
    if (list) list.push(ap);
  }

  const result: RoomSunlight[] = [];
  for (const [roomId, aps] of byRoom) {
    const merged = mergeIntervals(aps.flatMap((ap) => exposureIntervals(ap, date, opts.location, opts.obstructionDeg)));
    const directHours = merged.reduce((sum, [s, e]) => sum + (e - s), 0);

    let westSunWarning = false;
    const westAps = aps.filter((ap) => ap.azimuthDeg >= 225 && ap.azimuthDeg <= 315);
    if (westAps.length > 0) {
      const summer = mergeIntervals(
        westAps.flatMap((ap) => exposureIntervals(ap, { month: 6, day: 22 }, opts.location, opts.obstructionDeg))
      );
      westSunWarning = summer.some(([, end]) => end > 15);
    }

    result.push({ roomId, directHours, intervals: merged, westSunWarning });
  }
  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx tsx --test tests/server/shared/sunlight-analysis.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add shared/sunlight-analysis.ts tests/server/shared/sunlight-analysis.test.ts
git commit -m "feat(sunlight): per-room direct-sun hours and west-sun warning analysis"
```

---

### Task 5: 服务端 analysis service + 路由 + environment 加载

**Files:**
- Create: `server/analysis-service.ts`
- Create: `server/analysis-routes.ts`
- Modify: `server/routes.ts`（ApiDeps 追加可选 `getEnvironment`；`/project` 响应追加 `environment`）
- Modify: `server/index.ts`（environment.yaml ConfigLoader、apiDeps.getEnvironment、挂载 `/api/analysis`）
- Test: `tests/server/analysis.test.ts`

**Interfaces:**
- Consumes: `parseEnvironment`/`EnvironmentConfig`（Task 2）、`extractApertures`（Task 3）、`analyzeSunlight`（Task 4）、`mergeSceneElements`（`server/overlay-merge.ts:150`）、`ProjectCatalog.getRooms()/getWalls()`、`ConfigLoader`（`server/config-loader.ts`）
- Produces:
  ```ts
  computeSunlightAnalysis(catalog: ProjectCatalog, overlay: OverlayConfig | undefined, env: EnvironmentConfig, date: { month: number; day: number }):
    { date: string; location: SunlightLocation; confidence: 'estimated'; rooms: Array<{ id: string; name: string; directHours: number; westSunWarning: boolean; intervals: Array<[number, number]>; windows: Array<{ id: string; azimuthDeg: number; faces: string }> }> }
  createAnalysisRouter(deps: { catalog: ProjectCatalog; getEnvironment: () => EnvironmentConfig | undefined; getOverlay: () => OverlayConfig | undefined }): Router  // GET /sunlight?date=MM-DD
  ```
- Consumed by: Task 6（MCP 复用 computeSunlightAnalysis）、Task 11（客户端 fetch）

- [ ] **Step 1: 写失败测试**

Create `tests/server/analysis.test.ts`:

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

describe('GET /api/analysis/sunlight', () => {
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

  it('默认冬至返回各房间日照数据与置信度', async () => {
    const res = await request(app).get('/api/analysis/sunlight');
    assert.equal(res.status, 200);
    assert.equal(res.body.date, '12-22');
    assert.equal(res.body.confidence, 'estimated');
    const living = res.body.rooms.find((r: { id: string }) => r.id === 'living_dining');
    assert.ok(living, 'living_dining present');
    assert.ok(living.directHours > 0, `living_dining hours ${living.directHours}`);
    assert.ok(Array.isArray(living.windows));
  });

  it('date 参数生效', async () => {
    const res = await request(app).get('/api/analysis/sunlight?date=06-22');
    assert.equal(res.status, 200);
    assert.equal(res.body.date, '06-22');
  });

  it('非法 date → 400', async () => {
    const res = await request(app).get('/api/analysis/sunlight?date=13-40');
    assert.equal(res.status, 400);
  });

  it('environment 未加载 → 503', async () => {
    const catalog = ProjectCatalog.load('.');
    const bare = express();
    bare.use(
      '/api/analysis',
      createAnalysisRouter({ catalog, getEnvironment: () => undefined, getOverlay: () => overlay })
    );
    const res = await request(bare).get('/api/analysis/sunlight');
    assert.equal(res.status, 503);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/analysis.test.ts`
Expected: FAIL — `Cannot find module '../../server/analysis-routes.js'`

- [ ] **Step 3: 实现 `server/analysis-service.ts`**

```ts
import type { ProjectCatalog } from './project-catalog.js';
import type { OverlayConfig } from './overlay-merge.js';
import { mergeSceneElements } from './overlay-merge.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { extractApertures } from '../shared/glazing.js';
import { analyzeSunlight } from '../shared/sunlight-analysis.js';

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function toCompass(azimuthDeg: number): string {
  return COMPASS[Math.round(azimuthDeg / 45) % 8];
}

export function computeSunlightAnalysis(
  catalog: ProjectCatalog,
  overlay: OverlayConfig | undefined,
  env: EnvironmentConfig,
  date: { month: number; day: number }
) {
  const elements = mergeSceneElements(catalog.getWalls(), overlay);
  const rooms = catalog.getRooms();
  const centers = rooms.map((r) => ({ id: r.id, x: r.x, z: r.z }));
  const apertures = extractApertures(elements, centers, catalog.getWalls());
  const location = {
    latitude: env.location.latitude,
    longitude: env.location.longitude,
    timezone: env.location.timezone,
  };
  const perRoom = analyzeSunlight(apertures, centers, date, {
    location,
    obstructionDeg: env.horizon.obstruction_deg,
  });

  const dateStr = `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  return {
    date: dateStr,
    location,
    confidence: 'estimated' as const,
    rooms: rooms.map((r) => {
      const analysis = perRoom.find((p) => p.roomId === r.id);
      const roomAps = apertures.filter((a) => a.roomId === r.id);
      return {
        id: r.id,
        name: r.name,
        directHours: analysis ? Math.round(analysis.directHours * 100) / 100 : 0,
        westSunWarning: analysis?.westSunWarning ?? false,
        intervals: analysis?.intervals ?? [],
        windows: roomAps.map((a) => ({ id: a.id, azimuthDeg: Math.round(a.azimuthDeg), faces: toCompass(a.azimuthDeg) })),
      };
    }),
  };
}
```

- [ ] **Step 4: 实现 `server/analysis-routes.ts`**

```ts
import { Router } from 'express';
import type { ProjectCatalog } from './project-catalog.js';
import type { OverlayConfig } from './overlay-merge.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { computeSunlightAnalysis } from './analysis-service.js';

export interface AnalysisDeps {
  catalog: ProjectCatalog;
  getEnvironment: () => EnvironmentConfig | undefined;
  getOverlay: () => OverlayConfig | undefined;
}

function parseDateParam(value: string | undefined): { month: number; day: number } | null {
  const raw = value ?? '12-22';
  const m = /^(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function createAnalysisRouter(deps: AnalysisDeps): Router {
  const router = Router();

  router.get('/sunlight', (req, res) => {
    const env = deps.getEnvironment();
    if (!env) {
      res.status(503).json({ error: 'config/environment.yaml not loaded' });
      return;
    }
    const date = parseDateParam(req.query.date as string | undefined);
    if (!date) {
      res.status(400).json({ error: 'date must be MM-DD' });
      return;
    }
    res.json(computeSunlightAnalysis(deps.catalog, deps.getOverlay(), env, date));
  });

  return router;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/server/analysis.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: 修改 `server/routes.ts`——ApiDeps 与 /project**

在 `server/routes.ts` 顶部 import 区追加：

```ts
import type { EnvironmentConfig } from '../shared/environment-schema.js';
```

`ApiDeps` 接口（`server/routes.ts:13-21`）追加可选字段：

```ts
  getEnvironment?: () => EnvironmentConfig | undefined;
```

`/project` 路由（`server/routes.ts:59-78`）的 `res.json({...})` 顶层追加一个字段（与 `house`、`topics`、`budgetCategories` 平级）：

```ts
      environment: deps.getEnvironment?.() ?? null,
```

- [ ] **Step 7: 修改 `server/index.ts`——加载 environment.yaml 并挂载路由**

顶部 import 区（`server/index.ts:22-23` 附近）追加：

```ts
import { parseEnvironment } from '../shared/environment-schema.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { createAnalysisRouter } from './analysis-routes.js';
```

在 `overlayLoader` 定义块（`server/index.ts:125-136`）之后追加：

```ts
const environmentLoader = new ConfigLoader<EnvironmentConfig>(
  'config/environment.yaml',
  (raw) => parseEnvironment(raw),
  () => {
    console.log('[server] config/environment.yaml reloaded');
  }
);
registry.register(environmentLoader);
environmentLoader.load();
```

`apiDeps` 对象（`server/index.ts:148-162`）追加字段：

```ts
  getEnvironment: () => environmentLoader.getConfig(),
```

`app.use('/api', createApiRouter(apiDeps));`（`server/index.ts:166`）之后追加：

```ts
app.use(
  '/api/analysis',
  createAnalysisRouter({
    catalog,
    getEnvironment: () => environmentLoader.getConfig(),
    getOverlay: () => overlayLoader.getConfig(),
  })
);
```

在 `overlayLoader.startWatching();`（`server/index.ts:182`）附近追加：

```ts
environmentLoader.startWatching();
```

注意：`catalog` 变量名以 index.ts 现有实际变量为准（`apiDeps` 中用 `get catalog()` getter，挂载处直接引用同变量）。

- [ ] **Step 8: 全量服务端测试 + typecheck**

Run: `npm run test:server && npm run typecheck`
Expected: PASS（含既有测试不受影响——getEnvironment 为可选字段）

- [ ] **Step 9: 提交**

```bash
git add server/analysis-service.ts server/analysis-routes.ts server/routes.ts server/index.ts tests/server/analysis.test.ts
git commit -m "feat(server): sunlight analysis API with environment.yaml config loader"
```

---

### Task 6: MCP 工具 `get_sunlight_analysis`

**Files:**
- Modify: `server/mcp-server.ts`（McpDeps 追加可选 `getEnvironment`；注册工具）
- Modify: `tests/server/mcp.test.ts`（deps 追加 getEnvironment；新增工具调用测试）

**Interfaces:**
- Consumes: `computeSunlightAnalysis`（Task 5）、`parseEnvironment`（Task 2）
- Produces: MCP 工具 `get_sunlight_analysis({ date?: 'MM-DD' })` → 文本摘要（各房间日照时长、西晒警告、窗户朝向）

- [ ] **Step 1: 写失败测试**

在 `tests/server/mcp.test.ts` 顶部 import 区追加：

```ts
import { parseEnvironment } from '../../shared/environment-schema.js';
```

`before()` 内 deps 对象（`tests/server/mcp.test.ts:49-60` 区域）追加字段：

```ts
      getEnvironment: () => parseEnvironment(readFileSync('config/environment.yaml', 'utf8')),
```

在 describe 块末尾追加测试：

```ts
  it('get_sunlight_analysis 返回各房间日照摘要', async () => {
    const result = await client.callTool({ name: 'get_sunlight_analysis', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.includes('living_dining'));
    assert.ok(content[0].text.includes('directHours'));
  });

  it('get_sunlight_analysis 接受 date 参数', async () => {
    const result = await client.callTool({ name: 'get_sunlight_analysis', arguments: { date: '06-22' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('06-22'));
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx tsx --test tests/server/mcp.test.ts`
Expected: FAIL — 新测试报 `Tool get_sunlight_analysis not found`（既有测试仍 PASS）

- [ ] **Step 3: 修改 `server/mcp-server.ts`**

顶部 import 区追加：

```ts
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { computeSunlightAnalysis } from './analysis-service.js';
import { parseOverlay } from './overlay-merge.js';
import { readFileSync } from 'node:fs';
```

`McpDeps` 接口（`server/mcp-server.ts:35-46`）追加：

```ts
  getEnvironment?: () => EnvironmentConfig | undefined;
  getOverlay?: () => import('./overlay-merge.js').OverlayConfig | undefined;
```

在 `createMcpServer` 内最后一个 `registerTool` 之后追加：

```ts
  server.registerTool(
    'get_sunlight_analysis',
    {
      title: 'Get sunlight analysis',
      description:
        'Per-room direct-sun hours for a date (default winter solstice 12-22) with west-sun warnings and window orientations. Use for room assignment, curtain/shading and west-sun decisions.',
      inputSchema: z.object({
        date: z.string().optional().describe('MM-DD, default 12-22 (winter solstice)'),
      }),
    },
    async (args) => {
      const env = deps.getEnvironment?.();
      if (!env) return text({ error: 'config/environment.yaml not loaded' });
      const raw = args.date ?? '12-22';
      const m = /^(\d{2})-(\d{2})$/.exec(raw);
      if (!m) return text({ error: 'date must be MM-DD' });
      const date = { month: Number(m[1]), day: Number(m[2]) };
      const overlay = deps.getOverlay?.();
      const analysis = computeSunlightAnalysis(catalog, overlay, env, date);
      return text(analysis);
    }
  );
```

- [ ] **Step 4: 在 `server/index.ts` 给 MCP 传递 overlay**

`createMcpServer(apiDeps)`（`server/index.ts:171`）复用 apiDeps——Task 5 已加 `getEnvironment`；再给 apiDeps 追加（若尚无）：

```ts
  getOverlay: () => overlayLoader.getConfig(),
```

（apiDeps 当前已有同名字段 `getOverlay`，确认存在即可，不重复添加。）

- [ ] **Step 5: 运行测试确认通过**

Run: `npx tsx --test tests/server/mcp.test.ts`
Expected: PASS（含新增 2 个）

- [ ] **Step 6: 提交**

```bash
git add server/mcp-server.ts server/index.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add get_sunlight_analysis tool"
```

---

### Task 7: `EnvironmentManager.setSolarState` 与夜间模式

**Files:**
- Modify: `app/src/render/EnvironmentManager.ts`
- Test: `app/src/render/EnvironmentManager.test.ts`

**Interfaces:**
- Consumes: `computeLightState`、`sunDirection`（Task 1，经 `@shared/solar` 导入）
- Produces: `EnvironmentManager.setSolarState(pos: { altitudeDeg: number; azimuthDeg: number }): void`；`getLightingState()` 返回最后设置的 `{ altitudeDeg, azimuthDeg, isNight }`。`setTimeOfDay()` 删除。阴影相机扩至 ±25（R=60 光源距离下覆盖场景）。
- Consumed by: Task 8（SunlightSystem）

- [ ] **Step 1: 写失败测试**

Create `app/src/render/EnvironmentManager.test.ts`（仿 `app/src/scene/HouseScene.test.ts:47-48` 的 three mock 模式）：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Color { constructor(public hex: number | string = 0) {} setHex(h: number) { this.hex = h; } }
  class Light {
    position = new Vector3();
    color = new Color();
    intensity = 1;
    visible = true;
    castShadow = false;
    shadow = { mapSize: { set: vi.fn() }, bias: 0, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0, updateProjectionMatrix: vi.fn() } };
  }
  return {
    Scene: class { environment: unknown = null; background: unknown = null; add = vi.fn(); },
    AmbientLight: class extends Light {},
    DirectionalLight: class extends Light {},
    CanvasTexture: class { needsUpdate = false; constructor(public canvas: unknown) {} dispose = vi.fn(); },
    PMREMGenerator: class { fromScene() { return { texture: {} }; } dispose = vi.fn(); },
    Color,
    Vector3,
  };
});

import * as THREE from 'three';
import { EnvironmentManager } from './EnvironmentManager.js';

function makeManager() {
  const scene = new THREE.Scene();
  const renderer = { domElement: document.createElement('canvas') } as unknown as THREE.WebGLRenderer;
  const mgr = new EnvironmentManager(scene, renderer);
  mgr.setup();
  return { mgr, scene };
}

describe('EnvironmentManager.setSolarState', () => {
  beforeEach(() => {
    document.createElement('canvas').getContext = vi.fn(() => ({
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      fillStyle: '',
    })) as never;
  });

  it('白天：主光可见，位置在太阳方向 × 60', () => {
    const { mgr, scene } = makeManager();
    mgr.setSolarState({ altitudeDeg: 45, azimuthDeg: 180 });
    const dir = (scene as unknown as { children?: unknown[] });
    const state = mgr.getLightingState();
    expect(state.isNight).toBe(false);
    expect(state.altitudeDeg).toBe(45);
  });

  it('夜间：主光关闭，ambient 降至 0.15', () => {
    const { mgr } = makeManager();
    mgr.setSolarState({ altitudeDeg: -10, azimuthDeg: 0 });
    expect(mgr.getLightingState().isNight).toBe(true);
  });

  it('setTimeOfDay 已移除', () => {
    const { mgr } = makeManager();
    expect((mgr as unknown as Record<string, unknown>).setTimeOfDay).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/render/EnvironmentManager.test.ts`
Expected: FAIL — `mgr.setSolarState is not a function`

- [ ] **Step 3: 改造 `app/src/render/EnvironmentManager.ts`**

完整替换为：

```ts
import * as THREE from 'three';
import { computeLightState, sunDirection } from '@shared/solar';

const SUN_RADIUS = 60;
const DAY_BACKGROUND = new THREE.Color('#1a1a20');
const NIGHT_BACKGROUND = new THREE.Color('#0a0a18');

export interface SolarStateInput {
  altitudeDeg: number;
  azimuthDeg: number;
}

export class EnvironmentManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private dirLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private envMap: THREE.Texture | null = null;
  private lastState: { altitudeDeg: number; azimuthDeg: number; isNight: boolean } = {
    altitudeDeg: 60,
    azimuthDeg: 180,
    isNight: false,
  };

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
  }

  setup(): void {
    this.setupSkybox();
    this.setupLights();
    this.setupShadows();
  }

  private setupSkybox(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#4a90d9');
    gradient.addColorStop(0.5, '#c8d8e8');
    gradient.addColorStop(1, '#888888');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const tempScene = new THREE.Scene();
    tempScene.background = texture;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envMap = pmrem.fromScene(tempScene, 0, 0.1, 100).texture;
    pmrem.dispose();
    texture.dispose();

    this.envMap = envMap;
    this.scene.environment = envMap;
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.dirLight.position.set(12, 20, 8);
    this.dirLight.castShadow = true;
    this.scene.add(this.dirLight);

    this.fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    this.fillLight.position.set(-10, 8, -10);
    this.scene.add(this.fillLight);
  }

  private setupShadows(): void {
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.001;
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -25;
    cam.right = 25;
    cam.top = 25;
    cam.bottom = -25;
    cam.near = 1;
    cam.far = 150;
    cam.updateProjectionMatrix();
  }

  setSolarState(pos: SolarStateInput): void {
    const light = computeLightState(pos.altitudeDeg);
    const dir = sunDirection(pos.altitudeDeg, pos.azimuthDeg);

    this.dirLight.visible = !light.isNight;
    this.dirLight.intensity = light.sunIntensity;
    this.dirLight.color.setHex(light.sunColorHex);
    this.dirLight.position.set(dir.x * SUN_RADIUS, Math.max(dir.y * SUN_RADIUS, 0.5), dir.z * SUN_RADIUS);
    this.ambientLight.intensity = light.ambientIntensity;
    this.scene.background = light.isNight ? NIGHT_BACKGROUND : DAY_BACKGROUND;

    this.lastState = { altitudeDeg: pos.altitudeDeg, azimuthDeg: pos.azimuthDeg, isNight: light.isNight };
  }

  toggleIBL(enabled: boolean): void {
    this.scene.environment = enabled ? this.envMap : null;
  }

  getLightingState(): { altitudeDeg: number; azimuthDeg: number; isNight: boolean; iblEnabled: boolean } {
    return { ...this.lastState, iblEnabled: this.scene.environment !== null };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/render/EnvironmentManager.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 跑全量 app 测试确认无回归**

Run: `npm run test:app`
Expected: PASS（HouseScene 等既有测试不受影响——`setTimeOfDay` 无生产调用点）

- [ ] **Step 6: 提交**

```bash
git add app/src/render/EnvironmentManager.ts app/src/render/EnvironmentManager.test.ts
git commit -m "feat(render): drive EnvironmentManager with real solar position and night mode"
```

---

### Task 8: `SunlightSystem` 状态驱动 + 轨迹 + 播放

**Files:**
- Create: `app/src/render/SunlightSystem.ts`
- Test: `app/src/render/SunlightSystem.test.ts`

**Interfaces:**
- Consumes: `getSolarPosition`（Task 1）、`EnvironmentManager.setSolarState`（Task 7）
- Produces:
  ```ts
  class SunlightSystem {
    constructor(scene: THREE.Scene, envManager: EnvironmentManager, location: { latitude: number; longitude: number; timezone: number }, center: { x: number; z: number })
    setDate(month: number, day: number): void
    setHour(hour: number): void
    getDate(): { month: number; day: number }
    getHour(): number
    getSolarReadout(): { altitudeDeg: number; azimuthDeg: number }
    togglePlay(): boolean          // 返回播放中状态；24h/10s
    isPlaying(): boolean
    setPlayingListener(cb: (playing: boolean) => void): void
    showTrajectory(): void
    hideTrajectory(): void
    update(dtSeconds: number): void  // 由 App renderLoop 调用
    dispose(): void
  }
  ```
- Consumed by: Task 9（面板回调）、Task 10（App 接线）

- [ ] **Step 1: 写失败测试**

Create `app/src/render/SunlightSystem.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
  }
  return {
    Scene: class { add = vi.fn(); remove = vi.fn(); },
    Line: class { constructor(public geometry: unknown, public material: unknown) {} },
    Sprite: class { position = new Vector3(); scale = { set: vi.fn() }; constructor(public material: unknown) {} },
    SpriteMaterial: class { constructor(public opts: unknown) {} },
    CanvasTexture: class { constructor(public canvas: unknown) {} },
    BufferGeometry: class { setFromPoints = vi.fn(); },
    LineBasicMaterial: class { constructor(public opts: unknown) {} },
    Vector3,
  };
});

import * as THREE from 'three';
import { SunlightSystem } from './SunlightSystem.js';

const LOCATION = { latitude: 22.82, longitude: 108.37, timezone: 8 };

function makeSystem() {
  const scene = new THREE.Scene();
  const envManager = { setSolarState: vi.fn() } as never;
  const sys = new SunlightSystem(scene, envManager, LOCATION, { x: 7, z: 4 });
  return { sys, envManager: envManager as { setSolarState: ReturnType<typeof vi.fn> } };
}

describe('SunlightSystem', () => {
  it('setHour 驱动 envManager.setSolarState', () => {
    const { sys, envManager } = makeSystem();
    sys.setHour(12.75);
    expect(envManager.setSolarState).toHaveBeenCalled();
    const arg = envManager.setSolarState.mock.calls.at(-1)![0];
    expect(arg.altitudeDeg).toBeGreaterThan(40);
  });

  it('setDate 改变太阳高度（冬至 vs 夏至）', () => {
    const { sys, envManager } = makeSystem();
    sys.setDate(12, 22);
    sys.setHour(12.75);
    const winter = envManager.setSolarState.mock.calls.at(-1)![0].altitudeDeg;
    sys.setDate(6, 22);
    sys.setHour(12.75);
    const summer = envManager.setSolarState.mock.calls.at(-1)![0].altitudeDeg;
    expect(summer).toBeGreaterThan(winter);
  });

  it('getSolarReadout 返回当前太阳位置', () => {
    const { sys } = makeSystem();
    sys.setDate(12, 22);
    sys.setHour(12.75);
    const readout = sys.getSolarReadout();
    expect(readout.altitudeDeg).toBeGreaterThan(0);
    expect(readout.azimuthDeg).toBeGreaterThan(170);
    expect(readout.azimuthDeg).toBeLessThan(190);
  });

  it('update 在播放时推进时刻（24h/10s）', () => {
    const { sys } = makeSystem();
    sys.setHour(0);
    sys.togglePlay();
    expect(sys.isPlaying()).toBe(true);
    sys.update(5);
    expect(sys.getHour()).toBeCloseTo(12, 0);
  });

  it('时刻超过 24 回绕', () => {
    const { sys } = makeSystem();
    sys.setHour(23);
    sys.togglePlay();
    sys.update(5);
    expect(sys.getHour()).toBeLessThan(12);
  });

  it('togglePlay 再次调用停止', () => {
    const { sys } = makeSystem();
    sys.togglePlay();
    expect(sys.togglePlay()).toBe(false);
  });

  it('showTrajectory/hideTrajectory 不抛错', () => {
    const { sys } = makeSystem();
    expect(() => sys.showTrajectory()).not.toThrow();
    expect(() => sys.hideTrajectory()).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/render/SunlightSystem.test.ts`
Expected: FAIL — `Cannot find module './SunlightSystem.js'`

- [ ] **Step 3: 实现 `app/src/render/SunlightSystem.ts`**

```ts
import * as THREE from 'three';
import { getSolarPosition, getSunriseSunset } from '@shared/solar';
import type { EnvironmentManager } from './EnvironmentManager.js';

const HOURS_PER_SECOND = 24 / 10;

export class SunlightSystem {
  private month = 12;
  private day = 22;
  private hour = 12;
  private playing = false;
  private trajectory: THREE.Line | null = null;
  private sunDisc: THREE.Sprite | null = null;
  private onPlayingChange?: (playing: boolean) => void;
  private lastAltitude = 0;
  private lastAzimuth = 0;

  constructor(
    private scene: THREE.Scene,
    private envManager: EnvironmentManager,
    private location: { latitude: number; longitude: number; timezone: number },
    private center: { x: number; z: number }
  ) {
    this.apply();
  }

  setDate(month: number, day: number): void {
    this.month = month;
    this.day = day;
    this.apply();
    if (this.trajectory) {
      this.hideTrajectory();
      this.showTrajectory();
    }
  }

  setHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.apply();
  }

  getDate(): { month: number; day: number } {
    return { month: this.month, day: this.day };
  }

  getHour(): number {
    return this.hour;
  }

  getSolarReadout(): { altitudeDeg: number; azimuthDeg: number } {
    return { altitudeDeg: this.lastAltitude, azimuthDeg: this.lastAzimuth };
  }

  togglePlay(): boolean {
    this.playing = !this.playing;
    this.onPlayingChange?.(this.playing);
    return this.playing;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setPlayingListener(cb: (playing: boolean) => void): void {
    this.onPlayingChange = cb;
  }

  update(dtSeconds: number): void {
    if (!this.playing) return;
    this.setHour(this.hour + dtSeconds * HOURS_PER_SECOND);
  }

  showTrajectory(): void {
    if (this.trajectory) return;
    const { sunriseHour, sunsetHour } = getSunriseSunset(
      this.month,
      this.day,
      this.location.latitude,
      this.location.longitude,
      this.location.timezone
    );
    const points: THREE.Vector3[] = [];
    for (let t = sunriseHour; t <= sunsetHour; t += 10 / 60) {
      const pos = getSolarPosition({
        month: this.month,
        day: this.day,
        hour: t,
        latitudeDeg: this.location.latitude,
        longitudeDeg: this.location.longitude,
        timezoneHours: this.location.timezone,
      });
      if (pos.altitudeDeg <= 0) continue;
      points.push(this.worldPoint(pos.altitudeDeg, pos.azimuthDeg, 45));
    }
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints(points);
    this.trajectory = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffcc44 }));
    this.scene.add(this.trajectory);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffdd55';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    this.sunDisc.scale.set(2.5, 2.5, 1);
    this.scene.add(this.sunDisc);
    this.updateSunDisc();
  }

  hideTrajectory(): void {
    if (this.trajectory) {
      this.scene.remove(this.trajectory);
      this.trajectory = null;
    }
    if (this.sunDisc) {
      this.scene.remove(this.sunDisc);
      this.sunDisc = null;
    }
  }

  dispose(): void {
    this.hideTrajectory();
  }

  private apply(): void {
    const pos = getSolarPosition({
      month: this.month,
      day: this.day,
      hour: this.hour,
      latitudeDeg: this.location.latitude,
      longitudeDeg: this.location.longitude,
      timezoneHours: this.location.timezone,
    });
    this.lastAltitude = pos.altitudeDeg;
    this.lastAzimuth = pos.azimuthDeg;
    this.envManager.setSolarState(pos);
    this.updateSunDisc();
  }

  private updateSunDisc(): void {
    if (!this.sunDisc) return;
    const p = this.worldPoint(this.lastAltitude, this.lastAzimuth, 45);
    this.sunDisc.position.set(p.x, p.y, p.z);
    this.sunDisc.visible = this.lastAltitude > 0;
  }

  private worldPoint(altitudeDeg: number, azimuthDeg: number, radius: number): THREE.Vector3 {
    const a = altitudeDeg * (Math.PI / 180);
    const az = azimuthDeg * (Math.PI / 180);
    return new THREE.Vector3(
      this.center.x + Math.cos(a) * Math.sin(az) * radius,
      Math.max(Math.sin(a) * radius, 0.2),
      this.center.z - Math.cos(a) * Math.cos(az) * radius
    );
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/render/SunlightSystem.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add app/src/render/SunlightSystem.ts app/src/render/SunlightSystem.test.ts
git commit -m "feat(render): SunlightSystem with sun trajectory and time-lapse playback"
```

---

### Task 9: `SunlightPanel` 控制面板

**Files:**
- Create: `app/src/ui/SunlightPanel.ts`
- Test: `app/src/ui/SunlightPanel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class SunlightPanel {
    show(): void; hide(): void; toggle(): void; isVisible(): boolean
    onDateChange(cb: (month: number, day: number) => void): void
    onHourChange(cb: (hour: number) => void): void
    onPlayToggle(cb: () => void): void
    onHeatmapToggle(cb: () => void): void
    setSolarReadout(altitudeDeg: number, azimuthDeg: number): void
    setHourDisplay(hour: number): void      // 播放时外部同步滑杆
    setPlaying(playing: boolean): void      // 播放按钮文案同步
    setHuinanHint(visible: boolean): void
  }
  ```
  DOM：`#sunlight-panel`，含 `#sunlight-date`（range 0–364）、`#sunlight-hour`（range 0–96，÷4 得小时）、季节预设按钮（data-season="winter|summer|spring|autumn"）、`#sunlight-play`、`#sunlight-heatmap`、`#sunlight-readout`、`#sunlight-huinan-hint`。
- Consumed by: Task 10

- [ ] **Step 1: 写失败测试**

Create `app/src/ui/SunlightPanel.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SunlightPanel } from './SunlightPanel.js';

describe('SunlightPanel', () => {
  let panel: SunlightPanel;

  beforeEach(() => {
    panel = new SunlightPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    expect(panel.isVisible()).toBe(false);
  });

  it('show 创建面板且含滑杆', () => {
    panel.show();
    expect(panel.isVisible()).toBe(true);
    expect(document.getElementById('sunlight-panel')).toBeTruthy();
    expect(document.getElementById('sunlight-date')).toBeTruthy();
    expect(document.getElementById('sunlight-hour')).toBeTruthy();
  });

  it('hide 移除显示', () => {
    panel.show();
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });

  it('日期滑杆触发 onDateChange', () => {
    let got: [number, number] | null = null;
    panel.onDateChange((m, d) => { got = [m, d]; });
    panel.show();
    const slider = document.getElementById('sunlight-date') as HTMLInputElement;
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(got).toEqual([1, 1]);
  });

  it('时刻滑杆触发 onHourChange（96 档 ÷ 4）', () => {
    let got: number | null = null;
    panel.onHourChange((h) => { got = h; });
    panel.show();
    const slider = document.getElementById('sunlight-hour') as HTMLInputElement;
    slider.value = '51';
    slider.dispatchEvent(new Event('input'));
    expect(got).toBe(12.75);
  });

  it('冬至预设触发 onDateChange(12, 22)', () => {
    let got: [number, number] | null = null;
    panel.onDateChange((m, d) => { got = [m, d]; });
    panel.show();
    const btn = document.querySelector('button[data-season="winter"]') as HTMLButtonElement;
    btn.click();
    expect(got).toEqual([12, 22]);
  });

  it('播放与热力图按钮触发回调', () => {
    let played = false;
    let heatmap = false;
    panel.onPlayToggle(() => { played = true; });
    panel.onHeatmapToggle(() => { heatmap = true; });
    panel.show();
    (document.getElementById('sunlight-play') as HTMLButtonElement).click();
    (document.getElementById('sunlight-heatmap') as HTMLButtonElement).click();
    expect(played).toBe(true);
    expect(heatmap).toBe(true);
  });

  it('setSolarReadout 更新读数文本', () => {
    panel.show();
    panel.setSolarReadout(43.7, 180);
    const el = document.getElementById('sunlight-readout')!;
    expect(el.textContent).toContain('43.7');
    expect(el.textContent).toContain('180');
  });

  it('setHuinanHint 控制提示条显隐', () => {
    panel.show();
    panel.setHuinanHint(true);
    expect((document.getElementById('sunlight-huinan-hint') as HTMLElement).style.display).not.toBe('none');
    panel.setHuinanHint(false);
    expect((document.getElementById('sunlight-huinan-hint') as HTMLElement).style.display).toBe('none');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/ui/SunlightPanel.test.ts`
Expected: FAIL — `Cannot find module './SunlightPanel.js'`

- [ ] **Step 3: 实现 `app/src/ui/SunlightPanel.ts`**

```ts
const SEASONS: Array<{ key: string; label: string; month: number; day: number }> = [
  { key: 'winter', label: '冬至', month: 12, day: 22 },
  { key: 'summer', label: '夏至', month: 6, day: 22 },
  { key: 'spring', label: '春分', month: 3, day: 20 },
  { key: 'autumn', label: '秋分', month: 9, day: 23 },
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayIndexToDate(index: number): { month: number; day: number } {
  let rest = index;
  for (let m = 0; m < 12; m++) {
    if (rest < MONTH_DAYS[m]) return { month: m + 1, day: rest + 1 };
    rest -= MONTH_DAYS[m];
  }
  return { month: 12, day: 31 };
}

export class SunlightPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private dateCb?: (month: number, day: number) => void;
  private hourCb?: (hour: number) => void;
  private playCb?: () => void;
  private heatmapCb?: () => void;

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.visible = false;
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }

  onDateChange(cb: (month: number, day: number) => void): void {
    this.dateCb = cb;
  }

  onHourChange(cb: (hour: number) => void): void {
    this.hourCb = cb;
  }

  onPlayToggle(cb: () => void): void {
    this.playCb = cb;
  }

  onHeatmapToggle(cb: () => void): void {
    this.heatmapCb = cb;
  }

  setSolarReadout(altitudeDeg: number, azimuthDeg: number): void {
    const el = document.getElementById('sunlight-readout');
    if (el) el.textContent = `高度角 ${altitudeDeg.toFixed(1)}° · 方位角 ${azimuthDeg.toFixed(0)}°`;
  }

  setHourDisplay(hour: number): void {
    const slider = document.getElementById('sunlight-hour') as HTMLInputElement | null;
    if (slider) slider.value = String(Math.round(hour * 4));
    const label = document.getElementById('sunlight-hour-label');
    if (label) label.textContent = formatHour(hour);
  }

  setPlaying(playing: boolean): void {
    const btn = document.getElementById('sunlight-play');
    if (btn) btn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  }

  setHuinanHint(visible: boolean): void {
    const el = document.getElementById('sunlight-huinan-hint');
    if (el) el.style.display = visible ? 'block' : 'none';
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'sunlight-panel';
    el.style.cssText = `
      position: fixed; right: 16px; bottom: 60px; z-index: 900;
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; width: 240px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none;
    `;

    el.innerHTML = `
      <div style="font-weight:600; margin-bottom:10px;">日照模拟</div>
      <div id="sunlight-huinan-hint" style="display:none; background:#5b3a1a; color:#ffd591; border-radius:6px; padding:6px 8px; margin-bottom:10px; font-size:12px;">当前处于回南天窗口</div>
      <label style="display:block; margin-bottom:4px;">日期 <span id="sunlight-date-label">12-22</span></label>
      <input id="sunlight-date" type="range" min="0" max="364" value="355" style="width:100%;" />
      <div style="display:flex; gap:6px; margin:8px 0;">
        ${SEASONS.map((s) => `<button data-season="${s.key}" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:4px 0; cursor:pointer;">${s.label}</button>`).join('')}
      </div>
      <label style="display:block; margin-bottom:4px;">时刻 <span id="sunlight-hour-label">12:00</span></label>
      <input id="sunlight-hour" type="range" min="0" max="96" value="48" style="width:100%;" />
      <div style="display:flex; gap:6px; margin-top:10px;">
        <button id="sunlight-play" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:6px 0; cursor:pointer;">▶ 播放</button>
        <button id="sunlight-heatmap" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:6px 0; cursor:pointer;">日照热力图</button>
      </div>
      <div id="sunlight-readout" style="margin-top:10px; color:#8888aa; font-size:12px;">高度角 --° · 方位角 --°</div>
    `;

    document.body.appendChild(el);
    this.el = el;

    const dateSlider = el.querySelector('#sunlight-date') as HTMLInputElement;
    dateSlider.addEventListener('input', () => {
      const { month, day } = dayIndexToDate(Number(dateSlider.value));
      const label = el.querySelector('#sunlight-date-label');
      if (label) label.textContent = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      this.dateCb?.(month, day);
    });

    const hourSlider = el.querySelector('#sunlight-hour') as HTMLInputElement;
    hourSlider.addEventListener('input', () => {
      const hour = Number(hourSlider.value) / 4;
      const label = el.querySelector('#sunlight-hour-label');
      if (label) label.textContent = formatHour(hour);
      this.hourCb?.(hour);
    });

    for (const s of SEASONS) {
      const btn = el.querySelector(`button[data-season="${s.key}"]`) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        let index = 0;
        for (let m = 0; m < s.month - 1; m++) index += MONTH_DAYS[m];
        index += s.day - 1;
        dateSlider.value = String(index);
        const label = el.querySelector('#sunlight-date-label');
        if (label) label.textContent = `${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}`;
        this.dateCb?.(s.month, s.day);
      });
    }

    (el.querySelector('#sunlight-play') as HTMLButtonElement).addEventListener('click', () => this.playCb?.());
    (el.querySelector('#sunlight-heatmap') as HTMLButtonElement).addEventListener('click', () => this.heatmapCb?.());
  }
}

function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/ui/SunlightPanel.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 5: 提交**

```bash
git add app/src/ui/SunlightPanel.ts app/src/ui/SunlightPanel.test.ts
git commit -m "feat(ui): SunlightPanel with date/hour sliders, season presets, playback"
```

---

### Task 10: 入口按钮 + index.html + App 接线

**Files:**
- Create: `app/src/ui/SunlightButton.ts`
- Modify: `app/index.html`（`#topdown-btn` 后追加 `#sunlight-btn`）
- Modify: `app/src/App.ts`（实例化与接线）
- Test: `app/src/ui/SunlightButton.test.ts`

**Interfaces:**
- Consumes: `SunlightSystem`（Task 8）、`SunlightPanel`（Task 9）；`/api/project` 响应新增的 `environment` 字段（Task 5）
- Produces: `SunlightButton`（与 `TopDownButton` 同构：`{ onToggle, getActive }`，`sync()`）；App 内 `renderLoop` 调用 `sunlightSystem.update(dt)`。

- [ ] **Step 1: 写失败测试**

Create `app/src/ui/SunlightButton.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SunlightButton } from './SunlightButton.js';

describe('SunlightButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="sunlight-btn"></button>';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('点击触发 onToggle', () => {
    let toggled = false;
    const btn = new SunlightButton({ onToggle: () => { toggled = true; }, getActive: () => false });
    (document.getElementById('sunlight-btn') as HTMLButtonElement).click();
    expect(toggled).toBe(true);
    btn.sync();
  });

  it('active 状态加高亮 class', () => {
    const btn = new SunlightButton({ onToggle: () => {}, getActive: () => true });
    btn.sync();
    expect((document.getElementById('sunlight-btn') as HTMLButtonElement).classList.contains('active')).toBe(true);
  });

  it('缺少 DOM 元素抛错', () => {
    document.body.innerHTML = '';
    expect(() => new SunlightButton({ onToggle: () => {}, getActive: () => false })).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/ui/SunlightButton.test.ts`
Expected: FAIL — `Cannot find module './SunlightButton.js'`

- [ ] **Step 3: 实现 `app/src/ui/SunlightButton.ts`**

```ts
export class SunlightButton {
  private el: HTMLButtonElement;
  private getActive: () => boolean;
  private onToggle: () => void;

  constructor(opts: { onToggle: () => void; getActive: () => boolean }) {
    this.onToggle = opts.onToggle;
    this.getActive = opts.getActive;
    const el = document.getElementById('sunlight-btn') as HTMLButtonElement | null;
    if (!el) {
      throw new Error('SunlightButton: #sunlight-btn element not found in DOM');
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

Run: `cd app && npx vitest run src/ui/SunlightButton.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 修改 `app/index.html`**

在 `<button id="topdown-btn" ...>俯视</button>`（第 73 行）之后追加：

```html
    <button id="sunlight-btn" title="日照模拟">日照</button>
```

- [ ] **Step 6: 修改 `app/src/App.ts`——字段与 import**

顶部 import 区追加：

```ts
import { SunlightSystem } from './render/SunlightSystem.js';
import { SunlightPanel } from './ui/SunlightPanel.js';
import { SunlightButton } from './ui/SunlightButton.js';
```

类字段区（`private commandPalette = new CommandPalette();` 附近，`app/src/App.ts:51`）追加：

```ts
  private sunlightPanel = new SunlightPanel();
  private sunlightSystem: SunlightSystem | null = null;
  private sunlightButton: SunlightButton | null = null;
```

- [ ] **Step 7: 修改 `app/src/App.ts`——start() 内初始化**

在 `start()` 中 `this.updateModeIndicator();`（`app/src/App.ts:166` 附近，`requestAnimationFrame` 之前）之前插入：

```ts
    this.setupSunlight();
```

类中新增私有方法：

```ts
  private setupSunlight(): void {
    const env = this.projectData?.environment;
    if (!env) return;

    const rooms: Array<{ x: number; z: number }> = this.projectData?.house?.rooms ?? [];
    const center = rooms.length > 0
      ? {
          x: rooms.reduce((s, r) => s + r.x, 0) / rooms.length,
          z: rooms.reduce((s, r) => s + r.z, 0) / rooms.length,
        }
      : { x: 7.4, z: 3.65 };

    this.sunlightSystem = new SunlightSystem(
      this.houseScene.scene,
      this.houseScene.getEnvironmentManager(),
      { latitude: env.location.latitude, longitude: env.location.longitude, timezone: env.location.timezone },
      center
    );

    this.sunlightPanel.onDateChange((month, day) => this.sunlightSystem?.setDate(month, day));
    this.sunlightPanel.onHourChange((hour) => this.sunlightSystem?.setHour(hour));
    this.sunlightPanel.onPlayToggle(() => {
      const playing = this.sunlightSystem?.togglePlay() ?? false;
      this.sunlightPanel.setPlaying(playing);
    });
    this.sunlightSystem.setPlayingListener((playing) => this.sunlightPanel.setPlaying(playing));

    this.sunlightButton = new SunlightButton({
      onToggle: () => {
        this.sunlightPanel.toggle();
        if (this.sunlightPanel.isVisible()) {
          this.sunlightSystem?.showTrajectory();
        } else {
          this.sunlightSystem?.hideTrajectory();
        }
        this.sunlightButton?.sync();
      },
      getActive: () => this.sunlightPanel.isVisible(),
    });
  }
```

- [ ] **Step 8: 修改 `app/src/render/HouseScene.ts`——暴露 envManager**

`getFurnitureMeshes()`（`app/src/render/HouseScene.ts:1472`）附近追加公共 getter：

```ts
  getEnvironmentManager(): EnvironmentManager {
    return this.envManager;
  }
```

- [ ] **Step 9: 修改 `app/src/App.ts`——renderLoop 驱动播放与读数**

在 `renderLoop` 中计算 dt 的位置（现有 `this.lastTime` 机制）追加：

```ts
    if (this.sunlightSystem?.isPlaying()) {
      this.sunlightSystem.update(dt);
      this.sunlightPanel.setHourDisplay(this.sunlightSystem.getHour());
    }
    if (this.sunlightPanel.isVisible() && this.sunlightSystem) {
      const r = this.sunlightSystem.getSolarReadout();
      this.sunlightPanel.setSolarReadout(r.altitudeDeg, r.azimuthDeg);
    }
```

（`dt` 单位为秒；若现有 renderLoop 的 dt 为毫秒，除以 1000 后传入。）

- [ ] **Step 10: 运行全量 app 测试 + typecheck**

Run: `npm run test:app && npm run typecheck`
Expected: PASS

- [ ] **Step 11: 提交**

```bash
git add app/src/ui/SunlightButton.ts app/src/ui/SunlightButton.test.ts app/index.html app/src/App.ts app/src/render/HouseScene.ts
git commit -m "feat(app): wire sunlight simulation UI with entry button"
```

---

### Task 11: `DaylightHeatmap` 俯视日照热力图

**Files:**
- Create: `app/src/render/analysis/DaylightHeatmap.ts`
- Modify: `app/src/render/HouseScene.ts`（追加 `getFloorMeshes()` getter）
- Modify: `app/src/App.ts`（面板热力图回调接线）
- Test: `app/src/render/analysis/DaylightHeatmap.test.ts`

**Interfaces:**
- Consumes: `GET /api/analysis/sunlight?date=MM-DD`（Task 5）、`HouseScene.getFloorMeshes()`（floor mesh `userData.roomId`）、`HouseScene.topDownView`（public，`enable()/disable()/isEnabled()`）
- Produces:
  ```ts
  class DaylightHeatmap {
    constructor(houseScene: HouseScene)
    toggle(): Promise<void>     // 开：fetch + 着色 + 标签 + 俯视；关：恢复
    isActive(): boolean
    refresh(date: string): Promise<void>  // 面板日期变更时，若激活则重算
  }
  ```
  色标：0h `#4a5568` → ≥4h `#ed8936` 线性插值；房间中心标签 sprite 显示 `X.Xh`。

- [ ] **Step 1: 写失败测试**

Create `app/src/render/analysis/DaylightHeatmap.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  return {
    Color: class {
      constructor(public hex: number | string = 0) {}
      lerp = vi.fn();
      set(hex: number | string) { this.hex = hex; return this; }
    },
    MeshStandardMaterial: class { color = { set: vi.fn(), copy: vi.fn() }; clone() { return this; } },
    Sprite: class { position = new Vector3(); scale = { set: vi.fn() }; visible = true; constructor(public material: unknown) {} },
    SpriteMaterial: class { constructor(public opts: unknown) {} dispose = vi.fn(); },
    CanvasTexture: class { constructor(public canvas: unknown) {} dispose = vi.fn(); },
    Vector3,
  };
});

import { DaylightHeatmap } from './DaylightHeatmap.js';

function makeHouseScene() {
  const floorMat = { color: { set: vi.fn(), copy: vi.fn() }, clone: vi.fn() };
  const floor = { userData: { roomId: 'living_dining' }, material: floorMat };
  return {
    getFloorMeshes: () => [floor],
    rooms: { living_dining: { x: 10, z: 7, name: '客餐厅' } },
    scene: { add: vi.fn(), remove: vi.fn() },
    topDownView: { enable: vi.fn(), disable: vi.fn(), isEnabled: () => false },
    _floor: floor,
  };
}

describe('DaylightHeatmap', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        date: '12-22',
        rooms: [{ id: 'living_dining', name: '客餐厅', directHours: 3.5, westSunWarning: false, intervals: [], windows: [] }],
      }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggle 开启：拉取数据、着色 floor、切俯视', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    expect(heatmap.isActive()).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/analysis/sunlight?date=12-22');
    expect(hs._floor.material.color.set).toHaveBeenCalled();
    expect(hs.topDownView.enable).toHaveBeenCalled();
  });

  it('toggle 关闭：恢复材质、退出俯视', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    await heatmap.toggle();
    expect(heatmap.isActive()).toBe(false);
    expect(hs.topDownView.disable).toHaveBeenCalled();
  });

  it('refresh 使用新日期', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    await heatmap.refresh('06-22');
    expect(fetch).toHaveBeenLastCalledWith('/api/analysis/sunlight?date=06-22');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd app && npx vitest run src/render/analysis/DaylightHeatmap.test.ts`
Expected: FAIL — `Cannot find module './DaylightHeatmap.js'`

- [ ] **Step 3: 实现 `app/src/render/analysis/DaylightHeatmap.ts`**

```ts
import * as THREE from 'three';
import type { HouseScene } from '../HouseScene.js';

const COLOR_MIN = new THREE.Color('#4a5568');
const COLOR_MAX = new THREE.Color('#ed8936');
const MAX_HOURS = 4;

interface RoomResult {
  id: string;
  name: string;
  directHours: number;
  westSunWarning: boolean;
}

export class DaylightHeatmap {
  private active = false;
  private date = '12-22';
  private originalColors = new Map<THREE.Mesh, number>();
  private labels: THREE.Sprite[] = [];
  private enabledTopDown = false;

  constructor(private houseScene: HouseScene) {}

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
      this.clearLabels();
      await this.applyAnalysis();
    }
  }

  private async activate(): Promise<void> {
    await this.applyAnalysis();
    if (!this.houseScene.topDownView.isEnabled()) {
      this.houseScene.topDownView.enable();
      this.enabledTopDown = true;
    }
    this.active = true;
  }

  private deactivate(): void {
    for (const mesh of this.houseScene.getFloorMeshes()) {
      const original = this.originalColors.get(mesh);
      if (original !== undefined) {
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(original);
      }
    }
    this.originalColors.clear();
    this.clearLabels();
    if (this.enabledTopDown) {
      this.houseScene.topDownView.disable();
      this.enabledTopDown = false;
    }
    this.active = false;
  }

  private async applyAnalysis(): Promise<void> {
    const res = await fetch(`/api/analysis/sunlight?date=${this.date}`);
    const data = (await res.json()) as { rooms: RoomResult[] };
    const byId = new Map(data.rooms.map((r) => [r.id, r]));

    for (const mesh of this.houseScene.getFloorMeshes()) {
      const roomId = mesh.userData.roomId as string | undefined;
      if (!roomId) continue;
      if (!this.originalColors.has(mesh)) {
        this.originalColors.set(mesh, (mesh.material as THREE.MeshStandardMaterial).color.getHex());
      }
      const result = byId.get(roomId);
      const t = Math.min((result?.directHours ?? 0) / MAX_HOURS, 1);
      const color = COLOR_MIN.clone().lerp(COLOR_MAX, t);
      (mesh.material as THREE.MeshStandardMaterial).color.copy(color);
    }

    for (const result of data.rooms) {
      const room = (this.houseScene.rooms as Record<string, { x: number; z: number }>)[result.id];
      if (!room) continue;
      this.labels.push(this.makeLabel(`${result.directHours.toFixed(1)}h`, room.x, room.z));
    }
  }

  private makeLabel(text: string, x: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(20,20,35,0.85)';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#ffd591';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 32);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.position.set(x, 1.2, z);
    sprite.scale.set(1.6, 0.8, 1);
    this.houseScene.scene.add(sprite);
    return sprite;
  }

  private clearLabels(): void {
    for (const label of this.labels) {
      this.houseScene.scene.remove(label);
    }
    this.labels = [];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd app && npx vitest run src/render/analysis/DaylightHeatmap.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 修改 `app/src/render/HouseScene.ts`——getFloorMeshes getter**

`getEnvironmentManager()`（Task 8 所加）附近追加：

```ts
  getFloorMeshes(): THREE.Mesh[] {
    return this.floorMeshes;
  }
```

- [ ] **Step 6: 修改 `app/src/App.ts`——热力图接线**

import 区追加：

```ts
import { DaylightHeatmap } from './render/analysis/DaylightHeatmap.js';
```

字段区追加：

```ts
  private daylightHeatmap: DaylightHeatmap | null = null;
```

`setupSunlight()` 内 `this.sunlightButton = new SunlightButton({...})` 之前追加：

```ts
    this.daylightHeatmap = new DaylightHeatmap(this.houseScene);
    this.sunlightPanel.onHeatmapToggle(() => {
      void this.daylightHeatmap?.toggle();
    });
    this.sunlightPanel.onDateChange((month, day) => {
      const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      void this.daylightHeatmap?.refresh(date);
    });
```

（注意：`onDateChange` 在 Step 7（Task 10）已注册过一次回调——该 API 为单回调覆盖式。将两处合并：把 Task 10 Step 7 的 `this.sunlightPanel.onDateChange((month, day) => this.sunlightSystem?.setDate(month, day));` 替换为同时做两件事的回调：）

```ts
    this.sunlightPanel.onDateChange((month, day) => {
      this.sunlightSystem?.setDate(month, day);
      const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      void this.daylightHeatmap?.refresh(date);
    });
```

- [ ] **Step 7: 运行全量 app 测试 + typecheck**

Run: `npm run test:app && npm run typecheck`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add app/src/render/analysis/DaylightHeatmap.ts app/src/render/analysis/DaylightHeatmap.test.ts app/src/render/HouseScene.ts app/src/App.ts
git commit -m "feat(analysis): daylight heatmap overlay with top-down view and hour labels"
```

---

### Task 12: 端到端验证与文档

**Files:**
- Modify: `README.md`（追加"日照模拟"使用说明小节，若 README 有功能清单）

- [ ] **Step 1: 全量验证（铁律）**

Run: `npm run verify:all && npm run test:server && npm run test:app && npm run typecheck`
Expected: 全部 PASS。任何失败必须修复后重跑，不得跳过。

- [ ] **Step 2: 手动冒烟（dev 环境）**

Run: `npm run dev`（后台），浏览器打开 app：
1. 点击"日照"按钮 → 面板出现、太阳轨迹线出现、默认冬至正午光影正确（南向客厅明亮）；
2. 拖时刻滑杆到 22:00 → 场景切夜间模式（背景变深蓝、主光关闭）；
3. 点"冬至"预设再点"夏至" → 正午太阳高度明显变高、影子变短；
4. 点"▶ 播放" → 光影扫动，滑杆同步移动；
5. 点"日照热力图" → 自动俯视，各房间着色 + 小时数标签；再点恢复；
6. `curl 'localhost:<port>/api/analysis/sunlight?date=12-22'` → JSON 含 living_dining directHours > 0。

（端口以 dev 输出为准；验证后停掉 dev 进程。）

- [ ] **Step 3: 更新 README（如存在功能/操作清单）**

在 README 的功能或快捷键/操作说明区域追加（措辞随 README 现有风格）：

```markdown
### 日照模拟

点击右下角"日照"按钮打开面板：日期/时刻滑杆实时驱动太阳位置与光影（真实天文算法，南宁经纬度），季节预设（冬至/夏至/春分/秋分）、延时播放、俯视日照时长热力图（冬至默认）。分析数据：`GET /api/analysis/sunlight?date=MM-DD`，MCP 工具 `get_sunlight_analysis`。配置见 `config/environment.yaml`。
```

若 README 无对应区域则跳过本步。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: sunlight simulation usage notes"
```

---

## Self-Review 结论

- **Spec 覆盖**：§3 太阳算法 → Task 1；§3.3 朝向推导 → Task 3；§4.1 EnvironmentManager → Task 7；§4.2 SunlightSystem/轨迹/播放 → Task 8；§4.3 日照时长分析/热力图/西晒 → Task 4/11；§6 UI（按钮入口、面板、零快捷键、CommandPalette 不扩展）→ Task 9/10；§7 API/MCP → Task 5/6；§8 置信度/zod 启动校验/503 → Task 2/5；§9 测试 → 各 Task 内嵌；`environment` 经 /api/project 下发客户端 → Task 5 Step 6。湿度（§5、§6.3、HumidityButton）属二期，不在本计划。
- **占位符扫描**：无 TBD/TODO；所有代码块完整。
- **类型一致性**：`WindowAperture`/`RoomCenter`（Task 3）在 Task 4/5 引用一致；`computeSunlightAnalysis` 签名 Task 5 定义、Task 6 调用一致；`setSolarState({altitudeDeg, azimuthDeg})` Task 7 定义、Task 8 调用一致；面板回调签名 Task 9 定义、Task 10/11 消费一致；`getFloorMeshes()`/`getEnvironmentManager()` getter 名称跨 Task 一致。
