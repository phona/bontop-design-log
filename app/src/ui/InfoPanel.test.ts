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
  const objectId = createSpan() as HTMLSpanElement;
  const type = createSpan() as HTMLSpanElement;
  const room = createSpan() as HTMLSpanElement;
  const topics = createDiv() as HTMLDivElement;

  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => {
      if (id === 'info-panel') return infoPanel;
      if (id === 'info-panel-title') return title;
      if (id === 'info-panel-object-id') return objectId;
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
      append: vi.fn(),
      children: [],
      onclick: null,
    })),
  });

  return { infoPanel, title, objectId, type, room, topics };
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
    expect(elements.objectId.textContent).toBe('objectId: floor:living_dining');
    expect(elements.type.textContent).toBe('floor');
  });

  it('renders whitelisted MEP context without exposing unrelated fields', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.showObject({
      objectId: 'mep:route:main', name: '主干', type: 'mep_coordination_route',
      mep: { routeId: 'main', from: 'panel', to: 'socket', status: 'inferred', sourceStatus: 'proposed', constructionStatus: 'pending', reason: '待确认', notForConstruction: true },
    });
    expect(elements.topics.appendChild).toHaveBeenCalled();
    const section = (elements.topics.appendChild as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(section.className).toBe('info-topic-section info-mep-context');
    expect(elements.topics.appendChild).toHaveBeenCalledTimes(1);
  });

  it('renders electrical topology circuit context and pending parameters', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.setElectricalTopology({
      version: '1', panels: [], controls: [], pending_parameters: ['capacity pending'],
      circuits: [{ id: 'ordinary', panel_id: 'strong', purpose: 'ordinary_power', status: 'proposed', member_point_ids: ['light'], note: 'declared' }],
    });
    panel.showObject({
      objectId: 'electrical-topology:circuit:ordinary', name: 'ordinary', type: 'electrical_topology_circuit',
      electricalTopology: { circuitIds: ['ordinary'], controlIds: ['light_control'], notes: [], panelId: 'strong', memberPointIds: ['light'], purpose: 'ordinary_power', status: 'proposed', pendingParameters: ['capacity pending'], controlsIncomplete: true, controlsPending: true },
    });
    expect(elements.topics.appendChild).toHaveBeenCalled();
    const created = (document.createElement as ReturnType<typeof vi.fn>).mock.results.map((result) => result.value);
    expect(created.some((element) => element.textContent === '用途：')).toBe(true);
    expect(created.some((element) => element.textContent === '普通功能电源')).toBe(true);
    expect(created.some((element) => element.textContent === '关联控制组：')).toBe(true);
    expect(created.some((element) => element.textContent === '未闭合')).toBe(true);
    expect(created.some((element) => element.textContent === '待确认')).toBe(true);
    expect(created.some((element) => element.textContent === '非施工实体逻辑关系，仅用于表达回路与控制关系')).toBe(true);
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
