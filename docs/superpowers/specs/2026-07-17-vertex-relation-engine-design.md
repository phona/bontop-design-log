# Vertex 关系引擎 — 户型几何拓扑建模

- 日期：2026-07-17
- 状态：草案（待用户 review）
- 前置：
  - `2026-07-14-model-geometry-authoritative-design.md`（确立了 `model-geometry.yaml` 为唯一权威源；本 spec 在该架构上引入 vertex 顶层实体，消除 rooms↔walls 之间的几何冗余）
  - `2026-07-14-floor-region-overlay-overlay-design.md`（`floor_region` 多边形地面路径，本 spec 复用其 `buildRoundedShape`）
  - `2026-07-14-glass-curtain-wall-overlay-config-design.md`（`glass_infill` 的 `room+wall+center_offset` 引用模式，本 spec 将其推广到所有 overlay 元素并升级为 `wall id` 引用）

---

## 1. 背景与问题

### 1.1 场景

「前置装修设计」——参考合同分户图 + 效果图，先出方案看效果，交房后用实测数据替换。当前户型为 701 左单元 U 型户型，共 **10 个房间 + 1 个平台**（`west_platform`）。

### 1.2 当前数据流的冗余问题

`config/layout/model-geometry.yaml` 中存在两套数据编码同一几何：

- **rooms** 用中心坐标：`x, z` 是中心点，`width, depth` 是尺寸（4 字段/房间）
- **walls** 用端点坐标：`x1, z1, x2, z2` 是线段两端（4 字段/墙）

两者关系：room 的 4 条边 = 4 条 wall 的端点。改一面墙 → 要同时改 room 的 `z`/`depth` 和 wall 的 `z1`/`z2`。

**`scripts/validate-room-wall-alignment.ts`（253 行）的存在本身就是冗余的证明**——它专门检查这两套数据是否一致（位置容差 0.05m，重叠容差 0.10m）。如果不冗余，就不需要这个脚本。

`config/layout/overlay.yaml` 还有 **76 个硬编码坐标值**（60 个在 `elements:` 的 `points:` 数组里，16 个在 `suppress:` 的 `region:` 字段里），全部是绝对数字，与 `model-geometry.yaml` 共享坐标系但无任何引用关系。

### 1.3 改一面墙的连锁修改（实证）

把客厅南墙 z=9.95 → 10.20（实际改动会触达的坐标处）：

| 文件 | 字段 | 处数 |
|---|---|---|
| `model-geometry.yaml` | `living_dining.z`, `living_dining.depth` | 2 |
| `model-geometry.yaml` | `bedroom_se.z`, `bedroom_se.depth` | 2 |
| `model-geometry.yaml` | 南墙东段 `z1, z2` | 2 |
| `model-geometry.yaml` | 东南圆角段 1 `z1, z2` | 2 |
| `overlay.yaml` | `living_south_curtain.points[0].z, [1].z` | 2 |
| `overlay.yaml` | `south_east_curtain.points[0].z` | 1 |
| `overlay.yaml` | `bedroom_se_south_bay.points[0].z, [1].z` | 2 |
| `overlay.yaml` | `suppress_living_south.region.z2` | 1 |
| `overlay.yaml` | `suppress_south_east.region.z2` | 1 |
| **合计** | | **15+** |

分散在 2 个文件、9 个元素。遗漏任意一处 → 渲染错位或验证脚本报错。AI 介入算坐标会随机 ±0.3m，不可信。

### 1.4 之前提案的问题

上一轮提案只在 overlay 层引入 `room + wall direction` 引用，**没有消除 rooms↔walls 冗余**。改南墙仍要同时改 `room.depth` 和 `wall` 端点（2 处冗余留下），只是 overlay 自动跟随。痛点只解决 8/10。

本轮决定引入 **vertices 顶层实体**，让 walls 和 rooms 都从 vertices 派生，从根本上消除冗余。

---

## 2. 目标与非目标

### 2.1 目标

1. **改一个顶点 → 全自动联动**：所有引用该顶点的 walls + rooms + overlays 自动跟随，不可能遗漏。
2. **消除 rooms↔walls 几何冗余**：同一几何只在 vertices 中存一次。
3. **渲染器接口形状不变**：resolver 输出的仍是 `x/z/width/depth`（矩形房间）或 `points[]`（非矩形房间）、`x1/z1/x2/z2`（墙）、`points[]`（overlay 元素）。9 个渲染器文件中除 `createRoom` 加 3 行分支外不动。
4. **room-wall 对齐验证退役**：对齐变为构造性（共享顶点），不再需要坐标容差检查。
5. **支持圆角与开放边**：圆角是现实存在的（西南/东南角 r=1.0m），开放边也存在（主卧北边无墙，向走廊开放）。

### 2.2 非目标

- **不做交互式 UI 编辑**（后续轮次，编辑方式本轮不定）
- **不做约束求解器**（不自动保持平行/垂直；约束由人写 YAML 时保证）
- **不取代 CAD**（只借"几何靠引用关联"这一招，不引入草图/特征树/布尔运算）
- **不动 9 个渲染器文件**（除 `HouseScene.ts` 的 `createRoom` 加 3 行分支 + `OpeningDef.wall` 字段语义迁移）
- **不重配 `cad-anchor.yaml`**（独立任务，拆出本 spec 范围）

---

## 3. 架构总览

```
                    vertices  ←  唯一几何源（~30 个 {id, x, z, radius?}）
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       rooms         walls       openings(门/窗)
    (boundary=v[])  (from,to=v)  (hosted on wall, anchor=v)
          │            │
          ↓            ↓
       resolver     resolver
    (boundary→    (wall ref→
     polygon)       points)
          ↓            ↓
   x/z/w/d 或 points   points
          ↓            ↓
          └──── renderer（几乎不动）────┘
                         ↑
                   overlay（引用 wall id）
```

**两级引用**：元素不直接挂 vertices，是 walls 挂 vertices、overlay 挂 walls。语义需要——"客厅南墙的玻璃幕"比"客厅顶点 7→8 的玻璃幕"好读；门/窗挂在墙上（墙是 host）；开放边没有 wall，元素也不会误引用到它。

**联动路径**：改 1 个顶点 → 所有引用它的 walls 自动更新端点 → 所有引用这些 walls 的 elements 自动重算位置。人只碰 vertices，其它全是派生。

---

## 4. 设计决策

| # | 决策 | 要点 |
|---|---|---|
| 1 | 先定数据架构，编辑方式后说 | 本 spec 只定数据 + resolver + 渲染器接口 |
| 2 | B：walls 作为唯一几何源 | 消除 rooms↔walls 冗余，匹配"响应式布局"愿景 |
| 3 | Vertex 模型 | vertices 是顶层实体（~30 个 `{id, x, z, radius?}`），walls 和 rooms 都引用它 |
| 4 | rooms 引用 vertices（非 walls） | 因为有开放边（主卧北边无墙，向走廊开放）；room boundary 含顶点但那段没有 wall |
| 5 | 门 ≠ 顶点 | 门是墙的 hosted element（`OpeningDef` 结构不变），携带 width/height/sill/type/swing |
| 6 | 门 offset 锁定顶点 | `anchor: v_id, offset: 0.9`；移另一个顶点门不动，移 anchor 顶点门跟着走 |
| 7 | 严格校验 | resolver 加载时强制校验：闭合、不自交、逆时针、半径非负、引用存在；违反则报错拒绝加载 |
| 8 | radius 留下（圆角是真的） | vertex 加可选 `radius?: number`；地面走真弧（复用 `buildRoundedShape`），墙走密弦 |
| 9 | 墙弧 = 16 段密弦，地面 = 真弧 | resolver 把"指向圆角顶点的墙"自动修剪到切点 + 插入 16 段直弦；r=1.0m 时弦弧最大偏差 ~5mm，肉眼看是曲面，家具贴合误差 <1cm |

---

## 5. 数据模型

### 5.1 `config/layout/model-geometry.yaml` 新 schema

```yaml
version: '2.0'
unit: m
scale: 0.001
origin: { x: 31.64204, z: -12.48434 }   # 保留，用于日后反向导出 CAD
export_date: '2026-07-17'

# 唯一几何源。每个顶点是户型平面上的一个角点或 T 接点。
# radius 有值 = 圆角顶点，位于两面墙的几何交点处（如西墙 x=0 与南墙 z=9.80 交于 (0, 9.80)）。
# 切点（如 (0, 8.80)、(1.00, 9.80)）由 resolver 自动计算，不作为 vertex 存储。
vertices:
  - { id: v_nw,      x: 0.00,  z: 0.00 }
  - { id: v_sw,      x: 0.00,  z: 9.80, radius: 1.00 }   # 西南圆角，几何角点 (0, 9.80)，r=1.0
  - { id: v_step_b,  x: 7.20,  z: 9.80 }
  - { id: v_step_t,  x: 7.20,  z: 9.95 }
  - { id: v_se_r,    x: 16.40, z: 9.95, radius: 1.00 }    # 东南圆角，几何角点 (16.40, 9.95)，r=1.0
  - { id: v_e_bot,   x: 16.40, z: 0.65 }
  - { id: v_ent_ne,  x: 15.25, z: 0.65 }
  - { id: v_ent_se,  x: 15.25, z: 3.55 }
  - { id: v_ent_sw,  x: 10.80, z: 3.55 }
  - { id: v_ent_nw,  x: 10.80, z: 0.00 }
  # T 接点（内墙接入外墙处）
  - { id: v_bath_s,  x: 2.60,  z: 4.30 }
  - { id: v_bath_n,  x: 2.60,  z: 0.00 }
  - { id: v_nw_s,    x: 5.60,  z: 4.30 }
  - { id: v_vrv_n,   x: 5.60,  z: 0.00 }
  - { id: v_vrv_se,  x: 7.20,  z: 1.00 }
  - { id: v_balc_se, x: 7.10,  z: 2.20 }
  - { id: v_gbath_se,x: 7.10,  z: 4.30 }
  - { id: v_kit_w,   x: 7.20,  z: 0.00 }
  - { id: v_kit_s,   x: 7.20,  z: 4.30 }
  - { id: v_ent_kit, x: 10.80, z: 4.30 }
  - { id: v_liv_se,  x: 13.40, z: 4.30 }
  - { id: v_be_sw,   x: 13.40, z: 5.55 }
  - { id: v_be_se_s, x: 13.40, z: 9.95 }
  - { id: v_be_ne,   x: 16.40, z: 5.55 }
  # 卧室区角点
  - { id: v_mb_nw,   x: 0.00,  z: 5.55 }
  - { id: v_mb_ne,   x: 4.20,  z: 5.55 }
  - { id: v_mb_se,   x: 4.20,  z: 9.80 }
  - { id: v_st_ne,   x: 7.20,  z: 5.55 }

# rooms 引用 vertices 形成闭合多边形（含开放边）。
# 矩形房间仍可用 resolver 派生的 x/z/width/depth 走 PlaneGeometry；非矩形走 buildRoundedShape。
# radius 顶点处，buildRoundedShape 画真弧；resolver 派生的 points 保留 radius 字段。
rooms:
  - id: master_bedroom
    name: 主卧
    boundary: [v_mb_nw, v_mb_ne, v_mb_se, v_sw]   # 4 点闭合，v_sw 带圆角（resolver 自动插入切点和弧）
    height: 3.0
    type: master
  - id: study
    name: 书房
    boundary: [v_mb_ne, v_st_ne, v_step_b, v_mb_se]          # 与主卧共享 v_mb_ne→v_mb_se 边
    height: 3.0
  - id: living_dining
    name: 客餐厅
    boundary: [v_kit_w, v_kit_s, v_liv_se, v_be_se_s, v_step_t]  # v_kit_w→v_kit_s 是开放边；南边到 v_step_t
    height: 3.0
  # ... 其余 7 房间 + 1 平台同理（见附录 §12）

# walls 引用 vertices 的端点。开放边没有 wall。
# 墙在"要素变化点"切开：西墙在 v_mb_nw 切成上下两段，让两个 bay_sill 各引用一整段。
# 圆角顶点（v_sw, v_se_r）是两墙共享的端点；resolver 修剪墙到切点，弧段由 resolver 展开。
walls:
  - { id: w_west_lower,   from: v_nw,      to: v_mb_nw,    height: 3.0, finish: paint }
  - { id: w_west_upper,   from: v_mb_nw,   to: v_sw,       height: 3.0, finish: paint }  # resolver 修剪到切点 (0, 8.80)
  - { id: w_mb_south,     from: v_sw,      to: v_mb_se,    height: 3.0, finish: paint }  # resolver 修剪从切点 (1.00, 9.80) 起
  - { id: w_step,         from: v_step_b,  to: v_step_t,   height: 3.0, finish: paint }
  - { id: w_liv_south,    from: v_step_t,  to: v_be_se_s,  height: 3.0, finish: paint }  # 客厅南墙（到 bedroom_se 分隔处）
  - { id: w_be_south,     from: v_be_se_s, to: v_se_r,     height: 3.0, finish: paint }  # 东南次卧南墙，resolver 修剪到切点 (15.40, 9.95)
  - { id: w_east,         from: v_se_r,    to: v_e_bot,    height: 3.0, finish: paint }  # resolver 修剪从切点 (16.40, 8.95) 起
  - { id: w_mb_east,      from: v_mb_ne,   to: v_mb_se,    height: 3.0, finish: paint,
      openings:
        - { id: d_mb, type: door,   anchor: v_mb_ne, offset: 0.9, width: 0.9, height: 2.1, room: master_bedroom }
        - { id: w_mb_win, type: window, anchor: v_mb_se, offset: 0.6, width: 2.4, height: 1.5, sill: 0.9 }
    }
  # ... 其余 walls（见附录 §12）
  # v_mb_nw→v_mb_ne（主卧北边）没有 wall —— 开放边
```

### 5.2 `config/layout/overlay.yaml` 新 schema

```yaml
# 元素引用 wall id（不再是 points 硬编码）。
# resolver 把 wall id → 两端点 → points。
elements:
  - id: living_south_curtain
    type: curtain_run
    wall: w_liv_south          # 引用墙 id
    height: 3.0

  - id: west_curtain
    type: curtain_run
    walls: [w_west_lower, w_west_upper]   # 跨多面墙，resolver 合并 collinear
    height: 3.0

  - id: master_bedroom_south_bay
    type: bay_sill
    wall: w_mb_south
    depth: 1.1
    sill: 0.45
    height: 2.55

  - id: master_bedroom_west_bay
    type: bay_sill
    wall: w_west_upper         # 占西墙上段（v_mb_nw→v_sw），resolver 修剪到切点 (0, 8.80)
    depth: 0.5
    sill: 0.45
    height: 2.55

  - id: bedroom_nw_west_bay
    type: bay_sill
    wall: w_west_lower         # 占西墙下段（v_nw→v_mb_nw）
    depth: 0.5
    sill: 0.45
    height: 2.55

# floor_region 保留独立 points（补区不是房间，无 wall 可引）。
  - id: entry_garden_floor
    type: floor_region
    points:
      - { x: 10.8, z: 0.65 }
      - { x: 15.25, z: 0.65 }
      - { x: 15.25, z: 3.55 }
      - { x: 10.8, z: 3.55 }
    reason: "入户花园地板"

# suppress 引用 wall id（遮盖整面墙；区域 = wall 的两端点 ± 0 墙厚 buffer）。
suppress:
  - id: suppress_mb_south
    wall: w_mb_south           # 遮盖主卧南墙实体（飘窗让路）
  - id: suppress_liv_south
    wall: w_liv_south          # 遮盖客厅南墙实体（落地玻璃让路）
```

### 5.3 门/窗 schema（hosted on wall）

门/窗挂在 `wall.openings[]` 上（不再挂在 room 上，避免重复），每个 opening 携带：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一 |
| `type` | `'door' \| 'window' \| 'archway'` | 开口类型 |
| `anchor` | vertex id | offset 锁定的顶点（移该顶点 → 门跟着走） |
| `offset` | number (m) | 从 anchor 沿墙方向的距离 |
| `width` | number (m) | 开口宽度 |
| `height` | number (m) | 开口高度 |
| `sill` | number (m, 可选) | 窗台高度（door 无） |
| `room` | room id (可选) | 开门方向（swing 朝哪个房间） |

**offset 语义**：`anchor + offset` 沿墙方向（`from → to`）定位开口中心。移另一个端点 → 墙长变 → 门不动（仍离 anchor 0.9m）；移 anchor 顶点 → 门跟着走。验证：`offset + width/2 ≤ wall_length` 且 `offset - width/2 ≥ 0`。

---

## 6. Resolver 层（新增，~200 行）

新增文件 `server/layout-resolver.ts`。**纯函数，无副作用**——输入原始 YAML，输出 renderer 现有接口格式。

### 6.1 `resolveLayout` 签名

```ts
export interface ResolvedLayout {
  rooms: ResolvedRoom[];
  walls: ResolvedWall[];
  vertices: Vertex[];
}

export interface ResolvedRoom {
  id: string;
  name: string;
  // 派生（向后兼容 renderer）：
  x: number; z: number; width: number; depth: number; height: number;
  // 非矩形时填充，矩形时为 undefined：
  points?: CurtainPoint[];
  type?: string;
}

export interface ResolvedWall {
  id: string;
  // 端点（renderer 现有格式）：
  x1: number; z1: number; x2: number; z2: number;
  height: number;
  finish?: string;
  // resolver 把弧展开成 16 段密弦后，wall 可能变成多段：
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  openings?: ResolvedOpening[];
}

export function resolveLayout(raw: RawLayoutYaml): ResolvedLayout;
```

### 6.2 派生规则

- **顶点索引**：`vMap = Map<id, {x, z, radius?}>`
- **room.points**：`r.boundary.map(id => vMap[id])`（含 radius）
- **room 派生字段**：
  - `points` 是矩形（4 顶点、轴对齐、无 radius） → `x/z/width/depth` 从 bbox 算，`points = undefined`（走 PlaneGeometry）
  - `points` 非矩形 → `x/z` = bbox 中心，`width/depth` = bbox 尺寸，`points` 保留（走 buildRoundedShape）
  - 这样 renderer 看到的矩形房间与现在完全一样，非矩形才走新路径
- **wall 端点**：`x1 = vMap[from].x, z1 = vMap[from].z, ...`
- **wall 圆角处理**：from 或 to 顶点带 radius → 算切点 → wall 画到切点 + 插入 16 段密弦（见 §6.4）
- **opening 解析**：`anchor + offset` → 绝对位置（沿墙方向，从 from 到 to）

### 6.3 `resolveWallRef`（在 `server/overlay-merge.ts` 中）

```ts
export function resolveWallRef(
  wallId: string | string[],
  walls: ResolvedWall[]
): CurtainPoint[];
```

- 单 wall id → 返回两端点 `[{x, z}, {x, z}]`
- 多 wall id（如 `west_curtain` 跨两面墙）→ 合并 collinear 段，返回合并后的 points
- 不存在的 wall id → 抛错（严格校验）

### 6.4 圆角展开算法（墙的 16 段密弦）

```
对每面墙 w (from=v1, to=v2):
  切点计算：
    v_corner = v1.radius ? v1 : (v2.radius ? v2 : null)
    if v_corner == null:
      输出 segments: [{x1: v1.x, z1: v1.z, x2: v2.x, z2: v2.z}]
      x1/z1/x2/z2 = v1/v2 原值（用于 overlay 引用）
    else:
      1. 圆心 = v_corner 沿入射方向回退 r（邻接两墙方向的角平分线）
      2. 切点1 = v_corner→v1 方向上距圆心 r 处（在 v1 侧墙线上）
         切点2 = v_corner→v2 方向上距圆心 r 处（在 v2 侧墙线上）
      3. wall 的 x1/z1/x2/z2 = 切点（用于 overlay 引用，只含直线段）
      4. segments 输出规则（弧段只归属一面墙，避免重复渲染）：
         - w 的 from 顶点带 radius → segments 前面插入弧的 16 段密弦
         - w 的 to 顶点带 radius → segments 不追加弧（弧由邻接墙的 from 侧负责）
         - 即：弧段归属于"以该圆角顶点为 from"的那面墙
      5. 16 段等角度离散（圆心角 / 16），每段一个 BoxGeometry
```

**示例**（西南角 v_sw(0, 9.80, r=1.00)）：
- w_west_upper (from=v_mb_nw, to=v_sw): `to` 带 radius → 修剪 to 到切点 (0, 8.80)，segments = [直段 (0,5.55)→(0,8.80)]，无弧
- w_mb_south (from=v_sw, to=v_mb_se): `from` 带 radius → 修剪 from 从切点 (1.00, 9.80) 起，segments = [16 段弧 (0,8.80)→(1.00,9.80)] + [直段 (1.00,9.80)→(4.20,9.80)]
- x1/z1/x2/z2 用于 overlay 引用（bay_sill 拿到的是直线段，不含弧）——正确，飘窗在直墙上

地面侧：`buildRoundedShape`（`HouseScene.ts:736` 现有）直接吃 `CurtainPoint[]`，radius 顶点处画真弧（`shape.absarc`）。地面与墙在 ~5mm 级一致（r=1.0m、16 段，弦弧最大偏差 4.8mm）。

### 6.5 校验（严格，加载时强制）

`resolveLayout` 在返回前执行：

| 规则 | 失败行为 |
|---|---|
| 每个 vertex 有 id 且唯一 | 抛错：`Duplicate vertex id: v_xxx` |
| 每个 vertex 的 x/z 是有限数 | 抛错 |
| radius（若有）非负 | 抛错 |
| 每个 room.boundary 顶点 id 存在 | 抛错：`Unknown vertex: v_xxx in room master_bedroom` |
| 每个 room.boundary 闭合（首尾自动闭合，不要求首=尾） | 自动闭合 |
| 每个 room.boundary 不自交 | 抛错：`Self-intersecting boundary in room xxx` |
| 每个 room.boundary 逆时针（CCW）；顺时针自动反转 | 自动反转 + 警告 |
| 每个 wall.from/to 顶点存在 | 抛错 |
| 每个 opening.anchor 顶点存在且在该 wall 上 | 抛错 |
| `offset + width/2 ≤ wall_length` 且 `offset - width/2 ≥ 0` | 抛错：`Opening d_xxx 超出 wall w_xxx` |
| overlay 的 wall 引用存在 | 抛错 |

**失败即拒绝加载**——不允许半错半对的状态进入渲染器。这与 AGENTS.md 现有"验证脚本"风格一致。

---

## 7. 渲染器改动（极小）

### 7.1 `createRoom` 加 3 行分支（`HouseScene.ts:498`）

```ts
// 改前：
const floorGeo = new THREE.PlaneGeometry(r.width, r.depth);

// 改后：
const floorGeo = r.points
  ? new THREE.ShapeGeometry(this.buildRoundedShape(r.points))   // 非矩形：复用 floor_region 路径
  : new THREE.PlaneGeometry(r.width, r.depth);                  // 矩形：原样
```

`buildRoundedShape`（`HouseScene.ts:736`）已存在且在 `floor_region` 生产中使用，支持 radius 真弧。

### 7.2 `OpeningDef.wall` 字段语义迁移

`shared/types.ts:134-140`：

```ts
// 改前：
export interface OpeningDef {
  type: string;
  wall: string;            // 'north' | 'south' | 'east' | 'west'（方向字符串）
  width: number;
  height: number;
  center_offset?: number;
}

// 改后：
export interface OpeningDef {
  id: string;
  type: string;
  wall: string;            // wall id（如 'w_mb_east'）
  anchor: string;          // vertex id
  offset: number;
  width: number;
  height: number;
  sill?: number;
  room?: string;           // 开门方向
}
```

`HouseScene.ts:542-547`（`_openingPosition`）改为按 wall id 查端点 + anchor offset 算位置（resolver 已算好绝对位置，直接用）。

### 7.3 圆弧墙渲染（resolver 输出密弦，渲染器不变）

resolver 把弧展开成 16 段直弦后，`ResolvedWall.segments` 是多段。`HouseScene.ts:599`（`renderWallSegment`）现在按单段画 `BoxGeometry`——改为遍历 `segments`，每段画一个 `BoxGeometry`。渲染器其它逻辑不动（材质、厚度、阴影一致）。

> **简化选项**：如果 `segments` 只在圆角墙出现，渲染器可以只对 `segments.length > 1` 的墙走循环，单段墙走原路径。

### 7.4 `glass_infill` 迁移

`glass_infill` 现在用 `room + wall direction + center_offset`（`HouseScene.ts:850-877`），和新系统的 `wall id + anchor + offset` 重复。迁移时一起转成 wall id 引用，统一一套引用机制。`glass_infill` 是活代码有渲染路径（`HouseScene.ts:850`），只是 `overlay.yaml` 没用——转了不浪费。

### 7.5 不动的文件

| 文件 | 原因 |
|---|---|
| `FloorTopic.ts` `WallTopic.ts` `PaintTopic.ts` | 只委托 `SceneApi`，不读几何 |
| `HvacTopic.ts` | 读 `room.x/z/width/depth/height`（resolver 派生后不变） |
| `FurnitureFactory.ts` | 读 `room.x/z`（不变） |
| `TopDownView.ts` | 读预算好的 `bounds`（不变） |
| `CameraAnimator.ts` | 读 `camera.position`（不变） |
| `server/budget-calculator.ts` | 读 `room.width * room.depth`（矩形时不变；非矩形时 resolver 派生 bbox 的 width/depth 是包围盒，预算按包围盒算略有高估——见 §11 风险） |

---

## 8. 验证

### 8.1 严格校验（§6.5）在 resolver 加载时执行

失败即拒绝加载，不允许半错半对状态进入渲染器。

### 8.2 新增 `scripts/verify-topology.ts`

独立脚本，跑 `resolveLayout` + 额外拓扑检查：

- 每个 room.boundary 闭合多边形且不自交
- 每个 wall.from/to 顶点存在
- **开放边显式声明**：每个 room 的 boundary 边要么对应一条 wall，要么在 `open_edges` 列表里声明（避免误删墙导致地面外漏）。`open_edges` 是 room 的可选字段，列出 boundary 索引对（如 `[(0,1), (2,3)]`）表示这些边是开放边。
- openings 的 anchor 顶点在目标 wall 上 + offset+width/2 ≤ wall 长度
- 所有 overlay 的 wall 引用存在

### 8.3 退役 `scripts/validate-room-wall-alignment.ts`

room-wall 对齐变为构造性（共享顶点），不需要坐标容差检查。退役该脚本（可保留为历史参考，移至 `scripts/archive/`）。

### 8.4 现有 `scripts/verify-layout.ts` 仍可用

它查 room-room AABB 重叠（`r.x - r.width/2` 等）。resolver 派生 `x/z/width/depth` 后，该脚本直接可用。非矩形房间的包围盒可能略大于实际多边形，重叠检查会偏保守（多报不漏报）。

### 8.5 AGENTS.md 验证命令更新

```bash
npx tsx scripts/verify-topology.ts       # 新增（替代 validate-room-wall-alignment）
npx tsx scripts/verify-layout.ts         # 仍用
npm run test:server
npm run typecheck
```

---

## 9. 迁移阶段

| Phase | 内容 | 文件 | 风险 | 验证 |
|---|---|---|---|---|
| **1** | 加 Vertex/WallRef 类型 + resolver + 单测（不改数据，新旧格式并存） | `shared/types.ts` 新增类型；`server/layout-resolver.ts` 新建；`server/overlay-merge.ts` 加 `resolveWallRef`；renderer 暂不动 | 低 | resolver 单测全绿；现有数据走旧路径渲染不变 |
| **2** | `createRoom` 加 3 行分支；`OpeningDef` schema 迁移；圆弧墙 segments 渲染 | `app/src/render/HouseScene.ts`；`shared/types.ts` | 中 | 现有数据（旧格式）渲染不变；新格式 fixture 渲染对 |
| **3** | `model-geometry.yaml` 转 vertices/rooms/walls（脚本辅助生成 + 人工核对） | `config/layout/model-geometry.yaml` | 中 | `verify-topology` + `verify-layout` 全绿；渲染视觉与转换前一致（截图比对） |
| **4** | `overlay.yaml` 转 wall 引用（能转的转，`floor_region` 保留 points） | `config/layout/overlay.yaml` | 低 | `verify-topology` 全绿；渲染视觉一致 |
| **5** | 退役 `validate-room-wall-alignment.ts`；新增 `verify-topology.ts`；更新 `AGENTS.md`；全量跑验证 | `scripts/`；`AGENTS.md` | 低 | 所有 4 条验证命令全绿 |

**cad-anchor 重配（原提案 Phase 3）独立做，不混进来。**

**旧格式淘汰**：Phase 4 完成后一刀切删除旧解析路径（不再永久支持 `points` 硬编码的 curtain_run/bay_sill/suppress）。`floor_region` 例外（补区无 wall 可引，永久保留 points）。

---

## 10. 测试计划

### 10.1 Resolver 单测（`server/layout-resolver.test.ts`）

| 用例 | 验证 |
|---|---|
| 矩形房间（4 顶点、轴对齐、无 radius） | `points = undefined`，`x/z/width/depth` 从 bbox 算对 |
| 非矩形房间（带圆角顶点） | `points` 保留，含 radius；`x/z/width/depth` = bbox |
| 移动顶点 → 引用它的 room 派生字段自动更新 | 改 `v_step_t.z` 9.95→10.20 → `living_dining.depth` 变 |
| 移动顶点 → 引用它的 wall 端点自动更新 | 同上 → `w_liv_south.x2/z2` 变 |
| wall 圆角展开 | from/to 带 radius → `segments.length = 1 + 16 + 1`（前直段 + 16 弦 + 后直段） |
| opening 锁定 anchor | 移 anchor 顶点 → opening 绝对位置变；移另一端 → 不变 |
| 未知 vertex id | 抛错含 vertex id + room id |
| boundary 自交 | 抛错 |
| boundary 顺时针 | 自动反转 + 警告 |
| opening 超出 wall | `offset + width/2 > wall_length` → 抛错 |
| overlay wall 引用不存在 | 抛错含 wall id + element id |

### 10.2 端到端验证

- Phase 3 后：截图比对转换前后 3D 视觉（用 floor-plan-compare skill）
- Phase 4 后：再比一次
- 改 `v_step_t.z` 9.95→10.20 → 验证 `living_south_curtain` / `suppress_liv_south` / `bedroom_se_south_bay` 全自动跟随（**这是最初痛点的回归测试**）

---

## 11. 风险与开放问题

### 11.1 预算对非矩形房间的偏差

`server/budget-calculator.ts:15-19` 用 `room.width * room.depth` 算面积。矩形时精确；非矩形时 resolver 派生的 `width/depth` 是包围盒，预算会**高估**（如 L 形房间多算缺角面积）。

**对策**：`ResolvedRoom` 加 `area: number` 字段（多边形面积公式，resolver 算真值），`budget-calculator.ts` 改用 `room.area ?? room.width * room.depth`。改动 ~3 行。Phase 2 一起做。

### 11.2 圆角墙的 16 段密弦精度

r=1.0m × 16 段 → 每段弦长 ~19.6cm，弦弧最大偏差 4.8mm。肉眼看是曲面，家具贴合误差 <1cm（家具自身公差 1-2cm）。如果后续需要完美真弧，升级为 `type: arc` 墙 + `CylinderGeometry` 渲染（~40 行），数据不用改（vertex.radius 不变）。

### 11.3 开放边的误删风险

如果误删一条 wall 但没在 room 的 `open_edges` 声明，`verify-topology.ts` 会报错（避免地面外漏）。这是安全网，但要求迁移时显式列出所有开放边。当前开放边：
- `master_bedroom` 北边（v_mb_nw → v_mb_ne）
- `living_dining` 西边（v_kit_w → v_kit_s）—— 实际是厨房-客餐厅分隔的下半段
- （迁移时需全量盘点，附录 §12 待补）

### 11.4 `glass_infill` 与新系统的并存

`glass_infill` 现有用 `room + wall direction + center_offset`，新系统用 `wall id + anchor + offset`。Phase 4 迁移 overlay 时决定：`glass_infill` 转成新引用（统一一套机制），还是保留旧 schema（两套并存）。

**建议**：转成新引用，废弃 `glass_infill` 的旧 schema。它是活代码但 `overlay.yaml` 没用，转了不浪费，且避免两套引用机制长期并存的技术债。

### 11.5 多 wall 合并 collinear 的边界情况

`west_curtain` 跨 `[w_west_lower, w_west_upper]`，两段共线（都 x=0）。resolver 合并成一段 points。但如果两面墙不共线（如 L 形），合并规则未定义。

**对策**：resolver 检测不共线时抛错（严格校验），要求用户拆成多个 element。不自动处理 L 形（避免隐藏复杂度）。

---

## 12. 附录：完整 vertex/room/wall 列表

> **本附录是初步盘点，不是最终数据。** Phase 3 启动时由脚本从当前 `model-geometry.yaml` 的 rooms + walls 字段生成 vertex 候选集，人工核对去重 + 命名后 finalized。§5.1 的示例已用仓库实际坐标证明了数据模型可行；本附录的"待盘"条目是工作量估算，不是 spec 缺口。

### 12.1 Vertices（~28 个）

外框 7（含 2 圆角顶点替代原 6 个弦段端点）+ T 接点 12 + 卧室区 4 + 入户花园 4 + 内墙角点 ~1 = ~28。具体清单见 §5.1 的 `vertices:` 段（已列出全部）。

### 12.2 Rooms（10 + 1 platform）

> "待盘" = Phase 3 迁移时从现有 `model-geometry.yaml` 的 `x/z/width/depth` 自动生成 boundary，无需 spec 预先定义——所有矩形房间的 boundary 就是 4 个角顶点，脚本可自动推导。

| id | boundary（顶点序列） | 开放边 |
|---|---|---|
| master_bedroom | [v_mb_nw, v_mb_ne, v_mb_se, v_sw] | (v_mb_nw, v_mb_ne) 北边 |
| study | [v_mb_ne, v_st_ne, v_step_b, v_mb_se] | 无 |
| living_dining | [v_kit_w, v_kit_s, v_liv_se, v_be_se_s, v_step_t] | (v_kit_w, v_kit_s) 西边 |
| bedroom_se | [v_be_sw, v_be_se_s, v_se_r, v_be_ne] | 待盘（Phase 3 推导） |
| entry_garden | [v_ent_nw, v_ent_ne, v_ent_se, v_ent_sw] | 待盘（Phase 3 推导） |
| master_bath | 待盘（Phase 3 脚本自动推导 4 角顶点） | 待盘 |
| bedroom_nw | 待盘（同上） | 待盘 |
| guest_bath | 待盘（同上） | 待盘 |
| kitchen | 待盘（同上） | 待盘 |
| balcony | 待盘（同上） | 待盘 |
| west_platform | 待盘（同上） | 待盘 |

### 12.3 Walls（~25 段）

外框 7（含 2 圆角顶点替代原 4 段弦墙）+ 内墙左侧 6 + 内墙 VRV/阳台/客卫 5 + 内墙厨房/客餐厅/东南 5 = ~23 段。墙在房间角点 + bay_sill 变化点切开。

---

## 13. 与之前提案的差异

| 维度 | 旧提案（overlay 层引用） | 本 spec（vertex 关系引擎） |
|---|---|---|
| 引入的顶层实体 | 无（rooms/walls 格式不变） | vertices（~30 个） |
| 消除的冗余 | 无（room/wall 仍冗余） | rooms↔walls 几何冗余消除 |
| overlay 引用 | `room + wall direction` | `wall id`（间接引用 vertices） |
| 改南墙 9.95→10.20 | 改 room + wall 2 处 + overlay 自动 | 改南墙上 3 个顶点 z（v_step_t, v_be_se_s, v_se_r）→ 全自动 |
| room-wall 对齐验证 | 仍需要（冗余留下） | 退役（构造性对齐） |
| 渲染器改动 | 0 行 | `createRoom` 3 行 + 圆弧墙 segments 遍历 |
| 数据模型复杂度 | 低（无新实体） | 中（vertices 顶层 + boundary 引用） |
| 联动能力上限 | overlay 跟随 | 全自动（room + wall + overlay） |

本 spec 是旧提案的 superseding——消除冗余才能实现"改一处自动联动"的完整愿景。
