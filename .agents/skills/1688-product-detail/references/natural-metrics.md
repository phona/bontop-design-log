# 自然网络指标观察

这是本 Skill 的可选、只读补充流程。它不属于商品详情 DOM extractor 的必需依赖，也不构造请求。

1. 先在 owned pinned tab 打开 `https://detail.1688.com/offer/<offerId>.html`，等待标题、价格或结构化阻塞状态出现。
2. 读取已经自然触发的记录：

   ```bash
   agent-browser network requests --type xhr,fetch --filter h5api.m.1688.com
   ```

3. 只有在列表中确实存在目标 request 时，才用 `agent-browser network request <id>` 读取其已有响应。
4. 缺失请求时返回 `null` / `unknown`。绝不能拼接 `sign`、token、POST 参数、URL 或重放请求；不要保存 HAR、Cookie 或响应中的敏感内容。

商品详情 extractor 本身不执行上述网络读取，因此离线 fixture 和普通详情运行不依赖任何私有接口。
