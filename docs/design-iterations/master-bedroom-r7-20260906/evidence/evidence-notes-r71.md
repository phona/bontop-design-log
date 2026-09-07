# 主卧 R7.1（650 收窄版修正）浏览器证据记录

> 本轮950左移核验未改变源几何：为消除 d_mb 需左移≥0.25m，导致衣柜 minX≤2.35，越出北墙实体边界 x=2.60并侵入原位DEC-045 bridge；因此下述R7.1截图继续仅作历史诊断证据，不作为本轮验收。

- 采集时间：2026-09-06；session：`bontop-fa0929e1`（已 close；采集后已恢复 orbit + 门 closed，未改几何/配置）。
- 基线：URL `http://localhost:5173/?v=r71-650-20260906`，视口 1600×1000，6 视角均 `isReady=true`、banner 为空。
- 旧 R7 证据（`r7-final-*`）已 stale（source_version r7-master-bedroom-20260906-650 被 r71 取代），仅历史保留。
- 显示层说明：view 04 为 first-person 模式（orbit 按设计隐藏天花）；采集时隐藏了一个冻结的 d_mb tooltip DOM 覆盖层（纯显示，不影响场景）。
- 门状态切换口径同 R7：运行时遍历 `fixtureType==='master_north_wall_wardrobe_650'` 的 doorIndex pivot 设置 ±95°。

## R7.1 运行时实测（与配置一致）

- bridge 整段层板（lower/main）：x[2.28,2.585] z[4.10,4.865]，沿衣柜西面贯通至前脸（前面 4.88 留 15mm）；与衣柜西面 x=2.60 的 15mm 阴影缝在 **x 向**（2.60−2.585=0.015）。旧 z 向背板缝口径失效，runtime.json 已改写为 `bridge_*_to_wardrobe_west_x=0.015`。
- pelmet 顶封板：x[2.60,3.25] y[2.45,2.50] z[4.30,4.88]，2 meshes（顶板 + 东填板），与衣柜同木色 ✓。
- 门头盒 soffit（first-person 实测 5 meshes）：x[3.25,4.20] y[2.50,2.80] z[4.55,5.60]，**西缘 x=3.25 与衣柜东缘对齐** ✓；pelmet 顶 2.50 = 盒底 2.50，檐线连续。
- 未破坏项：衣柜 AABB 不变；d_mb 叶带净距关闭态 0.050m / 双门全开 0.0349m；门叶全开 max z=5.171；床头面板 7.802/7.898；南柜 max z=9.55（软包络仍未建模 site_pending）。

## 视角清单（均含 .png + .runtime.json + .snapshot.txt）

| 视角 | 内容 | valid |
|---|---|---|
| r71-final-01-entry-bridge | 套间侧近景：两悬浮板 + 整段 bridge 层板贯通衣柜西面至前脸，板东缘与柜西板间阴影缝可读 | true |
| r71-final-02-wardrobe-closed-front | 衣柜关闭正面：双门、pelmet 顶封板（同色帽线）、d_mb/门洞 | true |
| r71-final-03-dmb-and-both-open | 双门全开 + d_mb 开启组合，东缘间隙可见 | true |
| r71-final-04-pelmet-headbox-high | first-person 高位：pelmet 帽线—门头盒一体檐线（2.50 连续）、盒西缘 x=3.25 对齐衣柜东缘、送风格栅与回检底格栅可见 | true |
| r71-final-05-bedhead-east-elevation | 床头正立面：两床头柜、两 86 面板、两壁灯（与 R7 一致） | true |
| r71-final-06-south-window-side | 南窗侧视：南床头柜、南六抽柜、幕墙（与 R7 一致） | true |

## 双审结论（R7.1）

- Aesthetic：PASS（候选预演口径）——L 形贯通成立（view 01），一体檐线成立（pelmet 顶 2.50 与盒底 2.50 连续、盒西缘对齐柜东缘，view 04）；notes：材质仍为占位级；bridge 与柜体色差（浅米 vs 木色）实际为不同件，阴影缝强化了分层读法；最终饰面统一后需复核。
- Functional：BLOCKED——维持 site_pending 项（防倾倒、HVAC 设备深化、南帘实测、d_mb 门套/执手开启态 35mm 口径）；新增 note：bridge 贯通段 z[4.10,4.865] 与衣柜门扫掠无交（门叶 x≥2.585 区域在西面之外，实测四态无交）；回检格栅 view 04 可见。
- Construction：BLOCKED（维持）。总体不 delivery_ready，状态维持 blocked。
