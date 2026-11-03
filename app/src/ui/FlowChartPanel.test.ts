import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlowChartPanel } from './FlowChartPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type { ScheduleSnapshot, SchedulePackageView, ScheduleCheckView } from '@shared/schedule-state';

// 合成快照：8 个包，覆盖规格要求的全部形态——
//  - PKG-010 无前置（layer 0），link select.all → 全项目范围；
//  - PKG-030/040/050 并行同接 PKG-020（同层 2）；040 只有点位级选择器；
//  - PKG-070 汇合包，等 PKG-030+040+050 三个前置（layer 3 = max(2)+1）；
//  - PKG-080 blocked 包，带一条未关闭阻塞（item/解除条件含 hostile 字符串）；
//  - PKG-050 无 link、PKG-900 是 not_modelled link → 都归「全项目范围」；
//  - PKG-070 混合选择器（room_ids + ids）→ 「有 3D 范围」。
function check(overrides: Partial<ScheduleCheckView> = {}): ScheduleCheckView {
  return {
    id: 'SCH-010-01',
    item: '拆改完成度确认',
    source: 'package',
    severity: 'major',
    checkpoint: '砌筑完成后',
    method: '现场核对',
    pass_condition: '拆改尺寸与图纸一致',
    evidence_required: ['照片'],
    audit_status: 'pending',
    check_spec_sha256: 'c'.repeat(64),
    ...overrides,
  };
}

function pkg(overrides: Partial<SchedulePackageView> = {}): SchedulePackageView {
  return {
    id: 'PKG-010',
    name: '拆改与砌筑',
    sequence: 10,
    description: '拆改、砌筑、抹灰',
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
      planned_cny: 12000,
      contracted_cny: null,
      paid_cny: 0,
      forecast_cny: null,
      component_count: 3,
      unpriced_count: 1,
    },
    checks: [],
    project_fingerprint: 'a'.repeat(64),
    ...overrides,
  };
}

function snapshot(): ScheduleSnapshot {
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
      packages: 8,
      checks: 12,
      cost_components: 4,
      unpriced_components: 1,
      open_decision_gates: 0,
      open_gated_checks: 0,
      ready_packages: 3,
    },
    data_fingerprint: 'f'.repeat(64),
    packages: [
      pkg({
        checks: [
          check({id: 'SCH-010-01', item: '拆改完成度确认', audit_status: 'passed'}),
          check({id: 'SCH-010-02', item: '抹灰平整度', audit_status: 'pending'}),
          check({id: 'SCH-010-03', item: '建渣清运', audit_status: 'failed'}),
        ],
      }),
      pkg({
        id: 'PKG-020',
        name: '水电改造',
        sequence: 20,
        dependencies: ['PKG-010'],
        payment_gate: 'GATE-020-A',
        checks: [
          check({id: 'SCH-020-01', item: '水管试压', audit_status: 'passed'}),
          check({id: 'SCH-020-02', item: '绝缘检测', audit_status: 'passed'}),
        ],
      }),
      pkg({
        id: 'PKG-030',
        name: '防水工程',
        sequence: 30,
        dependencies: ['PKG-020'],
        effective_status: 'ready_for_inspection',
        payment_gate: 'GATE-030-A',
        gate_status: 'pending',
        checks: [
          check({id: 'SCH-030-01', item: '闭水试验', audit_status: 'pending'}),
          check({id: 'SCH-030-02', item: '门槛挡水', audit_status: 'passed'}),
        ],
      }),
      pkg({
        id: 'PKG-040',
        name: '瓦工铺贴',
        sequence: 40,
        dependencies: ['PKG-020'],
        payment_gate: 'GATE-040-A',
        checks: [check({id: 'SCH-040-01', item: '空鼓率', audit_status: 'pending'})],
      }),
      pkg({
        id: 'PKG-050',
        name: '木工与吊顶',
        sequence: 50,
        dependencies: ['PKG-020'],
        status: 'not_started',
        effective_status: 'not_started',
        payment_gate: 'GATE-050-A',
        checks: [
          check({id: 'SCH-050-01', item: '龙骨间距', audit_status: 'pending'}),
          check({id: 'SCH-050-02', item: '窗帘盒位置', audit_status: 'pending'}),
        ],
      }),
      pkg({
        id: 'PKG-070',
        name: '汇合：安装收尾',
        sequence: 70,
        dependencies: ['PKG-030', 'PKG-040', 'PKG-050'],
        status: 'not_started',
        effective_status: 'not_started',
        effective_readiness: 'blocked',
        payment_gate: 'GATE-070-A',
        checks: [check({id: 'SCH-070-01', item: '成品保护', pass_condition: '完工面全覆盖保护', audit_status: 'pending'})],
      }),
      // blocked 包：未关闭阻塞的 item / 解除条件与包名都带 hostile 字符串（XSS 用例）
      pkg({
        id: 'PKG-080',
        name: '<img src=x onerror="window.__flow_pwned=1">外部依赖包',
        sequence: 80,
        dependencies: ['PKG-070'],
        status: 'blocked',
        effective_status: 'blocked',
        effective_readiness: 'blocked',
        payment_gate: 'GATE-080-A',
        blockers: [
          {
            id: 'BLK-HANDOVER',
            item: '<i>等外部条件</i>',
            status: 'site_pending',
            clears_when: '<script>window.__flow_pwned2=1</script>开发商放行',
            closed: false,
          },
          {id: 'BLK-CLOSED', item: '已关闭阻塞', status: 'resolved', clears_when: '证据已归档', closed: true},
        ],
        checks: [
          check({id: 'SCH-080-01', item: '进场核对', audit_status: 'passed'}),
          check({id: 'SCH-080-02', item: '移交清单', audit_status: 'pending'}),
        ],
      }),
      pkg({
        id: 'PKG-900',
        name: '硬装预备金',
        sequence: 900,
        status: 'not_started',
        readiness: 'blocked',
        effective_readiness: 'blocked',
        effective_status: 'not_started',
        payment_gate: 'GATE-900-OWNER-APPROVAL',
        gate_label: '业主批准门槛',
      }),
    ],
    decision_gates: {open: [], decided_count: 2},
    global_blockers: [
      {id: 'BLK-HANDOVER', item: '等外部条件', status: 'site_pending', clears_when: '开发商放行', owner_roles: ['开发商'], closed: false},
    ],
    next_actions: [],
    stale_audits: [],
    package_gate_issues: [],
  };
}

function linksPayload(): unknown {
  return {
    schema: 'project.model-package-links/v1',
    authorities: {'config/layout/model-geometry.yaml': 'config/layout/model-geometry.yaml'},
    links: [
      {
        id: 'LNK-010',
        phase_id: 'phase_1_basic_occupancy',
        budget_ref: {source: 'schedule', id: 'PKG-010'},
        mapping_status: 'project_scope',
        scope: [{source: 'config/layout/model-geometry.yaml', select: {all: true}}],
      },
      {
        id: 'LNK-020',
        phase_id: 'phase_1_basic_occupancy',
        budget_ref: {source: 'schedule', id: 'PKG-020'},
        mapping_status: 'mapped',
        scope: [{source: 'config/layout/model-geometry.yaml', select: {room_ids: ['R-KITCHEN'], types: ['wall']}}],
      },
      {
        id: 'LNK-040',
        phase_id: 'phase_1_basic_occupancy',
        budget_ref: {source: 'schedule', id: 'PKG-040'},
        mapping_status: 'partial',
        scope: [{source: 'config/electrical.yaml', select: {ids: ['elec_1'], layers: ['layer-power'], trade: ['electrical'], plan_ids: ['plan-a']}}],
      },
      {
        id: 'LNK-070',
        phase_id: 'phase_1_basic_occupancy',
        budget_ref: {source: 'schedule', id: 'PKG-070'},
        mapping_status: 'mapped',
        scope: [
          {source: 'config/layout/model-geometry.yaml', select: {room_ids: ['R-BATH']}},
          {source: 'config/electrical.yaml', select: {ids: ['elec_9']}},
        ],
      },
      {
        id: 'LNK-900',
        phase_id: 'phase_1_basic_occupancy',
        budget_ref: {source: 'schedule', id: 'PKG-900'},
        mapping_status: 'not_modelled',
        note: '预备金不在 3D 中建模',
      },
    ],
  };
}

function stubFetch(snap: ScheduleSnapshot = snapshot(), links: unknown = linksPayload()): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (
    String(url).includes('/api/model-package-links')
      ? {ok: true, status: 200, json: async () => links}
      : {ok: true, status: 200, json: async () => snap}
  )) as never);
}

function installDom(): void {
  document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
}

const layerOf = (packageId: string): string | null =>
  document.querySelector(`.flow-node[data-pkg-id="${packageId}"]`)?.getAttribute('data-layer') ?? null;

describe('FlowChartPanel', () => {
  beforeEach(() => {
    installDom();
  });

  it('节点/分层/边数量正确：并行同层、汇合层号=前置最大+1、侧车道单独一条', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-070"]')).toBeTruthy());

    // 7 个工序包 + 1 个侧车道节点
    expect(document.querySelectorAll('.flow-node[data-side-lane="false"]')).toHaveLength(7);
    expect(layerOf('PKG-010')).toBe('0');
    expect(layerOf('PKG-020')).toBe('1');
    // 并行两包（加 PKG-050）同接 PKG-020 → 同层
    expect(layerOf('PKG-030')).toBe('2');
    expect(layerOf('PKG-040')).toBe('2');
    expect(layerOf('PKG-050')).toBe('2');
    expect(document.querySelectorAll('.flow-node[data-layer="2"]')).toHaveLength(3);
    // 汇合包等三个前置 → 层号 = max(2,2,2) + 1
    expect(layerOf('PKG-070')).toBe('3');
    expect(layerOf('PKG-080')).toBe('4');
    // 侧车道：layer=-1、不占工序
    const side = document.querySelector('.flow-node[data-side-lane="true"]') as HTMLElement;
    expect(side.dataset.pkgId).toBe('PKG-900');
    expect(side.getAttribute('data-layer')).toBe('-1');
    expect(document.querySelector('#flow-side-lane')?.textContent).toContain('预备金·侧车道');
    // 边：010→020、020→030/040/050、030/040/050→070、070→080 共 8 条（侧车道不参与）
    expect(document.querySelectorAll('path.flow-edge')).toHaveLength(8);
    expect(document.querySelectorAll('path.flow-edge[data-from="PKG-070"][data-to="PKG-080"]')).toHaveLength(1);
  });

  it('状态文字/未通过与未验收分列/门槛状态/阻塞原因文字进 DOM（颜色之外必须有文字）', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-010"]')).toBeTruthy());

    const node010 = document.querySelector('.flow-node[data-pkg-id="PKG-010"]') as HTMLElement;
    expect(node010.textContent).toContain('PKG-010');
    expect(node010.textContent).toContain('拆改与砌筑');
    expect(node010.textContent).toContain('进行中');
    expect(node010.textContent).toContain('未通过 1/3｜未验收 1'); // SCH-010-03 failed + SCH-010-02 pending 分列
    expect(node010.textContent).toContain('付款门槛');
    expect(node010.textContent).toContain('GATE-010-A');
    expect(node010.textContent).toContain('待验');

    const node030 = document.querySelector('.flow-node[data-pkg-id="PKG-030"]') as HTMLElement;
    expect(node030.textContent).toContain('待验收');
    expect(node030.textContent).toContain('未通过 0/2｜未验收 1'); // 只有 pending，没有 failed——旧口径会误报「未通过 1/2」

    // blocked 包：阻塞原因文字（item + 解除条件）必须在 DOM；已关闭阻塞不显示
    const node080 = document.querySelector('.flow-node[data-pkg-id="PKG-080"]') as HTMLElement;
    expect(node080.textContent).toContain('阻塞');
    expect(node080.textContent).toContain('等外部条件');
    expect(node080.textContent).toContain('开发商放行');
    expect(node080.textContent).not.toContain('已关闭阻塞');
  });

  it('点节点只写选中态不跳 3D；「在 3D 中高亮」按钮才调 onHighlight（2026-11-03 路由级）', async () => {
    // 路由级后 onHighlight = 退出审批页跳 3D。节点/行点击再调它会把用户踢出
    // 审批页、选中还被清（codex 审查实证）——故点击只选中，跳转只走显式按钮。
    stubFetch();
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new FlowChartPanel(selection, {onHighlight});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-020"]')).toBeTruthy());

    // 有 3D 范围（room_ids/types）→ 写选中态 + URL hash 往返，但**不调** onHighlight
    (document.querySelector('.flow-node[data-pkg-id="PKG-020"]') as HTMLElement).click();
    expect(selection.get()).toEqual({packageId: 'PKG-020', checkId: null});
    expect(onHighlight).not.toHaveBeenCalled();
    expect(location.hash).toContain('pkg=PKG-020');
    expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('水电改造');

    // 全项目范围（select.all）→ 徽标文字在，按钮禁用
    (document.querySelector('.flow-node[data-pkg-id="PKG-010"]') as HTMLElement).click();
    expect(selection.get().packageId).toBe('PKG-010');
    expect((document.querySelector('.flow-node[data-pkg-id="PKG-010"]') as HTMLElement).textContent).toContain('全项目范围');
    expect((document.querySelector('#flow-selection-bar #flow-highlight') as HTMLButtonElement).disabled).toBe(true);

    // 点位级（第三步起可高亮：BatchedMesh.setColorAt 逐实例）→ 徽标在、按钮可用，
    // 且只有点按钮才调 onHighlight
    (document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement).click();
    expect((document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement).textContent).toContain('点位级（可高亮）');
    const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
    expect((bar.querySelector('#flow-highlight') as HTMLButtonElement).disabled).toBe(false);
    // 按钮 title 取点位级口径（逐实例着色），不再借 scene 通用文案
    expect((bar.querySelector('#flow-highlight') as HTMLButtonElement).title).toContain('点位');
    expect((bar.querySelector('#flow-highlight') as HTMLButtonElement).title).toContain('setColorAt');
    expect(onHighlight).not.toHaveBeenCalled();
    (bar.querySelector('#flow-highlight') as HTMLButtonElement).click();
    expect(onHighlight).toHaveBeenCalledWith('PKG-040');
  });

  it('highlightPackages 把传入的全部包都标出，并提示同属 N 个包', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-030"]')).toBeTruthy());

    panel.highlightPackages(['PKG-030', 'PKG-040']);
    const node030 = document.querySelector('.flow-node[data-pkg-id="PKG-030"]') as HTMLElement;
    const node040 = document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement;
    expect(node030.dataset.highlight).toBe('true');
    expect(node030.textContent).toContain('← 3D 选中');
    expect(node040.dataset.highlight).toBe('true');
    expect(node040.textContent).toContain('← 3D 选中');
    expect((document.querySelector('.flow-node[data-pkg-id="PKG-020"]') as HTMLElement).dataset.highlight).toBe('false');
    expect(document.querySelector('#flow-reverse-hint')?.textContent).toContain('该 3D 对象同属 2 个包，已全部标出');

    // 单个包不弹提示
    panel.highlightPackages(['PKG-020']);
    expect(document.querySelector('#flow-reverse-hint')).toBeNull();
    expect((document.querySelector('.flow-node[data-pkg-id="PKG-020"]') as HTMLElement).dataset.highlight).toBe('true');
  });

  it('selection store 预设 packageId 后 show() 恢复 active 节点与选中条（#pkg= 深链）', async () => {
    stubFetch();
    const selection = new ScheduleSelectionStore();
    selection.set({packageId: 'PKG-070', checkId: null});
    expect(location.hash).toContain('pkg=PKG-070');

    const panel = new FlowChartPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-070"]')?.getAttribute('data-active')).toBe('true'));

    const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
    expect(bar.textContent).toContain('PKG-070');
    expect(bar.textContent).toContain('汇合：安装收尾');
    expect(bar.textContent).toContain('未开始');
    expect(bar.textContent).toContain('未就绪');
    expect(bar.textContent).toContain('GATE-070-A');
    expect(bar.textContent).toContain('未通过检查 0/1｜未验收 1'); // PKG-070 唯一检查是 pending：没有未通过，只有未验收
    expect(bar.textContent).toContain('下一个待办');
    expect(bar.textContent).toContain('成品保护');
    expect(bar.textContent).toContain('完工面全覆盖保护');
  });

  it('外部改选中态时订阅同步节点 active 与选中条；退订后不再同步', async () => {
    stubFetch();
    const selection = new ScheduleSelectionStore();
    const panel = new FlowChartPanel(selection);
    const unsubscribe = panel.subscribe();
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-050"]')).toBeTruthy());

    selection.set({packageId: 'PKG-050'});
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-050"]')?.getAttribute('data-active')).toBe('true'));
    expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('木工与吊顶');

    unsubscribe();
    selection.set({packageId: 'PKG-010'});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('.flow-node[data-pkg-id="PKG-050"]')?.getAttribute('data-active')).toBe('true');
  });

  it('「完整详情」按钮：未接线禁用并注明；接线后点击回调 onOpenDetail', async () => {
    stubFetch();
    const selection = new ScheduleSelectionStore();
    selection.set({packageId: 'PKG-070'});

    const bare = new FlowChartPanel(selection);
    bare.show();
    await vi.waitFor(() => expect(document.querySelector('#flow-open-detail')).toBeTruthy());
    expect((document.querySelector('#flow-open-detail') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('未接线');

    installDom();
    const onOpenDetail = vi.fn();
    const wired = new FlowChartPanel(selection, {onOpenDetail, onHighlight: vi.fn()});
    wired.show();
    await vi.waitFor(() => expect(document.querySelector('#flow-open-detail')).toBeTruthy());
    (document.querySelector('#flow-open-detail') as HTMLButtonElement).click();
    expect(onOpenDetail).toHaveBeenCalledWith('PKG-070');
  });

  it('hostile 字符串（包名/阻塞原因）不当标签解析', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

    const body = document.querySelector('#flow-chart-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('i')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    expect((window as unknown as {__flow_pwned?: number}).__flow_pwned).toBeUndefined();
    expect(body.textContent).toContain('外部依赖包');
    expect(body.textContent).toContain('等外部条件');
  });

  it('取数失败显示错误态（HTTP 状态 + 提示），不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 503, json: async () => ({error: 'schedule control invalid'})})) as never);
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#flow-chart-body')?.textContent).toContain('HTTP 503'));
    expect(document.querySelector('#flow-chart-body')?.textContent).toContain('取数失败');
  });

  it('show/hide/isVisible 状态正确', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-010"]')).toBeTruthy());
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#flow-chart-panel') as HTMLElement).style.display).toBe('none');
  });
});
