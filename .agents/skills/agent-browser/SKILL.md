---
name: agent-browser
description: 需要用真实浏览器驱动/验证 Web 应用时使用 — 页面截图取证、运行时场景内省（eval 遍历对象树/包围盒）、改动前后同机位 A/B 对比、复现和定位视觉回归、验证应用就绪状态、表单/点击/抓取等网页自动化。实战套路与踩坑记录见 references/practical-patterns.md；命令大全见 CLI 自带 `agent-browser skills get core --full`（版本随 CLI 同步，不会过期）。
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)
---

# agent-browser

> ⚠️ **本项目特例（覆盖下文裸命令写法）**：非交互 shell 里裸 `agent-browser` 会解析到错误 shim——本仓库所有命令一律用 wrapper 全路径 `$HOME/.local/bin/agent-browser`（含 `skills get`）。原因与坑见 `docs/setup.md`「agent-browser wrapper 坑」节。

Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with accessibility-tree snapshots and compact `@eN` element refs.

## Start here

```bash
$HOME/.local/bin/agent-browser skills get core             # start here — workflows, common patterns, troubleshooting
$HOME/.local/bin/agent-browser skills get core --full      # include full command reference and templates
```

CLI 自带的 skill 内容与安装版本同步，不会过期；本仓库文件只补充两层本项目沉淀的东西：

- `references/practical-patterns.md` — 实战中反复用到的套路（就绪等待、场景内省、排除法定位、同条件 A/B 对比）与踩过的坑（daemon 卡死、双层 HTTP 缓存、瞬时状态误读）。

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
