# Evidence Notes — 客餐厅底面四口整体居中（DEC-2026-10-18-R02）

**来源版本**：`runtime-query.json` 中记录的 HVAC、ceiling、MEP 与 project-render-facts SHA-256。

**预演门禁**：2026-10-18 23:52（Asia/Shanghai）`gate:visual` CLEAR：ceiling 754f3847a058、electrical c541506a0427、plumbing 81c5778c1239、materials 64176f576326。

**浏览器运行态**：`http://127.0.0.1:5175/`，API `http://localhost:4111`；标题“和萃 701 - 3D 装修设计”；`window.__APP__.isReady()` 为 true、无配置错误横幅。Three.js 场景树内四个功能对象实际坐标为 x=8.60/9.70/10.90/12.00，中心值平均 x=10.30。

| 视角 | 文件 | 用途 |
|---|---|---|
| 客餐厅边吊第一人称全长近景 | `view1-centered-band.png` | 同版本模型全段入镜，查看设备带及槽线 |
| 四口比例平面图 | `centered-plan.svg` | 核对功能口中心、1.10/1.20/1.10m 节奏和两端余量 |

**中间调试图**：`view2-centered-plan.png` 是全屋/吊顶状态画面，无法核对口位，已从本轮证据中剔除；之前 R01 与 R18/R20 历史证据保留。

**审美复评**：独立复评 PASS，确认四口中心、节奏与两端余量在当前连续黑槽语言下平衡。**功能/施工边界**：独立复评 BLOCKED_FOR_CONSTRUCTION_ONLY；餐厅侧送风—回风留有 0.035m 近似包络警告，仍需工程气流与检修复核。

**静态核验**：typecheck、ProjectRenderFacts、YAML/JSON/SVG 解析通过；`verify:all` 为15/17，`verify-mep` 仍有全仓错误，`verify-facts` 报未改动的 `docs/pending-site-data.md:3` 有一条悬空决策引用。

**校核边界**：当前视图证明运行时对象位置，不证明送风射流、风量、噪声、静压或回风检修空间。MEP lint 仍有全仓错误与警告；本轮保留一个侧送风—餐厅回风近似包络警告，需工程深化判定。
