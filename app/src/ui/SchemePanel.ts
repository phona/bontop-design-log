import type { Topic, TopicOption, SchemeDiff, BudgetSnapshot } from '@shared/types';
import { setupCollapsiblePanel, type CollapsiblePanelController } from './CollapsiblePanel.js';
import { escapeHtml } from './escape-html.js';

export interface SchemePanelElements {
  topicTabs: HTMLElement;
  topicOptions: HTMLElement;
  schemeName: HTMLElement;
  schemeDesc: HTMLElement;
  schemePros: HTMLElement;
  schemeCons: HTMLElement;
  warnings: HTMLElement;
  comparePanel?: HTMLElement;
}

export class SchemePanel {
  private topics: Topic[] = [];
  private activeTopicId = 'hvac';
  private activeOptionId = '';
  /** 按主题记忆当前选案：切 tab 时恢复该主题的选中项与 info，而非无条件清空。 */
  private activeOptionByTopic = new Map<string, string>();
  private onSelect?: (topicId: string, optionId: string) => void;
  private els: SchemePanelElements;
  private compareActive = false;
  private compareArchiveName = '';
  private collapseController: CollapsiblePanelController | null = null;

  constructor(els: SchemePanelElements) {
    this.els = els;
    const getElementById = document.getElementById?.bind(document);
    const toggle = getElementById?.('scheme-panel-toggle') as HTMLButtonElement | null;
    const content = getElementById?.('scheme-panel-content');
    if (toggle && content) {
      this.collapseController = setupCollapsiblePanel(toggle, content, true);
      // 抽屉滑入由 body.scheme-open 驱动（CSS）；内部折叠即关抽屉
      toggle.addEventListener('click', () => this.syncDrawerClass());
    }
  }

  private syncDrawerClass(): void {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('scheme-open', this.isPanelOpen());
    }
  }

  /** SurfaceManager 接线用：程序化展开/收起方案面板（= 开/关左抽屉）。 */
  setPanelOpen(open: boolean): void {
    this.collapseController?.setCollapsed(!open);
    this.syncDrawerClass();
  }

  isPanelOpen(): boolean {
    return this.collapseController ? !this.collapseController.isCollapsed() : false;
  }

  init(topics: Topic[], onSelect: (topicId: string, optionId: string) => void) {
    this.topics = topics;
    this.onSelect = onSelect;
    this.renderTabs();
    this.renderOptions();
  }

  setActiveTopic(topicId: string) {
    this.activeTopicId = topicId;
    // 恢复该主题记忆里的选案（而非无条件清空）：切回已选过的主题时能看到当前选案与 info。
    this.activeOptionId = this.activeOptionByTopic.get(topicId) ?? '';
    this.renderTabs();
    this.renderOptions();
    const remembered = this.activeOptionByTopic.get(topicId);
    const option = remembered
      ? this.topics.find((t) => t.id === topicId)?.options.find((o) => o.id === remembered)
      : undefined;
    if (option) {
      this.showInfo(option, []);
    } else {
      this.clearInfo();
    }
  }

  setActiveOption(topicId: string, optionId: string, warnings: string[]) {
    // 先记忆：之后切到别的主题再切回，setActiveTopic 能恢复这一选中态。
    this.activeOptionByTopic.set(topicId, optionId);
    this.activeTopicId = topicId;
    this.activeOptionId = optionId;
    this.renderTabs();
    this.renderOptions();

    const topic = this.topics.find((t) => t.id === topicId);
    const option = topic?.options.find((o) => o.id === optionId);
    if (option) {
      this.showInfo(option, warnings);
    }
  }

  /**
   * 用一份方案选案（topicId → optionId）刷新面板：按主题记忆选案，并展示
   * 「第一个有选案的面板主题」（带上该主题的选中项与 info）；无选案则展示第一个主题。
   *
   * 取代旧 applyScheme 里「遍历所有 selections 键逐个 setActiveOption」：那会让
   * activeTopicId 停在最后一个键——可能不是面板的导航主题（如 robot_vacuum），
   * 于是无 tab 激活、选项列表全空。这里只展示面板真实拥有的主题，未知键进 map 但不影响展示。
   */
  applySchemeSelections(selections: Record<string, string | null | undefined>): void {
    this.activeOptionByTopic.clear();
    for (const [topicId, optionId] of Object.entries(selections)) {
      if (optionId) this.activeOptionByTopic.set(topicId, optionId);
    }
    const firstWithSelection = this.topics.find((t) => this.activeOptionByTopic.has(t.id));
    this.setActiveTopic(firstWithSelection?.id ?? this.topics[0]?.id ?? '');
  }

  getActiveTopicId() {
    return this.activeTopicId;
  }

  getActiveOptionId() {
    return this.activeOptionId;
  }

  private renderTabs() {
    this.els.topicTabs.innerHTML = '';
    for (const topic of this.topics) {
      const btn = document.createElement('button');
      btn.className = `topic-tab${topic.id === this.activeTopicId ? ' active' : ''}`;
      btn.textContent = topic.name;
      btn.onclick = () => this.setActiveTopic(topic.id);
      this.els.topicTabs.appendChild(btn);
    }
  }

  private renderOptions() {
    this.els.topicOptions.innerHTML = '';
    const topic = this.topics.find((t) => t.id === this.activeTopicId);
    if (!topic) return;
    for (const option of topic.options) {
      const btn = document.createElement('button');
      btn.className = `scheme-btn${option.id === this.activeOptionId ? ' active' : ''}`;
      btn.innerHTML = `<strong>${escapeHtml(option.name)}</strong><br><small>${escapeHtml(option.description ?? '')}</small>`;
      btn.onclick = () => this.onSelect?.(topic.id, option.id);
      this.els.topicOptions.appendChild(btn);
    }
  }

  private showInfo(option: TopicOption, warnings: string[]) {
    this.els.schemeName.textContent = option.name;
    this.els.schemeDesc.textContent = option.description ?? '';

    this.els.schemePros.innerHTML = '';
    (option.pros ?? []).forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      this.els.schemePros.appendChild(li);
    });

    this.els.schemeCons.innerHTML = '';
    (option.cons ?? []).forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      this.els.schemeCons.appendChild(li);
    });

    this.els.warnings.innerHTML = '';
    for (const w of warnings) {
      const div = document.createElement('div');
      div.className = 'warning';
      div.textContent = w;
      this.els.warnings.appendChild(div);
    }
  }

  initCompare(archiveName: string, diff: SchemeDiff): void {
    this.compareActive = true;
    this.compareArchiveName = archiveName;
    this.renderCompare(diff);
  }

  clearCompare(): void {
    this.compareActive = false;
    this.compareArchiveName = '';
    if (this.els.comparePanel) this.els.comparePanel.innerHTML = '';
  }

  updateBudget(budget: BudgetSnapshot): void {
    const container = this.els.warnings.parentElement;
    if (!container) return;
    let bar = container.querySelector('.budget-bar') as HTMLElement;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'budget-bar';
      bar.style.cssText = 'border-top:1px solid #444;margin-top:8px;padding-top:8px;';
      container.appendChild(bar);
    }
    const phaseCeiling = budget.phaseCeiling;
    const budgetLimit = phaseCeiling ?? budget.totalBudget;
    const pct = budgetLimit > 0 ? (budget.totalActual / budgetLimit) * 100 : 0;
    const color = pct > 100 ? '#ff4444' : pct > 90 ? '#ffaa00' : '#44cc44';
    bar.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
        <span>${phaseCeiling !== undefined ? '场景估算 / 阶段上限' : '预算'}</span>
        <span>¥${budget.totalActual.toLocaleString()} / ¥${budgetLimit.toLocaleString()}</span>
      </div>
      <div style="background:#333;height:6px;border-radius:3px;overflow:hidden;">
        <div style="width:${Math.min(pct, 100)}%;background:${color};height:100%;border-radius:3px;transition:width 0.3s;"></div>
      </div>`;
  }

  private clearInfo() {
    this.els.schemeName.textContent = '请选择一个方案';
    this.els.schemeDesc.textContent = '';
    this.els.schemePros.innerHTML = '';
    this.els.schemeCons.innerHTML = '';
    this.els.warnings.innerHTML = '';
  }

  private renderCompare(diff: SchemeDiff): void {
    const rowsHtml = diff.selections.map((s) => `
          <div class="compare-row">
            <span>${escapeHtml(s.current ?? '—')}</span>
            <span>${escapeHtml(s.compare ?? '—')}</span>
            <span class="${s.priceDelta > 0 ? 'up' : 'down'}">${s.priceDelta > 0 ? '+' : ''}${s.priceDelta} 元</span>
          </div>
        `).join('');

    const risksAdded = diff.risks.added.map((r) => `<div class="risk-added">${escapeHtml(r.id)} (${escapeHtml(r.severity)})</div>`).join('');
    const risksRemoved = diff.risks.removed.map((r) => `<div class="risk-removed">${escapeHtml(r.id)} (${escapeHtml(r.severity)})</div>`).join('');

    if (!this.els.comparePanel) return;
    this.els.comparePanel.innerHTML = `
      <div class="compare-header">
        <span>当前方案</span>
        <span>vs</span>
        <span>${escapeHtml(this.compareArchiveName)}</span>
      </div>
      <div class="compare-budget">
        预算差异: ${diff.budget > 0 ? '+' + diff.budget : diff.budget} 元
      </div>
      <div class="compare-rows">
        ${rowsHtml}
      </div>
      <div class="compare-risks">
        ${risksAdded ? `<div class="risks-added-section"><h4>新增风险</h4>${risksAdded}</div>` : ''}
        ${risksRemoved ? `<div class="risks-removed-section"><h4>消除风险</h4>${risksRemoved}</div>` : ''}
      </div>
    `;
  }
}
