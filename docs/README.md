# docs/ 文档索引

> 用途：`docs/` 根目录 21 个平铺文档 + 4 个子目录的角色、状态与权威指向。
> 建立日：2026-10-20。**只登记事实，不派生结论**；状态列写明是文档自述还是本索引推断。
> 与 `docs/decisions/README.md`（决策日志索引）、`docs/design-iterations/INDEX.yaml`（迭代记录索引）同级。

## 权威层级（冲突时按序）

完整表述见 `schedule/README.md` §2。压缩版：

| 级 | 内容 | 本目录内的对应 |
|---|---|---|
| 1 | 现场量房、书面审批、签字确认、有效检测记录 | — |
| 2 | 项目专业配置（几何/结构/机电/空调/吊顶/验收） | `config/*.yaml`（不在本目录） |
| 3 | 当前阶段 `control.yaml` | `schedule/phase-*/control.yaml` |
| 4 | 自动生成的 Markdown 视图 | `schedule/phase-1/*.md` |
| 5 | 历史说明、聊天记录、未签字报价 | 本目录大部分分析文档 |

**关键认知：`docs/` 下的文档基本不在权威链上。** 它们的存在意义是留档、可追溯与操作指引，不是事实源。看到数字冲突时，往第 2、3 层查，不要以本目录文档为准。

## 子目录

| 目录 | 内容 | 性质 |
|---|---|---|
| `decisions/` | 18 个主题文件 + README，264 条 DEC | 决策日志。**正文只登记不改写**，索引与纪律见其 README |
| `design-iterations/` | 45 个现役目录 + `archive/` 20 个 + `INDEX.yaml` | 迭代证据。机读索引见 `INDEX.yaml` |
| `renders/` | 2 个 md | 渲染架构留档（Blender 已暂停，冷归档见 `scripts/archive/blender-pipeline/`） |
| `standards/` | 1 个 md | 起夜路径照明标准 |

---

## 根目录 21 个文档

### A. `AGENTS.md` 点名、相关会话必读（4 个）

| 文档 | 角色 | 状态 | 引用 |
|---|---|---|---|
| `pending-site-data.md` | 55 条待决台账（量房/厂家/业主三类，逐条写卡在谁） | 现役，高频更新（末改 10-19） | 62 |
| `mep-construction-guidance.md` | 机电施工指导：墙体结构分类、穿墙口径、分层标高 | 现役（末改 10-19） | 24 |
| `hvac-pitfall-audit-20261011.md` | 空调安装前核对稿 v4.4；AGENTS.md 铁律 5 的反例物证 | 现役复核稿；量房+厂家资料回来后才能转施工图 | 2 |
| `visual-change-playbook.md` | 视觉反馈类迭代的标准流程 | 现役 | 4 |

### B. 现役业务文档（常驻名，12 个）

| 文档 | 角色 | 状态 | 引用 |
|---|---|---|---|
| `spatial-validation.md` | 空间校验规则 | 现役（末改 10-09） | 30 |
| `dressing-map.md` | 软装/穿搭映射 | 现役（末改 10-17） | 13 |
| `material_selection_log.md` | 选材日志；自述「当前核对日期 2026-10-07」 | 现役日志 | 10 |
| `penetration-lint.md` | 防穿模 linter 规则 | 现役 | 8 |
| `hvac_options_analysis.md` | 701 空调架构级比选（A1–F2 十一方案矩阵） | 现役；§八是渲染审视态契约与邻户梁参考出处，**搬不走删不得** | 6 |
| `designer_brief.md` | 对设计师简报 | 现役，但是**对外交付件**——预算口径更新需业主裁决（是否已外发、改哪一版），未裁决前不改数据 | 5 |
| `curtain-design.md` | 窗帘设计 | 现役（末改 09-02，近一月未动） | 4 |
| `style-guide.md` | 风格指南 | 现役（末改 10-17） | 3 |
| `twinmotion-acceptance.md` | Twinmotion 验收 | 现役（末改 10-09） | 3 |
| `hvac-vendor-confirmation-sheet.md` | 厂家上门一页纸：A 已定事实 / B 待答问题 / C 不接受答案 / D 必带纸面 | 现役操作工具。`config/facts.yaml` 已登记为豁免（「汇总视图，不得成为第二份数字真相」） | 1 |
| `acceptance_checklist.md` | 验收清单 | **自述已退场**：「本文件不再单独维护验收条目，以避免施工、预算和验收状态出现多套口径」——口径已收敛至 `config/acceptance.yaml` | 1 |
| `render-tech-debt.md` | 渲染技术债清单 | **自述已冻结**：「PAUSED / HISTORICAL — 2026-09-01，随 Blender 主线暂停而冻结，不再作为 active backlog」 | 1 |

### C. 带日期的分析快照（5 个）——日期是快照标记，不是临时标记

这批文件看起来像临时产物，实际每个都有明确的状态行与保留理由。共性是「只登记不改写」纪律的产物：同一主题在新时点需要新分析时新建带日期文件，而非覆盖旧文件。

| 文档 | 自述状态 | 为什么保留 | 引用 |
|---|---|---|---|
| `hvac-ld-condensate-receiver-predesign-20261019.md` | **预研稿，未裁定**；不改 config、不替代 DEC，业主拍板后另开 DEC | 客餐厅冷凝水受纳系统预研；§10 是业主已裁定的红→绿门禁（量房日+#39 回来后 verify 必须全绿） | **0** |
| `hvac-pitfall-audit-20261011.md` | 方案复核稿 v4.4 | 见 A 区 | 2 |
| `hvac-rfq-brief-20261003.md` | 已完成询价并成交，本文是**询价要求与合同核对基准** | 合同核对需要「当时提出了什么」；§七 5 条谈判红线含 10-04 触发留档 | 4 |
| `ceiling-scheme-20261008.md` | 现行优先方案**归档**，DEC-2026-10-08-C08 | 吊顶材料与施工方案快照；10-15 已加几何修订提示，旧数量明确标注不代表当前几何 | 4 |
| `hvac-deepening-20260907.md` | 设计推演过程**留档**，21.4kW/7HP 等口径已全部作废 | 负荷推演与品牌短名单 A–E 的唯一来源依据 | 8 |

### D. 零入链（2 个）——本次登记入口

| 文档 | 判定 | 说明 |
|---|---|---|
| `hvac-ld-condensate-receiver-predesign-20261019.md` | **活的、等拍板** | 全仓无任何 md/yaml/ts 引用它。它是 5 个带日期文档里唯一「未裁定」的，业主已就其 §10 门禁做过裁定，但量房日要按它执行时无处可查——**这是本次最该补的断链** |
| `ceiling-style-extension-guide.md` | **活的开发指南** | 不是过期分析报告。内容是「为 `config/ceiling.yaml` 新增吊顶造型种类的标准步骤」，列明要改 `server/config-loader.ts`、`ProblemDetector.ts`、`AnnotationRenderer.ts` 等 4 处。这是**可复用的操作指引**，零入链意味着下次要加造型时没人知道它存在 |

---

## 维护纪律

1. 新增根目录文档时，在本文件对应分区追加一行，四个字段填全（角色/状态/引用/为何保留）。
2. 「引用」列为 `grep -rl` 排除 `node_modules`/`tmp`/`.venv`/`docs/design-iterations` 后的命中文件数，会随引用增减漂移，不设自动校验。
3. **状态列必须区分「自述」与「推断」**：文档自己写了状态行的照抄；没有状态行的，本索引用末改日期+引用数推断，并标注为推断。
4. 文档退场时**不要删文件**：在状态列写明退场理由与口径收敛去向（参照 `acceptance_checklist.md` 与 `render-tech-debt.md` 的做法）。
5. 本索引不是第二份真相。文档内容的权威仍在各文件自身；本文件只回答「该读哪个、哪个还活着」。
