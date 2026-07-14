# DXF 底稿 + Overlay 配置驱动的 3D 渲染

- 日期：2026-07-14
- 状态：已确认（待实施）
- 前置：`2026-07-13-config-driven-architecture-design.md`（本 spec 是该架构原则在 3D 渲染层的彻底落地）

## 背景与问题

当前 3D 模型渲染不可控，根因是"config 给提示、代码做推断"的模式：

1. **幕墙误判**：`scripts/parse_cad.py` 的 `_mark_curtain_from_config` + `_is_outermost`
   只拿到 `curtain_walls: [{edge: west}, ...]` 这种模糊提示，然后用"最外侧墙判定"
   算法猜哪些段是玻璃幕墙。入户花园、西设备平台的外墙位于边界上，被误判为幕墙。
2. **DXF 信息天然不全**：玻璃幕墙位置图纸上没有墙线（parse_cad.py 用"合并共线补线"
   启发式去补）；窗洞是空洞，没有任何地方声明"洞里该填玻璃"。
3. **牵一发动全身**：全局几何推断（min/max 边界、最外侧判定、斜线弧化）导致改动
   一处坐标，其它位置的分类结果跟着变，无法定位、无法预测。
4. **坐标系静默塌陷**（实施前排查发现）：DXF 房间标签是纯中文、无 ID 前缀，
   "不猜房间 ID"改造后全部被跳过（行为正确），但 `compute_origin` 和
   `label_cluster_bounds` **隐式依赖标签**——labels 为空时静默退化为
   origin=(0,0)、bounds=None，导致 walls 不做原点平移、不过滤图纸副本副本。
   当前提交的 cad-extracted.yaml 中 274 段墙（含两份图纸副本）位于
   x 2.77~40.18 的错误坐标系，与 rooms（x -4.63~10.82，靠 merge 机制保留的
   旧正确几何）完全脱节。另发现 `extract()` 内硬编码追加 entry_garden 几何。

## 架构铁律（本 spec 的核心约束）

> **CAD 只出几何，overlay.yaml 出一切意图。代码只读、只执行，禁止推断。**
> 要新行为 → 新增 element type + 声明式配置；禁止添加基于几何位置/邻接关系的
> 自动分类启发式。

## 分层模型

```
第 0 层  锚点配置      → config/layout/cad-anchor.yaml         DXF→场景坐标系的显式声明
第 1 层  DXF 底稿      → parse_cad.py → cad-extracted.yaml    纯几何，零意图字段
第 2 层  overlay 配置  → config/layout/overlay.yaml           人工声明的权威事实
第 3 层  合并          → server/overlay-merge.ts              确定性合并（suppress + add）
第 4 层  渲染          → app HouseScene                       按元素 type 分发渲染器
```

合并规则只有两条，全部是机械操作，不含任何分类判断：

- **suppress**：声明矩形区域，中点落在区域内的 DXF 墙段被移除
  （语义："这段图纸信息是错的/不要的"）。
- **add**：声明元素（type + 几何 + 尺寸），直接追加进场景
  （语义："图纸没有/画不清，以我为准"）。

改 overlay.yaml 只影响声明的区域。不存在全局推断，因此不存在连锁副作用。

## cad-anchor.yaml Schema（第 0 层，提取修复）

DXF→场景坐标系的换算不再从标签簇推断，改为显式声明：

```yaml
version: 1
# 场景原点在 DXF 图纸上的位置（DXF 毫米坐标）。
# 取自 2026-07-13 正确提取版本的标签质心（git fe31b2d），经门位坐标交叉验证。
dxf_origin: {x: 31642.04, y: -12484.34}
# 有效图框（DXF 毫米坐标）：只提取该矩形内的墙线。
# 用于排除同一 modelspace 里的重复图纸副本（墙体定位图等）。
dxf_frame: {min_x: 25500, min_y: -18200, max_x: 40500, max_y: -7900}
```

- `extract_walls` 的原点平移和副本过滤只用这两个声明值，不再调用
  `compute_origin` / `label_cluster_bounds` 的结果。
- **cad-anchor.yaml 缺失或字段不全 → parse_cad.py 直接报错退出（fail loud），
  绝不静默输出未平移的墙体。**
- 坐标换算公式固定为：`x_scene = (x_dxf - origin.x) / 1000`，
  `z_scene = (origin.y - y_dxf) / 1000`（与现有 rooms 提取一致）。
- 标签仍用于房间提取（有 ID 前缀才提取，无则跳过，靠 merge 保留已核对几何）。

## overlay.yaml Schema

```yaml
version: 1

suppress:                          # 移除 DXF 错误/多余几何
  - id: west_edge_noise            # 唯一 ID，必填
    region: {x1: -6.2, z1: -3.5, x2: -5.6, z2: 5.0}   # 场景坐标（米），矩形
    reason: "幕墙位置的图纸残线"    # 必填，强制记录声明动机

elements:                          # 显式声明的场景元素
  - id: west_curtain
    type: curtain_run              # 玻璃幕墙折线
    points:                        # 有序拐点，≥2 个；相邻点连成一段幕墙
      - {x: -5.88, z: 4.87}
      - {x: -5.37, z: -3.36}
    height: 3.0                    # 米，默认 3.0

  - id: living_south_glass
    type: glass_infill             # 窗洞玻璃填充
    room: living_dining            # 房间 ID（对应 cad-extracted.yaml rooms）
    wall: south                    # north | south | east | west
    center_offset: 0               # 沿墙中心偏移（米），与 house.yaml openings 一致
    width: 3.5                     # 米
    height: 1.6                    # 米
    sill: 0.9                      # 窗台高（米），玻璃从 sill 到 sill+height

  - id: entry_garden_patch
    type: wall_run                 # 补实墙（DXF 缺线时用）
    points: [{x: 6.37, z: -4.08}, {x: 10.82, z: -4.08}]
    height: 3.0
```

### 元素类型（初始集合）

| type | 渲染 | 几何来源 |
|------|------|----------|
| `wall`（隐式） | 实墙材质，20cm 厚 | DXF 提取段，合并后的默认类型 |
| `curtain_run` | 玻璃材质（现有 MeshPhysicalMaterial），8cm 厚 | overlay 声明的折线 |
| `glass_infill` | 玻璃板嵌入洞口 | 房间 + 墙面 + 偏移/尺寸 |
| `wall_run` | 实墙材质，20cm 厚 | overlay 声明的折线 |

### 扩展机制

`type` 是开放集合。后续新增结构柱（`column`）、梁（`beam`）、飘窗台（`bay_sill`）、
栏杆（`railing`）、设备平台百叶等，只需：

1. schema 中定义该 type 的字段；
2. `overlay-merge.ts` 加校验分支；
3. HouseScene 注册对应渲染器。

**未知 type 或字段校验失败 → 走现有配置错误通道**（ConfigLoader status →
StateSync → App 错误横幅），该元素不渲染。**禁止静默跳过、禁止"智能降级"。**

### 幕墙弧角

不再自动探测斜线并弧化。曲线拐角由 `curtain_run` 的 `points` 显式声明
（人工提供细分点即可，弧线在配置里可见、可改）。首版不引入 `bulge`/`radius`
参数——如日后需要，作为 `curtain_run` 的可选字段扩展，仍是声明式。

## 数据流改动

### shared/types.ts

`WallSegment` 演进为 `SceneElement` 判别联合：

```ts
type SceneElement =
  | { type: 'wall';        id: string; x1: number; z1: number; x2: number; z2: number; height?: number }
  | { type: 'curtain_run'; id: string; points: {x: number; z: number}[]; height: number }
  | { type: 'glass_infill';id: string; room: string; wall: Side; center_offset: number; width: number; height: number; sill: number }
  | { type: 'wall_run';    id: string; points: {x: number; z: number}[]; height: number };
```

判别字段统一叫 `type`，与 overlay.yaml 一致，避免层间改名映射。

- `WallSegment.curtain` 字段删除。
- DXF 段在合并层被赋予 `type: 'wall'` 和生成的 `id`（`wall:seg:<index>`，
  与现有 HouseScene userData 命名一致）。
- routes.ts 的 `walls` 字段改为输出合并后的 `SceneElement[]`（字段名改为
  `sceneElements`，一次性 breaking change，前后端同步改）。

### server/overlay-merge.ts（新增）

- 输入：cad-extracted 的纯几何 walls + overlay.yaml。
- **校验用 zod**（已有依赖，mcp-server.ts 在用）：`z.discriminatedUnion('type', ...)`
  对应 SceneElement 联合，所有对象 `.strict()`——未知 type、拼错/多余的字段、
  缺失必填项一律校验失败，错误带路径（如 `elements[2].points`）进配置错误
  通道。TS 类型经 `z.infer` 从 schema 导出，schema 与类型单一来源。
  不引入 pydantic：overlay.yaml 无 Python 消费方。
- 步骤：① suppress 过滤（段中点在 region 内即移除）→ ② 剩余段标记为
  `wall` → ③ elements 校验并追加。
- overlay.yaml 通过现有泛型 `ConfigLoader` 加载，加入 server/index.ts 的
  chokidar watch 列表。**改 overlay.yaml → 热重载 → 浏览器轮询后重渲染**，
  无需重跑 parse_cad.py。
- overlay.yaml 缺失时视同空 overlay（suppress/elements 均为空），DXF 几何
  原样渲染——保证渲染管线不依赖 overlay 存在。

### scripts/parse_cad.py（删除清单）

| 删除项 | 位置（当前） | 理由 |
|--------|-------------|------|
| `_mark_curtain_from_config` | L260-345 | 意图猜测器本体 |
| `_is_outermost` | L280-322 | 全局几何推断 |
| `_load_curtain_config` | L251-257 | 只服务于上面两个 |
| `load_curtain_corners` | L178-206 | 只服务于弧化过滤 |
| `Wall.curtain` 字段及输出 | L57, L1152 | cad-extracted 回归纯几何 |
| `_smooth_diagonals` 弧线合成 | L347-401 | 弧角改由 overlay 声明 |
| `extract()` 内 entry_garden 硬编码 | L919-926 | 几何知识内嵌代码，merge 机制已能保留该房间 |
| walls 提取对 `compute_origin`/`label_cluster_bounds` 的依赖 | L906-914 | 改读 cad-anchor.yaml，缺失即报错 |

house.yaml 删除 `curtain_walls` 与 `curtain_wall_corners` 段（坐标迁移进
overlay.yaml）。

保留：房间标签解析、内墙/开口提取、泛洪填充等**几何提取**逻辑——它们从图纸
读取事实，不推断意图。

### app HouseScene

- 删除 `curtain` 布尔分支（当前 L272-299 一带），改为按 `type` 分发到
  独立渲染函数：`renderWall` / `renderCurtainRun` / `renderGlassInfill` /
  `renderWallRun`。
- `glass_infill` 依赖房间几何定位（复用现有 `_openingPosition` 的定位方式）。
- 高亮/选中逻辑沿用 userData（curtain 类元素保持玻璃材质不参与高亮换材质，
  与现有行为一致）。
- CollisionDetector 基于房间布局生成 AABB，不受本次改动影响（不在范围内）。

## 初版 overlay.yaml 内容

- 西/北/南幕墙 `curtain_run`：**以 house.yaml `curtain_wall_corners`（房间
  坐标系）和修复坐标系后重新生成的 walls 为基准**人工核对，合并为 2-3 条折线。
  当前 cad-extracted.yaml 里的 23 段 `curtain: true` 位于错误坐标系，不可迁移。
- 入户花园、西设备平台外墙：**不声明**——猜测器删除后 DXF 真实墙线默认渲染
  为实墙，误判问题从根上消失。
- 窗洞 `glass_infill`：按 house.yaml 各房间现有 `openings` 中 type=window
  的条目逐一声明（洞口标记功能保留，玻璃填充是新增视觉层）。
- 幕墙位置的 DXF 残线：视核对结果添加 `suppress` 条目。

## 防回归护栏

1. **模块头注释**：parse_cad.py、overlay-merge.ts、HouseScene.ts 顶部写明
   架构铁律原文，并注明"新行为 = 新 element type + 声明，不是新启发式"。
2. **AGENTS.md**：项目根新建（或追加），把铁律写进 AI 会话必读指令。
3. **守卫测试**：
   - parse_cad_test.py：对输出 YAML 的 walls 条目做**字段白名单**断言
     （只允许 x1/z1/x2/z2），出现 `curtain` 等意图字段即失败。
   - overlay-merge 测试：同一段边界墙，overlay 不声明时永远输出
     `type: 'wall'`——断言不存在按位置自动分类的路径。
   - overlay-merge 测试：未知 type 必须产生配置错误，且该元素不进输出。

## 测试计划

- **提取修复**（TDD 先行）：cad-anchor.yaml 加载/字段校验/缺失报错；
  extract_walls 用锚点平移、用图框过滤副本；重新生成后 walls 与 rooms
  同坐标系（范围重叠断言）。
- **overlay-merge 单测**（TDD 先行）：suppress 命中/不命中/边界容差、
  elements 追加、schema 校验失败、未知 type 报错、空 overlay 直通。
- **parse_cad_test.py**：删幕墙相关用例；新增字段白名单守卫测试；
  确认弧化删除后斜线段原样输出。
- **HouseScene 测试**：四种 type 各自渲染正确（mesh 数量/材质/位置）、
  glass_infill 定位。
- **手动验收**：启动后核对——三面幕墙正确、入户花园与设备平台为实墙、
  客餐厅等窗洞有玻璃；修改 overlay.yaml 热重载生效。

## 不在范围内

- 相机取景/spawn 启发式（HouseScene.setCameraTarget、App spawn 推断）——
  另立项目处理。
- parse_cad.py 的房间矩形提取启发式（几何提取，非意图猜测）。
- CollisionDetector 对幕墙的碰撞处理。
- 预设漫游路线（tour）功能。
