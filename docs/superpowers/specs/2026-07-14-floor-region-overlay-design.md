# Overlay 扩展：floor_region 与 bay_sill

- 日期：2026-07-14
- 状态：已确认（待实施）
- 前置：`2026-07-14-dxf-overlay-rendering-design.md`（本 spec 是该架构原则在地板层与飘窗层的扩展）

## 背景与问题

### 地板没铺满

当前 3D 地板由 `config/layout/cad-extracted.yaml` 里的房间矩形生成，代码在 `app/src/render/HouseScene.ts:219-231`：

```ts
const floorGeo = new THREE.PlaneGeometry(r.width, r.depth);
```

每个房间得到一个独立矩形地板。由于 CAD 提取的房间矩形之间存在缝隙、走道/过渡区未被任何房间包含，下方深色基础平面（`buildBase`）显露出来，造成视觉上地板没铺满。

### 上飘窗缺失

户型含多处上飘窗（主卧三个、次卧两个），当前 overlay 只定义了 `curtain_run` 玻璃幕墙，没有表达飘窗的**内凹**结构。这些区域在 3D 中仅显示为普通玻璃幕墙，缺少赠送面积的内凹空间。

## 架构原则

延续前置 spec 的铁律：

> **CAD 只出几何，overlay.yaml 出一切意图。代码只读、只执行，禁止推断。**

因此：

- 不通过墙线自动计算地板多边形或飘窗边界（属于几何推断/意图猜测）。
- 新增 `floor_region` 与 `bay_sill` element type，由 `config/layout/overlay.yaml` 显式声明。
- 合并逻辑仍只执行机械规则：保留 DXF 段为 wall、追加 overlay 元素。

## 新增 Element Type 1：floor_region

### Schema

```yaml
version: 1

suppress: []

elements:
  - id: corridor_floor
    type: floor_region
    room: living_dining          # 可选：归属房间，用于未来按房间选材料
    points:                      # 多边形顶点，按顺序首尾闭合，至少 3 个；带 radius 表示圆角
      - {x: 0.63, z: -1.96}
      - {x: 3.08, z: -1.96}
      - {x: 3.08, z: -1.08}
      - {x: 0.63, z: -1.08}
    reason: "客餐厅与走廊过渡区，房间矩形未覆盖"
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 |
| `type` | `'floor_region'` | 是 | 元素类型 |
| `points` | `{x: number, z: number, radius?: number}[]` | 是 | 多边形顶点，≥ 3 个；`radius` 表示该点圆角，复用 `curtain_run` 语义 |
| `room` | string | 否 | 归属房间 ID，未来用于按房间应用不同地砖 |
| `reason` | string | 否 | 声明动机，推荐填写 |

### 渲染

使用 `THREE.ShapeGeometry`（含圆角）生成多边形地板，y=0.006 略高于房间矩形地板，避免 z-fighting。材质复用当前 `DEFAULT_FLOOR`。

## 新增 Element Type 2：bay_sill

### 关键概念

- 上飘窗是**窗洞向内凹陷**的赠送空间，不是从实体墙面上长出的凸块。
- 有窗才有飘窗；飘窗依附于玻璃幕墙，将对应墙段从窗台高到天花板向内凹进。
- 凹陷区域为实心水泥结构，不铺地砖，与玻璃幕墙外表面平齐。

### Schema

```yaml
elements:
  - id: master_left_bay
    type: bay_sill
    points:
      - {x: -5.88, z: -0.93}
      - {x: -5.88, z: 4.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 |
| `type` | `'bay_sill'` | 是 | 元素类型 |
| `points` | `{x: number, z: number}[]` | 是 | 沿外墙的线段，2 个点，和 `curtain_run` 同风格 |
| `depth` | number | 是 | 向内凹进的深度（米） |
| `sill` | number | 是 | 窗台高（米），从地面到窗台 |
| `height` | number | 是 | 从窗台到天花的凹陷高度（米） |
| `reason` | string | 否 | 声明动机 |

### 渲染

- 在 `curtain_run` 玻璃幕墙的基础上，沿 `points` 线段从 `sill` 到 `sill+height`（通常到天顶）向内凹进 `depth`。
- 凹陷部分保持为实心水泥/混凝土材质，不参与地砖铺贴。
- 凹陷与幕墙交接处保持连续，不产生冲突。

### 初版 bay_sill 清单

| id | 线段 | 宽度 | 深度 | 说明 |
|----|------|------|------|------|
| `master_left_bay` | (-5.88, -0.93) → (-5.88, 4.39) | 5.32m | 1.10m | 主卧西墙整段 |
| `master_bottom_bay` | (-5.64, -0.93) → (-2.23, -0.93) | 3.41m | 1.10m | 主卧南墙整段 |
| `master_top_bay` | (-5.64, 4.39) → (-2.23, 4.39) | 3.41m | 1.10m | 主卧北墙整段 |
| `bedroom_nw_bay` | (-5.88, -0.72) → (-5.88, 2.75) | 3.47m | 1.10m | 西北次卧西墙整段 |
| `bedroom_se_bay` | (-1.99, 4.68) → (0.39, 4.68) | 2.38m | 1.10m | 东南次卧北墙整段 |

> 注：`width` 由 `points` 线段长度自动算出，配置里不声明。量房或新数据到达后可单独调整某段 `points`。

## 数据流改动

### shared/types.ts

在 `SceneElement` 判别联合中追加 `floor_region` 和 `bay_sill`：

```ts
export type SceneElement =
  | { type: 'wall'; id: string; x1: number; z1: number; x2: number; z2: number }
  | { type: 'curtain_run'; id: string; points: CurtainPoint[]; height: number; closed?: boolean }
  | { type: 'wall_run'; id: string; points: OverlayPoint[]; height: number }
  | { type: 'glass_infill'; id: string; room: string; wall: Side; center_offset: number; width: number; height: number; sill: number }
  | { type: 'floor_region'; id: string; points: CurtainPoint[]; room?: string }
  | { type: 'bay_sill'; id: string; points: OverlayPoint[]; depth: number; sill: number; height: number };
```

### server/overlay-merge.ts

1. 新增 `FloorRegionSchema` 与 `BaySillSchema`：
   - 所有字段 `.strict()`，未知字段/类型报错。
   - `floor_region.points` 使用 `CurtainPointSchema`，支持 `radius`。
   - `bay_sill.points` 使用 `PointSchema`，至少 2 个点。
2. 把两个 schema 加入 `OverlaySchema.elements` 的 `z.discriminatedUnion`。
3. `mergeSceneElements` 无需额外逻辑：两类元素自动追加到输出数组末尾。

### app HouseScene.ts

1. **renderFloorRegion**：遍历 `floor_region` 元素，用 `THREE.ShapeGeometry` 生成多边形地板（含圆角），y=0.006，材质 `DEFAULT_FLOOR`。
2. **renderBaySill**：遍历 `bay_sill` 元素，基于 `points` 线段与 `curtain_run` 玻璃幕墙，在 `sill` 到 `sill+height` 区间向内凹进 `depth`。

## 防回归护栏

1. **overlay-merge 测试**：
   - `floor_region` 至少 3 个点；`bay_sill` 至少 2 个点。
   - `floor_region` 带 `radius` 时正常解析，非法 radius 报错。
   - 未知 type 或额外字段报错。
   - 未声明时场景输出中不包含 `floor_region` / `bay_sill`。
2. **parse_cad_test.py**：
   - 继续保持 walls 字段白名单（x1/z1/x2/z2），不输出 floor/bay 相关意图字段。
3. **HouseScene 测试**：
   - `floor_region` 生成 mesh，顶点与 `points` 一致（含圆角细分点）。
   - `bay_sill` 在幕墙位置生成凹陷几何，不破坏幕墙连续性。

## 不在范围内

- 不自动从墙线计算地板多边形或飘窗边界。
- 不删除/替换现有房间矩形地板（suppress 机制保持仅用于墙段）。
- 不改动地砖材质/纹理系统（`FloorTopic`、`TextureFactory`）。
- 不引入 `floor_region` 之间的布尔并集/交集运算。
- 不处理下飘窗（可坐式窗台），本 spec 仅针对上飘窗（实心水泥内凹）。
