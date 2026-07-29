import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FurniturePanel } from './FurniturePanel.js';

describe('FurniturePanel', () => {
  let panel: FurniturePanel;

  beforeEach(() => {
    panel = new FurniturePanel();
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

  it('renders furniture buttons', () => {
    panel.show();
    const el = document.getElementById('furniture-panel');
    expect(el).toBeTruthy();
    expect(el!.innerHTML).toContain('1.8m床');
    expect(el!.innerHTML).toContain('🛏️');
    expect(el!.innerHTML).toContain('餐桌');
  });

  it('fires onSelect when a button is clicked', () => {
    let selectedType: string | null = null;
    panel.onSelect((type) => { selectedType = type; });
    panel.show();

    const el = document.getElementById('furniture-panel')!;
    const btn = el.querySelector('button[data-type="bed_180"]') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(selectedType).toBe('bed_180');
  });

  it('shows dimension labels', () => {
    panel.show();
    const el = document.getElementById('furniture-panel')!;
    expect(el!.innerHTML).toContain('1.8m × 2m');
    expect(el!.innerHTML).toContain('0.8m × 0.3m');
    expect(el!.innerHTML).toContain('1.2m × 0.6m');
  });
});
