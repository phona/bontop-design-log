# 决策日志 · 门禁编排与工程状态

> 本文件收录门禁编排器（`verify:all` 全跑化）、verifier 结构化输出、以及构件级工程状态派生相关决策。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-G01` 门禁编排器取代 `&&` 链：全跑 + 汇总退出码 + `--json` 信封，消灭单点红灯短路

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-09-G01 门禁编排器取代 `&&` 链：全跑 + 汇总退出码 + `--json` 信封，消灭单点红灯短路

- **日期**：2026-10-09。触发：`verify:all` 长期只在第 8 步（`verify-data-consistency`）报一处红灯就中止，后面 7 个 verifier 根本不执行——而那一处（`sock_child_ac`）卡在空调厂家深化图，属外部输入，短期内不会消失。等于**一个等外商的待决项让门禁对其余七类问题失明**。
- **问题（门禁契约缺陷，不是数据问题）**：`package.json` 的 `verify:all` 是 15 段 `&&` 链，任何一段非零即中止。实测被挡住的 7 个（`verify:mep` / `verify:electrical` / `verify:project-render-facts` / `verify:lighting-config` / `verify:facts` / `verify:mep-takeoff` / `verify:schedule`）单独跑全部通过——**门禁不是坏了，是看不见了**。同时 15 个 verifier 里只有 6 个支持 `--json`，agent 无法一次拿到结构化结论（`run_design_check` MCP 工具只跑 rule-engine，与 14 个 verifier 无关）。
- **可选方案**：
  - ① 保持短路（否决：失明持续，且随待决项增多而恶化）；
  - ② 纯 shell 循环聚合退出码（否决：15 条异质命令拼 shell 太脆，且拿不到结构化输出）；
  - ③ **编排脚本 `scripts/verify/verify-all.ts`**：依次跑完 15 个、不短路、汇总退出码，`--json` 输出信封（选定）。
- **选定方案**：
  - **全跑 + 汇总**：`totals.failed > 0` 才 `exit 1`，**退出码语义不变**（0 ⇔ 全部通过），因此 `docs/decisions` 与 `docs/design-iterations/*/review-manifest.json` 里大量「`verify:all` exit 0 / N 步全过」的历史证据**仍然有效**，不会被本次变更打破。改变的只是失败时的呈现（一次列全部 vs 只列第一个）。
  - **`--json` 信封**：`{version, mode, totals:{verifiers,passed,failed,errors,warnings}, verifiers:[{name,script,exit,structured,report?,output,stderr}]}`。`--json` 是 agent 的主要出口。
  - **自适应探测而非硬编码支持清单**：先试 `--json`，解析成功即 `structured:true` 并带上 `report`；失败则同一份输出当文本用并标 `structured:false`——**不假装所有 verifier 都已结构化**。这样后续逐个补 `--json` 时无需改编排器，支持清单不会腐烂。
  - **兼容开关**：`--fail-fast` 复现旧的短路行为；`--only <name>` 单跑一个（agent 常用）。
  - **零改动既有 verifier**：本commit 不动任何 verifier 的输出格式，回归面为零。
- **决策依据**：7 个被挡住的 verifier 已单独验证可通过（切换前对全 15 个再核一次无产物依赖）；「门禁失明」比「门禁红」更危险——红会促人行动，失明让人以为没问题。
- **预算影响**：无。
- **关联文件**：`scripts/verify/verify-all.ts`（新增）、`package.json`（`verify:all` 改为调编排器）、`scripts/README.md`（正式入口表 + 编排说明）、`config/facts.yaml`（decision_files 增列本文件）、`docs/decisions/README.md`（索引行 + 计数 + 查重范围）。
- **决策人**：业主（确认不需要 MCP，agent 直接读配置 / 跑 CLI / curl 既有 API 即可）+ AI 执行。
- **验证**：`npm run verify:all` 实跑 **15/15 全部执行**（改前仅 8 个），`13/15 passed`。两处失败的归属均已证实：`verify-consistency` 的 `sock_child_ac`（先于本次改动存在，stash/HEAD 对照证实）；`verify-collision` 的 8 个 `unknown element type "paint_ceiling_region"/"paint_sill_region"` 来自**另一会话未提交的 paint-sill 改动**（`git show HEAD:config/layout/overlay.yaml` 中该类型出现 0 次，改动为 +42 行未提交）——均非本次引入。`typecheck` 干净（含并行改动在场）；`--only verify-spatial --json` 冒烟通过。
- **后续议题**：① 给剩余 9 个文本 verifier 补 `--json`（逐个 commit，每个带自己的测试）；② 构件级工程状态派生（`shared/element-state.ts` + `npm run state:project`）与 3D 状态/差异叠加层，见业主批准的四项工作计划。
