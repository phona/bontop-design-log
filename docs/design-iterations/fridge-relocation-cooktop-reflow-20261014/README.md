# 冰箱换位与灶台区重排：3D 试版

## 当前状态

`implementation`。用户明确区域为长虹门南侧、入户门西侧并授权预研；本轮采用 (10.94,3.48) 作为 agent-selected 3D 候选，不将它写成业主已批准的施工点。

## 实施前已核实基线

- 厨房平面范围约 x[7.20,10.80]、z[0,2.40]；餐厨长虹推拉门沿 z=2.40，x[7.20,10.80]，h=2.55，四扇，常开时活动扇叠收东端。
- 现冰箱只有一台，中心 (10.45,2.05)，rotation 90；当前程序模型 0.70×0.70×1.80m。
- 东墙灶台柜现长 1.40m、深 0.60m；灶具/烟机中心 (10.50,1.18)。
- 烟道锚点 (10.60,1.50) 仍是 inferred、±0.20m、not_for_construction；燃气报警器插座保持 (10.80,0.20)，h=2.35。
- 推定的“门头柜”候选对象是 `entry_half_height_cabinet`，中心 (11.50,4.00)，占地约 x[11.325,11.675]、z[3.00,5.00]；请业主确认该映射。

完整来源、状态与影响见 `round.yaml（fact_table 段）`。

## 施工前待核

1. 厂家安装图核 HR-518WUFIPZ 背/侧/顶净空、通风、门铰方向与真实开门包络；模型按用户给定 833×600×1910mm、W×D×H 假设作 3D 外形。
2. 电工/橱柜方为新客餐厅试位确认无需拉冰箱即可检修的专用回路 outlet 位置与 route。旧 `sock_kitchen_fridge` / `strong-ded-fridge` 只保留为 circuit placeholder，不代表新冰箱已供电。
3. 交房实测排烟道并核 hood SKU 接口；气源/报警器/切断阀与报警距离仍由燃气公司按实物复核。烟道 marker 和报警器坐标不随本轮改动。

以上是施工深化/site-pending 项；不阻止本轮3D候选比较，但不构成施工冻结。

## 基线验证与实质内容审计

- **第一次预检时**运行 `npm run gate:visual`，tsx CLI 在本环境创建 IPC 管道得到 `EPERM /tmp/tsx-1000/*.pipe`；用 `node --import tsx` 执行同一 gate 后显示 4000/5173 服务不可达。
- **第一次预检时**尝试以 `HOST=127.0.0.1 node --import tsx server/index.ts` 启动服务，监听 `127.0.0.1:4000` 被 sandbox 拒绝（`EPERM`）。当时无有效 browser evidence，也没有声称客户端与磁盘 config 一致；后续业主指出已有服务后复核结果见文末。
- 初次 alignment gate 的状态和服务故障记录保留在下方时间线；本轮 actual source delta 与旧 waiver 删除理由列于 Implementation diff。
- 新试案若未同步冰箱插座/专用回路、开门包络、冰箱—柜碰撞关系、灶具/烟机位置与报警器距离校验，可能出现“画面已移动、验证数据仍引用旧位”的静默失效。验收会逐条检查这些依赖。

## 实施前源版本指纹

算法：SHA-256。以下表格是实施前版本；最终实现与截图绑定版本见 `evidence/source-fingerprint-v004.json`。

| Source | SHA-256 |
|---|---|
| `config/house.yaml` | `9117774169a0472ee5efbcb19b9524f59da92006f7a6c180c058ff6d26a0a255` |
| `config/layout/model-geometry.yaml` | `a55be14471ad8de3d3c8ad292e69c46f96ac0722c7f9dc28333864f8df073ba4` |
| `config/layout/overlay.yaml` | `da3a7e84f04fee84228694ad5c9d0a8f442f45ae8f923d454716e6955b4c9ab6` |
| `config/plumbing.yaml` | `7ec4b7a86d6077c76e216c965c9bb82d11c8670955665d264ddf6f7c804a30b3` |
| `config/electrical.yaml` | `2611235af2b6b0bd3909a79941da7b21236e86362d4ca9df3df57b44a1420343` |
| `config/anti-penetration.yaml` | `4de5e991dd2635dc97ab982061c4e790dc652bdf84ae659a72873b7483a00682` |
| `config/mep-hvac-coordination.yaml` | `510d92bfe1c8882744178f2196ff86bbf61bca8e2886253580f66b8890d4a9c6` |
| `shared/types.ts` | `86301befd1547a50de7fae1cc81d005853d8a23b5a1a0f1a059e1e8433795880` |
| `shared/render/FixtureFactory.ts` | `e3d8c4cf4efd34a409f0f0ff1611db79ba09a9810bb3e7892588ca57a6f3d539` |

## 2026-10-14 跟进：业主说明 5173 服务已运行

前述服务不可达记录是第一次检查时的状态。业主指出本地服务已运行后复核：`curl -I http://127.0.0.1:5173/` 返回 **200 OK**，`npm run gate:visual` 返回 **CLEAR**（ceiling `bd9dd7b0743d`、electrical `49089f90f8f2`、plumbing `b6e654a29521`）。真实浏览器 URL 为 `http://127.0.0.1:5173/`，title 为“和萃 701 - 3D 装修设计”，`window.__APP__.isReady()` 为 true，错误横幅为空，snapshot 与 runtime 查询见 `evidence/`。

运行时确认当前仍是一台旧规格冰箱：objectId `furniture:kitchen:fridge:5`，中心 (10.45,0,2.05)，AABB x[10.10,10.80]、y[0,1.80]、z[1.70,2.40]；尺寸 0.70×0.70×1.80m。门 objectId `kitchen_dining_sliding_door`，开态四片 panel 均在东端叠收区域。现 fridge 插座仍在 `sock_kitchen_fridge` (10.80,0.30,2.05)，燃气报警器插座在 (10.80,2.35,0.20)；烟道 marker 在 (10.60,0.50,1.50)。运行时数据完整见 `evidence/runtime-baseline.json`。

- `evidence/baseline-overview.png` 与配套 snapshot 是版本绑定的全屋上下文，**属于 overview，不能用于冰箱/动线评审**。
- `evidence/fridge-current-runtime.png`、`fridge-kitchen-dining-baseline.png`、`fridge-kitchen-interior-baseline.png` 为相机探查诊断图；墙体/门体遮挡导致目标冰箱本体未清晰入画，状态均为 invalid，不提交评审、不作为完成证据。保留它们仅用于说明本次相机探查为何未构成目标机位证据。
- 该次浏览器快照发生在候选点试算前：5173 可访问，服务门禁已 CLEAR，但当时的工作状态仍是 `alignment_required`、源配置未编辑；后续用户相对区域澄清与候选实施见下方 implementation diff。

本次 evidence 文件 SHA-256：overview PNG `1020cfbd61cbf5bfeeefbfd7ca3dce05577ae00add5bda527801c83cc38ff24b`；snapshot `ac445eb335ea56d173b6a5d31a88638ef76d676b9bfcb5e0a77e65f6a7a0648b`；runtime JSON `fca63c423baa4b4922c8e2f0ed18204ce321320cd62f611b948e0d55ee901d5e`。

## 最终 3D 试案 after-v004

用户给定范围是长虹门南侧、入户门西侧；当前试放点由该区域推得，不是业主确认的施工坐标：

- 冰箱仅一台，`furniture:living_dining:fridge:13`，中心 **(10.94,3.48)**、rotation=90、门朝西；机身外廓按用户提供 833×600×1910mm，runtime AABB x[10.64,11.24]、z[3.0635,3.8965]、y[0,1.91]。正面门板、内嵌拉手和两侧薄饰面是通用示意；不是厂家级模型，也不含厂家安装净空。
- `entry_half_height_cabinet` footprint 未变，runtime AABB x[11.305,11.698]、z[2.98,5.02]、h=1.50m；与冰箱留约 **65mm** 侧缝。此对象仍是业主所称“门头柜”的模型映射候选。
- 东墙柜段最终为 length **1.95m**、center (10.48,1.275)、rotation=90；标称 z[0.30,2.25]，runtime 台面北缘 z=2.27。长虹门开态叠扇最南缘 z=2.33，柜端留 **60mm**。灶具和烟机中心 (10.50,1.50)，烟道点 (10.60,1.50) 保留为 inferred；报警器位置 (10.80,0.20,h=2.35) 未挪。
- 第一次扩柜试值 length=2.05m、center z=1.325 与开态长虹门叠扇 shadow 相交 **0.09m**，已据碰撞证据缩短 100mm；失败报告保留在 `evidence/penetration-shadow-intermediate-run205.json`，不是当前配置。
- 当前量镜像为柜体 run 合计 4.91m、投影面积 4.2226㎡、台面 5.51m（含 0.60m 连续桥段）。`planned_cny` 未改；测试覆盖预算候选金额按最终量派生。

### 门扇、取物空间与碰撞

- `fridge-slider-open-after-v004.png` 与 `fridge-slider-closed-after-v004.png` 使用同机位：相机 (8,1.7,7.1)，目标 (10.9,0.95,3.48)。开、闭两态四扇最高 z 均为2.52，冰箱北缘 z=3.0635，净距 **0.5435m**。
- 入户门 `d_ent` 现渲染叶扇 AABB z[1.90,2.90]，距冰箱 **0.1635m**；按墙线和门厚推得的关闭叶扇 z 上缘2.92，距冰箱 **0.1435m**。door_swing 包络也没有命中本轮家具。
- 西开 0.60m fridge opening envelope AABB x[10.04,10.64]，距餐桌 **1.44m**、距最近餐椅 **1.565m**。`fridge-open-door-envelope-after-v004.png` 用半透明地面占位面表达这个 clearance footprint；它不是实际铰链叶扇模拟，铰链方向和厂家开门姿态仍待安装资料确认。
- 最终 `verify:penetration --shadow`：0 errors、0 OBB candidate pairs。开态滑门影子仅与既有 `ceiling_dining_north_band` 有0.048m重叠；未命中冰箱、入户门、餐桌椅或最终1.95m柜段。中间2.05m失败值已由回归测试锁住。

### 烟机、烟道、报警器和电源

- 烟机中心与推定烟道 marker 的平面差为 (0.10,0.00)m；marker 不含真实烟道实体/接口体积，位置仍 ±0.20m inferred、not_for_construction。机型、烟管方向和实际接驳仍需量房确认。
- 当前模型外廓下，报警插座至灶具最近缘约0.925m、至烟机最近缘约0.8515m；燃气种类、最终报警器和自动切断阀配置仍由燃气公司按实物复核。
- 新冰箱没有已定的可及专用插座。`sock_kitchen_fridge` (10.80,2.05,h=0.30) 和 `strong-ded-fridge` 仍连旧厨房端点占位；没有伪造电气连接，pending 项 #64 由电工/橱柜方在水电交底和柜体深化前确定新 outlet 与路由。厨房热水器、餐桌椅、长虹门几何和门头柜主体/占地均保留。

### 源版本、证据与复核

- v004 源指纹：`8544a676ceb70445369ef234ee0cfedeac345e3672c2e28c93faaabc4c0634ec`，文件清单见 `evidence/source-fingerprint-v004.json`。浏览器为 `http://127.0.0.1:5173/`，标题“和萃 701 - 3D 装修设计”，ready=true、错误横幅为空。v004 只把 `overlay.yaml` 里旧的“固定扇与冰箱邻接”注释标为历史，门体几何与开闭态未变。
- 可比较视角：`evidence/fridge-slider-open-after-v004.png`、`fridge-slider-closed-after-v004.png`、`fridge-front-after-v004.png`、`fridge-open-door-envelope-after-v004.png`、`cooktop-candidate-after-v004.png`；runtime bounds 和门板 AABB 见 `evidence/runtime-trial-after-v004.json`。对应截图 SHA-256、相机和状态在 `round.yaml（review 段）`。
- `npm run gate:visual` CLEAR（ceiling `bd9dd7b0743d` / electrical `01bf1db01b27` / plumbing `7f1513d14f27`）；`npm run verify:all -- --json` 17/17 pass、0 errors（284 warnings/6 unknownCounts）；`npm run test:server` 1005/1005；`npm run test:app` 570/570；`npm run typecheck` pass。`verify:furniture` pass，有2条既有 warning。
- aesthetic 与 functional 独立复核均 PASS，结论只覆盖本次空间试案。厂家安装净空、可逆铰链、现场烟道实体、燃气公司方案、专用电源以及“门头柜”对象映射仍是下一步核对项，不构成施工定位。

### 实质内容/删改审计

- 旧厨房冰箱实例移出后只在 living_dining 保留一台；删除旧 `kitchen_fridge_corner` attached waiver，因为它指向的 run/fridge 配对已不存在，保留会豁免错误关系。gas_stove 和 sink 的 placed runtime index 已随唯一冰箱移动调整。
- 灶台柜配置从1.40m先试至2.05m，再因0.09m door-stack碰撞修至1.95m；先前的1.40m/2.05m/预算中间数、失效相机截图、基线截图均留档。烟道/报警器数值依据和餐厅家具配置没有删除。
- 冰箱从单灰体块换成尺寸不变的通用正面/侧面饰件；详情不宣称来自厂家外观。door hinge、真实安装边距或 outlet 未知时若后续选型改动，当前 envelope 与侧缝结论需重算。
