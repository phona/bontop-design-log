---
name: 1688-keyword-search
description: "在已打开的 1688 搜索页上按关键词只读提取分页供应商品卡片；保留阶梯价、MOQ 和单位，不适用于详情、店铺目录或任何交易动作。"
---

# 1688-keyword-search

只读 1688 关键词搜索结果。这个 Skill 是基础观察能力：调用者决定关键词矩阵、分页、排序、候选覆盖和何时停止；它只负责页面知识、提取、状态与安全，不把一次页面读取当作研究完成。脚本只读取页面 DOM，不构造或重放签名私有 API，不点击购买、加入购物车、收藏、下单或支付控件。

## 外部前置依赖与认证

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，通过 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口连接用户 Windows Chrome（默认 `9222`）；本包不携带 CLI，也不声明 CLI/MCP dependency。
- 1688 搜索可能需要用户在现有 Chrome 手工登录、有效地域或人工验证。遇到登录、二维码、短信/账号确认、滑块、验证码或异常流量页，返回统一状态并停止重试；不自动登录或绕过风控。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用；每轮可使用任意关键词和 `page`，也可以反复导航到不同排序或分页。页面滚动和明确不涉及交易的参数展开可以由调用者执行。
- 返回 envelope、阶梯价、MOQ、单位、字段原文和六种状态是观察事实。调用者负责跨页、跨排序、去重、详情核验、比较和停止条件；本 Skill 不承诺候选数量，也不做推荐。
- 需要详情时由调用者串行调用 `1688-product-detail`。供应商或页面指标只能观察已经自然发生的请求/页面数据，不能构造、签名、重放或猜测私有接口。

## 只读会话与页面知识

任务开始在命名 session 中用不带 `--pin-tab` 的 `tab list --json` 记录 baseline target IDs；再执行 pinned `tab list --json` 并记录差集，差集为空时才用 pinned `tab new about:blank` 创建并重新计算。只有唯一 owned targetId 得到证明后，才在 owned target 导航到搜索 URL，等待 DOMContentLoaded 后检查商品卡片、空结果或阻塞提示；不要以 `networkidle` 单独判定 ready。批量关键词串行并保留合理间隔。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix 1688-search)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录差集
# 仅当没有差集时，才创建：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://s.1688.com/selloffer/offer_search.htm?keywords=手机壳"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py "手机壳" --page 1 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

`scripts/extract.py` 只生成喂给 `agent-browser eval --stdin` 的 JavaScript；不发请求、不重放自然网络流量。

## 输出契约

搜索 envelope 至少含 `platform`、`query`、`page`、`sourceUrl`、`observedAt`、`items`、`warnings`、`status`。item 至少含字符串 `id`、`title`、`url`、`imageUrl`、`shopName`、`price`、`salesText`、`sponsored`。`price` 始终保留 `raw`、可解析 `amount` 与 `kind`；1688 专属字段在 `platformData` 中保留：

```json
{
  "tieredPrices": [{"raw": "100件起 ¥7.79", "amount": 7.79, "kind": "tier", "minQty": 100}],
  "moq": {"raw": "30件起订", "amount": 30},
  "unit": "件",
  "companyName": "脱敏供应商"
}
```

不要把评论数填入 `salesText`；无法确认的值用 `null` 或 `unknown`。状态只使用 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。

## 探索回退协议

若返回 `layout_changed`、`all_offer_ids_missing` 或结果明显是联想/推荐流，不能等价为“1688 无货”。先重新 `snapshot`，核对 URL、搜索词和页面可见品类；滚动/等待懒加载后重试，并优先使用带 `detail.1688.com/offer` 或明确 `offerId` 的真实商品链接。必要时改写关键词、打开候选详情核对品类和 offerId；DOM、URL 或自然网络记录仅用于诊断，不得构造/重放私有 API。恢复则继续，无法恢复才返回带诊断证据的失败；MOQ、阶梯价、单位未知时保留 unknown，不把错类推荐当结果。

## 清理

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮搜索结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才确认 baseline target IDs 不变、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 仍成功，并在 target 集合恰为 baseline 加 owned 时只关闭明确记录的 owned target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户已有 tab 或退出 Chrome。
