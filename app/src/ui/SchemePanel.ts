import type { Topic, TopicOption } from '@shared/types';

export interface SchemePanelElements {
  topicTabs: HTMLElement;
  topicOptions: HTMLElement;
  schemeName: HTMLElement;
  schemeDesc: HTMLElement;
  schemePros: HTMLElement;
  schemeCons: HTMLElement;
  warnings: HTMLElement;
}

export class SchemePanel {
  private topics: Topic[] = [];
  private activeTopicId = 'hvac';
  private activeOptionId = '';
  private onSelect?: (topicId: string, optionId: string) => void;
  private els: SchemePanelElements;

  constructor(els: SchemePanelElements) {
    this.els = els;
  }

  init(topics: Topic[], onSelect: (topicId: string, optionId: string) => void) {
    this.topics = topics;
    this.onSelect = onSelect;
    this.renderTabs();
    this.renderOptions();
  }

  setActiveTopic(topicId: string) {
    this.activeTopicId = topicId;
    this.activeOptionId = '';
    this.renderTabs();
    this.renderOptions();
    this.clearInfo();
  }

  setActiveOption(topicId: string, optionId: string, warnings: string[]) {
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
      btn.innerHTML = `<strong>${option.name}</strong><br><small>${option.description ?? ''}</small>`;
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

  private clearInfo() {
    this.els.schemeName.textContent = '请选择一个方案';
    this.els.schemeDesc.textContent = '';
    this.els.schemePros.innerHTML = '';
    this.els.schemeCons.innerHTML = '';
    this.els.warnings.innerHTML = '';
  }
}
