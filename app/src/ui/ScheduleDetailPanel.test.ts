import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleDetailPanel } from './ScheduleDetailPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type { ScheduleSnapshot, SchedulePackageView, ScheduleCheckView } from '@shared/schedule-state';

function check(overrides: Partial<ScheduleCheckView> = {}): ScheduleCheckView {
  return {
    id: 'SCH-010-01',
    item: '拆改完成度确认',
    source: 'package',
    severity: 'critical',
    checkpoint: '拆改完成后',
    method: '现场核对',
    pass_condition: '与施工图一致，无遗留墙体',
    evidence_required: ['照片', '量房记录'],
    audit_status: 'pending',
    check_spec_sha256: 'abc123def4567890',
    ...overrides,
  };
}

function packageView(overrides: Partial<SchedulePackageView> = {}): SchedulePackageView {
  return {
    id: 'PKG-010',
    name: '拆改与砌筑',
    sequence: 10,
    description: '拆改、砌筑、抹灰',
    status: 'in_progress',
    readiness: 'ready',
    effective_readiness: 'ready',
    effective_status: 'in_progress',
    dependencies: ['PKG-000'],
    owner_roles: ['施工方', '业主'],
    payment_gate: 'GATE-010-A',
    gate_label: '付款门槛',
    gate_status: 'pending',
    blockers: [
      {id: 'BLK-量房', item: '量房数据', status: 'site_pending', clears_when: '量房报告归档', closed: false},
      {id: 'BLK-旧图', item: '旧图备案', status: 'resolved', clears_when: '备案完成', closed: true},
    ],
    budget: {
      planned_cny: 12000,
      contracted_cny: 11000,
      paid_cny: 0,
      forecast_cny: 12500,
      estimated_need_cny: 13000,
      funding_status: 'partial',
      allocation_status: 'allocated',
      component_count: 3,
      unpriced_count: 1,
    },
    checks: [
      check(),
      check({
        id: 'SCH-010-02', item: '抹灰养护', severity: 'major', checkpoint: '抹灰后 7 天',
        method: '观察', pass_condition: '无空鼓开裂', evidence_required: ['照片'],
        audit_status: 'stale', stale_reasons: ['项目数据已变化'], open_gates: ['DEC-瓷砖'],
        can_run_while_blocked: true, check_spec_sha256: '0f1e2d3c4b5a',
      }),
    ],
    project_fingerprint: 'f'.repeat(64),
    ...overrides,
  };
}

function snapshot(pkg: SchedulePackageView): ScheduleSnapshot {
  return {
    phase: {
      id: 'phase_1_basic_occupancy', status: 'in_progress', current_gate: 'GATE-量房冻结',
      ceiling_cny: 300000, allocated_cny: 250000, unallocated_cny: 50000, known_pending_gap_cny: 2000,
    },
    counts: {packages: 1, checks: 2, cost_components: 3, unpriced_components: 1, open_decision_gates: 0, open_gated_checks: 0, ready_packages: 1},
    data_fingerprint: 'd'.repeat(64),
    packages: [pkg],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: [],
    stale_audits: [],
    package_gate_issues: [],
  };
}

/** /api/project?phase=full 的最小形状：house.rooms + house.sceneElements + modelPackageLinks。 */
function projectPayload() {
  return {
    phase: 'full',
    house: {
      rooms: [
        {id: 'living_dining', name: '客餐厅'},
        {id: 'kitchen', name: '厨房'},
      ],
      sceneElements: [
        {id: 'wall:w1', type: 'wall'},
        {id: 'ceiling:zone_a', type: 'ceiling_zone'},
        {id: 'electrical:sock_1', type: 'electrical'},
      ],
    },
    modelPackageLinks: [
      {
        budget_ref: {id: 'PKG-010'},
        scope: [
          {source: 'phase-scope', select: {all: true}},
          {source: 'model-geometry', select: {room_ids: ['living_dining']}},
          {source: 'overlay', select: {collections: ['rooms']}},
          {source: 'ceiling-quotes', select: {layers: ['ceiling_tile'], trade: ['masonry']}},
        ],
      },
    ],
  };
}

function stubFetch(snapshotPayload: ScheduleSnapshot, project: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/api/project')) return {ok: true, status: 200, json: async () => project};
    return {ok: true, status: 200, json: async () => snapshotPayload};
  }) as never;
}

describe('ScheduleDetailPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div>';
  });

  it('选中包：头部 / 阻塞 / 预算 / 检查表 / 指纹前 12 位', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('拆改与砌筑'));

    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    // 头部
    expect(body.textContent).toContain('PKG-010');
    expect(body.textContent).toContain('进行中');
    expect(body.textContent).toContain('就绪');
    expect(body.textContent).toContain('付款门槛：GATE-010-A');
    expect(body.textContent).toContain('依赖：PKG-000');
    expect(body.textContent).toContain('责任角色：施工方、业主');
    // 阻塞项
    expect(body.textContent).toContain('BLK-量房');
    expect(body.textContent).toContain('未关闭');
    expect(body.textContent).toContain('解除条件：量房报告归档');
    expect(body.textContent).toContain('BLK-旧图');
    expect(body.textContent).toContain('已关闭');
    // 预算行
    expect(body.textContent).toContain('批准 ¥12,000');
    expect(body.textContent).toContain('已成交 ¥11,000');
    expect(body.textContent).toContain('已付 ¥0');
    expect(body.textContent).toContain('预测 ¥12,500');
    expect(body.textContent).toContain('费用项 3 个');
    expect(body.textContent).toContain('未报价 1/3');
    expect(body.textContent).toContain('资金状态：partial');
    // 检查表
    expect(body.textContent).toContain('拆改完成度确认');
    expect(body.textContent).toContain('抹灰养护');
    expect(body.textContent).toContain('critical');
    expect(body.textContent).toContain('与施工图一致，无遗留墙体');
    expect(body.textContent).toContain('照片');
    expect(body.textContent).toContain('量房记录');
    expect(body.textContent).toContain('未执行');
    expect(body.textContent).toContain('已过期');
    expect(body.textContent).toContain('等门禁：DEC-瓷砖');
    expect(body.textContent).toContain('abc123def456');
    expect(body.textContent).toContain('0f1e2d3c4b5a');
    // 指纹前 12 位
    expect(body.textContent).toContain('ffffffffffff');
    expect(body.textContent).toContain('dddddddddddd');
    // 检查行 data-active 同步
    const rows = Array.from(body.querySelectorAll('tr[data-check-id]')) as HTMLElement[];
    expect(rows.map((row) => row.dataset.checkId)).toEqual(['SCH-010-01', 'SCH-010-02']);
    expect(rows[0].dataset.active).toBe('false');
  });

  it('点检查行写 checkId，行 data-active 同步', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('tr[data-check-id="SCH-010-02"]')).toBeTruthy());

    (document.querySelector('tr[data-check-id="SCH-010-02"]') as HTMLElement).click();
    expect(selection.get().checkId).toBe('SCH-010-02');
    expect(selection.get().packageId).toBe('PKG-010');
    await vi.waitFor(() => expect((document.querySelector('tr[data-check-id="SCH-010-02"]') as HTMLElement).dataset.active).toBe('true'));
    await vi.waitFor(() => expect((document.querySelector('tr[data-check-id="SCH-010-01"]') as HTMLElement).dataset.active).toBe('false'));
  });

  it('3D 作用域段：房间/对象计数、全项目范围、未展开选择器与高亮按钮', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new ScheduleDetailPanel(selection, {onHighlight});
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域'));

    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('全项目范围'));
    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    // collections: rooms → 2 个房间；room_ids 收一道 → living_dining
    expect(body.textContent).toContain('房间 2 个');
    // types 未用到 → 0 个对象
    expect(body.textContent).toContain('对象 0 个');
    // 点位/方案级选择器第一步不展开，明示而非静默丢弃
    expect(body.textContent).toContain('未展开选择器');
    expect(body.textContent).toContain('ceiling-quotes.layers: ceiling_tile');
    expect(body.textContent).toContain('ceiling-quotes.trade: masonry');

    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(onHighlight).toHaveBeenCalledWith('PKG-010');
  });

  it('未接线 onHighlight 时高亮按钮禁用并注明', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-highlight')).toBeTruthy());
    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('未接线');
  });

  it('3D 段取数失败只让该段不可用，不影响其余渲染', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/project')) return {ok: false, status: 500, json: async () => ({error: 'boom'})};
      return {ok: true, status: 200, json: async () => snapshot(packageView())};
    });
    vi.stubGlobal('fetch', fetchMock as never);
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域暂不可用'));
    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    expect(body.textContent).toContain('HTTP 500');
    // 其余段照常渲染
    expect(body.textContent).toContain('拆改与砌筑');
    expect(body.textContent).toContain('批准 ¥12,000');
    expect(body.textContent).toContain('抹灰养护');
  });

  it('选中包不在快照里时提示「包不在当前快照」', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-999'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('包不在当前快照'));
    expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('PKG-999');
  });

  it('未选中包时给出引导提示', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const panel = new ScheduleDetailPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('还没有选中工作包'));
  });

  it('schedule 接口失败显示错误态（HTTP 状态 + 提示）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 503, json: async () => ({error: 'schedule control invalid'})})) as never);
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('HTTP 503'));
  });

  it('所有插值转义：含 HTML 的配置字段不当标签解析', async () => {
    const hostile = packageView({
      name: '<b>危险</b>',
      blockers: [{id: '<img src=x onerror=alert(1)>', item: '<i>阻塞</i>', clears_when: '<script>x</script>', closed: false}],
      checks: [check({item: '<u>检查</u>'})],
    });
    vi.stubGlobal('fetch', stubFetch(snapshot(hostile), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('危险'));
    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    expect(body.querySelector('b')).toBeNull();
    expect(body.querySelector('i')).toBeNull();
    expect(body.querySelector('u')).toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
  });

  it('show/hide/isVisible 状态正确', async () => {
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('拆改与砌筑'));
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });
});
