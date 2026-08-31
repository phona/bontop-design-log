---
name: agent-browser
description: 需要用真实浏览器驱动/验证 Web 应用时使用 — 页面截图取证、运行时场景内省（eval 遍历对象树/包围盒）、改动前后同机位 A/B 对比、复现和定位视觉回归、验证应用就绪状态、表单/点击/抓取等网页自动化。实战套路与踩坑记录见 references/practical-patterns.md；命令大全见 CLI 自带 `agent-browser skills get core --full`（版本随 CLI 同步，不会过期）。
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
---

# agent-browser

> ⚠️ **本项目特例（覆盖下文裸命令写法）**：非交互 shell 里裸 `agent-browser` 会解析到错误 shim——本仓库所有命令一律用 wrapper 全路径 `$HOME/.local/bin/agent-browser`（含 `skills get`）。

Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with accessibility-tree snapshots and compact `@eN` element refs.

## 硬规则

- 本项目所有命令使用 `$HOME/.local/bin/agent-browser`，不要使用裸命令。
- 每个 agent 会话使用一个稳定且独占的 session，格式为 `bontop-<uuid>`；UUID 在该会话首次使用浏览器时生成一次，并在当前会话上下文中持续复用。不得按命令、任务或重试重新生成 UUID，也不得让不同 agent 共用同一个 session。
- 同一个 session / daemon 内不要并行执行多个 browser 命令；同一 agent 的 `open`、`wait`、`snapshot`、`screenshot` 和 `close` 必须串行。不同 session 可按需并行，但每个 session 都必须独占且分别清理。
- 页面发生变化后必须重新执行 `snapshot`；旧 refs 可能失效。
- 不要把 `document.readyState`、`networkidle` 或 `canvas` 存在单独当作应用/3D 模型 ready；必须等待真实业务状态和模型内容完成。
- `open` 或其他命令超时后不要立即重试，也不要换 UUID/新 session；先用原 session 做一次有限探测，必要时复位原 session，再决定是否重试。连续失败就停止，不要继续制造浏览器实例。
- 浏览器任务成功、失败或中断后都要尝试关闭当前 session；`close` 失败时记录为资源清理异常，不要用 `close --all` 影响其他 agent。
- 不要重复启动常驻 dev server；先用 HTTP 请求确认服务状态。
- 后台任务显示 timeout 不等于应用失败，必须单独验证端口和页面。
- Blender 渲染前确认 GLB、render facts 和 config 来自同一版本。

## Start here

```bash
$HOME/.local/bin/agent-browser skills get core             # start here — workflows, common patterns, troubleshooting
$HOME/.local/bin/agent-browser skills get core --full      # include full command reference and templates
```

## 标准生命周期

```bash
SESSION="bontop-<uuid>"  # 每个 agent 会话只生成一次，并在后续命令中复用
cleanup() {
  $HOME/.local/bin/agent-browser --session "$SESSION" close >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

$HOME/.local/bin/agent-browser --session "$SESSION" open "http://localhost:5173/"
$HOME/.local/bin/agent-browser --session "$SESSION" wait --load networkidle
# 对 3D 页面继续轮询真实 ready 状态，再 snapshot / screenshot
$HOME/.local/bin/agent-browser --session "$SESSION" snapshot -i -c
$HOME/.local/bin/agent-browser --session "$SESSION" screenshot
```

任务结束后由 `trap` 或显式命令执行：

```bash
$HOME/.local/bin/agent-browser --session "$SESSION" close
```

`close` 后下次仍使用同一个 session 名；底层 Chrome 冷启动是可接受的。
CLI 自带的 skill 内容与安装版本同步，不会过期；本仓库只补充项目专属经验，详见：

- [references/practical-patterns.md](references/practical-patterns.md) — 本地 Web 验证、daemon / 会话故障、并发与超时、Blender/WSL 联动。

## Specialized skills

任务超出普通网页自动化时再加载：

```bash
$HOME/.local/bin/agent-browser skills get electron          # Electron 桌面应用（VS Code、Slack、Discord、Figma……）
$HOME/.local/bin/agent-browser skills get slack             # Slack 工作区自动化
$HOME/.local/bin/agent-browser skills get dogfood           # 探索式测试 / QA / bug 挖掘
$HOME/.local/bin/agent-browser skills get derive-client     # 录制 HAR，推导站点独立 API client
$HOME/.local/bin/agent-browser skills get vercel-sandbox    # Vercel Sandbox microVM 内运行
$HOME/.local/bin/agent-browser skills get agentcore         # AWS Bedrock AgentCore 云浏览器
```

`$HOME/.local/bin/agent-browser skills list` 查看当前安装版本支持的全部 skill。

## Observability Dashboard

The dashboard runs independently of browser sessions on port 4848 and can also be opened through a proxied or forwarded URL such as `https://dashboard.agent-browser.localhost`. Agents should stay on the dashboard origin: session tabs, status, and stream traffic are proxied internally, so session ports do not need to be exposed.
