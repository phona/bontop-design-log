# 决策日志 · 防穿模 linter（penetration）

> 本文件收录防穿模 linter 子系统：实体互撞/净距规则从 `verify:spatial` 拆出为独立 linter、规则登记表、豁免机制、OBB 窄相位与后续活动包络议题。
> 反查单个编号：`grep -rn "DEC-xxxx" docs/decisions/`。新增条目追加到本文件末尾。

## 本文件目录

- `DEC-2026-10-09-P01` 防穿模 linter 独立：实体互撞从 verify:spatial 拆出，规则登记表 + 带保质期豁免 + OBB shadow 并联

> 目录与下方条目标题同源；改标题时同步这一行。

---

### DEC-2026-10-09-P01 防穿模 linter 独立：实体互撞从 verify:spatial 拆出，规则登记表 + 带保质期豁免 + OBB shadow 并联

- **日期**：2026-10-09。触发：业主要求「设计一个防穿模 linter」，并就范围/精度/集成/组织四问了定向：**静态放置为主（整理现有规则 + 补洞）、窄相位上 OBB/SAT、CLI 接入 verify:all、新建独立目录与配置**。
- **问题（关注点混装，不是规则不够）**：`verify:spatial` 产出约 70 个 issue code，其中真正属于「两块实体占同一块空间」的只有 6–8 个；其余是声明完整性、墙线拓扑、运行时权威性、灯具宿主。混装带来三个具体后果：① 报告里分不清哪些要改图纸、哪些要挪家具；② 「合法接触」的豁免只能塞进 `relationships`，于是被迫同时承担**结构真相**（T 接头，声明一次不变）和**工艺妥协**（冰箱贴柜体收口，会随采购变更失效）两种生命周期；③ 互撞规则要长活动包络（门扇开启、抽屉、电器门）时，没有独立的声明位置与严重级口径。
- **可选方案**：
  - ① 不拆，继续在 `verify:spatial` 里加规则（否决：727 行 CLI + 1156 行共享库已到混装临界点，且豁免/严重级/消费方式都不同）。
  - ② 拆成独立 CLI 但规则实现各写一份（否决：两套容差必然漂移，parity 无法保证）。
  - ③ **拆成独立 linter，规则实现与场景采集下沉为共享层，两个 CLI 走同一入口**（选定）。
- **选定方案**：
  - **共享层下沉**：`shared/penetration/scene.ts`（`loadSceneInputs` / `buildRuntimeScene` / `collectPenetrationObjects`）是场景采集的唯一实现，两个 CLI 都经过它——parity 由构造成立，不靠两边各自算一遍。几何一律来自 `buildScene()` 的 runtime mesh，不推导、不复制坐标。
  - **函数分解**：`validateRuntimeScene` 拆成 `validateRuntimeAuthority`（声明↔runtime 权威性，留驻 spatial）与 `validateRuntimePenetration`（pair 互撞，搬至 `shared/penetration/rules.ts`），删除组合函数，避免第三条代码路径。净距规则落 `shared/penetration/clearance.ts`，洞口规则落 `shared/penetration/openings.ts`。
  - **规则登记表** `config/anti-penetration.yaml`：规则 id/codes/kinds/severity/enabled 全部申报；**severity 是下限**——规则按几何量自判更严则保持（配置盖不住 error），更松则被抬到下限，即配置只许加严、不许放宽；`enabled: false` 降为 info 并标注，不静默消失。登记表与实现互为镜像：申报了没实现、实现了没申报、重复 id、非法 severity、未知 code 全部 fail-closed。
  - **豁免带保质期**：`waivers[]` 必须写 `reason`/`owner`/`expires`，按「规则 + 实体对」匹配（顺序无关），必须绑定稳定 runtime id，禁止按家具类型全局放行；到期自动复活为 error 并带上豁免编号。
  - **补洞（按量化结论，不凭猜测加规则）**：
    - **兄弟 mesh**：实测 60 个 placed 家具 → 60 条采集记录、**零重复**，即不存在复合家具子 mesh 互撞的假阳来源。因此**不加**「同实体豁免」这类推测性规则，改为 `sibling_policy` 显式声明 + 不变式测试兜底（将来若有 fixture 开始产出多条记录，测试先红再决定豁免还是修几何）。
    - **洞口堵门** `pen.furniture.opening_blocked`：新增规则，按通行净高 2.0m 过滤（吊顶上的冷凝管/灯具不算堵门）。当前 house 零命中。
    - **机电协调构件**：实测 `mb_vanity_pvc_service_chase` 包络是 0.94×2.59×2.15m 的**预留区**（穿越 4 段墙、与 6 件家具重叠），不是实体管。口径未裁定，因此把「整体排除互撞」改为**逐类型显式申报** `excluded`/`solid`，未申报 → `pen.mep_participation_undeclared` fail-closed；10 处重叠登记为 `docs/pending-site-data.md` #55 显形债务，**不为了绿灯改坐标**。
    - **测试补洞**：补上此前零覆盖的 4 个 code（`furniture_glass_collision`、`furniture_ceiling_collision`、`furniture_clearance_insufficient`、`furniture_endpoint_clearance_insufficient`）。
  - **OBB/SAT 以 shadow 并联**：`shared/penetration/obb.ts` 由 `matrixWorld` + `geometry.boundingBox` 推导 OBB，15 轴 SAT 求深度与 MTV；`--shadow` 输出「规则判定 vs OBB 判定」与 `relationships` 白名单审计，**不计入 errors/warnings、不影响退出码**。OBB 恒包含于 AABB，只能消假阳、不可能放过真阳。适用范围按实测收窄到家具↔家具：家具↔墙的 OBB 深度实测一律是半墙厚 0.06m，因为渲染 datum 是**墙中心线**、家具包络按中心线 authoring（representation contact），OBB 直接比墙 slab 等于换口径重判；家具↔玻璃走 concrete overlay path 判定而非 AABB。
- **决策依据**：
  - 依赖面是孤岛：`shared/spatial-validation.ts` 只被 `verify-spatial.ts` 与其测试引用，`app/`、`server/`、MCP、其他 12 个 verifier 零依赖；`verify:spatial` 输出只被 `package.json`、2 个测试、docs 散文与 `config/facts.yaml` reader 声明消费，无 CI/gate/server 依赖——拆解的爆炸半径可控。
  - 现状是红的且先于本次改动：HEAD（`df61fc5`）`verify:spatial` 报 `scene_build_failed`——4 盏靠 `wall`/`wall_side` 声明的起夜灯在 `FixtureFactory` 抛错，根因是 `renderLightingFixtures()` 漏传 `wallId`/`wallSide`（权威投影 `shared/project-render-facts-projection.ts:80` 是逐字转发的）。1 行修复后转绿，同时修好 2 个既有失败测试、引入 0 个新失败（stash 对照 HEAD 证实）。
  - 过程中修正自己一处口径错误：`pen.furniture.glass` 与 `pen.furniture.furniture` 的 severity 下限误写为 `error`，会把 8 处玻璃净距 warning 抬成阻断级；已改为 `warning`。这正是「下限语义」该防的事，故写进文档与配置注释。
  - 迁移纪律：先并联（parity 测试锁两个 CLI 穿透族结论零 diff）再拆除；拆除后 parity 测试翻转为**一票否定**（verify:spatial 不得含任何穿透族 code）。每一步一个 commit，可单独 revert。
- **预算影响**：无。纯工具链改动，不动任何单价、面积与采购范围。
- **关联文件**：
  - 新增：`shared/penetration/{types,scene,rules,clearance,openings,obb,shadow,registry}.ts`、`scripts/verify/penetration/verify-penetration.ts`、`config/anti-penetration.yaml`、`tests/server/{penetration,penetration-registry,penetration-obb,penetration-boundary}.test.ts`、`docs/penetration-lint.md`、本文件。
  - 修改：`shared/spatial-validation.ts`（分解 + 导出穿透层复用的几何原语）、`scripts/verify/spatial/verify-spatial.ts`（拆除穿透规则）、`shared/furniture-profile.ts`（自 `scripts/verify/spatial/` 迁入 shared，两个 CLI 共用）、`tests/server/{spatial-validation,furniture-profile,mep-guidance-baseline}.test.ts`、`config/facts.yaml`（reader 登记 + 新配置文件 coverage + decision_files 增列本文件）、`package.json`（`verify:penetration` 接入 `verify:all`）、`scripts/README.md`、`README.md`、`docs/spatial-validation.md`、`docs/decisions/README.md`、`docs/pending-site-data.md`（#55）。
  - 删除：`scripts/verify/spatial/furniture-profile.ts`（迁移）、`tests/server/penetration-parity.test.ts`（翻转为 `penetration-boundary.test.ts`）。
- **决策人**：业主（定向四问）+ AI 执行。
- **验证**：`npm run verify:spatial` 0 error/0 warning；`npm run verify:penetration` 0 error/8 warning（8 处 `furniture_glass_clearance_insufficient` 为既有净距不足，非本轮回归）；`npm run verify:all` 仍在既有的 `verify-data-consistency` 点位专项（`sock_child_ac` 距墙 0.45m，待现场裁定）处红——stash 对照 HEAD 输出完全相同，先于本次改动存在；`npm run test:server` 失败集与 HEAD 对照零新增；`npm run typecheck`、`npm run verify:facts` 全绿；穿透相关测试 45 项全绿。
- **后续议题（未做，不假装覆盖）**：活动包络（门扇开启弧、推拉门开启态、冰箱/洗碗机/洗衣机门、抽屉/拉篮、椅子拉出、衣柜平开门 vs 床）；`relationships` 白名单整体迁入 `config/anti-penetration.yaml` 的 waivers 并补 `reason`/`owner`/`expires`；OBB 切 authoritative 的前置条件（shadow 差异清单人工过目 + 家具↔墙的中心线口径先解决）；机电预留区口径裁定（`docs/pending-site-data.md` #55）。
