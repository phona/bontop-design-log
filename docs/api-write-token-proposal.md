# 方案：API 写操作改用 token 认证（替换回环地址推断）

> 状态：**提案，待业主拍板后实施**（业主 2026-11-04 选定「手动输入一次，之后无感」交付方式）。
> 本文只出方案与取舍，不动代码。实施时按本文 §5 清单单开 PR。

## 1. 为什么要换（问题与实证）

现行守卫（`server/index.ts:210`）：

```ts
const writesEnabled = isLoopbackHost(HOST);   // 只认 localhost / 127.* / ::1
// 非回环 → 所有 POST/PUT/PATCH/DELETE 一律 403 "Remote write access is disabled"
```

**它拿「绑哪个网卡」推断「该不该允许写」**。实证代价（2026-11-04 复验 PR #60 时撞上）：

- `npm run dev -- --host 0.0.0.0`（手机联调移动端的唯一途径）→ 全站写入静默 403；
- 业主第一反应是「我重启了」，实际是绑定地址触发了禁写——因果链反直觉，失败信息指向 `HOST` 但联调者不会那么联想；
- 设计稿明确要求验「移动端 ≤700px 现场采集」，而该形态**按构造无法写**——安全默认值以合法用法整体退化为代价。

**结论：绑定地址是可达性事实，不是安全意图。** 写权限应该由「持有什么」决定，而不是「从哪连」。

## 2. 影响面：全站 17 类写操作（现状盘点）

守卫一开，下面全部 403。按写 targets 的严重度分三档：

### A 档——写设计数据 / 进仓目录（最需要门禁）

| 操作 | 接口 | 落点 |
|---|---|---|
| 电气点位增改删 | `POST/PUT/DELETE /api/electrical/:id` | `config/electrical.yaml` |
| 给排水点位增改删 | `POST/PUT/DELETE /api/plumbing/:id` | `config/plumbing.yaml` |
| 家具摆位增改删 | `POST/PUT/DELETE /api/furnishings` | `config/house.yaml` |
| **证据落定** | `POST /api/acceptance/evidence/finalize` | `schedule/phase-*/evidence/`（随 PR 进 master） |
| **验收提交（开 PR）** | `POST /api/acceptance/submit` | `git checkout -b` → `schedule:render` → `verify:schedule` → `git add/commit` → push → 开 PR |
| 决策记录 | `POST /api/decisions` | decisions 数据 |

### B 档——写会话/方案状态

| 操作 | 接口 | 落点 |
|---|---|---|
| 草稿自动保存 | `PUT /api/acceptance/draft` | `tmp/capture/acceptance-draft/*.json` |
| 证据上传（暂存） | `POST /api/acceptance/evidence` | `tmp/capture/acceptance-staging/` |
| 保存/切换/恢复/删除方案 | `POST /api/schemes`、`PATCH /api/scheme/current`、`POST /:id/restore`、`DELETE /:id`、`POST /compare/clear` | scheme 文件 |
| 吊顶报价激活 | `POST /api/ceiling/quotes/active` | 报价卡状态 |
| 窗帘开合 | `PATCH /api/presentation-state/curtains` | 演示状态 |

### C 档——只读语义但走 POST（不算变更，可同门禁也可豁免）

| 操作 | 接口 | 说明 |
|---|---|---|
| 跑机械卡点 | `POST /api/acceptance/gates` | 读服务端草稿算结论 |
| 生成 PR 预演 | `POST /api/acceptance/submit`（`dry_run:true`） | 只读投影 |
| 视角上下文 / 可视化指令 / 状态命令 | `POST /api/view-context`、`/api/visual-commands(+ack)`、`POST /__state/commands` | 界面状态同步 |

**读操作（GET）一律不设门禁**——本次只关写。

## 3. 方案：token 认证（业主已定交付方式）

### 3.1 token 本体

- 环境变量 `BONTOP_WRITE_TOKEN` 优先（CI / 固定部署用）；
- 未设置时服务端**首次启动生成**（`crypto.randomBytes(24).toString('hex')`），持久化到仓库根的 `.bontop-write-token`（权限 600，**已由 .gitignore 收录**，见 `.env` 同段），之后启动复用——业主不会每次重启都要重新输 token；
- 启动时日志打印一次：`[server] write token: xxxx（已写入 .bontop-write-token）`。

### 3.2 服务端校验（替换回环推断）

- 删掉 `isLoopbackHost(HOST)` 与 `writesEnabled` 分支；
- 中间件改为：`POST/PUT/PATCH/DELETE` 必须带 `x-bontop-token` 头且值等于 token（恒定时间比较），否则 **401** `{error: 'write token required', detail: '首次使用请在页面输入 token（服务端日志或 .bontop-write-token）'}`；
- `GET` 不校验；
- 本机回环**不再免 token**（统一规则，消灭特例；本地也只输一次，存 localStorage）。

### 3.3 客户端交付：手动输入一次，之后无感

- 所有写请求经统一封装（现状写调用散在 `App.ts` / `StateSync.ts` / `StateManager.ts` / `ScheduleDetailPanel.ts` / `CeilingQuotePanel.ts` 五处，实施时收敛到一个 `apiWrite(path, init)` helper）；
- token 存 `localStorage['bontop.write-token']`；
- 首次写入（本地无 token）→ 页面内嵌对话框输入（文案指向服务端日志 / `.bontop-write-token`）→ 存入 → **自动重发该次请求**；
- 之后所有写请求自动带头，无感；
- 401 响应（token 错/被换）→ 清掉本地 token 重新走输入流程，错误明确提示「token 不正确或已轮换」；
- 对话框要能在手机窄屏用（≤700px 全宽）。

### 3.4 边界（诚实登记，不夸大）

- **防住的**：同网段脚本/扫描器/误 curl 的直接 API 写入；`--host 0.0.0.0` 手机联调恢复正常。
- **防不住的**：能打开页面的人输入正确 token 后即可写（token 在 localStorage，同源 XSS 可读；请求体内明文传输——家庭 HTTP 内网可接受，勿暴露到公网）。若日后要公网部署，另议 HTTPS + 会话认证，不在本方案范围。
- **降级路径**：实施后若嫌本机每次输 token 烦，可加「回环免 token」作为可选 convenience（默认不开）——但那是后续，本方案先统一。

## 4. 取舍记录（为什么不是另外两种）

| 备选 | 否决理由 |
|---|---|
| 注入页面（`VITE_BONTOP_WRITE_TOKEN`）零摩擦 | token 进 bundle = 能开页面即可写，且会被打进 dist；业主 2026-11-04 选手动输入 |
| 本机免 token、局域网才要 | 保留「从哪连」的特例判断，正是本次要消灭的设计；统一规则更好测好推理 |
| 只修文档不改代码 | 业主否决（「太傻了」）——文档治标，误配仍然静默退化 |

## 5. 实施清单（拍板后单开 PR）

1. **服务端**：删回环守卫 → token 中间件（恒定时间比较、401 语义）；token 生成/落盘/日志；`.gitignore` 已覆盖 `.bontop-write-token` 需确认（`.env` 段已有，补一行更稳）。
2. **客户端**：`apiWrite` helper 收敛五处写调用；输入对话框（含手机窄屏）；401 重试流。
3. **测试**：无 token 401 / 错 token 401 / 对 token 放行（服务端路由测试）；`apiWrite` 带头 + 401 清栈重输（客户端单测）；C 档只读 POST 是否豁免——**待业主定**（见 §6）。
4. **文档**：`scripts/dev.sh` 注释、`AGENTS.md` 开发须知一节、`docs/README.md` 索引登记。
5. **验证**：本机 + `--host 0.0.0.0` 手机联调各跑一遍写路径（草稿保存、开 PR 前的卡点/预演）。

## 6. 待业主拍板的两个点

1. **C 档（只读语义的 POST：卡点/预演/状态同步）要不要 token？** 要 = 规则统一、手机跑卡点也要先输 token；不要 = 首次进页面不输 token 就能看卡点预演，写入才拦。**我倾向不要**（读不该被门禁挡，首次体验更顺）。
2. **token 轮换策略**：长期固定（直到手动删 `.bontop-write-token`）还是每次重启换？固定对开发友好；轮换更安全但每台设备要重输。

---

*业主 2026-11-04 裁定：用手动输入一次的 token 交付替换回环守卫；本文为方案，实施待 PR。*
