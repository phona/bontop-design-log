# 采购清单 + 验收体系缺口补全计划

> 日期：2026-08-02
> 来源：设计巡场第 2 站（数据完整性）
> 状态：待批准执行

## 背景

巡场发现两处数据覆盖缺口：
1. **procurement.yaml 只跟踪 20/47 材料**：28 条新增材料（全部家具/家电/卧室地面/备选砖）未纳入采购跟踪；`paint_01` 是孤儿（procurement 有但 materials 无，实际材料叫 `latex_paint_01` 且已在 procurement，故 paint_01 为冗余重复）
2. **acceptance.yaml 缺 3 个验收阶段**：对照预算科目，缺木工（吊顶/柜体）、门窗安装、水路打压（budget-pitfalls 有对应验收知识但 acceptance 未建阶段）

## 项 1：procurement.yaml 补全

### 1a. 移除孤儿 paint_01
procurement 的 `paint_01` 条目删除（latex_paint_01 已存在且正确）。

### 1b. 新增 27 条材料（28 缺 - curtain_wall_01）
`curtain_wall_01`（开发商已装玻璃幕墙，价 0，provided_by_developer）不需采购，排除。其余 27 条按 materials.yaml 属性（unit/loss_rate/category）补录，current_stage=selection：

- **家具 12**：bed_180_01、mattress_180_01、wardrobe_240_01、wardrobe_180_01、sofa_3seat_01、dining_table_01、dining_chair_01、tv_stand_01、desk_01、chair_01、bookshelf_01、shoe_cabinet_01、coffee_table_01
- **家电 6**：gas_stove_01、dishwasher_01、water_purifier_01、washer_01、dryer_01、shower_enclosure_01
- **备选饰面 5**：bedroom_tile_01、bedroom_wood_01、floor_tile_03、wall_tile_02、wall_tile_03
- **设备备选 2**：hvac_02（挂机组合备选）、sanitary_faucet_01、entry_door_01

每条 schema（遵循现有）：`{id, name, room, category, current_stage: selection, waste_rate, unit, notes}`。room：多数 null（全屋/多房间）；shower_enclosure 可标两卫。

## 项 2：acceptance.yaml 补 3 阶段

遵循现有 schema（phase/name/items[{id,item,method,standard,severity,knowledge?,rooms?}]），内容取自 budget-pitfalls 验收知识：

### 2a. carpentry 木工验收
- 吊顶龙骨间距 ≤400mm（critical）
- 柜门开关顺畅、缝隙 ≤2mm（major）
- 石膏板拼接留 V 缝、背板 ≥9mm（major）

### 2b. doors_windows_install 门窗安装验收
- 门开关无异响、门框灌浆密实（major）
- 密封胶均匀无断点（major）
- 下水通畅（冲水测试）（critical）

### 2c. plumbing_pressure 水路打压验收
- 水管打压 0.8MPa 保压 30min 无压降（critical）
- 排水坡度/地漏存水弯（critical）

## 验证

- YAML 语法校验（js-yaml 加载不报错）
- procurement id 与 materials 一致性脚本核对（孤儿=0、缺失大幅减少）
- `npm run test:server` + `npm run typecheck`（确认不破坏 lifecycle/acceptance engine 测试）
- `npm run verify:all`

## 风险

| 风险 | 缓解 |
|---|---|
| procurement 条目属性错配 | 从 materials.yaml 程序化取 unit/loss_rate |
| acceptance 新阶段与 engine 不兼容 | 遵循现有 schema；跑 acceptance-engine 测试 |
| 备选材料纳入采购语义模糊 | current_stage=selection 表示候选，采购时再推进 |

## 执行顺序

项 1（procurement 移孤儿 + 补 27 条）→ 项 2（acceptance 补 3 阶段）→ 验证
