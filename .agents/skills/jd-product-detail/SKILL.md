---
name: jd-product-detail
description: "在已打开的京东商品页上只读提取标题、价格、店铺、图片、SKU 分组、属性和配送文案；适用于按商品 ID 读取详情，不适用于评论、目录或任何交易动作。"
---

# jd-product-detail

只读京东单商品页。这个 Skill 是基础观察能力：调用者决定要核验哪些商品、详情深度和何时停止；它只负责页面知识、提取、状态与安全，不把一次详情读取当作研究完成。提取器只读取当前 DOM 与页面已显示的数据，不读取评论、不调用私有 REST/API，不点击购买、加入购物车、收藏、下单或支付控件。

## 外部前置依赖与认证

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，通过 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口连接已登录的 Windows Chrome（默认 `9222`）；本包不携带 CLI，也不声明 MCP dependency。
- 用户自行在 Chrome 处理登录、二维码、短信/账号确认、滑块、验证码和异常流量。遇到这些页面只返回结构化状态，不自动登录、不代输密码、不绕过风控。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用，读取任意商品 ID 的不同详情页；调用者可以滚动或展开明确不涉及交易的参数/属性区域。
- 调用者负责从搜索结果选择候选、决定详情深度、去重、同规格比较和研究停止条件。本 Skill 只返回当前页面实际显示的字段与状态，不承诺详情完整，也不做推荐。
- 未明确选择 SKU 时始终返回 `skuResolved=false`，不通过点击 SKU、优惠券或交易控件补数据。需要商品发现时由调用者串行调用 `jd-keyword-search`。

## 探索回退协议

详情提取返回 `layout_changed` 时，先重新 `snapshot`，核对当前 URL 是否为目标 SKU、页面是否完成加载以及登录/验证/拦截提示；可安全滚动属性区，或从搜索结果重新打开带明确 SKU 的详情链接。不得用标题、价格或评论推断缺失字段；恢复则继续，不能恢复才附诊断证据停止。

## 只读会话与页面知识

开始时使用命名 session 执行不带 `--pin-tab` 的 `tab list --json` 保存 baseline target IDs；再执行 pinned `tab list --json` 并记录差集，差集为空时才用 pinned `tab new about:blank` 创建并重新计算。只有唯一 owned targetId 得到证明后，才在该 target 导航到 `https://item.jd.com/<sku>.html`，等待 DOMContentLoaded 和商品标题/阻塞提示，不以 `networkidle` 单独判定 ready。批量 ID 串行，页面变化后重新 snapshot。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix jd-detail)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录差集
# 仅当没有差集时，才创建：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://item.jd.com/100000000001.html"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py 100000000001 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

## 输出契约

详情 envelope 至少包含 `platform`、`id`、`title`、`sourceUrl`、`observedAt`、`shop`、`price`、`images`、`skuGroups`、`attributes`、`availabilityText`、`shippingText`、`promotions`、`warnings`、`status`，并包含 `skuResolved: false`。`price` 保留 `raw`、`amount`、`kind` 和可见的原价字段；没有用户明确选定 SKU 时，不声称精确 SKU 价格，且不会通过点击 SKU 来补数据。

评论数既不进入 `salesText`，也不在详情 envelope 中作为销量或评价结果。未知值使用 `null` 或空数组。

状态只允许 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。标题缺失、页面 ID 不匹配或商品不存在时分别返回结构化的 `layout_changed` / `no_results`，不猜测。

## 清理

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮详情读取结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才确认 baseline target IDs 未改变、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 仍可访问，并在 target 集合恰为 baseline 加 owned 时只关闭明确记录的 owned target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户已有 tab 或退出 Chrome。
