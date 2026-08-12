# 室内灯光渲染系统设计（夜景体验 + 灯光决策验证 + 水电交底同源）

日期：2026-08-12
状态：已实施（2026-08-12，见文末校订）
触发：灯光升级讨论（lighting 2800→6500 待决策）需要 3D 可视化验证；审计确认渲染器零室内光源（无 PointLight/SpotLight），夜景模式="关灯"；electrical.yaml 已有 light_dining_pendant 等锚点

## 背景与问题

- 现有光照：太阳平行光（方位角驱动+投影）+ 环境光 + 补光 + IBL；夜晚 `dirLight.visible=false` 后室内只剩平板环境光
- 灯光升级的核心体验（光池/三层结构/3000K 氛围）发生在**夜晚**，当前完全不可视
- electrical.yaml 已含真实灯位（餐桌吊灯、电视墙灯带电源），扩展后**一份配置同时喂渲染器和水电交底单**

## 目标 / 非目标

**目标**：
- 夜晚/黄昏场景下室内灯光可体验：第一人称走动感受光池、层次、色温
- 灯光方案（约 12 个点位）声明在 electrical.yaml，成为水电交底数据源
- 与 SunlightSystem 联动：日落自动开灯；手动开关（全局 + 分房间）

**非目标**：
- 不模拟具体灯具 SKU 外观（灯具网格为通用示意体）
- 不做玻璃幕平面反射（裸灯泡反光问题无法在 3D 呈现，属已知边界）
- 不做 IES 配光曲线、不做调光（智能 B 级本来就无调光）
- 不动电气校验规则语义（新 type 只增不改）

## 变更清单

### 1. config/electrical.yaml — 灯光点位扩展

新增 type 枚举值（仅新增，既有 socket/switch 等不动）：
`pendant`（吊灯）/ `dome`（吸顶灯）/ `wall_lamp`（壁灯）/ `downlight`（筒灯）/ `led_strip`（灯带）

默认灯光方案（呼应灯光升级决策，全部 3000K）：

| id | room | type | 位置 | 说明 |
|---|---|---|---|---|
| light_dining_pendant | living_dining | pendant | (8.5, 3.35) h2.8→灯头 h≈2.05 | 已存在，type ceiling_light→pendant；距桌面 75cm |
| light_living_main | living_dining | pendant | (10.3, 7.0) 灯头 h≈2.1 | 客厅主灯（沙发区上方） |
| light_tv_strip | living_dining | led_strip | (7.2, 7.0) h2.0 沿 z 5.8–8.2 | 电视墙灯带（电源已有 sock_living_tv_led） |
| light_master_dome | master_bedroom | dome | (2.6, 7.6) | 主卧吸顶 |
| light_master_wall_l/r | master_bedroom | wall_lamp | (4.2, 7.2)/(4.2, 8.55) h1.6 | 床头黄铜壁灯×2（东墙，随床头） |
| light_parent_dome / light_child_dome / light_study_dome | study / bedroom_nw / bedroom_se | dome | 各房间中心 | 三房吸顶 |
| light_corridor_1/2 | 走廊 | downlight | (5.7, 5.0)/(5.7, 7.0) | 走廊筒灯×2 |
| light_entry_down | entry_garden | downlight | (13.0, 1.5) | 玄关筒灯 |
| light_kitchen_panel / light_mbath_panel / light_gbath_panel | kitchen / master_bath / guest_bath | dome | 各房间中心 | 厨卫平板灯（4000K 例外区） |

注：坐标为初始值，实施时按 model-geometry 房间中心/墙体校验落位；落位冲突的点位在 3D 走查时裁定。厨卫 4000K，其余 3000K。

### 2. app/src/render/InteriorLightingSystem.ts（新文件）

- 输入：electrical 点位中 type ∈ {pendant, dome, wall_lamp, downlight, led_strip} 的条目
- 光源映射：
  - pendant/dome → `THREE.PointLight`（3000K=0xffd9a8，4000K=0xfff2e0，distance/decay 按房间尺寸标定）
  - downlight → `THREE.SpotLight`（向下，angle≈60°，无阴影）
  - wall_lamp → 小半径 PointLight
  - led_strip → 自发光长条网格 + 1 个低强度 PointLight 近似洗墙（不用 RectAreaLight，避免 uniforms 初始化复杂度）
- **阴影策略**：仅 light_dining_pendant 与 light_living_main `castShadow=true`（全局投影光源 ≤2，其余零阴影）
- **联动**：订阅 EnvironmentManager.getLightingState()——isNight 或太阳高度角 <10° 自动开灯；日出自动关
- **开关**：全局 toggle（键位 L，注册进 mode-key-policy）+ per-room toggle（`setRoomLights(roomId, on)`，供 UI/MCP 后续扩展）
- 性能预算：光源总数 ≤14，无阴影光源不增加 draw call 负担

### 3. app/src/render/FixtureFactory.ts — 灯具示意网格（4 个新配方）

- `pendant`：吊线（细圆柱）+ 灯罩（圆锥/半球，半透乳白色 emissive）
- `dome`：扁平半球贴天花，emissive
- `wall_lamp`：小底座+短臂+灯罩，emissive
- `downlight`：嵌顶小圆柱圈
- 灯具网格随 InteriorLightingSystem 光源生成（rendering 一体），不进 furnishings、不进 FURNITURE_DIMS、不进碰撞——**灯具是电气点位的可视化，不是家具**

### 4. app/src/App.ts — 装配

- InteriorLightingSystem 在 HouseScene 初始化后构建，数据源复用现有 electrical 加载链路
- L 键注册（mode-key-policy .test 同步更新）
- furnishings 里各房间 `ceiling_light` count-only 条目**保留不动**（它喂预算 counts；渲染以 electrical 点位为准，二者口径在 spec 注释说明，避免双写混淆）

### 5. shared/types.ts — 类型放宽

- electrical 点位 type 联合类型加入新枚举值（若当前为 string 则只需注释）

## 测试

- **InteriorLightingSystem.test.ts**：
  - 按 type 生成对应光源种类/数量；3000K/4000K 色温映射正确
  - 全局 toggle 与 per-room toggle 行为
  - 夜间自动开灯逻辑（mock isNight / 低高度角输入）
  - 投影光源数量 ≤2 的守卫断言
- **mode-key-policy.test.ts**：L 键注册
- 既有 SunlightSystem/EnvironmentManager/HouseScene 测试不变红
- 收尾：`npm run test:app && npm run verify:all && npm run typecheck`

## 验收标准

1. 时间拖到 20:00（夜景）：全屋灯光自动亮起，第一人称从玄关走到主卧，光池层次可感（餐桌亮池、电视墙洗墙、走廊筒灯节奏）
2. 3000K 客餐厅 vs 4000K 厨卫的色温差异肉眼可辨
3. L 键全局开关、帧率不掉
4. 电气点位清单打印即可作为灯光水电交底单（id/房间/坐标/高度/备注齐全）

## 风险与边界

1. 多光源前向渲染在低端核显的掉帧风险——守卫：光源总数硬上限 14，超出 warn 截断
2. 灯具为通用示意体，不预览 SKU 外观（与瓷砖"理想渲染"偏差同类，决策仍以实物为准）
3. 与 PBR spec 的关系：独立可单独落地；PBR 先落地则灯光下材质表现更佳，顺序不限
4. led_strip 的洗墙是近似（PointLight），非真实线性光——验证"有没有洗墙效果"足够，不验证照度分布

## 工作量

约 0.5–1 天：InteriorLightingSystem + 灯具配方（半天）→ electrical 点位扩展 + 落位校验（1h）→ 联动/键位 + 测试（2h）→ 夜景走查调参（1h）。

---

## 实施校订（2026-08-12）

- §3 灯具网格未走 FixtureFactory 配方，改为 InteriorLightingSystem 内置构建（光源+灯具一体内聚，单文件闭环；FixtureFactory 配方路径不变）
- §1 走廊筒灯落位调整：x[4.2,7.2]×z[4.3,5.55] 走廊带**不属于任何房间**（几何留白，bounds 规则 ERROR），移至客厅西缘走廊口 (7.35,4.9)/(7.35,6.6)；走廊带归属问题已注记，量房后可归并相邻房间
- light_dining_pendant type 由 ceiling_light 改为 pendant（ceiling_light 保留为 dome 别名兼容）
- per-room 开关 API（setRoomLights）已实现，UI/MCP 暴露留后续
- 人工验收项（20:00 夜景走查、色温对比、帧率）待业主在 3D 中执行
- **性能修复（业主实测"开灯即卡"后）**：pendant 由 PointLight 投影改为 **SpotLight 向下光池投影**——PointLight 阴影为立方体 6 次渲染/帧/盏（2 盏=12 次/帧，卡顿根因），SpotLight 锥形阴影仅 1 次/帧/盏；副作用为正向：光池更聚焦，符合"餐桌亮池"设计意图。走廊筒灯 2→1（光源总数 15→14，回 spec 上限内）
