import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InfoPanel } from './InfoPanel.js';
import type { Topic, CurrentScheme } from '@shared/types';

function createSpan() {
  return { textContent: '' } as unknown as HTMLSpanElement;
}

function createDiv() {
  return {
    innerHTML: '',
    style: { display: '' },
    appendChild: vi.fn(),
    textContent: '',
  } as unknown as HTMLDivElement;
}

function setupDOM() {
  const infoPanel = createDiv() as HTMLDivElement;
  const title = createSpan() as HTMLSpanElement;
  const type = createSpan() as HTMLSpanElement;
  const room = createSpan() as HTMLSpanElement;
  const topics = createDiv() as HTMLDivElement;

  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => {
      if (id === 'info-panel') return infoPanel;
      if (id === 'info-panel-title') return title;
      if (id === 'info-panel-type') return type;
      if (id === 'info-panel-room') return room;
      if (id === 'info-panel-topics') return topics;
      return null;
    }),
    createElement: vi.fn((tag: string) => ({
      tagName: tag,
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      appendChild: vi.fn(),
      onclick: null,
    })),
  });

  return { infoPanel, title, type, room, topics };
}

const mockTopics: Topic[] = [
  {
    id: 'floor',
    name: '地砖方案',
    options: [
      { id: 'floor_01', name: '浅胡桃木纹砖' },
      { id: 'floor_02', name: '灰色水泥砖' },
    ],
    apply: () => [],
  },
  {
    id: 'paint',
    name: '乳胶漆方案',
    options: [
      { id: 'paint_01', name: '金装净味五合一' },
    ],
    apply: () => [],
  },
];

const mockScheme: CurrentScheme = {
  updatedAt: '2026-07-06T00:00:00Z',
  selections: {
    floor: { default: 'floor_01', roomOverrides: {} },
    paint: { default: 'paint_01', roomOverrides: { master_bedroom: 'paint_02' } },
  },
};

describe('InfoPanel', () => {
  let elements: ReturnType<typeof setupDOM>;

  beforeEach(() => {
    elements = setupDOM();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows and hides', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'floor:living_dining', name: '客餐厅', type: 'floor', room: 'living_dining' });
    expect(elements.infoPanel.style.display).toBe('block');

    panel.hide();
    expect(elements.infoPanel.style.display).toBe('none');
  });

  it('displays object name and type', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'floor:living_dining', name: '客餐厅', type: 'floor', room: 'living_dining' });

    expect(elements.title.textContent).toBe('客餐厅');
    expect(elements.type.textContent).toBe('floor');
  });

  it('calls onSelectOption with room scope', () => {
    const onSelect = vi.fn();
    const panel = new InfoPanel({ onSelectOption: onSelect });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'floor:living_dining', name: '客餐厅', type: 'floor', room: 'living_dining' });

    expect(onSelect).not.toHaveBeenCalled();
  });
});
