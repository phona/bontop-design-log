// 吊顶分区图例面板（DEC-2026-10-08-C01）。
//
// 为什么必须有图例：19 个分区 19 个颜色，没有图例就等于"一堆色块"——业主要能反查
// 「这个颜色是哪个分区、哪个房间、什么工艺、多少面积」。数字与 3D 同源
// （都来自 HouseScene.inspectCeilingZones() → shared/ceiling-takeoff.ts），不另行抓数。
//
// 交互：
//  - 顶部切换「每分区一色 / 按工艺归并」；
//  - 点某一行 = 隔离该分区（其余压暗），再点取消；
//  - 每组表头带小计：净面积 / 展开面积 / 延长米（窗帘盒）/ 板块数（铝扣板）。
import type { HouseScene } from '../HouseScene.js';
import { setupCollapsiblePanel } from '../../ui/CollapsiblePanel.js';
import { ceilingZoneColor, TRADE_LABEL, type CeilingZoneColorMode } from './ceiling-zone-colors.js';

const TRADE_ORDER = ['gypsum_board', 'aluminum_buckle', 'curtain_box', 'drying_rack'] as const;

export class CeilingZonePanel {
  private el: HTMLDivElement | null = null;
  private visible = false;
  private mode: CeilingZoneColorMode = 'zone';
  private soloId: string | null = null;

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

  /** 重新渲染图例（分区数量/面积随布局与配置变化，不能用一次快照）。 */
  refresh(): void {
    if (!this.el) return;
    const body = this.el.querySelector('#ceiling-zone-legend') as HTMLElement | null;
    if (!body) return;
    const { zones, takeoff } = this.houseScene.inspectCeilingZones();
    this.houseScene.setCeilingZoneHighlightMode(this.mode);
    this.soloId = this.houseScene.getCeilingZoneSolo() ?? this.soloId;

    const rows = (zoneId: string): string => {
      const zone = zones.find((candidate) => candidate.id === zoneId);
      if (!zone) return '';
      const active = this.soloId === zone.id;
      const dim = this.soloId !== null && !active;
      const color = ceilingZoneColor(zone.id, zone.trade, this.mode);
      const quantity = zone.trade === 'curtain_box'
        ? `${zone.netAreaM2.toFixed(3)}㎡ · ${zone.longSideM.toFixed(2)}m`
        : `${zone.netAreaM2.toFixed(3)}㎡${zone.panelCount !== undefined ? ` · ${zone.panelCount}块` : ''}`;
      return `<tr data-zone="${zone.id}" data-active="${active}" style="cursor:pointer;${dim ? ' opacity:0.45;' : ''}">
        <td style="width:18px;"><span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:${color}; border:1px solid rgba(255,255,255,.25);"></span></td>
        <td title="${zone.id}">${zone.id}</td>
        <td>${zone.roomName}</td>
        <td>${zone.thickness.toFixed(2)} / ${zone.bottomY.toFixed(2)}</td>
        <td style="text-align:right;">${quantity}</td>
      </tr>`;
    };

    const groups = TRADE_ORDER
      .map((trade) => {
        const rollup = takeoff.byClass[trade];
        if (rollup.zones === 0) return '';
        const members = zones.filter((zone) => zone.trade === trade);
        const subtotal = trade === 'curtain_box'
          ? `${rollup.netAreaM2.toFixed(3)}㎡ · ${rollup.linearM.toFixed(2)}m`
          : `${rollup.netAreaM2.toFixed(3)}㎡${rollup.panelCount > 0 ? ` · ${rollup.panelCount}块` : ''}`;
        return `<tbody>
          <tr class="ceiling-zone-group">
            <td><span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:${ceilingZoneColor('', trade, 'trade')}; border:1px solid rgba(255,255,255,.25);"></span></td>
            <td><strong>${TRADE_LABEL[trade]}</strong></td>
            <td>${rollup.zones} 区</td>
            <td>展开 ${rollup.expandedAreaM2.toFixed(2)}㎡</td>
            <td style="text-align:right;"><strong>${subtotal}</strong></td>
          </tr>
          ${members.map((zone) => rows(zone.id)).join('')}
        </tbody>`;
      })
      .join('');

    const unclassified = zones.filter((zone) => zone.trade === null);
    body.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead><tr>
        <th></th><th>分区</th><th>房间</th><th>厚/完成面</th><th style="text-align:right;">数量</th>
      </tr></thead>
      ${groups}
      ${unclassified.length > 0
        ? `<tbody><tr class="ceiling-zone-group"><td colspan="5" style="color:#e63946;">⚠ 未归类分区（trade 缺失/非法）：${unclassified.map((zone) => zone.id).join('、')}</td></tr></tbody>`
        : ''}
    </table>
    <div style="margin-top:8px; color:#9aa4b2; font-size:11px;">
      合计净 ${takeoff.totalNetAreaM2.toFixed(3)}㎡ · 展开 ${takeoff.totalExpandedAreaM2.toFixed(3)}㎡ · 周长 ${takeoff.totalPerimeterM.toFixed(2)}m
      ${takeoff.overlaps.length > 0 ? `<br><span style="color:#e9c46a;">⚠ 平面重叠 ${takeoff.overlapAreaM2.toFixed(3)}㎡：${takeoff.overlaps.join('；')}（业主裁定分区边界前不计入 resolved）</span>` : ''}
      <br>报价口径：<code>npm run takeoff:ceiling</code> / <code>GET /api/ceiling/takeoff</code>；显示层不作出料依据。
    </div>`;

    for (const row of Array.from(body.querySelectorAll('tr[data-zone]'))) {
      row.addEventListener('click', () => {
        const zoneId = String((row as HTMLElement).dataset.zone);
        const next = this.soloId === zoneId ? null : zoneId;
        this.soloId = next;
        this.houseScene.setCeilingZoneSolo(next);
        this.refresh();
      });
    }
  }

  private build(): void {
    const el = document.createElement('div');
    el.id = 'ceiling-zone-panel';
    el.className = 'dynamic-panel';
    el.style.cssText = `
      background: #1a1a2e; color: #e0e0e0; border-radius: 10px; padding: 14px 16px;
      font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); display: none; max-width: 380px;
    `;
    el.innerHTML = `
      <div class="dynamic-panel-heading">
        <strong>吊顶分区</strong>
        <button id="ceiling-zone-panel-toggle" class="panel-collapse-toggle" type="button" aria-controls="ceiling-zone-panel-content" aria-expanded="true" aria-label="吊顶分区面板折叠" title="折叠">−</button>
      </div>
      <div id="ceiling-zone-panel-content">
        <div style="display:flex; gap:6px; margin-bottom:10px;">
          <button id="ceiling-zone-mode-zone" type="button" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:5px 0; cursor:pointer;">每分区一色</button>
          <button id="ceiling-zone-mode-trade" type="button" style="flex:1; background:#2a2a3e; color:#ccd; border:1px solid #3a3a5e; border-radius:6px; padding:5px 0; cursor:pointer;">按工艺归并</button>
        </div>
        <div id="ceiling-zone-legend"></div>
      </div>
    `;
    const stack = document.getElementById('right-panel-stack');
    (stack ?? document.body).appendChild(el);
    const toggle = el.querySelector('#ceiling-zone-panel-toggle') as HTMLButtonElement | null;
    const content = el.querySelector('#ceiling-zone-panel-content') as HTMLElement | null;
    if (toggle && content) setupCollapsiblePanel(toggle, content);

    const modeZone = el.querySelector('#ceiling-zone-mode-zone') as HTMLButtonElement | null;
    const modeTrade = el.querySelector('#ceiling-zone-mode-trade') as HTMLButtonElement | null;
    const paintMode = (): void => {
      const active = 'background:#3a3a5e; color:#fff;';
      if (modeZone) modeZone.style.cssText = `flex:1; border:1px solid #3a3a5e; border-radius:6px; padding:5px 0; cursor:pointer;${this.mode === 'zone' ? active : 'background:#2a2a3e; color:#ccd;'}`;
      if (modeTrade) modeTrade.style.cssText = `flex:1; border:1px solid #3a3a5e; border-radius:6px; padding:5px 0; cursor:pointer;${this.mode === 'trade' ? active : 'background:#2a2a3e; color:#ccd;'}`;
    };
    modeZone?.addEventListener('click', () => { this.mode = 'zone'; paintMode(); this.refresh(); });
    modeTrade?.addEventListener('click', () => { this.mode = 'trade'; paintMode(); this.refresh(); });
    paintMode();

    this.el = el;
  }
}
