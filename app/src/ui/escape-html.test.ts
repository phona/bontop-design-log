import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('转义标签与脚本注入', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('转义引号，防止逃出属性上下文', () => {
    expect(escapeHtml('"><svg onload=alert(1)>')).toBe('&quot;&gt;&lt;svg onload=alert(1)&gt;');
    expect(escapeHtml("a'b")).toBe('a&#39;b');
  });

  it('& 先转义，不产生二次转义漏洞也不吞已有实体语义', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('普通中文/数字/空值原样或空串', () => {
    expect(escapeHtml('主卧 2.8m')).toBe('主卧 2.8m');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
