import { lintLevel, type MepLintResult } from '@shared/mep-hvac-lint';

/**
 * 把 MEP lint 结果渲染成工具栏按钮上的徽标。
 * 完整明细放在 title tooltip；徽标本体只显示最关键的计数。
 */
export function renderMepLintBadge(element: HTMLElement, result: MepLintResult | null): void {
  element.hidden = result === null;
  element.classList.toggle('btn-badge-error', result !== null && lintLevel(result) === 'error');
  element.classList.toggle('btn-badge-warning', result !== null && lintLevel(result) === 'warning');

  if (!result) {
    element.textContent = '';
    element.title = 'MEP lint：未就绪';
    return;
  }

  const { errors, warnings, resolvedRoutes, routes } = result.counts;
  element.textContent = errors > 0 ? `✗ ${errors}` : warnings > 0 ? `⚠ ${warnings}` : '✓';
  const detail = `MEP lint：error ${errors} · warning ${warnings} · routes resolved ${resolvedRoutes}/${routes}`;
  element.title = warnings > 0 ? `${detail}；存在待复核项（不等同于施工错误）` : detail;
}
