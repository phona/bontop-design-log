import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GanttPanel, type GanttScenarioView } from './GanttPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type {
  SchedulePackageProjectionView,
  SchedulePackageView,
  ScheduleProjectionView,
  ScheduleSnapshot,
  ScheduleWindowView,
} from '@shared/schedule-state';

// 合成快照覆盖任务书 §4 的全部形态：
//  - PKG-010 单值包（start=end_min=end_max），用来对照「单值不得画成区间条」；
//  - PKG-020 区间包（start 2 / 下界 3 / 上界 4），两条时间线的核心段 + 斜纹尾段都要在；
//  - PKG-030 带 hostile 字符串的包名 / 阻塞解释 / 约束说明（XSS 用例）；
//  - 默认无锚点：ordinals[].date 全 null，横轴只能出「第 N 工作日」（§18）。
function windowView(start: number, endMin: number, endMax: number): ScheduleWindowView {
  return {start_ord: start, end_ord_min: endMin, end_ord_max: endMax};
}

function projectionPkg(overrides: Partial<SchedulePackageProjectionView> = {}): SchedulePackageProjectionView {
  return {
    duration_workdays: {min: 1, max: 1},
    baseline: windowView(1, 1, 1),
    forecast: windowView(1, 1, 1),
    check_window: null,
    blocking_reasons: [],
    constraints: [],
    ...overrides,
  };
}

function scheduleView(overrides: Partial<ScheduleProjectionView> = {}): ScheduleProjectionView {
  return {
    anchor_date: null,
    calendar: {workdays: [1, 2, 3, 4, 5], rest_dates: [], extra_workdates: []},
    ordinals: [1, 2, 3, 4, 5, 6].map((ord) => ({ord, date: null})),
    packages: {
      'PKG-010': projectionPkg(),
      'PKG-020': projectionPkg({
        duration_workdays: {min: 1, max: 2},
        baseline: windowView(2, 3, 4),
        forecast: windowView(2, 3, 4),
        blocking_reasons: ['依赖 PKG-010 未通过'],
        constraints: [
          {id: 'CON-020-A', type: 'not_before', status: 'site_pending', detail: '装修押金缴纳后才能进场', date: null},
        ],
      }),
      'PKG-030': projectionPkg({
        baseline: windowView(5, 6, 6),
        forecast: windowView(5, 6, 6),
        blocking_reasons: ['<i>等外部条件</i>开发商放行'],
        constraints: [
          {
            id: 'CON-030-A',
            type: 'not_before',
            status: 'site_pending',
            detail: '<script>window.__gantt_pwned2=1</script>物业允许施工时段',
            date: null,
          },
        ],
      }),
    },
    ...overrides,
  };
}

function pkg(overrides: Partial<SchedulePackageView> = {}): SchedulePackageView {
  return {
    id: 'PKG-010',
    name: '拆改与砌筑',
    sequence: 10,
    description: '',
    status: 'in_progress',
    readiness: 'ready',
    effective_readiness: 'ready',
    effective_status: 'in_progress',
    dependencies: [],
    owner_roles: ['施工方'],
    payment_gate: 'GATE-010-A',
    gate_label: '付款门槛',
    gate_status: 'pending',
    blockers: [],
    budget: {
      planned_cny: 0,
      contracted_cny: null,
      paid_cny: null,
      forecast_cny: null,
      component_count: 0,
      unpriced_count: 0,
    },
    checks: [],
    targets: ['pkg.test_object'],
    project_fingerprint: 'a'.repeat(64),
    ...overrides,
  };
}

function snapshot(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    phase: {
      id: 'phase_1_basic_occupancy',
      status: 'in_progress',
      current_gate: 'GATE-量房冻结',
      ceiling_cny: 300000,
      allocated_cny: 250000,
      unallocated_cny: 50000,
      known_pending_gap_cny: 2000,
    },
    counts: {
      packages: 3,
      checks: 0,
      cost_components: 0,
      unpriced_components: 0,
      open_decision_gates: 0,
      open_gated_checks: 0,
      ready_packages: 1,
    },
    data_fingerprint: 'f'.repeat(64),
    packages: [
      pkg(),
      pkg({id: 'PKG-020', name: '水电改造', sequence: 20}),
      pkg({
        id: 'PKG-030',
        name: '<img src=x onerror="window.__gantt_pwned=1">瓦工铺贴',
        sequence: 30,
        status: 'not_started',
        effective_status: 'not_started',
      }),
    ],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: [],
    stale_audits: [],
    package_gate_issues: [],
    schedule: scheduleView(),
    coordination: {},
    ...overrides,
  };
}

/**
 * what-if 响应：§6.1 的 schedule 键平铺 + scenario（设计 §6.2）+ 同次 load 的数据指纹
 * （Codex 一审 blocking，PR #218：面板凭它验明演算与所显示基线同版本，不符即丢弃）。
 * 默认指纹与 snapshot() 的 data_fingerprint 相同（'f'.repeat(64)）——相符才呈现。
 */
function whatIfPayload(fingerprint = 'f'.repeat(64)): ScheduleProjectionView & {scenario: GanttScenarioView; data_fingerprint: string} {
  const shifted = scheduleView({
    packages: {
      'PKG-010': projectionPkg(),
      'PKG-020': projectionPkg({baseline: windowView(2, 3, 4), forecast: windowView(5, 6, 7)}),
      'PKG-030': projectionPkg({baseline: windowView(5, 6, 6), forecast: windowView(8, 9, 9)}),
    },
  });
  return {
    ...shifted,
    scenario: {
      overrides: [{pkg: 'PKG-020', workdays: 3}],
      affected: [{pkg: 'PKG-020', delta: 3}, {pkg: 'PKG-030', delta: 3}],
    },
    data_fingerprint: fingerprint,
  };
}

interface StubOptions {
  state?: ScheduleSnapshot;
  whatIf?: unknown;
}

function stubFetch(options: StubOptions = {}): ReturnType<typeof vi.fn> {
  const state = options.state ?? snapshot();
  const whatIf = options.whatIf ?? whatIfPayload();
  const mock = vi.fn(async (url: string) => (
    String(url).includes('/api/schedule/what-if')
      ? {ok: true, status: 200, json: async () => whatIf}
      : {ok: true, status: 200, json: async () => state}
  ));
  vi.stubGlobal('fetch', mock as never);
  return mock as unknown as ReturnType<typeof vi.fn>;
}

function installDom(): void {
  document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
}

const bodyText = (): string => (document.querySelector('#gantt-body') as HTMLElement | null)?.textContent ?? '';

/** jsdom 不做布局（clientWidth 恒 0）；窄容器用例显式 stub 容器实测宽（同 FlowChartPanel 测）。 */
function stubClientWidth(width: number): () => void {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {configurable: true, get: () => width});
  return () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}

describe('GanttPanel', () => {
  beforeEach(() => {
    installDom();
  });

  // 任务书 §4-1 / 设计 §7：min/max 画区间条，不是单值条；文字必须同时标下界与上界。
  it('区间条渲染 min/max：核心段 + 斜纹尾段，文字同时标下界与上界（不是单值条）', async () => {
    stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
    const baseline = row.querySelector('.gantt-bar[data-lane="baseline"]') as HTMLElement;
    // 两条边界都进 DOM（起点 2 / 下界 3 / 上界 4）
    expect(baseline.dataset.startOrd).toBe('2');
    expect(baseline.dataset.endMin).toBe('3');
    expect(baseline.dataset.endMax).toBe('4');
    expect(baseline.querySelector('.gantt-bar-core')).toBeTruthy();
    expect(baseline.querySelector('.gantt-bar-tail')).toBeTruthy();
    // 几何口径：minOrd=1 / maxOrd=6（PKG-030 的上界）→ span 6
    expect(parseFloat(baseline.style.left)).toBeCloseTo(16.667, 2);
    expect(parseFloat(baseline.style.width)).toBeCloseTo(50, 2);
    // 颜色之外必须有文字：上下界逐字在行里
    expect(row.textContent).toContain('基线：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    const forecast = row.querySelector('.gantt-bar[data-lane="forecast"]') as HTMLElement;
    expect(forecast.dataset.startOrd).toBe('2');
    expect(forecast.dataset.endMin).toBe('3');
    expect(forecast.dataset.endMax).toBe('4');

    // 单值包没有斜纹尾段（只在 min≠max 时出现），避免把单值也画成区间
    const row010 = document.querySelector('.gantt-row[data-pkg-id="PKG-010"]') as HTMLElement;
    expect(row010.querySelector('.gantt-bar[data-lane="baseline"] .gantt-bar-tail')).toBeNull();
    // 宽容器不落移动端标记
    expect(document.querySelector('#gantt-chart')?.hasAttribute('data-gantt-mobile')).toBe(false);
  });

  // 任务书 §4-2 / 设计 §18：无锚点 → 坐标轴与条几何不出现日期；检查记录窗口的
  // checked_at 证据日期是另一件事（§17 明确保留），由下一条 check_window 用例钉住。
  it('无锚点：横轴与区间条不出现日期字符串（检查记录证据日期另行允许）', async () => {
    stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-axis')).toBeTruthy());

    const axis = document.querySelector('#gantt-axis') as HTMLElement;
    expect(axis.textContent).toContain('第 1 工作日');
    expect(axis.textContent).toContain('第 6 工作日');
    expect(document.querySelector('#gantt-head')?.textContent).toContain('锚点：未定｜横轴：第 N 工作日（不显示日期）');
    // 面板不得自行造年月日：轴、来源行与条几何（title/data-*）都没有 YYYY-MM-DD。
    expect(axis.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(document.querySelector('#gantt-head')?.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const bar of Array.from(document.querySelectorAll('.gantt-bar'))) {
      expect((bar as HTMLElement).title).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect((bar as HTMLElement).textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('锚点就绪：横轴刻度带快照 ordinals 的真实日期（不自行造日期）', async () => {
    const view = scheduleView({
      anchor_date: '2026-03-02',
      ordinals: [
        {ord: 1, date: '2026-03-02'},
        {ord: 2, date: '2026-03-03'},
        {ord: 3, date: '2026-03-04'},
        {ord: 4, date: '2026-03-05'},
        {ord: 5, date: '2026-03-06'},
        {ord: 6, date: '2026-03-09'},
      ],
    });
    stubFetch({state: snapshot({schedule: view})});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-axis')).toBeTruthy());

    expect((document.querySelector('#gantt-axis') as HTMLElement).textContent).toContain('2026-03-02');
    expect(document.querySelector('#gantt-head')?.textContent).toContain('锚点：已定（2026-03-02）｜横轴：真实日期');
  });

  // 任务书 §4-3 / D5：点条只写 selection，面板没有 3D 高亮入口。
  it('点条写 selection 且面板不存在高亮入口（D5）', async () => {
    const mock = stubFetch();
    const selection = new ScheduleSelectionStore();
    const panel = new GanttPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    // 点「条」本身（事件冒泡到行）；只写选中态，不触发 3D 高亮
    (document.querySelector('.gantt-row[data-pkg-id="PKG-020"] .gantt-bar[data-lane="forecast"]') as HTMLElement).click();
    expect(selection.get()).toEqual({packageId: 'PKG-020', checkId: null});
    // 本面板没有 3D 高亮按钮/钩子，也从不拉 /api/model-package-links（D5/任务书 §1.1）
    expect(document.querySelector('#gantt-panel #gantt-highlight')).toBeNull();
    expect((panel as unknown as {onHighlight?: unknown}).onHighlight).toBeUndefined();
    for (const args of mock.mock.calls) {
      expect(String(args[0])).not.toContain('/api/model-package-links');
    }
    // 选中态进地址栏（既有 hash 机制），但没有跳 3D 的副作用
    expect(location.hash).toContain('pkg=PKG-020');
    expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')?.getAttribute('data-active')).toBe('true');
  });

  // 任务书 §4-4 / 设计 §6.2 + §12：delay → GET what-if → 响应重渲；水印固定在场。
  it('what-if：delay 输入发出正确 query、用响应重渲，scenario 水印固定在场', async () => {
    const mock = stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    // 水印在基线视图里就必须在场（不是演算后才有）
    expect(document.querySelector('#gantt-scenario')?.textContent).toContain('演算视图，非计划；落配置走 AI 会话/PR');

    const input = document.querySelector('#gantt-delay-input') as HTMLInputElement;
    input.value = 'PKG-020:3';
    input.dispatchEvent(new Event('input'));
    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('true'));
    const call = mock.mock.calls.find((args) => String(args[0]).includes('/api/schedule/what-if'));
    expect(call).toBeTruthy();
    const url = new URL(String(call![0]), 'http://local.invalid');
    expect(url.searchParams.get('delay')).toBe('PKG-020:3');

    // 区间条来自演算响应：PKG-020 的预测窗口整体右移 3 个工作日
    const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
    expect(row.textContent).toContain('预测：起点 第 5 工作日｜下界 第 6 工作日｜上界 第 7 工作日');
    expect(row.textContent).toContain('基线：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    const note = document.querySelector('#gantt-scenario-note') as HTMLElement;
    expect(note.textContent).toContain('演算入参：PKG-020 +3 工作日');
    expect(note.textContent).toContain('受影响 2 包');
    expect(note.textContent).toContain('PKG-030 +3 工作日');
    expect(document.querySelector('#gantt-scenario')?.textContent).toContain('演算视图，非计划；落配置走 AI 会话/PR');
    // 来源行必须跟着当前视图走：演算视图不得继续写「数据只读自 /api/schedule/state」。
    const headText = document.querySelector('#gantt-head')?.textContent ?? '';
    expect(headText).toContain('/api/schedule/what-if');
    expect(headText).not.toContain('/api/schedule/state');

    // 「回到基线」丢弃演算视图（不重新拉快照），条回到基线口径，来源行回到 state。
    (document.querySelector('#gantt-reset') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false'));
    expect((document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement).textContent)
      .toContain('预测：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    expect(document.querySelector('#gantt-head')?.textContent).toContain('/api/schedule/state');
  });

  it('先 200 后 503：失败刷新清空旧快照与演算，不画过期条', async () => {
    let stateCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/schedule/what-if')) {
        return {ok: true, status: 200, json: async () => whatIfPayload()};
      }
      stateCalls += 1;
      if (stateCalls === 1) return {ok: true, status: 200, json: async () => snapshot()};
      return {
        ok: false,
        status: 503,
        json: async () => ({error: 'schedule control invalid: 1 issue(s)', issues: ['PKG-010: bad constraint']}),
      };
    }) as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    // 先跑一次演算，证明失败刷新连演算结果一起丢弃。
    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('true'));

    await panel.refresh();
    await vi.waitFor(() => expect(document.querySelector('#gantt-error')).toBeTruthy());
    expect(bodyText()).toContain('HTTP 503');
    expect(bodyText()).toContain('本面板不渲染来自坏快照的数据');
    // 旧快照与旧演算都不得留在面板里冒充当前状态。
    expect(document.querySelector('.gantt-row')).toBeNull();
    expect(document.querySelector('.gantt-bar')).toBeNull();
    expect(document.querySelector('#gantt-chart')).toBeNull();
    expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false');
  });

  it('演算在途时刷新：后到的旧演算响应被丢弃，不把演算写回基线', async () => {
    let resolveWhatIf: (value: unknown) => void = () => {};
    const pendingWhatIf = new Promise<unknown>((resolve) => { resolveWhatIf = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/schedule/what-if')) return pendingWhatIf;
      return {ok: true, status: 200, json: async () => snapshot()};
    }) as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario-note')?.getAttribute('data-state')).toBe('pending'));
    // 刷新 = 回到基线，并作废在途演算。
    await panel.refresh();
    resolveWhatIf({ok: true, status: 200, json: async () => whatIfPayload()});
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false'));
    expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')?.textContent)
      .toContain('预测：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    expect(document.querySelector('#gantt-head')?.textContent).toContain('/api/schedule/state');
  });

  it('演算在途时点「回到基线」：后到的响应不得把演算写回来', async () => {
    let whatIfCalls = 0;
    let resolveSecond: (value: unknown) => void = () => {};
    const second = new Promise<unknown>((resolve) => { resolveSecond = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/schedule/what-if')) {
        whatIfCalls += 1;
        if (whatIfCalls === 1) return {ok: true, status: 200, json: async () => whatIfPayload()};
        return second;
      }
      return {ok: true, status: 200, json: async () => snapshot()};
    }) as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    // 第一次演算成功 → 结果生效（「回到基线」按钮可用）。
    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('true'));
    // 第二次演算在途时点重置：按钮可用且必须作废这次响应。
    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario-note')?.getAttribute('data-state')).toBe('pending'));
    (document.querySelector('#gantt-reset') as HTMLButtonElement).click();
    expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false');

    resolveSecond({ok: true, status: 200, json: async () => whatIfPayload()});
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false'));
    expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')?.textContent)
      .toContain('预测：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    expect(document.querySelector('#gantt-scenario-note')?.getAttribute('data-state')).toBe('baseline');
  });

  it('what-if 400：显示服务端原因（不静默吞掉），基线图仍在', async () => {
    const mock = vi.fn(async (url: string) => (
      String(url).includes('/api/schedule/what-if')
        ? {ok: false, status: 400, json: async () => ({error: 'delay 语法非法：PKG-020:x（须为 PKG-ID:正整数）'})}
        : {ok: true, status: 200, json: async () => snapshot()}
    ));
    vi.stubGlobal('fetch', mock as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    (document.querySelector('#gantt-what-if') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario-note')?.getAttribute('data-state')).toBe('error'));
    const note = document.querySelector('#gantt-scenario-note') as HTMLElement;
    expect(note.textContent).toContain('演算失败');
    expect(note.textContent).toContain('HTTP 400');
    expect(note.textContent).toContain('delay 语法非法');
    expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy();
  });

  // 任务书 §4-5：空数据 / 503 态必须有明确文字，不得渲染空骨架冒充正常。
  it('503 态：明确「取数失败」文字，不渲染任何条/轴', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({error: 'schedule control invalid: 1 issue(s)', issues: ['PKG-010: bad constraint']}),
    })) as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-error')).toBeTruthy());

    const text = bodyText();
    expect(text).toContain('取数失败');
    expect(text).toContain('HTTP 503');
    expect(text).toContain('schedule control invalid');
    expect(text).toContain('PKG-010: bad constraint');
    expect(document.querySelector('.gantt-row')).toBeNull();
    expect(document.querySelector('#gantt-chart')).toBeNull();
  });

  it('快照缺 schedule 键：明确空态文字，不画空时间轴', async () => {
    stubFetch({state: snapshot({schedule: undefined})});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-empty')).toBeTruthy());

    expect(bodyText()).toContain('快照没有排程投影');
    expect(bodyText()).toContain('不渲染空骨架');
    expect(document.querySelector('.gantt-row')).toBeNull();
    expect(document.querySelector('#gantt-axis')).toBeNull();
  });

  it('排程投影 packages 为空：明确空态文字，不画空时间轴', async () => {
    stubFetch({state: snapshot({schedule: scheduleView({packages: {}})})});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-empty')).toBeTruthy());

    expect(bodyText()).toContain('没有主车道工作包');
    expect(document.querySelector('.gantt-row')).toBeNull();
  });

  // 任务书 §4-6：包名/检查名/约束/阻塞解释全部过 escapeHtml。
  it('转义：包名 / 阻塞解释 / 约束说明里的 hostile 字符串不变形', async () => {
    stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-030"]')).toBeTruthy());

    const body = document.querySelector('#gantt-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('i')).toBeNull();
    expect((window as unknown as {__gantt_pwned?: number}).__gantt_pwned).toBeUndefined();
    expect(body.textContent).toContain('瓦工铺贴');
    expect(body.textContent).toContain('等外部条件');
    expect(body.textContent).toContain('物业允许施工时段');
  });

  // 任务书 §4-7：≤700px 退化列表（照 FlowChartPanel issue #83 先例）。
  it('≤700px：退化为包列表 + 序数条，不画时间轴；点击仍写 selection', async () => {
    stubFetch();
    const restore = stubClientWidth(334);
    try {
      const selection = new ScheduleSelectionStore();
      const panel = new GanttPanel(selection);
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

      expect(document.querySelector('#gantt-chart')?.getAttribute('data-gantt-mobile')).toBe('true');
      // 窄屏保留「序数条」：条仍在（相对 ordinals 上下界定位），只是不画日期轴/刻度。
      expect(document.querySelectorAll('.gantt-bar')).toHaveLength(6);
      expect(document.querySelectorAll('.gantt-timeline[data-gantt-mobile="true"]')).toHaveLength(3);
      expect(document.querySelector('#gantt-axis')).toBeNull();
      expect((document.querySelector('#gantt-chart') as HTMLElement).textContent).toContain('包列表 + 序数条');

      const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
      expect(row.textContent).toContain('基线：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
      row.click();
      expect(selection.get()).toEqual({packageId: 'PKG-020', checkId: null});
    } finally {
      restore();
    }
  });

  // 任务书 §1.1 / §16：check_window 是检查记录窗口（证据），只展示、不进计算。
  it('check_window 只作证据展示：固定注明「检查记录窗口，非施工起止」，序数待定不填 0', async () => {
    const view = scheduleView();
    view.packages['PKG-020'].check_window = {
      first_date: '2026-02-20',
      last_date: '2026-02-24',
      first_ord: null,
      last_ord: null,
    };
    stubFetch({state: snapshot({schedule: view})});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
    expect(row.textContent).toContain(
      '检查记录窗口：2026-02-20 – 2026-02-24｜序数待定（锚点未定）（检查记录窗口，非施工起止）',
    );
    // 序数 null 不得兜成 0（§17：null 不是 0，0 是锚点前一个工作日的合法序数）
    expect(row.querySelector('.gantt-check-window')?.textContent).not.toContain('第 0');
    // 证据窗口不参与几何：条仍按 baseline/forecast 画（check_window 没有被画成条）
    expect(row.querySelectorAll('.gantt-bar')).toHaveLength(2);
  });

  it('constraints 的 site_pending 标「待定」，阻塞解释随条展示', async () => {
    stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
    expect(row.textContent).toContain('约束 CON-020-A（not_before｜待定）：装修押金缴纳后才能进场');
    expect(row.textContent).toContain('阻塞解释：依赖 PKG-010 未通过');
  });

  // 任务书 §4-8 / §1.5 L2：甘特是 ordinals 的第一个消费方，只读不改写。
  it('L2 只读：渲染 + 点击前后 snapshot.schedule.ordinals 逐字节不变', async () => {
    const snap = snapshot();
    const before = JSON.stringify(snap.schedule?.ordinals);
    stubFetch({state: snap});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-020"]')).toBeTruthy());

    (document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement).click();
    panel.hide();

    expect(JSON.stringify(snap.schedule?.ordinals)).toBe(before);
    expect(snap.schedule?.ordinals).toEqual([1, 2, 3, 4, 5, 6].map((ord) => ({ord, date: null})));
  });

  it('show/hide/isVisible 状态正确', async () => {
    stubFetch();
    const panel = new GanttPanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-010"]')).toBeTruthy());
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#gantt-panel') as HTMLElement).style.display).toBe('none');
  });

  // ─── Codex 一审（PR #218）：取数状态机结构性重做——单 epoch + ready 门 + 版本核对 ───
  // 推翻的双计数器口径（refreshSeq/whatIfSeq 各管一段）：刷新在途时演算仍可发起、后到
  // 基线无提示清掉新演算；基线失败后到演算还能在错误条下画图。现在一条 dataEpoch 管
  // 全部路径，ready 之前阻塞演算，版本不符一律 fail-closed。

  // blocking 根治：服务端每次 what-if 都重载控制源。响应指纹与所显示基线不符 =
  // 新排程配旧包状态（一行之内新旧工程事实混排）。丢弃演算、明示、自动重取基线，
  // 且丢弃原因必须留在新鲜基线之上（不能被自动重取的 reset 清掉）。
  it('版本不符即丢弃：指纹不一致的演算不呈现；自动重取基线且丢弃原因留在新基线上', async () => {
    const state = snapshot();
    const fetchMock = stubFetch({state, whatIf: whatIfPayload('e'.repeat(64))});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-010"]')).toBeTruthy());

    (document.querySelector('#gantt-delay-input') as HTMLInputElement).value = 'PKG-020:3';
    (document.querySelector('#gantt-what-if') as HTMLElement).click();
    // 版本不符必须触发一次自动重取（基线 fetch 第二次）
    await vi.waitFor(() => expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/schedule/state')).length,
    ).toBe(2));

    // 演算未呈现：scenario 区回到非生效态，受影响清单（PKG-020 +3）不得出现
    expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false');
    expect(bodyText()).not.toContain('PKG-020 +3');
    // 丢弃原因保留；PKG-020 画的是声明基线 2/3/4，不是演算的 5/6/7
    expect(bodyText()).toContain('数据指纹不符');
    const row = document.querySelector('.gantt-row[data-pkg-id="PKG-020"]') as HTMLElement;
    expect(row.textContent).toContain('基线：起点 第 2 工作日｜下界 第 3 工作日｜上界 第 4 工作日');
    expect(row.textContent).not.toContain('上界 第 7 工作日');
  });

  // fail-closed：响应不带 data_fingerprint（旧形态/被裁剪）= 无法核对版本，不赌它同版本。
  it('响应无数据指纹（旧形态）：无法核对版本，丢弃演算并重取', async () => {
    const legacy = whatIfPayload();
    delete (legacy as {data_fingerprint?: string}).data_fingerprint;
    const fetchMock = stubFetch({whatIf: legacy});
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-010"]')).toBeTruthy());

    (document.querySelector('#gantt-what-if') as HTMLElement).click();
    await vi.waitFor(() => expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/schedule/state')).length,
    ).toBe(2));
    expect(bodyText()).toContain('未带数据指纹');
    expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false');
  });

  // major 根治（ready 门）：基线在途时演算按钮禁用，处理层也不发 what-if 请求——
  // 排队/混跑会把过期基线演算成新结论（Codex 探针：刷新完成后在途演算重新生效）。
  it('ready 前阻塞演算：基线在途时按钮禁用且处理层不发 what-if 请求', async () => {
    const fetchMock = vi.fn((url: string) => (
      String(url).includes('/api/schedule/what-if')
        ? Promise.resolve({ok: true, status: 200, json: async () => whatIfPayload()})
        : new Promise(() => {}) // 基线永在途
    ));
    vi.stubGlobal('fetch', fetchMock as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    panel['render'](); // 在途态渲染一次，钉 DOM 里的禁用态
    expect((document.querySelector('#gantt-what-if') as HTMLButtonElement).disabled).toBe(true);

    await panel['runWhatIf']();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/schedule/what-if'))).toBe(false);
    expect(bodyText()).toContain('基线加载中');
  });

  // 基线取数失败（payload 已清空）后同样不接受演算：错误条下不得借后到演算命重新画图。
  it('基线失败后阻塞演算：503 之后点演算不发请求，明示先加载成功', async () => {
    const fetchMock = vi.fn(async (url: string) => (
      String(url).includes('/api/schedule/what-if')
        ? {ok: true, status: 200, json: async () => whatIfPayload()}
        : {ok: false, status: 503, json: async () => ({error: 'schedule control invalid: 1 issue(s)', issues: ['demo']})}
    ));
    vi.stubGlobal('fetch', fetchMock as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#gantt-error')).toBeTruthy());

    await panel['runWhatIf']();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/schedule/what-if'))).toBe(false);
    expect(bodyText()).toContain('未取得基线快照');
  });

  // Codex 二审 major（PR #218）：重置作废在途基线加载后，必须接续 baselineLoading 的
  // 归属。探针同构路径：演算生效 → 切 tab 重开（refresh 在途）→ 点仍可用的「回到基线」。
  // 旧行为：在途 refresh 被顶掉后 finally 不清旗标 → 旧快照留着、永远卡「基线加载中」。
  it('刷新期间重置：接续基线加载，面板不卡在「基线加载中」', async () => {
    let stateCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/api/schedule/what-if')) {
        return Promise.resolve({ok: true, status: 200, json: async () => whatIfPayload()});
      }
      stateCalls += 1;
      // 第 2 次基线（切 tab 重开后的刷新）永在途——重置就发生在它上面
      if (stateCalls === 2) return new Promise(() => {});
      return Promise.resolve({ok: true, status: 200, json: async () => snapshot()});
    });
    vi.stubGlobal('fetch', fetchMock as never);
    const panel = new GanttPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.gantt-row[data-pkg-id="PKG-010"]')).toBeTruthy());

    // 演算生效（scenario active → 「回到基线」按钮可用）
    (document.querySelector('#gantt-delay-input') as HTMLInputElement).value = 'PKG-020:3';
    (document.querySelector('#gantt-what-if') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('true'));

    // 模拟「切 tab 重开」：第二次基线刷新在途（按钮被 ready 门禁用）
    void panel.refresh();
    panel['render']();
    expect((document.querySelector('#gantt-what-if') as HTMLButtonElement).disabled).toBe(true);

    // 在途点「回到基线」：必须接续加载（重取基线）而不是留下孤儿旗标
    (document.querySelector('#gantt-reset') as HTMLElement).click();
    await vi.waitFor(() => expect((document.querySelector('#gantt-what-if') as HTMLButtonElement).disabled).toBe(false));
    expect(bodyText()).not.toContain('基线加载中');
    expect(bodyText()).toContain('当前为基线视图');
    expect(document.querySelector('#gantt-scenario')?.getAttribute('data-active')).toBe('false');
  });
});
