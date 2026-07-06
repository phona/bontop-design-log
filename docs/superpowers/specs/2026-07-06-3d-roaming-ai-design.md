# 和萃 701 3D 装修方案漫游 + AI 协同设计系统 — 总览

> **设计目标**：以房屋数据底座为桥梁，让用户在 3D 场景中做装修方案的 tradeoff，同时让 OpenCode 作为设计顾问可靠介入。
> 
> **使用场景**：个人装修决策工具，非对外产品。

---

## 设计哲学

**核心：装修方案的 tradeoff。**

3D 漫游不是目的，是手段。目的是：

- 看见不同方案的实际效果
- 比较方案之间的成本、风险、副作用
- 把讨论过程和结论归档
- 让 AI 基于真实数据给出建议

---

## 总体架构

```text
浏览器 App  ←──HTTP──→  Node 后端  ←──remote MCP──→  OpenCode
```

- **App**：Three.js 3D 漫游，支持轨道 + 第一人称视角
- **后端**：数据底座 + REST API + Remote MCP
- **OpenCode**：通过 MCP 查询数据、给出建议、修改方案

---

## 子项目拆分

本系统拆分为 4 个独立 spec，按顺序实现：

| 顺序 | Spec | 目标 |
|------|------|------|
| 1 | [后端数据底座 + Remote MCP](./2026-07-06-backend-data-foundation-design.md) | 让 OpenCode 能查询和修改方案 |
| 2 | [App 3D 场景 + 基础漫游](./2026-07-06-app-3d-scene-design.md) | 浏览器中看到户型和方案切换 |
| 3 | [第一人称漫游 + 对象交互](./2026-07-06-first-person-interaction-design.md) | 像 Minecraft 一样走进房子、选中物体 |
| 4 | [规则引擎 + 归档](./2026-07-06-rule-engine-archive-design.md) | 预算/风险计算、方案归档对比 |

---

## 核心决策

| 问题 | 决策 |
|------|------|
| MCP transport | Remote HTTP，后端同时暴露 `POST /mcp` 和 `GET /sse` |
| App 同步方案 | 1 秒轮询 `GET /api/scheme/current` + 手动同步按钮 |
| 视觉命令 | 独立队列 `GET /api/visual-commands`，500ms 轮询 |
| view-context | 只传当前选中 objectId，App 自动 POST |
| 状态存储 | JSON 文件，不上 SQLite |
| 归档删除 | Hard delete，UI 加确认 |
| Undo | 不做 |
| 规则引擎 | MVP 简单模板，不做通用表达式 DSL |
| per-room 选择 | 支持，如主卧地板和客厅地板可选不同 |
| 配置热重载 | 开发模式监听 `config/`，保留 DesignState |
| 旧代码 | 直接删除文件桥接和旧 stdio MCP |

---

## 开发工作流

```bash
# 终端 1
npm run dev:server

# 终端 2
npm run dev:app

# 终端 3
opencode
```

---

## 详细设计

请查看上方链接的 4 个分 spec。
