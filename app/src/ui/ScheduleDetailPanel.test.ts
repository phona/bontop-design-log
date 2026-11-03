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
      check({
        id: 'SCH-010-03', item: '贴砖复验', severity: 'critical', checkpoint: '贴砖完成后',
        method: '现场核对', pass_condition: '无空鼓', evidence_required: ['照片'],
        audit_status: 'passed', audit: {id: 'AUD-PKG-010-SCH-010-03-001', checked_by: '业主', checked_at: '2026-10-30', evidence: []},
        check_spec_sha256: '112233445566',
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
    draft?: () => unknown;
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
      return respond(200, (handlers.draft ?? (() => ({package_id: 'PKG-010', results: []})))());
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
    expect(staged.body).toEqual({
      package_id: 'PKG-010',
      check_id: 'SCH-010-01',
      filename: 'a.jpg',
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

  it('同包旧响应作废：预演在途时草稿变化，旧预演不许填回（codex 八审 blocking 回归）', async () => {
    // A 的预演在途 → 本地编辑（草稿变版，旧结论作废）→ 旧预演响应晚到。旧实现
    // 把旧草稿的预演填回 run.dryRun，提交按钮对着过期预览重新可用，而真实提交
    // 读的是新草票——按钮结论与服务端读的不一致。
    const {panel, calls} = await mountPanel();
    // 先跑卡点拿绿（预演的前置）
    click('#acceptance-run-gates');
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).toContain('卡点 5/5'), {timeout: 3000});
    // 发起预演（在途：mock 同步返回，但先篡改版本号模拟「请求发出后草稿又变了」）
    const dryRunPromise = panel['runDryRun']('PKG-010');
    // 在途期间本地编辑 → invalidateRunForDraftChange bump 版本
    setInput('[data-note="SCH-010-01"]', '编辑于预演在途期间');
    await dryRunPromise;
    // 旧响应应被版本校验作废：预演区不留旧草稿的预览
    await vi.waitFor(() => expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入'));
    expect(document.querySelector('#acceptance-actions')!.textContent).not.toContain('PR 预演：将写入');
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
    // 切到 B 再回 A：确认态必须已解除
    selection.set({packageId: 'PKG-020', checkId: null});
    selection.set({packageId: 'PKG-010', checkId: null});
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
        // A 的服务端草稿里躺着一条旧备注（模拟上次保存的内容）
        draft: () => ({package_id: 'PKG-010', results: [{check_id: 'SCH-010-01', status: 'failed', checked_by: '业主', checked_at: '2026-11-01', evidence: [], note: '旧备注-服务端'}]}),
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
