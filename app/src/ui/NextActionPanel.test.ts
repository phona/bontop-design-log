import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextActionPanel } from './NextActionPanel.js';
import { ScheduleSelectionStore } from '../state/schedule-selection.js';
import type { ScheduleSnapshot } from '@shared/schedule-state';

function snapshot(actions: ScheduleSnapshot['next_actions']): ScheduleSnapshot {
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
    packages: [],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: actions,
    stale_audits: [],
    package_gate_issues: [],
  };
}

// 四个 kind 各两条，组内 unblocks 降序（服务端口径）。
const actions: ScheduleSnapshot['next_actions'] = [
  {kind: 'ready_package', ref: 'PKG-010', title: 'PKG-010｜拆改与砌筑 可以开工/验收', detail: '拆改完成度确认（SCH-010-01）', unblocks: 5, package_id: 'PKG-010'},
  {kind: 'ready_package', ref: 'PKG-020', title: 'PKG-020｜防水 可以开工/验收', detail: '闭水试验', unblocks: 2, package_id: 'PKG-020'},
  {kind: 'decision_gate', ref: 'DEC-热水器', title: '拍板 DEC-热水器：热水器选型', detail: '选燃气还是电热？', unblocks: 3},
  {kind: 'decision_gate', ref: 'DEC-瓷砖', title: '拍板 DEC-瓷砖：瓷砖档次', detail: '通体砖还是瓷片', unblocks: 1},
  {kind: 'quote_pending', ref: 'PKG-040', title: '水电改造（PKG-040）有 2 个费用项待询价', detail: '水管、电线', unblocks: 4, package_id: 'PKG-040'},
  {kind: 'quote_pending', ref: 'PKG-060', title: '木工（PKG-060）有 1 个费用项待询价', detail: '石膏板', unblocks: 0, package_id: 'PKG-060'},
  {kind: 'external_blocker', ref: 'BLK-HANDOVER', title: '等外部方：交房', detail: '解除条件：开发商交房', unblocks: 2},
  {kind: 'external_blocker', ref: 'BLK-SURVEY', title: '等外部方：量房数据冻结', detail: '解除条件：量房报告归档', unblocks: 1},
];

describe('NextActionPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div><div id="approval-page-panels"></div>';
  });

  it('phase 摘要条 + 四个 kind 分组人话标签 + 组内降序', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot(actions)})) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('可以开工/验收'));

    const body = document.querySelector('#next-action-body') as HTMLElement;
    // phase 摘要条
    expect(body.textContent).toContain('¥300,000');
    expect(body.textContent).toContain('已分配 ¥250,000');
    expect(body.textContent).toContain('已知待补缺口 ¥2,000');
    expect(body.textContent).toContain('未报价 1 个');
    expect(body.textContent).toContain('open 门禁 1 条');
    expect(body.textContent).toContain('就绪包 1 个');
    // 四个分组标签
    expect(body.textContent).toContain('可以开工/验收');
    expect(body.textContent).toContain('等业主拍板');
    expect(body.textContent).toContain('待询价');
    expect(body.textContent).toContain('等外部方（系统推不动，只标记）');
    // 每组 2 条
    const cards = Array.from(body.querySelectorAll('[data-action-kind]')) as HTMLElement[];
    expect(cards).toHaveLength(8);
    const kinds = cards.map((card) => card.dataset.actionKind);
    expect(kinds).toEqual([
      'ready_package', 'ready_package',
      'decision_gate', 'decision_gate',
      'quote_pending', 'quote_pending',
      'external_blocker', 'external_blocker',
    ]);
    // 组内 unblocks 降序（卡片上的「解除下游 N 项」）
    const unblocks = cards.map((card) => Number(/解除下游 (\d+) 项/.exec(card.textContent ?? '')?.[1] ?? '-1'));
    expect(unblocks).toEqual([5, 2, 3, 1, 4, 0, 2, 1]);
    // detail / title 呈现
    expect(cards[0].textContent).toContain('选燃气还是电热？'.slice(0, 0) + '拆改完成度确认（SCH-010-01）');
    // 无 package_id 的条目不给「关联包」提示
    expect(cards[2].textContent).not.toContain('关联包');
  });

  it('点带 package_id 的条目写共享选中态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot(actions)})) as never);
    const selection = new ScheduleSelectionStore();
    const panel = new NextActionPanel(selection);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('[data-action-pkg="PKG-040"]')).toBeTruthy());

    (document.querySelector('[data-action-pkg="PKG-040"]') as HTMLElement).click();
    expect(selection.get().packageId).toBe('PKG-040');
    // 无 package_id 的条目点不动选中态
    (document.querySelector('[data-action-kind="decision_gate"]') as HTMLElement).click();
    expect(selection.get().packageId).toBe('PKG-040');
  });

  it('空态：next_actions 为空时提示没有可推导的下一步', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot([])})) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('当前没有可推导的下一步'));
  });

  it('fetch 失败显示错误态（HTTP 状态 + 提示）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('network down'));
    expect(document.querySelector('#next-action-body')!.textContent).toContain('取数失败');
  });

  it('所有插值转义：含 HTML 的 title/detail 不当标签解析', async () => {
    const hostile = snapshot([
      {kind: 'decision_gate', ref: '<script>x</script>', title: '<b>拍板</b>', detail: '<i>问题</i>', unblocks: 1},
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => hostile})) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('拍板'));
    const body = document.querySelector('#next-action-body') as HTMLElement;
    expect(body.querySelector('b')).toBeNull();
    expect(body.querySelector('i')).toBeNull();
    expect(body.querySelector('script')).toBeNull();
  });

  it('show/hide/isVisible 状态正确', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot(actions)})) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    expect(panel.isVisible()).toBe(false);
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('可以开工/验收'));
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
  });
  it('服务端新增未知 kind：归入「其他」组原样呈现，不静默丢弃（P2 兜底）', async () => {
    // 2026-11-03 修：旧实现只按 GROUP_ORDER 渲染，computeNextActions 将来看 kind
    // 时新线索进了 map 却被 filter 掉——业主看不到、也没人发现前端没跟上。
    const withUnknown = snapshot([
      ...actions,
      // 类型上断言成合法 kind，运行时就是「服务端加了新 kind」的模拟
      {kind: 'weather_window' as never, ref: 'PKG-999', title: 'PKG-999｜等天气窗口', detail: '服务端新线索类型', unblocks: 9, package_id: 'PKG-999'},
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => withUnknown})) as never);
    const panel = new NextActionPanel(new ScheduleSelectionStore());
    panel.show();
    await vi.waitFor(() => expect(document.querySelector('#next-action-body')!.textContent).toContain('等天气窗口'));
    const body = document.querySelector('#next-action-body')!;
    expect(body.textContent).toContain('其他（未识别 kind：weather_window）');
    expect(body.textContent).toContain('不静默丢弃');
    // 已知分组不受影响：四组照常
    expect(body.textContent).toContain('可以开工/验收');
  });
});