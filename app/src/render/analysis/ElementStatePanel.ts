// 构件工程状态图例面板（DEC-2026-10-09-E01）。
//
// 为什么必须有图例：6 个 status 6 个颜色，没有图例就等于"一堆色块"——业主要能反查
// 「这个颜色是什么状态、多少个构件、哪个卡在谁、和谁冲突」。数字与 3D 同源
// （都来自 HouseScene.inspectElementStates()，其底层是注入的 /api/element-state states），
// 不另行抓数。
//
// 交互：
//  - 顶部状态图例：点某 status = solo 该状态（其余压暗），再点取消；
//  - 逐构件表：点某行 = solo 该构件 id，再点取消；「未决问题」列显示 openQuestion.blockedBy，
//    「冲突」列显示 verifier issue code；
//  - 顶部一键「取消隔离」。
import type { HouseScene } from '../HouseScene.js';
import { setupCollapsiblePanel } from '../../ui/CollapsiblePanel.js';
import {
  ELEMENT_STATUS_ORDER,
  ELEMENT_STATUS_LABEL,
  elementStatusColorHex,
} from './element-state-colors.js';

const KIND_LABEL: Record<string, string> = {
  electrical: '电气',
  plumbing: '给排水',
  ceiling: '吊顶',
  hvac: '空调',
  furniture: '家具',
  wall: '墙',
  floor: '地',
  opening: '洞口',
  room: '房间',
  mep_route: '机电路线',
  material: '材料',
  budget: '预算',
};

export class ElementStatePanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private solo: string | null = null;

  constructor(private readonly houseScene: HouseScene) {}

  show(): void {
    if (!this.el) this.build();
    this.el!.style.display = 'block';
    this.visible = true;
    this.refresh();
  }

  hide(): void {
    if (this.el) this.el.style.display = 'none';
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 重新渲染（状态数量随服务端投影变化，不能用一次快照）。 */
  refresh(): void {
    if (!this.el) return;
    const body = this.el.querySelector('#element-state-body') as HTMLElement | null;
    if (!body) return;
    const { summary, byStatus, byKind, elements } = this.houseScene.inspectElementStates();
    this.solo = this.houseScene.getElementStateSolo() ?? this.solo;

    const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
    ));

    // 状态图例：只列出现过的 status；点击 solo 该状态
    const legend = ELEMENT_STATUS_ORDER
      .map((status) => {
        const count = byStatus.find((entry) => entry.status === status)?.count ?? 0;
        if (count === 0) return '';
        const color = elementStatusColorHex(status);
        const active = this.solo === status;
        return `<button type="button" data-solo-status="${status}" data-active="${active}"
          title="solo「${ELEMENT_STATUS_LABEL[status]}」" style="cursor:pointer;margin:2px 4px 2px 0;padding:3px 8px;border-radius:6px;border:1px solid ${active ? color : 'rgba(255,255,255,.18)'};background:${active ? color : '#2a2a3e'};color:${active ? '#10131a' : '#ccd'};font-size:12px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;background:${color};border:1px solid rgba(255,255,255,.25);"></span>${ELEMENT_STATUS_LABEL[status]} ${count}
        </button>`;
      })
      .join('');

    const kindSummary = byKind.map((entry) => `${KIND_LABEL[entry.kind] ?? entry.kind} ${entry.count}`).join(' · ');

    const rows = elements
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((element) => {
        const active = this.solo === element.id;
        const dim = this.solo !== null && !active;
        const color = elementStatusColorHex(element.status);
        const blockedBy = element.openQuestion?.blockedBy ?? '';
        const conflicts = element.conflicts.length > 0 ? element.conflicts.join('，') : '';
        return `<tr data-solo-id="${escape(element.id)}" data-active="${active}" style="cursor:pointer;${dim ? 'opacity:0.45;' : ''}">
          <td style="width:16px;"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${color};border:1px solid rgba(255,255,255,.25);"></span></td>
          <td title="${escape(element.id)}">${escape(element.label || element.id)}</td>
          <td>${escape(KIND_LABEL[element.kind] ?? element.kind)}</td>
          <td>${escape(element.room ?? '')}</td>
          <td>${ELEMENT_STATUS_LABEL[element.status] ?? element.status}</td>
          <td title="${escape(blockedBy)}">${escape(blockedBy)}</td>
          <td title="${escape(conflicts)}">${escape(conflicts)}</td>
        </tr>`;
      })
      .join('');

    body.innerHTML = `
      <div style="margin-bottom:8px;">${legend}</div>
      <div style="margin-bottom:8px;color:#9aa4b2;font-size:11px;">
        共 ${summary.total} 个构件${kindSummary ? `｜${kindSummary}` : ''}
        ${this.solo ? `<br><span style="color:#e9c46a;">solo 中：${escape(this.solo)}　<button type="button" id="element-state-clear-solo" style="cursor:pointer;">取消隔离</button></span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>
          <th></th><th>构件</th><th>类别</th><th>房间</th><th>状态</th><th>未决问题</th><th>冲突</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:8px;color:#9aa4b2;font-size:11px;">
        显示层；权威状态在 config 字段 / 待决台账 / DEC / verifier，出口 <code>npm run state:project</code>。
        电气/给排水点位为合批渲染，改以状态标记层显示（不逐件上色）。
      </div>
    `;

    for (const node of Array.from(body.querySelectorAll('[data-solo-status]'))) {
      node.addEventListener('click', () => {
        const status = String((node as HTMLElement).dataset.soloStatus);
        this.solo = this.solo === status ? null : status;
        this.houseScene.setElementStateSolo(this.solo);
        this.refresh();
      });
    }
    for (const node of Array.from(body.querySelectorAll('tr[data-solo-id]'))) {
      node.addEventListener('click', () => {
        const id = String((node as HTMLElement).dataset.soloId);
        this.solo = this.solo === id ? null : id;
        this.houseScene.setElementStateSolo(this.solo);
        this.refresh();
      });
    }
    body.querySelector('#element-state-clear-solo')?.addEventListener('click', () => {
      this.solo = null;
      this.houseScene.setElementStateSolo(null);
      this.refresh();
    });
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'element-state-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 520px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>构件工程状态</strong>
        <button id="element-state-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="element-state-panel-content" aria-expanded="true" aria-label="构件工程状态面板折叠" title="折叠">−</button>
      </div>
      <div id="element-state-panel-content">
        <div id="element-state-body"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#element-state-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#element-state-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);

    this.el = el;
  }
}
