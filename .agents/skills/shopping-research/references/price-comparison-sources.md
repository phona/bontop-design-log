# 价格比较来源使用说明

本文件规定购物党 Gwdang、慢慢买 Manmanbuy 和什么值得买 SMZDM 在 `shopping-research` 中的补充用法。它们提供价格历史、跨平台促销记录、爆料详情和候选发现线索；品牌官网型号页和官方电子说明书提供规格核验线索；这些来源都不改变淘宝、京东、1688 基础 Skill 的权限、详情字段或状态契约。

## 1. 来源定位

| 来源 | 主要价值 | 不能直接证明 |
|---|---|---|
| 购物党 Gwdang (`gwdang.com`) | 商品聚合、跨平台价格线索、价格历史区间和趋势 | 当前选定 SKU 的可支付价格、库存、配送、安装或售后；聚合页面不一定覆盖完整型号变体 |
| 慢慢买 Manmanbuy (`s.manmanbuy.com`) | 多平台促销/历史记录、活动价和低价线索 | 促销条件是否仍有效、是否适用于目标地区和 SKU；搜索结果中相邻型号或不同店铺不等于同款 |
| 什么值得买 SMZDM (`smzdm.com`) | 用户/编辑爆料详情、爆料时间点价格、优惠组成和跳转原商城线索 | 当前原商城价格、爆料是否仍有效、会员券/返利是否适用、目标 SKU 的库存配送或售后 |
| 品牌官网/官方说明书 | 型号、额定参数、安装尺寸、用电/气源、安装条件和官方资料 | 电商当前价格、库存、地区送装、第三方体验、实际售后；宣传内容不能代替体验证据 |

三者均是只读补充来源。不得自动登录，不得处理账号，不得点击购买、加购、收藏、下单、支付或账户修改，不得绕过 CAPTCHA、滑块、短信或二维码验证。遇到 `authentication_required`、`security_verification`、`site_blocked` 或布局无法稳定读取时，原样记录状态并停止该来源分支。

## 2. 搜索和详情层级

每个商品至少记录：

1. 比较站搜索 URL、原始关键词、观察时间和页面状态；
2. 候选卡片的商品标题、平台/店铺、商品链接或商品 ID、页面可见金额和促销文字；
3. 能打开时读取比较站商品详情/历史价格页，或 SMZDM 爆料详情，记录当前价、历史最高/最低、爆料时间价、优惠组成、跳转链接、趋势文字和对应时间范围；
4. 对准备推荐的候选回到淘宝、京东或 1688 原商品详情页，核对完整型号、已选 SKU、容量/尺寸/颜色、属性、库存/配送和当前促销；
5. 记录比较站候选与原商品页是否能建立链接。没有稳定跳转链接、型号证据或原商城详情时，保持候选分开并设置 `skuResolved=false`。

比较站或 SMZDM 的“详情页/爆料详情”只证明来源当时展示的聚合或爆料记录。它不能替代原平台详情页，不能单独证明品牌授权、质量、评论、售后、安装责任或最终运费。

对美的、海尔等品牌，若官网存在型号页或官方电子说明书，应优先用它核对型号和关键工程参数：额定功率/电流、容量、外形与开孔尺寸、用电制式、燃气/水路要求、散热与安装间距、随机配件及安装条件。官网规格与电商标题或 SKU 不一致时，保持候选未解析并回到原商品详情或人工确认；官网的宣传语、功能描述和品牌自述不得写成第三方体验、耐用性或售后事实。

官网/说明书信息仍需单独记录来源 URL、文档标题/版本（若可见）、页码或字段位置和观察时间。它只负责规格核验；当前价格、库存、促销、运费、地区配送和送装责任必须继续从原商城或供应商详情核对。

## 3. 价格口径

以下字段必须分开保存：

- `currentDisplayPrice`：比较站当时显示的当前价格，可能仍是起价、区间价或未选 SKU 价；
- `historicalLow` / `historicalHigh`：比较站记录的历史区间，包含观察周期和日期；
- `dealReportPrice`：SMZDM 爆料发布时记录的价格，必须绑定 `observedAt`/爆料时间和爆料条件；
- `originalCurrentPrice`：从 SMZDM 跳转或页面明确指向的原商城当前价格，必须单独回原商城详情核验；
- `promotionPrice`：活动、满减、平台补贴或限时价；
- `couponPrice` / `memberPrice`：需要券、会员、支付方式或账号条件的价格；
- `rebate`：返利金额或返后口径，必须记录返利平台、到账条件和是否计入展示价；
- `estimatedFinalPrice`：页面明确标注的预估到手价，必须保存组成条件；
- `freight`、`installation`、`tax`、`delivery`：页面可见则分别记录，缺失写 `unknown`。

历史最低价和 SMZDM 爆料时间价都不等于当前可得价格。比较站可能按商品族、链接、店铺或促销记录聚合，SMZDM 爆料也可能已经结束，导致同一标题下型号、SKU、地区和优惠条件混杂。若当前展示价低于页面宣称的历史最低价，或同一商品出现明显冲突，记录为 `price_scope_conflict`，回到原平台详情核对，不自行选择较低值。

## 4. 证据记录建议

除通用证据对象外，建议使用以下字段：

```json
{
  "platform": "gwdang|manmanbuy|smzdm|brand_official",
  "kind": "search|detail|history|deal|spec",
  "url": "实际观察 URL",
  "observedAt": "ISO-8601",
  "status": "ok|authentication_required|security_verification|site_blocked|layout_changed|no_results",
  "sourceType": "price_comparison|official_specs",
  "field": "price.currentDisplayPrice",
  "priceScope": "current|historical_low|historical_high|deal_report|original_current|promotion|coupon|subsidy|member|rebate|estimated_final",
  "priceRaw": "页面原文金额和单位",
  "promotionConditions": "页面可见条件或 unknown",
  "skuResolved": false,
  "linkedOriginalUrl": null,
  "jumpUrl": null,
  "officialSpecUrl": null,
  "officialDocumentTitle": null,
  "documentVersion": null,
  "fieldLocation": null,
  "note": "事实、限制或与原平台详情核验的结果"
}
```

`observedAt`、URL 和 `status` 必须来自实际页面观察。比较站显示的销量、低价标签、排名和推广位只能作为页面字段记录，不能推断质量、耐用性、售后或授权关系。

## 5. 收敛条件

当价格历史已覆盖目标候选、跨平台活动主要重复、或新增记录只改变促销条件而不改变候选排序时，可以停止比较站探索并标记 `converged`。若关键型号、SKU、地区、运费或活动条件仍未核清，应将结论降级为价格线索/询价计划，并列出需要在原商品详情页或人工询价中补核的字段。
