---
name: shopping-research
description: "把国内购物需求转成可审计的只读跨平台探索与专业买手决策报告；按信息增益自适应搜索、详情核验和收敛，不执行任何交易。"
---

# shopping-research

这是决策层 Skill，不是新的平台抓取器。六个基础观察包是 `taobao-keyword-search`、`taobao-product-detail`、`jd-keyword-search`、`jd-product-detail`、`1688-keyword-search` 和 `1688-product-detail`；本 Skill 负责把需求变成探索策略、证据和买手报告。它可以自行决定是否继续探索、使用哪些可用平台、查询矩阵、分页/排序、候选和详情深度，以及何时停止；不要把固定页数或固定候选数当成流程要求。

购物党 Gwdang、慢慢买 Manmanbuy 与什么值得买 SMZDM 是补充性的价格比较来源，不替代上述六个基础观察包。品牌官网型号页和官方电子说明书是规格核验来源，可用于核对型号、额定参数、安装尺寸、用电/气源和安装条件，不替代电商当前价格、库存、地区配送/送装，也不把官网宣传内容当成第三方体验事实。

## 只读 preflight

在开始浏览前，可运行本包自带的 `scripts/preflight.py`。它检查六个基础 Skill 的 `SKILL.md`、`scripts/extract.py` 和 `agents/openai.yaml`，检查当前 Python 与 `agent-browser`，并只读取 `AGENT_BROWSER_CDP` 指定 CDP 端口的 `/json/version`（默认 `9222`）。它不会导航、登录、安装依赖、创建或关闭 tab，也不会修改浏览器。

```bash
python3 scripts/preflight.py
AGENT_BROWSER_CDP=9333 python3 scripts/preflight.py
```

基础 Skill 不在自动发现的目录时，可以显式传入项目级安装根目录：

```bash
python3 scripts/preflight.py --skills-dir /path/to/project/.agents/skills
```

preflight 失败时停止本次研究并披露缺失项；不要把失败的前置检查当成平台无商品。

## 何时读取 references

- 开始规划或调整探索时，读取 [references/exploration-strategy.md](references/exploration-strategy.md)。
- 遇到登录、验证、价格口径、同款归并、供应商或可比性风险时，读取 [references/risk-checklist.md](references/risk-checklist.md) 中相关部分。
- 准备交付前，读取 [references/report-contract.md](references/report-contract.md)，按其中的固定报告结构输出。

## 工作契约

先建立需求 brief：硬约束、偏好、预算、禁忌和未知；再按预期信息增益选择平台、查询变体、页码、排序、抽样层次、候选和详情深度。可以跨页、跨排序进行头/中/尾分层抽样，也可以在低增益、结果收敛、平台阻塞或预算耗尽时停止。所有选择和停止原因都要写入探索覆盖与证据。

调用六个基础 Skill 时，使用其 capability contract：在已验证的 owned pinned target 内自由多轮、串行地搜索任意关键词/分页/排序，或反复读取不同详情。基础 Skill 返回什么就记录什么；`status` 阻塞时不得猜测成功或用另一平台结果掩盖覆盖缺口。缺少某个平台基础 Skill 时降级并披露实际覆盖不足。

把事实、推断和未知分开。比较前统一商品规格、数量单位、地区、配送和价格口径；展示价、已选/未选 SKU 价、券价、MOQ、阶梯价和运费必须分列。无法同口径比较时标为不可直接比较，不强行评分。没有 reviews 能力，口碑、耐用性和售后体验一律标为未验证。

## 补充价格比较来源

需要历史价格、跨平台活动线索或价格异常复核时，可以按 [references/price-comparison-sources.md](references/price-comparison-sources.md) 使用购物党 Gwdang（`gwdang.com`）、慢慢买 Manmanbuy（`s.manmanbuy.com`）和什么值得买 SMZDM（`smzdm.com`）。三者均只读：允许搜索、翻页、打开商品比价/历史价格/促销或爆料详情并记录页面可见字段；禁止购买、加购、收藏、登录、修改账户或绕过验证。它们不是新增的商品详情基础 Skill，不能用比较站聚合标题、爆料标题或价格代替淘宝、京东、1688 原商品详情核验。

比较站结果必须标记来源类型和价格范围：当前展示价、历史最低/最高、活动价、券后/补贴/会员价、预估到手价和已结束促销分别记录。历史记录的商品聚合、抓取时间、优惠条件和 SKU 范围可能不完整；没有明确原商品链接、型号和已选 SKU 时，`skuResolved=false`，不得把结果写成可直接支付的报价。任何进入推荐的候选，至少要回到一个原平台商品详情页核对标题、型号、SKU、属性、配送和促销条件；比较站只能支持价格走势、价差异常或候选发现。

## 不可越过的边界

只读浏览、滚动和明确安全的参数展开可以使用；不得点击或调用购买、加购、收藏、下单、支付、地址/账户修改、退款等交易或账户动作。不得自动登录、代输凭据、绕过 CAPTCHA/滑块/短信/二维码或重放 1688 签名私有 API；不新增 MCP、数据库、REST API、Provider、SDK、compare engine 或浏览器管理服务。

最终产物固定为专业买手报告：执行摘要、需求与口径、探索覆盖、候选对比、推荐/备选及适用条件、淘汰项、风险与未知、用户下一步核验。报告服务决策，不替用户交易。

遇到基础 Skill 的 `layout_changed` 或字段缺失时，按其探索回退协议做有限诊断：重新 snapshot 核对页面，等待/滚动懒加载，改写关键词，必要时用真实商品链接核验详情。`layout_changed` 不等于平台无商品，也不能用另一平台结果掩盖覆盖缺口。继续还是停止由信息增益决定：硬约束覆盖度、新候选差异和新字段收益，结合登录/验证码/拦截风险与时间成本；若连续探索只重复同类结果、价格口径仍不可比或风险升高，应停止并说明依据。
