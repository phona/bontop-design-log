import { describe, expect, it } from 'vitest';
import { renderMepLintBadge } from './MepLintSummary';

function createElement(): HTMLSpanElement {
  document.body.innerHTML = '<span id="mep-lint-badge" class="btn-badge"></span>';
  return document.getElementById('mep-lint-badge') as HTMLSpanElement;
}

describe('MEP lint badge', () => {
  it('shows warning count with details in tooltip without calling warnings construction errors', () => {
    const element = createElement();
    renderMepLintBadge(element, {
      errors: [],
      warnings: [{ level: 'warning', code: 'pending', message: 'pending review' }],
      counts: { errors: 0, warnings: 1, routes: 39, resolvedRoutes: 37 },
    });

    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('⚠ 1');
    expect(element.classList.contains('btn-badge-warning')).toBe(true);
    expect(element.title).toContain('error 0 · warning 1');
    expect(element.title).toContain('routes resolved 37/39');
    expect(element.title).toContain('存在待复核项（不等同于施工错误）');
  });

  it('shows error count, ok mark, and hidden unready state', () => {
    const element = createElement();
    renderMepLintBadge(element, {
      errors: [{ level: 'error', code: 'bad', message: 'bad route' }],
      warnings: [],
      counts: { errors: 1, warnings: 0, routes: 2, resolvedRoutes: 2 },
    });
    expect(element.textContent).toBe('✗ 1');
    expect(element.classList.contains('btn-badge-error')).toBe(true);
    expect(element.title).not.toContain('待复核');

    renderMepLintBadge(element, {
      errors: [],
      warnings: [],
      counts: { errors: 0, warnings: 0, routes: 2, resolvedRoutes: 2 },
    });
    expect(element.textContent).toBe('✓');

    renderMepLintBadge(element, null);
    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe('');
  });
});
