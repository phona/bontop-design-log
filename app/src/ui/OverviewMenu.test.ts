import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverviewMenu } from './OverviewMenu.js';
import type { Topic, CurrentScheme, DecisionLogEntry } from '@shared/types';

function createDiv() {
  return {
    innerHTML: '',
    style: { display: '' },
    appendChild: vi.fn(),
    textContent: '',
  } as unknown as HTMLDivElement;
}

function setupDOM() {
  const menu = createDiv() as HTMLDivElement;
  const scheme = createDiv() as HTMLDivElement;
  const decisions = createDiv() as HTMLDivElement;
  const budget = createDiv() as HTMLDivElement;
  const risks = createDiv() as HTMLDivElement;
  const archives = createDiv() as HTMLDivElement;
  const archiveInput = { value: '', addEventListener: vi.fn() } as unknown as HTMLInputElement;
  const archiveBtn = { addEventListener: vi.fn() } as unknown as HTMLButtonElement;
  const phaseSelect = { value: 'full', disabled: false, addEventListener: vi.fn() } as unknown as HTMLSelectElement;
  const phaseStatus = { textContent: '' } as unknown as HTMLElement;

  vi.stubGlobal('document', {
    getElementById: vi.fn((id: string) => {
      if (id === 'overview-menu') return menu;
      if (id === 'overview-scheme') return scheme;
      if (id === 'overview-decisions') return decisions;
      if (id === 'overview-budget') return budget;
      if (id === 'overview-risks') return risks;
      if (id === 'overview-archives') return archives;
      if (id === 'archive-name-input') return archiveInput;
      if (id === 'archive-current-btn') return archiveBtn;
      if (id === 'phase-select') return phaseSelect;
      if (id === 'phase-status') return phaseStatus;
      return null;
    }),
    createElement: vi.fn((tag: string) => ({
      tagName: tag,
      className: '',
      textContent: '',
      innerHTML: '',
      style: {},
      appendChild: vi.fn(),
      addEventListener: vi.fn(),
    })),
  });

  return { menu, scheme, decisions, budget, risks, archives, archiveInput, archiveBtn, phaseSelect, phaseStatus };
}

const mockTopics: Topic[] = [
  {
    id: 'hvac',
    name: '空调方案',
    options: [
      { id: 'A2', name: 'A2 美的理想家 III' },
      { id: 'A1', name: 'A1 格力 Star Ⅱ' },
    ],
    apply: () => [],
  },
];

const mockScheme: CurrentScheme = {
  updatedAt: '2026-07-06T00:00:00Z',
  selections: {
    hvac: { default: 'A2', roomOverrides: {} },
  },
};

const mockDecisions: DecisionLogEntry[] = [
  {
    id: 'dec_001',
    topic: 'hvac',
    roomId: null,
    optionId: 'A2',
    previousOptionId: 'A1',
    archiveId: null,
    path: 'hvac.default',
    source: 'user',
    createdAt: '2026-07-06T10:00:00Z',
  },
];

describe('OverviewMenu', () => {
  let elements: ReturnType<typeof setupDOM>;

  beforeEach(() => {
    elements = setupDOM();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggles visibility', () => {
    const menu = new OverviewMenu();
    expect(menu.isVisible()).toBe(false);

    menu.toggle();
    expect(menu.isVisible()).toBe(true);
    expect(elements.menu.style.display).toBe('block');

    menu.toggle();
    expect(menu.isVisible()).toBe(false);
    expect(elements.menu.style.display).toBe('none');
  });

  it('renders current scheme', () => {
    const menu = new OverviewMenu();
    menu.setTopics(mockTopics);
    menu.setScheme(mockScheme);
    menu.show();

    const rows = elements.scheme.appendChild as ReturnType<typeof vi.fn>;
    expect(rows).toHaveBeenCalled();
  });

  it('renders decision log', () => {
    const menu = new OverviewMenu();
    menu.setTopics(mockTopics);
    menu.setDecisionLog(mockDecisions);
    menu.show();

    const rows = elements.decisions.appendChild as ReturnType<typeof vi.fn>;
    expect(rows).toHaveBeenCalled();
  });

  it('shows empty message when no decisions', () => {
    const menu = new OverviewMenu();
    menu.setDecisionLog([]);
    menu.show();

    const rows = elements.decisions.appendChild as ReturnType<typeof vi.fn>;
    expect(rows).toHaveBeenCalled();
  });

  it('renders the selected phase and disables the selector while loading', () => {
    const menu = new OverviewMenu();
    menu.setPhase('phase_1_basic_occupancy');
    expect(elements.phaseSelect.value).toBe('phase_1_basic_occupancy');
    expect(elements.phaseStatus.textContent).toBe('当前：一期基本入住');

    menu.setPhaseLoading(true);
    expect(elements.phaseSelect.disabled).toBe(true);
    expect(elements.phaseStatus.textContent).toBe('阶段切换中…');
    menu.setPhaseLoading(false);
    menu.setPhase('full');
    expect(elements.phaseSelect.disabled).toBe(false);
    expect(elements.phaseStatus.textContent).toBe('当前：完整方案');
  });

  it('uses the phase ceiling instead of the legacy category total', () => {
    const menu = new OverviewMenu();
    menu.setBudget({
      totalBudget: 208000,
      phaseCeiling: 200000,
      phaseAllocated: 200000,
      phaseUnallocated: 0,
      totalActual: 10000,
      categories: [],
      lineItems: [],
    } as any);
    menu.show();
    const rendered = (elements.budget.appendChild as ReturnType<typeof vi.fn>).mock.calls
      .map(([child]) => String(child.innerHTML ?? '')).join('\n');
    expect(rendered).toContain('阶段上限');
    expect(rendered).toContain('已分配');
    expect(rendered).toContain('未分配');
    expect(rendered).toContain('场景动态估算');
    expect(rendered).not.toContain('剩余');
    expect(rendered).toContain('200,000');
    expect(rendered).not.toContain('208,000');
  });
});
