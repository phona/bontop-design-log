import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchedulePanel } from './SchedulePanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type { ScheduleSnapshot, SchedulePackageView } from '@shared/schedule-state';

// 合成快照：≥3 包含 PKG-900、next_actions ≥3、decision_gates.open 1 条。
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
    dependencies: [],
    owner_roles: ['施工方'],
    payment_gate: 'GATE-010-A',
    gate_label: '付款门槛',
    gate_status: 'pending',
    blockers: [
      {id: 'BLK-量房', item: '量房数据', status: 'site_pending', clears_when: '量房报告归档', closed: false},
    ],
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
      packages: 3,
      checks: 2,
      cost_components: 4,
      unpriced_components: 1,
      open_decision_gates: 1,
      open_gated_checks: 1,
      ready_packages: 1,
    },
    data_fingerprint: 'b'.repeat(64),
    packages: [
      packageView(),
      packageView({id: 'PKG-040', name: '水电改造', sequence: 40, effective_status: 'blocked_by_precondition', effective_readiness: 'blocked', gate_status: 'failed', blockers: []}),
      packageView({id: 'PKG-900', name: '硬装预备金', sequence: 900, status: 'not_started', readiness: 'blocked', effective_readiness: 'blocked', effective_status: 'not_started', gate_status: 'pending', payment_gate: 'GATE-900-OWNER-APPROVAL', blockers: []}),
    ],
    decision_gates: {
      open: [
        {id: 'DEC-热水器', topic: '热水器选型', scope: 'acceptance', blocks: ['SCH-160-01'], question: '选燃气还是电热？'},
      ],
      decided_count: 5,
    },
    global_blockers: [
      {id: 'BLK-HANDOVER', item: '交房', status: 'site_pending', clears_when: '开发商交房', owner_roles: ['开发商'], closed: false},
    ],
    next_actions: [
      {kind: 'ready_package', ref: 'PKG-010', title: 'PKG-010｜拆改与砌筑 可以开工/验收', detail: '拆改完成度确认', unblocks: 3, package_id: 'PKG-010'},
      {kind: 'decision_gate', ref: 'DEC-热水器', title: '拍板 DEC-热水器：热水器选型', detail: '选燃气还是电热？', unblocks: 1},
      {kind: 'quote_pending', ref: 'PKG-040', title: '水电改造（PKG-040）有 1 个费用项待询价', detail: '水管', unblocks: 0, package_id: 'PKG-040'},
      {kind: 'external_blocker', ref: 'BLK-HANDOVER', title: '等外部方：交房', detail: '解除条件：开发商交房', unblocks: 2},
    ],
    stale_audits: ['PKG-010/SCH-010-01: 项目数据已变化'],
    package_gate_issues: ['PKG-040: readiness=ready 但阻塞项 BLK-量房 尚未有证据关闭'],
  };
}

describe('SchedulePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
  });

  it('show() 拉取快照并渲染包链表格（sequence 升序、含 PKG-900 侧车道）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('PKG-900'));

    const rows = Array.from(document.querySelectorAll('tr[data-pkg-id]')) as HTMLElement[];
    expect(rows.map((row) => row.dataset.pkgId)).toEqual(['PKG-010', 'PKG-040', 'PKG-900']);
    // sequence 升序
    const seq = Array.from(document.querySelectorAll('tbody tr td:first-child')).map((cell) => cell.textContent);
    expect(seq).toEqual(['10', '40', '900']);
    // PKG-900 侧车道标注
    expect(rows[2].textContent).toContain('预备金·侧车道');
    expect(rows[2].textContent).toContain('GATE-900-OWNER-APPROVAL');
    // 阻塞数 closed/total
    expect(rows[0].textContent).toContain('0/1');
    // 铁律：颜色之外必须有文字
    expect(rows[0].textContent).toContain('进行中');
    expect(rows[1].textContent).toContain('前置未满足');
    expect(rows[1].textContent).toContain('未就绪');
    expect(rows[0].textContent).toContain('待验');
    // 过期验收提示
    expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('过期验收记录 1 条');
  });

  it('点行只写共享选中态，不触发 onHighlight（2026-11-03 路由级：跳 3D 只走显式按钮）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const selection = new ScheduleSelectionStore();
    const onHighlight = vi.fn();
    const panel = new SchedulePanel(selection, {onHighlight});
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('tr[data-pkg-id="PKG-040"]')).toBeTruthy());

    (document.querySelector('tr[data-pkg-id="PKG-040"]') as HTMLElement).click();
    expect(selection.get()).toEqual({packageId: 'PKG-040', checkId: null});
    // 路由级后 onHighlight = 退出审批页；行点击再调它会把用户踢出审批页
    expect(onHighlight).not.toHaveBeenCalled();
    // 当前选中行 data-active
    await vi.waitFor(() => expect((document.querySelector('tr[data-pkg-id="PKG-040"]') as HTMLElement).dataset.active).toBe('true'));
  });

  it('模式按钮切到门禁图：决策门禁段 + CI 四任务口径卡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('tr[data-pkg-id="PKG-900"]')).toBeTruthy());

    const progressButton = document.querySelector('button[data-mode="progress"]') as HTMLElement;
    const gatesButton = document.querySelector('button[data-mode="gates"]') as HTMLElement;
    expect(progressButton.dataset.active).toBe('true');
    expect(gatesButton.dataset.active).toBe('false');

    gatesButton.click();
    const body = document.querySelector('#schedule-panel-body') as HTMLElement;
    // 决策门禁段
    expect(body.textContent).toContain('① 决策门禁');
    expect(body.textContent).toContain('DEC-热水器');
    expect(body.textContent).toContain('选燃气还是电热？');
    expect(body.textContent).toContain('阻塞检查 1 项');
    expect(body.textContent).toContain('SCH-160-01');
    expect(body.textContent).toContain('已拍板 5 条');
    // CI 四任务口径卡
    expect(body.textContent).toContain('② CI 四任务口径');
    expect(body.textContent).toContain('npm run ci:typecheck');
    expect(body.textContent).toContain('npm run ci:test-server');
    expect(body.textContent).toContain('npm run ci:test-app');
    expect(body.textContent).toContain('npm run ci:verify-all');
    expect(body.textContent).toContain('只判');
    expect(body.textContent).toContain('之外的新失败');
    expect(body.textContent).toContain('不在本快照内');
    expect(gatesButton.dataset.active).toBe('true');
    expect(progressButton.dataset.active).toBe('false');
    // 门禁图不渲染包链表格（两个模式不合成一张图）
    expect(document.querySelector('tr[data-pkg-id]')).toBeNull();

    progressButton.click();
    await vi.waitFor(() => expect(document.querySelector('tr[data-pkg-id="PKG-900"]')).toBeTruthy());
  });

  it('fetch 失败显示错误态（HTTP 状态 + 提示），不抛异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false, status: 503, json: async () => ({error: 'schedule control invalid'})})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('HTTP 503'));
    expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('取数失败');
  });

  it('空态：packages 为空时给出可读提示', async () => {
    const empty = {...snapshot(), packages: []};
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => empty})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('没有工作包'));
  });

  it('所有插值转义：含 HTML 的字段不当标签解析', async () => {
    const hostile = snapshot();
    hostile.packages[0] = packageView({id: '<img src=x onerror=alert(1)>', name: '<b>危险</b>'});
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => hostile})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('危险'));
    expect(document.querySelector('#schedule-panel-body')!.querySelector('img')).toBeNull();
    expect(document.querySelector('#schedule-panel-body')!.querySelector('b')).toBeNull();
  });

  it('show/hide/isVisible 状态正确', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const panel = new SchedulePanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#schedule-panel-body')!.textContent).toContain('PKG-900'));
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#schedule-panel') as HTMLElement).style.display).toBe('none');
  });
});
