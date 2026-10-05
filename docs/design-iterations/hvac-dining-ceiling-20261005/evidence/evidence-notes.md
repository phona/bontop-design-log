# 证据记录 — hvac-dining-ceiling-20261005

环境：app vite :5174（API :4000）；agent-browser 0.36.0（$HOME/.local/bin/agent-browser 软链→mise node bin）；会话单开；生命周期 open→wait→ready poll→MCP set_camera_target→snapshot→screenshot→validate。

| 文件 | 视角 | 状态 | 说明 |
|---|---|---|---|
| view1-strip-living-bottom.png | 设备带整体 | valid | 轨道近景；两内机+设备带+客餐厅分区可读 |
| view2-dining-north-louver-v2.png | 餐厅侧北立面百叶 | valid | R20 后重采，段域 x[7.70,9.70] |
| view2-dining-north-louver.png | 同上（旧） | invalid | R20 改前版本，已被 v2 取代 |
| view2b-dining-firstperson.png | 第一人称尝试 | diagnostic | 出生点在生活阳台+MEP 标线叠加，无目标关系 |
| view3-corridor-gbath-riser.png | 走廊→客卫竖管 | valid | MEP 叠加；R11 冷凝水路由 |
| view4-kitchen-step.png | 厨房台阶/门头盒 | valid | z=2.40 台阶、吊灯/餐桌关系 |
| view5-kitchen-circuits-covered.png | 厨房电路新路由 | valid | R20 修复① 证据（MEP 叠加） |

运行时查询（与配置一致）：supply_dining (8.70,2.65,4.30)；return_dining (7.90,2.49,4.45)；supply_living_bottom/supply_dining_bottom 在场景中存在（R18 新终端）。
MEP 徽标 ⚠179 与 CLI verify:mep 179 warning 对账一致（R20 前 CLI 178）。

缺口：餐厅第一人称视角（MEP 无第一人称传送；WASD 步进不可靠）。建议业主在自己 Web 会话里从餐桌位置走查一张，回传归档。view2b 按契约仅诊断。
