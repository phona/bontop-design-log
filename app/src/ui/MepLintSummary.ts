import { lintLevel, type MepLintResult } from '@shared/mep-hvac-lint';

export type MepLintSummaryState = 'ready' | 'unready';

export function renderMepLintSummary(element: HTMLElement, result: MepLintResult | null): void {
  element.textContent = '';
  element.classList.toggle('mep-lint-summary-unready', result === null);
  element.classList.toggle('mep-lint-summary-error', result !== null && lintLevel(result) === 'error');
  element.classList.toggle('mep-lint-summary-warning', result !== null && lintLevel(result) === 'warning');

  if (!result) {
    element.textContent = 'MEP lint：未就绪';
    return;
  }

  const level = lintLevel(result);
  const levelText = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'ok';
  const lines = [
    `MEP lint：${levelText}`,
    `error ${result.counts.errors} · warning ${result.counts.warnings}`,
    `routes resolved ${result.counts.resolvedRoutes}/${result.counts.routes}`,
  ];
  if (result.counts.warnings > 0) lines.push('存在待复核项（不等同于施工错误）');
  element.textContent = lines.join(' · ');
}
