import { setupCollapsiblePanel } from '../../ui/CollapsiblePanel.js';

/**
 * 吊顶报价面板（DEC-2026-10-08-C03）。
 *
 * 数据来自 `GET /api/ceiling/quotes`——**量由服务端 takeoff 实算，面板不自己算面积**，
 * 避免浏览器里出现第二套口径。切换走 `POST /api/ceiling/quotes/active`，
 * 服务端只改写配置文件的 active 一行；面板负责把后果讲清楚：
 * 「金额会变、量不会变、改动要进 Git」。
 */

export interface CeilingQuoteRow {
  key: string;
  label: string;
  quantity: number;
  unit: string;
  per_unit: number | null;
  rate_source: 'quote' | 'base.json';
  subtotal: number | null;
}

export interface CeilingQuoteCard {
  id: string;
  contractor: string;
  quoted_at: string | null;
  status: string;
  active: boolean;
  comparable: boolean;
  comparability_notes: string[];
  total: number | null;
  deltaVsActive: number | null;
  pendingRows: string[];
  rows: CeilingQuoteRow[];
}

export interface CeilingQuotesPayload {
  activeId: string;
  quantities: Record<string, number>;
  resolved: Record<string, { per_unit: number | null; unit: string; source: 'quote' | 'base.json' }>;
  comparison: CeilingQuoteCard[];
}

const STATUS_LABEL: Record<string, string> = {
  baseline: '基线口径',
  candidate: '候选',
  quoted: '已报价',
  contracted: '已成交',
  rejected: '已淘汰',
};

const money = (value: number): string => `¥${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const qty = (value: number, decimals = 2): string => value.toFixed(decimals);

export class CeilingQuotePanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private payload: CeilingQuotesPayload | null = null;
  private switching: string | null = null;
  private errorMessage: string | null = null;

  constructor(private readonly onSwitched?: () => void | Promise<void>) {}

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

  /** 重新拉取并渲染（切换后、每次打开时都调）。 */
  async refresh(): Promise<void> {
    const body = this.el?.querySelector('#ceiling-quote-list') as HTMLElement | null;
    try {
      const response = await fetch('/api/ceiling/quotes');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.payload = (await response.json()) as CeilingQuotesPayload;
      this.errorMessage = null;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
    this.render();
  }

  private render(): void {
    const body = this.el?.querySelector('#ceiling-quote-list') as HTMLElement | null;
    if (!body) return;
    const error = this.errorMessage ? `<div class="ceiling-quote-error">${this.errorMessage}</div>` : '';
    if (!this.payload) {
      body.innerHTML = `${error}<div class="ceiling-quote-foot">未取得报价数据。</div>`;
      return;
    }
    const quantities = this.payload.quantities ?? {};
    const board = quantities.ceiling_zones ?? 0;
    const curtain = quantities.curtain_box_linear ?? 0;

    const cards = this.payload.comparison.map((card) => {
      const rows = card.rows.map((row) => {
        const rate = row.per_unit === null ? '待报价' : `${row.per_unit} ${row.unit}`;
        const subtotal = row.subtotal === null ? '待报价' : money(row.subtotal);
        const fallback = row.rate_source === 'base.json' ? '<span class="ceiling-quote-tag">回落 base.json</span>' : '';
        const quantity = row.key === 'curtain_box_linear' ? `${qty(row.quantity)} m` : `${qty(row.quantity, 3)} ㎡`;
        return `<div class="ceiling-quote-row">${row.label}：${quantity} × ${rate} = <strong>${subtotal}</strong>${fallback}</div>`;
      }).join('');

      const total = card.total === null
        ? '<span class="ceiling-quote-pending">总额待报价（不编金额）</span>'
        : `<strong>${money(card.total)}</strong>${card.deltaVsActive !== null ? ` <span class="${card.deltaVsActive > 0 ? 'ceiling-quote-up' : 'ceiling-quote-down'}">${card.deltaVsActive > 0 ? '+' : ''}${money(card.deltaVsActive)} vs 生效</span>` : ''}`;
      const notes = card.comparability_notes.length > 0
        ? `<div class="ceiling-quote-warn">${card.comparability_notes.join('；')}</div>`
        : '';
      const action = card.active
        ? '<span class="ceiling-quote-tag ceiling-quote-tag-active">生效中</span>'
        : `<button class="ceiling-quote-switch" data-quote="${card.id}" ${this.switching === card.id ? 'disabled' : ''}>${this.switching === card.id ? '切换中…' : '切换为生效'}</button>`;

      return `<div class="ceiling-quote-card${card.active ? ' is-active' : ''}">
        <div class="ceiling-quote-head">
          <strong>${card.contractor}</strong>
          <span class="ceiling-quote-meta">${STATUS_LABEL[card.status] ?? card.status}${card.quoted_at ? ` · ${card.quoted_at}` : ''}</span>
          ${action}
        </div>
        ${rows}
        <div class="ceiling-quote-total">合计：${total}</div>
        ${notes}
      </div>`;
    }).join('');

    body.innerHTML = `${error}
      <div class="ceiling-quote-basis">
        工程量（来自吊顶算量子系统，切换报价不变）：板面 <strong>${qty(board, 3)} ㎡</strong> · 窗帘盒 <strong>${qty(curtain)} m</strong>
      </div>
      ${cards}
      <div class="ceiling-quote-foot">
        切换只改写 <code>config/ceiling-quotes.yaml</code> 的 <code>active</code> 一行（原文件留 <code>.bak</code>），量不变、只换单价。
        按 README「没有口头变更」，该改动需进 Git；没写含项范围的候选会标为不可直接比较，<code>per_unit: null</code> 的行金额不编。
      </div>`;

    for (const button of Array.from(body.querySelectorAll('button.ceiling-quote-switch'))) {
      button.addEventListener('click', () => {
        const id = String((button as HTMLElement).dataset.quote ?? '');
        if (id) void this.switchTo(id);
      });
    }
  }

  private async switchTo(id: string): Promise<void> {
    this.switching = id;
    this.render();
    try {
      const response = await fetch('/api/ceiling/quotes/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json()) as { error?: string; activeId?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      await this.refresh();      await this.onSwitched?.();
    } catch (err) {
      this.errorMessage = `切换失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.switching = null;
      this.render();
    }
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'ceiling-quote-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 420px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>吊顶报价</strong>
        <button id="ceiling-quote-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="ceiling-quote-panel-content" aria-expanded="true" aria-label="吊顶报价面板折叠" title="折叠">−</button>
      </div>
      <div id="ceiling-quote-panel-content">
        <div id="ceiling-quote-list"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#ceiling-quote-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#ceiling-quote-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);
    this.el = el;
  }
}
