# 价值透明能力 + 采购/验收缺口补全（合并计划）

> 日期：2026-08-02
> 来源：巡场第 2 站 + 用户反馈"只告诉超支，没说超支换来什么"
> 状态：待批准执行（合并 procurement-acceptance-gaps 计划）

## 背景

两个诉求合并执行：
1. **价值透明**（用户指出的结构性缺陷）：预算只算"花多少"，不答"花得值不值"。`over` 只是红旗，没有"买到了什么 + 降级失去什么"。advisor 也只给 savings 不给代价。合理决策需要每一块钱的价值可追溯
2. **数据完整性缺口**：procurement 只跟踪 20/47 材料（28 缺 + paint_01 孤儿）；acceptance 缺木工/门窗/水路 3 阶段

数据基础已具备：`BudgetLineItem` 带 `{topic, roomId, optionId, quantity, unitPrice, cost}`，catalog 有 `getOption/getRoom/getOptions`，可聚合成价值叙事。

---

## Part A：价值透明（核心）

### A1. 新建 `server/budget-value-analyzer.ts`
`class BudgetValueAnalyzer(catalog, calc)`，方法 `analyzeCategory(scheme, categoryKey): CategoryValue`：
- 从 snapshot.lineItems 按 `topicCategories` 映射过滤出该 category 的 lineItems
- 聚合 `breakdown[]`：`{roomId, roomName, topic, optionId, materialName, quantity, unit, unitPrice, cost}`（roomName 经 catalog.getRoom，materialName/unit 经 catalog.getOption）
- 按 cost 降序，给 `topValue`（占大头的 1-3 项：哪个房间哪个材料多少钱）
- `alternatives[]`：对该 category 的每个 topic，列更便宜选项 `{topic, toOptionId, toName, savings, loses}`
  - `loses` 从目标选项的 `cons` + 与当前选项的差异推导（如"马可波罗木纹砖→东鹏亮光砖：颜值降、反光刺眼"）
- 返回 `{category, actual, budget, overBy, breakdown, topValue, alternatives}`
- 方法 `analyzeOverBudget(scheme)`：对所有 over/near category 调 analyzeCategory

### A2. 增强 `server/budget-advisor.ts`
`BudgetSuggestion` 增 `loses: string` 字段：
- suggest() 中每个候选建议，从目标选项 cons + 影响房间（lineItems 的 roomId）生成 loses 描述
- 输出从"省 X"升级为"省 X，但失去 Y（影响 N 个房间）"

### A3. MCP 工具 `explain_budget_value`
`server/mcp-server.ts` 注册：
- 入参 `{category?: string}`
- category 给定时返回该 category 的 CategoryValue；否则返回所有 over/near category 的价值分析
- 装配：index.ts 创建 BudgetValueAnalyzer + apiDeps 加 getter

### A4. 类型
`shared/types.ts` 增 `CategoryValue`、`ValueBreakdownItem`、`ValueAlternative` 接口；`BudgetSuggestion` 加 loses

---

## Part B：procurement.yaml 补全

- **B1** 移除孤儿 `paint_01`（latex_paint_01 已正确存在）
- **B2** 新增 27 条（28 缺 − curtain_wall_01 开发商已装）：家具 13 + 家电 6 + 备选饰面 5 + 设备备选 3，从 materials.yaml 程序化取 unit/loss_rate/category，current_stage=selection

## Part C：acceptance.yaml 补 3 阶段

遵循现有 schema，内容取自 budget-pitfalls 验收知识：
- **carpentry 木工**：吊顶龙骨 ≤400mm（critical）、柜门缝隙 ≤2mm（major）、石膏板 V 缝/背板 ≥9mm（major）
- **doors_windows_install 门窗**：门开关无异响/灌浆密实（major）、密封胶均匀（major）、下水通畅（critical）
- **plumbing_pressure 水路打压**：0.8MPa 保压 30min 无压降（critical）、排水坡度/存水弯（critical）

---

## 验证

- 新增测试：budget-value-analyzer（masonry 分析含 breakdown + alternatives + loses）、advisor loses 字段
- procurement↔materials 一致性核对（孤儿=0）；acceptance YAML 语法 + acceptance-engine 测试
- `npm run test:server` + `npm run typecheck` + `npm run verify:all`

## 风险

| 风险 | 缓解 |
|---|---|
| loses 描述质量依赖材料 cons 字段 | cons 缺失时用通用描述（"档次/颜值降低"）+ 影响房间数 |
| value analyzer 性能（多次 calculate）| analyzeCategory 复用单次 snapshot；alternatives 按需 calculate |
| procurement/acceptance 条目错配 | 程序化取属性 + 遵循现有 schema + engine 测试护航 |

## 执行顺序

B（procurement）→ C（acceptance）→ A1（value analyzer）→ A2（advisor loses）→ A3/A4（MCP + types）→ 验证
（B/C 是独立数据补全先做；A 是核心能力，A1 是 A2/A3 的依赖）
