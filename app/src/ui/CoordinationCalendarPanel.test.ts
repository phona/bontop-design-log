import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoordinationCalendarPanel } from './CoordinationCalendarPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type {
  ScheduleCoordinationView,
  ScheduleConstraintView,
  SchedulePackageProjectionView,
  SchedulePackageView,
  ScheduleProjectionView,
  ScheduleSnapshot,
  ScheduleWindowView,
} from '@shared/schedule-state';

// 合成快照覆盖任务书 §4 的 CoordinationCalendarPanel 全部形态：
//  - PKG-010/020/030/040 各有 forecast 窗口（1..9 地平线），对应 onsite/remote/notify/cancelled
//    四类 coordination 条目（cancelled 不画 chip）；
//  - PKG-030 带 site_pending + resolved 两条约束（XSS 与「待定」标注用例）；
//  - 默认无锚点：ordinals[].date 全 null、confirmed_at 全 null，列头只能出「第 N 工作日」，
//    整个面板不得出现日期字符串（§18）；confirmed 的证据日期由单独用例注入。
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
    calendar: {workdays: [1, 2, 3, 4, 5, 6], rest_dates: [], extra_workdates: []},
    ordinals: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((ord) => ({ord, date: null})),
    packages: {
      'PKG-010': projectionPkg({forecast: windowView(2, 3, 4)}),
      'PKG-020': projectionPkg({forecast: windowView(1, 2, 3)}),
      'PKG-030': projectionPkg({
        forecast: windowView(5, 6, 6),
        constraints: [
          {
            id: 'CON-030-A',
            type: 'not_before',
            status: 'site_pending',
            detail: '<script>window.__cal_pwned=1</script>物业允许施工时段',
            date: null,
          },
          {id: 'CON-030-B', type: 'material_delivery', status: 'resolved', detail: '瓷砖已到货', date: null},
        ],
      }),
      'PKG-040': projectionPkg({forecast: windowView(7, 8, 9)}),
    },
    ...overrides,
  };
}

function coordination(overrides: Partial<ScheduleCoordinationView> = {}): ScheduleCoordinationView {
  return {
    package_id: 'PKG-010',
    required_roles: ['业主', '设计师', '施工方'],
    mode: 'onsite',
    lead_time_workdays: 2,
    owner_role: '设计师',
    status: 'pending_invite',
    actor: {name: null, org: null},
    confirmed_at: null,
    escalation: '距邀约窗口不足 2 个工作日未确认，升级到业主',
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
      packages: 4,
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
      pkg({id: 'PKG-030', name: '瓦工铺贴', sequence: 30}),
      pkg({id: 'PKG-040', name: '木工造型', sequence: 40}),
    ],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: [],
    stale_audits: [],
    package_gate_issues: [],
    schedule: scheduleView(),
    coordination: {
      'SCH-010-02': coordination(),
      'SCH-020-01': coordination({
        package_id: 'PKG-020',
        mode: 'remote',
        status: 'invited',
        required_roles: ['业主', '设计师'],
        lead_time_workdays: 1,
        owner_role: '设计师',
      }),
      'SCH-030-04': coordination({
        package_id: 'PKG-030',
        mode: 'notify',
        status: 'unassigned',
        required_roles: ['业主', '物业', '燃气单位'],
        owner_role: '业主',
        lead_time_workdays: 5,
        escalation: '燃气单位或物业的书面要求未取到时升级到业主',
      }),
      'SCH-040-03': coordination({package_id: 'PKG-040', status: 'cancelled', escalation: ''}),
    },
    ...overrides,
  };
}

function stubFetch(options: {state?: ScheduleSnapshot} = {}): void {
  const state = options.state ?? snapshot();
  vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => state})) as never);
}

function installDom(): void {
  document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
}

const bodyText = (): string => (document.querySelector('#coordination-calendar-body') as HTMLElement | null)?.textContent ?? '';

/** jsdom 不做布局（clientWidth 恒 0）；窄容器用例显式 stub 容器实测宽（同 GanttPanel 测）。 */
function stubClientWidth(width: number): () => void {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {configurable: true, get: () => width});
  return () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

describe('CoordinationCalendarPanel', () => {
  beforeEach(() => {
    installDom();
  });

  // 任务书 §4-12 / 设计 §7：三类 mode chip 都在；颜色旁始终有中文文字（色块 + 图例）。
  it('三类 mode chip 都在且颜色旁有文字（图例成对，cancelled 不画 chip）', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip')).toBeTruthy());

    for (const [mode, label] of [['onsite', '现场'], ['remote', '远程'], ['notify', '知会']] as const) {
      const chip = document.querySelector(`.cal-chip[data-mode="${mode}"]`) as HTMLElement;
      expect(chip).toBeTruthy();
      // 颜色来自固定映射表（chip 上带底色），且 chip 文字里 mode/status 中文都在
      expect(chip.getAttribute('style')).toMatch(/background:/);
      expect(chip.textContent).toContain(label);
      expect(chip.textContent).toMatch(/未分派|待邀请|已邀请|已确认|已取消/);
    }
    // 图例：三类中文标签与 token 成对出现（颜色不是唯一证据）
    const legend = document.querySelector('#coordination-calendar-legend') as HTMLElement;
    expect(legend.textContent).toContain('现场');
    expect(legend.textContent).toContain('远程');
    expect(legend.textContent).toContain('知会');
    expect(legend.textContent).toContain('颜色旁一律有中文文字');
    // cancelled 条目不画 chip
    expect(document.querySelector('.cal-chip[data-sch-id="SCH-040-03"]')).toBeNull();
    expect(document.querySelectorAll('.cal-chip')).toHaveLength(3);
    // 试点水印固定在场
    expect(bodyText()).toContain('试点数据：仅登记了 coordination 的 SCH 出现');
  });

  // 任务书 §4-13 / 设计 §16.4：chip 水平位置/宽度 = 所属包 forecast 窗口 [start, end_max]。
  it('chip 位置/宽度按 forecast 窗口（data 属性 + 内联 left/width 钉 ord）', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]')).toBeTruthy());

    // 地平线 = ordinals 1..9；DAY_COLUMN_PX = 44
    const chip010 = document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(chip010.dataset.startOrd).toBe('2');
    expect(chip010.dataset.endOrd).toBe('4');
    expect(chip010.style.left).toBe('44px');
    expect(chip010.style.width).toBe('132px');

    const chip020 = document.querySelector('.cal-chip[data-sch-id="SCH-020-01"]') as HTMLElement;
    expect(chip020.dataset.startOrd).toBe('1');
    expect(chip020.dataset.endOrd).toBe('3');
    expect(chip020.style.left).toBe('0px');
    expect(chip020.style.width).toBe('132px');

    const chip030 = document.querySelector('.cal-chip[data-sch-id="SCH-030-04"]') as HTMLElement;
    expect(chip030.dataset.startOrd).toBe('5');
    expect(chip030.dataset.endOrd).toBe('6');
    expect(chip030.style.left).toBe('176px');
    expect(chip030.style.width).toBe('88px');

    // 行按包 sequence 排序：PKG-010 → PKG-020 → PKG-030（SCH-040-03 已取消不画条幅）
    const rows = Array.from(document.querySelectorAll('.cal-chip')).map((chip) => (chip as HTMLElement).dataset.schId);
    expect(rows).toEqual(['SCH-010-02', 'SCH-020-01', 'SCH-030-04']);
  });

  // 任务书 §4-14 / 设计 §18：无锚点 → 列头只有「第 N 工作日」，整个面板无日期字符串。
  it('无锚点：列头只有「第 N 工作日」且整个面板无日期字符串', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#coordination-calendar-axis')).toBeTruthy());

    const axis = document.querySelector('#coordination-calendar-axis') as HTMLElement;
    expect(axis.textContent).toContain('第 1 工作日');
    expect(axis.textContent).toContain('第 9 工作日');
    expect(bodyText()).toContain('锚点：未定｜横轴：第 N 工作日（不显示日期）');
    // 面板不得自行造年月日：可见文本与 DOM 属性（innerHTML）都没有 YYYY-MM-DD。
    const panelEl = document.querySelector('#coordination-calendar-panel') as HTMLElement;
    expect(panelEl.textContent ?? '').not.toMatch(DATE_PATTERN);
    expect(panelEl.innerHTML).not.toMatch(DATE_PATTERN);
  });

  // 任务书 §4-15：site_pending 约束标「待定」，其余 token 原样。
  it('site_pending 约束标「待定」，其余约束 token 原样展示', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-row[data-sch-id="SCH-030-04"]')).toBeTruthy());

    const row = document.querySelector('.cal-row[data-sch-id="SCH-030-04"]') as HTMLElement;
    expect(row.textContent).toContain('约束 CON-030-A（not_before｜待定）');
    expect(row.textContent).toContain('物业允许施工时段');
    // 非 site_pending 的 token 原样（不翻译成声明值）
    expect(row.textContent).toContain('约束 CON-030-B（material_delivery｜resolved）');
    expect(row.textContent).toContain('瓷砖已到货');
  });

  // 任务书 §4-16 / 设计 §17/§18：confirmed 条目的 confirmed_at 是证据文字；无锚点不钉 ord 列。
  it('confirmed 条目显示确认登记日证据文字且 chip 仍钉在潜在窗口（无锚点不钉列）', async () => {
    const snap = snapshot();
    snap.coordination!['SCH-010-02'] = coordination({status: 'confirmed', confirmed_at: '2026-03-05'});
    stubFetch({state: snap});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-row[data-sch-id="SCH-010-02"]')).toBeTruthy());

    const row = document.querySelector('.cal-row[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(row.textContent).toContain('确认登记日 2026-03-05');
    expect(row.textContent).toContain('无锚点，不钉列');
    // 条幅位置仍是潜在窗口（2..4），没有被 confirmed_at 钉到别的列
    const chip = row.querySelector('.cal-chip[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(chip.dataset.startOrd).toBe('2');
    expect(chip.dataset.endOrd).toBe('4');
    expect(chip.dataset.status).toBe('confirmed');
    expect(chip.dataset.confirmed).toBe('true');
    expect(chip.style.left).toBe('44px');
    // 无锚点 = 没有日期坐标系，不画「确认占用日」标记
    expect(row.querySelector('.cal-confirm-mark')).toBeNull();
  });

  // 锚点就绪时（对照）：ordinals 有真实日期，date→ord 纯查表补「确认占用日」标记，
  // chip 仍在潜在窗口；轴刻度带快照日期（不自行造日期）。
  it('锚点就绪：轴刻度带 ordinals 真实日期，确认占用日按查表补标记（chip 不动）', async () => {
    const view = scheduleView({
      anchor_date: '2026-03-02',
      ordinals: [
        {ord: 1, date: '2026-03-02'},
        {ord: 2, date: '2026-03-03'},
        {ord: 3, date: '2026-03-04'},
        {ord: 4, date: '2026-03-05'},
        {ord: 5, date: '2026-03-06'},
        {ord: 6, date: '2026-03-09'},
        {ord: 7, date: '2026-03-10'},
        {ord: 8, date: '2026-03-11'},
        {ord: 9, date: '2026-03-12'},
      ],
    });
    const snap = snapshot({schedule: view});
    snap.coordination!['SCH-010-02'] = coordination({status: 'confirmed', confirmed_at: '2026-03-05'});
    stubFetch({state: snap});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]')).toBeTruthy());

    const axis = document.querySelector('#coordination-calendar-axis') as HTMLElement;
    expect(axis.textContent).toContain('2026-03-02');
    expect(bodyText()).toContain('锚点：已定（2026-03-02）｜横轴：真实日期');

    const row = document.querySelector('.cal-row[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(row.textContent).toContain('确认登记日 2026-03-05（第 4 工作日）');
    const mark = row.querySelector('.cal-confirm-mark') as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.dataset.ord).toBe('4');
    expect(mark.style.left).toBe('132px');
    const chip = row.querySelector('.cal-chip[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(chip.dataset.startOrd).toBe('2');
    expect(chip.style.left).toBe('44px');
  });

  // Codex 二审 minor（2026-11-12 修）：补末列刻度要与**最后一个已排刻度**比最小间距——
  // 旧实现比的是倒数第二个，1–26 会留下 25、26 相邻 44px（< 72px）导致末端标签压盖。
  it('末端刻度：抽稀后末列与最后一刻度间距不小于最小间距（1–26 回归钉）', async () => {
    const ordinals = Array.from({length: 26}, (_unused, index) => ({ord: index + 1, date: null}));
    const view = scheduleView({
      ordinals,
      packages: {'PKG-010': projectionPkg({forecast: windowView(1, 26, 26)})},
    });
    stubFetch({state: snapshot({schedule: view})});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-tick')).toBeTruthy());

    const ticks = Array.from(document.querySelectorAll('.cal-tick')).map((el) => Number((el as HTMLElement).dataset.ord));
    expect(ticks[0]).toBe(1);
    expect(ticks[ticks.length - 1]).toBe(26);
    for (let index = 1; index < ticks.length; index += 1) {
      // 最小间距 = ceil(MIN_TICK_SPACING_PX / DAY_COLUMN_PX) = ceil(72/44) = 2 个 ord
      expect(ticks[index] - ticks[index - 1]).toBeGreaterThanOrEqual(2);
    }
  });

  // 独立评审 medium（2026-11-12 修）：轴刻度与行内容区（chip/网格）必须同源内缩，
  // 否则条幅整体右移「行边框 + 行内边距」= 9px。jsdom 不做布局，这里钉两处样式的耦合。
  it('轴线与行内容区同源内缩：轴 margin = 行内边距 + 行边框（9px 错位回归钉）', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip')).toBeTruthy());

    const axis = document.querySelector('#coordination-calendar-axis') as HTMLElement;
    const row = document.querySelector('.cal-row[data-sch-id="SCH-010-02"]') as HTMLElement;
    const rowStyle = getComputedStyle(row);
    const rowInset = parseFloat(rowStyle.paddingLeft) + parseFloat(rowStyle.borderLeftWidth);
    expect(rowInset).toBe(9);
    expect(axis.style.marginLeft).toBe(`${rowInset}px`);
    expect(axis.style.marginRight).toBe(`${rowInset}px`);
  });

  // Codex 二审 minor（2026-11-12 修）：ordinals 是有限投影范围、不是完整工作日历——
  // 查表未命中只能声明「日期不在当前投影范围」，不得推断成「不在工作日历内」。
  it('confirmed_at 不在投影范围：措辞只声明「日期不在当前投影范围，无法定位」', async () => {
    const view = scheduleView({
      anchor_date: '2026-03-02',
      ordinals: [
        {ord: 1, date: '2026-03-02'},
        {ord: 2, date: '2026-03-03'},
        {ord: 3, date: '2026-03-04'},
        {ord: 4, date: '2026-03-05'},
      ],
    });
    const snap = snapshot({schedule: view});
    snap.coordination!['SCH-010-02'] = coordination({status: 'confirmed', confirmed_at: '2026-04-30'});
    stubFetch({state: snap});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-row[data-sch-id="SCH-010-02"]')).toBeTruthy());

    const rowText = (document.querySelector('.cal-row[data-sch-id="SCH-010-02"]') as HTMLElement).textContent ?? '';
    expect(rowText).toContain('确认登记日 2026-04-30（日期不在当前投影范围，无法定位）');
    expect(rowText).not.toContain('不在工作日历内');
  });

  // 任务书 §4-17 / 设计 §17.4：cancelled 不画 chip，只在面板说明里注明计数。
  it('cancelled 不画 chip 且计数注明「已取消 N 条（解除占用）」', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip')).toBeTruthy());

    expect(document.querySelector('.cal-chip[data-sch-id="SCH-040-03"]')).toBeNull();
    expect(document.querySelector('.cal-row[data-sch-id="SCH-040-03"]')).toBeNull();
    expect(bodyText()).toContain('已取消 1 条（解除占用）');
    expect(bodyText()).toContain('SCH-040-03');
    expect(document.querySelectorAll('.cal-chip')).toHaveLength(3);
  });

  // 任务书 §4-18 / D5：点 chip 只写 selection（packageId + checkId = SCH id），无高亮入口。
  it('点 chip 写 selection（packageId + checkId = SCH id），面板无高亮入口', async () => {
    stubFetch();
    const selection = new ScheduleSelectionStore();
    const setSpy = vi.spyOn(selection, 'set');
    const panel = new CoordinationCalendarPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]')).toBeTruthy());

    (document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]') as HTMLElement).click();
    expect(setSpy).toHaveBeenCalledWith({packageId: 'PKG-010', checkId: 'SCH-010-02'});
    expect(selection.get()).toEqual({packageId: 'PKG-010', checkId: 'SCH-010-02'});
    // 选中态进地址栏（既有 hash 机制）；active 行同步
    expect(location.hash).toContain('check=SCH-010-02');
    expect(document.querySelector('.cal-row[data-sch-id="SCH-010-02"]')?.getAttribute('data-active')).toBe('true');
    // 本面板没有 3D 高亮按钮/钩子，也从不拉 /api/model-package-links（D5）
    expect(document.querySelector('#coordination-calendar-panel #coordination-calendar-highlight')).toBeNull();
    expect((panel as unknown as {onHighlight?: unknown}).onHighlight).toBeUndefined();
  });

  // 任务书 §4-19：空快照 / 503 / schedule 缺失 / coordination 缺失四态文案各不相同。
  it('四态文案：取数失败（无快照）/ 503 / schedule 缺失 / coordination 缺失', async () => {
    // (a) 网络失败：错误条 + 「未取得协调快照」，不渲染任何 chip
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }) as never);
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#coordination-calendar-error')).toBeTruthy());
    expect(bodyText()).toContain('取数失败');
    expect(bodyText()).toContain('network down');
    expect(bodyText()).toContain('未取得协调快照');
    expect(document.querySelector('.cal-chip')).toBeNull();
    expect(document.querySelector('#coordination-calendar-chart')).toBeNull();

    // (b) 503：服务端原因逐字呈现，不渲染任何网格
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({error: 'schedule control invalid: 1 issue(s)', issues: ['PKG-010: bad constraint']}),
    })) as never);
    await panel.refresh();
    await vi.waitFor(() => expect(bodyText()).toContain('HTTP 503'));
    expect(bodyText()).toContain('schedule control invalid');
    expect(bodyText()).toContain('PKG-010: bad constraint');
    expect(bodyText()).toContain('本面板不渲染来自坏快照的数据');
    expect(document.querySelector('#coordination-calendar-chart')).toBeNull();

    // (c) schedule 键缺失：明确「无法定位工作日列」，不画列网格
    stubFetch({state: snapshot({schedule: undefined})});
    await panel.refresh();
    await vi.waitFor(() => expect(document.querySelector('#coordination-calendar-empty')).toBeTruthy());
    expect(bodyText()).toContain('缺排程投影');
    expect(bodyText()).toContain('无法定位工作日列');
    expect(document.querySelector('#coordination-calendar-axis')).toBeNull();
    expect(document.querySelector('.cal-chip')).toBeNull();

    // (d) coordination 缺失与为空：同一句诚实文案
    stubFetch({state: snapshot({coordination: undefined})});
    await panel.refresh();
    await vi.waitFor(() => expect(bodyText()).toContain('没有协调数据'));
    stubFetch({state: snapshot({coordination: {}})});
    await panel.refresh();
    await vi.waitFor(() => expect(bodyText()).toContain('没有协调数据'));
    expect(document.querySelector('.cal-chip')).toBeNull();
  });

  // 地平线退化：ordinals 缺失时从各条目 forecast 窗口推导（仍画出条幅）。
  it('ordinals 缺失：地平线从各条目 forecast 窗口推导', async () => {
    stubFetch({state: snapshot({schedule: scheduleView({ordinals: []})})});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]')).toBeTruthy());

    // 窗口并集 1..9：SCH-020-01（1..3）贴左缘，SCH-010-02（2..4）偏移一列
    const chip020 = document.querySelector('.cal-chip[data-sch-id="SCH-020-01"]') as HTMLElement;
    expect(chip020.style.left).toBe('0px');
    const chip010 = document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]') as HTMLElement;
    expect(chip010.style.left).toBe('44px');
    expect((document.querySelector('#coordination-calendar-axis') as HTMLElement).textContent).toContain('第 1 工作日');
  });

  // 所属包没有排程投影：不画条幅只列文字（任务书 §1.2）。
  it('所属包无排程投影：不画条幅只列文字', async () => {
    const snap = snapshot();
    snap.coordination!['SCH-999-01'] = coordination({package_id: 'PKG-999', mode: 'onsite', status: 'invited'});
    stubFetch({state: snap});
    const selection = new ScheduleSelectionStore();
    const panel = new CoordinationCalendarPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-row[data-sch-id="SCH-999-01"]')).toBeTruthy());

    const row = document.querySelector('.cal-row[data-sch-id="SCH-999-01"]') as HTMLElement;
    expect(row.querySelector('.cal-chip')).toBeNull();
    expect(row.textContent).toContain('所属包无排程投影');
    expect(row.textContent).toContain('潜在窗口：未知');
    expect(row.textContent).toContain('包不在快照 packages');
    // 点击仍写 selection（条目可点，与画不画条幅无关）
    row.click();
    expect(selection.get()).toEqual({packageId: 'PKG-999', checkId: 'SCH-999-01'});
  });

  // 任务书 §4-20：SCH id / 约束 detail / 包名里的 hostile 字符串不变形。
  it('转义：SCH id / 约束 detail / 包名带 <script> 不变形', async () => {
    const snap = snapshot();
    snap.coordination = {
      '<script>window.__cal_pwned=1</script>': coordination({
        package_id: 'PKG-030',
        mode: 'onsite',
        status: 'invited',
        required_roles: ['<i>业主</i>', '设计师'],
        owner_role: '<b>设计师</b>',
      }),
    };
    snap.packages = snap.packages.map((pkgView) => pkgView.id === 'PKG-030'
      ? pkg({...pkgView, name: '<img src=x onerror="window.__cal_pwned2=1">瓦工铺贴'})
      : pkgView);
    stubFetch({state: snap});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-row[data-sch-id]')).toBeTruthy());

    const body = document.querySelector('#coordination-calendar-body') as HTMLElement;
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('i')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    expect((window as unknown as {__cal_pwned?: number}).__cal_pwned).toBeUndefined();
    expect((window as unknown as {__cal_pwned2?: number}).__cal_pwned2).toBeUndefined();
    // 转义后的内容作为文本可读
    expect(body.textContent).toContain('瓦工铺贴');
    expect(body.textContent).toContain('物业允许施工时段');
    expect(body.textContent).toContain('<script>window.__cal_pwned=1</script>');
  });

  // 任务书 §4-20：≤700px 退化为单列列表（chip 改文字行），不画列网格；点击仍写 selection。
  it('≤700px：退化为单列文字列表，不画列网格；点击仍写 selection', async () => {
    stubFetch();
    const restore = stubClientWidth(334);
    try {
      const selection = new ScheduleSelectionStore();
      const panel = new CoordinationCalendarPanel(selection);
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.cal-row-text')).toBeTruthy());

      expect(document.querySelector('#coordination-calendar-chart')?.getAttribute('data-mobile')).toBe('true');
      expect(document.querySelector('#coordination-calendar-axis')).toBeNull();
      expect(document.querySelector('.cal-chip')).toBeNull();
      expect(bodyText()).toContain('单列列表');

      const row = document.querySelector('.cal-row[data-sch-id="SCH-010-02"]') as HTMLElement;
      expect(row.textContent).toContain('SCH-010-02');
      expect(row.textContent).toContain('现场');
      expect(row.textContent).toContain('待邀请');
      expect(row.textContent).toContain('潜在窗口');
      expect(row.textContent).toContain('第 2');
      // 窄屏同样保留约束「待定」与取消计数说明
      expect(bodyText()).toContain('已取消 1 条（解除占用）');
      row.click();
      expect(selection.get()).toEqual({packageId: 'PKG-010', checkId: 'SCH-010-02'});
    } finally {
      restore();
    }
  });

  // 任务书 §1.2 / §1.5 L2：本面板是 coordination/schedule 的只读消费方，渲染前后逐字节不变。
  it('只读：渲染 + 点击前后 snapshot.coordination 与 snapshot.schedule 逐字节不变', async () => {
    const snap = snapshot();
    const beforeCoordination = JSON.stringify(snap.coordination);
    const beforeSchedule = JSON.stringify(snap.schedule);
    stubFetch({state: snap});
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip[data-sch-id="SCH-010-02"]')).toBeTruthy());

    (document.querySelector('.cal-chip[data-sch-id="SCH-030-04"]') as HTMLElement).click();
    panel.hide();
    await panel.refresh();

    expect(JSON.stringify(snap.coordination)).toBe(beforeCoordination);
    expect(JSON.stringify(snap.schedule)).toBe(beforeSchedule);
    expect(snap.coordination?.['SCH-010-02']?.mode).toBe('onsite');
    expect(snap.schedule?.packages['PKG-030']?.constraints.map((constraint: ScheduleConstraintView) => constraint.id))
      .toEqual(['CON-030-A', 'CON-030-B']);
  });

  it('show/hide/isVisible 状态正确', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip')).toBeTruthy());
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#coordination-calendar-panel') as HTMLElement).style.display).toBe('none');
  });

  // 面板挂载与折叠骨架：挂 #approval-page-panels，id/类名/折叠控件齐备。
  it('骨架：挂 approval-page-panels，id/折叠控件齐备', async () => {
    stubFetch();
    const panel = new CoordinationCalendarPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.cal-chip')).toBeTruthy());

    const el = document.querySelector('#coordination-calendar-panel') as HTMLElement;
    expect(el.classList.contains('dynamic-panel')).toBe(true);
    expect(el.parentElement?.id).toBe('approval-page-panels');
    const toggle = document.querySelector('#coordination-calendar-panel-toggle') as HTMLButtonElement;
    const content = document.querySelector('#coordination-calendar-panel-content') as HTMLElement;
    expect(content.hidden).toBe(false);
    toggle.click();
    expect(content.hidden).toBe(true);
    toggle.click();
    expect(content.hidden).toBe(false);
  });
});
