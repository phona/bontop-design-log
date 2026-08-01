# 设计巡场高优先修复计划

> 日期：2026-08-01
> 来源：设计决策主动巡场（陪跑第一站）
> 状态：待批准执行

## 背景

巡场交叉核对 electrical / ceiling / house(furnishings) / model-geometry / overlay 后发现 2 个高优先问题（原报告的"墙 id 错误"经坐标级核查为误判，已撤回——电气墙 id 与坐标 0 错配）。

## 项 1：补主卧 + 西北次卧空调内机电源

**问题**：ceiling.yaml 规划 5 台空调内机（客餐厅/主卧/书房/父母房/西北次卧），但 electrical.yaml 只有客厅/书房/父母房的 `sock_*_ac`，**主卧和西北次卧缺空调电源**。中央空调（一拖五多联机）每个房间都有吊顶内风管机，每台内机需 220V 供电。

**改动** `config/electrical.yaml`：

1. 在主卧段（sock_master_bay 后）新增：
```yaml
- id: sock_master_ac
  room: master_bedroom
  wall: w_mb_east
  type: socket
  x: 4.20
  z: 7.0
  height: 2.5
  count: 1
  note: "主卧空调内机电源（吊顶内；风管机布线，距内机>1m 属正常）"
```

2. 在儿童房段（switch_child 后）新增：
```yaml
- id: sock_child_ac
  room: bedroom_nw
  wall: w_nw_south
  type: socket
  x: 4.0
  z: 4.30
  height: 2.5
  count: 1
  note: "儿童房空调内机电源（吊顶内）"
```

**已知**：风管机电源走吊顶，距内机 >1.0m 会触发 `ac_socket_to_unit` proximity warn（规则对吊顶隐藏内机偏严），接受不阻塞。主卧唯一实体墙是东墙 w_mb_east（西/南为玻璃幕 suppress）。

## 项 2：西北次卧衣柜 2.4m→1.8m（解 clearance）

**问题**：西北次卧（儿童房 8.39㎡，x[2.60,5.60] z[1.10,4.30]）塞 bed_180（东墙）+ wardrobe_240（西墙），verify 报 3 处 clearance 警告（bed_180 北侧 0.30m、wardrobe 南北侧 0.40m，均 <0.50m）。

**选定方案 A**：衣柜降 1.8m，腾 0.6m 改善过道，保留 1.8m 床。

**改动**：

1. `config/house.yaml` furnishings bedroom_nw：
   - `- { type: wardrobe_240, x: 2.90, z: 2.70, rotation: 90 }` → `- { type: wardrobe_180, x: 2.90, z: 2.70, rotation: 90 }`
   - 注释更新为 1.8m 衣柜

2. `config/materials.yaml` 在 wardrobe_240_01 后新增 wardrobe_180_01（~3200 元，candidate，topic_id=miscellaneous，alternative_group=wardrobe，spec 1800×600×2700mm，appearance solid_color）

**已知预算限制**：count 模式按 topic 计价，wardrobe_180/240 同属 `wardrobe` topic，暂按默认价（4200）计；per-size 计价留后续。

## 项 3：记录决策

`docs/decision_log.md` 补记 DEC-2026-08-01-012：西北次卧衣柜降 1.8m 解 clearance + 补主卧/西北次卧空调插座（巡场修复）。

## 验证

```bash
npm run verify:all   # bedroom_nw 3 处 clearance 警告应消除/显著减少；若仍紧则微调衣柜 z 位
npm run test:server  # 262 应全绿
npm run typecheck    # root + app
```

## 风险

| 风险 | 缓解 |
|---|---|
| 衣柜换位后仍 clearance 不足 | 跑 verify 后按结果微调 z 位 |
| wardrobe_180 预算按默认价 | 标注已知限制，per-size 计价后续 |
| AC 插座 proximity warn | 接受（吊顶内机布线现实），不阻塞 |

## 执行顺序

项 1（electrical）→ 项 2（house + materials）→ 项 3（decision_log）→ 验证
