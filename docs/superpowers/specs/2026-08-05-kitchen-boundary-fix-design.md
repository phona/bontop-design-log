# 厨房南界修正设计（DEC-014）

日期：2026-08-05
状态：已审定（用户确认变更清单后落盘）
触发：创想图（survey/photos/9a8d1ce3eb3740a7ceb061b43244783d.jpg）核对发现厨房面积三方不一致

## 背景与问题

| 来源 | 厨房面积 | 说明 |
|---|---|---|
| model-geometry.yaml | 15.48㎡（3.6×4.3） | 2026-07-17 大修（e874a6b）把 z∈[2.9,4.3] 餐厅带并入 kitchen |
| house.yaml 房间档案 | 6.09㎡（2.3×2.65） | 开发商标注口径（净面积，过时残留） |
| 开发商创想图 | ≈10.4㎡（3.6×2.9） | 操作区到入户花园南墙 z=2.9 齐平；z∈[2.9,4.3] 为餐厅带 |

附带问题：
1. 冰箱插座在西墙 (7.20, 3.9) 与 DEC 文字"东墙（灶台+烟机+冰箱）"/创想图（东墙南端高柜位）矛盾，且厨房南界修正后越界
2. 走廊 x∈[10.8,13.4] × z∈[2.9,4.3]（3.64㎡）不属于任何房间
3. 三联动推拉门位置（z=4.3）与真实厨房边界不符
4. `sock_kitchen_gas` (10.80, 3.0) 越界

3D 中不可见的原因：z=2.9/z=4.3 均无实体墙，错误仅在 roomId 归属/面积/电气校验等语义层。

## 变更清单

### 1. config/layout/model-geometry.yaml

新增顶点：
- `v_kit_s2 {x: 7.20, z: 2.90}`
- `v_ent_kit2 {x: 10.80, z: 2.90}`

房间边界：
- `kitchen` → `[v_kit_w, v_vrv_se, v_balc_ne, v_kit_s2, v_ent_kit2, v_ent_nw]`（10.44㎡）
- `living_dining` → `[v_kit_s2, v_foyer_se, v_be_se_s, v_step_t]`（42.78㎡，吞并餐厅带+走廊）

墙体：
- `w_kit_west` 缩短：v_balc_ne → v_kit_s2（z 2.9-4.3 段删除；该分隔由 w_gbath_east@x=7.1 覆盖）
- `w_kit_east` 缩短：v_ent_nw → v_ent_kit2（z 2.9-4.3 段删除，两侧均客餐厅，开放贯通）
- 不新增 z=2.9 实体墙；三联动推拉门只记决策+预算，不进几何
- v_kit_s / v_ent_kit 顶点保留作餐厅带南界标记

### 2. config/layout/overlay.yaml

零改动（suppress/elements 不引用 w_kit_west/w_kit_east；w_kit_north 不受影响）。

### 3. config/electrical.yaml

| 点位 | 现状 | 改为 | 理由 |
|---|---|---|---|
| sock_kitchen_fridge | (7.20, 3.9) w_kit_west | (10.80, 2.55) w_kit_east h=0.3 | 越界+创想图冰箱位；消除 DEC 矛盾 |
| sock_kitchen_counter | (10.80, 2.7) | (10.80, 2.0) | 避开冰箱占位 z∈[2.2,2.9] |
| sock_kitchen_gas | (10.80, 3.0) | (10.80, 1.9) | 越界；报警器应近灶台 |

其余不动（烟机 1.7/开关 1.0/净水器 9.5,0.3/餐桌吊灯/地插）。

### 4. config/house.yaml

- kitchen furnishings 加 `{ type: fridge }`（count-only，东墙南端高柜位 0.7×0.7）
- `cabinet_base` / `countertop_quartz` count 3.5 → 5.0（北墙 3.6m + 东墙 2.2m L 型）
- 房间档案：kitchen → 3.60×2.90 / 10.44㎡（注释保留"开发商 6.09㎡ 标注口径，净面积待量房"）；living_dining → 6.20×6.90 / 42.78㎡
- furniture_concept：冰箱位改述为东墙南端
- 餐桌椅不动（开发商同款位；修正后厨房动线在 z≈3.5 拐入厨房，不经餐桌）

### 5. 文档

- decision_log.md 新增 DEC-014（本变更；声明取代 2026-08-02 条目冰箱矛盾描述；三联动推拉门 z=4.3→z=2.9）
- pending-site-data.md 加量房项：厨房实际南界/冰箱位/厨房净面积

### 6. 预算影响（仅记录，待用户拍板后另改）

- 地柜+台面 3.5m→5.0m：kitchen_cabinet 预计 +2000~3000
- 家电池加冰箱 ~3000-5000

## 验证

- `npm run verify:all`
- `npm run test:server`（同步更新 tests/server/model-geometry-layout.test.ts 厨房断言）
- `npm run typecheck`
- `npm run test:app`（w_kit_east/west 缩短影响碰撞提取）

## 不做的事（YAGNI）

- 不在几何中建模三联动推拉门
- 不重排餐桌位置
- 不处理前序盘点发现的插座/模型缺失问题（父母房床头插座、wardrobe_180 无 3D 模型等，另立任务）
