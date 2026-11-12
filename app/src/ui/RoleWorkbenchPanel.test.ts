import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoleWorkbenchPanel } from './RoleWorkbenchPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type {
  ScheduleCheckView,
  ScheduleCoordinationView,
  SchedulePackageView,
  ScheduleSnapshot,
} from '@shared/schedule-state';
import type { CoordinationConflictReport, CoordinationOverlap } from '@shared/schedule-projection';

// 合成快照覆盖任务书 §4 的 11 条 + S3.2 收尾后的冲突口径：
//  - PKG-010 带四种 audit_status（未登记 / failed / passed / waived）对照「只列未完成」；
//  - 默认 coordination 五条覆盖三态入场（pending_invite/invited/unassigned）与
//    不入场（confirmed/cancelled）；
//  - 现场冲突**只从 `coordination_conflicts` 夹具来**（S3.2：面板侧分类已删，
//    不再用 snapshot.schedule 造冲突，也不再给夹具带 schedule 键）；
//  - 默认无锚点：ordinals[].date 全 null，本面板不造年月日（confirmed_at 是证据
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

/** 报告里的一簇（契约形状 {role, sch_ids, reason}；sch_ids 是 SCH id 列表）。 */
function overlap(role: string, schIds: Array<string | null>, reason: string): CoordinationOverlap {
  // schIds 允许喂坏成员（null/空串）：面板对报告只做运行时形状守卫，测试要能构造坏形状。
  return {role, sch_ids: schIds as string[], reason};
}

/**
 * 快照夹具。`coordination_conflicts` 是 S3.2 新键（声明在 shared/schedule-state.ts，
 * 类型 = CoordinationConflictReport）；本测要覆盖「键缺失 / 形状不符」两种面板必须扛住的
 * 形态，故把该键从 Partial<ScheduleSnapshot> 里摘掉再放宽到 unknown（只在夹具里放宽，
 * 被测代码仍按声明类型读）。
 */
type SnapshotOverrides = Omit<Partial<ScheduleSnapshot>, 'coordination_conflicts'> & {
  coordination_conflicts?: unknown;
};

function snapshotView(overrides: SnapshotOverrides = {}): ScheduleSnapshot {
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
    // 默认报告：无冲突、无潜在重叠（现代服务端形态）。
    coordination_conflicts: {conflicts: [], potential: []},
    ...overrides,
  } as unknown as ScheduleSnapshot;
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

const toggleOf = (role: string, section: string): HTMLButtonElement | null =>
  sectionOf(role, section).querySelector('button[data-rw-toggle]') as HTMLButtonElement | null;

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
    // 表头点名数据来源键（S3.2 起 conflicts 来自 coordination_conflicts，不再是面板自算）
    expect(bodyText()).toContain('coordination_conflicts');
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
    // cancelled / confirmed 两节都不出现（报告为空，见后续用例）
    expect(bodyText()).not.toContain('SCH-040-01');
    expect(bodyText()).not.toContain('SCH-030-01');
    panel.hide();
  });

  // S3.2 契约：键缺失 = 「不知道」——旧服务端/旧快照不带这个键时不许当「无冲突」。
  it('冲突键缺失：出「冲突无法检测（…服务端可能仍是旧版）」，不出徽标', async () => {
    const snap = snapshotView();
    delete (snap as {coordination_conflicts?: unknown}).coordination_conflicts;
    stubFetch(snap);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(sectionOf('业主', 'conflicts').textContent)
      .toContain('冲突无法检测（快照未带 coordination_conflicts，服务端可能仍是旧版）');
    expect(document.querySelector('.rw-badge')).toBeNull();
    panel.hide();
  });

  // S3.2 契约：键在但两数组为空 = 「无冲突、无潜在重叠」（明确的无，不是不知道）。
  it('冲突键在且两数组为空：出「无冲突、无潜在窗口重叠」', async () => {
    stubFetch(snapshotView({coordination_conflicts: {conflicts: [], potential: []}}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(sectionOf('业主', 'conflicts').textContent).toContain('无冲突、无潜在窗口重叠');
    expect(sectionOf('业主', 'conflicts').textContent).not.toContain('冲突无法检测');
    expect(document.querySelector('.rw-badge')).toBeNull();
    panel.hide();
  });

  // fail-closed：键在但值不是 {conflicts, potential} 两个数组 → 与「缺失」同归「无法检测」，
  // 绝不能被读成「无冲突」。
  it('冲突键形状不符：归「冲突无法检测」，不读成「无冲突」', async () => {
    stubFetch(snapshotView({coordination_conflicts: {conflicts: 'oops'}}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    const conflicts = sectionOf('业主', 'conflicts').textContent ?? '';
    expect(conflicts).toContain('冲突无法检测（coordination_conflicts 形状不符');
    expect(conflicts).not.toContain('无冲突、无潜在窗口重叠');
    expect(document.querySelector('.rw-badge')).toBeNull();
    panel.hide();
  });

  // S3.2 契约：确定冲突簇 = 服务端报告里的一簇（面板不做分类），徽标文字由面板按级别配，
  // reason 原样透传；簇内每个 SCH 仍可点 → selection.set({packageId, checkId: SCH id})。
  it('确定冲突簇：徽标「确定冲突」+ reason 原文，簇内每个 SCH 可点写 selection', async () => {
    const selection = new ScheduleSelectionStore();
    const setSpy = vi.spyOn(selection, 'set');
    const reason = '同角色已确认预约重叠（同一天两处现场）：SCH-030-01、SCH-040-01 均在 2026-03-02（第 7 工作日）';
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02T09:30:00', actor: {name: '李四', org: '乙公司'}}),
      },
      coordination_conflicts: {conflicts: [overlap('业主', ['SCH-030-01', 'SCH-040-01'], reason)], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="conflict"]') as HTMLElement;
    expect(badge.textContent).toContain('确定冲突');
    expect(badge.textContent).toContain('2 条');
    expect(badge.textContent).toContain(reason); // reason 原文，不重写、不折叠
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    expect(conflicts.textContent).toContain('确认登记日 2026-03-02');
    expect(conflicts.textContent).toContain('确认登记日 2026-03-02T09:30:00');
    expect(document.querySelector('.rw-badge[data-level="potential"]')).toBeNull();

    (conflicts.querySelector('.rw-conflict-row[data-sch-id="SCH-040-01"]') as HTMLElement).click();
    expect(setSpy).toHaveBeenLastCalledWith({packageId: 'PKG-040', checkId: 'SCH-040-01'});
    (sectionOf('业主', 'conflicts').querySelector('.rw-conflict-row[data-sch-id="SCH-030-01"]') as HTMLElement).click();
    expect(setSpy).toHaveBeenLastCalledWith({packageId: 'PKG-030', checkId: 'SCH-030-01'});
    expect(selection.get()).toEqual({packageId: 'PKG-030', checkId: 'SCH-030-01'});
    panel.hide();
  });

  // S3.2 契约：潜在重叠簇（尚未确认预约）+ 面板不再读 snapshot.schedule
  // （装上会抛的 getter：一旦被读，渲染失败、waitFor 超时，测试当场红）。
  it('潜在重叠簇：徽标「潜在重叠（尚未确认预约）」+ reason；面板不读 snapshot.schedule', async () => {
    const reason = '同角色潜在窗口重叠（尚未确认预约，不是确定冲突）：SCH-030-01 第 5–6 工作日、SCH-040-01 第 6–7 工作日';
    const snap = snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'invited', actor: {name: '王工', org: null}}),
      },
      coordination_conflicts: {conflicts: [], potential: [overlap('业主', ['SCH-030-01', 'SCH-040-01'], reason)]},
    });
    Object.defineProperty(snap, 'schedule', {
      configurable: true,
      get: () => {
        throw new Error('面板不得再读 snapshot.schedule（S3.2 起潜在窗口由服务端报告给出）');
      },
    });
    stubFetch(snap);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="potential"]') as HTMLElement;
    expect(badge.textContent).toContain('潜在重叠（尚未确认预约）');
    expect(badge.textContent).toContain(reason);
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    expect(document.querySelector('.rw-badge[data-level="conflict"]')).toBeNull();
    // 潜在簇的行不再有面板自算的窗口字段（窗口信息只在服务端 reason 原文里）
    expect(conflicts.textContent).not.toContain('窗口 第');
    panel.hide();
  });

  // Codex 二审 minor（2026-11-12 修）：报告里非字符串/空串的成员编号不得被静默过滤——
  // 徽标按报告规模（含非法成员）、非法条数显形，合法成员照常可点。
  it('报告成员编号非法：徽标按报告规模、非法条数显形，合法成员仍可点', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite'}),
      },
      coordination_conflicts: {
        conflicts: [],
        potential: [overlap('业主', ['SCH-030-01', null, ''], '同角色潜在窗口重叠（尚未确认预约，不是确定冲突）：SCH-030-01 第 5–6 工作日')],
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="potential"]') as HTMLElement;
    expect(badge.textContent).toContain('3 条'); // 报告规模 = 3（含 2 条非法），不缩水成 1
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.textContent).toContain('2 条成员编号非法，已跳过');
    expect(conflicts.querySelectorAll('.rw-conflict-row')).toHaveLength(1);
    expect(conflicts.querySelector('.rw-conflict-row[data-sch-id="SCH-030-01"]')).toBeTruthy();
    panel.hide();
  });

  // S3.2：面板不再分类——报告为空时，notify 同日两条已确认、confirmed+未确认混合
  // 都造不出徽标（这些分级口径现在单住在服务端 detectCoordinationConflicts）。
  it('面板不自算：报告为空时 notify 与 confirmed+未确认混合都造不出徽标', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'notify', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-030-02': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'notify', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '李四', org: '乙公司'}}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '王五', org: null}}),
        'SCH-040-02': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
      },
      coordination_conflicts: {conflicts: [], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(bodyText()).not.toContain('确定冲突');
    expect(bodyText()).not.toContain('潜在重叠');
    expect(sectionOf('业主', 'conflicts').textContent).toContain('无冲突、无潜在窗口重叠');
    panel.hide();
  });

  // cancelled 排除（服务端口径）：既不出徽标，也不渲染条目本身。
  it('cancelled 条目：不进徽标也不渲染（报告为空）', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'cancelled', confirmed_at: '2026-03-02'}),
      },
      coordination_conflicts: {conflicts: [], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('.rw-badge')).toBeNull();
    expect(bodyText()).not.toContain('SCH-040-01');
    expect(bodyText()).not.toContain('确定冲突');
    panel.hide();
  });

  // Codex 一审 blocking（PR #220）口径现在单住在服务端：占用只认 required_roles，
  // owner_role（协调组织者）不算到场。面板只渲染报告——报告里没有设计师的簇，
  // 设计师组就只出「无冲突」文字；但组织者仍要在自己的待确认协调列表里看到要约条目。
  it('占用口径由服务端决定：组织者不进簇，但仍看到自己要约的条目', async () => {
    const reason = '同角色已确认预约重叠（同一天两处现场）：SCH-030-01、SCH-030-02 均在 2026-03-02（第 7 工作日）';
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['设计师', '施工方']})],
      next_actions: [],
      coordination: {
        // 同日 + 都由设计师组织 + 参与者都只有施工方：旧面板侧口径会给设计师算「同日双现场」
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
        'SCH-030-02': coordView({package_id: 'PKG-030', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', lead_time_workdays: 3, status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '李四', org: '乙公司'}}),
        'SCH-040-01': coordView({package_id: 'PKG-040', required_roles: ['施工方'], owner_role: '设计师', mode: 'onsite', status: 'pending_invite'}),
      },
      coordination_conflicts: {conflicts: [overlap('施工方', ['SCH-030-01', 'SCH-030-02'], reason)], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    // 设计师（仅组织者）：报告里没有它的簇 → 无徽标
    expect(roleGroup('设计师').querySelector('.rw-badge')).toBeNull();
    expect(sectionOf('设计师', 'conflicts').textContent).toContain('无冲突、无潜在窗口重叠');
    // 但组织者仍看到自己要约的条目（待确认协调节）
    expect(sectionOf('设计师', 'coordination').textContent).toContain('SCH-040-01');
    // 施工方（required_roles）：报告给的簇照常渲染
    const badge = sectionOf('施工方', 'conflicts').querySelector('.rw-badge[data-level="conflict"]') as HTMLElement;
    expect(badge.textContent).toContain('确定冲突');
    expect(sectionOf('施工方', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    panel.hide();
  });

  // S3.2 low 收口：coordination 条目形状守卫（null / 数组 / 非对象 → 跳过 + 计数），
  // 面板不抛错，合法条目照常渲染。
  it('coordination 形状非法条目：跳过 + 计数文案，面板不抛错、其余条目照常', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': null,
        'SCH-030-02': ['not', 'an', 'entry'],
        'SCH-030-03': 'garbage',
        'SCH-030-04': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'invited', actor: {name: '王工', org: null}}),
      } as unknown as Record<string, ScheduleCoordinationView>,
      coordination_conflicts: {conflicts: [], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    expect(() => panel.show()).not.toThrow();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(document.querySelector('#rw-shape-note')).toBeTruthy();
    expect(bodyText()).toContain('3 条协调项形状非法，已跳过（快照版本不符）');
    // 合法条目照常渲染
    expect(sectionOf('业主', 'coordination').textContent).toContain('SCH-030-04');
    expect(sectionOf('业主', 'coordination').textContent).toContain('已邀请');
    // 非法条目的 id 不出现（跳过，不是渲染半条）
    expect(bodyText()).not.toContain('SCH-030-01');
    expect(document.querySelector('.rw-badge')).toBeNull();
    panel.hide();
  });

  // S3.2 low 收口：报告簇形状守卫同理（形状不符的簇跳过 + 计数），合法簇照常。
  it('报告簇形状非法：跳过 + 计数文案，合法簇照常渲染', async () => {
    const reason = '同角色潜在窗口重叠（尚未确认预约，不是确定冲突）：SCH-030-01 第 5–6 工作日、SCH-030-02 第 6–7 工作日';
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'pending_invite'}),
        'SCH-030-02': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'invited', actor: {name: '王工', org: null}}),
      },
      coordination_conflicts: {
        conflicts: ['not-a-cluster', null],
        potential: [overlap('业主', ['SCH-030-01', 'SCH-030-02'], reason)],
      },
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(bodyText()).toContain('2 簇冲突报告形状非法，已跳过（快照版本不符）');
    const badge = document.querySelector('.rw-badge[data-level="potential"]') as HTMLElement;
    expect(badge.textContent).toContain('潜在重叠（尚未确认预约）');
    expect(badge.textContent).toContain(reason);
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(2);
    panel.hide();
  });

  // Codex 三审 minor（2026-11-12 修）：有簇被跳过时空态不得同时说「无冲突」——
  // 报告不完整 → 结论只能是「判不了」，一个判定点（conflictShapeSkipped > 0）改判。
  it('全部簇形状非法：空态说「报告不完整」，不说「无冲突」', async () => {
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite'}),
      },
      coordination_conflicts: {conflicts: [null], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-role')).toBeTruthy());

    expect(bodyText()).toContain('1 簇冲突报告形状非法，已跳过（快照版本不符）');
    const conflicts = sectionOf('业主', 'conflicts');
    expect(conflicts.textContent).toContain('冲突报告不完整：1 簇形状非法已跳过（快照版本不符），无法判断是否还有冲突');
    expect(conflicts.textContent).not.toContain('无冲突、无潜在窗口重叠');
    expect(document.querySelector('.rw-badge')).toBeNull();
    panel.hide();
  });

  // 快照自相矛盾（报告点名的 SCH 不在 coordination 里）：徽标按报告规模照出 + 说明差额，
  // 不静默丢簇、也不把「解析不到」当成「没有这条协调」。
  it('报告点名的 SCH 在 coordination 里没有条目：徽标 + 说明行，面板不抛错', async () => {
    const reason = '同角色已确认预约重叠（同一天两处现场）：SCH-030-01、SCH-999-99 均在 2026-03-02（第 7 工作日）';
    stubFetch(snapshotView({
      packages: [pkgView({id: 'PKG-030', name: '瓦工铺贴', sequence: 30, owner_roles: ['业主']})],
      next_actions: [],
      coordination: {
        'SCH-030-01': coordView({package_id: 'PKG-030', required_roles: ['业主'], owner_role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-03-02', actor: {name: '张三', org: '甲公司'}}),
      },
      coordination_conflicts: {conflicts: [overlap('业主', ['SCH-030-01', 'SCH-999-99'], reason)], potential: []},
    }));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    const badge = document.querySelector('.rw-badge[data-level="conflict"]') as HTMLElement;
    expect(badge.textContent).toContain('确定冲突');
    expect(badge.textContent).toContain('（2 条）'); // 徽标口径 = 服务端说的簇规模
    expect(badge.textContent).toContain(reason);
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(1);
    // 措辞随 Codex 二审 minor 拆分：非法编号与「解析不到」分开计数（这里只有后者）
    expect((document.querySelector('.rw-cluster-note') as HTMLElement).textContent)
      .toContain('另有 1 条在本快照 coordination 里没有条目（快照版本不符）');
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

  it('coordination 缺失：协调节级空文案，待办检查照常渲染（不置空整面板）', async () => {
    stubFetch(snapshotView({coordination: undefined}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    // 待办检查只依赖 packages：coordination 缺失不连带删掉有用的分组
    expect(document.querySelector('.rw-role')).toBeTruthy();
    expect(bodyText()).toContain('没有协调数据（coordination 键缺失/为空）：本节列不出条目');
    expect(document.querySelector('.rw-coord-row')).toBeNull();
    expect(document.querySelector('.rw-conflict-row')).toBeNull();
    // 冲突节的文字现在由报告（而非 coordination）决定：夹具报告为空数组 →「无冲突、无潜在窗口重叠」。
    // 旧文案「没有协调数据…：现场冲突无法判断」随面板侧分类一起退场。
    expect(sectionOf('设计师', 'conflicts').textContent).toContain('无冲突、无潜在窗口重叠');
    expect(bodyText()).not.toContain('现场冲突无法判断');
    // 试点水印仍在（固定文案）
    expect(bodyText()).toContain('试点数据：仅登记了 coordination 的 SCH 出现，未登记不代表无协调');
    panel.hide();
  });

  // 任务书 §4-10：角色名 / 包名 / 检查名 / 报告 reason 里的 hostile 字符串不变形、不执行。
  it('转义：角色名 / 包名 / 检查名 / 报告 reason 带 <script> 不变形', async () => {
    const hostile = '<script>window.__rw_pwned=1</script>';
    stubFetch(snapshotView({
      packages: [pkgView({
        name: '<img src=x onerror="window.__rw_pwned=1">瓦工铺贴',
        owner_roles: [hostile],
        checks: [checkView({id: 'SCH-010-01', item: '<script>window.__rw_pwned2=1</script>拆除交底'})],
      })],
      next_actions: [],
      coordination: {
        'SCH-011-01': coordView({
          package_id: 'PKG-010',
          required_roles: [hostile],
          owner_role: hostile,
        }),
      },
      coordination_conflicts: {
        conflicts: [overlap(hostile, ['SCH-011-01'], '<script>window.__rw_pwned3=1</script>同角色已确认预约重叠')],
        potential: [],
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
    expect((window as unknown as {__rw_pwned3?: number}).__rw_pwned3).toBeUndefined();
    expect(bodyText()).toContain('瓦工铺贴');
    expect(bodyText()).toContain('拆除交底');
    // 角色名以文本形态出现（被转义，不是 DOM 节点）；徽标 reason 同样原文但不执行
    expect(bodyText()).toContain(hostile);
    expect(bodyText()).toContain('<script>window.__rw_pwned3=1</script>同角色已确认预约重叠');
    expect(document.querySelectorAll('.rw-conflict-row')).toHaveLength(1);
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

  // Codex 二审 major：截断后的可操作入口在窄屏同样可用——真按钮、文字自带，不依赖 title。
  it('窄屏下截断入口可用：按钮文字自带、无 title，点击后全量', async () => {
    const restore = stubClientWidth(334);
    try {
      const manyChecks = Array.from({length: 9}, (_unused, index) =>
        checkView({id: `SCH-090-${String(index + 1).padStart(2, '0')}`, item: `木工检查 ${index + 1}`}));
      stubFetch(snapshotView({
        packages: [pkgView({id: 'PKG-090', name: '木作安装', sequence: 90, owner_roles: ['施工方'], checks: manyChecks})],
        next_actions: [],
      }));
      const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
      panel.show();
      await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

      expect((document.querySelector('#rw-groups') as HTMLElement).dataset.rwNarrow).toBe('true');
      const expand = toggleOf('施工方', 'checks') as HTMLButtonElement;
      expect(expand.tagName).toBe('BUTTON');
      expect(expand.textContent).toContain('查看全部 9 条');
      expect(expand.getAttribute('title')).toBeNull(); // 入口不靠 title
      expand.click();
      expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(9);
      panel.hide();
    } finally {
      restore();
    }
  });

  // Codex 二审 major：每节 8 条上限保留 + 可操作入口（展开 → 全量 + 收起），
  // 展开态在 re-render（点选、选中态订阅回调）后保持。
  it('每节 8 条上限：折叠 8 行 +「等 N 条」+ 展开入口；展开全量可点、再点收起回 8 行', async () => {
    const manyChecks = Array.from({length: 10}, (_unused, index) =>
      checkView({id: `SCH-090-${String(index + 1).padStart(2, '0')}`, item: `木工检查 ${index + 1}`}));
    const mock = stubFetch(snapshotView({
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
    const selection = new ScheduleSelectionStore();
    const panel = new RoleWorkbenchPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    // 折叠态：8 行 +「等 10 条」+ 入口；全量仍在 title（既有通道保留）
    expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(8);
    expect(sectionOf('施工方', 'checks').textContent).toContain('等 10 条');
    expect(sectionOf('施工方', 'checks').title).toContain('SCH-090-10');
    expect(sectionOf('施工方', 'checks').title).toContain('木工检查 10');
    const expand = toggleOf('施工方', 'checks') as HTMLButtonElement;
    expect(expand.textContent).toContain('查看全部 10 条');
    expect(expand.dataset.expanded).toBe('false');

    // 展开：全量 10 行、条目可点、按钮变「收起」；展开动作本身不写选中态
    expand.click();
    expect(selection.get()).toEqual({packageId: null, checkId: null});
    expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(10);
    expect(sectionOf('施工方', 'checks').textContent).not.toContain('等 10 条');
    expect((toggleOf('施工方', 'checks') as HTMLButtonElement).textContent).toContain('收起');

    // 展开态在点选条目（re-render + 选中态订阅回调）后保持
    (sectionOf('施工方', 'checks').querySelector('.rw-check-row[data-check-id="SCH-090-10"]') as HTMLElement).click();
    expect(selection.get()).toEqual({packageId: 'PKG-090', checkId: 'SCH-090-10'});
    expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(10);
    expect((toggleOf('施工方', 'checks') as HTMLButtonElement).textContent).toContain('收起');

    // 收起：回 8 行 + 入口回来
    (toggleOf('施工方', 'checks') as HTMLButtonElement).click();
    expect(sectionOf('施工方', 'checks').querySelectorAll('.rw-check-row')).toHaveLength(8);
    expect(sectionOf('施工方', 'checks').textContent).toContain('等 10 条');
    expect((toggleOf('施工方', 'checks') as HTMLButtonElement).textContent).toContain('查看全部 10 条');
    // 展开/收起只是本地 UI 状态：不拉任何端点（fetch 仍只有首次快照那一次）
    expect(mock.mock.calls).toHaveLength(1);
    panel.hide();
  });

  // 任务书 §1.1/§1.4：冲突节的行数上限同样按 SCH 行计（簇数组不是行数组），
  // 展开入口同样在场（截断的那部分簇整块折叠，不出一排没有行的空徽标）。
  it('冲突节行数上限：跨簇按 SCH 行折叠 + 展开入口 → 全量 12 行 / 6 簇', async () => {
    const coordination: Record<string, ScheduleCoordinationView> = {};
    const conflicts: CoordinationOverlap[] = [];
    for (let day = 1; day <= 6; day += 1) {
      const schIds: string[] = [];
      for (let slot = 1; slot <= 2; slot += 1) {
        const schId = `SCH-1${day}0-0${slot}`;
        schIds.push(schId);
        coordination[schId] = coordView({
          package_id: `PKG-1${day}0-${slot}`,
          required_roles: ['业主'],
          owner_role: '业主',
          mode: 'onsite',
          status: 'confirmed',
          confirmed_at: `2026-03-0${day}`,
          actor: {name: `工人${day}${slot}`, org: null},
        });
      }
      conflicts.push(overlap('业主', schIds, `同角色已确认预约重叠（同一天两处现场）：${schIds.join('、')} 均在 2026-03-0${day}（第 ${day} 工作日）`));
    }
    stubFetch(snapshotView({next_actions: [], coordination, coordination_conflicts: {conflicts, potential: []}}));
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-cluster')).toBeTruthy());

    // 折叠：6 个同日簇 × 2 条 = 12 行，只渲染 8 行；前 4 个簇完整可见，后 2 个簇整体折叠
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(8);
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-cluster')).toHaveLength(4);
    expect(sectionOf('业主', 'conflicts').textContent).toContain('等 12 条');
    expect(sectionOf('业主', 'conflicts').title).toContain('SCH-160-02');
    expect(sectionOf('业主', 'conflicts').title).toContain('确定冲突');
    const expand = toggleOf('业主', 'conflicts') as HTMLButtonElement;
    expect(expand.textContent).toContain('查看全部 12 条');

    expand.click();
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-conflict-row')).toHaveLength(12);
    expect(sectionOf('业主', 'conflicts').querySelectorAll('.rw-cluster')).toHaveLength(6);
    expect((toggleOf('业主', 'conflicts') as HTMLButtonElement).textContent).toContain('收起');
    panel.hide();
  });

  // 任务书 §1.1 / §16：只读快照——渲染 + 点击 + 刷新前后 coordination /
  // coordination_conflicts 逐字节不变（S3.2 起面板不消费 snapshot.schedule）。
  it('只读快照：渲染 + 点击 + 刷新前后 coordination / coordination_conflicts 逐字节不变', async () => {
    const report: CoordinationConflictReport = {
      conflicts: [],
      potential: [overlap('业主', ['SCH-011-01', 'SCH-020-02'], '同角色潜在窗口重叠（尚未确认预约，不是确定冲突）：SCH-011-01 第 2–4 工作日、SCH-020-02 第 3–5 工作日')],
    };
    const snap = snapshotView({coordination_conflicts: report});
    const beforeCoordination = JSON.stringify(snap.coordination);
    const beforeConflicts = JSON.stringify(report);
    stubFetch(snap);
    const panel = new RoleWorkbenchPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('.rw-check-row')).toBeTruthy());

    (document.querySelector('.rw-check-row[data-check-id="SCH-010-01"]') as HTMLElement).click();
    (document.querySelector('.rw-coord-row[data-sch-id="SCH-020-02"]') as HTMLElement).click();
    (document.querySelector('.rw-conflict-row[data-sch-id="SCH-011-01"]') as HTMLElement).click();
    await panel.refresh();
    panel.hide();

    expect(JSON.stringify(snap.coordination)).toBe(beforeCoordination);
    expect(JSON.stringify(report)).toBe(beforeConflicts);
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
