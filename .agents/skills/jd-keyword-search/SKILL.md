---
name: jd-keyword-search
description: "在已打开的京东搜索页上按关键词只读提取分页商品卡片；适用于搜索京东商品和读取结果，不适用于商品详情、评论、店铺目录或任何交易动作。"
---

# jd-keyword-search

只读京东关键词搜索结果。这个 Skill 是基础观察能力：调用者决定关键词矩阵、分页、排序、候选覆盖和何时停止；它只负责页面知识、提取、状态与安全，不把一次页面读取当作研究完成。提取器只观察页面 DOM，不调用京东 REST/API，不点击购买、加入购物车、收藏、下单或支付控件。

## 外部前置依赖

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，通过 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口连接已登录的 Windows Chrome（默认 `9222`）；本 Skill 不携带 CLI，也不声明伪造的 MCP dependency。
- 登录、二维码、短信/账号确认、滑块、验证码和异常流量由用户在现有 Chrome 手工处理。提取器会返回统一结构化状态，不代输凭据、不绕过验证。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用；每轮可使用任意关键词、`page` 和 `sort`，也可以反复导航到不同排序或分页。
- 调用者可以滚动或展开明确不涉及交易的参数/属性内容；本 Skill 只提取当轮页面实际显示的字段，不替调用者判断研究是否充分、不承诺候选数量、不做推荐。
- 返回的 envelope、平台字段和六种状态是观察事实。跨页、跨排序、去重、详情核验、价格比较和停止条件由调用者负责；需要详情时串行调用 `jd-product-detail`。

## 只读会话与页面知识

每次任务使用命名 session：先用不带 `--pin-tab` 的 `tab list --json` 记录 baseline target IDs，再执行 pinned `tab list --json` 并记录差集；差集为空时才用 pinned `tab new about:blank` 创建并重新计算。只有唯一 owned targetId 得到证明后，才在这个 target 上串行导航。等待 DOMContentLoaded 后等待商品卡片或明确的空结果/阻塞提示；不以 `networkidle` 单独判定 ready。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix jd-search)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录差集
# 仅当没有差集时，才创建：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://search.jd.com/Search?keyword=耳机&page=1&enc=utf-8"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py "耳机" --page 1 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

批量关键词必须串行并在导航之间保留合理间隔。`scripts/extract.py` 只生成待 eval 的 JavaScript，不负责导航或请求接口。

## 参数与输出

```text
python3 scripts/extract.py <keyword> [--page N] [--sort SORT]
```

输出至少包含 `platform`、`query`、`page`、`sourceUrl`、`observedAt`、`items`、`warnings`、`status`。每个 item 至少包含字符串 `id`、`title`、`url`、`imageUrl`、`shopName`、`price`、`salesText`、`sponsored`；还会在 `platformData.commentCountText` 单独保留评论数。评论数永远不会冒充 `salesText`。

`price` 形如 `{raw, amount, kind}`，保留页面原文；`amount` 无法解析时为 `null`，`kind` 可为 `displayed`、`range`、`starting`、`after_coupon`、`negotiable` 或 `unknown`。缺失字段用 `null` 或 `unknown`，不猜测。

状态只使用 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。有结果卡片但所有商品 ID 都缺失时返回 `layout_changed`；明确空结果才返回 `no_results`。

## 探索回退协议

若脚本返回 `layout_changed`、`no_product_cards` 或字段大量为空，不要把它解释为“京东没有商品”。先用当前 pinned 页重新 `snapshot`/检查 URL 与可见文本，确认仍在目标搜索且首屏已完成；必要时只读滚动或等待懒加载，再重跑提取。仍失败时可改写关键词、检查真实商品链接/DOM 属性、打开可验证的商品详情 URL，并将诊断写入 warnings。只有确认登录/验证/拦截或有限探索没有可用证据时才停止；禁止猜测 SKU、价格或销量。

## 清理

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮搜索结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才再次列 tabs，确认 baseline target IDs 不变、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 成功，并在当前集合恰为 baseline 加 owned 时只关闭明确记录的 owned target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户已有 tab 或退出 Chrome。
