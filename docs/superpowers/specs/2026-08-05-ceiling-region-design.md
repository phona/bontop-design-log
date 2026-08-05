# 吊顶实体渲染与天花板缺口修复 — 设计文档

> 日期：2026-08-05
> 状态：待评审
> 权威源：`config/ceiling.yaml`（吊顶设计意图）、`config/layout/model-geometry.yaml`（几何）、`config/layout/overlay.yaml`（渲染意图）

---

## 一、背景与问题

### 1.1 现状

- 每个 room 自动生成平顶天花板（`HouseScene.ts:575-590`，y = 层高 - 0.005，白色 DoubleSide），仅第一人称模式可见（`setMode` → `setCeilingVisible`，HouseScene.ts:1612）。
- `config/ceiling.yaml` 已声明吊顶设计意图（客厅局部吊顶 0.30m 走管、隐藏晾衣架 0.15m、厨卫铝扣板 0.15m、空调内机点位），通过 `/api/annotations/ceiling` 暴露，但只在**标注模式**渲染成半透明指示器（`AnnotationRenderer.renderCeiling`），第一人称看不到实体吊顶。

### 1.2 两个缺陷

1. **天花板缺口**：天花板只按 room boundary 生成，但有三块区域不属于任何 room——主走廊（`main_corridor_floor`）、次走廊（`corridor_floor`）、入户门厅（`entry_foyer_floor`）。这些区域地板靠 overlay `floor_region` 补丁，天花板无对应补丁 → 第一人称抬头见洞，"墙和天花板没衔接"。
2. **吊顶不可见**：ceiling.yaml 的设计意图（局部吊顶/铝扣板）没有实体几何，第一人称验收时看不到。

### 1.3 顺带发现的类型滞后

`CeilingZone.type` 联合类型（server/config-loader.ts:105）为 `'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor'`，**不含 `aluminum_buckle`**，而 ceiling.yaml 已在用。YAML 加载无校验所以没炸，属潜在隐患，本次一并修复。

---

## 二、设计决策记录（本次讨论结论）

| 议题 | 结论 |
|------|------|
| 吊顶风格权威 | **尊重 ceiling.yaml 现有决策**（2026-07-25 基线），不引入边吊/灯槽/双眼皮新方案 |
| 覆盖范围 | 全部室内区域有顶（含走廊/门厅缺口） |
| 灯槽/灯带 | 本期不做（ceiling.yaml 无 cove 条目；类型联合已预留 `'cove'`，未来加配置即可） |
| 可插拔性 | 纯配置驱动：改/删 ceiling.yaml 条目即生效，代码零改动；某条出问题只影响该区域 |

---

## 三、方案设计

### 3.1 配置层：ceiling.yaml 补三条缺口条目

```yaml
- id: ceiling_main_corridor
  room: living_dining          # 走廊无 room id，归属相邻 room 仅为分组展示
  type: drop
  thickness: 0.30
  area: [4.20, 4.30, 7.20, 5.55]
  note: "主走廊吊顶（藏多联机风管），净高约2.50m"

- id: ceiling_corridor
  room: master_bedroom
  type: drop
  thickness: 0.30
  area: [4.20, 5.55, 7.20, 7.80]
  note: "主卧与父母房之间走廊吊顶（藏风管），净高约2.50m"

- id: ceiling_entry_foyer
  room: entry_garden
  type: drop
  thickness: 0.30
  area: [10.80, 2.90, 13.40, 4.30]
  note: "入户门厅吊顶（藏风管），净高约2.50m"
```

- area 矩形与 overlay.yaml 三个 `floor_region` 的 points 一致（同源坐标系，米）。
- thickness 0.30 与客厅走管区一致（同为藏风管用途）。
- **注意**：`room` 字段在 CeilingZone 中为必填，走廊无 room，填相邻 room 仅作分组/展示用途；渲染只依据 `area`，不依赖 room。

### 3.2 类型层：CeilingZone 联合类型补 `aluminum_buckle`

server/config-loader.ts:105 与 app 侧两份镜像定义（ProblemDetector.ts:23、AnnotationRenderer.ts:28）同步更新：

```ts
type: 'drop' | 'integrated' | 'cove' | 'none' | 'ac_indoor' | 'aluminum_buckle';
```

### 3.3 渲染层：HouseScene 渲染实体吊顶

新增 `renderCeilingZones(zones: CeilingZone[])`：

- 数据源：复用现有 `/api/annotations/ceiling`（App 初始化时已 fetch，透传给 HouseScene，避免二次请求）。
- 只处理带 `area` + `thickness` 的条目（`drop`、`aluminum_buckle`、`integrated`）；`ac_indoor` 归 HvacTopic/标注系统，跳过。
- 几何：每条目生成"下沉板 + 四周边裙"：
  - 顶板：PlaneGeometry(w, d)，y = 2.8 - thickness + 0.002（+2mm 防与自动平顶 Z-fighting）。
  - 边裙：四条薄板从 y=2.8 垂到顶板，封闭侧边，防止斜视穿透。
  - 重叠条目（晾衣架 0.15 在客厅 0.30 区域内）：按声明原样渲染，不同高度不共面，无 Z-fighting；重叠语义由配置负责，后续可加 verify 规则告警。
- 材质：
  - `drop` / `integrated`：石膏板白（沿用 DEFAULT_CEILING 色系），roughness 0.9。
  - `aluminum_buckle`：浅灰白 + metalness 0.3，与石膏板可区分。
- mesh 全部推入 `this.ceilingMeshes` → 自动继承现有模式可见性：**仅第一人称可见**，轨道/俯视隐藏，俯视图不被遮挡。
- userData：`{ type: 'ceiling_zone', objectId: zone.id, roomId: zone.room }`，接入现有拾取/命名体系（`objectDisplayName` 加 `ceiling_zone: '吊顶'`）。

### 3.4 碰撞评估（碰撞铁律留痕）

新增渲染不产生新 SceneElement 类型（走 HTTP 配置管线，非 SceneElement）；吊顶在头顶上方，第一人称 pitch 限制 ±80°，相机永不相交 → **无碰撞**，不触碰 `extractCollisionWalls`。

### 3.5 不涉及

- 自动平顶的声明式迁移（历史遗留的代码推导，单独任务）。
- 灯槽/灯带、边吊、双眼皮（ceiling.yaml 加 `cove` 条目后自然进入渲染范围，渲染层预留 type 分支即可）。
- 风管/管道实体建模。
- 电气回路（吊顶灯如未来做真实点位，须按电气铁律与 electrical.yaml 交叉验证）。

---

## 四、验证

- 修改后运行：`npm run verify:all`、`npm run test:app`、`npm run test:server`、`npm run typecheck`。
- 新增校验（verify-rules）：ceiling.yaml 条目的 `area` 必须在其声明 `room` 的包围盒 ±0.5m 容差内（走廊类条目 room 为相邻归属，容差兜底）；`type` 必须在联合类型内。
- 人工验收：第一人称走进走廊/门厅抬头确认无缺口；客厅看到 0.30m 下沉吊顶与晾衣架浅吊顶；厨卫看到铝扣板吊顶（净高 2.65m 视觉）。

## 五、调整与回退

- 调造型：改 ceiling.yaml 的 `thickness`/`area`/删条目，代码零改动。
- 回退：`git revert` 配置文件即可，渲染幂等，加载失败单条跳过+告警，不影响场景其余部分。
