# 量房待填清单

> 交房后现场量房，逐项填入。每项标注精度等级：
> - `inferred`：从图纸/规范推断（当前值）
> - `estimated`：从视频/同户型估算
> - `measured`：现场量房确认（最终态）

## 结构

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 1 | 梁体位置/宽度/高度 | model-geometry.yaml `beams:` | `{id, x1,z1, x2,z2, width, depth}` | 推断见下 | inferred | 吊顶/HVAC/灯具 |
| 2 | 承重墙标记 | model-geometry.yaml walls `load_bearing: true` | boolean | 外墙+电梯井墙 | inferred | 拆改红线 |
| 3 | 室内净高 | model-geometry.yaml height | 2.8 | 2.8m | inferred | 吊顶/柜体 |

### 梁体推断（待确认）

| 位置 | 跨度方向 | 推断梁高 | 推断梁宽 | 依据 |
|------|----------|----------|----------|------|
| z=5.55 线 x[0,7.2] | 东西向 | 350-400mm | 250mm | 板跨 4.25m 支座 |
| z=4.30 线 x[0,13.4] | 东西向 | 400-500mm | 300mm | 客厅 6.2m 跨北支座 |
| x=7.20 线 z[0,9.8] | 南北向 | 400-500mm | 300mm | 结构分界线 |
| x=13.40 线 z[0,9.8] | 南北向 | 350-400mm | 250mm | 结构分界线 |

## MEP 基础设施

| # | 数据项 | 填入文件 | 格式 | 当前值 | 精度 | 影响 |
|---|--------|----------|------|--------|------|------|
| 4 | 强电箱位置/容量 | electrical.yaml `type: strong_panel` | `{x, z, height, circuits, capacity}` | 推断 x≈10.8 z≈0.5 h=1.8 | inferred | 回路规划 |
| 5 | 弱电箱位置 | electrical.yaml `type: weak_panel` | `{x, z, height}` | 推断 x≈10.8 z≈1.0 h=0.3 | inferred | 网关/路由 |
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
| 20 | 全屋飘窗实际sill高度 | overlay.yaml bay_sill | 更新 sill 值 | 2.55m（上飘窗） | inferred | 飘窗利用方案/儿童房书桌位 |

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
