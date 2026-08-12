# PBR 地面渲染升级设计（人字拼决策支持 + 全选材预演能力）

日期：2026-08-12
状态：已实施（2026-08-12，见文末校订）
触发：奶油法式复古方案评审——"客餐厅人字拼 vs 全屋直铺"决策需要 3D 可视化验证；现有渲染器无法呈现拼法图案、物理比例与掠射光效

## 背景与问题

人字拼决策（+6~10k，DEC 待定）需要回答"图案 + 西晒掠射光在客餐厅的实际观感"。对现有渲染管线审计（2026-08-12）结论：

**已具备**（比预期完整）：
- `EnvironmentManager.setSolarState`：太阳高度角/方位角驱动平行光，含昼夜/色温（EnvironmentManager.ts:96）
- PCFSoftShadowMap 2048 投影（HouseScene.ts:117）；玻璃幕/curtain/glass_infill `castShadow=false`（HouseScene.ts:892/909/928）——西晒低角度光已能穿过玻璃幕进入室内
- 全屋 MeshStandardMaterial；程序化 canvas 贴图 + 法线贴图（TextureFactory）
- IBL 环境贴图可开关（EnvironmentManager.toggleIBL）

**缺口**（人字拼观感正好全在这里）：
1. **贴图物理尺度失真**：`tex.repeat.set(2, 2)` 固定重复（TextureManager.ts:85/90），不随房间尺寸——6.2m 客厅和 3m 卧室显示同样 2 块砖，800×800 与 150×900 无法区分
2. **wood_grain_v2 无条板布局**：同心环木纹连续铺满（TextureFactory.ts:92），无板缝、无砖格——现状直铺的 800 砖缝根本没渲染；herringbone 分支只在 ceramic_tile_v2（平色砖块无木纹）
3. **无 roughnessMap / 无逐板变化**：buildMaterial 未设 roughness（默认 1.0 全哑光），无逐板明度/粗糙度抖动——"相邻板反光角差异"这一人字拼核心光效机制物理上不存在
4. **非确定性随机**：`Math.random()` 直接散布（TextureFactory.ts:118 等），每次加载纹理不同，无法做 A/B 截图对比
5. **无 anisotropy 设置**：掠射角下贴图模糊

## 目标 / 非目标

**目标**：
- 客餐厅地面能以物理正确比例渲染"800×800 直铺"与"150×900 人字拼"两种方案，第一人称走动时可见掠射光明暗差异
- 升级通用化：所有带 appearance 的选材（地砖/墙砖/漆面/窗帘）自动受益
- A/B 截图可复现（确定性渲染），支撑 DEC 决策

**非目标**：
- 不换引擎、不做离线路径追踪（路径 B/C 已否决）
- 不模拟具体 SKU 的印刷版面重复/釉面质感——该验证留在门店样板（spec 外）
- 不动 model-geometry.yaml / overlay.yaml / 碰撞 / 电气
- 不做 SSAO/GTAO 接触阴影（列入后续 stretch）

## 变更清单

### 1. app/src/render/TextureFactory.ts — 新 appearance type `wood_plank`

新增 `drawWoodPlank()`，替代人字拼场景对 ceramic_tile_v2 的借用：

```
appearance: {
  type: "wood_plank",
  color: "#c49a6c",            // 基准色（与 floor_tile_01 一致）
  pattern: "straight" | "herringbone",   // 默认 straight
  plank_mm: [150, 900],        // 板物理尺寸；直铺砖 [800, 800]
  grout_color: "#8a7a66",      // 美缝色
  grout_mm: 2,                 // 缝宽
  finish: "matte" | "soft",    // 哑光 / 柔光（影响 roughness 基准 0.85 / 0.5）
  seed: 42                     // 确定性随机种子
}
```

行为要求：
- **逐板独立抖动**：每块板在明度 ±6%、色相 ±3°、粗糙度 ±0.08 内确定性抖动（seeded RNG，见 §3）——这是掠射光下"明暗流动"的材质基础
- **板内木纹沿板长方向**：直纹/微山形纹，复用 drawWoodGrainV2 的笔刷但拉伸到板的长宽比；禁止同心环（那是木纹砖一眼假的特征）
- **板缝**：凹入 height map（法线下凹），宽度按 grout_mm/plank_mm 比例
- 鱼骨拼（chevron）预留 pattern 枚举位，本期不实现

### 2. app/src/render/TextureManager.ts — 物理尺度校准 + PBR 补全

- **UV 标定**：ShapeGeometry 的 UV 等于 shape 顶点坐标（米制），故 `repeat.set(1/TEX_WORLD_M, 1/TEX_WORLD_M)` 即可世界对齐；TEX_WORLD_M = 贴图 canvas 代表的实际边长（如 3.6m），由 plank_mm 整除反推。实现前先用单测验证 ShapeGeometry UV 假设（若 Three r166 行为不符则退化为按房间 width/depth 计算 repeat）
- `buildMaterial` 补全 PBR 通道：
  - `roughnessMap`：从 plank 抖动生成（ProceduralTextures 接口加字段）
  - `roughness` 基准值按 finish（柔光 0.5 / 哑光 0.85），`metalness: 0`
  - `map.anisotropy = renderer.capabilities.getMaxAnisotropy()`（需把 renderer 句柄传入或后置设置）
  - `normalScale` 校准到板缝深度可见但不夸张（0.5 起步调参）
- 旧类型（wood_grain_v2 / ceramic_tile_v2 / stone）行为不变；repeat 校准仅对带 plank_mm/物理尺寸信息的 appearance 生效，其余保持 2×2 兼容

### 3. 确定性随机

- 新增 `app/src/render/seeded-rng.ts`：mulberry32(seed)，签名 `() => number`
- drawWoodPlank 全程使用；seed 来自 appearance.seed，缺省 42
- 旧函数暂不改造（避免视觉回归），仅新类型强制 seeded

### 4. config/materials.yaml — 决策对比候选项

floor topic 新增候选（不动 floor_tile_01 默认选择）：

```yaml
- id: "floor_tile_herringbone_01"
  topic_id: "floor"
  alternative_group: "floor_tile"
  category: "地砖"
  name: "长条木纹砖人字拼（客餐厅）"
  spec: "150x900mm"
  status: "candidate"
  price_per_unit: 待门店报价          # 连同版面数/美缝报价一起确认
  notes: "人字拼工费上浮 20-50%（DEC-011）；版面数需 ≥6-8；仅客餐厅+走廊铺贴"
  appearance: { type: "wood_plank", color: "#c49a6c", pattern: "herringbone", plank_mm: [150, 900], finish: "soft", seed: 42 }
```

- floor_tile_01 的 appearance 升级为 `{ type: "wood_plank", pattern: "straight", plank_mm: [800, 800], finish: "soft", seed: 42 }`——顺带修复"800 砖缝不可见"的现状失真
- 卧室 bedroom_tile_01 同步升级 straight 版（与客餐厅通铺一致）

### 5. app/src/App.ts + 决策工作流

- 确认 `setFloorMaterial(roomId, appearance)` 通路接受扩展字段（当前类型签名只声明 type/color/scale，放宽到 MaterialAppearance）
- 对比流程（手动，不改 MCP）：
  1. `appearance.pattern` 直铺/人字拼切换重载
  2. 太阳设 8 月 / 15:00 / 17:30（南宁 22.8°N，西晒掠射角工况）
  3. 第一人称沿"玄关→餐厅带→客厅→南玻璃"主动线走一遍 + 固定机位截图
  4. 俯视图整层截图比对图案密度

## 测试

按 AGENTS.md 铁律执行：

- **TextureFactory.test.ts** 新增：
  - 同 seed 两次生成逐像素一致；异 seed 不同
  - herringbone 布局数学：相邻板角度 ±45° 交替、板数与 canvas/plank 尺寸吻合
  - 逐板抖动幅度在声明区间内
- **TextureManager**（新增测试文件或并入现有）：
  - 带 plank_mm 的 appearance 生成的材质 roughnessMap 存在、roughness 基准符合 finish
  - repeat 校准：给定 plank_mm 与 TEX_WORLD_M，repeat 值正确
- 既有 SunlightSystem / EnvironmentManager / HouseScene 测试不得变红
- 收尾命令：`npm run test:app && npm run verify:all && npm run typecheck`

## 性能约束

- 地面贴图 canvas ≤ 2048²；每 appearance 只生成一次（沿用 cache）
- 新增材质不增加 draw call；帧率目标维持现有水平（第一人称流畅）
- 若 anisotropy=16 在中端核显掉帧，降级 8 并记 notes

## 风险与边界

1. **美化偏差（决策风险，非技术风险）**：渲染的是"理想人字拼"——版面不重复、缝均匀。它会系统性高估现实效果。spec 外对策不变：门店看版面数（≥6-8）、柔光面、美缝试色，两关都过才走 DEC
2. ShapeGeometry UV 米制假设未验证——§2 已列回退方案
3. 旧 appearance 类型视觉回归：改动限定在新类型与 TextureManager 增量字段，preload/既有缓存键不动
4. floor_region（玄关/走廊补区）与房间地板分属不同 mesh，同一 appearance 需两边 repeat 标定一致，否则接缝处纹理错位——验收时检查玄关-客厅过渡带

## 验收标准

1. 俯视整层：客餐厅 150×900 人字拼与卧室 800×800 直铺的**比例关系肉眼正确**（板长 ≈ 床宽的 1/2 强，可对照 1.8m 床）
2. 第一人称、8 月 17:30 西晒：沿主动线走动，人字拼地面有逐板明暗差异；直铺对照组均匀
3. A/B 截图（同机位同太阳）逐像素可复现
4. 玄关→客厅 floor_region 过渡带无纹理跳变
5. 全部测试 + verify:all + typecheck 绿

## 工作量与实施顺序

估算 1–1.5 天：

1. seeded-rng + drawWoodPlank + 单测（半天）
2. TextureManager UV 标定 + PBR 通道（2h，含 UV 假设验证）
3. materials.yaml 候选项 + App.ts 通路放宽（1h）
4. 太阳工况调参 + A/B 截图 + 验收走查（2h）

完成后交付物：DEC 决策包（两组截图 + 预算影响 ±6~10k 复述 + 门店确认清单：版面数/柔光面/美缝色/人字拼工费报价）。

---

## 实施校订（2026-08-12）

- §2 UV 假设：已用真实 three（r166）单测验证 ShapeGeometry UV=顶点米坐标，成立，无需回退方案（texture-uv.test.ts）
- 无缝 wrap：贴图世界边长按图案周期取整（直铺=板长整数倍且行数为偶；人字拼=m·(L+W)/√2 且 m·W≡0 mod (L+W)），消除 repeat 接缝——spec 未细化，实施补充
- 直铺错缝采用工字半错缝（非随机错缝），保证竖向 wrap 无缝
- anisotropy 静态设 8（未传 renderer 句柄），掉帧则降 4
- 缓存键修复：applyToRoom 原按 type:color 缓存，同色系直铺/人字拼会串材质——实施时纳入 pattern/plank_mm/seed（spec 未预见，属缺陷修复）
- 人工验收项（第一人称走查、A/B 截图、floor_region 过渡带检查）待业主在 3D 中执行
