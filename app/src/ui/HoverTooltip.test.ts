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

  it('shows tooltip with object name and objectId', () => {
    tooltip.update({ objectId: 'floor:room_a', name: '客餐厅', type: 'floor', room: 'living_dining' });
    expect(el.style.display).toBe('block');
    expect(el.textContent).toBe('客餐厅\nobjectId: floor:room_a');
  });

  it('hides tooltip when target is null', () => {
    tooltip.update({ objectId: 'floor:room_a', name: '客餐厅', type: 'floor' });
    tooltip.update(null);
    expect(el.style.display).toBe('none');
  });

  it('does not update if same objectId', () => {
    tooltip.update({ objectId: 'floor:room_a', name: '客餐厅', type: 'floor' });
    tooltip.update({ objectId: 'floor:room_a', name: 'Different', type: 'floor' });
    expect(el.textContent).toBe('客餐厅\nobjectId: floor:room_a');
  });

  it('clear resets state', () => {
    tooltip.update({ objectId: 'floor:room_a', name: '客餐厅', type: 'floor' });
    tooltip.clear();
    expect(tooltip.getCurrent()).toBeNull();
  });
});
