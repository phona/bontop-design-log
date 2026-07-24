# 和萃 701 — 可视化增强

> 户型基线已定，进入细化阶段。本文档为 Phase 1（可视化增强）的设计 spec。
>
> 后续子项目分别在独立 spec 中处理：
> - Phase 2: AI Design Advisor（已有 spec，已实现，跳过）
> - Phase 3: 点位配置与3D可视化（见 `2026-07-23-electrical-plumbing-ceiling-design.md`）
> - Phase 4: 采购监理系统（见 `2026-07-23-procurement-supervision-design.md`）
>
> **标注名：** 所有房间显示名称从 `model-geometry.yaml` 的 `rooms[].name` 读取，不改代码只改配置。

---

## 一、架构

HouseScene.ts 瘦身，按功能拆出独立 Manager：

```
app/src/render/
├── HouseScene.ts          ← 编排逻辑，调用 Manager 接口
├── TextureManager.ts      ← NEW: 纹理加载/缓存/应用
├── EnvironmentManager.ts  ← NEW: 程序化环境光/IBL/阴影
├── AnalysisTools.ts       ← NEW: 测量/透墙/碰撞高亮
├── TextureFactory.ts      ← 保留(退化 fallback)
├── FurnitureFactory.ts    ← 不变
└── ObjectFactory.ts       ← 不变
```

**原则：** 每个 Manager 负责一类资源，HouseScene 只调用接口，不碰细节，实现替换不影响调用方。

---

## 二、TextureManager

### 方案

增强现有程序化纹理，零外部素材依赖：

| 类型 | 现在 | 增强后 |
|------|------|--------|
| 木纹 | 水平条纹+噪点 | 年轮/节疤模拟，支持橡木/胡桃/樱桃等 |
| 瓷砖 | 方格线 | 工字/人字/六角拼法，可配置规格 |
| 涂料 | 纯色噪点 | 哑光/蛋壳光/肌理漆质感 |
| 石材 | 不支持 | 仿大理石纹、水磨石颗粒（新增） |

程序化生成法线贴图（从高度图算出），让材质有立体感。

### 接口

```typescript
class TextureManager {
  async preload(): Promise<void>
  getMaterial(appearanceId: string): THREE.MeshStandardMaterial
  applyToRoom(roomId: string, appearanceId: string): void
}
```

- `preload()` — 初始化时异步加载所有配置纹理，结果缓存到 `Map<string, THREE.Texture>`
- 加载失败 → 降级到现有 `TextureFactory` 程序化纹理，不中断渲染
- 方案切换：`applySchemeTextures()` 内部调用 `textureManager.applyToRoom(roomId, option.data.appearance.id)` — topic → appearance 映射由调用方完成，TextureManager 只负责 roomId + appearanceId 到材质的转换

---

## 三、EnvironmentManager

### 方案

| 层次 | 内容 | 说明 |
|------|------|------|
| 天空球+IBL | 程序化梯度环境贴图（天蓝→地平线白→地灰） | 玻璃/金属自动反射天空，不依赖 HDR 文件 |
| 阴影 | PCF → PCFSoftShadowMap | 加 bias 调优，消除阴影痤疮 |
| 太阳角度 | 主光源角度对应实际太阳位置（东南→西南绕行） | 可直观评估西晒等效果 |

### 接口

```typescript
class EnvironmentManager {
  setup(roomCenter: THREE.Vector3): void
  setTimeOfDay(hour: number): void          // 0-24，调色温/角度
  toggleIBL(enabled: boolean): void
  getLighting(): LightingState
}
```

### 不做

- 动态时间流逝动画
- 多光源系统（点光源/聚光灯）
- 后处理（Bloom/SSAO/Bokeh） — 留到营销级渲染阶段

---

## 四、AnalysisTools

三个工具，统一在 `AnalysisTools.ts` 中：

### 4.1 激光测量

**俯视图模式：**
- 鼠标悬停 → 显示光标坐标 `(X: 3.20, Z: 8.50)`（model-geometry 局部坐标系，米）
- 点击 A → 拉线到 B → 显示距离 `3.45m`
- 继续点击 C → 显示累计 `AB + BC = 6.72m`
- 右键/Esc 退出

**第一人称模式：**
- 调出工具栏选「测量」
- 准星变十字光标
- 左键打点 A → 移到 B 打点 → 显示距离
- 插参考平面在起始点高度（解决人眼深度差问题）

**结果面板：**
```
┌────────────────────────────┐
│ 📏  3.45m (E-W:2.1m N-S:2.75m) │
│ A → B                        │
│ [清除] [保存到日志]            │
└────────────────────────────┘
```

### 4.2 透墙模式

- 快捷键 `W` 切换
- 非承重墙透明度 → 0.15
- 结构柱/剪力墙保持不透明（以 model-geometry.yaml wall type 区分）
- 俯视图默认启用透墙模式，用户可手动关闭

### 4.3 碰撞高亮

- 家具超房间边界 → 红色 emissive 脉冲动画
- 测量线穿透墙体 → 穿墙段变红
- 结合现有 `CollisionDetector`（AABB 检测），冲突处红色标记

### 技术实现

- 测量线用 `LineBasicMaterial` + 虚线风格
- Raycaster 拾取坐标
- 结果通过浮动 DOM 面板显示（不影响 3D 场景）
- 保存的测量写入 `audit/measurements.log`

---

## 五、测试

| 测试 | 方式 |
|------|------|
| TextureManager | 单元测试：加载失败降级、缓存命中 |
| EnvironmentManager | 视觉验收：对比前后截图 |
| AnalysisTools | 集成测试：模拟打点测量、碰撞检测 |
| 回归 | `npm run test:server` `npm run typecheck` |
