# 主卧 R7（650 收窄版）浏览器证据记录

- 采集时间：2026-09-06；session：`bontop-39a5bd0d`（已 close；采集后已恢复 orbit 模式 + 衣柜门 closed，未改任何几何/配置）。
- 基线：URL `http://localhost:5173/?v=r7-650-20260906`，视口 1600×1000，9 视角均 `isReady=true`、config-error banner 为空。
- 门状态切换方式：运行时遍历 `fixtureType==='master_north_wall_wardrobe_650'` 组的 `userData.doorIndex` pivot，按铰链侧设置 `rotation.y=∓95°` 并写回 `userData.state`，与 `setNorthWallWardrobe650DoorConfiguration` 同口径；d_mb 门扇为 as-rendered 开启态（rotation -180°，叶带 x[3.30,4.20] z[4.63,4.67]）。
- view 09 为 first-person 模式（orbit 按设计隐藏天花，`HouseScene.setCeilingVisible(mode==='first-person')`）；诊断期间曾临时把门头盒 soffit 涂红验证可见性，已恢复 #f5f5f5。

## 运行时实测（全部与配置一致，无不一致项）

- 衣柜 AABB x[2.60,3.25] y[0,2.45] z[4.30,4.88]（650×580×2450 ✓）。
- 两 bridge（lower/main）z 端 4.285 → 与衣柜背板 4.30 净缝 0.015m（15mm ✓，两件同值）。
- d_mb 叶带 x[3.30,4.20] z[4.63,4.67]；衣柜东缘净距：门全闭 0.050m（50mm ✓）；**右门 95° 全开时门叶东缘外扩，净距降为 0.0349m（约 35mm，仍无交）**——此前"50mm"名义值只对关闭态成立。
- 门叶全开最大南向包络 z=5.171 < 门头盒南立面 5.585 与回风格栅 x[3.695,4.205]（x 向不交）✓。
- 床头面板：sock_master_bed_r_head z 中心 7.802、switch_master_bed_l z 中心 7.898，面板 86×86 h0.75 ✓；床头柜 y max 0.505 ✓。
- 门头盒 soffit：slab 底 y=2.502、四裙边 y[2.5,2.8]、area x[3.45,4.20] z[4.55,5.60] ✓（orbit 默认隐藏，first-person 可见）。送风 x[3.495,4.105] z≈5.585 南面；回风（回检一体）x[3.695,4.205] z[5.07,5.33] 底面 y≈2.47–2.50 ✓。
- 南六抽柜 max z=9.55，距闭帘软包络 9.56 仅 10mm；软包络 z[9.56,9.68] 未建模（inferred/site_pending），curtain_master_south 各态在场景中无几何。

## 视角清单（均含 .png + .runtime.json + .snapshot.txt）

| 视角 | 内容 | valid |
|---|---|---|
| r7-final-01-entry-bridge | 套间侧近景：两悬浮板 + 两 bridge 端段 + 衣柜西侧板 L 衔接（15mm 缝由 runtime 数值证明，图上板端止于柜西板） | true |
| r7-final-02-wardrobe-closed | 衣柜关闭全景：柜体双门、d_mb 开启门扇、门洞通道 | true |
| r7-final-03-wardrobe-left-open | 左门 -95°（runtime rotationDeg=-95，叶 z 抵 5.171） | true |
| r7-final-04-wardrobe-right-open | 右门 +95° | true |
| r7-final-05-wardrobe-both-open | 双门全开，柜前取衣区可读 | true |
| r7-final-06-dmb-and-both-open | d_mb 开启 + 双门全开组合；柜东缘与 d_mb 叶带间可见间隙 | true |
| r7-final-07-bedhead-east-elevation | 床头正立面：两床头柜、两 86 面板（7.802/7.898）、两壁灯 | true |
| r7-final-08-south-window-side | 南窗侧视：南床头柜（画面左/东侧）、南六抽柜（右/西侧）、幕墙；软包络未建模 | true |
| r7-final-09-hvac-headbox | first-person 高位：门头盒 soffit、送风格栅（南面）、回检一体格栅（底面）、衣柜顶衔接 | true |

## 双审结论

- Aesthetic：PASS（候选预演口径）——L 形衔接、床头面板秩序、南窗整体感可读且无阻断项；notes：门头盒与衣柜 x 向不交（柜 [2.60,3.25] vs 盒 [3.45,4.20]）且材质表现不同（白顶盒 vs 木柜），"一体"仅为设计意图；柜顶 2.45 与盒底 2.50 有 50mm 虚缝；材质为占位级表现。
- Functional：BLOCKED——运行时项（门四态无交、bridge 15mm、面板可达、回检格栅可见且不依赖衣柜开膛）已取证，但防倾倒节点、HVAC 设备深化、南帘实测、d_mb 门套/执手突出量均为 site_pending；新增 note：右门全开时与 d_mb 叶带净距约 35mm（非名义 50mm），现场核对应按开启态口径。
- Construction：BLOCKED（维持）。
- 总体：不 delivery_ready，状态维持 blocked。
