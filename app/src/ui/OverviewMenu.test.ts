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

  it('renders tile scenario subtotals as a comparison overlay without changing budget totals', () => {
    const menu = new OverviewMenu();
    menu.setBudget({
      totalBudget: 200000,
      totalActual: 50000,
      categories: [],
      lineItems: [],
      tileBudgetPreview: {
        status: 'comparison_overlay_only',
        includedInTotalActual: false,
        includedInCategoryTotals: false,
        scopeNote: '按干区净面积和8%损耗估算。',
        dryFloorMaterialAndOrdinaryLaborByCandidate: [
          { candidateId: 'kt_200x1200', supplier: 'KT', netAreaSqm: 111.864, modeledDryFloorMaterialYuan: 14616, ordinaryLaborRateYuanPerSqm: 75, ordinaryLaborSubtotalYuan: 8389.8, sameScopeSubtotalYuan: 23005.8, scopeNote: '常规铺贴' },
          { candidateId: 'jinyi_approx_900x150', supplier: '金意陶', netAreaSqm: 111.864, modeledDryFloorMaterialYuan: 15931, ordinaryLaborRateYuanPerSqm: 75, ordinaryLaborSubtotalYuan: 8389.8, sameScopeSubtotalYuan: 24320.8, scopeNote: '常规铺贴' },
        ],
      },
    } as any);
    menu.show();

    const rendered = (elements.budget.appendChild as ReturnType<typeof vi.fn>).mock.calls
      .map(([child]) => String(child.textContent ?? child.innerHTML ?? '')).join('\n');
    expect(rendered).toContain('已用');
    expect(rendered).toContain('瓷砖方案对比（干区地面）');
    expect(rendered).toContain('KT 200×1200：材料+普通铺贴 ¥23,005.8（111.86㎡，铺贴¥75/㎡）');
    expect(rendered).toContain('金意陶约900×150：材料+普通铺贴 ¥24,320.8（111.86㎡，铺贴¥75/㎡）');
    expect(rendered).toContain('不计入整包“已用”');
    expect(rendered).toContain('整包分类合计仍按现有预算计算，不含此叠加');
    expect(rendered).toContain('卫浴、墙砖、阳台及杂项另计');
    expect(rendered).toContain('不重复计入');
  });

  it('renders the paint scope/usage reconciliation without changing budget totals', () => {
    const menu = new OverviewMenu();
    menu.setBudget({
      totalBudget: 200000,
      totalActual: 50000,
      categories: [],
      lineItems: [],
      paintBudgetPreview: {
        status: 'comparison_overlay_only',
        includedInTotalActual: false,
        includedInCategoryTotals: false,
        scopeNote: 'walls + ceilings, openings not deducted',
        scope: {
          entries: [],
          paintRoomCount: 5,
          wallRegionEntryCount: 22,
          wallAreaByRoom: { master_bedroom: 27.622 },
          grossWallAreaSqm: 155.652,
          doorGapAreaSqm: 13.23,
          windowGapAreaSqm: 0,
          netWallAreaSqm: 142.422,
          ceilingAreaByRoom: { master_bedroom: 26.844 },
          ceilingAreaSqm: 103.224,
          grossAreaSqm: 258.876,
          netAreaSqm: 245.646,
          highlightedIn3d: 'walls_only',
        },
        material: { id: 'latex_paint_01', name: '金装净味五合一', brand: '多乐士', unit: '桶', pricePerUnit: 580, coveragePerUnit: 120, lossRate: 1.1, priceYuanPerSqmPerCoat: 4.83 },
        labor: { rateYuanPerSqm: 25, rateSource: 'config/budget/base.json', scopeNote: '涂刷相关人工' },
        reconciliation: { pkgId: 'PKG-080', plannedCny: 11500, ownerTargetCny: 11000, modeledRangeCny: [10797.78, 12732.03], selectedScenarioId: null },
        scenarios: [
          { scenarioId: 'topcoats2_deduct', topcoats: 2, deductOpenings: true, areaSqm: 245.646, topcoatBuckets: 5, primerBuckets: 3, totalBuckets: 8, materialYuan: 4640, laborRateYuanPerSqm: 25, laborYuan: 6141.15, subtotalYuan: 10781.15, vsPlannedDeltaYuan: -718.85, vsOwnerTargetDeltaYuan: -218.85 },
          { scenarioId: 'topcoats1_deduct', topcoats: 1, deductOpenings: true, areaSqm: 245.646, topcoatBuckets: 3, primerBuckets: 3, totalBuckets: 6, materialYuan: 3480, laborRateYuanPerSqm: 25, laborYuan: 6141.15, subtotalYuan: 9621.15, vsPlannedDeltaYuan: -1878.85, vsOwnerTargetDeltaYuan: -1378.85 },
        ],
        assumptions: [],
        feesStatus: {},
        warnings: ['底漆单价/覆盖率未确认（primer_price_status / primer_coverage_status），材料费含未确认假设'],
      },
    } as any);
    menu.show();

    const rendered = (elements.budget.appendChild as ReturnType<typeof vi.fn>).mock.calls
      .map(([child]) => String(child.textContent ?? child.innerHTML ?? '')).join('\n');
    expect(rendered).toContain('涂漆范围与用量（墙+顶）');
    expect(rendered).toContain('毛墙面 155.65㎡ − 门洞 13.23㎡ − 窗洞 0.00㎡ = 净墙面 142.42㎡（3D 已高亮）+ 顶面 103.22㎡');
    expect(rendered).toContain('面漆2遍、扣门窗洞：245.65㎡ → 面漆 5 桶 + 底漆 3 桶，材料 ¥4,640 + 人工 ¥6,141.15 = ¥10,781.15（低于计划 ¥718.85）');
    expect(rendered).toContain('面漆1遍、扣门窗洞：245.65㎡ → 面漆 3 桶 + 底漆 3 桶，材料 ¥3,480 + 人工 ¥6,141.15 = ¥9,621.15（低于计划 ¥1,878.85）');
    expect(rendered).toContain('不计入整包');
    expect(rendered).toContain('COST-080-01/02/04');
    expect(rendered).toContain('⚠ 底漆单价/覆盖率未确认');
  });

  it('omits the paint scenario block when no preview is supplied', () => {
    const menu = new OverviewMenu();
    menu.setBudget({ totalBudget: 200000, totalActual: 50000, categories: [], lineItems: [] } as any);
    menu.show();
    const rendered = (elements.budget.appendChild as ReturnType<typeof vi.fn>).mock.calls
      .map(([child]) => String(child.textContent ?? child.innerHTML ?? '')).join('\n');
    expect(rendered).not.toContain('涂漆范围与用量');
  });

  it('omits the tile scenario block when no preview is supplied', () => {
    const menu = new OverviewMenu();
    menu.setBudget({ totalBudget: 200000, totalActual: 50000, categories: [], lineItems: [] });
    menu.show();
    const rendered = (elements.budget.appendChild as ReturnType<typeof vi.fn>).mock.calls
      .map(([child]) => String(child.textContent ?? child.innerHTML ?? '')).join('\n');
    expect(rendered).not.toContain('瓷砖方案对比');
  });
});
