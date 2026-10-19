# Evidence Notes — 下出风/回风两排南北向居中（DEC-2026-10-19-R02）

**来源版本**：`runtime-query.json` 中的 HVAC、ceiling、MEP 和 project-render-facts SHA-256。

**视觉门禁**：2026-10-19 09:33（Asia/Shanghai）`gate:visual` CLEAR：ceiling 4469b08f84ab、electrical c541506a0427、plumbing 81c5778c1239、materials 64176f576326。

**运行态**：`http://127.0.0.1:5175/`，API `http://localhost:4111`；`isReady=true`、无配置错误。Three.js 场景树中下出风 z=5.125、回风 z=4.725，组合中心 z=4.925，x 向坐标保持 R03。

| 证据 | 文件 | 用途 |
|---|---|---|
| 完整设备带室内视角 | `view1-north-south-centered.png` | 看两排同时南移后的实际 3D 关系 |
| z 向比例平面示意 | `centered-plan.svg` | 核对边吊 z 范围、行中心与 0.40m 行间距 |

**静态核验**：YAML/JSON/SVG 解析、typecheck 与 ProjectRenderFacts 通过；`verify:all` 15/17，`verify-mep` 139 errors/214 warnings，`verify-facts` 的单条悬空决策引用仍在未修改的 `docs/pending-site-data.md:3`。餐厅侧送风—回风近似包络警告在 R04 后消失。

**独立审美复核**：PASS；确认两排关于 z=4.925 对称。**功能/施工边界**：南移后餐厅侧送风—回风近似包络警告不再出现，但机型气流与检修尚未验证，当前仍只作设计预演。

**校核边界**：MEP lint 为139 errors /214 warnings；R03 的餐厅侧送风—回风0.035m近似包络警告在本轮未再出现。当前仍不能替代实际射流、噪声、静压和检修净空核实。
