import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProjectStatusStrip, daysUntil, milestoneText } from './ProjectStatusStrip.js';
import type { ScheduleSnapshot } from '@shared/schedule-state';

function snapshot(): ScheduleSnapshot {
  return {
    phase: {
      id: 'phase_1_basic_occupancy',
      status: 'planning',
      current_gate: 'pre_handover',
      ceiling_cny: 210099,
      allocated_cny: 210099,
      unallocated_cny: 0,
      known_pending_gap_cny: 36313,
    },
    counts: {
      packages: 25,
      checks: 118,
      cost_components: 107,
      unpriced_components: 89,
      open_decision_gates: 8,
      open_gated_checks: 15,
      ready_packages: 0,
    },
    data_fingerprint: 'b'.repeat(64),
    packages: [],
    decision_gates: {open: [], decided_count: 0},
    global_blockers: [],
    next_actions: [],
    stale_audits: [],
    package_gate_issues: [],
    schedule: {
      anchor_date: null,
      calendar: {workdays: [1, 2, 3, 4, 5, 6], rest_dates: [], extra_workdates: []},
      milestones: [
        {key: 'handover', label: '收房', date: '2026-11-26'},
        {key: 'survey', label: '量房', date: '2026-11-27'},
        {key: 'demolition', label: '拆改', date: '2026-12-01'},
      ],
      ordinals: [],
      packages: {},
    },
  };
}

describe('ProjectStatusStrip', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T08:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('里程碑倒计时按今天现算（2026-11-17：收房 9 天后 / 量房 10 天后 / 拆改 14 天后）', () => {
    expect(daysUntil('2026-11-26', new Date('2026-11-17T08:00:00+08:00'))).toBe(9);
    expect(daysUntil('2026-11-27', new Date('2026-11-17T08:00:00+08:00'))).toBe(10);
    expect(daysUntil('2026-12-01', new Date('2026-11-17T08:00:00+08:00'))).toBe(14);
    expect(milestoneText('2026-11-26', new Date('2026-11-26T08:00:00+08:00'))).toBe('今天');
    expect(milestoneText('2026-11-26', new Date('2026-11-27T08:00:00+08:00'))).toBe('已过 1 天');
  });

  it('渲染：今天日期 + 里程碑 + 门禁 + 缺口 + 就绪进度条（图形+文字）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const strip = new ProjectStatusStrip({onOpenApproval: () => {}});
    strip.mount();
    await vi.waitFor(() => expect(document.querySelector('#project-status-strip')!.textContent).toContain('收房'));

    const el = document.querySelector('#project-status-strip') as HTMLElement;
    expect(el.textContent).toContain('2026-11-17 周二');
    expect(el.textContent).toContain('收房 11-26（9天后）');
    expect(el.textContent).toContain('量房 11-27（10天后）');
    expect(el.textContent).toContain('拆改 12-01（14天后）');
    expect(el.textContent).toContain('当前门禁：pre_handover');
    expect(el.textContent).toContain('open 门禁 8 条');
    expect(el.textContent).toContain('缺口 ¥36,313');
    expect(el.textContent).toContain('就绪 0/25 包');
    const fill = el.querySelector('.status-strip-progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('挂载后先显示加载中，取数回来再渲染（不闪错误态）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never);
    const strip = new ProjectStatusStrip({onOpenApproval: () => {}});
    strip.mount();
    expect(document.querySelector('#project-status-strip')!.textContent).toContain('加载中');
    await vi.waitFor(() => expect(document.querySelector('#project-status-strip')!.textContent).toContain('收房'));
  });

  it('快照缺 phase/counts：按取数失败处理，不抛未处理异常', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => ({phase: {}})})) as never);
    const strip = new ProjectStatusStrip({onOpenApproval: () => {}});
    strip.mount();
    await vi.waitFor(() => expect(document.querySelector('#project-status-strip')!.textContent).toContain('取数失败'));
    expect(document.querySelector('#project-status-strip')!.textContent).toContain('不是排程快照');
  });

  it('点整条进审批·下一步；取数失败时点整条重试不导航', async () => {
    const fetchMock = vi.fn(async () => ({ok: true, status: 200, json: async () => snapshot()})) as never;
    vi.stubGlobal('fetch', fetchMock);
    const onOpenApproval = vi.fn();
    const strip = new ProjectStatusStrip({onOpenApproval});
    strip.mount();
    await vi.waitFor(() => expect(document.querySelector('#project-status-strip')!.textContent).toContain('收房'));
    (document.querySelector('#project-status-strip') as HTMLElement).click();
    expect(onOpenApproval).toHaveBeenCalledTimes(1);

    // 失败态：点整条重试
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }) as never);
    await strip.refresh();
    expect(document.querySelector('#project-status-strip')!.textContent).toContain('取数失败');
    (document.querySelector('#project-status-strip') as HTMLElement).click();
    expect(onOpenApproval).toHaveBeenCalledTimes(1);
  });

  it('旧快照无 schedule 键：不画里程碑段，不崩（不回退 UI 硬编码）', async () => {
    const {schedule: _schedule, ...legacy} = snapshot();
    void _schedule;
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, status: 200, json: async () => legacy})) as never);
    const strip = new ProjectStatusStrip({onOpenApproval: () => {}});
    strip.mount();
    await vi.waitFor(() => expect(document.querySelector('#project-status-strip')!.textContent).toContain('当前门禁'));
    expect(document.querySelector('#project-status-strip')!.textContent).not.toContain('收房');
  });
});
