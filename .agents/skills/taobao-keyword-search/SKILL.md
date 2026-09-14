---
name: taobao-keyword-search
description: "在已打开的淘宝或天猫搜索页上按关键词只读提取分页商品卡片；适用于搜索淘宝商品、关键词找货和读取搜索结果，不适用于详情、店铺目录或任何交易动作。"
---

# taobao-keyword-search

只读搜索淘宝/天猫关键词结果，并返回统一搜索 envelope。这个 Skill 是基础观察能力：调用者决定关键词矩阵、分页、排序、候选覆盖和何时停止；它只负责页面知识、提取、状态与安全，不把一次页面读取当作研究完成。它不会调用淘宝私有 API，也不会点击购买、加入购物车、收藏、下单或支付控件。

## 外部前置依赖

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，使用 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口连接用户的 Windows Chrome（默认 `9222`）；本包不携带 CLI，也不把 CLI 声明成 MCP dependency。
- 用户需要在现有 Chrome 中手工完成淘宝登录。遇到登录、二维码、短信、账号确认、滑块、验证码或异常流量页时，停止并返回结构化 `status`，等待用户手工处理；不要代输凭据或绕过验证。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用；每一轮都读取当时页面，而不是替调用者判断研究是否充分。
- 调用者可以自由传入任意关键词、`page`、`sort`、天猫筛选和价格范围，也可以在同一个 owned target 中反复导航到不同搜索页。页面滚动和明确不涉及交易的参数展开可以由调用者执行。
- 返回的 envelope、字段原文和六种状态是事实边界。调用者负责跨页、跨排序、去重、详情核验、比较和停止条件；本 Skill 不承诺候选数量，也不做推荐。
- 需要详情时由调用者串行调用 `taobao-product-detail`；详情 Skill 同样可以反复读取不同商品。

## 只读会话与页面知识

使用命名 session，并严格区分用户 tab 与 owned tab：先用不带 `--pin-tab` 的 `tab list --json` 保存 baseline target IDs；再执行首次 pinned `tab list --json`，把与 baseline 的差集记录为本 session 的 owned target。如果差集为空，才用 pinned `tab new about:blank` 创建并重新计算差集；只有差集恰好是一个 targetId 才允许导航。所有搜索轮次在该 pinned target 内串行执行，等待 DOM 和页面特定内容（商品卡片或明确的空结果/阻塞提示）出现。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix taobao-search)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；此命令不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录与 baseline 的差集
# 仅当上一步没有 owned 差集时，才执行：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://s.taobao.com/search?q=耳机&page=1&ie=utf8"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py "耳机" --page 1 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

`scripts/extract.py` 只生成 JavaScript，必须通过 stdin 喂给 `agent-browser eval`。不要以 `networkidle` 单独判定 ready；商品卡片、登录/验证提示或空结果提示是站点特定 ready 信号。批量关键词在一个 pinned tab 内串行，每次导航之间留出合理间隔。

## 参数与输出

```text
python3 scripts/extract.py <keyword> [--page N] [--sort SORT] [--tab mall] [--start-price YUAN] [--end-price YUAN]
```

`sort` 支持空值、`sale-desc`、`price-asc`、`price-desc`；`tab mall` 只表示导航 URL 的天猫筛选。脚本不替你导航，也不模拟筛选点击。

输出至少包含：

```json
{
  "platform": "taobao",
  "query": "耳机",
  "page": 1,
  "sourceUrl": "https://s.taobao.com/search?...",
  "observedAt": "2026-09-12T00:00:00.000Z",
  "items": [{
    "id": "123",
    "title": "商品标题",
    "url": "https://item.taobao.com/item.htm?id=123",
    "imageUrl": "https://img.alicdn.com/...",
    "shopName": "店铺",
    "price": {"raw": "￥79.90 券后", "amount": 79.9, "kind": "after_coupon"},
    "salesText": "已售 1万+",
    "sponsored": false,
    "platformData": {"subtitle": null, "location": "广东", "ratingText": null, "tags": []}
  }],
  "warnings": [],
  "status": "ok"
}
```

`price.raw` 保留页面原文，`amount` 只在能解析时填写，`kind` 说明 `displayed`、`range`、`starting`、`after_coupon`、`negotiable` 或 `unknown`。未知字段用 `null`、空数组或 `unknown`。广告项保留在结果中并标记 `sponsored=true`；不要把广告链接当作购买动作。

状态仅使用 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。没有商品卡片且没有明确空结果文案时是 `layout_changed`，不要猜测或伪造商品。

## 探索回退协议

结构化提取失败或返回 `layout_changed` 时，先重新 `snapshot` 并核对 URL、搜索词、登录/验证提示和页面实际内容；可滚动、等待懒加载、改写关键词、翻页或打开可验证详情链接。允许用 DOM/URL/自然网络记录诊断，但不得猜测或调用私有 API。恢复后继续；没有足够页面证据才返回带诊断 warnings 的失败，不把布局变化当作无商品。

## 清理

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮搜索结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才再次列出 tabs，确认 baseline target IDs 未变化、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 仍可访问，并在 target 集合恰为 baseline 加 owned 时关闭本 session 明确创建且已记录 targetId 的 target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户已有 tab 或让 Chrome 退出。
