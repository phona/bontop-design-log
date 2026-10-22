# 餐厅吊灯改半吸顶 R12（含灯位漂移修正）

## 状态

`delivery_ready（模型范围）`。独立审美与功能复核均 PASS（round.yaml（review 段） 一轮记录）；桌面照度与 SKU 未核、明装段路由待量房，均为 site_pending，不可施工或采购定案。

## 本轮输入

- 业主 2026-10-16：「餐厅吊灯我想换成吸顶灯，可行吗」→ 四选项（只修漂移/全吸顶/半吸顶/先看图）中选择**半吸顶（下垂10-30cm）**。
- 业主发吊扇灯图（IMG_2665.jpg，长虹五叶风扇灯）澄清「你说的半吸灯我以为是这个」——语义对齐：半吸顶=贴顶无扇叶浅漫射罩，非风扇灯。
- 追加两项裁定：① 餐区「风」由独立循环扇/台扇承担（南北通透、空调不一定开的生活方式输入），不做进天花；② 桌面照度先按 150 lx 建模询价、备 100 lx 口径，SKU 数据回来后再定。

## 与旧状态的差异审计

- **移除/替换**：① 灯位 (7.90,3.45)→**(9.80,3.45)**（2026-10-16 餐桌东移后灯位未随动，差 1.9m 的既有漂移，本轮修正）；② type pendant→**ceiling_light**；③ 线性吊灯外观→半吸顶（镀铬吸顶盘 Ø120×18 + 短杆 140 + 浅穹顶乳白漫射罩上口Ø520/下口Ø470/深120 + 细金属收边，总下垂 284mm，罩底 y≈2.516m）；④ style-guide §十一「细长黑色或深棕色线性吊灯」显式改判为贴顶半吸顶；⑤ strong-light-dining 路由重画（西带空腔→北带空腔东行至 x=9.80→南行 0.75m 至灯位）；⑥ 雷士 JZSJ12474-10 线性吊灯候选转历史保留（其总流明/3000K 档输出未列，本就未证明 150 lx）。
- **保留**：点位 id `light_dining_pendant`、`dining` 单独回路、`switch_dining`（h1.3+中性线）、电气拓扑成员关系、餐桌位置/尺寸、客厅主灯 R5~R11 全链、x980 餐桌定稿。
- **R12 代价（不美化）**：① 顶装距桌 1.77m（原吊灯 0.85m），同灯桌面照度比 ≈(0.85/1.77)²≈**0.23**——维持 150 lx 需约 4 倍输出 SKU 或降标；② 选型重开（竞品研究未做）；③ 客餐厅开放区两盏顶装灯（客厅 Ø1000 十头 + 餐厅 Ø520 半吸顶），以同家族配色+尺度层级区分；④ 新增 0.45m 敞开段明装线槽（z3.0→3.45），量房梁位/板底 site_pending；⑤ `pendant` 类型在 config 内已无在役点位（model-package-links selector 同步换 ceiling_light，同一失效模式第四次复发：wall_lamp→track_light→led_strip→pendant）。

## 实现范围

- `shared/types.ts` + `shared/project-render-facts-schema.ts`：新增 `SemiFlushDomeConfig`（type ceiling_light / style semi_flush_ceiling_light / finish **chrome_opal**——模型无黑色件，黑只留客厅主灯 hub）与 schema（包络/下垂/深浅口/杆盘半径校验）。
- `shared/render/SemiFlushDomeGeometry.ts`：浏览器与 GLB/export 共用的半吸顶几何（4 部件：吸顶盘/短杆/浅穹顶漫射罩/金属收边）。
- `shared/render/LightingFixtureBuilder.ts` + `app/src/render/InteriorLightingSystem.ts`：dome/ceiling_light 分支接入（同 style 分流模式）。
- `config/electrical.yaml`：灯位迁新桌心 + type 改 + note 记录；`config/render/lighting.yaml`：半吸顶详细配置；`config/mep-hvac-coordination.yaml`：strong-light-dining 重画；`config/electrical-topology.yaml`：control_dining note 同步；`config/model-package-links.yaml`：selector 换 ceiling_light；`config/render/overrides.yaml`：basis 文案改半吸顶口径。
- `data/project-render-facts.json` 重新生成；`tests/server/cli-glb-export.test.ts` fixtureType 集合断言同步（pendant→ceiling_light）。
- 不改餐桌、回路、墙控、拓扑、客厅主灯、吊顶、HVAC。

## 验证

| 命令 | 结果 |
|---|---|
| `npm run generate:project-render-facts` | PASS，15个灯具事实 |
| `npm run verify:lighting-config` | PASS，2个详细灯具配置 |
| `npm run typecheck`（root + app） | PASS |
| `npm run test:server` | 1008 tests / 999 pass / 9 fail；9 个均为既有失败（会话开始前业主在飞项目：厨房 RO 净水器 waiver 12→13 关系台账、BudgetCalculator 候选价门控、solar α≤0、FixtureFactory browser-free、TextureManager ×2 DOM 环境），与本轮无关 |
| `npx tsx --test tests/server/{cli-glb-export,mep-hvac-lint,mep-guidance-baseline}.test.ts` | 45/45 PASS |
| `npm run test:app`（InteriorLightingSystem） | 17/17 PASS |
| `npm run verify:all` | **17/17 passed** |
| `npm run gate:visual` | CLEAR（electrical `94c988caaf0b`） |
| `npm run verify:mep` | 0 error / 130 warning；strong-light-dining 末段 0.38m 飞线为显式登记例外（unsupported_span 7→8、must_fix 桶 26→27，台账/§6/测试三处同步） |

机制级验证补充：半吸顶几何浏览器与 GLB/export 共用同一构造器；`getSculpturalDomeConfig`/`getMultiGlobeChandelierConfig`/`getSemiFlushDomeConfig` 三 style 分流，互不误捕。

## R12c 同版证据

URL `http://localhost:5173/?v=20261016-r12c`；四视图 runtime+snapshot+PNG 存于 `evidence/r12/`，PNG 在 `tmp/screenshots/dining-semi-flush/living_main_light_r12_*_v001.png`：dining-context（餐厅空间）、closeup（近景）、elevation（立面）、plan（俯视，吊顶隐藏）。每张 ready=true、空配置错误横幅、`visualPreviewActive=false`、目标 `electrical:light_dining_pendant`、非总览相机；hover tooltip 以 patch `HoverTooltip.update` 持久压制。AABB（四份一致）：x[9.540,10.060]、y[2.516,2.800]、z[3.190,3.710]——中心 (9.80,3.45) 与餐桌 AABB 中心严格同心。finish 由 chrome_black_opal 更名 chrome_opal 后统一重采（r12/r12b 版本分裂已作废）。

## 独立复核结论

一轮（round.yaml（review 段） 固定 JSON 契约）：审美 **PASS**（四件分解比例协调、罩深径比 1:4.3 真浅穹顶、Ø520 为桌宽65%/桌长37% 尺度合适、与客厅十头灯同家族不触发 §十一 避免项）；功能 **PASS**（灯位与桌心严格同心、罩底距桌 1.77m/距椅背约 1.6m、路由空腔段不进无吊顶区+0.45m 明装段显式登记、电气接口全未动、照度双口径与 SKU 研究 site_pending、不做吊扇灯已落档）。非阻塞项全部处理：短杆文档 160→140mm、finish 更名、距离口径统一 1.77m、证据版本统一 r12c、MEP reason 措辞精确化（「垂直下引」→南行 0.75m 伴随微升）、overrides basis 文案、§十一 改判、procurement 餐桌行同步。

## 独立复核/遗留（site_pending）

桌面照度（顶装 1.77m 同灯约 1/4）与半吸顶 SKU 竞品研究未做（open_question semi-flush-sku-research，impact blocking）；150 lx 维持或降 100 lx 待 SKU 数据裁定；明装段标高 2.7 低于板面约 0.10m 及梁位/板底平整度量房复核（open_question route-surface-raceway）；六人临时南移 0.32m 时灯相对临时桌心偏北 0.32m 需业主接受；桌面高 0.75m 为惯用口径待家具尺寸复核。模型范围可供业主继续评估，不可直接转为商品/施工定案。
