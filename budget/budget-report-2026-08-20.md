# 全屋预算汇总报告（当前方案）

## 一、引擎输出：按预算科目（design-rules budget 映射 + base.json 四池口径）

数据来自 `BudgetCalculator.calculate(data/current-scheme.json)`，未改任何项目文件。

| 科目 | 预算 | 材料（auto) | 人工（公式） | 合计 actual | 状态 |
|---|---:|---:|---:|---:|---|
| 拆改 demolition | 5,000 | 0 | 0 | 0 | ok（未建模） |
| 水电 water_electric | 12,000 | 1,218 | 5,000（一口价） | 6,218 | ok |
| 防水 waterproof | 4,500 | 0 | 648(20/㎡×湿区32.4㎡) | 648 | ok |
| 泥瓦 masonry | 18,500 | 5,776（仅墙砖） | 6,707(45/㎡×149㎡) | 12,483 | ok |
| 木工吊顶 carpentry | 5,000 | 0 | 5,962(40/㎡×149㎡) | 5,962 | **over +962** |
| 油漆 painting | 11,500 | 1,689 | 7,943(25/㎡×317.7㎡) | 9,632 | ok |
| 门窗 doors_windows | 12,000 | **0（漏算）** | 0 | 0 | 见不确定项 ② |
| 卫浴 sanitary | 12,000 | **0（漏算）** | 1,600(200/件×8) | 1,600 | 见不确定项 ③ |
| 橱柜 kitchen_cabinet | 11,000 | 2,396（柜体1,613+台面783) | 0 | 2,396 | 量偏小，见 ④ |
| 油烟机 range_hood | 2,500 | 1,200 | 0 | 1,200 | ok |
| 暖通 hvac | 29,000 | 29,000(A2 一拖五） | 0 | 29,000 | near（顶格） |
| 灯具 lighting | 2,800 | 2,500 | 0 | 2,500 | ok |
| 窗帘 curtains | 10,000 | 3,930 | 0 | 3,930 | ok |
| 智能家居 smart_home | 2,000 | 2,000 | 0 | 2,000 | near（顶格） |
| 五金杂项 miscellaneous | 5,700 | 1,800 | 0 | 1,800 | ok |
| 家具软装 furniture_soft | 36,500 | 40,200 | 0 | 40,200 | **over +3,700** |
| 家电 appliances | 14,000 | 11,300 | 0 | 11,300 | ok |
| 物业杂费 property_fees | 3,000 | 0 | 0 | 0 | 未建模 |
| 预备费 contingency | 11,000 | — | — | 0 | reserved |
| **合计** | **208,000** | | | **130,870** | |

## 二、大类小计与 ceiling 余量

| 大类 | 金额 |
|---|---:|
| 主材（硬装材料，不含暖通） | 22,509 |
| 设备（暖通 A2） | 29,000 |
| 家具软装 | 40,200 |
| 家电 | 11,300 |
| 人工（静态费率：水电/防水/泥瓦/吊顶/油漆/洁具安装） | 27,860 |
| **引擎总计** | **130,870** |

- **vs 190,000 ceiling：余量 +59,130（引擎口径）**。但这个余量虚高——地面材料、门、卫浴洁具被漏算（见下）。
- 口径：**半包模式**。actual = 选材材料费 + 静态人工费率；**不含辅料、管理费、运输/上楼、设计费**（与 material_selection_log "不含人工辅料管理费" 口径一致，但引擎多算了人工公式部分）。拆改/物业/预备费无自动值，仅靠 budget 预留。

## 三、近期变更影响

- **DEC-026 家具改价已生效**（materials.yaml 当前价即新价）：沙发 3,200→4,200(+1,000)、餐桌 1,800→1,500(−300)、餐椅 300→350×4 把（+200)、茶几 600→500(−100)，**净 +800**，家具池 39,400→40,200，是 furniture_soft 超预算 3,700 的主因之一（另一主因是书桌椅 ×3 套 DEC-018）。
- **DEC-024 人字拼定案**：当前方案 floor/bedroom_floor 选的是 `floor_pbr_herringbone`（price=0 的渲染贴图占位），**地面材料在引擎里为 0**。对照场景（floor_tile_01+bedroom_tile_01 真实砖价）算出地面材料 **15,106**（客餐厅等 9,299 + 四卧室 5,809）；人字拼真砖落地需在直铺砖价上**再 +6~10k**（含工费上浮 20–50%、损耗 1.15、美缝翻倍，门店未报价）。
- **灯光升级待决策**：+3~4k 未计入（当前 lighting_01 套餐 2,500）。

## 四、不确定项（按影响排序）

1. **衣柜红旗（±17k）**：wardrobe_240_01 按 4,200/组计价，但自选材笔记按投影价应为约 11,016/组；三组衣柜潜在偏差 ±17k，是全表最大不确定项，落定前 furniture_soft 视为悬空。
2. **门窗 actual=0**：house.yaml furnishings 无 interior_door/bathroom_door 类型条目，count 模式算出门 0 扇；现实约 4×1,100+2×1,000 = **+6,400**（+安装人工 900）。
3. **卫浴材料=0**：scheme 的选材 topic 是 `sanitary`，而 design-rules lineItems 是 toilet/shower/vanity/faucet 四个 topic 且无对应 selection → 全部跳过；现实约 **+6,100**。
4. **橱柜量公式偏小**：`linearKitchen = depth×0.8 = 1.92m`，而 DEC-014 地柜 5.0m → 少约 **+3,850**。
5. **开关插座只计 18 元**：fixed 模式直接取单价（元/位），未乘约 50 位 → 少约 **+900**。
6. carpentry 人工超预算 962：吊顶人工按全部房间（含电梯井，共 149㎡）×40/㎡ 计，实际厨卫+局部吊顶面积更小，属公式粗放而非真超支。
7. 全部材料 status=candidate（到店未确认）；geometry/MEP 为推断值，量房与施工图后需重核（DEC-011）。

## 五、补正后的现实估算

引擎 130,870 + 地面 15,106 + 门 7,300 + 卫浴 6,100 + 橱柜量 3,850 + 插座 900 ≈ **164,100**；再叠 DEC-024 人字拼溢价 +6~10k、灯光升级 +3~4k → **约 173k–178k**。对 190k ceiling 余量约 **12–17k**，但衣柜红旗（±17k）可能将其吃光——**建议把衣柜核价列为到店第一优先级**。

## 六、计算路径

- 引擎：`server/budget-calculator.ts`（area/count/fixed 三种 calcMode + 静态人工公式），科目映射 `config/design-rules.yaml` budget 段，科目池/ceiling `config/budget/base.json`（v0.5 四池，total_budget 208,000 / ceiling 190,000）。
- 临时脚本（已删）：`/tmp/budget-report.mts`、`/tmp/budget-compare.mts`，以 `node_modules/.bin/tsx` 在项目根目录运行，调用 `ProjectCatalog.load('.')` + `RuleEngine.load('config/design-rules.yaml')` + `BudgetCalculator.calculate(current-scheme)`；对照场景仅改 scheme 的 floor/bedroom_floor 选项重算。未修改任何项目文件。
- 与 `material_selection_log.md` 的 74,075 元（2026-07 手工主材+设备口径，含暖通、不含人工）可对账：引擎同口径 auto 值 51,509 + 漏算补正（地面 15.1k、门 6.4k、卫浴 6.1k、橱柜/插座差）≈ 74–75k，两者吻合。