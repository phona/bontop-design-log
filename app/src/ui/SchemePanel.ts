import type { Topic, TopicOption } from '@shared/types';

export class SchemePanel {
  private topics: Topic[] = [];
  private activeTopicId = 'hvac';
  private activeOptionId = '';
  private onSelect?: (topicId: string, optionId: string) => void;

  private topicTabsEl = document.getElementById('topic-tabs')!;
  private topicOptionsEl = document.getElementById('topic-options')!;
  private schemeNameEl = document.getElementById('scheme-name')!;
  private schemeDescEl = document.getElementById('scheme-desc')!;
  private schemeProsEl = document.getElementById('scheme-pros')!;
  private schemeConsEl = document.getElementById('scheme-cons')!;
  private warningsEl = document.getElementById('warnings')!;

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

  private renderTabs() {
    this.topicTabsEl.innerHTML = '';
    for (const topic of this.topics) {
      const btn = document.createElement('button');
      btn.className = `topic-tab${topic.id === this.activeTopicId ? ' active' : ''}`;
      btn.textContent = topic.name;
      btn.onclick = () => this.setActiveTopic(topic.id);
      this.topicTabsEl.appendChild(btn);
    }
  }

  private renderOptions() {
    this.topicOptionsEl.innerHTML = '';
    const topic = this.topics.find((t) => t.id === this.activeTopicId);
    if (!topic) return;
    for (const option of topic.options) {
      const btn = document.createElement('button');
      btn.className = `scheme-btn${option.id === this.activeOptionId ? ' active' : ''}`;
      btn.innerHTML = `<strong>${option.name}</strong><br><small>${option.description ?? ''}</small>`;
      btn.onclick = () => this.onSelect?.(topic.id, option.id);
      this.topicOptionsEl.appendChild(btn);
    }
  }

  private showInfo(option: TopicOption, warnings: string[]) {
    this.schemeNameEl.textContent = option.name;
    this.schemeDescEl.textContent = option.description ?? '';

    this.schemeProsEl.innerHTML = '';
    (option.pros ?? []).forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      this.schemeProsEl.appendChild(li);
    });

    this.schemeConsEl.innerHTML = '';
    (option.cons ?? []).forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      this.schemeConsEl.appendChild(li);
    });

    this.warningsEl.innerHTML = '';
    for (const w of warnings) {
      const div = document.createElement('div');
      div.className = 'warning';
      div.textContent = w;
      this.warningsEl.appendChild(div);
    }
  }

  private clearInfo() {
    this.schemeNameEl.textContent = '请选择一个方案';
    this.schemeDescEl.textContent = '';
    this.schemeProsEl.innerHTML = '';
    this.schemeConsEl.innerHTML = '';
    this.warningsEl.innerHTML = '';
  }
}
