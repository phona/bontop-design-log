# 3D 天花板 + 空调内机可视化计划

> 日期：2026-08-01
> 来源：陪跑巡场发现"3D 模型缺天花板"
> 状态：待批准执行（与 high-priority-fixes 计划独立，可分别执行）

## 背景

核查确认 `HouseScene.createRoom`（app/src/render/HouseScene.ts:532）只建地板 + 4 面墙，**无天花板 mesh**：
- `'顶面'` 仅是 objectDisplayName 的显示标签（:1494），无对应几何
- see-through（W 键）切墙/家具/电气/网格，无天花板可切
- `ceiling.yaml` 只被标注系统消费（AnnotationRenderer 画吊顶区域指示器 + AC ❄ 图标），不生成吊顶几何

**空调内机已有图标式可视化**：AnnotationRenderer 从 `/api/annotations/ceiling` 取 `ac_indoor`，渲染 ❄ 图标（标注层，可 setVisible 切换）。缺的是实体天花板平面；空调内机"3D 嵌吊顶"为可选增强。

影响：第一人称抬头看是空的；空调内机/灯具/吊顶造型无视觉载体；层高空间感不完整。

## 已定设计决策（2026-08-01）

- **天花板可见性 = 分模式自动**：第一人称自动显示，轨道/俯视自动隐藏（无需手动）
- **空调内机 = 保留现有 ❄ 图标标注层**，本次不做 3D 嵌吊顶内机（方案 B 移除，留后续）

## 方案 A：分模式天花板

每房加顶面 mesh，第一人称显示、俯视/轨道默认隐藏，兼顾沉浸漫游与 dollhouse 俯视。

### A1. createRoom 加天花板 mesh
`app/src/render/HouseScene.ts`：
- 新增字段 `private ceilingMeshes: THREE.Mesh[] = []`
- createRoom 中地板之后加顶面：几何同 floor（ShapeGeometry 圆角 / PlaneGeometry），`rotation.x = Math.PI/2`，`position.y = r.height`，材质 MeshStandardMaterial 浅色（如 0xf5f5f5，roughness 0.9，可双面 side: THREE.DoubleSide 防第一人称看穿）
- `userData = { roomId, objectId: \`ceiling:${r.id}\`, type: 'ceiling' }`，push 到 ceilingMeshes，group.add

### A2. 分模式可见性
- `setMode`（:1483）增：first-person → 天花板 visible=true；orbit/top-down → visible=false
- 新增 `setCeilingVisible(visible)` 公开方法（供 UI/see-through 调用）
- 初始 orbit 模式天花板隐藏（保持现有俯视体验）

### A3. captureFloorPlan 隐藏天花板
`captureFloorPlan`（:183）俯拍前隐藏 ceilingMeshes，finally 恢复（同 furnitureMeshes 模式），避免俯拍被顶面遮挡

## 测试与验证

- app vitest：天花板 mesh 生成（每房 1 个 ceiling）、setMode 切换可见性、captureFloorPlan 隐藏天花板
- `cd app && npx vitest run` + `npm run typecheck`
- 手动验证（视觉效果难自动测）：`npm run dev` 浏览器
  - orbit/俯视：天花板隐藏（dollhouse 不变）
  - 第一人称：抬头见天花板 + ❄ 空调图标
  - 俯拍平面图（captureFloorPlan）不被顶面遮挡

## 风险

| 风险 | 缓解 |
|---|---|
| 天花板挡俯视 | 分模式隐藏，orbit/top-down 默认关 |
| 第一人称穿天花板/看穿 | 相机高度 < 层高；材质 DoubleSide |
| 圆角房间天花板形状 | 复用 buildRoundedShape（与地板同逻辑） |
| 性能 | 天花板为简单平面，每房 +1 mesh，可忽略 |

## 执行顺序

A1（建 mesh）→ A2（模式可见性）→ A3（俯拍隐藏）→ 测试 → 手动验证。方案 B 视需求另排。

## 与 high-priority-fixes 的关系

两计划独立：high-priority-fixes 改 config（电气/家具），本计划改 app 渲染。可分别执行，无冲突。建议先 high-priority-fixes（数据正确性），再本计划（视觉增强）。
