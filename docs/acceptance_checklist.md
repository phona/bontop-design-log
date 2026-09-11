# 验收清单入口

本文件不再单独维护验收条目，以避免施工、预算和验收状态出现多套口径。

- 验收标准唯一来源：`config/acceptance.yaml`
- 一期执行台账唯一来源：`schedule/phase-1/control.yaml`
- 人与AI共同逐项审计：`schedule/phase-1/checklist.md`
- 施工顺序与阻塞项：`schedule/phase-1/schedule.md`
- 预算计划、合同、付款及预测：`schedule/phase-1/budget.md`

更新执行状态、金额或验收记录时，只修改 `schedule/phase-1/control.yaml`，然后运行：

```bash
npm run schedule:render
npm run verify:schedule
```

自动生成的 Markdown 文件不得直接编辑。现场手写或签字结果应转录为 `audit_log.records`，并保留原始照片、视频、检测记录或签字单路径。
