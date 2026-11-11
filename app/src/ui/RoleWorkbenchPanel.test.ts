import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleWorkbenchPanel } from './RoleWorkbenchPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type {
  ScheduleCheckView,
  ScheduleCoordinationView,
  SchedulePackageProjectionView,
  SchedulePackageView,
  ScheduleProjectionView,
  ScheduleSnapshot,
} from '@shared/schedule-state';

// 合成快照覆盖任务书 §4 的 11 条 + §1.4 冲突两级口径 + §1.1 只读/上限/空态：
//  - PKG-010 带四种 audit_status（未登记 / failed / passed / waived）对照「只列未完成」；
//  - 默认 coordination 五条覆盖三态入场（pending_invite/invited/unassigned）与
//    不入场（confirmed/cancelled）；
//  - 默认无锚点：ordinals[].date 全 null，本面板不造年月日（ confirmed_at 是证据
//    日期，原样展示并注明「确认登记日」）。
function checkView(overrides: Partial<ScheduleCheckView> = {}): ScheduleCheckView {
  return {
    id: 'SCH-010-01',
    item: '拆除交底',
    source: 'package',
    evidence_required: [],
    check_spec_sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function pkgView(overrides: Partial<SchedulePackageView> = {}): SchedulePackageView {
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
    owner_roles: ['设计师'],
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
    targets: [],
    project_fingerprint: 'a'.repeat(64),
    ...overrides,
  };
}

function coordView(overrides: Partial<ScheduleCoordinationView> = {}): ScheduleCoordinationView {
  return {
    package_id: 'PKG-010',
    required_roles: ['设计师'],
    mode: 'onsite',
    lead_time_workdays: 2,
    owner_role: '设计师',
    status: 'pending_invite',
    actor: {name: null, org: null},
    confirmed_at: null,
    escalation: '逾期未确认：升级到业主协调',
    ...overrides,
  };
}

function projectionPkg(start: number, endMin: number, endMax: number): SchedulePackageProjectionView {
  return {
    duration_workdays: {min: 1, max: Math.max(1, endMax - start + 1)},
    baseline: {start_ord: start, end_ord_min: endMin, end_ord_max: endMax},
    forecast: {start_ord: start, end_ord_min: endMin, end_ord_max: endMax},
    check_window: null,
    blocking_reasons: [],
    constraints: [],
  };
}

/** 默认排程投影：无锚点（ordinals[].date 全 null），PKG-030/040/050/060 供潜在窗口判定。 */
function scheduleView(overrides: Partial<ScheduleProjectionView> = {}): ScheduleProjectionView {
  return {
    anchor_date: null,
    calendar: {workdays: [1, 2, 3, 4, 5], rest_dates: [], extra_workdates: []},
    ordinals: [1, 2, 3, 4, 5, 6].map((ord) => ({ord, date: null})),
    packages: {
      'PKG-010': projectionPkg(2, 3, 4),
      'PKG-020': projectionPkg(3, 4, 5),
      'PKG-030': projectionPkg(5, 6, 6),
      'PKG-040': projectionPkg(6, 7, 7),
      'PKG-050': projectionPkg(2, 3, 4),
      'PKG-060': projectionPkg(3, 4, 5),
    },
    ...overrides,
  };
}

function snapshotView(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
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
      pkgView({
        owner_roles: ['设计师', '施工方'],
        checks: [
          checkView({id: 'SCH-010-01', item: '拆除交底'}),
          checkView({id: 'SCH-010-02', item: '砌筑验收', audit_status: 'failed'}),
          checkView({id: 'SCH-010-03', item: '完工复审', audit_status: 'passed'}),
          checkView({id: 'SCH-010-04', item: '豁免项', audit_status: 'waived'}),
          checkView({id: 'SCH-011-01', item: '现场交底'}),
        ],
      }),
      pkgView({
        id: 'PKG-020',
        name: '水电改造',
        sequence: 20,
        owner_roles: ['施工方', '水电施工'],
        checks: [checkView({id: 'SCH-020-01', item: '水管打压', audit_status: 'pending'})],
      }),
      pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['施工方']}),
    ],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: [
      {kind: 'ready_package', ref: 'PKG-010', title: 'PKG-010 可以开工', detail: '拆改与砌筑就绪', unblocks: 3, package_id: 'PKG-010'},
    ],
    stale_audits: [],
    package_gate_issues: [],
    coordination: {
      'SCH-011-01': coordView({package_id: 'PKG-010', required_roles: ['设计师', '施工方'], mode: 'onsite', status: 'pending_invite'}),
      'SCH-020-02': coordView({package_id: 'PKG-020', required_roles: ['施工方', '水电施工'], owner_role: '施工方', mode: 'remote', lead_time_workdays: 1, status: 'invited', actor: {name: '王工', org: '水电施工队'}}),
      'SCH-020-03': coordView({package_id: 'PKG-020', required_roles: ['业主'], owner_role: '业主', mode: 'notify', lead_time_workdays: 5, status: 'unassigned'}),
      'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', lead_time_workdays: 3, status: 'confirmed', actor: {name: '张三', org: '甲公司'}, confirmed_at: '2026-03-02'}),
      'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', lead_time_workdays: 3, status: 'cancelled'}),
    },
    schedule: scheduleView(),
    ...overrides,
  };
}

/** 只 stub /api/schedule/state；面板若拉任何其他端点，这里回 404 让调用留痕。 */
function stubFetch(state: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string) => (
    String(url) === '/api/schedule/state'
      ? {ok: true, status: 200, json: async () => state}
      : {ok: false, status: 404, json: async () => ({error: 'unexpected endpoint'})}
  ));
  vi.stubGlobal('fetch', mock as never);
  return mock as unknown as ReturnType<typeof vi.fn>;
}

function installDom(): void {
  document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
}

const bodyText = (): string => (document.querySelector('#role-workbench-body') as HTMLElement | null)?.textContent ?? '';

const roleGroup = (role: string): HTMLElement => document.querySelector(`.rw-role[data-role="${role}"]`) as HTMLElement;

const sectionOf = (role: string, section: string): HTMLElement =>
  roleGroup(role).querySelector(`.rw-section[data-section="${section}"]`) as HTMLElement;

/** jsdom 不做布局（clientWidth 恒 0）；窄容器用例显式 stub 容器实测宽（同 GanttPanel 测）。 */
function stubClientWidth(width: number): () => void {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {configurable: true, get: () => width});
  return () => {
    if (own) Object.defineProperty(HTMLElement.prototype, 'clientWidth', own);
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  };
}

describe('RoleWorkbenchPanel', () => {
  beforeEach(() => {
    installDom();
  });

  // 任务书 §4-1 / §1.1：角色集合 = owner_roles ∪ required_roles ∪ owner_role，
  // 字典序（< / > 比较，不用 localeCompare）；三节顺序固定。
  it('按角色分组渲染：角色字典序 + 三节顺序固定', async () => {
    stubFetch(snapshotView());
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    const roles = Array.from(document.querySelectorAll('.rw-role')).map((el) => (el as HTMLElement).dataset.role);
    expect(roles).toEqual(['业主', '施工方', '水电施工', '设计师']);
    const sections = Array.from(roleGroup('设计师').querySelectorAll('.rw-section'))
      .map((el) => (el as HTMLElement).dataset.section);
    expect(sections).toEqual(['checks', 'coordination', 'conflicts']);
    // 试点水印固定在场（§5 风险表：未登记的 SCH 不出现 ≠ 无协调）
    expect(bodyText()).toContain('试点数据：仅登记了 coordination 的 SCH 出现，未登记不代表无协调');
    expect(bodyText()).toContain('数据只读自');
    panel.hide();
  });

  // 任务书 §4-2 / §1.1：passed/waived 算已完成不入列；undefined 显「未登记」，
  // 其余 audit_status 原样（不把派生值翻译成声明值）；unblocks 作行内注释。
  it('待办检查只列未完成（passed/waived 不出现），unblocks 注释在场', async () => {
    stubFetch(snapshotView());
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    const checks = sectionOf('设计师', 'checks');
    expect(checks.querySelectorAll('.rw-check-row')).toHaveLength(3);
    expect(checks.textContent).toContain('拆除交底');
    expect(checks.textContent).toContain('未登记');
    expect(checks.textContent).toContain('SCH-010-02');
    expect(checks.textContent).toContain('failed'); // 原样，不译成「未通过」
    expect(checks.textContent).not.toContain('完工复审');
    expect(checks.textContent).not.toContain('豁免项');
    expect(checks.textContent).toContain('解锁 3 个下游');
    // 施工方跨两个包：PKG-010 三项 + PKG-020 一项
    expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(4);
    expect(sectionOf('施工方', 'checks').textContent).toContain('水管打压');
    panel.hide();
  });

  // 任务书 §4-3 / §1.1：三态入场；confirmed/cancelled 不入场；actor null → 待指定。
  it('待确认协调列三态，confirmed/cancelled 不入场，actor null 显「待指定」', async () => {
    stubFetch(snapshotView());
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-coord-row')).toBeTruthy());

    const owner = sectionOf('业主', 'coordination');
    expect(owner.textContent).toContain('SCH-020-03'); // unassigned
    expect(owner.textContent).toContain('未分配');
    expect(owner.textContent).toContain('通知'); // mode chip：颜色旁有中文
    expect(owner.textContent).toContain('提前 5 个工作日');
    expect(owner.textContent).toContain('参与人：待指定');
    expect(owner.textContent).not.toContain('SCH-030-01'); // confirmed 不进待确认
    const worker = sectionOf('施工方', 'coordination');
    expect(worker.textContent).toContain('SCH-020-02'); // invited
    expect(worker.textContent).toContain('已邀请');
    expect(worker.textContent).toContain('参与人：王工（水电施工队）');
    // cancelled 全程不出现（冲突/潜在也不出，见后续用例）
    expect(bodyText()).not.toContain('SCH-040-01');
    expect(bodyText()).not.toContain('SCH-030-01');
    panel.hide();
  });

  // 任务书 §4-4 / §1.4：notify 不产冲突也不进潜在（mode !== 'onsite' 排除）。
  it('notify 不产冲突：徽标不存在', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'notify', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-030-02': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'notify', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '李四', org: '乙公司'}}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(sectionOf('业主', 'conflicts').textContent).not.toContain('冲突：同日双现场');
    expect(sectionOf('业主', 'conflicts').textContent).toContain('没有现场冲突');
    panel.hide();
  });

  // 任务书 §4-5 / §1.4：同角色 ≥2 条 onsite 且都已确认且 confirmed_at 同日 → 冲突徽标。
  it('同角色 onsite 同日双现场（都 confirmed，confirmed_at 同日）→ 冲突徽标', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        // 同日但带时刻：按日期前缀判「同日」
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02T09:30:00', actor: {name: '李四', org: '乙公司'}}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="conflict"]') as HTMLElement;
    expect(badge.textContent).toContain('冲突：同日双现场');
    expect(badge.textContent).toContain('2 条｜同日 2026-03-02');
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    expect(conflicts.textContent).toContain('确认登记日 2026-03-02');
    expect(conflicts.textContent).toContain('确认登记日 2026-03-02T09:30:00');
    expect(document.querySelector('.rw-badge[data-level="potential"]')).toBeNull();
    panel.hide();
  });

  // 任务书 §4-6 / §1.4：未确认 + 窗口闭区间重叠 → 潜在徽标。
  it('同角色 onsite 未确认 + forecast 窗口重叠 → 潜在徽标', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'invited', actor: {name: '王工', org: null}}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="potential"]') as HTMLElement;
    expect(badge.textContent).toContain('潜在：窗口重叠（未确认）');
    // PKG-030 窗口 [5,6] 与 PKG-040 窗口 [6,7] 闭区间相交 → 第 5–第 7 工作日
    expect(badge.textContent).toContain('2 条｜第 5–第 7 工作日');
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    expect(conflicts.textContent).toContain('窗口 第 5–第 6 工作日');
    expect(document.querySelector('.rw-badge[data-level="conflict"]')).toBeNull();
    panel.hide();
  });

  // 任务书 §4-6 / §1.4：confirmed + 未确认混合，两者都不出（confirmed 不进潜在窗口）。
  it('confirmed + 未确认混合：冲突与潜在徽标都不出', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(sectionOf('业主', 'conflicts').textContent).not.toContain('冲突：同日双现场');
    expect(sectionOf('业主', 'conflicts').textContent).not.toContain('潜在：窗口重叠（未确认）');
    panel.hide();
  });

  // 任务书 §4-7 / §1.4：cancelled 排除（取消即解除占用）——把它拿掉才有簇，故两者都不出。
  it('cancelled 排除：冲突与潜在都不出，已取消条目不渲染', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        // 若不被排除，它会是第二个同日已确认 → 冲突
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'cancelled', confirmed_at: '2026-03-02'}),
        'SCH-050-01': coordView({package_id: 'PKG-050', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
        // 若不被排除，它（窗口 [3,5]）会与 SCH-050-01（窗口 [2,4]）重叠 → 潜在
        'SCH-060-01': coordView({package_id: 'PKG-060', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'cancelled'}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(bodyText()).not.toContain('冲突：同日双现场');
    expect(bodyText()).not.toContain('潜在：窗口重叠（未确认）');
    expect(bodyText()).not.toContain('SCH-040-01');
    expect(bodyText()).not.toContain('SCH-060-01');
    panel.hide();
  });

  // Codex 一审 blocking（PR #220）：owner_role 是协调组织者（谁去约人），不是到场参与者。
  // 现场占用只认 required_roles（与模块 detectCoordinationConflicts 同一口径）——两条都由
  // 设计师组织、required_roles 只有施工方的 onsite 预约，不得给设计师算出同日双现场/窗口重叠；
  // 但组织者仍要在自己的待确认协调列表里看到自己要约的条目。
  it('组织者不进现场占用：owner_role 不在 required_roles 时无冲突/潜在徽标，但进待确认列表', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['设计师', '施工方']})],
      next_actions: [],
      coordination: {
        // 同日 + 都由设计师组织 + 参与者都只有施工方：旧口径会给设计师算「同日双现场」
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-030-02': coordView({package_id: 'PKG-030', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '李四', org: '乙公司'}}),
        // 未确认 + 窗口重叠：旧口径会给设计师算「潜在」
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', status: 'pending_invite'}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    // 设计师（仅组织者）：没有任何徽标
    const designer = roleGroup('设计师');
    expect(designer.querySelector('.rw-badge')).toBeNull();
    expect(sectionOf('设计师', 'conflicts').textContent).toContain('没有现场冲突');
    // 但组织者仍看到自己要约的条目（待确认协调节）
    expect(sectionOf('设计师', 'coordination').textContent).toContain('SCH-040-01');
    // 施工方（明确参与者）：照常出同日双现场冲突徽标
    const badge = sectionOf('施工方', 'conflicts').querySelector('.rw-badge[data-level="conflict"]') as HTMLElement;
    expect(badge.textContent).toContain('冲突：同日双现场');
    expect(badge.textContent).toContain('2 条｜同日 2026-03-02');
    expect(sectionOf('施工方', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    panel.hide();
  });

  // 任务书 §4-8 / D5：点行只写 selection；面板没有 onHighlight 钩子、不拉其他端点。
  it('点项写 selection 且不调 onHighlight（构造时只传 selection）', async () => {
    const mock = stubFetch(snapshotView());
    const selection = new ScheduleSelectionStore();
    const setSpy = vi.spyOn(selection, 'set');
    const panel = new RoleWorkbenchPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    (document.querySelector('.rw-check-row[data-check-id="SCH-010-01"]') as HTMLElement).click();
    expect(setSpy).toHaveBeenLastCalledWith({packageId: 'PKG-010', checkId: 'SCH-010-01'});
    expect(selection.get()).toEqual({packageId: 'PKG-010', checkId: 'SCH-010-01'});
    expect((document.querySelector('.rw-check-row[data-check-id="SCH-010-01"]') as HTMLElement).dataset.active).toBe('true');

    (document.querySelector('.rw-coord-row[data-sch-id="SCH-020-02"]') as HTMLElement).click();
    expect(setSpy).toHaveBeenLastCalledWith({packageId: 'PKG-020', checkId: 'SCH-020-02'});
    expect(selection.get()).toEqual({packageId: 'PKG-020', checkId: 'SCH-020-02'});
    expect(setSpy).toHaveBeenCalledTimes(2);

    // 面板没有 3D 高亮钩子，也没有任何高亮入口；只拉 /api/schedule/state
    expect((panel as unknown as {onHighlight?: unknown}).onHighlight).toBeUndefined();
    expect(document.querySelector('#role-workbench-panel [id*="highlight"]')).toBeNull();
    for (const args of mock.mock.calls) {
      expect(String(args[0])).toBe('/api/schedule/state');
    }
    panel.hide();
  });

  // 任务书 §4-9 / §1.1：空快照 / 503 / coordination 缺失三态文案各不相同。
  it('空快照：明确「未取得」文案，不渲染任何分组', async () => {
    stubFetch(null);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#rw-empty')).toBeTruthy());

    expect(bodyText()).toContain('未取得角色工作台数据');
    expect(bodyText()).toContain('不渲染来自坏快照的分组');
    expect(document.querySelector('.rw-role')).toBeNull();
    panel.hide();
  });

  it('503：明确「取数失败」文案（HTTP 503 + 服务端原因），不渲染任何分组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({error: 'schedule control invalid: 1 issue(s)', issues: ['PKG-010: bad constraint']}),
    })) as never);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#rw-error')).toBeTruthy());

    const text = bodyText();
    expect(text).toContain('取数失败');
    expect(text).toContain('HTTP 503');
    expect(text).toContain('schedule control invalid');
    expect(text).toContain('PKG-010: bad constraint');
    expect(document.querySelector('.rw-role')).toBeNull();
    panel.hide();
  });

  it('coordination 缺失：节级空文案，待办检查分组照常渲染（不置空整面板）', async () => {
    stubFetch(snapshotView({coordination: undefined}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    // 待办检查只依赖 packages：coordination 缺失不连带删掉有用的分组
    expect(document.querySelector('.rw-role')).toBeTruthy();
    expect(bodyText()).toContain('没有协调数据（coordination 键缺失/为空）：本节列不出条目');
    expect(bodyText()).toContain('没有协调数据（coordination 键缺失/为空）：现场冲突无法判断');
    expect(document.querySelector('.rw-coord-row')).toBeNull();
    expect(document.querySelector('.rw-conflict-row')).toBeNull();
    // 试点水印仍在（固定文案）
    expect(bodyText()).toContain('试点数据：仅登记了 coordination 的 SCH 出现，未登记不代表无协调');
    panel.hide();
  });

  // 任务书 §4-10：角色名 / 包名 / 检查名里的 hostile 字符串不变形、不执行。
  it('转义：角色名 / 包名 / 检查名带 <script> 不变形', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({
        name: '<img src=x onerror="window.__rw_pwned=1">瓦工铺贴',
        owner_roles: ['<script>window.__rw_pwned=1</script>'],
        checks: [checkView({id: 'SCH-010-01', item: '<script>window.__rw_pwned2=1</script>拆除交底'})],
      })],
      next_actions: [],
      coordination: {
        'SCH-011-01': coordView({
          package_id: 'PKG-010',
          required_roles: ['<script>window.__rw_pwned=1</script>'],
          owner_role: '<script>window.__rw_pwned=1</script>',
        }),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    const body = document.querySelector('#role-workbench-body') as HTMLElement;
    expect(body.querySelector('img')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
    expect((window as unknown as {__rw_pwned?: number}).__rw_pwned).toBeUndefined();
    expect((window as unknown as {__rw_pwned2?: number}).__rw_pwned2).toBeUndefined();
    expect(bodyText()).toContain('瓦工铺贴');
    expect(bodyText()).toContain('拆除交底');
    // 角色名以文本形态出现（被转义，不是 DOM 节点）
    expect(bodyText()).toContain('<script>window.__rw_pwned=1</script>');
    panel.hide();
  });

  // 任务书 §4-11 / §1.1：≤700px 单列退化（stub clientWidth，照 GanttPanel 测）。
  it('≤700px：单列退化，行改块级布局，点击仍写 selection', async () => {
    const restore = stubClientWidth(334);
    try {
      stubFetch(snapshotView());
      const selection = new ScheduleSelectionStore();
      const panel = new RoleWorkbenchPanel(selection);
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

      expect((document.querySelector('#rw-groups') as HTMLElement).dataset.rwNarrow).toBe('true');
      expect(bodyText()).toContain('窄屏（≤700px）：单列列表');
      const row = document.querySelector('.rw-check-row[data-check-id="SCH-010-01"]') as HTMLElement;
      expect(row.style.display).toBe('block');
      row.click();
      expect(selection.get()).toEqual({packageId: 'PKG-010', checkId: 'SCH-010-01'});
      panel.hide();
    } finally {
      restore();
    }
  });

  // 任务书 §1.1 / §16：只读快照——渲染 + 点击前后 coordination 与 schedule 逐字节不变。
  it('只读快照：渲染 + 点击前后 coordination / schedule JSON 逐字节不变', async () => {
    const snap = snapshotView();
    const beforeCoordination = JSON.stringify(snap.coordination);
    const beforeSchedule = JSON.stringify(snap.schedule);
    stubFetch(snap);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    (document.querySelector('.rw-check-row[data-check-id="SCH-010-01"]') as HTMLElement).click();
    (document.querySelector('.rw-coord-row[data-sch-id="SCH-020-02"]') as HTMLElement).click();
    await panel.refresh();
    panel.hide();

    expect(JSON.stringify(snap.coordination)).toBe(beforeCoordination);
    expect(JSON.stringify(snap.schedule)).toBe(beforeSchedule);
  });

  // 任务书 §1.4：snapshot.schedule 缺失 → 不出潜在徽标，出明确文字。
  it('缺排程投影：不出潜在徽标，出「缺排程投影，潜在窗口无法判断」', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      schedule: undefined,
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'invited'}),
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(sectionOf('业主', 'conflicts').textContent).toContain('缺排程投影，潜在窗口无法判断');
    panel.hide();
  });

  // 任务书 §1.1：每节行数上限 8，超出「等 N 条」，完整列表进 title 属性。
  it('行数上限：每节最多 8 行，超出「等 N 条」，完整列表进 title', async () => {
    const manyChecks = Array.from({length: 10}, (_unused, index) =>
      checkView({id: `SCH-090-${String(index + 1).padStart(2, '0')}`, item: `木工检查 ${index + 1}`}));
    stubFetch(snapshotView({
      packages: [
        pkgView({
          id: 'PKG-090',
          name: '木作安装',
          sequence: 90,
          owner_roles: ['施工方'],
          checks: manyChecks,
        }),
      ],
      next_actions: [],
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    const checks = sectionOf('施工方', 'checks');
    // PKG-090 十项未完成检查，只渲染 8 行
    expect(checks.querySelectorAll('.rw-check-row')).toHaveLength(8);
    expect(checks.textContent).toContain('等 10 条');
    // 完整列表在 title 里（含被截断的 SCH-090-10）
    expect(checks.title).toContain('SCH-090-10');
    expect(checks.title).toContain('木工检查 10');
    panel.hide();
  });

  // 任务书 §1.1/§1.4：冲突节的行数上限同样按 SCH 行计（簇数组不是行数组）。
  it('冲突节行数上限：跨簇按 SCH 行截断，「等 N 条」+ title 全量', async () => {
    const coordination: Record<string, ScheduleCoordinationView> = {};
    for (let day = 1; day <= 6; day += 1) {
      for (let slot = 1; slot <= 2; slot += 1) {
        coordination[`SCH-1${day}0-0${slot}`] = coordView({
          package_id: `PKG-1${day}0-${slot}`,
          required_roles: ['业主'],
          owner_role: '业主',
          mode: 'onsite',
          status: 'confirmed',
          confirmed_at: `2026-03-0${day}`,
          actor: {name: `工人${day}${slot}`, org: null},
        });
      }
    }
    stubFetch(snapshotView({next_actions: [], coordination}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const conflicts = sectionOf('业主', 'conflicts');
    // 6 个同日簇 × 2 条 = 12 行，只渲染 8 行；前 4 个簇完整可见，后 2 个簇整体进 title
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(8);
    expect(conflicts.querySelectorAll('.rw-cluster')).toHaveLength(4);
    expect(conflicts.textContent).toContain('等 12 条');
    expect(conflicts.title).toContain('SCH-160-02');
    expect(conflicts.title).toContain('冲突：同日双现场');
    panel.hide();
  });

  it('show/hide/isVisible 状态正确', async () => {
    stubFetch(snapshotView());
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());
    expect(panel.isVisible()).toBe(true);
    expect((document.querySelector('#role-workbench-panel') as HTMLElement).style.display).toBe('block');
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#role-workbench-panel') as HTMLElement).style.display).toBe('none');
  });
});
