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

  return { menu, scheme, decisions, budget, risks, archives, archiveInput, archiveBtn };
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
});
