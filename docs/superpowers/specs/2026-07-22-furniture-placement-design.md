# Design: Furniture Placement（位置 schema + 渲染 + MCP 暴露）

## Status

Draft → pending implementation

## Scope

补齐 2026-07-21 spec（`2026-07-21-budget-advisor-enhancement-design.md`）显式延后的 future work（L1149/L1220）：家具从"房间中心占位盒"升级为声明式摆放。三个改动共 ~300 行代码 + 1 个校验脚本：

1. **位置 schema** — `house.yaml` furnishings 从 `Record<type, count>` 升级为带 `x/z/rotation` 的条目列表，counts 由列表 derive，预算语义不变
2. **渲染支持** — `FurnitureFactory.placeFurnishings` 按位置/朝向渲染，支持同类型多实例（4 把餐椅）
3. **MCP 暴露** — `get_room_layout` / `get_furniture_inventory` 返回位置，AI 可推理门 swing、间距冲突（read-only，无写入工具）

### Out of Scope

- `set_furniture_position` 写入工具（yaml 写回格式保持）— 下一迭代
- 新家具模型（chair/bookshelf/kitchen 柜体仍 count-only）
- 自动布局引擎（AI 推理，不自动生成摆位）
- 拖拽摆放 UI

## Background

### Current State

- `config/house.yaml:378-438` 的 `furnishings` 为 `Record<roomId, Record<type, count>>`，只声明"哪个房间、什么类型、几件"
- `app/src/render/FurnitureFactory.ts:107` 把所有家具硬编码放在房间中心 `(room.x, 0, room.z)`，无朝向，同类型 count>1 被忽略（`dining_chair: 4` 只渲染 1 把）
- 结果：沙发/床/衣柜全部叠在房间中心点，视觉上互相穿插
- 位置推断写死在代码里，违反项目铁律"overlay/config 出一切意图，代码只读不推断"的精神

### Consumers of furnishings（迁移面，全在仓内）

| 消费方 | 位置 | 用途 |
|---|---|---|
| `BudgetCalculator` | `server/budget-calculator.ts:61-77`（door_count/fixture_count）、`:131-133`（count calcMode） | 预算数量来源 |
| `ProjectCatalog` | `server/project-catalog.ts:142/277/315/346` | 加载 + getRoomLayoutDetail |
| MCP `get_furniture_inventory` | `server/mcp-server.ts:588-606` | 家具库存 + 尺寸解析 |
| REST `/api/project` | `server/routes.ts:43` | 前端数据源 |
| `HouseScene.buildFromCatalog` | `app/src/render/HouseScene.ts:450-452` → `placeFurnishings` | 3D 渲染 |
| 测试 | `tests/server/mcp.test.ts:335`、`project-catalog.test.ts:113`、`budget-calculator.test.ts:164` | 断言旧 shape |

## Design

### Change 1: 位置 schema（`config/house.yaml` + `shared/types.ts`）

新格式（坐标为 **model-geometry 同一局部坐标系**，绝对值，米）：

```yaml
furnishings:
  master_bedroom:                    # x∈[0,4.20], z∈[5.55,9.80]
    - { type: bed_180,      x: 1.05, z: 8.65, rotation: 180 }   # 床头靠南墙
    - { type: wardrobe_240, x: 0.30, z: 6.75, rotation: 90 }    # 沿西墙
    - { type: mattress_180 }            # count-only：预算条目，不渲染
    - { type: curtain_set }
    - { type: ceiling_light }
  living_dining:
    - { type: sofa_3seat,   x: ..., z: ..., rotation: ... }
    - { type: dining_table, x: ..., z: ..., rotation: 0 }
    - { type: dining_chair, x: ..., z: ..., rotation: 0 }      # 4 实例 = 4 条目
    - { type: dining_chair, x: ..., z: ..., rotation: 90 }
    - { type: dining_chair, x: ..., z: ..., rotation: 180 }
    - { type: dining_chair, x: ..., z: ..., rotation: 270 }
    - { type: tv_stand,     x: ..., z: ..., rotation: ... }
    - { type: curtain_set, count: 2 }
    - { type: ceiling_light, count: 2 }
```

规则：

- 有 `x/z` → **placed 实例**（渲染 + MCP 暴露位置）；无 → **count-only**（只喂预算/库存，如 mattress、curtain_set、厨卫洁具、延米橱柜）
- `count` 仅 count-only 条目使用（默认 1）；placed 实例每条目算 1
- `rotation`：度数，直接赋 `rotation.y`，0 = 模型默认朝向（床头/沙发靠背朝北 `-z`）
- 坐标必须落在所属房间 bbox 内（verify 脚本强制）
- 延米类保留小数支持：kitchen `cabinet_base: 3.5` → `{ type: cabinet_base, count: 3.5 }` count-only

`shared/types.ts`：

```typescript
export interface FurnishingItem {
  type: string;
  count?: number;      // count-only 条目使用，默认 1；placed 实例每条目算 1
  x?: number;          // model-geometry 局部坐标，米
  z?: number;
  rotation?: number;   // 度，绕 Y 轴，默认 0
}

export interface FurnishingsYaml {
  [roomId: string]: FurnishingItem[];
}
```

**counts derive**（预算引擎零语义变化的关键）— `ProjectCatalog` 新增：

```typescript
getFurnishingCounts(roomId?: string): Record<string, number>
// 例：master_bedroom → { bed_180: 1, wardrobe_240: 1, mattress_180: 1, curtain_set: 1, ceiling_light: 1 }
// 例：living_dining → { sofa_3seat: 1, dining_table: 1, dining_chair: 4, tv_stand: 1, curtain_set: 2, ... }
```

- placed 条目每条目计 1；count-only 条目计 `count ?? 1`
- `budget-calculator.ts:61-77`（door_count/fixture_count）和 `:131-133`（count calcMode）改读 derive 结果，行为与现状逐字节一致
- 验收：迁移前后 `get_budget` 输出 diff 为空

### Change 2: 渲染支持（`app/src/render/FurnitureFactory.ts`）

`placeFurnishings` 重写（~40 行）：

- 遍历条目列表，跳过无 `x/z` 的 count-only 条目
- `model.position.set(item.x, 0, item.z)` + `model.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0)`
- `objectId: furniture:${roomId}:${type}:${index}`（多实例唯一）
- 删除房间中心放置逻辑（旧 L107）；skip-list 保留作为防御，但正常配置下不再触发（count-only 类型天然无位置）
- `HouseScene.ts:51` 与 `:450-452` 仅类型签名更新（`FurnishingItems` → `FurnishingsYaml`）

### Change 3: MCP 暴露（read-only）

`getRoomLayoutDetail`（`project-catalog.ts:315`）的 `furnishings` 字段改为：

```typescript
furnishings: {
  placed: Array<{ type: string; x: number; z: number; rotation: number }>;
  counts: Record<string, number>;
}
```

`get_furniture_inventory`（`mcp-server.ts:588`）：placed 条目附加 `x/z/rotation`，其余字段（count/dimensions/spec/materialId）不变。

效果：关闭 07-21 spec L1220 的限制——AI 拿到门洞位置（已有）+ 家具位置（新增）即可推理 swing 冲突、过道净宽。冲突推理本身是 AI 的职责，不在代码侧实现。

### Change 4: 校验脚本 `scripts/verify-furniture-placement.ts`（~120 行）

对每条 placed 实例：

1. **在房间内**：AABB 中心 ± 半尺寸 ⊆ 房间 bbox（容差 1cm）
2. **不重叠**：同房间两两 AABB 不相交（尺寸表 `FURNITURE_DIMS` 放 `shared/types.ts`，与 `FurnitureFactory.createFurniture` 几何对齐）
3. **不挡门 swing**：AABB 不与门洞摆动区相交（门洞中心沿墙 ±width/2，向房内延伸 width 的矩形）

接入：`package.json` 加 `verify:furniture`；AGENTS.md 校验命令清单追加。

### 初始摆位数据

实现时为 6 个可渲染房间（master_bedroom / bedroom_nw / bedroom_se / study / living_dining，+ 可选 entry_garden 鞋柜）编写全部 placed 条目。摆放规则：

- 床头/沙发靠背靠墙
- 衣柜沿墙
- 餐桌居中用餐区，4 椅四边
- 沙发面向 tv_stand
- 主通道 ≥0.8m

验收 = verify 脚本全绿 + floor-plan-compare 截图目检。

## Design Decisions

- **house.yaml 内嵌而非 overlay.yaml 新元素类型**：furnishings 已是预算引擎的数据源，拆分会导致 counts 与 positions 两处漂移；内嵌保持单一权威源。overlay.yaml 保持纯建筑意图（suppress/curtain_run/railing_run/bay_sill/floor_region）。
- **绝对坐标而非房间相对坐标**：与铁律一致（overlay 必须与 model-geometry 同坐标系），且跨房间比较/校验不需要二次换算。
- **counts derive 而非双写**：`Record<type, count>` 是从列表 derive 的视图，消除"列表与 counts 不一致"的整个故障类别。
- **MCP 只读**：写入工具需要 yaml 写回且保持注释/格式，复杂度高、收益后置；AI 当前可以通过对话向用户建议摆位，由人改配置。
- **有 breaking change**：`FurnishingsYaml` shape + `/api/project` payload 变更。与 07-21 spec 的零破坏策略不同，但消费者全在仓内（见 Background 表），一并迁移。

## Impact

| 文件 | 改动 |
|---|---|
| `config/house.yaml` | furnishings 段重写（~60 → ~90 行） |
| `shared/types.ts` | FurnishingItem + FurnishingsYaml + FURNITURE_DIMS（~25 行） |
| `server/project-catalog.ts` | derive counts + getRoomLayoutDetail 改造（~35 行） |
| `server/budget-calculator.ts` | 3 处改读 derive counts（~10 行） |
| `server/mcp-server.ts` | inventory 带位置（~15 行） |
| `app/src/render/FurnitureFactory.ts` | placeFurnishings 重写（~40 行） |
| `app/src/render/HouseScene.ts` | 类型签名（~5 行） |
| `scripts/verify-furniture-placement.ts` | 新增（~120 行） |
| `tests/server/` ×3 + `package.json` + `AGENTS.md` | ~50 行 |

## Verification

- `npm run typecheck` 通过
- `npm run test:server` 通过（3 个测试文件更新为新 shape）
- `npx tsx scripts/verify-furniture-placement.ts` 全绿
- `npx tsx scripts/verify-topology.ts` / `npx tsx scripts/verify-layout.ts` 不回归（house.yaml 非几何文件，预期无影响，按铁律仍跑）
- 预算回归：迁移前后 `get_budget` 输出 diff 为空（counts derive 等价性）
- MCP 手测：`get_room_layout({ roomId: "master_bedroom" })` 返回 `furnishings.placed` 带坐标；`get_furniture_inventory` placed 条目带 `x/z/rotation`
- 视觉：浏览器截图确认家具按摆位渲染、不再叠在房间中心（floor-plan-compare skill）
