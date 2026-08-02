# 窗帘设计计划（3D 可视化 + CurtainTopic + 明细文档）

> 日期：2026-08-02
> 来源：用户"忘了窗帘设计"
> 状态：待批准执行

## 背景

窗帘"数据"已在 config（house.yaml 6 房间需求、4 处电动电源、curtain_01 材料、curtain_set 摆位、预算 4000），但缺两块：
1. **3D 无窗帘**：`curtain_run` 是玻璃幕墙（glass curtain wall），不是窗帘；TopicRegistry 无 CurtainTopic；第一人称看玻璃幕是光玻璃
2. **细节设计缺失**：各房间尺寸/安装方式/电动划分/厨卫百叶规格/工程量清单都没有

用户选定：**两者都要**；3D 样式 = **纱帘+遮光帘**（厨卫百叶）。

技术基础：`curtain_run` 元素（points/height）经 `projectData.house.sceneElements` 流入 HouseScene.renderCurtainRun 渲染玻璃。窗帘 mesh 可挂玻璃内侧 offset ~0.12m。

---

## Part A：3D 窗帘可视化 + CurtainTopic

### A1. 窗帘数据（房间映射）
`config/layout/overlay.yaml` 增 `curtains` 段：每条 `{id, run: <curtain_run id>, room, kind: sheer_blackout|blinds}`，把玻璃幕段关联到房间与窗帘类型。
- 湿区（kitchen/master_bath/guest_bath）→ blinds；其余 → sheer_blackout
- 房间映射可手填，或由 curtain_run 中点 + 房间 bbox 自动推导（spawn-utils findRoomAt 逻辑）

### A2. HouseScene 窗帘 mesh
- 新增 `curtainMeshes: { sheer: Mesh[]; blackout: Mesh[]; blinds: Mesh[] }`
- 渲染玻璃幕后，按 overlay curtains 在玻璃内侧（offset ~0.12m）生成：
  - **纱帘 sheer**：半透明白色平面（opacity ~0.35，DoubleSide），落地（0.1→height-0.1）
  - **遮光帘 blackout**：不透明深色平面（默认闭合或开启，见 A4）
  - **百叶 blinds**：简化横条/半透明，湿区用
- 直段用 PlaneGeometry，弧段用 ExtrudeGeometry（复用 buildCurtainShape）
- userData `{type:'curtain', roomId, layer}`

### A3. 新建 CurtainTopic（选材切换）
`app/src/topics/CurtainTopic.ts`：
- id='curtain'，options 来自 materials curtain topic
- apply(scene, optionId)：按外观（color/opacity）更新所有窗帘 mesh 材质
- TopicRegistry 注册

### A4. 遮光帘开合切换
- HouseScene 增 `toggleBlackout()`：遮光帘 mesh visible 切换（开=收拢隐藏/合=展开）
- 绑定按键或 UI 按钮（复用 mode-key-policy 或 CommandPalette）

### A5. 材料选项扩展
`config/materials.yaml` curtain topic 增 2-3 个选项（curtain_01 雪尼尔遮光+幻影纱 / curtain_motor 电动版 / curtain_blind 百叶），供 CurtainTopic 切换。同步 procurement。

## Part B：窗帘明细设计文档

新建 `docs/curtain-design.md`：
- 各房间表：位置（关联玻璃幕/飘窗）、窗帘类型、估算尺寸（宽=玻璃段长、高=层高-0.1）、安装方式（窗帘盒/罗马杆）、电动与否（对应 electrical 4 电源）、面料
- 厨卫防水百叶规格
- 工程量清单 + 与预算 curtains 科（4000）对照
- 安装节点：窗帘盒预留尺寸、电动电源位置复核

## 验证

- app vitest（CurtainTopic 测试：options/apply 更新材质）+ typecheck
- verify:all（overlay 改动不破坏拓扑/碰撞）
- 手动：`npm run dev` 浏览器——第一人称见纱帘+遮光帘、CurtainTopic 切换、开合切换、厨卫百叶

## 风险

| 风险 | 缓解 |
|---|---|
| 弧段玻璃窗帘几何复杂 | V1 直段 PlaneGeometry 为主，弧段 ExtrudeGeometry 复用现有 |
| 窗帘 mesh 与玻璃 Z-fighting | 内侧 offset 0.12m 拉开距离 |
| 房间映射出错 | 优先自动推导（中点+bbox），手填兜底 |
| 窗帘性能 | 简单平面，每玻璃段 +2 mesh，可忽略 |

## 执行顺序

A1（overlay curtains 数据）→ A2（HouseScene mesh）→ A3（CurtainTopic）→ A4（开合切换）→ A5（材料扩展）→ Part B（文档）→ 验证
