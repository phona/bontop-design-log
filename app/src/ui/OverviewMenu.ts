import type { Topic, CurrentScheme, DecisionLogEntry } from '@shared/types';

export class OverviewMenu {
  private el: HTMLDivElement;
  private schemeEl: HTMLDivElement;
  private decisionsEl: HTMLDivElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private decisions: DecisionLogEntry[] = [];
  private visible = false;

  constructor() {
    this.el = document.getElementById('overview-menu') as HTMLDivElement;
    this.schemeEl = document.getElementById('overview-scheme') as HTMLDivElement;
    this.decisionsEl = document.getElementById('overview-decisions') as HTMLDivElement;
    this.el.style.display = 'none';
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.visible) this.render();
  }

  setDecisionLog(decisions: DecisionLogEntry[]) {
    this.decisions = decisions;
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

  private render() {
    this.renderScheme();
    this.renderDecisions();
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
}
