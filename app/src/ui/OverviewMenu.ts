import type {
  Topic,
  CurrentScheme,
  DecisionLogEntry,
  BudgetSnapshot,
  DesignCheckResult,
  ArchivedScheme,
  Risk,
  ConstraintViolation,
  CurtainPresentationState,
  CurtainState,
} from '@shared/types';

export interface OverviewMenuOptions {
  onArchive?: (name: string, reason?: string) => void;
  onRestore?: (id: string) => void;
  onDeleteArchive?: (id: string) => void;
  onLayoutChange?: (layoutName: string) => void;
  onCompare?: (archiveId: string) => void;
  onClearCompare?: () => void;
  onCurtainStateChange?: (state: CurtainState) => void;
}

export class OverviewMenu {
  private el: HTMLDivElement;
  private schemeEl: HTMLDivElement;
  private curtainsEl: HTMLDivElement | null;
  private decisionsEl: HTMLDivElement;
  private budgetEl: HTMLDivElement;
  private risksEl: HTMLDivElement;
  private archivesEl: HTMLDivElement;
  private archiveInput: HTMLInputElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private presentationState: CurtainPresentationState | null = null;
  private decisions: DecisionLogEntry[] = [];
  private budget: BudgetSnapshot | null = null;
  private risks: DesignCheckResult | null = null;
  private archives: Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>[] = [];
  private visible = false;
  private callbacks: OverviewMenuOptions;
  private layoutSelect: HTMLSelectElement | null;

  constructor(callbacks: OverviewMenuOptions = {}) {
    this.callbacks = callbacks;
    this.el = document.getElementById('overview-menu') as HTMLDivElement;
    this.schemeEl = document.getElementById('overview-scheme') as HTMLDivElement;
    this.curtainsEl = document.getElementById('overview-curtains') as HTMLDivElement | null;
    this.decisionsEl = document.getElementById('overview-decisions') as HTMLDivElement;
    this.budgetEl = document.getElementById('overview-budget') as HTMLDivElement;
    this.risksEl = document.getElementById('overview-risks') as HTMLDivElement;
    this.archivesEl = document.getElementById('overview-archives') as HTMLDivElement;
    this.archiveInput = document.getElementById('archive-name-input') as HTMLInputElement;
    this.layoutSelect = document.getElementById('layout-select') as HTMLSelectElement | null;
    this.el.style.display = 'none';

    if (this.layoutSelect) {
      this.layoutSelect.addEventListener('change', () => {
        this.callbacks.onLayoutChange?.(this.layoutSelect!.value);
      });
    }

    const archiveBtn = document.getElementById('archive-current-btn');
    archiveBtn?.addEventListener('click', () => this.handleArchiveClick());
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.visible) this.render();
  }

  setPresentationState(state: CurtainPresentationState) {
    this.presentationState = state;
    if (this.visible) this.render();
  }

  setDecisionLog(decisions: DecisionLogEntry[]) {
    this.decisions = decisions;
    if (this.visible) this.render();
  }

  setBudget(budget: BudgetSnapshot) {
    this.budget = budget;
    if (this.visible) this.render();
  }

  setRisks(risks: DesignCheckResult) {
    this.risks = risks;
    if (this.visible) this.render();
  }

  setArchivedSchemes(archives: Pick<ArchivedScheme, 'id' | 'name' | 'createdAt'>[]) {
    this.archives = archives;
    if (this.visible) this.render();
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  show() {
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  setLayouts(layouts: Array<{ name: string; path: string }>): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.innerHTML = layouts.map((l) => `<option value="${l.name}">${l.name}</option>`).join('');
  }

  setActiveLayout(name: string): void {
    if (!this.layoutSelect) return;
    this.layoutSelect.value = name;
  }

  private render() {
    this.renderScheme();
    this.renderCurtains();
    this.renderDecisions();
    this.renderBudget();
    this.renderRisks();
    this.renderArchives();
  }

  private renderScheme() {
    this.schemeEl.innerHTML = '';
    if (!this.scheme) return;

    for (const [topicId, selection] of Object.entries(this.scheme.selections)) {
      const topic = this.topics.find((t) => t.id === topicId);
      const topicName = topic?.name ?? topicId;
      const defaultOption = topic?.options.find((o) => o.id === selection.default);

      const row = document.createElement('div');
      row.className = 'overview-row';

      const label = document.createElement('span');
      label.className = 'overview-label';
      label.textContent = topicName;

      const value = document.createElement('span');
      value.className = 'overview-value';
      value.textContent = defaultOption?.name ?? selection.default ?? '未选择';

      row.appendChild(label);
      row.appendChild(value);
      this.schemeEl.appendChild(row);

      for (const [roomId, optionId] of Object.entries(selection.roomOverrides)) {
        const overrideRow = document.createElement('div');
        overrideRow.className = 'overview-row overview-override';

        const overrideLabel = document.createElement('span');
        overrideLabel.textContent = `  ↳ ${roomId}`;

        const overrideOption = topic?.options.find((o) => o.id === optionId);
        const overrideValue = document.createElement('span');
        overrideValue.textContent = overrideOption?.name ?? optionId;

        overrideRow.appendChild(overrideLabel);
        overrideRow.appendChild(overrideValue);
        this.schemeEl.appendChild(overrideRow);
      }
    }
  }

  private renderCurtains() {
    if (!this.curtainsEl) return;
    this.curtainsEl.innerHTML = '';
    const current = this.presentationState?.default ?? 'open';
    const options: Array<{ state: CurtainState; label: string }> = [
      { state: 'open', label: '全开' },
      { state: 'privacy', label: '全屋纱帘' },
      { state: 'blackout', label: '全屋遮光' },
    ];
    const row = document.createElement('div');
    row.className = 'curtain-state-controls';
    for (const option of options) {
      const button = document.createElement('button');
      button.className = `overview-archive-btn${option.state === current ? ' active' : ''}`;
      button.textContent = option.label;
      button.onclick = () => this.callbacks.onCurtainStateChange?.(option.state);
      row.appendChild(button);
    }
    this.curtainsEl.appendChild(row);
  }

  private renderDecisions() {
    this.decisionsEl.innerHTML = '';
    const recent = this.decisions.slice(-10).reverse();

    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无决策记录';
      this.decisionsEl.appendChild(empty);
      return;
    }

    for (const entry of recent) {
      const row = document.createElement('div');
      row.className = 'overview-decision-row';

      const topic = document.createElement('span');
      topic.className = 'overview-decision-topic';
      topic.textContent = entry.topic;

      const change = document.createElement('span');
      change.className = 'overview-decision-change';
      change.textContent = `${entry.previousOptionId ?? '∅'} → ${entry.optionId ?? '∅'}`;

      const time = document.createElement('span');
      time.className = 'overview-decision-time';
      time.textContent = new Date(entry.createdAt).toLocaleTimeString();

      row.appendChild(topic);
      row.appendChild(change);
      row.appendChild(time);
      this.decisionsEl.appendChild(row);
    }
  }

  private renderBudget() {
    this.budgetEl.innerHTML = '';
    if (!this.budget) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无预算数据';
      this.budgetEl.appendChild(empty);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'overview-row';
    summary.innerHTML = `
      <span class="overview-label">总预算</span>
      <span class="overview-value">¥${this.budget.totalBudget.toLocaleString()}</span>
    `;
    this.budgetEl.appendChild(summary);

    const actual = document.createElement('div');
    actual.className = 'overview-row';
    actual.innerHTML = `
      <span class="overview-label">已用</span>
      <span class="overview-value">¥${this.budget.totalActual.toLocaleString()}</span>
    `;
    this.budgetEl.appendChild(actual);

    const remaining = document.createElement('div');
    remaining.className = 'overview-row';
    remaining.innerHTML = `
      <span class="overview-label">剩余</span>
      <span class="overview-value">¥${(this.budget.totalBudget - this.budget.totalActual).toLocaleString()}</span>
    `;
    this.budgetEl.appendChild(remaining);

    for (const category of this.budget.categories) {
      if (category.actual === 0 && category.budget === 0) continue;
      const row = document.createElement('div');
      row.className = 'overview-row';
      row.innerHTML = `
        <span class="overview-label">${category.key}</span>
        <span class="overview-value">¥${category.actual.toLocaleString()} / ¥${category.budget.toLocaleString()}</span>
      `;
      this.budgetEl.appendChild(row);
    }
  }

  private renderRisks() {
    this.risksEl.innerHTML = '';
    if (!this.risks) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无风险数据';
      this.risksEl.appendChild(empty);
      return;
    }

    const all = [
      ...this.risks.risks.map((r) => ({ ...r, kind: 'risk' as const })),
      ...this.risks.constraintViolations.map((v) => ({ ...v, kind: 'constraint' as const })),
    ];

    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '当前方案无风险或约束违规';
      this.risksEl.appendChild(empty);
      return;
    }

    for (const item of all) {
      const row = document.createElement('div');
      row.className = `overview-risk overview-risk-${item.kind}`;
      row.textContent = item.kind === 'risk'
        ? `[${item.severity}] ${(item as Risk).message}`
        : `[约束] ${(item as ConstraintViolation).description}`;
      this.risksEl.appendChild(row);
    }
  }

  private renderArchives() {
    this.archivesEl.innerHTML = '';
    if (this.archives.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无归档方案';
      this.archivesEl.appendChild(empty);
      return;
    }

    for (const archive of this.archives) {
      const row = document.createElement('div');
      row.className = 'overview-archive-row';

      const name = document.createElement('span');
      name.className = 'overview-archive-name';
      name.textContent = archive.name;

      const time = document.createElement('span');
      time.className = 'overview-archive-time';
      time.textContent = new Date(archive.createdAt).toLocaleDateString();

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'overview-archive-btn';
      restoreBtn.textContent = '恢复';
      restoreBtn.onclick = () => this.callbacks.onRestore?.(archive.id);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'overview-archive-btn overview-archive-btn-danger';
      deleteBtn.textContent = '删除';
      deleteBtn.onclick = () => this.callbacks.onDeleteArchive?.(archive.id);

      row.appendChild(name);
      row.appendChild(time);
      row.appendChild(restoreBtn);
      row.appendChild(deleteBtn);
      this.archivesEl.appendChild(row);
    }
  }

  private handleArchiveClick() {
    const name = this.archiveInput.value.trim();
    if (!name) return;
    this.callbacks.onArchive?.(name);
    this.archiveInput.value = '';
  }
}
