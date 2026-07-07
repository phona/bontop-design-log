import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HoverTooltip } from './HoverTooltip.js';

function createElement(id: string) {
  return {
    id,
    style: { display: '' },
    textContent: '',
  } as unknown as HTMLDivElement;
}

describe('HoverTooltip', () => {
  let tooltip: HoverTooltip;
  let el: HTMLDivElement;

  beforeEach(() => {
    el = createElement('hover-tooltip') as HTMLDivElement;
    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => (id === 'hover-tooltip' ? el : null)),
    });
    tooltip = new HoverTooltip();
  });

  it('shows tooltip with object name', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room', room: 'living_dining' });
    expect(el.style.display).toBe('block');
    expect(el.textContent).toBe('客餐厅');
  });

  it('hides tooltip when target is null', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.update(null);
    expect(el.style.display).toBe('none');
  });

  it('does not update if same objectId', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.update({ objectId: 'room_a', name: 'Different', type: 'room' });
    expect(el.textContent).toBe('客餐厅');
  });

  it('clear resets state', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.clear();
    expect(tooltip.getCurrent()).toBeNull();
  });
});
