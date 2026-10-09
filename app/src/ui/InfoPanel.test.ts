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
    expect(created.some((element) => element.textContent === '仅表示面板—回路—点位归属，不表示电缆、线管或墙内/吊顶内/地面施工路径')).toBe(true);
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

describe('InfoPanel · 工程状态通用渲染器', () => {
  let elements: ReturnType<typeof setupDOM>;

  beforeEach(() => {
    elements = setupDOM();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createdTexts = (): string[] =>
    (document.createElement as ReturnType<typeof vi.fn>).mock.results.map((result) => result.value.textContent as string);

  it('通用渲染器遍历状态记录字段，不按类别分支：status/statusSource/openQuestion/decision/conflicts 全显形', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.showObject({
      objectId: 'electrical:sock_child_ac', name: '儿童房空调插座', type: 'electrical',
      elementState: {
        id: 'electrical:sock_child_ac', kind: 'electrical', label: 'socket', status: 'pending',
        statusSource: 'pending-site-data #42', decision: 'DEC-2026-10-09-E01',
        openQuestion: { ref: '42', summary: '儿童房空调电源', blockedBy: '卡在空调厂家深化图' },
        conflicts: ['spatial.collision', 'clearance'],
      },
    });
    const texts = createdTexts();
    expect(texts).toContain('工程状态');
    expect(texts).toContain('状态：');
    expect(texts).toContain('待现场数据');       // status 标签
    expect(texts).toContain('pending-site-data #42'); // statusSource
    expect(texts).toContain('DEC-2026-10-09-E01');    // decision
    expect(texts).toContain('卡在空调厂家深化图');     // openQuestion.blockedBy
    expect(texts).toContain('spatial.collision，clearance'); // conflicts
    expect(elements.topics.appendChild).toHaveBeenCalled();
  });

  it('同一渲染器服务不同 kind：电气与吊顶的状态记录走同一条字段遍历（无按类分支）', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.showObject({
      objectId: 'ceiling:ceiling_living', name: '客厅吊顶', type: 'ceiling_zone_solid',
      elementState: {
        id: 'ceiling:ceiling_living', kind: 'ceiling', label: 'gypsum', status: 'confirmed',
        statusSource: 'config:confirmed', conflicts: [],
      },
    });
    const texts = createdTexts();
    expect(texts).toContain('工程状态');
    expect(texts).toContain('已确认');
    expect(texts).toContain('config:confirmed');
    // 无 openQuestion/decision/conflicts 时不渲染对应行
    expect(texts).not.toContain('卡在');
    expect(texts).not.toContain('冲突：');
  });

  it('没有 elementState 时不渲染工程状态节（不打扰既有 MEP/吊顶读数）', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.showObject({ objectId: 'floor:living_dining', name: '客餐厅', type: 'floor', room: 'living_dining' });
    expect(createdTexts()).not.toContain('工程状态');
  });
});
