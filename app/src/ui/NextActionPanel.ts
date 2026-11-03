// 自装审批「下一步干啥」面板（自装交互审批第一步，2026-11-02，设计稿 §7）。
//
// 数据来源同样是 `GET /api/schedule/state`（只读）的 `next_actions` 字段——
// 推导规则全在服务端 shared/schedule-state.ts（computeNextActions：就绪包、
// open 门禁、未报价组件、系统外阻塞项四条线索，按「解除下游数量」排序）。
// 面板只做分组与呈现，**不自己推导下一步**，避免浏览器里出现第二套口径。
//
// 分组标签用人话：业主看的是「现在能不能动手、要等谁」，不是 kind 枚举。
// external_blocker 单独标注「系统推不动，只标记」——这类项不是业主点一下
// 就能解决的，混在可执行项里只会制造虚假进度感。
import type { ScheduleSnapshot, NextActionItem, NextActionKind } from '@shared/schedule-state';
import type { ScheduleSelectionStore } from '../state/schedule-selection.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';

/** 分组顺序 = 业主的处理顺序：能动手的在前，只能等的在后。 */
const GROUP_ORDER: NextActionKind[] = ['ready_package', 'decision_gate', 'quote_pending', 'external_blocker'];

const GROUP_LABEL: Record<NextActionKind, string> = {
  ready_package: '可以开工/验收',
  decision_gate: '等业主拍板',
  quote_pending: '待询价',
  external_blocker: '等外部方（系统推不动，只标记）',
};

const GROUP_HINT: Record<NextActionKind, string> = {
  ready_package: '前置条件已满足，按检查项推进即可',
  decision_gate: '需要业主拍板后才能解除下游检查',
  quote_pending: '「待报价/待算量」不是 0 元，询价到位前金额不编',
  external_blocker: '卡在系统外部（交房/量房/厂家），只标记，不在本系统内可解',
};

const GROUP_COLOR: Record<NextActionKind, string> = {
  ready_package: '#5cb85c',
  decision_gate: '#e9c46a',
  quote_pending: '#6fa8dc',
  external_blocker: '#8a93a3',
};

const money = (value: number | null | undefined): string =>
  value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;

export class NextActionPanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;

  constructor(private readonly selection: ScheduleSelectionStore) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    void this.refresh();
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 重新拉取快照并渲染（与 SchedulePanel 同一数据源，各自缓存）。 */
  async refresh(): Promise<void> {
    try {
      const response = await fetch('/api/schedule/state');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.payload = (await response.json()) as ScheduleSnapshot;
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  private render(): void {
    const body = this.el?.querySelector('#next-action-body') as HTMLElement | null;
    if (!body) return;

    const error = this.errorMessage
      ? `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid rgba(217,83,79,.55);border-radius:6px;background:rgba(217,83,79,.12);color:#f0a9a5;font-size:12px;">取数失败：${escapeHtml(this.errorMessage)}　控制源校验不过或接口不通；修好 control.yaml / 起服务后重试。</div>`
      : '';

    if (!this.payload) {
      body.innerHTML = `${error}<div style="color:#9aa4b2;font-size:12px;">未取得下一步数据。</div>`;
      return;
    }

    const snapshot = this.payload;
    const phase = snapshot.phase;
    const counts = snapshot.counts;
    const summary = `<div style="margin-bottom:10px;padding:8px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(255,255,255,.04);font-size:12px;line-height:1.7;">
      <div><strong>${escapeHtml(phase.id)}</strong>｜当前门禁：${escapeHtml(phase.current_gate)}｜阶段状态：${escapeHtml(phase.status)}</div>
      <div style="color:#9aa4b2;">
        预算上限 ${money(phase.ceiling_cny)}｜已分配 ${money(phase.allocated_cny)}｜未分配 ${money(phase.unallocated_cny)}｜已知待补缺口 ${money(phase.known_pending_gap_cny)}
      </div>
      <div style="color:#d8d8e4;">
        未报价 ${counts.unpriced_components} 个｜open 门禁 ${counts.open_decision_gates} 条｜就绪包 ${counts.ready_packages} 个｜共 ${counts.packages} 个包 / ${counts.checks} 项检查
      </div>
    </div>`;

    const items = snapshot.next_actions ?? [];
    if (items.length === 0) {
      body.innerHTML = `${error}${summary}<div style="padding:10px;border:1px dashed rgba(255,255,255,.2);border-radius:6px;color:#9aa4b2;font-size:12px;">
        当前没有可推导的下一步（就绪包、open 门禁、未报价组件、系统外阻塞项都为空）。
      </div>`;
      return;
    }

    const grouped = new Map<string, NextActionItem[]>();
    for (const kind of GROUP_ORDER) grouped.set(kind, []);
    for (const item of items) {
      if (!grouped.has(item.kind)) grouped.set(item.kind, []);
      grouped.get(item.kind)!.push(item);
    }

    // 组渲染 helper：label/hint/color 显式传入——未识别 kind 也能原样渲染（P2 兜底）
    const renderGroup = (label: string, hint: string, color: string, groupItems: NextActionItem[]): string => {
      // 组内按 unblocks 降序。服务端 computeNextActions 已全局排过（unblocks 降序
      // → kind → ref），这里再稳定排一次只为守住面板自己的不变量；对已排序输入是
      // 恒等操作，不会打乱服务端给出的顺序。
      const sorted = groupItems.slice().sort((left, right) => right.unblocks - left.unblocks);
      const cards = sorted.map((item) => {
        const clickable = Boolean(item.package_id);
        const badge = `<span style="padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.08);color:#9aa4b2;font-size:10px;white-space:nowrap;">解除下游 ${item.unblocks} 项</span>`;
        return `<div data-action-ref="${escapeHtml(item.ref)}" data-action-kind="${escapeHtml(item.kind)}" data-action-pkg="${escapeHtml(item.package_id ?? '')}"
          style="margin-bottom:6px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-left:3px solid ${color};border-radius:6px;background:rgba(255,255,255,.03);${clickable ? 'cursor:pointer;' : ''}">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;">
            <strong>${escapeHtml(item.title)}</strong>${badge}
          </div>
          <div style="margin-top:4px;color:#9aa4b2;font-size:11px;">${escapeHtml(item.detail)}</div>
          ${clickable ? `<div style="margin-top:4px;color:#6fa8dc;font-size:11px;">关联包 ${escapeHtml(item.package_id!)}（点这条选中该包）</div>` : ''}
        </div>`;
      }).join('');
      return `<div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:13px;font-weight:600;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};border:1px solid rgba(255,255,255,.25);"></span>
          ${escapeHtml(label)} ${sorted.length}
        </div>
        <div style="margin:-2px 0 6px 16px;color:#9aa4b2;font-size:11px;">${escapeHtml(hint)}</div>
        ${cards}
      </div>`;
    };

    // P2 兜底（2026-11-03 修）：GROUP_ORDER 之外的新 kind 曾被 filter 静默丢弃——
    // 服务端 computeNextActions 将来新增线索类型时，业主在面板上看不到那条线索。
    // 现在未识别 kind 归入「其他」组原样呈现，标题带出 kind 名，让人能发现前端没跟上。
    const knownKinds = GROUP_ORDER.filter((kind) => (grouped.get(kind) ?? []).length > 0);
    const extraKinds = [...grouped.keys()].filter((kind) => !(GROUP_ORDER as readonly string[]).includes(kind));
    const groups = [
      ...knownKinds.map((kind) => renderGroup(GROUP_LABEL[kind], GROUP_HINT[kind], GROUP_COLOR[kind], grouped.get(kind)!)),
      ...extraKinds.map((kind) => renderGroup(
        `其他（未识别 kind：${kind}）`,
        '服务端 computeNextActions 新增了本面板不认识的线索类型——按原样呈现，不静默丢弃；前端分组应尽快补上。',
        '#9aa4b2',
        grouped.get(kind)!)),
    ].join('');


    body.innerHTML = `${error}${summary}${groups}
      <div style="margin-top:4px;color:#9aa4b2;font-size:11px;">
        推导与排序全部来自服务端（shared/schedule-state.ts computeNextActions），面板只分组呈现；
        点带包 ID 的条目写共享选中态，供详情面板与 3D 高亮联动。本面板只读，不产生任何配置写入。
      </div>`;
    this.bind(body);
  }

  private bind(body: HTMLElement): void {
    for (const card of Array.from(body.querySelectorAll('[data-action-pkg]'))) {
      const node = card as HTMLElement;
      const packageId = node.dataset.actionPkg ?? '';
      if (!packageId) continue;
      node.addEventListener('click', () => {
        this.selection.set({packageId});
      });
    }
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'next-action-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 460px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>下一步干啥</strong>
        <button id="next-action-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="next-action-panel-content" aria-expanded="true" aria-label="下一步干啥面板折叠" title="折叠">−</button>
      </div>
      <div id="next-action-panel-content">
        <div id="next-action-body"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#next-action-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#next-action-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    this.el = el;
  }
}
