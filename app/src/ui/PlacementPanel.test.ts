import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlacementPanel } from './PlacementPanel.js';

describe('PlacementPanel', () => {
  let panel: PlacementPanel;

  beforeEach(() => {
    panel = new PlacementPanel();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    expect(panel.isVisible()).toBe(false);
  });

  it('becomes visible on show()', () => {
    panel.show();
    expect(panel.isVisible()).toBe(true);
  });

  it('becomes hidden on hide()', () => {
    panel.show();
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });

  it('toggles visibility', () => {
    panel.toggle();
    expect(panel.isVisible()).toBe(true);
    panel.toggle();
    expect(panel.isVisible()).toBe(false);
  });

  it('renders electrical and plumbing sections', () => {
    panel.show();
    const el = document.getElementById('placement-panel');
    expect(el).toBeTruthy();
    expect(el!.innerHTML).toContain('电气点位');
    expect(el!.innerHTML).toContain('给排水');
    expect(el!.innerHTML).toContain('五孔插座');
    expect(el!.innerHTML).toContain('水龙头');
    expect(el!.innerHTML).toContain('🔌');
    expect(el!.innerHTML).toContain('🚽');
  });

  it('fires onSelect with category and type when a button is clicked', () => {
    let selectedCategory: string | null = null;
    let selectedType: string | null = null;
    panel.onSelect((category, type) => { selectedCategory = category; selectedType = type; });
    panel.show();

    const el = document.getElementById('placement-panel')!;
    const btn = el.querySelector('button[data-category="electrical"][data-type="socket"]') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(selectedCategory).toBe('electrical');
    expect(selectedType).toBe('socket');
  });
});
