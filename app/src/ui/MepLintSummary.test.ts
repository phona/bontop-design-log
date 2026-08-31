import { describe, expect, it } from 'vitest';
import { renderMepLintSummary } from './MepLintSummary';

function createElement(): HTMLDivElement {
  document.body.innerHTML = '<div id="mep-lint-summary"></div>';
  return document.getElementById('mep-lint-summary') as HTMLDivElement;
}

describe('MEP lint summary', () => {
  it('shows warning summary without calling warnings construction errors', () => {
    const element = createElement();
    renderMepLintSummary(element, {
      errors: [],
      warnings: [{ level: 'warning', code: 'pending', message: 'pending review' }],
      counts: { errors: 0, warnings: 1, routes: 39, resolvedRoutes: 37 },
    });

    expect(element.textContent).toContain('MEP lint：warning');
    expect(element.textContent).toContain('error 0 · warning 1');
    expect(element.textContent).toContain('routes resolved 37/39');
    expect(element.textContent).toContain('存在待复核项（不等同于施工错误）');
  });

  it('shows error level and explicit unready state', () => {
    const element = createElement();
    renderMepLintSummary(element, {
      errors: [{ level: 'error', code: 'bad', message: 'bad route' }],
      warnings: [],
      counts: { errors: 1, warnings: 0, routes: 2, resolvedRoutes: 2 },
    });
    expect(element.textContent).toContain('MEP lint：error');
    expect(element.textContent).toContain('error 1 · warning 0');
    expect(element.textContent).not.toContain('待复核');

    renderMepLintSummary(element, null);
    expect(element.textContent).toBe('MEP lint：未就绪');
  });
});
