/**
 * HTML 转义：任何来自 config / API / 用户输入的字符串，在拼进 innerHTML 之前
 * 都必须先过这里。项目里大部分渲染已经用 textContent，这函数只服务于少数
 * 必须用模板字符串拼 HTML 的面板（图例表、报价卡、对比行）。
 *
 * 转义 & < > " ' 五个字符：同时覆盖文本节点和双引号属性两种上下文，
 * 所以同一个函数既能护住 `>${value}` 也能护住 `title="${value}"`。
 */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}
