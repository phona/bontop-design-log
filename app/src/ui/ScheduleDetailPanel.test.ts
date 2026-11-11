import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      check({
        id: 'SCH-010-03', item: '贴砖复验', severity: 'critical', checkpoint: '贴砖完成后',
        method: '现场核对', pass_condition: '无空鼓', evidence_required: ['照片'],
        audit_status: 'passed', audit: {id: 'AUD-PKG-010-SCH-010-03-001', checked_by: '业主', checked_at: '2026-10-30', evidence: []},
        check_spec_sha256: '112233445566',
      }),
    ],
    targets: ['pkg.test_object'],
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
    counts: {packages: 1, checks: 3, cost_components: 3, unpriced_components: 1, open_decision_gates: 0, open_gated_checks: 0, ready_packages: 1},
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
    document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
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
    expect(rows.map((row) => row.dataset.checkId)).toEqual(['SCH-010-01', 'SCH-010-02', 'SCH-010-03']);
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

  // 2026-11-04 issue #65：点位来源的 select.all 展开成该分类全部点位。真实
  // MODEL-PKG-040（水电改造）就是 electrical/plumbing select.all——旧实现一律短路成
  // 「全项目范围」，三段计数是「房间 0｜对象 0｜点位 0」，点了「在 3D 中高亮」什么都不会亮。
  it('3D 作用域段：点位来源的 select.all 展开全部点位，计数与按钮可用性随之修正', async () => {
    const project = {
      ...projectPayload(),
      house: {
        ...projectPayload().house,
        electrical: [{id: 'sock_living_ac'}, {id: 'sock_kitchen_gas'}, {id: 'panel_strong_entry_left'}],
        plumbing: [{id: 'drain_kitchen'}, {id: 'faucet_kitchen'}],
      },
      modelPackageLinks: [
        {
          budget_ref: {id: 'PKG-040'},
          // 真实 config/model-package-links.yaml 的 MODEL-PKG-040 同形
          scope: [
            {source: 'electrical', select: {all: true}},
            {source: 'plumbing', select: {all: true}},
            {source: 'electrical_topology', select: {all: true}},
            {source: 'mep_routes', select: {layers: ['strong_power', 'water_supply']}},
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView({id: 'PKG-040', name: '水电改造'})), project));
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new ScheduleDetailPanel(selection, {onHighlight});
    panel.subscribe();
    selection.set({packageId: 'PKG-040'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域'));

    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    // 三段计数：点位段不再是 0（旧实现 select.all 一律短路全项目范围）
    expect(body.textContent).toContain('房间 0 个');
    expect(body.textContent).toContain('对象 0 个');
    expect(body.textContent).toContain('点位 5 个');
    expect(body.textContent).toContain('electrical:sock_living_ac');
    expect(body.textContent).toContain('plumbing:drain_kitchen');
    // electrical_topology 的 all 没有 3D 位置，徽标照旧；与点位高亮能力并存
    expect(body.textContent).toContain('全项目范围');
    // layers 仍不展开，明示而非静默丢弃
    expect(body.textContent).toContain('mep_routes.layers: strong_power,water_supply');

    // 有点位可高亮 → 按钮可用（旧实现这里被判「没有具体 3D 范围」）
    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(onHighlight).toHaveBeenCalledWith('PKG-040');
  });

  // 2026-11-04 PR #76 codex major：显式 mapping_status: project_scope 的整屋包在
  // 详情面板与流程图必须同口径。真实 MODEL-PKG-142（临时入住整屋放行）声明
  // electrical/plumbing select.all + project_scope——#65 之后详情面板把分类 all
  // 展成 137 个点位（104 电气 + 33 给排水）并启用「在 3D 中高亮」，而 FlowChartPanel
  // 早就是按 project_scope 判全项目、禁用高亮（FlowChartPanel.test.ts:407 钉住），
  // 两个入口相互矛盾。修复后本面板同样 0/0/0 + 全项目范围 + 按钮禁用。
  // PKG-040（mapping_status: partial）的同形 select.all 仍展开全部点位，由上面
  // 「点位来源的 select.all 展开全部点位」一条钉住，不因本修复回归。
  it('3D 作用域段：显式 project_scope 的整屋包（PKG-142）分类 all 不展开点位，按钮禁用', async () => {
    const project = {
      ...projectPayload(),
      house: {
        ...projectPayload().house,
        electrical: [{id: 'sock_living_ac'}, {id: 'sock_kitchen_gas'}, {id: 'panel_strong_entry_left'}],
        plumbing: [{id: 'drain_kitchen'}, {id: 'faucet_kitchen'}],
      },
      modelPackageLinks: [
        {
          budget_ref: {id: 'PKG-142'},
          // 真实 config/model-package-links.yaml 的 MODEL-PKG-142 同形
          mapping_status: 'project_scope',
          scope: [
            {source: 'model_geometry', select: {all: true}},
            {source: 'overlay', select: {all: true}},
            {source: 'furnishings', select: {all: true}},
            {source: 'electrical', select: {all: true}},
            {source: 'plumbing', select: {all: true}},
            {source: 'electrical_topology', select: {all: true}},
            {source: 'mep_routes', select: {all: true}},
            {source: 'hvac', select: {all: true}},
            {source: 'ceiling', select: {all: true}},
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView({id: 'PKG-142', name: '临时入住整屋放行'})), project));
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new ScheduleDetailPanel(selection, {onHighlight});
    panel.subscribe();
    selection.set({packageId: 'PKG-142'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域'));

    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    // 三段计数：整屋包的分类 select.all 不拆成点位（旧实现「点位 5 个」，真实配置 137 个）
    expect(body.textContent).toContain('房间 0 个');
    expect(body.textContent).toContain('对象 0 个');
    expect(body.textContent).toContain('点位 0 个');
    expect(body.textContent).toContain('全项目范围');
    // 点位清单一个都不得列出来（展开了才会列 electrical:sock_living_ac 这类 id）
    expect(body.textContent).not.toContain('electrical:sock_living_ac');
    expect(body.textContent).not.toContain('plumbing:drain_kitchen');

    // 没有可高亮范围 → 按钮禁用并注明，与流程图 capabilityOf 的 project_scope 一致
    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('没有可高亮范围');
    expect(onHighlight).not.toHaveBeenCalled();
  });

  it('3D 作用域段：房间/对象/点位全为 0（只有全项目范围选择器）时高亮按钮禁用并注明', async () => {
    // 不留一个点了没反应的按钮：projectScope-only 的包（真实 PKG-000/170/900 就是
    // model_geometry select.all）展开出 0/0/0，禁用它并写明原因。
    const project = {
      ...projectPayload(),
      modelPackageLinks: [
        {budget_ref: {id: 'PKG-000'}, scope: [{source: 'model_geometry', select: {all: true}}]},
      ],
    };
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView({id: 'PKG-000', name: '总预埋与定位'})), project));
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new ScheduleDetailPanel(selection, {onHighlight});
    panel.subscribe();
    selection.set({packageId: 'PKG-000'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域'));

    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    expect(body.textContent).toContain('全项目范围');
    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('没有可高亮范围');
    expect(onHighlight).not.toHaveBeenCalled();
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

  it('3D 段取数失败后有重试按钮：点重试重新拉取，第二次成功即渲染（P2-6）', async () => {
    let projectCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/project')) {
        projectCalls += 1;
        if (projectCalls === 1) return {ok: false, status: 500, json: async () => ({error: 'boom'})};
        return {ok: true, status: 200, json: async () => projectPayload()};
      }
      return {ok: true, status: 200, json: async () => snapshot(packageView())};
    });
    vi.stubGlobal('fetch', fetchMock as never);
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域暂不可用'));
    const retry = document.querySelector('#schedule-detail-scope-retry') as HTMLButtonElement;
    expect(retry, '失败态必须有重试按钮（旧实现只能刷新整页）').toBeTruthy();
    retry.click();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('房间 2 个'));
    expect(projectCalls).toBe(2);
    expect(document.querySelector('#schedule-detail-scope-retry')).toBeNull();
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

// ─── 第二步写路径（验收操作）：草稿 / 保存 / 卡点 / 预演 / 提交 ───
// 服务端契约见 server/routes.ts 的 /api/acceptance/* 与 tests/server/acceptance-routes.test.ts。

interface RecordedCall {url: string; method: string; body: unknown}

const STAGING_PATH = 'tmp/capture/acceptance-staging/PKG-010/SCH-010-01/a.jpg';
const FINAL_PATH = 'schedule/phase-1/evidence/PKG-010/SCH-010-01/a.jpg';

function greenGates(): Array<{name: string; ok: boolean; detail: string}> {
  return [
    {name: '控制源校验', ok: true, detail: 'schedule control valid'},
    {name: '草稿校验', ok: true, detail: '1 条结果全部合法'},
    {name: '证据文件在位', ok: true, detail: '全部证据文件存在'},
    {name: '前置与阻塞', ok: true, detail: '依赖包与阻塞项均已关闭'},
    {name: 'verify:schedule（当前树）', ok: true, detail: 'ok'},
  ];
}

function recordProjection(): Record<string, unknown> {
  return {
    id: 'AUD-PKG-010-SCH-010-01-001',
    package_id: 'PKG-010',
    check_id: 'SCH-010-01',
    status: 'passed',
    checked_at: '2026-11-02',
    checked_by: '业主',
    evidence: [FINAL_PATH],
    check_spec_sha256: 'a'.repeat(64),
    project_data_sha256: 'b'.repeat(64),
  };
}

function prBodyText(): string {
  return [
    '## 验收提交：PKG-010｜拆改与砌筑',
    '',
    '分支 `accept/PKG-010-20261102`。合并仍由业主亲手点。',
    '',
    '### 本次改动的检查',
    `- \`SCH-010-01\` → **passed**（业主 / 2026-11-02）证据：${FINAL_PATH}`,
    '',
    '### 付款节点',
    '- 付款门槛 `GATE-010-A`：当前 `pending`。',
    '- **本次放行：无（包未全部通过：1/2）；付款只在合并后生效**',
  ].join('\n');
}

/** /api/acceptance/* 的可配置 stub：默认全部成功，逐测试覆盖失败分支。 */
function stubAcceptance(
  snapshotPayload: ScheduleSnapshot,
  handlers: {
    /** path 带 package_id：服务端按包返回草稿，mock 也必须按包（不按包会造假）。 */
    draft?: (path: string) => unknown;
    putDraft?: (body: unknown) => {status?: number; body?: unknown};
    evidence?: (body: unknown) => {status?: number; body?: unknown};
    finalize?: (body: unknown) => {status?: number; body?: unknown};
    gates?: () => {status?: number; body?: unknown};
    submit?: (body: unknown) => {status?: number; body?: unknown};
  } = {},
): {calls: RecordedCall[]} {
  const calls: RecordedCall[] = [];
  const respond = (status: number, body: unknown) => ({ok: status >= 200 && status < 300, status, json: async () => body});
  const mock = vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const parsed = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({url: String(url), method, body: parsed});
    const path = String(url);
    if (path.includes('/api/project')) return respond(200, projectPayload());
    if (path.includes('/api/schedule/state')) return respond(200, snapshotPayload);
    // 顺序要紧：finalize 是 evidence 的前缀
    if (path.includes('/api/acceptance/evidence/finalize')) {
      const out = (handlers.finalize ?? (() => ({status: 201, body: {final_path: FINAL_PATH, sha256: 'f'.repeat(64)}})))(parsed);
      return respond(out.status ?? 201, out.body);
    }
    if (path.includes('/api/acceptance/evidence')) {
      const out = (handlers.evidence ?? (() => ({status: 201, body: {staging_path: STAGING_PATH, sha256: 'a'.repeat(64), size: 1234}})))(parsed);
      return respond(out.status ?? 201, out.body);
    }
    if (path.includes('/api/acceptance/draft')) {
      if (method === 'PUT') {
        const out = (handlers.putDraft ?? (() => ({status: 200, body: {ok: true}})))(parsed);
        return respond(out.status ?? 200, out.body);
      }
      return respond(200, (handlers.draft ?? (() => ({package_id: 'PKG-010', results: []})))(path));
    }
    if (path.includes('/api/acceptance/gates')) {
      const out = (handlers.gates ?? (() => ({status: 200, body: {ok: true, gates: greenGates()}})))();
      return respond(out.status ?? 200, out.body);
    }
    if (path.includes('/api/acceptance/submit')) {
      const out = (handlers.submit ?? ((body: unknown) => (
        (body as {dry_run?: boolean})?.dry_run
          ? {status: 200, body: {dry_run: true, records: [recordProjection()], pr_body: prBodyText()}}
          : {status: 201, body: {branch: 'accept/PKG-010-20261102', commit: 'abc1234', pr_url: 'https://github.com/phona/bontop-design-log/pull/99', records: [], pr_body: prBodyText()}}
      )))(parsed);
      return respond(out.status ?? 200, out.body);
    }
    return respond(200, snapshotPayload);
  });
  vi.stubGlobal('fetch', mock as never);
  return {calls};
}

/** 挂面板 + 选包 + 等快照与草稿都渲染完（不留静默空态再断言）。 */
async function mountPanel(options: {
  snapshot?: ScheduleSnapshot;
  handlers?: Parameters<typeof stubAcceptance>[1];
} = {}): Promise<{selection: ScheduleSelectionStore; panel: ScheduleDetailPanel; calls: RecordedCall[]}> {
  const {calls} = stubAcceptance(options.snapshot ?? snapshot(packageView()), options.handlers);
  const selection = new ScheduleSelectionStore();
  const panel = new ScheduleDetailPanel(selection);
  panel.subscribe();
  selection.set({packageId: 'PKG-010'});
  panel.show();
  await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('拆改与砌筑'));
  await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
  return {selection, panel, calls};
}

const click = (selector: string): void => {
  (document.querySelector(selector) as HTMLButtonElement).click();
};

const setInput = (selector: string, value: string): void => {
  const input = document.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', {bubbles: true}));
};

describe('ScheduleDetailPanel 验收操作（写路径）', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
  });

  it('证据：选文件→暂存→选为最终证据→final_path 进草稿 evidence 列表', async () => {
    const {calls} = await mountPanel();
    const fileInput = document.querySelector('[data-evidence-file="SCH-010-01"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File(['fake-image-bytes'], 'a.jpg', {type: 'image/jpeg'});
    Object.defineProperty(fileInput, 'files', {value: [file], configurable: true});
    fileInput.dispatchEvent(new Event('change', {bubbles: true}));

    // 暂存：POST /api/acceptance/evidence，data_base64 只要逗号后段
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/acceptance/evidence' && call.method === 'POST')).toBe(true));
    const staged = calls.find((call) => call.url === '/api/acceptance/evidence')!;
    // issue #70 codex 复审：文件名带 nonce（同一检查多张照片不撞暂存路径）——这里是
    // 'a.jpg' + '-' + nonce（时间戳36进制-计数）；源名安全部分保留在前
    expect((staged.body as {filename: string}).filename).toMatch(/^a-[0-9a-z]+-\d+\.jpg$/);
    expect(staged.body).toEqual({
      package_id: 'PKG-010',
      check_id: 'SCH-010-01',
      filename: (staged.body as {filename: string}).filename,
      data_base64: btoa('fake-image-bytes'),
    });
    await vi.waitFor(() => expect(document.querySelector('[data-evidence-area="SCH-010-01"]')!.textContent).toContain(STAGING_PATH));

    // 落定：POST /api/acceptance/evidence/finalize
    click('[data-evidence-finalize="SCH-010-01"]');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/acceptance/evidence/finalize')).toBe(true));
    const finalized = calls.find((call) => call.url === '/api/acceptance/evidence/finalize')!;
    expect(finalized.body).toEqual({package_id: 'PKG-010', check_id: 'SCH-010-01', staging_path: STAGING_PATH});

    // final_path 进该行证据列表（带删除按钮）
    const area = document.querySelector('[data-evidence-area="SCH-010-01"]') as HTMLElement;
    await vi.waitFor(() => expect(area.textContent).toContain(FINAL_PATH));
    expect(area.querySelector('[data-evidence-remove="SCH-010-01"]')).toBeTruthy();

    // 选状态后 PUT 带上该证据
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {timeout: 3000});
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.url).toBe('/api/acceptance/draft');
    expect(put.body).toEqual({
      package_id: 'PKG-010',
      results: [{check_id: 'SCH-010-01', status: 'passed', checked_by: '', checked_at: '2026-11-02', evidence: [FINAL_PATH]}],
    });
    // 保存成功有显式反馈（不留静默空态）
    expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存');

    // 草稿再变化 → 旧卡点结论作废（不许拿旧 gates 放行新草稿）
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('还没跑过机械卡点'));
    expect((document.querySelector('#acceptance-dry-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('保存失败必须留痕且可重试（PUT 在途时退出清选也不许被吞，codex 四审 blocking 回归）', async () => {
    // 旧缺陷复现路径：PUT 已发出、响应在途，此时退出审批页清了选中——saveDraft 在
    // fetch 回头查「选中已换」就静默 return，saveStatus 永远停在 saving、草稿只剩
    // 内存，业主以为存了。用 mock handler 的副作用在 PUT 在途期间清选中来精确复现。
    let sel: ScheduleSelectionStore | null = null;
    const {selection, panel, calls} = await mountPanel({
      handlers: {
        putDraft: () => {
          sel?.set({packageId: null, checkId: null}); // 模拟退出清选中
          return {status: 422, body: {ok: false, issues: [{check_id: 'SCH-010-01', field: 'checked_by', message: '必须填验收人'}]}};
        },
      },
    });
    sel = selection;
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    // 重新选中回该包：失败态必须可见（旧实这里永远「保存中」），且带重试入口
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('保存失败'));
    expect(document.querySelector('[data-save-status]')!.textContent).toContain('草稿校验没过');
    const retry = document.querySelector('[data-save-retry]') as HTMLButtonElement;
    expect(retry, '失败态必须有显式重试入口').toBeTruthy();
    retry.click();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2));
  });

  it('旧 GET 晚到不删刚保存的结果（codex 十五审 blocking 回归）', async () => {
    // 交错路径（十六审根治后的形态）：PUT 已发出（完整视图门只在加载在途时关）
    // → 期间发起重载 → PUT 落账（serverSeq+1）→ 旧 GET 带着保存前的旧服务端内容
    // 落地。旧实现让它通过序号检查并 applyDraft，按「服务端没返回=删了」把刚保存
    // 的结果删掉，下次全量 PUT 永久抹掉。修：GET 回填校验请求期间的**服务端序号**
    // （serverSeq，只有保存落账才 bump；draftVersion 编辑也 bump，分不清会误杀）。
    let releasePut: () => void = () => {};
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const {panel, calls} = await mountPanel();
    // 换成手动控制时机的 fetch：PUT 等 putGate、GET 等 getGate，其余照常
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET') {
        await getGate;
        // 旧服务端内容：SCH-010-01 是 passed（本次保存把它改成了 failed）
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '旧值', checked_at: '2026-11-01'},
        ]})} as Response;
      }
      if (String(url).startsWith('/api/acceptance/draft') && init?.method === 'PUT') {
        calls.push({url: String(url), method: 'PUT', body: init.body ? JSON.parse(init.body) : undefined});
        await putGate;
        return {ok: true, status: 200, json: async () => ({ok: true})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 编辑 + flushSave：PUT #1 发出并在途（此时还没发起重载，完整视图门是开的）
      setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
      click('[data-status-btn="SCH-010-01"][data-status="failed"]');
      panel.flushSave();
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      // ② 重载加载在途（PUT 未落账）：serverSeqAtRequest=0
      const getPromise = panel['loadDraft']('PKG-010');
      // ③ PUT 落账（serverSeq 0→1）后再放旧 GET 落地——它带着保存前的旧内容
      releasePut();
      await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'));
      releaseGet();
      await getPromise;
      await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
      // ④ 旧 GET 被序号分支作废：草稿值仍是 failed（没被回填成 passed/旧检查人）
      expect(document.querySelector('[data-draft-value="SCH-010-01"]')!.textContent).toContain('failed');
      // ⑤ 再编辑另一行：PUT 必须仍包含刚保存的那条（没被旧 GET 删掉）
      setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
      click('[data-status-btn="SCH-010-03"][data-status="passed"]');
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
      const put = calls.filter((call) => call.method === 'PUT')[1].body as {results: Array<{check_id: string}>};
      expect(put.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-03']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('加载期间编辑：晚到的 GET 必须合并回填，保存等加载落账（codex 十六审 blocking 回归）', async () => {
    // 复现路径（codex 十六审 blocking）：首开包，服务端已有 SCH-010-01 的结果
    // （C1），用户在 GET 返回前编辑 SCH-010-03（C2）。旧实现在「版本变化」后丢弃
    // 整份 GET——客户端从没见过 C1，随后 collectResults 只收本地 C2，而 PUT 是
    // 整份覆盖，C1 被永久删掉。修：GET 按 serverSeq 判陈旧（没保存落账就必须
    // 合并，编辑不构成丢弃理由）；完整视图门把保存搁置到加载落账后重发。
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const {panel, calls} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET') {
        await getGate;
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
        ]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 重载加载在途（服务端有 C1，尚未返回）
      const getPromise = panel['loadDraft']('PKG-010');
      // ② GET 返回前编辑 C2：完整视图门落下——flushSave 也不许发 PUT（旧 bug 在这里
      //    发出只含 C2 的 body，把 C1 永久删掉）
      setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
      click('[data-status-btn="SCH-010-03"][data-status="passed"]');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ③ GET 落地：合并回填——C1 原样采纳（服务端真相）、C2 本地编辑胜出；
      //    保存不丢，自动重发，body 两条都在
      releaseGet();
      await getPromise;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string; checked_by: string}>};
      expect(put.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-03']);
      // C1 的服务端字段逐字进 UI（不是本地默认空值）
      expect(put.results.find((r) => r.check_id === 'SCH-010-01')!.checked_by).toBe('业主');
      await vi.waitFor(() => expect(document.querySelector('[data-draft-value="SCH-010-01"]')!.textContent).toContain('passed'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('加载被别的包取代：搁置的保存不卡死（十六审根治自查回归）', async () => {
    // 完整视图门落下期间切到别的包：P 的 GET 被取代、永不再有落账事件。若加载
    // 处理在「被取代」时提前 return，尾部 maybeResumeSave 被跳过，P 搁置中的保存
    // 永远发不出去——退出审批页 flush 后编辑只剩内存。修：取代只置标志，还原
    // 加载前的完整态并照常走尾部收尾（十/十一/十五审的同族错误，不重犯）。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let releaseGetP: () => void = () => {};
    const gateP = new Promise<void>((resolve) => { releaseGetP = resolve; });
    const {selection, panel, calls} = await mountPanel({snapshot: twoPkg});
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET'
        && String(url).includes('PKG-010')) {
        await gateP;
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: []})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① P 重载在途（完整视图门落下）→ 编辑 + flush：保存被搁置，不发 PUT
      const getP = panel['loadDraft']('PKG-010');
      setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
      click('[data-status-btn="SCH-010-03"][data-status="passed"]');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ② 切到 Q：P 的 GET 被取代（draftPackageId 变了）
      selection.set({packageId: 'PKG-020', checkId: null});
      // ③ P 的 GET 落地（被取代分支）：还原完整态 + 尾部恢复搁置的保存
      releaseGetP();
      await getP;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {package_id: string; results: Array<{check_id: string}>};
      expect(put.package_id).toBe('PKG-010');
      expect(put.results.map((r) => r.check_id)).toEqual(['SCH-010-03']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('加载期间只改备注：慢 GET 落账后保存不丢（codex 十八审 blocking 1 回归）', async () => {
    // 复现路径（codex 十八审 blocking 1）：首开包 GET 超过 debounce（300ms），
    // 用户只改备注——本地 status 还是 null，collectResults 暂时为空。旧实现按
    // 「空 results」早退且不置 saveDeferred：GET 合并后 status 出现，但定时器已
    // 消费、无人重发，刷新即丢新备注。修：完整视图门先于空结果判定——空是加载
    // 期间的瞬态，保存意图搁置到落账后重发。
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const {panel, calls} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET') {
        await getGate;
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注'},
        ]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      const getPromise = panel['loadDraft']('PKG-010');
      // 只改备注，不选状态（本地 status=null，collectResults 为空——瞬态）
      setInput('[data-note="SCH-010-01"]', '新备注');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 400)); // 过完 debounce 窗口
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0); // 旧 bug：静默早退
      // GET 落地：合并出服务端 status + 本地新备注，搁置的保存自动重发
      releaseGet();
      await getPromise;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string; status: string; note?: string}>};
      expect(put.results.map((r) => r.check_id)).toEqual(['SCH-010-01']);
      expect(put.results[0].status).toBe('passed'); // 服务端合并来的
      expect(put.results[0].note).toBe('新备注'); // 本地编辑
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('同包两次读取交错：旧读取晚到不放行覆盖保存（codex 十九审 blocking 1 回归）', async () => {
    // 复现路径（codex 十九审 blocking 1）：连续发起 P 的 GET1、GET2 再切 Q。
    // GET1 先返回时若被当成本包最新真相合并并置 draftComplete，搁置的保存立即
    // 恢复，PUT 用 GET1 的旧视图覆盖服务端、删掉只有 GET2 才带回的新条目（别处
    // 新增的 C2）。修：按包的读取序号判定新旧——GET1 回头发现本包已有更新读取
    // 在途，不碰任何状态；读取新旧与当前选中谁无关。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let pGets = 0;
    let releaseGet1: () => void = () => {};
    let releaseGet2: () => void = () => {};
    const gate1 = new Promise<void>((resolve) => { releaseGet1 = resolve; });
    const gate2 = new Promise<void>((resolve) => { releaseGet2 = resolve; });
    const {selection, panel, calls} = await mountPanel({snapshot: twoPkg});
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET'
        && String(url).includes('PKG-010')) {
        pGets += 1;
        await (pGets === 1 ? gate1 : gate2);
        // GET1 只有 C1；GET2 才带回别处新增的 C2
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results:
          pGets === 1
            ? [{check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'}]
            : [{check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
               {check_id: 'SCH-010-02', status: 'failed', checked_by: '别处', checked_at: '2026-11-02'}]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 连续两次读 P（GET1、GET2 都在途）→ 编辑 C1 备注 → 保存被完整视图门搁置
      const get1 = panel['loadDraft']('PKG-010');
      const get2 = panel['loadDraft']('PKG-010');
      setInput('[data-note="SCH-010-01"]', '新备注');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ② 切 Q 再放行 GET1：不许合并、不许放行完整态、不许恢复保存（旧 bug 在这里
      //    用 GET1 的旧视图发只含 C1 的 PUT，把服务端的 C2 删掉）
      selection.set({packageId: 'PKG-020', checkId: null});
      releaseGet1();
      await get1;
      await new Promise((resolve) => setTimeout(resolve, 400)); // 过完 debounce：仍无 PUT
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ③ GET2 落账：合并（含别处新增的 C2）→ 搁置的保存恢复，PUT 两条都在
      releaseGet2();
      await get2;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string; note?: string; checked_by: string}>};
      expect(put.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-02']);
      expect(put.results.find((r) => r.check_id === 'SCH-010-01')!.note).toBe('新备注');
      expect(put.results.find((r) => r.check_id === 'SCH-010-02')!.checked_by).toBe('别处');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('别行编辑不复活服务端已删结果：缺失条目按条目级 touched 裁定（codex 十九审 blocking 2 回归）', async () => {
    // 复现路径（codex 十九审 blocking 2）：缓存有 C1、C2，用户只改 C1 备注，服务端
    // 已删除 C2。旧实现用包级 localWins：C2 这一行没动过也因「包 dirty」被保留，
    // 下次 PUT 写回、静默撤销服务端删除。修：缺失条目按**这一行自己的** touched
    // 裁定——没动过就是服务端删了，别行的编辑不能决定本行的命运。
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const {panel, calls} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注'},
          {check_id: 'SCH-010-02', status: 'failed', checked_by: '业主', checked_at: '2026-11-01'},
        ]}),
      },
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET') {
        await getGate;
        // 重载时服务端已删 C2，只返回 C1
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注'},
        ]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 重载在途 → 只改 C1 备注（C2 这一行没动过）→ 保存搁置
      const getPromise = panel['loadDraft']('PKG-010');
      setInput('[data-note="SCH-010-01"]', '新备注');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ② GET 落账：C1 字段级合并（备注用新的）；C2 服务端删了且本行没动过 → 丢弃
      releaseGet();
      await getPromise;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string; note?: string}>};
      expect(put.results.map((r) => r.check_id)).toEqual(['SCH-010-01']); // C2 不许被写回
      expect(put.results[0].note).toBe('新备注');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('重载被别包取代也照常合并：别处新增的结果不许被覆盖删除（codex 十八审 blocking 2 回归）', async () => {
    // 复现路径（codex 十八审 blocking 2）：P 的缓存只有 C1，另一标签页在服务端
    // 新增了 C2；重载 P 期间编辑 C1 并切到 Q。P 的响应（含 C1+C2）被 Q 的加载
    // 取代——旧实现整份丢弃再恢复完整态：C2 永不觉察，恢复后自动 PUT 只含旧缓存
    // C1，整份覆盖把服务端的 C2 永久删掉。修：被别包取代时响应仍是该包最新真相，
    // 照常裁定（合并），只是不渲染。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let releaseGetP: () => void = () => {};
    const gateP = new Promise<void>((resolve) => { releaseGetP = resolve; });
    const {selection, panel, calls} = await mountPanel({snapshot: twoPkg});
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET'
        && String(url).includes('PKG-010')) {
        await gateP;
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
          {check_id: 'SCH-010-02', status: 'failed', checked_by: '别处', checked_at: '2026-11-02'},
        ]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① P 重载在途 → 编辑 C1 备注 → 保存被完整视图门搁置
      const getP = panel['loadDraft']('PKG-010');
      setInput('[data-note="SCH-010-01"]', '新备注');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
      // ② 切到 Q（P 的 GET 被取代）→ 放行 P 的响应：必须照常合并（C2 进缓存）
      selection.set({packageId: 'PKG-020', checkId: null});
      releaseGetP();
      await getP;
      // ③ 搁置的保存恢复：PUT 必须含 C1（带新备注）+ C2（别处新增，不许被删）
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string; note?: string; checked_by: string}>};
      expect(put.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-02']);
      expect(put.results.find((r) => r.check_id === 'SCH-010-01')!.note).toBe('新备注');
      expect(put.results.find((r) => r.check_id === 'SCH-010-02')!.checked_by).toBe('别处');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('脏态合并是字段级：只改备注不丢服务端已存的 status/验收人/证据（codex 十七审 blocking 回归）', async () => {
    // 复现路径（codex 十七审 blocking）：首载前只改 C1 的备注，本地记录其余字段
    // 还是默认空值（status=null）。旧实现包级 dirty 时本地**整条**胜出——服务端
    // 已存的 status/验收人/证据被全部跳过，collectResults 再跳过 status=null 的
    // 行，整份覆盖 PUT 把 C1 永久删掉。修：touched 集记录编辑意图——动过的字段
    // （含清空）本地胜出，没动过的字段服务端逐字采用。
    let releaseGet: () => void = () => {};
    const getGate = new Promise<void>((resolve) => { releaseGet = resolve; });
    const {panel, calls} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET') {
        await getGate;
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注', evidence: [FINAL_PATH]},
        ]})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 重载在途（服务端有 C1 完整结果）→ 只改 C1 备注，不碰状态/验收人/证据
      const getPromise = panel['loadDraft']('PKG-010');
      setInput('[data-note="SCH-010-01"]', '新备注');
      // ② GET 落地：字段级合并。完整视图门把保存搁置到落账后，第一份 PUT 应含
      //    C1 的**服务端字段 + 本地新备注**（旧实这里只会发出 status=null 的空壳）
      releaseGet();
      await getPromise;
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      const put1 = calls.filter((call) => call.method === 'PUT')[0].body as {
        results: Array<{check_id: string; status: string; checked_by: string; checked_at: string; note?: string; evidence: string[]}>;
      };
      const c1 = put1.results.find((r) => r.check_id === 'SCH-010-01')!;
      expect(c1, 'C1 不许被删').toBeTruthy();
      expect(c1.status).toBe('passed'); // 没动过：服务端逐字采用
      expect(c1.checked_by).toBe('业主');
      expect(c1.checked_at).toBe('2026-11-01');
      expect(c1.evidence).toEqual([FINAL_PATH]);
      expect(c1.note).toBe('新备注'); // 动过：本地胜出
      // ③ 合并结果进 UI（草稿值是服务端的 passed，不是未选择）
      await vi.waitFor(() => expect(document.querySelector('[data-draft-value="SCH-010-01"]')!.textContent).toContain('passed'));
      // ④ 再给 C3 选状态：第二份 PUT 两条都在，C1 字段仍完整
      click('[data-status-btn="SCH-010-03"][data-status="passed"]');
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
      const put2 = calls.filter((call) => call.method === 'PUT')[1].body as {results: Array<{check_id: string; status: string}>};
      expect(put2.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-03']);
      expect(put2.results.find((r) => r.check_id === 'SCH-010-01')!.status).toBe('passed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('脏态字段级合并不清空用户删空字段：清备注后重载不复活旧备注（codex 七审 blocking 回归）', async () => {
    // 七审场景在新规则下的守卫：保存失败（dirty 未清）→ 重载带回服务端旧备注。
    // 字段级裁定里「动过的字段本地胜出」必须覆盖**清空**这个意图——旧备注不许
    // 复活，否则重试保存把它 PUT 回去（静默撤销用户的删除）。（保存成功时
    // touched 清零、服务端也已确认清空，那是闭环后的另一条路径，不在此列。）
    const {panel} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注'},
        ]}),
        putDraft: () => ({status: 500, body: {ok: false, error: '模拟保存失败'}}),
      },
    });
    // ① 清空备注（只动 note 一个字段）→ 保存失败，dirty 保持
    setInput('[data-note="SCH-010-01"]', '');
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('保存失败'), {timeout: 3000});
    // ② 重载（服务端仍返回旧备注）：合并后备注必须仍是空——旧值不许复活
    await panel['loadDraft']('PKG-010');
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
    expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('');
    // ③ 状态/验收人这些没动过的字段仍在（不会被本地空壳顶掉）
    expect(document.querySelector('[data-draft-value="SCH-010-01"]')!.textContent).toContain('passed');
    expect((document.querySelector('[data-checked-by="SCH-010-01"]') as HTMLInputElement).value).toBe('业主');
  });

  it('同包 PUT 串行：在途期间的新保存等它落账后用最新内容重发（codex 十六审根治回归）', async () => {
    // PUT 是整份覆盖：两份 body 竞态落账时，先发后到的那份会把后一份的新条目
    // 删掉。修：同包在途期间新保存搁置，落账后以最新内容重发（陈旧成功也不清
    // dirty——视图在途变过的 body 成功不算数）。
    let releasePut: () => void = () => {};
    const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
    let putCount = 0;
    const {panel, calls} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && init?.method === 'PUT') {
        calls.push({url: String(url), method: 'PUT', body: init.body ? JSON.parse(init.body) : undefined});
        putCount += 1;
        if (putCount === 1) await putGate; // 第一份在途压住，制造竞态窗口
        return {ok: true, status: 200, json: async () => ({ok: true})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① 编辑 A：PUT #1 发出并在途
      setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
      click('[data-status-btn="SCH-010-01"][data-status="passed"]');
      panel.flushSave();
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
      // ② 在途期间编辑 B 并 flush：不许发第二份（竞态会删条目）
      setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
      click('[data-status-btn="SCH-010-03"][data-status="failed"]');
      panel.flushSave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls.filter((call) => call.method === 'PUT').length).toBe(1);
      // ③ 放行 #1：落账后自动重发，#2 的 body 含 A+B 两条（#1 是只含 A 的旧 body）
      releasePut();
      await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
      const put = calls.filter((call) => call.method === 'PUT')[1].body as {results: Array<{check_id: string}>};
      expect(put.results.map((r) => r.check_id).sort()).toEqual(['SCH-010-01', 'SCH-010-03']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('未选状态的行：保存成功不清它的 touched，重载不删已填输入（codex 二十审 blocking 回归）', async () => {
    // 复现路径（codex 二十审 blocking）：C1 已有状态，用户给另一行填了备注/检查人
    // 但还没选状态——collectResults 跳过 status=null 的行，PUT 只含 C1。旧实现
    // 保存成功时清空**全包**所有行的 touched：那行的输入被误标成已确认，下次重载
    // 时它既不在服务端结果中又没有 touched，被当「服务端删了」直接删除。修：
    // touched 只清本次 PUT 实际包含的行。
    const {panel, calls} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: [
          {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
        ]}),
      },
    });
    // ① 给 SCH-010-03 填备注 + 检查人，不选状态 → PUT 只含 C1
    setInput('[data-note="SCH-010-03"]', '还没选状态的备注');
    setInput('[data-checked-by="SCH-010-03"]', '业主');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string}>};
    expect(put.results.map((r) => r.check_id)).toEqual(['SCH-010-01']); // 没选状态的行不进 body
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'));
    // ② 重载（服务端仍只有 C1）：那行已填的输入不许被删
    await panel['loadDraft']('PKG-010');
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
    expect((document.querySelector('[data-note="SCH-010-03"]') as HTMLInputElement).value).toBe('还没选状态的备注');
    expect((document.querySelector('[data-checked-by="SCH-010-03"]') as HTMLInputElement).value).toBe('业主');
  });

  it('保存成功后切页往返：无变化重载不清刚跑的卡点/预演（codex 二十审 major 回归）', async () => {
    // 复现路径（codex 二十审 major）：加载旧草稿→编辑→保存成功→跑卡点和预演→
    // 切包再返回。重载的 GET 与刚保存的内容完全一致，但 lastServerDraft 还是保存
    // 前的旧内容——九审「服务端变过才作废」误判为变过，刚跑出的卡点/预演被清，
    // 正常切页往返都要重跑耗时检查。修：PUT 落账时同步服务端内容基准。
    let serverDraft: Array<Record<string, unknown>> = [
      {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01', note: '旧备注'},
    ];
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, panel} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: serverDraft}),
        putDraft: (body) => {
          serverDraft = (body as {results: Array<Record<string, unknown>>}).results;
          return {status: 200, body: {ok: true}};
        },
      },
    });
    // 编辑 → 保存成功（服务端内容随之更新）
    setInput('[data-note="SCH-010-01"]', '新备注');
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'), {timeout: 3000});
    // 跑卡点 + 预演
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    // 切包再返回：重载内容与刚保存的一致——卡点/预演不许被误作废
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
    expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5');
    expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入');
    expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('新备注');
  });

  it('干净包里未落盘的输入不被服务端覆盖：合并只看行级 touched（codex 二十一审 blocking 1 回归）', async () => {
    // 复现路径（codex 二十一审 blocking 1）：C1 已有状态，给 C2 填备注但没选状态
    // ——PUT 只含 C1，保存成功后整包 dirty 清零，C2 的 touched 按二十审修法保留；
    // 但旧实现的合并只在**包脏**分支消费 touched，包一干净就走「服务端逐字」：别处
    // 保存 C2 后返回，本地未落盘的备注被服务端字段静默覆盖。修：合并统一按行级
    // touched 裁定，与包级 dirty 无关（干净包 touched 实际为空，行为不变）。
    let serverDraft: Array<Record<string, unknown>> = [
      {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
    ];
    const {panel} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: serverDraft}),
        putDraft: (body) => {
          serverDraft = (body as {results: Array<Record<string, unknown>>}).results;
          return {status: 200, body: {ok: true}};
        },
      },
    });
    // ① 给 C2（SCH-010-03）填备注，不选状态 → PUT 只含 C1 → 保存成功（整包 clean）
    setInput('[data-note="SCH-010-03"]', '本地未落盘的备注');
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'), {timeout: 3000});
    // ② 另一标签页保存了 C2（服务端现有该行，备注是别处写的）
    serverDraft = [
      ...serverDraft,
      {check_id: 'SCH-010-03', status: 'passed', checked_by: '别处', checked_at: '2026-11-02', note: '别处写的备注'},
    ];
    // ③ 重载合并：本地未落盘的备注必须胜出，不被服务端字段覆盖
    await panel['loadDraft']('PKG-010');
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
    expect((document.querySelector('[data-note="SCH-010-03"]') as HTMLInputElement).value).toBe('本地未落盘的备注');
    // 没动过的字段仍取服务端（别处选的 passed / 别处填的检查人）
    expect(document.querySelector('[data-draft-value="SCH-010-03"]')!.textContent).toContain('passed');
    expect((document.querySelector('[data-checked-by="SCH-010-03"]') as HTMLInputElement).value).toBe('别处');
  });

  it('控制源指纹变化后旧预演作废：提交按钮回到不可用（codex 二十一审 blocking 2 回归）', async () => {
    // 复现路径（codex 二十一审 blocking 2）：P 生成预演 → 切包期间检查标准/项目数据
    // 变化 → 返回 P。草稿内容没变（lastServerDraft 比对不动作废），但旧结论是按旧
    // 指纹算的——服务端 submit 按**当前**控制源重新生成记录，放行提交等于让业主
    // 确认的预演与实际写入 commit 的指纹不同。修：结论落账记控制源指纹（项目数据
    // 指纹 + 各检查标准指纹），快照重拉对不上即作废。
    const {panel} = await mountPanel();
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    // 控制源变化（PR 合并 / 量房修正后快照指纹变）→ refresh 重拉
    (panel['payload'] as {data_fingerprint: string}).data_fingerprint = 'fp-changed';
    await panel.refresh();
    // 旧 gates/dryRun 必须作废：卡点区回到「还没跑过」，提交按钮不可用
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('还没跑过机械卡点'));
    expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入');
    expect((document.querySelector('#acceptance-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('别包的校验失败不清当前包行级错误（codex 二十一届 major 回归）', async () => {
    // draftResults 按包混放后，旧实现两处遍历全表清 issues：applyIssues（A 的迟到
    // 422 抹掉 B 已显示的红字，而 B 的失败提示还叫业主「见各行红字」）与 applyDraft
    // 保留别包缓存的分支。修：清理范围限本包检查项；别包缓存连 issues 一起保留。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, panel, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        putDraft: (body) => {
          const pkgId = (body as {package_id: string}).package_id;
          return pkgId === 'PKG-010'
            ? {status: 422, body: {ok: false, issues: [{check_id: 'SCH-010-01', field: 'checked_by', message: 'A 行错误：必须填验收人'}]}}
            : {status: 422, body: {ok: false, issues: [{check_id: 'SCH-020-01', field: 'checked_by', message: 'B 行错误：必须填验收人'}]}};
        },
      },
    });
    // ① A 保存 422：行级红字挂上
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await vi.waitFor(() => expect(document.querySelector('[data-check-issues="SCH-010-01"]')!.textContent).toContain('A 行错误'), {timeout: 3000});
    // ② 切 B 保存 422（迟到的 A 类响应）：A 行的红字不许被抹掉
    selection.set({packageId: 'PKG-020', checkId: null});
    setInput('[data-checked-at="SCH-020-01"]', '2026-11-02');
    click('[data-status-btn="SCH-020-01"][data-status="passed"]');
    await vi.waitFor(() => expect(document.querySelector('[data-check-issues="SCH-020-01"]')!.textContent).toContain('B 行错误'), {timeout: 3000});
    // A 行的红字在 draftResults 里完好（切走后不在 DOM，白盒断言状态；别包缓存
    // 连 issues 一起保留是本条修复的数据面）
    expect(panel['draftResults'].get('SCH-010-01')!.issues.map((issue) => issue.message)).toContain('A 行错误：必须填验收人');
  });

  it('合并把未落盘字段变成可保存结果：必须重新落账（codex 二十二审 blocking 回归）', async () => {
    // 复现路径（codex 二十二审 blocking）：C1 已有状态，给 C2 填备注（没选状态）
    // ——PUT 只含 C1，保存成功后整包 dirty 清零；另一标签页保存 C2 后本页重载，
    // 合并出「服务端状态 + 本地备注」的可保存结果，但 dirty 仍为 false、没有定时
    // 器：ensureDraftPersisted 放行卡点/预演/提交去读服务端旧备注，界面却显示本地
    // 新备注并声称已保存，刷新即丢。修：合并检出「本包有行带未落盘字段且已有
    // 状态」时恢复待存状态并排保存。
    let serverDraft: Array<Record<string, unknown>> = [
      {check_id: 'SCH-010-01', status: 'passed', checked_by: '业主', checked_at: '2026-11-01'},
    ];
    const {panel, calls} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: serverDraft}),
        putDraft: (body) => {
          serverDraft = (body as {results: Array<Record<string, unknown>>}).results;
          return {status: 200, body: {ok: true}};
        },
      },
    });
    // ① C2 填备注不选状态 → PUT 只含 C1 → 已保存（整包 clean）
    setInput('[data-note="SCH-010-03"]', '本地未落盘的备注');
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'), {timeout: 3000});
    expect(calls.filter((call) => call.method === 'PUT').length).toBe(1);
    // ② 另一标签页保存 C2（服务端现有该行）
    serverDraft = [
      ...serverDraft,
      {check_id: 'SCH-010-03', status: 'passed', checked_by: '别处', checked_at: '2026-11-02', note: '别处写的备注'},
    ];
    // ③ 重载合并：本地备注 + 服务端状态 → 必须自动重新落账（PUT #2 带本地备注）
    await panel['loadDraft']('PKG-010');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    const put2 = calls.filter((call) => call.method === 'PUT')[1].body as {results: Array<{check_id: string; note?: string; status: string}>};
    const c2 = put2.results.find((r) => r.check_id === 'SCH-010-03')!;
    expect(c2.status).toBe('passed');
    expect(c2.note).toBe('本地未落盘的备注');
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'), {timeout: 3000});
    // 界面显示与落账内容一致（本地备注胜出）
    expect((document.querySelector('[data-note="SCH-010-03"]') as HTMLInputElement).value).toBe('本地未落盘的备注');
  });

  it('等待草稿落账期间预演失效：提交中止而不是拿着旧预演开 PR（codex 二十三审 blocking 回归）', async () => {
    // 复现路径（codex 二十三审 blocking，与其只读提取验证同法）：submit 先
    // await ensureDraftPersisted——等待窗口内旧预演可能被作废（并发 refresh/控制源
    // 变化；保存成功自身也会作废预演与确认态）。旧实现 await 后直接发真实提交：
    // 业主确认过的预演已作废，开 PR 的是没重新预演过的内容。修：等待前捕获预演
    // 对象与控制源指纹，等待后复核，变过即中止。
    let releasePut2: () => void = () => {};
    const putGate = new Promise<void>((resolve) => { releasePut2 = resolve; });
    let putCount = 0;
    const {panel, calls} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && init?.method === 'PUT') {
        putCount += 1;
        calls.push({url: String(url), method: 'PUT', body: init.body ? JSON.parse(init.body) : undefined});
        if (putCount === 2) {
          // 并发事件在 submit 等待落账的窗口内落地：旧预演被作废、版本推进
          // （另一标签页改动 / refresh 重载）——随后 ensure 重试保存仍会成功
          panel['invalidateRunForDraftChange']('PKG-010');
          await putGate;
        }
        return {ok: true, status: 200, json: async () => ({ok: true})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // 选状态 → 立即落账（PUT #1 不被压）
      click('[data-status-btn="SCH-010-01"][data-status="passed"]');
      panel.flushSave();
      await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'), {timeout: 3000});
      // 卡点 + 预演（新鲜）
      click('#acceptance-run-gates');
      await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
      click('#acceptance-dry-run');
      await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
      // 造出「有未落账编辑」的状态（debounce 定时器已消费、保存未成功——正是
      // ensureDraftPersisted 的存在理由；自然流里它与新鲜预演互斥，与 codex 一样
      // 用状态注入复现等待窗口）
      panel['saveRecordFor']('PKG-010').dirty = true;
      // 两步确认：第一次武装，第二次发起提交（submit 在 ensure 上在途）
      click('#acceptance-submit');
      click('#acceptance-submit');
      await new Promise((resolve) => setTimeout(resolve, 50));
      releasePut2();
      // 真实提交不许发出（此前只有 dry_run），并留痕要求重新预演
      await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('预演已失效'), {timeout: 3000});
      const realSubmits = calls.filter((call) => call.url.includes('/api/acceptance/submit') && !(call.body as {dry_run?: boolean})?.dry_run);
      expect(realSubmits.length).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('在途慢保存不误判：卡点等保存真正落账再跑（codex 二十四审 major 回归）', async () => {
    // 复现路径（codex 二十四审 major）：ensureDraftPersisted 旧实现用三次 25ms
    // 短轮询猜在途保存——正常慢 PUT（>75ms）被误判成「草稿还没保存成功」，业主
    // 编辑后立刻点「跑机械卡点」白中止并报错，保存随后成功也不继续。修：同包保存
    // 串成一条链，ensure await 这条链等真正落账。
    const {panel} = await mountPanel();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && init?.method === 'PUT') {
        await new Promise((resolve) => setTimeout(resolve, 250)); // 慢保存（远超旧的 75ms 轮询上限）
        return {ok: true, status: 200, json: async () => ({ok: true})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // 编辑 → 立即 flush（PUT 在途且慢）→ 马上点卡点
      click('[data-status-btn="SCH-010-01"][data-status="passed"]');
      panel.flushSave();
      click('#acceptance-run-gates');
      // 卡点必须等保存落账后真的跑出来，且不出现误报的「草稿还没保存成功」
      await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 5000});
      expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('草稿还没保存成功');
      expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('上传在途时别包草稿晚到：上传结果写进当前状态对象（codex 二十五审 major 回归）', async () => {
    // 复现路径（codex 二十五审 major）：Q 的草稿 GET 在途→切回 P 开始上传→Q 的
    // GET 晚到。合并把 P 的条目**克隆**进新表，而 uploadEvidence 在 await 前捕获了
    // 原对象——上传成功后写回孤儿：界面永远「上传中」、「选为最终证据」不可用、
    // 暂存文件接不进草稿（内存复现：旧对象已有 staging_path，状态表却仍
    // staged=null、uploading=true）。修：合并对未改动的别包条目保留对象身份；
    // 上传/落定/读文件失败等异步完成后重新取当前状态对象再写。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let releaseQGet: () => void = () => {};
    const qGetGate = new Promise<void>((resolve) => { releaseQGet = resolve; });
    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
    const {selection, panel} = await mountPanel({snapshot: twoPkg});
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).startsWith('/api/acceptance/draft') && (init?.method ?? 'GET') === 'GET'
        && String(url).includes('PKG-020')) {
        await qGetGate; // Q 的草稿 GET 压住在途
        return {ok: true, status: 200, json: async () => ({package_id: 'PKG-020', results: []})} as Response;
      }
      if (String(url).startsWith('/api/acceptance/evidence') && !String(url).includes('finalize') && init?.method === 'POST') {
        await uploadGate; // 上传压住在途
        return {ok: true, status: 201, json: async () => ({staging_path: STAGING_PATH, sha256: 'a'.repeat(64), size: 1234})} as Response;
      }
      return realFetch(url, init);
    }));
    try {
      // ① Q 的草稿 GET 在途
      selection.set({packageId: 'PKG-020', checkId: null});
      // ② 切回 P（P 的加载立即落地）并发起上传（在途）
      selection.set({packageId: 'PKG-010', checkId: null});
      const uploading = panel['uploadEvidence']('PKG-010', 'SCH-010-01', 'a.jpg', 'ZmFrZQ==');
      // ③ Q 的 GET 晚到（被 P 的加载取代，仍照常合并 Q 的内容）→ P 的条目走别包
      //    缓存分支：旧实现克隆（写回孤儿），修后保留对象身份
      releaseQGet();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // ④ 上传成功（业主在 P 上）：必须落进**当前**状态对象
      releaseUpload();
      await uploading;
      const live = panel['draftResults'].get('SCH-010-01')!;
      expect(live.staged?.staging_path).toBe(STAGING_PATH);
      expect(live.uploading).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('草稿重载未确认时提交按钮禁用：在途与读取失败都堵（codex 十四审 blocking 回归）', async () => {
    // A 生成预演 → 切 B → 服务端草稿被别处改动 → 切回 A：重载在途或 GET 失败
    // 期间旧预演还挂着，但服务端 submit 会重读草稿——业主预演的可能与将写入
    // 的不一致。修：draftLoading/draftError 期间禁用提交。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let draftFail = false;
    const {selection, panel} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        draft: () => {
          if (draftFail) throw new Error('模拟 GET 失败');
          return {package_id: 'PKG-010', results: []};
        },
      },
    });
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    // ① 重载在途：调用 loadDraft 后（mock 异步resolve前）draftLoading=true → 提交禁用
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    const reloadPromise = panel['loadDraft']('PKG-010');
    expect((document.querySelector('#acceptance-submit') as HTMLButtonElement).disabled).toBe(true);
    await reloadPromise;
    // ② 重载失败：draftError 置位 → 继续禁用（旧预演也不放行）
    draftFail = true;
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    const failPromise = panel['loadDraft']('PKG-010');
    await failPromise.catch(() => undefined);
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).toContain('草稿读取失败'));
    expect((document.querySelector('#acceptance-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('服务端清空的备注/证据不许在干净态重载后复活（codex 十三审 blocking 回归）', async () => {
    // A 的结果带旧备注+旧证据 → 切 B → 服务端把该结果的 note/evidence 清空 →
    // 回 A。旧实现干净态有字段级回落（服务端空 note 跌回本地旧值），复活后下次
    // 编辑 PUT 回去。修：干净态服务端字段逐字采用（含空值）。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let draftCalls = 0;
    const {selection, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        draft: () => {
          draftCalls += 1;
          return draftCalls === 1
            ? {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: ['schedule/phase-1/evidence/PKG-010/SCH-010-01/old.jpg'], note: '旧备注'}]}
            : {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: [], note: ''}]}; // 字段被清空
        },
      },
    });
    await vi.waitFor(() => expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('旧备注'));
    // 切 B 再回 A：服务端已清空——备注必须为空、证据列表必须空
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe(''));
    expect(document.querySelector('[data-evidence-area="SCH-010-01"]')!.textContent).toContain('最终证据：无');
    // 触发一次保存：PUT 里该条不得带旧备注/旧证据
    setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
    click('[data-status-btn="SCH-010-03"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{note?: string; evidence: string[]; check_id: string}>};
    const r01 = put.results.find((r) => r.check_id === 'SCH-010-01');
    // 结果本身服务端还在（status failed），要 PUT 回去——但必须是**清空后**的字段
    expect(r01).toBeDefined();
    expect(r01!.note ?? '').toBe('');
    expect(r01!.evidence).toEqual([]);
  });

  it('服务端删了的结果不许被切包重载复活（codex 十二审 blocking 回归）', async () => {
    // A 有一条已保存结果 → 切到 B → 服务端清除了 A 的该条（另一标签页/提交后清
    // 草稿）→ 回 A：GET 返回空，本地条目必须丢弃。旧实现无条件保留，下次编辑
    // 别的行会把已删结果 PUT 回去，静默撤销服务端删除。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let draftCalls = 0;
    const {selection, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        // mock 的 draft handler 无请求参数，用调用次序模拟：首次加载 A 有结果，
        // 再次加载（切 B 后返回 A）时服务端已删
        draft: () => {
          draftCalls += 1;
          return draftCalls === 1
            ? {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: []}]}
            : {package_id: 'PKG-010', results: []};
        },
      },
    });
    // 第一次加载：A 有一条服务端结果（dirty=false）
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).toContain('已载入 tmp/ 草稿 1 条'));
    // 切到 B 再回 A：重载拿到空 results——旧实现会留住旧条目（复活已删结果）
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).toContain('暂无该包草稿'));
    // 编辑另一行触发保存：PUT 里不得包含被服务端删掉的那条。
    // 用 SCH-010-03（无 open_gates；SCH-010-02 的 passed 被 DEC-瓷砖 阻塞）
    setInput('[data-checked-at="SCH-010-03"]', '2026-11-02');
    click('[data-status-btn="SCH-010-03"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    const put = calls.find((call) => call.method === 'PUT')!.body as {results: Array<{check_id: string}>};
    expect(put.results.map((r) => r.check_id)).toEqual(['SCH-010-03']);
  });

  it('debounce 窗口内二次编辑：旧 PUT 成功不清新编辑的 dirty（codex 九审 blocking 回归）', async () => {
    // 编辑 v1 → PUT(v1) 在途 → 编辑 v2（300ms 内，不起新请求）→ v1 成功回头。
    // 旧实现清 dirty → 切包往返时 applyDraft 拿服务端旧值覆盖 v2。修：编辑版本
    // 对不上就不清 dirty（本地胜出），v2 等自己的定时器落盘。
    let putCount = 0;
    const {selection, panel, calls} = await mountPanel({
      handlers: {putDraft: () => { putCount += 1; return putCount === 1 ? {status: 200, body: {ok: true}} : {status: 200, body: {ok: true}}; }},
    });
    // v1 编辑并立刻 flush（在途）。先选状态——collectResults 只收选过状态的行
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="failed"]');
    setInput('[data-note="SCH-010-01"]', 'v1备注');
    panel.flushSave();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    // v1 成功已落账 → v2 编辑（不起新 PUT）
    setInput('[data-note="SCH-010-01"]', 'v2备注-未保存');
    // 切包往返：applyDraft 以 dirty=true 本地胜出，v2 不被服务端旧值覆盖
    selection.set({packageId: null, checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('v2备注-未保存'));
  });

  it('服务端草稿重载内容变了：已落账的旧预演必须作废（codex 九审 blocking 回归）', async () => {
    // 生成预演 → 服务端草稿被另一标签页改动（重载内容不同）→ 旧预演和提交按钮
    // 必须让位（真实提交读新草稿，业主确认的不能是旧内容）。
    let draftVersion = 0;
    const {panel} = await mountPanel({
      handlers: {
        draft: () => {
          draftVersion += 1;
          return draftVersion === 1
            ? {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: [], note: '初版'}]}
            : {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-02', evidence: [], note: '别处改过的新版'}]};
        },
      },
    });
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    // 刷新面板（重取快照+草稿）→ 服务端草稿内容变了 → 旧预演作废
    await panel.refresh();
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入'));
    expect(document.querySelector('#acceptance-actions')!.textContent).toContain('还没跑过机械卡点');
  });

  it('退出审批页再重选：两步确认态不跨页面保留（codex 十审 major 回归）', async () => {
    // A 武装 → 返回 3D（清空选中，render 早退）→ 重选 A。旧实现把解除放在早退
    // 之后，够不着——确认态还在，下一次点击直接开 PR。
    const {selection} = await mountPanel();
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    click('#acceptance-submit');
    expect(document.querySelector('#acceptance-submit')!.textContent).toContain('再点一次');
    // 退出审批页（清空选中）再重选 A
    selection.set({packageId: null, checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('#acceptance-submit')!.textContent).toContain('确认提交'));
    // 第一次点击仍只进确认态（不直接 POST）
    click('#acceptance-submit');
    expect(document.querySelector('#acceptance-submit')!.textContent).toContain('再点一次');
  });

  it('无变化草稿重载后卡点按钮不卡「执行中」（codex 十一审 major 回归）', async () => {
    // 复现路径：卡点在途 → 未变化的草稿 GET 回填（applyDraft 仍 bump 版本）→ 旧响应
    // 作废。十审的修法在 finally 前重绘，画面 loading 仍 true；finally 后又不重绘，
    // 按钮卡死。修：重绘统一在 finally 之后。
    const {panel} = await mountPanel();
    const gatesPromise = panel['runGates']('PKG-010');
    // 在途期间触发一次无变化重载（ensureDraft 同包不重拉——直接调 loadDraft 模拟）
    void panel['loadDraft']('PKG-010');
    await gatesPromise;
    expect(document.querySelector('#acceptance-run-gates')!.textContent).toContain('跑机械卡点');
    expect((document.querySelector('#acceptance-run-gates') as HTMLButtonElement).disabled).toBe(false);
    // 再验预演路径同修
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    const dryPromise = panel['runDryRun']('PKG-010');
    void panel['loadDraft']('PKG-010');
    await dryPromise;
    expect(document.querySelector('#acceptance-dry-run')!.textContent).toContain('生成 PR 预演');
    expect((document.querySelector('#acceptance-dry-run') as HTMLButtonElement).disabled).toBe(false);
  });

  it('版本作废后操作条不卡「执行中」（codex 十审 major 回归）', async () => {
    // 卡点在途 → 草稿变版（旧响应作废）→ 尾部的重绘不能漏——否则按钮永远禁用。
    const {panel} = await mountPanel();
    const gatesPromise = panel['runGates']('PKG-010');
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02'); // 在途期间编辑 → bump 版本
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await gatesPromise;
    // 旧响应被作废，但界面必须回到可用态（不是「卡点执行中…」禁用）
    expect(document.querySelector('#acceptance-run-gates')!.textContent).toContain('跑机械卡点');
    expect((document.querySelector('#acceptance-run-gates') as HTMLButtonElement).disabled).toBe(false);
  });

  it('同包旧响应作废：预演在途时草稿变化，旧预演不许填回（codex 八审 blocking 回归）', async () => {
    // A 的预演在途 → 本地编辑（草稿变版，旧结论作废）→ 旧预演响应晚到。旧实现
    // 把旧草稿的预演填回 run.dryRun，提交按钮对着过期预览重新可用，而真实提交
    // 读的是新草稿——按钮结论与服务端读的不一致。
    const {panel} = await mountPanel();
    // 先跑卡点拿绿（预演的前置）
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    // 把 dry_run 响应压住在途：编辑必须发生在**真正的 fetch 在途期间**（十八审给
    // 预演加了「发起前确保草稿落账」，编辑发生在 ensure 阶段会被落账吸收、不构成
    // 在途变化——守卫本身没变，变的是编辑时点）
    let releaseDryRun: () => void = () => {};
    const dryRunGate = new Promise<void>((resolve) => { releaseDryRun = resolve; });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: {method?: string; body?: string}) => {
      if (String(url).includes('/api/acceptance/submit') && (init?.body ?? '').includes('dry_run')) {
        await dryRunGate;
      }
      return realFetch(url, init);
    }));
    try {
      const dryRunPromise = panel['runDryRun']('PKG-010');
      // ensure 落账完、fetch 真的发出后再编辑（在途期间）
      await new Promise((resolve) => setTimeout(resolve, 50));
      setInput('[data-note="SCH-010-01"]', '编辑于预演在途期间');
      releaseDryRun();
      await dryRunPromise;
      // 旧响应应被版本校验作废：预演区不留旧草稿的预览
      await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入'));
      expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('切包解除两步确认态：A 武装后切走再回来，下一次点击不直接开 PR（codex 八审 major 回归）', async () => {
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, calls} = await mountPanel({snapshot: twoPkg});
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演：将写入'), {timeout: 3000});
    // 第一次点提交 = 只进确认态（按钮变红字「再点一次」）
    click('#acceptance-submit');
    expect(document.querySelector('#acceptance-submit')!.textContent).toContain('再点一次');
    // 切到 B 再回 A：确认态必须已解除。切回会触发草稿重载——重载在途时提交
    // 按钮本就禁用（codex 十四审守卫），要等重载完成再点
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-draft-status]')!.textContent).not.toContain('草稿加载中'));
    await vi.waitFor(() => expect(document.querySelector('#acceptance-submit')!.textContent).toContain('确认提交'));
    // 此时点一次仍只进确认态，不直接 POST（两步确认没被掏空）。
    // 注意 dry-run 也走 /api/acceptance/submit（带 dry_run:true），要排除。
    click('#acceptance-submit');
    const realSubmits = calls.filter((call) => call.url === '/api/acceptance/submit' && call.method === 'POST' && !(call.body as {dry_run?: boolean})?.dry_run);
    expect(realSubmits.length).toBe(0);
    expect(document.querySelector('#acceptance-submit')!.textContent).toContain('再点一次');
  });

  it('按包运行态：A 的卡点结果不出现在 B 的操作条（结构性隔离回归）', async () => {
    // 根治前卡点/预演/提交是面板级单槽：A 跑出的卡点 5/5 会显示在 B 的面板里。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection} = await mountPanel({snapshot: twoPkg});
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    // 切到 B：B 从没跑过卡点——条上必须是「还没跑过」，不是 A 的 5/5
    selection.set({packageId: 'PKG-020', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('还没跑过机械卡点'));
    expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('卡点 5/5');
    // 切回 A：A 的结论还在（按包保留，不因换包重置）
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
  });

  it('按包定时器：切到 B 编辑不清掉 A 的待存保存（结构性隔离回归）', async () => {
    // 根治前保存定时器是面板级单槽：B 的 scheduleSave 会 clearTimeout 掉 A 待存的
    // 编辑——A 的保存被静默推迟到下次触碰 A。现在各包定时器互不干扰。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, calls} = await mountPanel({snapshot: twoPkg});
    // A 编辑（debounce 挂起，不 flush）
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    // 切 B 编辑（旧实现此刻清掉 A 的定时器）
    selection.set({packageId: 'PKG-020', checkId: null});
    setInput('[data-checked-at="SCH-020-01"]', '2026-11-02');
    click('[data-status-btn="SCH-020-01"][data-status="passed"]');
    // 两个包的保存都应各自到点落盘（300ms debounce，不碰 A）
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    const putPkgs = calls.filter((call) => call.method === 'PUT').map((call) => (call.body as {package_id: string}).package_id).sort();
    expect(putPkgs).toEqual(['PKG-010', 'PKG-020']);
  });

  it('跨包保存互不污染：B 保存成功不许把 A 的失败标成已保存（codex 五审 blocking 回归）', async () => {
    // 旧实现是面板级共享 saveStatus：A 失败后切到 B、B 保存成功，共享状态被写成
    // saved——切回 A 时失败态没了、重试入口没了，A 未保存的编辑看起来已存。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, panel, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        putDraft: (body) => ((body as {package_id: string}).package_id === 'PKG-010'
          ? {status: 422, body: {ok: false, issues: [{check_id: '*', field: 'x', message: 'A 包校验失败'}]}} // A 失败
          : {status: 200, body: {ok: true}}), // B 成功
      },
    });
    // A：编辑 → flush（不等 debounce）→ A 失败落账
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    panel.flushSave();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    // 切到 B：编辑 → flush → B 成功
    selection.set({packageId: 'PKG-020', checkId: null});
    setInput('[data-checked-at="SCH-020-01"]', '2026-11-02');
    click('[data-status-btn="SCH-020-01"][data-status="passed"]');
    panel.flushSave();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存'));
    // 关键：切回 A，A 的失败态与重试入口必须还在（按包记录，B 的成功污染不到）
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('保存失败'));
    expect(document.querySelector('[data-save-status]')!.textContent).toContain('A 包校验失败');
    expect(document.querySelector('[data-save-retry]')).toBeTruthy();
  });

  it('旧包的迟到成功不许清空当前包的行错误与门禁/预演（codex 六审 major 回归）', async () => {
    // A 保存在途 → 切 B → B 跑出门禁/预演 → A 的成功晚到。旧实现：成功分支遍历
    // 全表清 issues + 无条件 resetSubmitState——B 的行错误/门禁/预演被 A 抹掉。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending', open_gates: []})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    const {selection, panel, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {putDraft: () => ({status: 200, body: {ok: true}})},
    });
    // A：编辑 → flush（PUT 在途；响应会在切到 B 之后才落）
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    panel.flushSave();
    // 切 B 并跑门禁（B 的操作态建立）
    selection.set({packageId: 'PKG-020', checkId: null});
    setInput('[data-checked-at="SCH-020-01"]', '2026-11-02');
    click('[data-status-btn="SCH-020-01"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    // A 的迟到成功此时已落账（按包隔离）——B 的门禁结论必须还在
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
    expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5');
  });

  it('跨包往返后重试保存的是失败时的编辑，不是服务端旧草稿（codex 六审 blocking 回归）', async () => {
    // 复现路径（codex 内存执行同款）：A 编辑新备注 → 保存失败 → 切 B → B 保存成功
    // → 回 A → 点重试。旧实现两处丢编辑：① applyDraft 换包整体重建 draftResults；
    // ② 回填时服务端旧值吞掉未保存新值。修后重试的 PUT 必须带新备注。
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const twoPkg = {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}};
    let aPutCount = 0;
    const {selection, panel, calls} = await mountPanel({
      snapshot: twoPkg,
      handlers: {
        // A 的服务端草稿里躺着一条旧备注（模拟上次保存的内容）。按包返回——
        // 服务端只回请求包的草稿，B 的 GET 拿不到 A 的条目（mock 不按包返回会
        // 让 B 的干净态合并把 A 未保存的备注洗成服务端旧值，那是假象不是缺陷）。
        draft: (path) => (path.includes('PKG-020')
          ? {package_id: 'PKG-020', results: []}
          : {package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: [], note: '旧备注-服务端'}]}),
        putDraft: (body) => {
          const pkgId = (body as {package_id: string}).package_id;
          if (pkgId === 'PKG-010') {
            aPutCount += 1;
            return aPutCount === 1
              ? {status: 422, body: {ok: false, issues: [{check_id: '*', field: 'x', message: 'A 包校验失败'}]}} // 第一次失败
              : {status: 200, body: {ok: true}}; // 重试成功
          }
          return {status: 200, body: {ok: true}}; // B 成功
        },
      },
    });
    // A：把备注改成新值 → flush → 失败
    setInput('[data-note="SCH-010-01"]', '新备注-未保存');
    panel.flushSave();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(1), {timeout: 3000});
    // 切 B 保存成功，再回 A
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
    await vi.waitFor(() => expect(document.querySelector('[data-save-status]')!.textContent).toContain('保存失败'));
    // 关键：备注输入框里还是未保存的新值（没被服务端旧备注吞掉）
    expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('新备注-未保存');
    // 重试 → PUT 载荷必须带新备注
    (document.querySelector('[data-save-retry]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT').length).toBe(2), {timeout: 3000});
    const retryPut = calls.filter((call) => call.method === 'PUT')[1].body as {results: Array<{note?: string}>};
    expect(retryPut.results[0].note).toBe('新备注-未保存');
  });

  it('flushSave：debounce 未到点也立即落盘（退出审批页不丢编辑，codex 审查 blocking 回归）', async () => {
    // 退出审批页会清选中，而 debounce 定时器的回查询「当前选中仍是目标包」——
    // 不 flush 的话，改完备注立刻点返回，PUT 被跳过、刷新即丢。
    const {panel, calls} = await mountPanel();
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    // 300ms debounce 还没到：没有任何 PUT
    expect(calls.filter((call) => call.method === 'PUT').length).toBe(0);
    panel.flushSave();
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const put = calls.find((call) => call.method === 'PUT')! as {url: string; body: {package_id: string}};
    expect(put.url).toBe('/api/acceptance/draft');
    expect(put.body.package_id).toBe('PKG-010');
    // 再 flush 是 no-op（没有待保存）
    panel.flushSave();
    expect(calls.filter((call) => call.method === 'PUT').length).toBe(1);
  });

  it('open_gates 非空的检查：passed 按钮 disabled 并注明阻塞原因', async () => {
    await mountPanel();
    const blockedPassed = document.querySelector('[data-status-btn="SCH-010-02"][data-status="passed"]') as HTMLButtonElement;
    expect(blockedPassed.disabled).toBe(true);
    expect(blockedPassed.title).toContain('DEC-瓷砖');
    expect(blockedPassed.title).toContain('未拍板决策阻塞');
    const opRow = document.querySelector('tr[data-check-op="SCH-010-02"]') as HTMLElement;
    expect(opRow.textContent).toContain('被 DEC-瓷砖 未拍板决策阻塞');
    // 同检查的另两个状态、以及无门禁检查的 passed 都可用
    expect((document.querySelector('[data-status-btn="SCH-010-02"][data-status="failed"]') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('[data-status-btn="SCH-010-02"][data-status="not_applicable"]') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('[data-status-btn="SCH-010-01"][data-status="passed"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('保存 422：issues 逐条挂回对应行红字，包级 issue 进提示行', async () => {
    await mountPanel({handlers: {putDraft: () => ({status: 422, body: {ok: false, issues: [
      {check_id: 'SCH-010-01', field: 'checked_by', message: '缺少检查人（checked_by 必填）'},
      {check_id: 'SCH-010-01', field: 'evidence', message: 'passed 必须附最终证据（evidence 至少一条）'},
      {check_id: '*', message: '包级问题示例'},
    ]}})}});
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    const issues = document.querySelector('[data-check-issues="SCH-010-01"]') as HTMLElement;
    await vi.waitFor(() => expect(issues.textContent).toContain('缺少检查人'), {timeout: 3000});
    expect(issues.textContent).toContain('passed 必须附最终证据');
    expect(issues.textContent).toContain('[checked_by]');
    expect(issues.querySelectorAll('div').length).toBe(2);
    const saveLine = document.querySelector('[data-save-status]') as HTMLElement;
    expect(saveLine.textContent).toContain('保存失败');
    expect(saveLine.textContent).toContain('包级问题示例');
    // 另一行不挂别人的 issues
    expect(document.querySelector('[data-check-issues="SCH-010-02"]')!.textContent).toBe('');
  });

  it('没有任何已选状态时不发 PUT（避免空 results 覆盖 tmp/ 草稿）', async () => {
    const {calls} = await mountPanel();
    setInput('[data-checked-by="SCH-010-01"]', '业主');
    setInput('[data-note="SCH-010-01"]', '先填着');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(document.querySelector('[data-save-status]')!.textContent).toContain('没有可保存的结果：先选一个状态');
  });

  it('机械卡点：各 gate ✓/✗ + name + detail，✗ 的 detail 完整显示', async () => {
    await mountPanel({handlers: {gates: () => ({status: 200, body: {ok: false, gates: [
      {name: '控制源校验', ok: true, detail: 'schedule control valid'},
      {name: '草稿校验', ok: false, detail: 'SCH-010-01: 缺少检查人（checked_by 必填）'},
      {name: '证据文件在位', ok: true, detail: '全部证据文件存在'},
      {name: '前置与阻塞', ok: false, detail: '前置/阻塞未满足，不得提交：阻塞项 BLK-量房 尚未有证据关闭'},
      {name: 'verify:schedule（当前树）', ok: false, detail: 'stale audit: AUD-x\n第二行原因'},
    ]}})}});
    click('#acceptance-run-gates');
    const bar = document.querySelector('#acceptance-actions') as HTMLElement;
    await vi.waitFor(() => expect(bar.textContent).toContain('控制源校验'));
    expect(bar.textContent).toContain('✓');
    expect(bar.textContent).toContain('✗');
    expect(bar.textContent).toContain('草稿校验');
    expect(bar.textContent).toContain('前置与阻塞');
    expect(bar.textContent).toContain('verify:schedule（当前树）');
    expect(bar.textContent).toContain('SCH-010-01: 缺少检查人（checked_by 必填）');
    expect(bar.textContent).toContain('阻塞项 BLK-量房 尚未有证据关闭');
    expect(bar.textContent).toContain('stale audit: AUD-x');
    expect(bar.textContent).toContain('第二行原因');
    expect(bar.textContent).toContain('卡点 2/5');
    // 卡点不全绿 → 预演禁用
    expect((document.querySelector('#acceptance-dry-run') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('#acceptance-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('PR 预演：records 表格（id/检查/状态/指纹前 12 位）+ pr_body 预览', async () => {
    await mountPanel();
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
    const dryButton = document.querySelector('#acceptance-dry-run') as HTMLButtonElement;
    expect(dryButton.disabled).toBe(false);
    dryButton.click();
    const bar = document.querySelector('#acceptance-actions') as HTMLElement;
    await vi.waitFor(() => expect(bar.textContent).toContain('PR 预演'));
    expect(bar.textContent).toContain('AUD-PKG-010-SCH-010-01-001');
    expect(bar.textContent).toContain('SCH-010-01');
    expect(bar.textContent).toContain('passed');
    expect(bar.textContent).toContain('aaaaaaaaaaaa');
    expect(bar.textContent).toContain('bbbbbbbbbbbb');
    const pre = bar.querySelector('pre') as HTMLElement;
    expect(pre.textContent).toContain('## 验收提交：PKG-010｜拆改与砌筑');
    expect(pre.textContent).toContain('GATE-010-A');
    expect(pre.textContent).toContain('合并仍由业主亲手点');
    // 预演已生成 → 确认提交可用
    expect((document.querySelector('#acceptance-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('确认提交两步：第一次只进确认态，第二次才 POST；成功后禁用并显示分支/commit', async () => {
    let submitCount = 0;
    const {calls} = await mountPanel({handlers: {submit: (body) => {
      if ((body as {dry_run?: boolean})?.dry_run) {
        return {status: 200, body: {dry_run: true, records: [recordProjection()], pr_body: prBodyText()}};
      }
      submitCount += 1;
      return {status: 201, body: {
        branch: 'accept/PKG-010-20261102-101530',
        commit: 'abc1234',
        pr_url: 'javascript:alert(1)',
        records: [],
        pr_body: prBodyText(),
      }};
    }}});
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演'));

    const submitButton = () => document.querySelector('#acceptance-submit') as HTMLButtonElement;
    const realSubmitCalls = () => calls.filter((call) => call.url === '/api/acceptance/submit' && !(call.body as {dry_run?: boolean})?.dry_run);

    // 第一次：只进确认态（按钮变红），没有真正的 submit POST
    submitButton().click();
    expect(submitButton().textContent).toContain('再点一次');
    expect(realSubmitCalls()).toEqual([]);

    // 第二次：才 POST，成功显示分支 + commit
    submitButton().click();
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('已开 PR'));
    expect(realSubmitCalls().length).toBe(1);
    expect(realSubmitCalls()[0].body).toEqual({package_id: 'PKG-010'});
    const bar = document.querySelector('#acceptance-actions') as HTMLElement;
    expect(bar.textContent).toContain('accept/PKG-010-20261102-101530');
    expect(bar.textContent).toContain('abc1234');

    // 非 http(s) 的 pr_url 只渲染纯文本 <code>，不当链接渲染
    expect(document.querySelector('#acceptance-actions a')).toBeNull();
    const codes = Array.from(document.querySelectorAll('#acceptance-actions code')).map((el) => el.textContent ?? '');
    expect(codes.some((text) => text.includes('javascript:alert(1)'))).toBe(true);

    // 提交成功后按钮禁用：服务端已清草稿+暂存，再点只会拿到空草稿（P1-4）
    expect(submitButton().disabled).toBe(true);
    submitButton().click();
    expect(realSubmitCalls().length).toBe(1);
  });

  it('提交成功：禁用提交按钮并提示「已开 PR：<url>；草稿已清，勿重复提交」', async () => {
    await mountPanel();
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'));
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演'));

    const submitButton = () => document.querySelector('#acceptance-submit') as HTMLButtonElement;
    submitButton().click();
    submitButton().click();
    const bar = document.querySelector('#acceptance-actions') as HTMLElement;
    await vi.waitFor(() => expect(bar.textContent).toContain('已开 PR'));
    // http(s) 的 pr_url 渲染为安全链接
    const link = document.querySelector('#acceptance-actions a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/phona/bontop-design-log/pull/99');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // 「草稿已清，勿重复提交」显形 + 按钮禁用
    expect(bar.textContent).toContain('草稿已清，勿重复提交');
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('勿重复提交');
  });

  it('复验 supersedes：当前记录 id 显形（占位符+同行提示），不再是死路', async () => {
    await mountPanel();
    const input = document.querySelector('[data-supersedes="SCH-010-03"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('AUD-PKG-010-SCH-010-03-001');
    expect(input.title).toContain('AUD-PKG-010-SCH-010-03-001');
    const opRow = document.querySelector('tr[data-check-op="SCH-010-03"]') as HTMLElement;
    expect(opRow.textContent).toContain('当前记录：AUD-PKG-010-SCH-010-03-001');
    expect(opRow.textContent).toContain('仓库现值：已通过');
    expect(opRow.textContent).toContain('AUD-PKG-010-SCH-010-03-001');
    // pending 检查不显示 supersedes 行
    expect(document.querySelector('[data-supersedes="SCH-010-01"]')).toBeNull();
  });

  it('refresh 重取草稿：服务端有值的以服务端为准，本地未保存的编辑不丢', async () => {
    const {panel} = await mountPanel({handlers: {draft: () => ({package_id: 'PKG-010', results: [
      {check_id: 'SCH-010-01', status: 'failed', checked_by: '服务端的人', checked_at: '2026-11-01', evidence: []},
    ]})}});
    // 本地：给没有草稿的行填检查人；给已有草稿的行补一条服务端没有的备注
    setInput('[data-checked-by="SCH-010-02"]', '本地未保存');
    setInput('[data-note="SCH-010-01"]', '本地备注');
    await panel.refresh();
    await vi.waitFor(() => expect((document.querySelector('[data-checked-by="SCH-010-02"]') as HTMLInputElement).value).toBe('本地未保存'));
    // 服务端有值的字段以服务端为准
    const opRow = document.querySelector('tr[data-check-op="SCH-010-01"]') as HTMLElement;
    expect(opRow.textContent).toContain('草稿值：failed（未通过）');
    expect((document.querySelector('[data-checked-by="SCH-010-01"]') as HTMLInputElement).value).toBe('服务端的人');
    // 服务端为空的字段保留本地值（不被重取静默抹掉）
    expect((document.querySelector('[data-note="SCH-010-01"]') as HTMLInputElement).value).toBe('本地备注');
  });

  it('pr_body / 证据路径 / 卡点 detail 含 <img onerror> 不产生元素', async () => {
    const {panel, calls} = await mountPanel({
      handlers: {
        draft: () => ({package_id: 'PKG-010', results: [{
          check_id: 'SCH-010-01', status: 'passed', checked_by: '<b>业主</b>', checked_at: '2026-11-02',
          evidence: ['<img src=x onerror=alert(1)>'],
        }]}),
        gates: () => ({status: 200, body: {ok: true, gates: [{name: '控制源校验', ok: true, detail: '<script>alert(2)</script>'}]}}),
        submit: (body) => (
          (body as {dry_run?: boolean})?.dry_run
            ? {status: 200, body: {dry_run: true, records: [], pr_body: '正文含 <img src=x onerror=alert(1)> 与 <script>x</script>'}}
            : {status: 201, body: {branch: 'b', commit: 'c', pr_url: 'https://example.invalid/pr/1', records: [], pr_body: ''}}
        ),
      },
    });
    // 草稿回填的证据路径被转义（有文本、无元素）
    const evidenceArea = document.querySelector('[data-evidence-area="SCH-010-01"]') as HTMLElement;
    await vi.waitFor(() => expect(evidenceArea.textContent).toContain('onerror=alert(1)'));
    // 草稿值与仓库现值并排（草稿 passed vs 仓库 pending）
    const opRow = document.querySelector('tr[data-check-op="SCH-010-01"]') as HTMLElement;
    expect(opRow.textContent).toContain('仓库现值：未执行');
    expect(opRow.textContent).toContain('草稿值：passed（通过）');
    expect(document.querySelector('[data-draft-status]')!.textContent).toContain('已载入 tmp/ 草稿 1 条');

    // refresh 后重新 GET 草稿并回填（audit 现值可能已变）
    const draftGetsBefore = calls.filter((call) => call.url.startsWith('/api/acceptance/draft') && call.method === 'GET').length;
    await panel.refresh();
    await vi.waitFor(() => expect(calls.filter((call) => call.url.startsWith('/api/acceptance/draft') && call.method === 'GET').length).toBe(draftGetsBefore + 1));
    await vi.waitFor(() => expect(document.querySelector('tr[data-check-op="SCH-010-01"]')!.textContent).toContain('草稿值：passed（通过）'));

    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('控制源校验'));
    click('#acceptance-dry-run');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('PR 预演'));

    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    expect(body.textContent).toContain('onerror=alert(1)');
    expect(body.textContent).toContain('<script>alert(2)</script>');
    expect(body.textContent).toContain('正文含 <img src=x onerror=alert(1)>');
  });
});

// ─── 移动端现场视图（issue #70 PR B）：字段采集布局 ───
// 同一面板实例、同一写路径状态机（pkgRuns/draftResults/touched），render() 按
// isMobileChrome 分支。这里只钉布局分支、钩子契约与能力订阅；上面既有用例
// （桌面默认 matchMedia 不命中）一行未动，即桌面回归的证明。

/** 可中途改判的 matchMedia mock：matches 现读现算，fire 触发已注册的 change 监听。 */
function installMatchMedia(initial: (query: string) => boolean) {
  let matcher = initial;
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    get matches() { return matcher(query); },
    media: query,
    addEventListener: (_: string, cb: () => void) => {
      const set = listeners.get(query) ?? new Set();
      set.add(cb);
      listeners.set(query, set);
    },
    removeEventListener: (_: string, cb: () => void) => {
      listeners.get(query)?.delete(cb);
    },
  })));
  return {
    setMatches: (next: (query: string) => boolean) => { matcher = next; },
    fire: (query: string) => { listeners.get(query)?.forEach((cb) => cb()); },
  };
}

describe('ScheduleDetailPanel 移动端现场视图（字段布局，issue #70 PR B）', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('窄视口（≤700px）：字段布局出现、桌面宽表退场，data-* 钩子契约全套在场', async () => {
    installMatchMedia((query) => query === '(max-width: 700px)');
    // 草稿带回一条已落定证据：证据区的 remove/path 钩子随 renderEvidenceArea 出场
    const {panel} = await mountPanel({handlers: {draft: () => ({package_id: 'PKG-010', results: [
      {check_id: 'SCH-010-01', status: 'passed', checked_by: '老张', checked_at: '2026-11-01', evidence: [FINAL_PATH]},
    ]})}});
    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    // 字段布局标记 + 桌面宽表退场
    expect(body.querySelector('[data-field-layout]')).toBeTruthy();
    expect(body.querySelectorAll('[data-field-card]').length).toBe(3);
    expect(body.querySelector('tr[data-check-op]')).toBeNull();
    expect(document.querySelector('#schedule-detail-panel')!.hasAttribute('data-field-mode')).toBe(true);
    // 包级状态行钩子（缺一个保存状态行就静默停更）
    expect(body.querySelector('[data-save-status]')!.textContent).toContain('已存 tmp/');
    expect(body.querySelector('[data-draft-status]')!.textContent).toContain('已载入 tmp/ 草稿 1 条');
    // 逐检查钩子契约：一个都不能少
    for (const checkId of ['SCH-010-01', 'SCH-010-02', 'SCH-010-03']) {
      expect(body.querySelector(`[data-check-id="${checkId}"]`), `[data-check-id=${checkId}]`).toBeTruthy();
      expect(body.querySelector(`[data-draft-value="${checkId}"]`)).toBeTruthy();
      for (const status of ['passed', 'failed', 'not_applicable']) {
        expect(body.querySelector(`[data-status-btn="${checkId}"][data-status="${status}"]`), `[data-status-btn=${checkId}][data-status=${status}]`).toBeTruthy();
      }
      expect(body.querySelector(`[data-checked-by="${checkId}"]`)).toBeTruthy();
      expect(body.querySelector(`[data-checked-at="${checkId}"]`)).toBeTruthy();
      expect(body.querySelector(`[data-note="${checkId}"]`)).toBeTruthy();
      expect(body.querySelector(`[data-check-issues="${checkId}"]`)).toBeTruthy();
      const area = body.querySelector(`[data-evidence-area="${checkId}"]`)!;
      expect(area, `[data-evidence-area=${checkId}]`).toBeTruthy();
      expect(area.querySelector('[data-evidence-file]')).toBeTruthy();
      // 文件输入框限定图片（issue #70 PR A 的清单项，2026-11-04 浏览器实测抓回归：
      // PR A 实施代理回报声称加过，git log -S 证实从未进过任何提交——验收证据以照片
      // 为主，accept 让手机文件选择器直接出相机/相册）。不加 capture：相册里的既有
      // 照片（微信保存等）也要能选。
      expect((area.querySelector('[data-evidence-file]') as HTMLInputElement).getAttribute('accept')).toBe('image/*');
      expect(area.querySelector('[data-evidence-finalize]')).toBeTruthy();
    }
    // 已通过检查的复验钩子（同桌面条件）+ 已落定证据的 remove/path
    expect(body.querySelector('[data-supersedes="SCH-010-03"]')).toBeTruthy();
    expect(body.querySelector('[data-evidence-remove="SCH-010-01"]')).toBeTruthy();
    expect(body.querySelector('[data-evidence-path]')!.getAttribute('data-evidence-path')).toBe(FINAL_PATH);
    // 现场大按钮（min-height 56px）与全宽输入
    const passedBtn = body.querySelector('[data-status-btn="SCH-010-01"][data-status="passed"]') as HTMLElement;
    expect(passedBtn.getAttribute('style')).toContain('min-height:56px');
    expect((body.querySelector('[data-checked-by="SCH-010-01"]') as HTMLElement).getAttribute('style')).toContain('width:100%');
    // 现场采集卡带上桌面宽表不丢的字段（方法/通过标准/指纹前 12 位）
    expect(body.textContent).toContain('现场核对');
    expect(body.textContent).toContain('与施工图一致，无遗留墙体');
    expect(body.textContent).toContain('abc123def456');
    panel.hide();
  });

  it('字段 DOM 走同一写路径：拍照→暂存→落定→passed 的 PUT body 与桌面路径逐字一致', async () => {
    installMatchMedia((query) => query === '(max-width: 700px)');
    const {panel, calls} = await mountPanel();
    // 与桌面证据流（上面「证据：选文件→暂存→选为最终证据…」一条）同一串操作，只换布局
    const fileInput = document.querySelector('[data-evidence-file="SCH-010-01"]') as HTMLInputElement;
    const file = new File(['fake-image-bytes'], 'a.jpg', {type: 'image/jpeg'});
    Object.defineProperty(fileInput, 'files', {value: [file], configurable: true});
    fileInput.dispatchEvent(new Event('change', {bubbles: true}));
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/acceptance/evidence' && call.method === 'POST')).toBe(true));
    click('[data-evidence-finalize="SCH-010-01"]');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/acceptance/evidence/finalize')).toBe(true));
    setInput('[data-checked-at="SCH-010-01"]', '2026-11-02');
    click('[data-status-btn="SCH-010-01"][data-status="passed"]');
    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true), {timeout: 3000});
    const put = calls.find((call) => call.method === 'PUT')!;
    expect(put.url).toBe('/api/acceptance/draft');
    expect(put.body).toEqual({
      package_id: 'PKG-010',
      results: [{check_id: 'SCH-010-01', status: 'passed', checked_by: '', checked_at: '2026-11-02', evidence: [FINAL_PATH]}],
    });
    expect(document.querySelector('[data-save-status]')!.textContent).toContain('已保存');
    panel.hide();
  });

  it('能力从窄变宽：重渲染回桌面布局，同一实例的草稿状态不丢', async () => {
    const media = installMatchMedia((query) => query === '(max-width: 700px)');
    const {panel} = await mountPanel({handlers: {draft: () => ({package_id: 'PKG-010', results: [
      {check_id: 'SCH-010-01', status: 'failed', checked_by: '老张', checked_at: '2026-11-01', evidence: []},
    ]})}});
    expect(document.querySelector('[data-field-layout]')).toBeTruthy();
    // 视口变宽（改判 + 触发 change）：重渲染回桌面宽表
    media.setMatches(() => false);
    media.fire('(max-width: 700px)');
    await vi.waitFor(() => expect(document.querySelector('tr[data-check-op="SCH-010-01"]')).toBeTruthy());
    expect(document.querySelector('[data-field-layout]')).toBeNull();
    expect(document.querySelector('#schedule-detail-panel')!.hasAttribute('data-field-mode')).toBe(false);
    // 同一状态机：字段布局里载入的草稿值在桌面布局照常并排显示
    expect(document.querySelector('tr[data-check-op="SCH-010-01"]')!.textContent).toContain('草稿值：failed（未通过）');
    expect((document.querySelector('[data-checked-by="SCH-010-01"]') as HTMLInputElement).value).toBe('老张');
    panel.hide();
  });

  it('桌面默认（matchMedia 不命中）：现有布局一行不变（宽表 + 无 data-field-mode 属性）', async () => {
    // 不装 matchMedia stub：无命中 → readCapabilities 全 false → 桌面布局
    const {panel} = await mountPanel();
    const body = document.querySelector('#schedule-detail-body') as HTMLElement;
    expect(body.querySelector('[data-field-layout]')).toBeNull();
    expect(body.querySelectorAll('tr[data-check-id]').length).toBe(3);
    expect(body.querySelector('tr[data-check-op="SCH-010-01"]')).toBeTruthy();
    expect(document.querySelector('#schedule-detail-panel')!.hasAttribute('data-field-mode')).toBe(false);
    // 写路径钩子不受布局影响
    expect(body.querySelector('[data-save-status]')).toBeTruthy();
    expect(body.querySelector('[data-status-btn="SCH-010-01"][data-status="passed"]')).toBeTruthy();
    panel.hide();
  });

  it('字段布局保留 3D 高亮入口：scope 就绪时按钮可用、点了走 onHighlight（codex 复审 major）', async () => {
    // codex 复审 major：renderProjectScope 不是纯展示——它含着唯一的「在 3D 中高亮」
    // 入口。窄屏/触摸主输入会自动进字段布局且没有退回桌面的控件，省略它手机就从包
    // 详情跳不到 3D 高亮。这里钉字段布局里的精简入口（按钮 + 计数）真的在场可用。
    installMatchMedia((query) => query === '(max-width: 700px)');
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new ScheduleDetailPanel(selection, {onHighlight});
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('[data-field-scope]')).toBeTruthy());
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('全项目范围'));

    const button = document.querySelector('#schedule-detail-highlight') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('去 3D 看这包');
    // 计数与桌面同源（resolveScopeFor 一处实现）
    const scope = document.querySelector('[data-field-scope]') as HTMLElement;
    expect(scope.textContent).toContain('房间 2 个');
    button.click();
    expect(onHighlight).toHaveBeenCalledWith('PKG-010');
    panel.hide();
  });

  it('字段布局的 3D 作用域取数失败时有重试入口（codex 复审 major 同条）', async () => {
    installMatchMedia((query) => query === '(max-width: 700px)');
    // /api/project 失败 → projectState error；重试按钮必须在场（id 与桌面一致，
    // bind() 的既有绑定直接复用，点了走 loadProjectScope）
    let projectCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path.includes('/api/project')) {
        projectCalls += 1;
        return {ok: false, status: 500, json: async () => ({error: 'boom'})} as Response;
      }
      return {ok: true, status: 200, json: async () => snapshot(packageView())} as Response;
    }));
    const panel = new ScheduleDetailPanel(new ScheduleSelectionStore());
    panel.subscribe();
    (panel as unknown as {selection: ScheduleSelectionStore}).selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-scope-retry')).toBeTruthy());
    expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('3D 作用域暂不可用');
    // 重试：再打一次 /api/project（仍失败但证明按钮接着 loadProjectScope）
    (document.querySelector('#schedule-detail-scope-retry') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(projectCalls).toBeGreaterThan(1));
    panel.hide();
  });

  it('面板根内联 padding-bottom 含底部安全区（codex 复审 minor）', () => {
    // 样式表的 padding-bottom 盖不住内联 padding——安全区必须走内联；且不能塞
    // cssText 的 padding 简写（jsdom 解析器会丢掉含 env() 的整条声明），属性
    // 赋值两者都满足。桌面 env()=0 无感。
    installMatchMedia((query) => query === '(max-width: 700px)');
    const panel = new ScheduleDetailPanel(new ScheduleSelectionStore());
    panel.show();
    const el = document.querySelector('#schedule-detail-panel') as HTMLElement;
    expect(el.style.paddingBottom).toBe('calc(14px + env(safe-area-inset-bottom))');
    // 其余声明没被连带丢掉（jsdom 对 cssText 是逐条解析）
    expect(el.style.background).toBe('rgb(26, 26, 46)');
    panel.hide();
  });

  it('包切换条 + 禁用逻辑同源：点 chip 换包；open_gates 非空时 passed 保持禁用', async () => {
    installMatchMedia((query) => query === '(max-width: 700px)');
    const pkgB = {...packageView(), id: 'PKG-020', name: '第二个包', checks: [check({id: 'SCH-020-01', item: 'B 包检查项', audit_status: 'pending'})]};
    const base = snapshot(packageView());
    const {selection, panel} = await mountPanel({snapshot: {...base, packages: [packageView(), pkgB], counts: {...base.counts, packages: 2}}});
    // 禁用逻辑与桌面同一方法（renderStatusButtons 加尺寸参数，不重抄判断）
    const blocked = document.querySelector('[data-status-btn="SCH-010-02"][data-status="passed"]') as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toContain('DEC-瓷砖');
    expect((document.querySelector('[data-status-btn="SCH-010-02"][data-status="failed"]') as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector('[data-status-btn="SCH-010-01"][data-status="passed"]') as HTMLButtonElement).disabled).toBe(false);
    // 包切换 chips：点 B → 选中态与渲染都跟到 B
    expect(document.querySelectorAll('[data-package-chip]').length).toBe(2);
    (document.querySelector('[data-package-chip="PKG-020"]') as HTMLButtonElement).click();
    expect(selection.get().packageId).toBe('PKG-020');
    await vi.waitFor(() => expect(document.querySelector('[data-field-layout]')!.textContent).toContain('第二个包'));
    expect(document.querySelector('[data-field-card="SCH-020-01"]')).toBeTruthy();
    expect(document.querySelector('[data-field-card="SCH-010-01"]')).toBeNull();
    panel.hide();
  });

  // 结构完备性守卫（2026-11-04 codex 复审 2 major 的根因：字段布局逐段省略桌面
  // 信息——未展开选择器摘要、整段预算、指纹脚注都这么丢的）。本条把桌面 render()
  // 各段的标志性内容列成清单，逐项断言字段布局里有对应落点。以后任何人再从
  // 字段布局删一段，先过这一关——它就是防「又丢了什么」的那条测试。
  // 口径：只收录**影响现场采集决策**的信息（状态/阻塞/钱/检查标准/高亮范围/
  // 指纹）；桌面纯参考项（作用域 id 明细清单、合批渲染实现注）不收录，理由见
  // renderFieldScope 注释里的「刻意省略」。
  it('结构完备性守卫：桌面各段标志性内容在字段布局里都有落点', async () => {
    installMatchMedia((query) => query === '(max-width: 700px)');
    vi.stubGlobal('fetch', stubFetch(snapshot(packageView()), projectPayload()));
    const selection = new ScheduleSelectionStore();
    const panel = new ScheduleDetailPanel(selection);
    panel.subscribe();
    selection.set({packageId: 'PKG-010'});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('[data-field-layout]')).toBeTruthy());
    // 等 3D 作用域展开完（未展开选择器行要 projectState ready 后才在场）
    await vi.waitFor(() => expect(document.querySelector('#schedule-detail-body')!.textContent).toContain('未展开选择器'));

    const text = document.querySelector('[data-field-layout]')!.textContent ?? '';
    const signatures: Array<[string, string]> = [
      // ── 桌面 renderHeader：包名/id、状态与就绪的声明值并列、门槛、依赖、责任角色、描述 ──
      ['头部', '拆改与砌筑'], ['头部', 'PKG-010'],
      ['头部', '进行中'], ['头部', '（声明 in_progress）'],
      ['头部', '就绪'], ['头部', '（声明 ready）'],
      ['头部', '付款门槛：GATE-010-A'],
      ['头部', '依赖：PKG-000'], ['头部', '责任角色：施工方、业主'],
      ['头部', '拆改、砌筑、抹灰'],
      // ── 桌面 renderBlockers（字段布局复用同一方法，含已关闭项）──
      ['阻塞', 'BLK-量房'], ['阻塞', '未关闭'], ['阻塞', '解除条件：量房报告归档'],
      ['阻塞', 'BLK-旧图'], ['阻塞', '已关闭'],
      // ── 桌面 renderBudget（codex major：曾整段缺失——看不见钱仍能提交）──
      ['预算', '批准 ¥12,000'], ['预算', '已成交 ¥11,000'], ['预算', '已付 ¥0'], ['预算', '预测 ¥12,500'],
      ['预算', '费用项 3 个'], ['预算', '未报价 1/3'],
      ['预算', '资金状态：partial'], ['预算', '分配状态：allocated'], ['预算', '估算需求 ¥13,000'],
      // ── 桌面 renderChecks 宽表八列 → 现场采集卡逐列保留（文案可紧凑，信息不丢）──
      ['检查', '拆改完成度确认'], ['检查', '抹灰养护'], ['检查', '贴砖复验'],
      ['检查', 'critical'], ['检查', '现场核对'],
      ['检查', '与施工图一致，无遗留墙体'],
      ['检查', '照片'], ['检查', '量房记录'],
      ['检查', '未执行'], ['检查', '已过期'], ['检查', 'DEC-瓷砖'], ['检查', '阻塞期可先做'],
      ['检查', 'abc123def456'], ['检查', '0f1e2d3c4b5a'],
      // ── 桌面 renderProjectScope（codex major：未展开选择器曾缺失——部分高亮被当完整范围）──
      ['作用域', '3D 作用域'], ['作用域', '房间 2 个'],
      ['作用域', '未展开选择器'], ['作用域', 'ceiling-quotes.layers: ceiling_tile'],
      // ── 桌面 renderAcceptanceActions（两条布局共用同一方法）──
      ['验收', '跑机械卡点'], ['验收', '生成 PR 预演'], ['验收', '确认提交（开 PR）'],
      // ── 桌面 renderFoot（曾整段缺失——看不见控制源指纹无法判断快照新鲜度）──
      ['脚注', 'ffffffffffff'], ['脚注', 'dddddddddddd'],
    ];
    for (const [section, signature] of signatures) {
      expect(text, `字段布局缺少桌面${section}的标志性内容：${signature}`).toContain(signature);
    }
    panel.hide();
  });
});
