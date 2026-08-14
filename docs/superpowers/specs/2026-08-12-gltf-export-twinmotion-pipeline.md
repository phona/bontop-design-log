# glTF 导出与 Twinmotion 云渲染管线设计（真实感渲染上游桥）

日期：2026-08-12
状态：待审定
触发：3D 预览真实感差距确认（业主走查反馈"跟真实区别挺大"）；本地 780M 负责快速迭代、云电脑（4070–4090 可租）负责效果确认的"小步快跑"分工已明确；需要一个从声明式底座到游戏引擎/渲染器的单向桥

## 背景与定位

- **架构铁律合规**：model-geometry.yaml 仍是唯一权威源；本 spec 只做**单向导出**（Three.js 场景 → glb），引擎场景是下游一次性美术资产，不回写、不同步、不双写
- **分工**：本地笔记本（Radeon 780M）跑 Three.js 快循环（布局/动线/A/B/灯光节奏）；云电脑跑 Twinmotion 慢循环（材质真实感/氛围/定妆）。上云触发条件：待决策 12 项中影响视觉的项拍板（几何冻结）
- **AI 静帧路线保留**：3D 截图 + img2img 用于快速风格试探，与本管线互补

## 目标 / 非目标

**目标**：
- app 内一键导出 house.glb：几何/地面/玻璃幕/家具体块完整，节点名 = objectId（Twinmotion reimport 材质不丢的关键）
- 自动生成《装扮映射表》：从 materials.yaml / electrical.yaml / furnishings 直接生成，杜绝手工抄数
- 本地方便验证：glb 可导入 Blender 检查（尺寸/命名/完整性）

**非目标**：
- 不做 Twinmotion/Blender 场景搭建本身（云端手工美术活，spec 外）
- 不做双向同步、不做引擎内编辑回读
- 不导出：辅助网格/标注/电气水管标记/太阳圆盘/相机路径（美术噪声）
- 不追求导出材质的最终质感（Twinmotion 里会整体替换；程序化贴图随 glb 嵌入仅作打底）

## 变更清单

### 1. app/src/render/export-gltf.ts（新文件）

```ts
export function collectExportSet(root: THREE.Object3D): THREE.Object3D[]
export async function exportSceneToGlb(scene: THREE.Scene): Promise<Blob>
```

- **收集规则**（collectExportSet，纯函数可测）：
  - 纳入（`userData.type` ∈ 集合，Group 整体纳入）：`floor`, `ceiling`, `ceiling_zone`, `ceiling_zone_solid`, `wall`, `curtain_run`, `curtain`（窗帘布料 sheer/blackout/blinds，Twinmotion 可替换布料材质）, `glass_infill`, `bay_sill`, `railing_run`, `sliding_door_run`, `sliding_door`, `door`（门扇/门框，真实几何不可漏）, `floor_region`, `furniture`（家具/fixture 体块组，HouseScene.ts 统一标记 `type: 'furniture'`）
  - 排除（`userData.type` ∈ 集合）：`annotation`, `electrical`, `plumbing`, `platform`, `highlight_object`
  - 排除（无 type，按类/命名）：gridHelper、标签 sprite、太阳轨迹/圆盘、hover 高亮、相机辅助
  - 判定依据 `userData.type` / `userData.objectId`（现有约定，HouseScene.ts:1373 家具组、:1408 电气、:1419 水管、CeilingZoneBuilder.ts:68 吊顶组）
- **命名稳定**：导出前把 `userData.objectId` 写入 `mesh.name`（GLTFExporter 序列化 name；Twinmotion reimport 按名字匹配材质覆盖）。临时赋值、导出后恢复，不污染运行态
- **天花处理**：天花网格运行时 mode 隐藏；导出时强制纳入（glTF 保留 visible 标记，Twinmotion 里可再隐藏；室内渲染需要天花挂灯）
- 用 THREE.GLTFExporter（three/examples），binary: true，embedImages: true

### 2. app/src/App.ts — 导出入口

- 选材/方案面板加一个"导出 glb（云渲染用）"按钮；点击 → exportSceneToGlb → 下载 `house-YYYYMMDD.glb`
- 导出前若有未应用的选择，按当前 scheme 状态导出（所见即所得）

### 3. scripts/generate-dressing-map.ts（新文件）→ docs/dressing-map.md

从底座直接生成装扮映射表（npm run 脚本，输出 markdown）：

| 内容块 | 数据源 |
|---|---|
| 房间/地面材料 → Twinmotion 材质替换建议 | materials.yaml appearance + selections（含色号、人字拼与否） |
| 家具体块清单（类型/尺寸/坐标/朝向）→ 库家具替换参照 | house.yaml furnishings + FURNITURE_DIMS |
| 灯光点位（坐标/类型/色温，数量由 electrical.yaml 派生）→ 灯具与光源摆放单 | electrical.yaml |
| 玻璃幕/飘窗清单 → 玻璃材质（Low-E 微反） | overlay.yaml |
| 太阳定位参数 | environment.yaml（南宁 22.8°N，建议 8 月 17:30 西晒工况 + 20:00 夜景） |

### 4. package.json

- `export:dressing-map`: tsx scripts/generate-dressing-map.ts

## 测试

- **export-gltf.test.ts**：collectExportSet 纯函数测试——给定构造的 scene 树（带各 userData.type），断言纳入/排除集合与命名映射正确；不实例化 HouseScene（DOM 依赖重）
- 既有测试不变红；`npm run test:app && npm run verify:all && npm run typecheck`

## 验收标准

1. app 内导出 house.glb 成功，Blender 导入后：总长宽与 model-geometry 一致（米制）、节点名为 objectId、家具体块在位
2. docs/dressing-map.md 生成，灯光点位含坐标与色温且**数量与 electrical.yaml 派生一致**（不硬编码）、家具尺寸表、材质色号表
3. Twinmotion 导入 glb → 替换某房间地面材质 → reimport 同名新 glb → 材质覆盖保留（云端手动验收）

## 风险与边界

1. **reimport 材质保持依赖节点名稳定**——objectId 生成规则若变（如 DEC 改布局增删墙），新增节点丢材质属预期，删除节点的材质覆盖孤立；校订：每次上云前重新生成 dressing-map 对照
2. 程序化贴图嵌入 glb 会使文件偏大（1024² 若干张）——可接受（<20MB），Twinmotion 替换后不保留
3. Twinmotion 对 glTF 实例化/多层材质的兼容细节未实测——Phase 1 第一件事就是导入验证，不行则退化 OBJ（几何）+ dressing-map 手动
4. 云端装扮技能的获得成本在业主侧（1–3 天）；外包备选：glb + dressing-map.md 可直接移交效果图工作室

## 工作量与顺序

约 0.5–1 天：collectExportSet + 测试（2h）→ GLTFExporter 接入 + 按钮（1h）→ dressing-map 生成脚本（2h）→ Blender 导入验收 + 文档收尾（1h）。
