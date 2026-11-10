import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FlowChartPanel, estimateNodeCardHeight } from './FlowChartPanel.js';
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
    targets: ['pkg.test_object'],
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
        // #68 回归：4 条未关闭阻塞，镜像真实 control.yaml 里 PKG-040 的
        // BLK-HVAC-DEEPENING / MEP-INTERFACE-FREEZE / CABINET-FREEZE-FOR-MEP /
        // SURVEY-DATA-FREEZE（实测阻塞最多的是 PKG-000 共 5 条，PKG-030/040 各 4 条）。
        blockers: [
          {id: 'BLK-HVAC-DEEPENING', item: '中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审', status: 'site_pending', clears_when: '空调、设计和施工三方签认深化图', closed: false},
          {id: 'BLK-MEP-INTERFACE-FREEZE', item: '水电与中央空调的接口未联合冻结', status: 'alignment_required', clears_when: '四方联合交底并签认', closed: false},
          {id: 'BLK-CABINET-FREEZE-FOR-MEP', item: '橱柜深化图是水电点位的 owner 但尚未冻结', status: 'alignment_required', clears_when: '橱柜深化图与水电点位表双向核对完成', closed: false},
          {id: 'BLK-SURVEY-DATA-FREEZE', item: '影响水电与中央空调施工的现场数据尚未全部实测', status: 'site_pending', clears_when: '逐项转为实测值或显式豁免', closed: false},
        ],
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

const leftOf = (packageId: string): number =>
  parseFloat((document.querySelector(`.flow-node[data-pkg-id="${packageId}"]`) as HTMLElement).style.left);

const topOf = (packageId: string): number =>
  parseFloat((document.querySelector(`.flow-node[data-pkg-id="${packageId}"]`) as HTMLElement).style.top);

const fixturePkg = (packageId: string): SchedulePackageView =>
  snapshot().packages.find((item) => item.id === packageId)!;

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

  // 2026-11-04 issue #65：点位来源的 select.all 算点位级能力。真实
  // config/model-package-links.yaml 的 MODEL-PKG-040（水电改造）就是 electrical/plumbing
  // select.all——旧实现 `scopes.some(select.all === true) → project` 一律判「全项目范围」，
  // 徽标错、按钮禁用，而它的本意正是「高亮全部水电点位」。
  it('点位来源的 select.all → 点位级徽标 + 按钮可用；非点位来源的 all 仍全项目范围', async () => {
    const links = {
      schema: 'project.model-package-links/v1',
      authorities: {},
      links: [
        {
          id: 'LNK-040',
          phase_id: 'phase_1_basic_occupancy',
          budget_ref: {source: 'schedule', id: 'PKG-040'},
          mapping_status: 'partial',
          scope: [
            {source: 'electrical', select: {all: true}},
            {source: 'plumbing', select: {all: true}},
            {source: 'electrical_topology', select: {all: true}},
            {source: 'mep_routes', select: {layers: ['strong_power']}},
          ],
        },
        // 对照：非点位来源（ceiling）的 all 没有 3D 位置 → 全项目范围、按钮禁用
        {
          id: 'LNK-070',
          phase_id: 'phase_1_basic_occupancy',
          budget_ref: {source: 'schedule', id: 'PKG-070'},
          mapping_status: 'mapped',
          scope: [{source: 'ceiling', select: {all: true}}],
        },
      ],
    };
    stubFetch(snapshot(), links);
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new FlowChartPanel(selection, {onHighlight});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-040"]')).toBeTruthy());

    const node040 = document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement;
    expect(node040.textContent).toContain('点位级（可高亮）');
    expect(node040.dataset.capability).toBe('point');
    node040.click();
    const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
    const highlight = bar.querySelector('#flow-highlight') as HTMLButtonElement;
    // 点位来源的 all 有全部点位可高亮，按钮不得禁用（vitest 的 toBe 只收一个参数，
    // 说明写在这里）
    expect(highlight.disabled).toBe(false);
    highlight.click();
    expect(onHighlight).toHaveBeenCalledWith('PKG-040');

    // 对照包：ceiling 的 all 不展开成 3D 位置 → 全项目范围、按钮禁用
    const node070 = document.querySelector('.flow-node[data-pkg-id="PKG-070"]') as HTMLElement;
    expect(node070.textContent).toContain('全项目范围');
    node070.click();
    expect((document.querySelector('#flow-selection-bar #flow-highlight') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mapping_status: project_scope 的链接一律全项目范围，不按选择器猜（PKG-142 整屋放行）', async () => {
    const links = {
      schema: 'project.model-package-links/v1',
      authorities: {},
      links: [
        {
          id: 'LNK-142',
          phase_id: 'phase_1_basic_occupancy',
          budget_ref: {source: 'schedule', id: 'PKG-040'},
          mapping_status: 'project_scope',
          scope: [
            {source: 'model_geometry', select: {all: true}},
            {source: 'electrical', select: {all: true}},
            {source: 'plumbing', select: {all: true}},
          ],
        },
      ],
    };
    stubFetch(snapshot(), links);
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-040"]')).toBeTruthy());

    const node = document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement;
    expect(node.textContent).toContain('全项目范围');
    node.click();
    expect((document.querySelector('#flow-selection-bar #flow-highlight') as HTMLButtonElement).disabled).toBe(true);
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

  // #67：多包 3D 反查时选中态不预设首个包（App 侧不再 set 首个包 id）。面板侧
  // 的契约：空选中条必须给「点哪个、点完看什么」的明确指引，点节点后选中条
  // 即该包摘要（卡片里折掉的阻塞原因在这里全量展开）。
  it('多包反查后选中态留空：空选中条给点选指引，点节点后选中条即详情摘要', async () => {
    stubFetch();
    const selection = new ScheduleSelectionStore();
    const panel = new FlowChartPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-030"]')).toBeTruthy());

    panel.highlightPackages(['PKG-030', 'PKG-040']);

    const hint = document.querySelector('#flow-reverse-hint') as HTMLElement;
    expect(hint.textContent).toContain('该 3D 对象同属 2 个包，已全部标出（PKG-030、PKG-040）');
    expect(hint.textContent).toContain('请点选其中一个节点');
    expect(hint.textContent).toContain('未预设首个包');

    // 选中态留空（没有预设 PKG-030）：空选中条带多包反查指引，且不渲染详情按钮
    const emptyBar = document.querySelector('#flow-selection-bar') as HTMLElement;
    expect(emptyBar.textContent).toContain('还没有选中工作包');
    expect(emptyBar.textContent).toContain('3D 反查命中 2 个包');
    expect(emptyBar.textContent).toContain('请点选其中一个节点查看详情');
    expect(document.querySelector('#flow-open-detail')).toBeNull();

    // 业主点节点 → 选中条显示该包摘要，卡片里折掉的阻塞原因在这里全量展开
    (document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement).click();
    const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
    expect(bar.textContent).toContain('瓦工铺贴');
    expect(bar.textContent).toContain('未关闭阻塞');
    expect(bar.textContent).toContain('橱柜深化图是水电点位的 owner 但尚未冻结');
  });

  // #68：卡片不再固定 100px + overflow:hidden 静默截断；阻塞多于两条时折叠为
  // 「还有 N 条」（全文进 title 悬浮提示与选中条），行距按本行最高卡片撑开，
  // 相邻行永不重叠。实测依据：真实快照阻塞最多的节点是 PKG-000（5 条未关闭
  // 阻塞），PKG-030/040 各 4 条——fixture 的 PKG-040 即按 4 条构造。
  it('阻塞折叠 + 自适应行高：多于两条只展开前两条，行距按卡片高度撑开不重叠', async () => {
    stubFetch();
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-040"]')).toBeTruthy());

    const node040 = document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement;
    // 前两条展开、后两条折叠；被折掉的全文仍在 title 悬浮提示里（不静默丢失）
    expect(node040.textContent).toContain('中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审');
    expect(node040.textContent).toContain('水电与中央空调的接口未联合冻结');
    expect(node040.textContent).not.toContain('橱柜深化图是水电点位的 owner');
    expect(node040.textContent).not.toContain('影响水电与中央空调施工的现场数据尚未全部实测');
    expect(node040.textContent).toContain('还有 2 条阻塞原因');
    expect(node040.title).toContain('橱柜深化图是水电点位的 owner 但尚未冻结');
    expect(node040.title).toContain('影响水电与中央空调施工的现场数据尚未全部实测');
    // 旧病锚点：固定 max-height:100px + overflow:hidden 已移除，min-height 保留
    expect(node040.style.maxHeight).toBe('');
    expect(node040.getAttribute('style')).not.toContain('overflow:hidden');
    expect(node040.style.minHeight).toBe('84px');

    // 行几何：row0 = {PKG-010/020/030/070/080}，row1 = {PKG-040}，row2 = {PKG-050}
    // （layer→列、层内序号→行）。下一行 top = 本行 top + 本行最高卡片估算高度 + 行距。
    const row0Height = Math.max(
      estimateNodeCardHeight(fixturePkg('PKG-010')),
      estimateNodeCardHeight(fixturePkg('PKG-020')),
      estimateNodeCardHeight(fixturePkg('PKG-030')),
      estimateNodeCardHeight(fixturePkg('PKG-070')),
      estimateNodeCardHeight(fixturePkg('PKG-080')),
    );
    expect(topOf('PKG-040')).toBe(16 + row0Height + 8);
    expect(topOf('PKG-050')).toBe(topOf('PKG-040') + estimateNodeCardHeight(fixturePkg('PKG-040')) + 8);
    // 画布高度装得下最后一行（含底部内边距）
    const canvasInner = document.querySelector('#flow-chart-canvas > div') as HTMLElement;
    expect(parseFloat(canvasInner.style.height)).toBeGreaterThanOrEqual(topOf('PKG-050') + estimateNodeCardHeight(fixturePkg('PKG-050')) + 16);
  });

  // 「还有 N 条」折叠长句在 ~184px 卡宽内必然换行（10px 字号，仅 26 个全角字符
  // 就 260px）：高度估算只按固定一行加会把多阻塞节点的卡片算低，行坐标、画布
  // 高度与边端点整套跟着偏低，相邻行卡片互相压住（codex major）。修法：估算按
  // 实际文案走同文件 textLinesOf 算行数（选它而非实测：jsdom 不做布局，
  // offsetHeight 恒 0，行坐标/画布/边端点要确定性数值，估算同时是测试唯一口径）。
  // 验收口径：镜像真实快照 PKG-000 的五条未关闭阻塞（全项目最多；item/解除条件
  // 逐字取 schedule/phase-1/control.yaml 的 global_blockers）。
  it('「还有 N 条」换行计入高度估算：PKG-000 五条阻塞形态下卡片不被算低、相邻行不重叠', async () => {
    const pkg000Blockers = [
      {id: 'BLK-HANDOVER', item: '尚未交房，无法完成现场量房及房屋查验', status: 'site_pending', clears_when: '交房查验完成并归档现场记录', closed: false},
      {id: 'BLK-STRUCTURE', item: '墙体结构、梁底及允许打孔或穿墙条件未确认', status: 'site_pending', clears_when: '结构资料与现场复核结果完成会签', closed: false},
      {id: 'BLK-HVAC-DEEPENING', item: '中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审', status: 'site_pending', clears_when: '空调、设计和施工三方签认深化图', closed: false},
      {id: 'BLK-GAS-DOOR', item: '燃气厨房门的现场验收要求未确认', status: 'site_pending', clears_when: '燃气单位或物业书面确认厨房分隔要求', closed: false},
      {id: 'BLK-SURVEY-DATA-FREEZE', item: '影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 原量房台账（已于 S2-B 退场）', status: 'site_pending', clears_when: '影响水电与中央空调的条目逐项转为实测值或显式豁免，并回填 config 与 原量房台账（已于 S2-B 退场）', closed: false},
    ];
    const snap = snapshot();
    const byId = (id: string) => snap.packages.find((item) => item.id === id)!;
    // PKG-000 的五条未关闭阻塞挂到 row0 的 PKG-010 上（不改共享 fixture）
    byId('PKG-010').blockers = pkg000Blockers;
    stubFetch(snap);
    const panel = new FlowChartPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-010"]')).toBeTruthy());

    // 折叠行整句进 DOM（渲染与估算共用同一份文案，禁两份各写）
    const node010 = document.querySelector('.flow-node[data-pkg-id="PKG-010"]') as HTMLElement;
    expect(node010.textContent).toContain('还有 3 条阻塞原因（点此节点，完整列表见下方选中条与详情）');

    // 折叠行按换行计高：与「只留前两条、无折叠行」的同包相比，差值 ≥ 两行
    // small 行高（15px）+ margin（2px）——旧实现只加固定一行（15+2），PKG-000
    // 这类五条阻塞的节点会被算低 15px，压住下一行。
    const pkg010NoFold = {...byId('PKG-010'), blockers: pkg000Blockers.slice(0, 2)};
    expect(estimateNodeCardHeight(byId('PKG-010')) - estimateNodeCardHeight(pkg010NoFold)).toBeGreaterThanOrEqual(2 * 15 + 2);

    // 行几何不重叠：PKG-010 在 row0（现为全行最高卡），下一行 top = 本行 top +
    // 本行最高卡片估算高度 + 行距；画布高度装下最后一行。
    const row0Height = Math.max(
      estimateNodeCardHeight(byId('PKG-010')),
      estimateNodeCardHeight(byId('PKG-020')),
      estimateNodeCardHeight(byId('PKG-030')),
      estimateNodeCardHeight(byId('PKG-070')),
      estimateNodeCardHeight(byId('PKG-080')),
    );
    expect(topOf('PKG-040')).toBe(16 + row0Height + 8);
    expect(topOf('PKG-050')).toBe(topOf('PKG-040') + estimateNodeCardHeight(byId('PKG-040')) + 8);
    const canvasInner = document.querySelector('#flow-chart-canvas > div') as HTMLElement;
    expect(parseFloat(canvasInner.style.height)).toBeGreaterThanOrEqual(topOf('PKG-050') + estimateNodeCardHeight(byId('PKG-050')) + 16);
  });

  it('窄屏下折叠阻塞文案指「上方」：选中条前置后方向指引不能还写「下方」（codex 复审 minor）', async () => {
    // 同 fixture（PKG-010 挂五条阻塞 → 折叠行出现），窄容器下选中条已前置到画布
    // 上方，文案必须跟着指「上方」——否则用户被引去翻完整张图。「上方/下方」等长，
    // 高度估算不受影响（估算处传 false）。
    const pkg000Blockers = [
      {id: 'BLK-HANDOVER', item: '尚未交房，无法完成现场量房及房屋查验', status: 'site_pending', clears_when: '交房查验完成并归档现场记录', closed: false},
      {id: 'BLK-STRUCTURE', item: '墙体结构、梁底及允许打孔或穿墙条件未确认', status: 'site_pending', clears_when: '结构资料与现场复核结果完成会签', closed: false},
      {id: 'BLK-HVAC-DEEPENING', item: '中央空调管线、冷凝水、风口和检修口尚未完成厂家深化及三方会审', status: 'site_pending', clears_when: '空调、设计和施工三方签认深化图', closed: false},
      {id: 'BLK-GAS-DOOR', item: '燃气厨房门的现场验收要求未确认', status: 'site_pending', clears_when: '燃气单位或物业书面确认厨房分隔要求', closed: false},
      {id: 'BLK-SURVEY-DATA-FREEZE', item: '影响水电与中央空调施工的现场数据尚未全部实测、显式豁免或登记为阻塞；当前清单和数据状态见 原量房台账（已于 S2-B 退场）', status: 'site_pending', clears_when: '影响水电与中央空调的条目逐项转为实测值或显式豁免，并回填 config 与 docs', closed: false},
    ];
    const snap = snapshot();
    snap.packages.find((item) => item.id === 'PKG-010')!.blockers = pkg000Blockers;
    stubFetch(snap);
    const restore = stubClientWidth(334);
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-010"]')).toBeTruthy());
      const node010 = document.querySelector('.flow-node[data-pkg-id="PKG-010"]') as HTMLElement;
      expect(node010.textContent).toContain('完整列表见上方选中条与详情');
      expect(node010.textContent).not.toContain('见下方选中条');
    } finally {
      restore();
    }
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

// ─── issue #83：窄容器（375-390px 手机）画布宽吃容器宽 ─────────────────────
//
// 背景：布局原是纯常量函数（NODE_WIDTH=200 / COLUMN_PITCH=240 / CANVAS_PAD=16），
// 12 层依赖图的画布宽就是 2872px；390px 手机上 #approval-page-panels 只剩约 334px
// 给画布，第 2 列起被裁、只能在嵌套横滚盒里平移 8 屏多（真浏览器实测：viewport
// 390×667 下 canvas clientWidth 332 / scrollWidth 2888，overflow-x:auto 能滚但无提示）。
// 修法：容器实测宽 ≤700px → 单列堆叠，**卡宽仍 200**（estimateNodeCardHeight 的换行/
// 行高口径全建立在 200px 卡宽上，#78 实测边界不动），画布宽 = 容器内容盒宽。
//
// jsdom 不做布局（clientWidth 恒 0，生产按 0 走宽容器布局），所以这里显式 stub
// 容器宽。334 = 390 视口 − #approval-page-panels 内边距 12px×2 − 面板内边距 16px×2。
function stubClientWidth(width: number): () => void {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {configurable: true, get: () => width});
  return () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}

/** 解析 path 的 d 属性成坐标点序列（d 里只有数字、空格与逗号）。 */
function edgePoints(d: string): Array<[number, number]> {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
    .map((match) => [parseFloat(match[1]), parseFloat(match[2])] as [number, number]);
}

const canvasInnerWidth = (): number =>
  parseFloat((document.querySelector('#flow-chart-canvas > div') as HTMLElement).style.width);

/** stub Element.prototype.scrollIntoView（jsdom 不实现它，调用即 not a function）。 */
function stubScrollIntoView(): {mock: ReturnType<typeof vi.fn>; restore: () => void} {
  const mock = vi.fn();
  const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Object.defineProperty(Element.prototype, 'scrollIntoView', {configurable: true, writable: true, value: mock});
  return {
    mock,
    restore: () => {
      if (own) Object.defineProperty(Element.prototype, 'scrollIntoView', own);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    },
  };
}

describe('FlowChartPanel 窄容器（issue #83）', () => {
  beforeEach(() => {
    installDom();
  });

  it('334px 容器（390px 手机）：单列堆叠，所有节点在容器内、不重叠、连线端点跟着堆叠坐标走', async () => {
    stubFetch();
    const restore = stubClientWidth(334);
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

      // 画布宽吃容器宽：334 实测 − 画布边框 1px×2 = 内容盒 332（不触发横向滚动条）
      expect(document.querySelector('#flow-chart-canvas')?.getAttribute('data-flow-mobile')).toBe('true');
      expect(canvasInnerWidth()).toBe(332);
      expect((document.querySelector('#flow-chart-canvas svg') as SVGElement).getAttribute('width')).toBe('332');

      // 逐节点：全部同一列（CANVAS_PAD 16 + 导轨 24），right ≤ 容器宽
      const cards = Array.from(document.querySelectorAll('.flow-node[data-side-lane="false"]')) as HTMLElement[];
      expect(cards).toHaveLength(7);
      expect(new Set(cards.map((card) => parseFloat(card.style.left)))).toEqual(new Set([40]));
      for (const card of cards) {
        expect(parseFloat(card.style.left) + 200).toBeLessThanOrEqual(334);
      }

      // 堆叠顺序 = (layer, row) = 依赖顺序；相邻卡片不重叠（间距恒 ≥ 本卡高度 + ROW_GAP）
      const stacked = cards
        .map((card) => ({id: card.dataset.pkgId!, top: parseFloat(card.style.top)}))
        .sort((left, right) => left.top - right.top);
      expect(stacked.map((node) => node.id)).toEqual(['PKG-010', 'PKG-020', 'PKG-030', 'PKG-040', 'PKG-050', 'PKG-070', 'PKG-080']);
      for (let index = 1; index < stacked.length; index += 1) {
        const previousHeight = Math.max(84, estimateNodeCardHeight(fixturePkg(stacked[index - 1].id)));
        expect(stacked[index].top).toBeGreaterThanOrEqual(stacked[index - 1].top + previousHeight + 8);
      }

      // 连线：数量不变，全部坐标落在容器内；端点跟着堆叠坐标走（源卡底中 → 目标卡顶中）
      const edges = document.querySelectorAll('path.flow-edge');
      expect(edges).toHaveLength(8);
      for (const edge of Array.from(edges)) {
        const points = edgePoints(edge.getAttribute('d') ?? '');
        expect(points.length).toBeGreaterThan(0);
        expect(Math.min(...points.map(([x]) => x))).toBeGreaterThanOrEqual(0);
        expect(Math.max(...points.map(([x]) => x))).toBeLessThanOrEqual(332);
      }
      const edge010020 = document.querySelector('path.flow-edge[data-from="PKG-010"][data-to="PKG-020"]') as SVGElement;
      const points = edgePoints(edge010020.getAttribute('d') ?? '');
      expect(points[0]).toEqual([140, topOf('PKG-010') + Math.max(84, estimateNodeCardHeight(fixturePkg('PKG-010')))]);
      expect(points[points.length - 1]).toEqual([140, topOf('PKG-020')]);

      // 卡片实际高度钉在布局盒高度（codex 复审 minor）：窄屏端点 = 真实卡底。
      // 没有这条，卡片按内容 auto 撑高、#78 实测估算恒高 8.3–10.3px，端点悬在卡下方。
      for (const card of cards) {
        const expected = Math.max(84, estimateNodeCardHeight(fixturePkg(card.dataset.pkgId!)));
        expect(card.style.height, `${card.dataset.pkgId} 的显式高度`).toBe(`${expected}px`);
      }
      // PKG-010 的边起点严格等于它的真实卡底（top + 显式高度）
      const card010 = cards.find((card) => card.dataset.pkgId === 'PKG-010') as HTMLElement;
      expect(points[0][1]).toBe(parseFloat(card010.style.top) + parseFloat(card010.style.height));

      // 侧车道仍在图表下方单独一条（不占堆叠）
      expect(document.querySelector('.flow-node[data-side-lane="true"]')?.getAttribute('style')).toContain('position:relative');

      // 选中 / 点击 / 详情按钮行为不变
      (document.querySelector('.flow-node[data-pkg-id="PKG-020"]') as HTMLElement).click();
      expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('水电改造');
      expect(document.querySelector('.flow-node[data-pkg-id="PKG-020"]')?.getAttribute('data-active')).toBe('true');
    } finally {
      restore();
    }
  });

  it('宽容器（桌面）：布局与常量算式逐字一致，不落 data-flow-mobile', async () => {
    stubFetch();
    const restore = stubClientWidth(1440);
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

      // 画布宽 = CANVAS_PAD×2 + (层数−1)×COLUMN_PITCH + NODE_WIDTH = 32 + 4×240 + 200
      expect(canvasInnerWidth()).toBe(1192);
      expect(document.querySelector('#flow-chart-canvas')?.hasAttribute('data-flow-mobile')).toBe(false);
      // 节点坐标仍是 layer→列、row→行
      expect(leftOf('PKG-020')).toBe(16 + 240);
      expect(leftOf('PKG-050')).toBe(16 + 2 * 240);
      const row0Height = Math.max(
        estimateNodeCardHeight(fixturePkg('PKG-010')),
        estimateNodeCardHeight(fixturePkg('PKG-020')),
        estimateNodeCardHeight(fixturePkg('PKG-030')),
        estimateNodeCardHeight(fixturePkg('PKG-070')),
        estimateNodeCardHeight(fixturePkg('PKG-080')),
      );
      expect(topOf('PKG-040')).toBe(16 + row0Height + 8);
      // 边仍是原 bezier：端点挂源卡右缘中点 → 目标卡左缘中点
      const edge = document.querySelector('path.flow-edge[data-from="PKG-010"][data-to="PKG-020"]') as SVGElement;
      const points = edgePoints(edge.getAttribute('d') ?? '');
      expect(points[0]).toEqual([16 + 200, 16 + estimateNodeCardHeight(fixturePkg('PKG-010')) / 2]);
      expect(points[points.length - 1]).toEqual([16 + 240, 16 + estimateNodeCardHeight(fixturePkg('PKG-020')) / 2]);

    } finally {
      restore();
    }
  });

  it('容器窄于单列下限（<256px）：画布保留下限并经自身 overflow:auto 横滚兜底', async () => {
    stubFetch();
    const restore = stubClientWidth(200);
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

      // 下限 = CANVAS_PAD×2 + 导轨 24 + 卡宽 200 = 256 > 容器 200 → 内容宽 > 容器宽，
      // 由画布自身的横向滚动容器保证可达（issue 认可的第二条验收口径）
      expect(canvasInnerWidth()).toBe(256);
      expect((document.querySelector('#flow-chart-canvas') as HTMLElement).style.overflow).toBe('auto');
      for (const card of Array.from(document.querySelectorAll('.flow-node[data-side-lane="false"]'))) {
        expect(parseFloat((card as HTMLElement).style.left) + 200).toBeLessThanOrEqual(256);
      }
    } finally {
      restore();
    }
  });

  it('容器由宽变窄（旋转/分屏）：多列 → 单列堆叠重算，节点仍全部在容器内', async () => {
    stubFetch();
    // 捕获 ResizeObserver 回调（jsdom 的 shim 不触发），模拟容器尺寸变化
    let fire: (() => void) | undefined;
    class CapturingResizeObserver {
      constructor(callback: () => void) {
        fire = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const original = (globalThis as {ResizeObserver?: unknown}).ResizeObserver;
    (globalThis as {ResizeObserver?: unknown}).ResizeObserver = CapturingResizeObserver;
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-010"]')).toBeTruthy());
      // 宽容器：多列布局
      expect(leftOf('PKG-020')).toBe(16 + 240);

      const restore = stubClientWidth(334);
      try {
        fire?.();
      } finally {
        restore();
      }
      // 翻转后单列堆叠，节点全部落在容器内
      expect(document.querySelector('#flow-chart-canvas')?.getAttribute('data-flow-mobile')).toBe('true');
      expect(canvasInnerWidth()).toBe(332);
      expect(leftOf('PKG-020')).toBe(40);
      for (const card of Array.from(document.querySelectorAll('.flow-node[data-side-lane="false"]'))) {
        expect(parseFloat((card as HTMLElement).style.left) + 200).toBeLessThanOrEqual(334);
      }
    } finally {
      (globalThis as {ResizeObserver?: unknown}).ResizeObserver = original;
    }
  });

  // #83 codex 复审 major：窄容器单列堆叠的画布没有高度上限（style.css 的
  // #flow-chart-canvas[data-flow-mobile] 放开 max-height，纵向滚动交给
  // #approval-page-panels），二十多张卡于是把选中条与「完整详情」按钮冲到整张图
  // 之后——点靠前的节点后要滚过全部后续卡才能读完整阻塞原因/打开详情，返回还得
  // 反向滚。修法 A（选中条前置成画布的前置兄弟 + 点节点 scrollIntoView 滚回视野；
  // 不选 sticky：jsdom 对 position:sticky 计算样式支持有限，断言不了）。
  it('窄容器：选中条是画布的前置兄弟，点节点后 scrollIntoView 被调用', async () => {
    stubFetch();
    const restoreWidth = stubClientWidth(334);
    const scroll = stubScrollIntoView();
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

      // 前置兄弟：选中条紧贴画布上方（本例无 3D 反查高亮，反查提示为空串，
      // 故选中条就是画布的直接前驱）
      const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
      expect(bar.nextElementSibling?.id).toBe('flow-chart-canvas');
      expect(scroll.mock).not.toHaveBeenCalled();

      // 点节点 → 选中 + scrollIntoView 把选中条滚回视野（最小滚动，不置顶）
      (document.querySelector('.flow-node[data-pkg-id="PKG-040"]') as HTMLElement).click();
      expect(scroll.mock).toHaveBeenCalledTimes(1);
      expect(scroll.mock).toHaveBeenCalledWith({block: 'nearest'});
      // 选中条即该包摘要（卡片里折掉的阻塞原因在这里全量展开）——不再需要
      // 滚过全部后续卡才读到
      expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('瓦工铺贴');
      expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('未关闭阻塞');
      expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('橱柜深化图是水电点位的 owner 但尚未冻结');
    } finally {
      restoreWidth();
      scroll.restore();
    }
  });

  // 对照（同一次修复的桌面侧回归）：宽容器 DOM 顺序一行不动——画布 → 侧车道 →
  // 反查提示 → 选中条，点节点也不弹 scrollIntoView（画布限高 460px，选中条
  // 就在画布下沿，没有「滚过整张图」的问题）。
  it('宽容器（桌面）：选中条仍在画布之后（顺序一行不动），点节点不调 scrollIntoView', async () => {
    stubFetch();
    const restoreWidth = stubClientWidth(1440);
    const scroll = stubScrollIntoView();
    try {
      const panel = new FlowChartPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.flow-node[data-pkg-id="PKG-080"]')).toBeTruthy());

      const canvas = document.querySelector('#flow-chart-canvas') as HTMLElement;
      const sideLane = document.querySelector('#flow-side-lane') as HTMLElement;
      const bar = document.querySelector('#flow-selection-bar') as HTMLElement;
      expect(canvas.nextElementSibling).toBe(sideLane);
      expect(sideLane.nextElementSibling).toBe(bar);

      (document.querySelector('.flow-node[data-pkg-id="PKG-020"]') as HTMLElement).click();
      expect(scroll.mock).not.toHaveBeenCalled();
      expect(document.querySelector('#flow-selection-bar')?.textContent).toContain('水电改造');
    } finally {
      restoreWidth();
      scroll.restore();
    }
  });
});
