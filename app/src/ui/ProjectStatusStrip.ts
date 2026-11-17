// 首屏项目状态条（2026-11-17 UI 视觉刷新）。
//
// 业主打开页面第一眼要回答的四问：今天是哪天、离收房/量房/拆改还有几天、
// 当前卡在哪、钱还差多少。之前首屏只有 3D 画布 + 工具栏，这四问全藏在
// 工具栏「审批」按钮后面，要点两下才看到。
//
// 数据来源与 NextActionPanel 同源：`GET /api/schedule/state`（只读）的
// phase / counts，不另起数据源、不自己推导下一步。整条可点：点整条进
// 审批·下一步（onOpenApproval 回调由 App 接线到 navigateToApproval）。
// 取数失败时整条变错误态，点整条改为重试取数，不导航。
//
// 里程碑日来自快照 `snapshot.schedule.milestones`，唯一来源是 control.yaml
// work_calendar.milestones（业主 2026-11-17 明示的真实日期：收房 11-26 周四、
// 量房 11-27 周五、拆改 12-01 周二），不是排程锚点（anchor_date 仍 null，另题
// 裁定）；天数按本地今天现算；日期过了显示「今天」/「已过 N 天」，不造假。
// 快照无 schedule/milestones（旧快照）时不画里程碑段，不回退到 UI 硬编码。
// 进度条是图形 + 文字双通道：就绪包 x/25 配文字，不只靠颜色。
import type { ScheduleSnapshot } from '@shared/schedule-state';
import { escapeHtml } from './escape-html.js';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function daysUntil(dateIso: string, now: Date = new Date()): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function milestoneText(dateIso: string, now: Date = new Date()): string {
  const days = daysUntil(dateIso, now);
  if (days > 0) return `${days}天后`;
  if (days === 0) return '今天';
  return `已过 ${-days} 天`;
}

const money = (value: number | null | undefined): string =>
  value == null ? '—' : `¥${value.toLocaleString('zh-CN')}`;

/** 快照形态校验：只读本条要的 phase/counts 字段。App 测试里的 fetch mock
 * 会对所有 URL 回同一形状（缺 counts 也 200）——不校验就直接读
 * counts.ready_packages 抛未处理异常（2026-11-17 全量 test:app 28 例）。
 * 形态不对按取数失败处理，不抛。 */
function isScheduleSnapshot(value: unknown): value is ScheduleSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const phase = record.phase as Record<string, unknown> | null;
  const counts = record.counts as Record<string, unknown> | null;
  return !!phase && typeof phase.current_gate === 'string'
    && !!counts && typeof counts.ready_packages === 'number' && typeof counts.packages === 'number';
}

export interface ProjectStatusStripOptions {
  /** 点整条：进审批·下一步（App 接线）。取数失败时点整条改为重试，不导航。 */
  onOpenApproval: () => void;
}

export class ProjectStatusStrip {
  private el: HTMLDivElement | null = null;
  private payload: ScheduleSnapshot | null = null;
  private errorMessage: string | null = null;

  constructor(private readonly options: ProjectStatusStripOptions) {}

  /** 挂到 #app 左上；样式见 style.css 的 #project-status-strip。 */
  mount(): void {
    if (this.el) return;
    const el = document.createElement('div');
    el.id = 'project-status-strip';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = '点整条：进审批·下一步';
    el.addEventListener('click', () => this.handleClick());
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleClick();
      }
    });
    const host = document.getElementById('app') ?? document.body;
    host.appendChild(el);
    this.el = el;
    this.render();
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch('/api/schedule/state');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!isScheduleSnapshot(payload)) throw new Error('快照缺少 phase/counts（不是排程快照）');
      this.payload = payload;
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  private handleClick(): void {
    if (this.errorMessage || !this.payload) {
      void this.refresh();
      return;
    }
    this.options.onOpenApproval();
  }

  private render(): void {
    if (!this.el) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${WEEKDAYS[now.getDay()]}`;
    // 加载态与失败态分开：mount 后 fetch 在途时显示「加载中」，不闪一次错误态。
    if (!this.errorMessage && !this.payload) {
      this.el.innerHTML = `<span class="status-strip-date">${escapeHtml(today)}</span>
        <span style="color:#9aa4b2;">项目状态加载中…</span>`;
      return;
    }
    if (this.errorMessage || !this.payload) {
      this.el.innerHTML = `<span class="status-strip-date">${escapeHtml(today)}</span>
        <span class="status-strip-error">项目状态取数失败：${escapeHtml(this.errorMessage ?? '未取得数据')}（点整条重试）</span>`;
      return;
    }
    const phase = this.payload.phase;
    const counts = this.payload.counts;
    const milestones = (this.payload.schedule?.milestones ?? []).map(
      (m) => `<span class="status-strip-milestone"><strong>${escapeHtml(m.label)}</strong> ${m.date.slice(5)}（${escapeHtml(milestoneText(m.date, now))}）</span>`,
    ).join('<span class="status-strip-sep">·</span>');
    const ready = counts.ready_packages;
    const total = counts.packages;
    const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
    // 里程碑段缺失时不留空分隔符（旧快照无 schedule 键）。
    const milestoneSegment = milestones
      ? `<span class="status-strip-sep">｜</span>${milestones}`
      : '';
    this.el.innerHTML = `<span class="status-strip-date">${escapeHtml(today)}</span>
      ${milestoneSegment}
      <span class="status-strip-sep">｜</span><span>当前门禁：${escapeHtml(phase.current_gate)}</span>
      <span class="status-strip-sep">｜</span><span>open 门禁 ${counts.open_decision_gates} 条</span>
      <span class="status-strip-sep">｜</span><span>缺口 ${money(phase.known_pending_gap_cny)}</span>
      <span class="status-strip-progress" title="就绪包 ${ready}/${total}"><span class="status-strip-progress-fill" style="width:${pct}%"></span><span class="status-strip-progress-text">就绪 ${ready}/${total} 包</span></span>
      <span class="status-strip-go">进审批 →</span>`;
  }
}
