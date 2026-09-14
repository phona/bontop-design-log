---
name: 1688-product-detail
description: "在已打开的 1688 商品详情页上只读提取标题、阶梯价、MOQ、单位、供应商、图片、SKU 分组、属性、库存/配送和页面促销；不适用于评论、店铺目录或任何交易动作。"
---

# 1688-product-detail

只读 1688 单商品详情页。这个 Skill 是基础观察能力：调用者决定要核验哪些商品、详情深度和何时停止；它只负责页面知识、提取、状态与安全，不把一次详情读取当作研究完成。提取器优先读取页面已嵌入的数据和 DOM，不构造或重放签名私有 API，不点击购买、加入购物车、收藏、下单或支付控件，不读取评论内容或评论列表。

## 外部前置依赖与认证

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，通过 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口连接用户 Windows Chrome（默认 `9222`）；本包不携带 CLI，也不声明 CLI/MCP dependency。
- 1688 页面可能要求用户手工登录或人工验证。登录、二维码、短信/账号确认、滑块、验证码和异常流量页只返回结构化状态；不自动登录、不代输凭据、不绕过风控。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用，读取任意 offer ID 的不同详情页；调用者可以滚动或展开明确不涉及交易的参数/属性区域。
- 调用者负责从搜索结果选择候选、决定详情深度、去重、同规格比较和研究停止条件。本 Skill 只返回当前页面实际显示的字段与状态，不承诺详情完整，也不做推荐。
- 未明确选择 SKU 时始终保留 `skuResolved=false`，不通过点击 SKU、优惠券或交易控件补数据。需要商品发现时由调用者串行调用 `1688-keyword-search`。

## 探索回退协议

详情提取返回 `layout_changed` 时，先重新 `snapshot`，核对 URL、offerId、品类和登录/验证提示；可安全滚动属性区，或从搜索结果重新打开带明确 offerId 的详情链接。不要把推荐/错类页面当目标商品，也不要猜 MOQ、阶梯价或 SKU；恢复则继续，不能恢复才附 DOM/URL 诊断停止。

## 只读会话与页面知识

先用命名 session 执行不带 `--pin-tab` 的 `tab list --json` 记录 baseline target IDs；再执行 pinned `tab list --json` 并记录差集，差集为空时才用 pinned `tab new about:blank` 创建并重新计算。只有唯一 owned targetId 得到证明后，才在 owned target 导航到 `https://detail.1688.com/offer/<offerId>.html`，等待 DOMContentLoaded 和商品标题/阻塞提示；不要以 `networkidle` 单独判定 ready。批量详情页串行，页面变化后重新 snapshot。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix 1688-detail)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录差集
# 仅当没有差集时，才创建：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://detail.1688.com/offer/927875250705.html"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py 927875250705 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

`scripts/extract.py` 只生成待 eval 的 JavaScript，不发请求。页面自然触发的供应商/页面指标若需要补充，只能在页面加载后用 `agent-browser network requests --type xhr,fetch` 观察已经发生的请求，再读取已有 request；绝不拼接 URL、POST body、sign/token 或重放私有 API。请求缺失时保留 `null` 并报告 warning。

## 输出契约

详情 envelope 至少包含 `platform`、`id`、`title`、`sourceUrl`、`observedAt`、`shop`、`price`、`images`、`skuGroups`、`attributes`、`availabilityText`、`shippingText`、`promotions`、`warnings`、`status`，并包含 `skuResolved: false`。1688 专属信息原样保留：

- `price.tiers`：每档的 `minQty`、`raw`、`amount`、`kind`。
- `price.moq`：`raw` 与可解析的 `amount`。
- `price.unit`：页面单位。
- `platformData.skuCount` 与 `platformData.naturalNetworkMetricsObserved`：只作页面观察状态，不声称读取了私有接口。

`price.raw` / `amount` / `kind` 仍遵守统一契约；没有明确选择 SKU 时为 `skuResolved: false`，不会声称当前价格是某个精确 SKU 的价格。未知值用 `null`、空数组或 `unknown`。状态只使用 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。

## 清理

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮详情读取结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才确认 baseline target IDs 未改变、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 仍可访问，并在 target 集合恰为 baseline 加 owned 时只关闭明确记录的 owned target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户已有 tab 或退出 Chrome。
