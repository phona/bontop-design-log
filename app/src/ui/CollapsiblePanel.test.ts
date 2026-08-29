import { describe, it, expect, beforeEach } from 'vitest';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';

describe('setupCollapsiblePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="toggle"></button><div id="content">内容</div>';
  });

  it('toggles content and accessibility state', () => {
    const toggle = document.getElementById('toggle') as HTMLButtonElement;
    const content = document.getElementById('content') as HTMLDivElement;
    const panel = setupCollapsiblePanel(toggle, content);

    expect(content.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(panel.isCollapsed()).toBe(true);
    expect(content.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(content.hidden).toBe(false);
  });
});
