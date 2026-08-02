# 日照模拟与湿度风险评估系统设计

- 日期：2026-08-02
- 状态：待审阅
- 关联：`config/house.yaml`（南宁 / 西户 / 7F / 南北通透）、`docs/curtain-design.md`、`docs/hvac_options_analysis.md`

## 1. 背景与目标

和萃 701（南宁，北纬 ~22.8°，夏热冬暖地区，西户，7 层板楼）。两个决策痛点：

1. **日照**：南宁冬至/夏至正午太阳高度角差异极大（~44° vs ~86°），房间功能分配、窗帘方案（已有 `docs/curtain-design.md`）、西晒防护都需要"哪个房间几点有阳光"的结论。
2. **湿度**：南宁核心问题是**回南天**（2–4 月暖湿空气遇冷表面结露发霉），而非北方采暖期墙体传热。需要静态风险评估：哪些房间/表面高风险，配什么对策（除湿机点位、防潮处理）。

### 目标

- 3D 内实时调日期/时刻看光影变化（可视化）
- 派生各房间日照时长分析（冬至日满窗日照小时数）+ 西晒警告
- 房间级湿度风险评分 + 重点表面（冷表面/热桥）标记，输出风险热力图与因子拆解
- 结论经 API + MCP 暴露，供 AI 会话消费（窗帘、除湿机、房间分配决策）

### 非目标（YAGNI）

| 候选 | 结论 | 理由 |
|---|---|---|
| 西晒独立系统 | 不做 | 是日照分析派生结论（预置视角"夏至 16:00 看西幕墙"） |
| 通风/风场模拟 | 不做 | schema 预留 `prevailing_wind` + `ventilation` 声明，湿度评估复用 |
| 风驱雨/防水 | 不做 | 属防水专题，外墙构造数据不足（`structure: inferred`），schema 预留 `rainfall_mm_annual` |
| 空调负荷 | 不做 | 日照/西晒结论未来可作 `hvac_options_analysis.md` 输入 |
| 实时天气 API | 不做 | 气候统计分析而非预报；项目有 `OfflineIndicator`，避免运行时外部依赖 |
| 动态湿度仿真 | 不做 | 静态风险索引足够决策，时间步仿真引擎过重 |

## 2. 架构总览

```
config/environment.yaml          ← 新增：气候 + 湿源 + 通风 + 重点表面（声明式，铁律）
shared/solar.ts                  ← 新增：太阳位置纯函数（客户端/服务端共用）
shared/humidity-model.ts         ← 新增：湿度风险评分纯函数
shared/environment-schema.ts     ← 新增：environment.yaml 的 zod schema

app/src/render/
  EnvironmentManager.ts          ← 改造：setSolarState() 接真实太阳算法 + 夜间模式
  SunlightSystem.ts              ← 新增：驱动光照状态 + 太阳轨迹线可视化
app/src/render/analysis/
  DaylightHeatmap.ts             ← 新增：俯视日照时长热力图（仿 MeasurementTool 模式）
  HumidityOverlay.ts             ← 新增：房间风险着色 + 重点表面脉冲标记
app/src/ui/
  SunlightPanel.ts               ← 新增：日期/时刻滑杆 + 季节预设 + 播放
  SunlightButton.ts              ← 新增：仿 TopDownButton 的入口按钮绑定
  HumidityButton.ts              ← 新增：同上
app/src/App.ts                   ← 接线：按钮实例化 + CommandPalette 命令注册

server/
  analysis-routes.ts             ← 新增：GET /api/analysis/sunlight、/api/analysis/humidity
  mcp-server.ts                  ← 新增工具：get_sunlight_analysis、get_humidity_risks
```

**分期**：一期光照（§3–§4 + §6 光照部分 + §7 日照 API），二期湿度（§5 + §6 湿度部分 + §7 湿度 API）。两期共享朝向推导（§3.3）。

## 3. 太阳算法（`shared/solar.ts`）

### 3.1 接口

```ts
interface SolarInput {
  month: number;          // 1–12
  day: number;            // 1–31
  hour: number;           // 0–24，当地标准时（小数，如 14.5）
  latitudeDeg: number;    // 南宁 22.82
  longitudeDeg: number;   // 南宁 108.37
  timezoneHours: number;  // 8
}
interface SolarPosition {
  altitudeDeg: number;    // 高度角，>0 在地平线上
  azimuthDeg: number;     // 方位角，自北顺时针（0=北，90=东，180=南，270=西）
}
getSolarPosition(input: SolarInput): SolarPosition;
getSunriseSunset(month: number, day: number, latitudeDeg: number, longitudeDeg: number, timezoneHours: number):
  { sunriseHour: number; sunsetHour: number };
```

### 3.2 算法（NOAA 简化级，精度 <0.5°）

1. 日序 `n` → 赤纬 `δ = 23.44° · sin(360° · (284 + n) / 365)`（Cooper 公式）
2. 时差方程 EoT（Spencer 近似）→ 真太阳时 `t_solar = t_local + EoT/60 + (λ − 15°·tz)/15`
3. 时角 `H = 15° · (t_solar − 12)`
4. 高度角 `sin α = sinφ·sinδ + cosφ·cosδ·cosH`
5. 方位角 `cos A = (sinδ − sinα·sinφ) / (cosα·cosφ)`；时角 `H > 0`（下午）取 `A = 360° − A`
6. 日出日落时角 `cos H₀ = −tanφ·tanδ`（`|tanφ·tanδ| > 1` 为极昼/极夜，南宁不会触发）

### 3.3 坐标映射（Three.js：`+x=东, +z=南, Y 向上`，北=`−z`）

```
sunDir.x =  cosα · sinA
sunDir.y =  sinα
sunDir.z = −cosα · cosA
light.position = sceneCenter + sunDir × R    // R ≈ 60，覆盖场景阴影相机
```

**朝向推导**（共享基础设施，两期复用）：窗的外法线方位角从几何计算——
- `glass_infill`：所在墙段方向 `atan2(dz, dx)` 取垂线为法线候选；
- `curtain_run`：折线各段法线；
- **外侧判定**：法线指向远离所属房间中心（`model-geometry.yaml` rooms 中心坐标，声明数据）的一侧。
- 方位角 → 罗盘八向映射（北/东北/东/…），用于结论展示与湿度朝向因子。

这是从声明几何做计算，不推断意图，符合铁律。

## 4. 光照渲染接线（一期）

### 4.1 `EnvironmentManager` 改造

- 新增 `setSolarState(pos: SolarPosition)`：
  - `α > 0`：主 `DirectionalLight` 位置按 §3.3 设置；强度 `0.3 + 0.7·sinα`；色温随高度角插值（低空 0xffb36b → 高空 0xffffff）；阴影相机跟随。
  - `α ≤ 0`（夜间）：主光关闭，`AmbientLight` 降至 0.15，IBL 强度降低，背景色转深蓝。
- `getLightingState()` 返回真实计算值（替换现有硬编码 `{hour:12,...}`）。
- 现有 `setTimeOfDay(hour)` 无生产调用点，直接替换为 `setSolarState`，不保留兼容包装。

### 4.2 `SunlightSystem`

- 持有当前 `{month, day, hour}` 状态，变更时调用 `envManager.setSolarState(getSolarPosition(...))`。
- 太阳轨迹线：对选定日期按 10 分钟采样 `getSolarPosition`，`α > 0` 的点连成 `THREE.Line`（白天弧线），叠加一个太阳圆盘 sprite 标识当前位置。轨迹线随面板开关显隐。
- 播放：`requestAnimationFrame` 驱动，10 秒/天，循环；面板按钮控制。

### 4.3 日照时长分析（`DaylightHeatmap`）

- 默认分析日 = 冬至（12-22），面板可选任意日期。
- 采样：日出→日落按 5 分钟步长取太阳位置。
- 单窗直射判定：`|Δazimuth(sun, windowNormal)| < 90°` 且 `α_sun > max(horizon.obstruction_deg, 0)` 且 `α_sun > 0`。
- 窗→房间归属：窗中点沿内法线方向最近的房间中心（`model-geometry.yaml` rooms 声明数据）所属的房间。
- 房间日照时长 = 其所有窗直射时段的并集长度。
- 西晒警告：房间有窗法线落在 225°–315°（西南–西北）且夏至日 15:00 后存在直射 → `westSunWarning: true`。
- 渲染：`floor_region` 材质按小时数着色（0h 蓝灰 `#4a5568` → ≥4h 暖橙 `#ed8936`，线性插值），房间中心 sprite 标注 `X.Xh`。激活时切换到现有俯视相机模式（`TopDownView`），退出时恢复原视角与原材质。

## 5. 湿度风险模型（二期，`shared/humidity-model.ts`）

静态加性风险索引（0–100），初始权重如下（实现期可调，测试保证单调性）：

### 5.1 房间评分

| 因子 | 取值 | 分值 |
|---|---|---|
| 湿源 `moisture` | low / medium / high | 0 / +15 / +30 |
| 通风 `ventilation` | cross / open / range_hood / mechanical / single_side | −10 / −5 / −5 / 0 / +10 |
| 朝向（几何推导） | 采光面仅朝北 | +10，否则 0 |
| 回南天冷表面 | 房间有 `cold_surface` 声明且日期在 `huinan_window` 内 | +20 |
| 未声明房间 | 默认 `{moisture: low, ventilation: single_side}` | 结论中标注"未声明，用默认值" |

分级：`<25` 低 / `25–50` 中 / `>50` 高。

### 5.2 重点表面评分

表面风险 = 所属房间分 + kind 修正：

| kind | 修正 | 适用 |
|---|---|---|
| `slab`（楼板/地面） | 回南天窗口内 +15 | 入户花园地面 |
| `ext_wall`（朝北外墙） | +10 | 客餐厅北墙 |
| `corner`（热桥角部） | +10 | 西北次卧墙角 |

表面独立分级（同上阈值），高风险表面在 3D 中脉冲高亮。

### 5.3 输出

每个房间/表面返回 `{score, tier, factors: [{label, delta}]}`，因子拆解供 UI 弹层与 MCP 文本引用。

## 6. UI（全点击化，零新快捷键）

### 6.1 入口（`app/index.html` 第 73 行 `#topdown-btn` 旁）

```html
<button id="sunlight-btn" title="日照模拟">日照</button>
<button id="humidity-btn" title="湿度风险">湿度</button>
```

- `SunlightButton` / `HumidityButton`：仿 `TopDownButton`（构造时绑定 DOM，click → toggle，active 高亮）。
- 现有 `CommandPalette` 仅为快捷键参照表（渲染 `KEY_BINDINGS`），无命令注册机制，不扩展；入口可发现性由按钮位置（与"俯视"同排）保证。
- **不新增任何快捷键**，`keybindings.ts` 不动。

### 6.2 `SunlightPanel`

- 日期滑杆（1/1–12/31）+ 季节预设按钮（冬至/夏至/春分/秋分）
- 时刻滑杆（0–24h，步长 0.25h）+ 太阳高度角/方位角实时读数
- ▶/⏸ 播放（10 秒/天）
- "日照热力图"切换按钮（激活 `DaylightHeatmap`，自动俯视）
- 回南天提示条：日期落入 `huinan_window` 时显示"当前处于回南天窗口"（二期启用）

### 6.3 `HumidityOverlay`

- `floor_region` 材质按风险等级半透明着色（低绿 `#48bb78` / 中黄 `#ecc94b` / 高红 `#f56565`，opacity 0.35）
- 高风险重点表面：脉冲高亮框（复用 `AnalysisTools.pulsePhase` 机制）
- 点击房间 → InfoPanel 风格弹层显示因子拆解表
- 与 X-ray（`W`）互不干扰

## 7. 服务端 API 与 MCP

### 7.1 REST

```
GET /api/analysis/sunlight?date=12-22
→ {
    date, location: {latitude, longitude}, confidence: "estimated",
    rooms: [{ id, name, directHours, westSunWarning,
              windows: [{ id, faces, exposureIntervals: [[startH, endH]] }] }]
  }

GET /api/analysis/humidity?date=03-15        # date 可选，影响回南天因子
→ {
    confidence: "estimated", huinanActive: true,
    rooms: [{ id, name, score, tier, factors: [{label, delta}], declared: false? }],
    surfaces: [{ id, room, kind, score, tier }]
  }
```

### 7.2 MCP 工具

- `get_sunlight_analysis(date?)`：各房间日照时长 + 西晒警告的文本摘要（引用具体数字）
- `get_humidity_risks(date?)`：风险排序 + 因子拆解 + 对策建议文本（除湿机点位、防潮处理）

计算逻辑全在 `shared/` 纯函数，服务端薄封装。

## 8. 错误处理与数据置信度

- `environment.yaml` 缺失/非法 → zod schema（`shared/environment-schema.ts`）启动期校验失败报错，与 `OverlaySchema` 同模式，**不做静默兜底**。
- 房间 ID 在 `humidity.rooms` 未声明 → 默认因子，结论标注 `declared: false`。
- `horizon.obstruction_deg` 当前为 inferred（待量房，呼应 `house.yaml data_precision` 与 `docs/pending-site-data.md`）→ 所有日照结论带 `confidence: "estimated"`，UI 显示"遮挡数据待量房"角标。量房后升级配置值即可，无需改代码。
- `environment.yaml` 的 `location` 为经纬度唯一来源；`house.yaml city` 保持人工可读字段，不做程序化联动校验（避免双源耦合），但 spec 审阅时人工核对一致性。

## 9. 测试策略

- `shared/solar.test.ts`：
  - 南宁冬至/夏至正午高度角 ≈ 43.7°/89.4°（±1°，对照 NOAA 表值；南宁 φ=22.82° < δ=23.44°，夏至太阳近天顶）
  - 冬至日出 ≈ 07:20 / 日落 ≈ 18:05（南宁，±15 min）
  - 方位角象限正确性（上午偏东、正午偏南、下午偏西）
- `shared/humidity-model.test.ts`：
  - 单调性：moisture high > low；cross 通风 < single_side
  - 回南天窗口内 slab 表面加分生效，窗口外不生效
  - 未声明房间走默认且 `declared: false`
- `app/src/ui/SunlightPanel.test.ts`：滑杆变更 → 状态回调（仿 `FurniturePanel.test.ts` jsdom 模式）
- `app/src/render/HouseScene.test.ts` 扩展：`α ≤ 0` 切夜间模式不抛错
- `tests/server/analysis-routes.test.ts`：两个端点的 schema 与典型值（supertest，仿现有 server 测试）
- 验收（铁律）：`npm run verify:all && npm run test:server && npm run test:app && npm run typecheck`

## 10. 分期边界

**一期（光照）**：`shared/solar.ts` + `environment-schema.ts` + `environment.yaml`（location/horizon/climate 段）+ `EnvironmentManager.setSolarState` + `SunlightSystem` + `SunlightPanel` + `SunlightButton` + `DaylightHeatmap` + `GET /api/analysis/sunlight` + MCP `get_sunlight_analysis`。

**二期（湿度）**：`shared/humidity-model.ts` + `environment.yaml`（humidity 段）+ `HumidityOverlay` + `HumidityButton` + 面板回南天提示条 + `GET /api/analysis/humidity` + MCP `get_humidity_risks`。
