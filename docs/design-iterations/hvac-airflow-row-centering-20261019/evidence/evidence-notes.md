# Evidence Notes — 客餐厅两排风口分别居中（DEC-2026-10-19-R01）

**来源版本**：`runtime-query.json` 中的 HVAC、ceiling、MEP 和 project-render-facts SHA-256。

**视觉门禁**：2026-10-19 09:16（Asia/Shanghai）`gate:visual` CLEAR：ceiling cbb2156213af、electrical c541506a0427、plumbing 81c5778c1239、materials 64176f576326。

**浏览器运行态**：`http://127.0.0.1:5175/`，API `http://localhost:4111`；`isReady=true`、无配置错误。Three.js 场景树四个口实际位置：下出风 x=8.60/12.00，回风 x=9.65/10.95；两排中心都为 x=10.30。

| 证据 | 文件 | 用途 |
|---|---|---|
| 完整设备带室内视角 | `view1-row-centered-band.png` | 同版本画面检查两排槽口和设备带全长 |
| 比例平面示意 | `centered-plan.svg` | 核两排中心、口间距和两端余量 |

**独立复核**：审美复核 PASS；功能复核 BLOCKED_FOR_CONSTRUCTION：餐厅侧送风—回风0.035m近似包络、厂家风量/接口及检修空间仍待工程复核。`verify:all` 为15/17；MEP lint 139 errors/218 warnings，`verify:facts` 的单条悬空引用在未改动的 `docs/pending-site-data.md:3`。

**功能边界**：MEP lint 仍有139 errors / 218 warnings；本组对应一条餐厅侧送风—回风 0.035m 近似包络警告。此警告不是物理短路的证明，但实际射流与回风须在施工前复核；运行坐标/视觉证据不证明风量、静压、噪声或检修净空。
