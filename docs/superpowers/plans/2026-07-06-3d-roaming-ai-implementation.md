# 3D 装修漫游 + AI 协同设计系统 — 实施计划与状态

## 目标

完成和萃 701 的 3D 装修方案漫游器，并接入 OpenCode MCP，实现“App 可视化 + MCP 原子接口 + OpenCode 推理”的三层架构。

---

## 已交付（本次）

### 1. 项目骨架

- TypeScript 全项目：`tsconfig.json`（Node/MCP）+ `app/tsconfig.json`（Vite 前端）。
- `shared/types.ts` + `shared/houseData.ts`：浏览器与 Node.js 共用的类型与户型/HVAC 常量。
- `app/vite.config.ts`：含 `state-file-bridge` 插件，暴露 `/__state/snapshot` 与 `/__state/commands` 文件桥接端点。

### 2. App（漫游系统）

| 文件 | 职责 |
|------|------|
| `app/src/main.ts` | 入口 |
| `app/src/App.ts` | 容器：场景、StateManager、UI 协调 |
| `app/src/state/StateManager.ts` | 维护选择、写 snapshot、轮询 commands |
| `app/src/render/HouseScene.ts` | Three.js 户型、墙体、房间、平台、相机 |
| `app/src/render/ObjectFactory.ts` | HVAC 室内外机 3D 对象工厂 |
| `app/src/topics/TopicRegistry.ts` | 话题注册中心 |
| `app/src/topics/HvacTopic.ts` | 空调方案可视化与平台校验 |
| `app/src/topics/FloorTopic.ts` | 地砖方案 |
| `app/src/topics/WallTopic.ts` | 墙砖方案 |
| `app/src/topics/PaintTopic.ts` | 乳胶漆方案 |
| `app/src/ui/SchemePanel.ts` | 左侧话题/选项面板 |
| `app/src/data/designData.ts` | 从 `config/materials.yaml` 解析材料选项 |

### 3. MCP Server

| 文件 | 职责 |
|------|------|
| `mcp-server/mcp-server.ts` | MCP 入口，注册 14 个工具 |
| `mcp-server/tools/queryTools.ts` | 查询类工具 |
| `mcp-server/tools/actionTools.ts` | 操作类工具（写 commands.json） |
| `mcp-server/designData.ts` | 从 YAML 读取材料/户型数据 |

工具清单：

- 查询：`list_topics`、`list_options`、`get_option_details`、`get_current_selections`、`get_room_details`、`get_camera_state`、`list_visible_objects`、`get_design_rules`、`get_budget`
- 操作：`set_selection`、`batch_set_selections`、`set_camera_target`、`highlight_object`、`run_design_check`

### 4. 配置

- `opencode.json` 已配置本地 MCP server。
- `package.json` 脚本：`mcp`、`dev:app`、`build:app`、`typecheck`。

---

## 验证结果

- `npm run typecheck` ✅ 通过
- `npm run build:app` ✅ 通过
- `npm run mcp` ✅ 可启动
- `npm run dev:app` ✅ Vite 启动，页面可访问
- `scripts/test-mcp-client.mjs` ✅ 调用 `list_topics`、`list_options`、`set_selection` 成功

---

## 待扩展（后续迭代）

1. **第一人称漫游**：在 `HouseScene` 中增加 PointerLockControls/WASD 移动，切换 `snapshot.mode`。
2. **窗帘话题**：读取 `config/house.yaml` 的 `curtains` 配置，在窗洞位置渲染窗帘盒/帘布。
3. **卫浴/橱柜/灯具话题**：分别对应 `sanitary_*`、`cabinet_*`、`lighting_*` 材料，在场景中摆放简易洁具、橱柜、灯具模型。
4. **预算实时联动**：把 `config/budget/base.json` 与材料/HVAC 选择关联，计算当前总预算。
5. **AI 自动优化预设**：MCP 增加 `suggest_improvements` 工具，基于规则给出选择建议。
6. **更精细户型**：根据 CAD 尺寸优化房间坐标与门窗开口。

---

## 运行方式

```bash
# 1. 启动 3D 漫游器
npm run dev:app
# 浏览器打开 http://localhost:5173

# 2. 启动 MCP server（OpenCode 会自动调用）
npm run mcp

# 3. 类型检查
npm run typecheck

# 4. 生产构建
npm run build:app
```

---

## 数据流

```text
[用户点击 UI 选项]
    ↓
[StateManager] → POST /__state/snapshot
    ↓
[OpenCode 终端] → MCP tools → commands.json
    ↓
[App 轮询 GET /__state/commands] → 应用命令 → Three.js 重绘
```
