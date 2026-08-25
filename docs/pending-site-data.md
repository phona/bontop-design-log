# 量房待填清单

> 交房后现场量房，逐项填入。每项标注精度等级：
> - `inferred`：从图纸/规范推断（当前值）
> - `estimated`：从视频/同户型估算
> - `measured`：现场量房确认（最终态）

## 结构

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 1 | 梁体位置/宽度/高度 | model-geometry.yaml `beams:` | `{id, x1,z1, x2,z2, width, depth}` | 推断见下，邻户实测参考见表下注 | inferred | 吊顶/HVAC/灯具 |
| 2 | 承重墙标记 | model-geometry.yaml walls `load_bearing: true` | boolean | 外墙+电梯井墙 | inferred | 拆改红线 |
| 3 | 室内净高 | model-geometry.yaml height | 2.8 | 2.8m（邻户结构板 +2830 佐证） | inferred | 吊顶/柜体 |
| 3a | A2 HVAC 邻户梁参考约束 | config/hvac.yaml `reference_constraints` | 各范围/梁底/底沉 | 南窗带 LD100、北厨房 LD180、厨房/主卫局部梁头、走廊服务带 | inferred/pending，±150mm | 仅作 HVAC 协调提示，非施工 |

### 梁体推断（待确认）

| 位置 | 跨度方向 | 推断梁高 | 推断梁宽 | 依据 |
|------|----------|----------|----------|------|
| z=5.55 线 x[0,7.2] | 东西向 | 350-400mm | 250mm | 板跨 4.25m 支座 |
| z=4.30 线 x[0,13.4] | 东西向 | 400-500mm | 300mm | 客厅 6.2m 跨北支座 |
| x=7.20 线 z[0,9.8] | 南北向 | 400-500mm | 300mm | 结构分界线 |
| x=13.40 线 z[0,9.8] | 南北向 | 350-400mm | 250mm | 结构分界线 |

### 邻户实测参考（survey/neighbor_ys01_original_structure_2025-06.png，点石 2025-06 原始结构图渲染件，同户型）

> 比例标定后映射到本坐标系，精度 ±150mm，仅作参考；自家以现场量房终核。
> 读法修正（2026-08-21，业主样板间视频佐证）：贴外墙虚线为**上飘窗台俯视投影**（高于剖切面故画虚线），
> LH=窗高、LW=窗宽；sill ≈ 2830−LH。自洽验证：2070+760=2830 正好顶到结构板；
> 旧全屋 sill 2.55 系客厅值误推广（2.55+0.45=3.0 穿楼板，无效）。**宽扁梁读法作废**——
> 梁仅为 LD:100–180 组 = 浅梁（底沉 100–180，梁底≈2.65–2.73）。

| 位置（本坐标系约值） | 邻户标注 | 解读 |
|------|------|------|
| 南幕墙线 z≈9.8（主卧/父母房段 x≈1.8–5.4） | LH:760 / LW:1380 ×2，LD:100 | 上飘窗 sill≈2.07、窗高0.76、窗宽1.38×2；梁底沉100 |
| 南幕墙线 z≈9.8（书房段 x≈14.9） | LH:750 / LW:1110，LD:100 | sill≈2.08、窗高0.75 |
| 南幕墙线 z≈9.8（客厅段 x≈9.5） | LH:260，LD:100 | 上光带 sill≈2.57、窗高0.26（与旧假设吻合，仅客厅成立） |
| 北幕墙线 z≈0（厨房/入户段 x≈9.2） | LH:710，LD:180 | sill≈2.12、窗高0.71；梁底沉180 |
| 左翼凹进线 z≈1.10（x≈3.8） | LH:750 / LW:1160 | sill≈2.08 |
| 主卧西墙 x≈0（z≈7.4 段） | LW:970 | 窗宽 0.97 |
| 厨房内（x≈9.2, z≈1.8） | LH:270 / LW:210 | 小梁头/局部投影，非窗尺寸 |
| 主卫内（x≈1.5, z≈3.8） | LH:420 / LW:400 | 小梁头/局部投影，非窗尺寸 |
| 全屋结构板面 | +2830 | 结构净高 ≈2.83m，与 house.yaml 2.8 估算吻合 |
| 下沉板 | 两卫 300/330，厨房/阳台/入户 50 | 同层排水沉箱确认；防水/排水设计按此 |
| 总尺寸 | 16650（北）/16725（南）× 10030（西）/11180（东，含南飘） | 本模型 16400×9800 内净 + 幕墙/飘窗差，量级吻合 |
| 主卧/父母房隔墙（x=4.2） | 图中为实墙，无内窗 | 佐证 w_mb_win 疑为 CAD 残留（#25 仍须自家核实） |

### A2 HVAC 参考约束量房回填

`config/hvac.yaml` 的 A2 `reference_constraints` 是邻户图的比例映射，统一为 ±150mm、`inferred`/`pending` 与 `not_for_construction`。量房时逐项拍照并测量自家南窗带、北厨房、厨房/主卫局部梁头和走廊服务带的范围、梁底、净高及可用绕行空间，同时确认冷凝水立管接点；不得假定现有地漏可接。

回填必须基于自家实测事实并由后续深化流程单独审阅。邻户资料本身不得改标 `measured` 或 `confirmed`，不得作为开孔、穿梁、套管或施工许可依据；在确认前 HVAC 路由继续绕梁优先。

## MEP 基础设施

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 4 | 强电箱位置/容量 | electrical.yaml `type: strong_panel` | `{x, z, height, width, depth, circuits, capacity}` | 进门后左手边玄关墙；LD=1.650m，390×210mm | measured（照片/规格）；坐标 inferred | 回路规划；回路数/容量仍待开箱 |
| 5 | 弱电箱位置 | electrical.yaml `type: weak_panel` | `{x, z, height, width, depth}` | 推定与强电箱同组/相邻；LD=0.500m，400×300mm | likely；坐标 inferred | 网关/路由；箱体和入户线路待开箱确认 |
| 6 | 卫生间排水立管 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | 推断主卫(0.3,1.3) 客卫(5.8,2.4) | inferred | 马桶/地漏定位 |
| 7 | 厨房排水立管 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | 推断(10.5,0.3) | inferred | 水槽定位 |
| 8 | 给水入户点 | plumbing.yaml `type: water_supply` | `{x, z, diameter}` | 待确认 | — | 水管走向 |
| 9 | 燃气表位置 | plumbing.yaml `type: gas_meter` | `{x, z, height}` | 推断厨房北墙(8.0,0.2) h=1.5 | inferred | 热水器/灶具 |
| 10 | 排烟道位置 | 新文件 ductwork.yaml | `{x, z, diameter}` | 推断厨房(9.0,0.1) | inferred | 油烟机烟管 |

## 建筑细节

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 11 | 幕墙竖梃位置 | overlay.yaml `type: mullion` | `{x, z}` 列表 | 待量 | — | 窗帘轨道/家具避让 |
| 12 | 房间净尺寸复核 | model-geometry.yaml 顶点坐标 | 更新 x/z | CAD 值 | inferred | 面积/家具 |
| 13 | 入户门尺寸/开启方向 | model-geometry.yaml openings | 更新 width/room | 待量 | — | 玄关柜布局 |
| 14 | 空调外机位净尺寸 | house.yaml west_platform | 更新 width/length | 1.6×1.55m | inferred | HVAC 选型 |
| 15 | 幕墙可开启扇位置/尺寸 | house.yaml constraints.exterior | 每面位置+宽+高+开启方式 | 四面均有推拉窗，约1m宽 | estimated | 纱窗/窗帘轨道避让/通风方案 |
| 16 | 厨房排水立管实际位置 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | 推断(10.5,0.3) | inferred | 北墙水槽x坐标 |
| 17 | 厨房排烟道实际位置 | 新文件 ductwork.yaml | `{x, z, diameter}` | 推断(9.0,0.1) | inferred | 烟管走向 |
| 18 | 厨房燃气表实际位置 | plumbing.yaml `type: gas_meter` | `{x, z, height}` | 推断(8.0,0.2) h=1.5 | inferred | 燃气管路由 |
| 19 | 主卫排水立管实际位置 | plumbing.yaml `type: drain_riser` | `{x, z, diameter}` | 推断(0.3,1.3) | inferred | 洗手台外移坐标 |
| 20 | 全屋飘窗实际sill高度 | overlay.yaml bay_sill | 更新 sill 值 | 卧室系≈2.07 / 厨房≈2.12 / 客厅系≈2.57（邻户图 LH 读法+样板间视频目视；旧值全屋2.55系客厅值误推广且穿楼板无效，已废） | inferred→待量房终核 | 飘窗利用方案/儿童房衣柜降高/窗帘盒 |
| 21 | 厨房实际南界/餐厅带划分 | model-geometry.yaml 顶点 v_kit_s2/v_ent_kit2 | 更新 z | 推断 z=2.90（创想图） | inferred | DEC-014 厨房面积/餐桌方案前提 |
| 22 | 冰箱实际位置 | electrical.yaml sock_kitchen_fridge | `{x, z}` | 推断东墙南端 (10.80,2.55) | inferred | 插座/高柜设计；与玄关强弱电箱位置无关 |
| 23 | 厨房净面积复核 | house.yaml rooms.kitchen | 更新 width/length/area | 3.6×2.9=10.44（开发商标注 6.09 为净口径） | inferred | 预算/柜体延米 |
| 24 | 全屋门洞实际位置+开启方向 | model-geometry.yaml openings / electrical.yaml | 各门洞坐标 | resolver 口径（offset=锚点到洞口中心距），重点 d_ent/d_gbath/d_mbath | inferred | 开关/插座避门摆（已按此口径避让）、主卫洗手台距门边 5cm、柜体间隙 |
| 25 | 主卧东墙窗洞是否存在（w_mb_win） | model-geometry.yaml openings | z∈[7.1,9.5] w=2.4 sill=0.9 | inferred（house.yaml/决策日志均无记录，疑 CAD 残留） | 主卧床头位、床头壁灯（h=1.6 落入窗洞）、东墙电气点位 |
| 26 | 燃气热水器位置+排烟/燃气路由 | electrical.yaml / plumbing.yaml | 暂定阳台 sock_balcony_waterheater | undecided（house.yaml：厨房或入户花园待定） | CO 安全（生活阳台为封闭玻璃幕）、物业外立面审批、燃气表路由 |
| 27 | 墙厚：隔墙 100 / 内墙 180-200 / 外侧 280（邻户尺寸链直读） | model-geometry.yaml / 电气布管 | 邻户参考 | reference | 柜体嵌入/挂重、100 墙开槽限制、门套 |
| 28 | 交付标准核实：图纸附交付标准清单但勾选状态不可辨（表格近空白），**不得当作邻户事实**；此前"全房有电线/地面水泥/888"表述已纠正 | budget 水电/拆改 | 以购房合同+交房现场核实为准 | unconfirmed | 水电 12000 预算口径（原线路利用 vs 全改）、888 铲除 |
| 29 | 强电箱/弱电箱/燃气表/排水立管/水表点位 | electrical.yaml / plumbing.yaml | 图例有符号定义，但图面符号与图例不同比例且含图例未收录图标（竖框+圆圈×2，疑灶具/热水器，见 (2.3,0.6)/(6.9,-0.4) 两簇），自动提取不可靠 | 需现场对照图纸逐项核 | 不再尝试从邻户图提取坐标；量房日带图对照 |

## 量房工具清单

- [ ] 激光测距仪（±1mm）
- [ ] 5m 卷尺（备用）
- [ ] 手机（拍照+水平仪 APP）
- [ ] 记号笔+美纹纸（标记点位）
- [ ] 打印本清单（现场勾选）

## 拍照要求

- [ ] 每个房间四面墙正面照
- [ ] 天花板（露梁）
- [ ] 强电箱/弱电箱打开拍
- [ ] 排水立管/给水口/燃气表特写
- [ ] 幕墙竖梃全貌
- [ ] 空调外机位全貌+百叶
- [ ] 入户门正面+侧面
