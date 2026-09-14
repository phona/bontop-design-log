---
name: taobao-product-detail
description: "在已打开的淘宝或天猫商品页上只读提取商品详情、店铺、图片、SKU 分组和属性；适用于按商品 ID 读取详情，不适用于评论、店铺目录或任何交易动作。"
---

# taobao-product-detail

只读淘宝/天猫单商品详情页。这个 Skill 是基础观察能力：调用者决定要核验哪些商品、反复查看多少详情以及何时停止；它只负责页面知识、提取、状态与安全，不把一次详情读取当作研究完成。脚本只读取当前页面 DOM 和页面已经暴露的元数据，不点击 SKU、优惠券或交易控件，不调用私有 API，不执行购买、加购、收藏、下单或支付。

## 外部前置依赖与认证

- Python 3（标准库即可）。
- 全局 `agent-browser` CLI，通过 `AGENT_BROWSER_CDP` 指定的本机 CDP 端口使用用户 Windows Chrome（默认 `9222`）；本包不携带 CLI，也没有 MCP dependency。
- 用户必须先在现有 Chrome 手工登录淘宝。登录页、二维码、短信/账号确认、滑块、验证码或异常流量页会得到统一状态；不要自动输入凭据、绕过验证或反复重试。

## Capability contract

- 在调用者已经创建并验证的 owned pinned target 内，本 Skill 可被多轮、串行调用，读取任意商品 ID 的不同详情页；调用者可以滚动或展开明确不涉及交易的参数/属性区域。
- 调用者负责选择候选、搜索/详情深度、去重、同规格比较和研究停止条件。本 Skill 只返回当前页面能观察到的字段与状态，不承诺详情完整，也不做推荐。
- 未明确选择 SKU 时始终保留 `skuResolved=false`；不要通过点击 SKU、优惠券或交易控件补数据。需要商品发现时由调用者串行调用 `taobao-keyword-search`。

## 探索回退协议

详情提取返回 `layout_changed` 时，先重新 `snapshot`，核对 URL、商品 ID、页面加载和登录/验证提示；可安全滚动属性区，或从搜索结果重新打开明确商品链接。不得猜测 SKU 或价格；恢复则继续，不能恢复才附页面诊断停止。

## 只读会话与页面知识

任务开始先在命名 session 中用不带 `--pin-tab` 的 `tab list --json` 保存 baseline target IDs；再执行首次 pinned `tab list --json` 并记录与 baseline 的差集。如果没有差集，才用 pinned `tab new about:blank` 创建并重新计算；只有唯一 owned targetId 得到证明后，才在该 target 导航到 `https://item.taobao.com/item.htm?id=<itemId>`（天猫页也可以）。等待 DOMContentLoaded 后等待商品标题或明确阻塞提示；不把 `networkidle` 作为唯一 ready 条件。

```bash
CDP_PORT="${AGENT_BROWSER_CDP:-9222}"
SESSION="$(agent-browser session id --scope worktree --prefix taobao-detail)"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" tab list --json  # baseline；不带 --pin-tab
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab list --json  # 记录 owned 差集
# 仅当没有差集时，才创建：
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab tab new about:blank
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab open "https://item.taobao.com/item.htm?id=744983869996"
agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab wait --load domcontentloaded
python3 scripts/extract.py 744983869996 | agent-browser --cdp "$CDP_PORT" --session "$SESSION" --pin-tab eval --stdin --json
```

脚本只生成待 eval 的 JavaScript。所有操作串行；批量详情页之间留出合理间隔。页面变化后重新 snapshot，不复用旧 refs。

## 输出契约

详情 envelope 至少包含 `platform`、`id`、`title`、`sourceUrl`、`observedAt`、`shop`、`price`、`images`、`skuGroups`、`attributes`、`availabilityText`、`shippingText`、`promotions`、`warnings`、`status`，并包含 `skuResolved: false`。`price` 的 `raw`、`amount`、`kind` 对应当前页面默认/已显示价格；同时保留 `originalRaw` / `originalAmount`（若存在）。未显式选择 SKU 时绝不声称价格属于某个精确 SKU；本 Skill 不通过点击来解析其他 SKU 价格。

状态只允许 `ok`、`authentication_required`、`security_verification`、`site_blocked`、`layout_changed`、`no_results`。详情页没有标题或输入 ID 与页面 ID 不一致时返回 `layout_changed`，不猜商品。

店铺、图片、可见 SKU 组选项、页面属性、库存/配送文案和页面已显示促销只作观察。未知值用 `null` 或空数组；不读取评论内容或评论数。

## 清理与安全

同一个 `shopping-research` 任务内复用已证明 ownership 的 pinned target，不因每轮详情读取结束而关闭它。只有整个研究任务结束、切换所有权或发生异常需要清理时，才确认 baseline target IDs 未改变、`curl "http://127.0.0.1:${AGENT_BROWSER_CDP:-9222}/json/version"` 仍成功，并在 target 集合恰为 baseline 加 owned 时仅关闭明确记录的 owned target。独立调用本 Skill 时，单次调用结束才算任务结束。若无法证明 session 客户端清理安全则不执行它。禁止全量关闭 tabs、关闭用户 tab 或退出 Chrome。
