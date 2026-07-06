# Spec 1：后端数据底座 + Remote MCP

> **目标**：建立项目数据底座，让 OpenCode 通过 remote MCP 查询数据并修改装修方案。
> 
> **依赖**：无。这是整个系统的第一个子项目。

---

## 1. 范围

### 包含

- 后端服务进程，监听 `http://localhost:3000`
- 读取项目配置文件并构建内存数据底座
- 管理当前方案（`CurrentScheme`）和决策日志（`DecisionLog`）
- 暴露 REST API
- 暴露 Remote MCP 端点（同时支持 Streamable HTTP 和 SSE）
- 提供 MCP 查询和操作工具
- 清理旧代码：文件桥接 Vite 插件、stdio MCP、旧 snapshot.json/commands.json

### 不包含

- 3D 渲染
- 第一人称漫游
- 预算/风险计算（Spec 4 做）
- 归档/diff（Spec 4 做）
- 复杂规则引擎（Spec 4 做）

---

## 2. 当前状态与迁移

### 2.1 现有代码

当前项目已实现的旧系统：

- `app/vite.config.ts` 中的 `state-file-bridge` 插件
  - 暴露 `/__state/snapshot` 和 `/__state/commands`
  - 浏览器通过 Vite 后端读写 JSON 文件
- `mcp-server/mcp-server.ts` 及 `mcp-server/tools/`
  - stdio MCP server
  - OpenCode 通过 `opencode.json` 的 `type: "local"` 启动
- `app/.state/snapshot.json` 和 `app/.state/commands.json`
  - 旧版状态快照与命令文件
- 旧的 App 代码：
  - `app/src/state/StateManager.ts` 基于文件轮询
  - 旧 UI 面板只支持 HVAC 话题

### 2.2 迁移到新系统

Spec 1 完成后，应完成以下迁移：

1. 删除文件桥接插件
2. 删除 `mcp-server/` 旧目录
3. 删除 `app/.state/snapshot.json` 和 `app/.state/commands.json`
4. `opencode.json` 从 `type: "local"` 改为 `type: "remote"`
5. 删除旧 `app/src/state/StateManager.ts` 实现（Spec 2 将新建从 HTTP API 读写的版本）
6. App 从 `/api/scheme/current` 获取状态

### 2.3 MCP 工具迁移

| 旧工具（stdio MCP） | 新工具（remote MCP） |
|---------------------|----------------------|
| `get_app_state` | `get_current_scheme` + `get_view_context` |
| `get_house_config` | `get_project_summary` |
| `get_materials` | `list_topics` + `list_options` |
| `get_hvac_options` | `get_option_details(topic: "hvac", ...)` |
| `get_budget` | `get_budget`（Spec 4 提供） |

### 2.4 并发修改策略

`CurrentScheme` 采用 **last-write-wins**。

- 用户和 AI 都可以修改
- 每次修改生成 `DecisionLog` 条目
- `DecisionLog.source` 字段记录 `user` 或 `ai`
- 冲突时以最后一次写入为准，不阻止、不自动合并

---

## 3. 后端分层

```text
┌─────────────────────────────────────────┐
│           HTTP API / MCP                │
├─────────────────────────────────────────┤
│  ProjectCatalog  │  DesignState         │
│  （只读配置）     │  （可变状态）         │
├─────────────────────────────────────────┤
│           JSON 持久化                    │
└─────────────────────────────────────────┘
```

### 3.1 ProjectCatalog

从以下文件加载：

- `config/house.yaml` → 房屋、房间、平台、约束
- `config/materials.yaml` → 材料/HVAC 选项
- `config/layout/final.yaml` → 布局确认
- `budget/base.json` → 预算基线
- `shared/houseData.ts` → HVAC 方案详细定义（含数值化 `price_per_unit`）、户型坐标

在内存中提供：

- `getHouse()`
- `getRoom(id)`
- `getTopics()`
- `getOptions(topic)`
- `getOption(topic, optionId)`
- `getBudgetBase()`

### 3.2 DesignState

管理可变状态：

- `CurrentScheme`：当前选择
- `DecisionLog`：每次变更记录

持久化到：

- `data/current-scheme.json`
- `data/decision-log.json`

启动时加载；变更时立即写回。

### 3.3 数据文件格式

`data/current-scheme.json`：

```json
{
  "updatedAt": "2026-07-06T10:00:00Z",
  "selections": {
    "hvac": {
      "default": "A2",
      "roomOverrides": {}
    },
    "floor": {
      "default": "floor_tile_01",
      "roomOverrides": {
        "master_bedroom": "floor_tile_02"
      }
    },
    "wall": {
      "default": "wall_tile_01",
      "roomOverrides": {}
    },
    "paint": {
      "default": "latex_paint_01",
      "roomOverrides": {}
    }
  }
}
```

规则：

- 每个话题统一为 `{ default: optionId, roomOverrides: { roomId: optionId } }`
- 全局话题（如 `hvac`）的 `roomOverrides` 为空对象
- 可按房间的话题（如 `floor`、`wall`、`paint`）在 `roomOverrides` 中设置房间覆盖
- `roomOverrides` 必须存在（可为空对象），不允许省略

哪些话题支持 per-room 由 `config/design-rules.yaml` 的 `objectMapping` 决定。默认所有 `room:*` 映射的话题都支持 per-room。

`data/decision-log.json`：

```json
[
  {
    "id": "dec_001",
    "topic": "hvac",
    "roomId": null,
    "optionId": "A2",
    "previousOptionId": "A1",
    "archiveId": null,
    "path": "hvac.default",
    "reason": "A2 静音更好",
    "source": "user",
    "createdAt": "2026-07-06T10:00:00Z"
  },
  {
    "id": "dec_002",
    "topic": "floor",
    "roomId": "master_bedroom",
    "optionId": "floor_tile_02",
    "previousOptionId": "floor_tile_01",
    "archiveId": null,
    "path": "floor.roomOverrides.master_bedroom",
    "reason": "主卧想换深色",
    "source": "user",
    "createdAt": "2026-07-06T11:00:00Z"
  }
]
```

字段说明：

- `archiveId`：仅由归档恢复操作时填写，指向来源归档方案 ID
- `path`：变化路径，`topic.default` 或 `topic.roomOverrides.<roomId>`，便于 diff 和审计

`previousOptionId` 规则：

- 首次选择某个 topic/room 时，`previousOptionId` 为 `null`
- 清除 room override 时，`optionId` 为 `null`，`previousOptionId` 为被清除前的值
- 归档恢复时，为每个发生变化的路径生成一条记录，`archiveId` 填写来源归档 ID，`previousOptionId` 为当前值，`optionId` 为归档值

### 3.4 开发模式热重载

开发模式下，后端监听 `config/` 下的 YAML/JSON 文件变化：

- 使用 300ms debounce，避免频繁保存时重复加载
- 重新加载 `ProjectCatalog`
- 重新计算 derived 数据（如房间用量）
- `DesignState` 保持不变
- 解析失败时保持旧配置并输出错误

### 3.5 默认配置与初始状态

#### `config/design-rules.yaml`

Spec 1 创建默认文件：

```yaml
version: "1.0"

objectMapping:
  - pattern: "room:*"
    topics: [floor, wall, paint]
  - pattern: "hvac:*"
    topics: [hvac]

budget:
  baseCategoriesFrom: budget/base.json
  lineItems: []

risks: []
constraints: []
```

Spec 4 在此基础上补充预算公式、风险、约束规则。

#### 初始状态

如果 `data/current-scheme.json` 不存在：

- 每个话题默认选择 `ProjectCatalog` 中该话题的第一个选项（按 `config/materials.yaml` / `shared/houseData.ts` 中出现的顺序）
- 当前默认初始值示例：
  - `hvac.default` = 首个 HVAC 方案 ID（如 `A2`）
  - `floor.default` = 首个地砖材料 ID（如 `floor_tile_01`）
  - `wall.default` = 首个墙砖材料 ID（如 `wall_tile_01`）
  - `paint.default` = 首个乳胶漆材料 ID（如 `latex_paint_01`）
- 所有 `roomOverrides` 为空对象
- `updatedAt` 为当前时间

#### 输入校验

所有写入接口统一校验：

- `topic` 必须是 `ProjectCatalog` 中已注册的话题
- `optionId` 必须是该话题下存在的选项；仅当同时提供 `roomId` 时，才可传 `null` 以清除覆盖
- `roomId` 若提供，必须是 `house.yaml` 中存在的房间
- 校验失败返回 `400 Bad Request`，整体操作不生效，不静默忽略
- `batch_set_selections` 先校验全部条目，再统一应用

---

## 4. REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/project` | 项目摘要（房屋、话题、选项、约束） |
| GET | `/api/scheme/current` | 当前方案 |
| PATCH | `/api/scheme/current` | 更新当前方案（部分更新） |
| GET | `/api/decisions` | 决策日志 |
| POST | `/api/decisions` | 追加一条决策记录（不修改方案） |
| GET | `/api/topics` | 所有话题 |
| GET | `/api/topics/:id/options` | 话题下选项 |
| GET | `/api/topics/:id/options/:optionId` | 选项详情 |
| POST | `/api/view-context` | App 上报当前选中对象 |
| GET | `/api/view-context` | 查询当前选中对象 |
| GET | `/api/visual-commands` | 获取待执行的视觉命令 |
| POST | `/api/visual-commands` | 创建视觉命令（MCP 用） |
| POST | `/api/visual-commands/ack` | 确认视觉命令已执行 |

### 4.1 PATCH `/api/scheme/current`

请求体：

```json
{
  "selections": [
    { "topic": "hvac", "optionId": "A1" },
    { "topic": "floor", "optionId": "floor_tile_02", "roomId": "master_bedroom" },
    { "topic": "floor", "optionId": null, "roomId": "master_bedroom" }
  ],
  "reason": "预算更稳",
  "source": "user",
  "expectedUpdatedAt": "2026-07-06T10:00:00Z"
}
```

行为：

- 如果传了 `expectedUpdatedAt` 且与后端 `CurrentScheme.updatedAt` 不一致，返回 `409 Conflict`
- 合并到 `CurrentScheme`
- 如果 `roomId` 为 `null` 或省略：`optionId` 必须是非空字符串，修改该话题的 `default`
- 如果 `roomId` 指定且 `optionId` 非 `null`：设置该房间的 `roomOverrides`
- 如果 `roomId` 指定且 `optionId` 为 `null`：删除该房间的 `roomOverrides`
- `optionId` 为 `null` 但 `roomId` 未指定：非法，返回 `400 Bad Request`
- 同一 `selections` 数组内若出现重复的 `(topic, roomId)`，**后面的条目覆盖前面的条目**，只生成一条 `DecisionLog`
- 为每个变化生成 `DecisionLog` 条目
- `previousOptionId` 首次为 `null`
- 更新 `updatedAt` 并持久化

### 4.2 POST `/api/decisions`

用于记录决策理由，不修改当前方案。

请求体：

```json
{
  "topic": "hvac",
  "roomId": null,
  "optionId": "A2",
  "reason": "A2 静音更好，预算可控",
  "source": "ai"
}
```

行为：

- `topic`、`roomId`、`optionId` 均可选；至少提供一项与决策相关的信息，否则返回 `400`
- 若提供 `topic`，则必须是已注册话题；若同时提供 `optionId`，则必须是该话题下的有效选项
- 若提供 `roomId`，则必须是 `house.yaml` 中的有效房间
- `source` 可选，默认 `"ai"`
- 生成一条 `DecisionLog` 条目，`previousOptionId` 为 `null`，`archiveId` 为 `null`，`path` 由 `topic` 和 `roomId` 推导
- 返回 201 与生成的 `DecisionLog` 条目

### 4.3 `/api/visual-commands`

用于 AI 触发的高亮、切视角等视觉反馈。

#### 创建命令

`POST /api/visual-commands`

```json
{
  "commandId": "vc_20260706_120030_001",
  "type": "set_camera_target",
  "payload": { "targetId": "room:master_bedroom" },
  "createdAt": "2026-07-06T10:00:00Z",
  "expiresAt": "2026-07-06T10:00:10Z"
}
```

- `commandId` 由后端生成，保证全局唯一：格式 `vc_<timestamp>_<counter>`，同一秒内自增计数器
- `expiresAt` 默认创建后 10 秒
- 过期命令不会被 App 执行

#### 获取命令

`GET /api/visual-commands`

返回待处理命令列表，**不清空队列**。

#### 确认已执行

`POST /api/visual-commands/ack`

```json
{
  "ids": ["vc_20260706_120030_001", "vc_20260706_120030_002"]
}
```

- 后端只删除已 ack 的命令，避免多 tab 或网络重试导致丢失
- `POST /api/visual-commands/ack` 是幂等的：重复 ack 同一 `commandId` 返回成功，不报错
- 获取与 ack 之间不阻塞新命令入队；过期命令由后端在返回前过滤

---

## 5. MCP 端点

后端同时暴露：

- `POST /mcp`：Streamable HTTP transport
- `GET /sse`：SSE transport fallback

`opencode.json` 配置：

```json
{
  "mcp": {
    "bontop-design": {
      "type": "remote",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## 6. MCP 工具

### 6.1 查询类

- `get_project_summary` → `/api/project`
- `get_current_scheme` → `/api/scheme/current`
- `list_topics` → `/api/topics`
- `list_options(topic)` → `/api/topics/:id/options`
- `get_option_details(topic, optionId)` → `/api/topics/:id/options/:optionId`
- `get_decisions` → 返回决策日志
- `get_view_context` → 当前选中对象

### 6.2 操作类

- `set_selection(topic, optionId, roomId?, reason?, source?)`
  - 内部调用 `PATCH /api/scheme/current`
  - `optionId` 必须是非空字符串，除非同时指定了 `roomId` 用于清除覆盖
  - `roomId` 省略时修改话题全局默认值
  - `roomId` 指定时修改该房间的覆盖值
  - `source` 默认 `"ai"`
- `batch_set_selections(selections: [{ topic, optionId, roomId?, reason? }], source?)`
  - 原子批量操作：先校验所有条目，任一非法则整体失败，不修改状态
  - 内部同样调用 `PATCH /api/scheme/current` 等价逻辑
  - `source` 默认 `"ai"`
- `record_decision(topic?, roomId?, optionId?, reason?, source?)`
  - 内部调用 `POST /api/decisions`
  - 用于记录不修改方案的决策理由
- `set_camera_target(targetId, mode?)`
  - 生成 visual command（默认 10 秒后过期）
- `highlight_object(objectId)`
  - 生成 visual command（默认 10 秒后过期）

---

## 7. 旧代码清理

Spec 1 完成后，以下旧文件应删除：

- `app/vite.config.ts` 中的 `state-file-bridge` 插件
- `mcp-server/mcp-server.ts` 及 `mcp-server/tools/`
- `app/.state/snapshot.json` 和 `app/.state/commands.json`
- `scripts/test-mcp.mjs` / `scripts/test-mcp-client.mjs`

App 端旧 `StateManager` / `designData.ts` / `FloorTopic` / `WallTopic` / `PaintTopic` 在 Spec 1 阶段保留为废弃桩，待 Spec 2 重写前端时统一删除或替换。
- `shared/types.ts` 中的旧 `Snapshot` / `Command` 类型（文件桥接模型），由新的 `CurrentScheme` / `DecisionLog` / `VisualCommand` 类型替代

`opencode.json` 从 local stdio 改为 remote HTTP。

---

## 8. 开发工作流

```bash
# 终端 1
npm run dev:server

# 终端 2
opencode
```

Spec 1 阶段不需要启动前端，用 OpenCode + MCP client 测试即可。

---

## 9. 验收标准

- `npm run typecheck` 无错误
- `npm run dev:server` 成功启动
- OpenCode 通过 remote MCP 连接成功
- `get_current_scheme` 返回 `data/current-scheme.json` 内容
- `set_selection` 后 `data/current-scheme.json` 和 `data/decision-log.json` 更新
- `set_camera_target` 后 `GET /api/visual-commands` 返回对应命令
- 旧文件桥接代码已删除

---

## 10. 非目标

- 第一人称漫游
- 3D 渲染
- 预算/风险计算
- 归档/diff
- 复杂规则引擎
