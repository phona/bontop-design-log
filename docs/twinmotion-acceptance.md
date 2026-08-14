# Twinmotion 云端 reimport 验收手册

日期：2026-08-12
对应 spec 验收标准 3：导入 glb → 替换材质 → reimport 同名新 glb → 材质覆盖保留
前置：本地已通过 `scripts/inspect-glb.ts` 静态验收（命名/数量/包围盒）；`docs/dressing-map.md` 已重新生成最新版

## 0. 需要带上云的文件

| 文件 | 来源 |
|---|---|
| `house-20260812.glb`（或更新日期） | 本地 app 导出（方案面板"导出 glb"按钮） |
| `docs/dressing-map.md` | `npm run export:dressing-map` 重新生成 |
| `house-v2.glb`（reimport 对照件） | 到云上前，在本地改一个**不增删节点**的配置（如某房间地板色号），重新导出；文件名不同但节点名必须完全一致 |

## 1. 环境准备（约 20–30 min）

- [ ] 云电脑开机，确认 GPU 被 Twinmotion 识别（Twinmotion 启动页右上角 / Edit > Preferences > Quality 里看得到显卡型号）
- [ ] Epic Games Launcher 登录 → 安装 Twinmotion（个人免费版即可）
- [ ] 新建空项目：Home 模板或 Empty 均可（**不要**用带大量自带家具的样板间模板，减少干扰）
- [ ] 单位确认：Edit > Preferences > Settings，确认 Metric（glb 是米制）

## 2. 首轮导入（验证几何与命名，约 15 min）

- [ ] Import > 选择 `house-20260812.glb`，Import options 里 **Keep hierarchy** 勾选（保节点树，reimport 匹配的前提）
- [ ] 导入后 Scene Graph 面板抽查节点名：
  - [ ] `floor:living_dining`、`wall:living_dining:N` 这类带冒号的名字**原样保留**（若被改名/合并，直接判失败 → 走 spec 风险 3 的 OBJ 退化预案）
  - [ ] 家具有独立组节点 `furniture:...`
  - [ ] 天花存在（本地运行时隐藏，glb 里应有，如 `ceiling:living_dining`、`ceiling_living`）
- [ ] 尺寸核对：选中客厅地面 `floor:living_dining`，看 bounding box ≈ 6.2 × 5.5 m（东西×南北；以 model-geometry 为准），整屋外框 ≈ 16.5 × 10 m
- [ ] 朝向核对：玻璃幕 `west_curtain` 应在模型西侧；在 Twinmotion 里开 Location/太阳，设南宁（22.82°N, 108.37°E），8 月 17:30，确认西晒光从 `west_curtain` 一侧进来
- [ ] 目测完整性走查（对照 dressing-map §2/§4）：
  - [ ] 家具 29 组在各自房间
  - [ ] 玻璃幕 5 段 + 飘窗 9 处 + 栏杆 2 段
  - [ ] 门 9 扇（含推拉门 `sliding_door:*`）
  - [ ] 窗帘布料体块在位（sheer/blackout 两组/处）

## 3. 材质替换试验（reimport 的前置操作，约 10 min）

挑两个代表性面做替换，**记住替换了哪些节点**：

- [ ] 试验 A：`floor:living_dining` → 替换为 Twinmotion 库里的木地板材质（对照 dressing-map §1：浅胡桃 #c49a6c 直铺）
- [ ] 试验 B：`west_curtain` → 替换为玻璃材质（Low-E 微反方向）
- [ ] 可选试验 C：某件家具（如 `furniture:living_dining:sofa_3seat:0`）整体替换为库沙发模型
- [ ] 记录：被替换节点的确切名字、所用 Twinmotion 资产名

## 4. reimport 验收（核心，约 10 min）

- [ ] Scene Graph 选中导入的 glb 根节点（或 Import 面板）→ **Reimport**，选择 `house-v2.glb`
- [ ] 检查结果：
  - [ ] **PASS 判据**：试验 A/B（/C）的材质/模型替换**保留**；本地改的那处颜色变化**生效**（几何/颜色更新但覆盖不丢）
  - [ ] 节点数与层级无异常膨胀（旧节点被替换而非新增一份）
- [ ] FAIL 分支处理：
  - [ ] 若材质覆盖丢失 → 查 Twinmotion reimport 的 "material override by name" 选项/版本差异，重试一次
  - [ ] 仍失败 → 判 glTF 路线不通，切 spec 风险 3 预案：本地退化导出 OBJ（仅几何）+ dressing-map 全手动装扮；在 decision-log 记一条 DEC

## 5. 氛围工况快照（验收附带产出，约 15 min）

- [ ] 工况 A：8 月 17:30 西晒，客厅视角看 `west_curtain` 掠射光，截屏
- [ ] 工况 B：20:00 夜景，按 dressing-map §3 摆 14 个光源（3000K，厨卫 4000K），客餐厅视角截屏
- [ ] 两张快照传回本地 `docs/` 或会话存档，作为风格试探基线（与 AI 静帧路线互补）

## 6. 收尾

- [ ] 验收结论（PASS/FAIL + Twinmotion 版本号 + 云 GPU 型号）记入 `docs/decision-log.json` 或当日会话总结
- [ ] spec `2026-08-12-gltf-export-twinmotion-pipeline.md` 验收标准 3 标记完成
- [ ] 若 PASS：上云节奏正式定为"几何冻结后定妆"；若 FAIL：按 4 的 FAIL 分支走

## 速查：PASS/FAIL 判据

| 项 | PASS | FAIL |
|---|---|---|
| 节点名 | 冒号名原样保留 | 被改名/拍平 |
| 尺寸 | 整屋 ≈16.5×10 m，米制 | 比例错（常见 mm/m 差 1000 倍） |
| reimport | 材质覆盖保留 + 新改动生效 | 覆盖丢失或节点重复 |
| 天花/门/家具 | 全部在位 | 缺类（回溯检查本地导出收集规则） |
