// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InfoPanel } from './InfoPanel';

describe('InfoPanel', () => {
  let panel: InfoPanel;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'info-panel';
    document.body.appendChild(container);
    panel = new InfoPanel('info-panel');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should show object info with type and subtype', () => {
    panel.showObjectInfo('hvac:indoor:A1:living_dining');

    expect(container.style.display).toBe('block');
    expect(container.innerHTML).toContain('hvac:indoor:A1:living_dining');
    expect(container.innerHTML).toContain('hvac');
    expect(container.innerHTML).toContain('indoor');
  });

  it('should show object info with just type', () => {
    panel.showObjectInfo('room:master_bedroom');

    expect(container.style.display).toBe('block');
    expect(container.innerHTML).toContain('room:master_bedroom');
    expect(container.innerHTML).toContain('room');
    expect(container.innerHTML).toContain('master_bedroom');
  });

  it('should hide the panel', () => {
    panel.showObjectInfo('hvac:indoor:A1');
    panel.hide();

    expect(container.style.display).toBe('none');
  });

  it('should show details for complex object ids', () => {
    panel.showObjectInfo('hvac:outdoor:platform:unit1');

    expect(container.innerHTML).toContain('hvac');
    expect(container.innerHTML).toContain('outdoor');
    expect(container.innerHTML).toContain('platform:unit1');
  });
});
