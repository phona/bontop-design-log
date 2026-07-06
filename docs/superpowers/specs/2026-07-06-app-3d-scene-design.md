# Spec 2：App 3D 场景 + 基础漫游

> **目标**：在浏览器中渲染 3D 户型，支持轨道相机、方案切换、物体选中和 view-context 上报。
> 
> **依赖**：Spec 1（后端数据底座 + Remote MCP）

---

## 1. 范围

### 包含

- Three.js 3D 场景初始化
- 户型渲染：房间、墙体、平台、门窗
- HVAC 方案渲染：外机、内机（吊顶/壁挂/柜机）
- 轨道相机控制
- 方案切换 UI 面板
- 物体选中（鼠标点击）
- view-context 自动上报
- 基础信息面板

### 不包含

- 第一人称漫游（Spec 3）
- 第一人称碰撞检测（Spec 3）
- 准心和物体悬停提示（Spec 3）
- 预算/风险/归档（Spec 4）
- 窗帘/软装渲染

---

## 2. App 架构

```text
┌─────────────────────────────┐
│           App               │
│  ┌─────────┐ ┌───────────┐ │
│  │ UI 面板  │ │ StateSync │ │
│  └────┬────┘ └─────┬─────┘ │
│       └─────────────┘       │
│              │              │
│       ┌──────┴──────┐       │
│       ↓             ↓       │
│  HouseScene    TopicRegistry │
│  （Three.js）   （渲染逻辑）  │
└─────────────────────────────┘
```

### 2.1 HouseScene

职责：

- 初始化 Three.js scene、camera、renderer、lights
- 根据 `ProjectCatalog` 创建房间、墙体、平台
- 根据 `CurrentScheme` 渲染 HVAC 设备
- 提供 `setSelection(topic, optionId)`
- 提供 `highlightObject(objectId)`
- 提供 `setCameraTarget(targetId)`
- 处理鼠标点击选中物体

### 2.2 TopicRegistry

注册各话题的渲染逻辑：

- `HvacTopic`：渲染外机、内机
- `FloorTopic`：改变地面材质颜色
- `WallTopic`：改变厨卫墙面材质颜色
- `PaintTopic`：改变房间墙面颜色

新增话题只需注册新的 Topic，不改核心代码。

### 2.3 StateSync

- 启动时 `GET /api/scheme/current`
- 每 1 秒轮询 `/api/scheme/current`
- 用户切换方案时 `PATCH /api/scheme/current`
- 500ms 轮询 `GET /api/visual-commands`
- 执行视觉命令后 `POST /api/visual-commands/ack`
- 选中物体时 `POST /api/view-context`
- 后端不可用时：
  - 每个 poller 独立维护退避状态：scheme poller 与 visual-command poller 互不干扰
  - 轮询失败采用指数退避：1s → 2s → 4s，最大 8s
  - UI 显示离线提示，禁用修改操作但保留当前 3D 场景
  - 后端恢复后回到 1s / 500ms 轮询
- 相机移动动画：
  - `set_camera_target` 默认使用 0.5s 平滑过渡（lerp）
  - 模式切换和视觉命令都复用同一相机动画器
  - 用户主动操作（拖拽、WASD、`V` 键）立即打断动画

---

## 3. 3D 场景

### 3.1 房间渲染

每个房间渲染为：

- 地面：PlaneGeometry，半透明边界
- 四面墙：BoxGeometry，可单独设置材质
- 门/窗：用半透明色块标记开口位置

房间类型颜色：

- `public`：偏暖灰
- `private`：偏冷灰
- `service`：偏浅蓝

### 3.2 HVAC 渲染

外机：

- 位置：西设备平台或入户花园（根据方案）
- 尺寸：来自 `shared/houseData.ts`
- 颜色：紫色

内机：

- 吊顶机：天花板上方的扁平盒体，青色
- 壁挂机：墙面上的盒体，橙色
- 柜机：地面上的立式盒体，红色

### 3.3 对象 ID

所有可交互对象都带 `userData.objectId`：

- 房间：`room:{roomId}`
- 外机：`hvac:outdoor:{hvacSchemeId}:{index}`
- 内机：`hvac:indoor:{hvacSchemeId}:{roomId}`
- 地面：`floor:{roomId}`
- 墙面：`wall:{roomId}:{direction}`，方向统一取户型坐标轴对应的 **指南针方向**：`north|south|east|west`
  - 坐标约定：x 正方向为 `east`，x 负方向为 `west`，z 正方向为 `south`，z 负方向为 `north`
  - 例如 `wall:master_bedroom:east`
  - 贴砖/刷漆以单面墙为最小操作单位，因此必须带方向
  - 如果某面墙在户型数据中不存在，则该 objectId 不渲染、不可交互

---

## 4. UI 面板

### 4.1 方案切换面板

左侧固定面板：

- 话题标签页：HVAC / 地砖 / 墙砖 / 乳胶漆
- 每个话题下显示选项按钮
- 当前选项高亮
- 显示选项名称、描述、价格

**注意**：左侧方案切换面板仅设置话题的 **全局默认值**，不涉及按房间覆盖。按房间的覆盖值将在 Spec 3 的物体信息面板中处理。

### 4.2 信息面板

选中物体后弹出（或固定显示）：

- 对象名称和类型
- 影响该对象的话题
- 当前选择

Spec 2 阶段信息面板可以只显示名称和类型，详细决策信息在 Spec 3 补充。

---

## 5. 数据流

### 5.1 启动

```text
App 启动
  → GET /api/project（加载户型和选项）
  → GET /api/scheme/current（加载当前方案）
  → HouseScene 渲染
```

### 5.2 用户切换方案

```text
用户点击选项
  → StateSync PATCH /api/scheme/current
  → 后端更新 CurrentScheme 和 DecisionLog
  → StateSync 收到响应
  → TopicRegistry 重新渲染对应话题
```

### 5.3 选中物体

```text
用户点击 3D 物体
  → HouseScene 获取 objectId
  → StateSync POST /api/view-context
  → UI 信息面板更新
```

### 5.4 AI 下发视觉命令

```text
OpenCode 调用 set_camera_target / highlight_object
  → 后端写入 visual command 队列（带 expiresAt）
  → StateSync 500ms 轮询 GET /api/visual-commands
  → HouseScene 执行相机移动或高亮
  → StateSync POST /api/visual-commands/ack
```

---

## 6. Vite 配置

`app/vite.config.ts`：

- 删除旧的文件桥接插件
- `app/src/data/designData.ts` 已在 Spec 1 清理阶段删除；Spec 2 不再直接加载配置，全部通过 `/api/project` 获取
- 添加 proxy：
  - `/api` → `http://localhost:3000`
  - `/mcp` → `http://localhost:3000`
  - `/sse` → `http://localhost:3000`
- 添加 `@shared` 别名

---

## 7. 开发工作流

```bash
# 终端 1
npm run dev:server

# 终端 2
npm run dev:app

# 终端 3（可选）
opencode
```

---

## 8. 验收标准

- `npm run typecheck` 无错误
- `npm run dev:app` 成功启动
- 浏览器看到 3D 户型和房间
- 切换 HVAC 方案，外机/内机正确更新
- 切换地砖/墙砖/乳胶漆方案，材质颜色正确更新
- 点击物体，UI 显示物体信息
- 选中物体时，后端 `/api/view-context` 更新
- AI 调用 `set_camera_target` 后，App 相机移动到目标

---

## 9. 非目标

- 第一人称漫游
- 碰撞检测
- 准心悬停提示
- 物体信息面板的详细决策/成本/风险
- 预算/归档
