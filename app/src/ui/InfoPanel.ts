import type { Topic, CurrentScheme, TopicSelection, CurtainPresentationState, CurtainState } from '@shared/types';
import { getTopicsForObject } from '../data/objectMapping.js';

export interface HoverTarget {
  objectId: string;
  name: string;
  type: string;
  room?: string;
  curtainId?: string;
  curtainKind?: 'sheer_blackout' | 'blinds';
  layer?: 'sheer' | 'blackout' | 'blinds';
}

export interface InfoPanelCallbacks {
  onSelectOption: (topicId: string, optionId: string, roomId: string | null) => void;
  onCurtainStateChange?: (state: CurtainState, roomId: string) => void;
}

export class InfoPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private typeEl: HTMLSpanElement;
  private roomEl: HTMLSpanElement;
  private topicsEl: HTMLDivElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private presentationState: CurtainPresentationState | null = null;
  private callbacks: InfoPanelCallbacks;
  private currentTarget: HoverTarget | null = null;

  constructor(callbacks: InfoPanelCallbacks) {
    this.callbacks = callbacks;
    this.el = document.getElementById('info-panel') as HTMLDivElement;
    this.titleEl = document.getElementById('info-panel-title') as HTMLSpanElement;
    this.typeEl = document.getElementById('info-panel-type') as HTMLSpanElement;
    this.roomEl = document.getElementById('info-panel-room') as HTMLSpanElement;
    this.topicsEl = document.getElementById('info-panel-topics') as HTMLDivElement;
    this.el.style.display = 'none';
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.currentTarget) this.render();
  }

  setPresentationState(state: CurtainPresentationState) {
    this.presentationState = state;
    if (this.currentTarget) this.render();
  }

  showObject(target: HoverTarget) {
    this.currentTarget = target;
    this.el.style.display = 'block';
    this.render();
  }

  hide() {
    this.currentTarget = null;
    this.el.style.display = 'none';
  }

  private render() {
    if (!this.currentTarget) return;

    this.titleEl.textContent = this.currentTarget.name;
    this.typeEl.textContent = this.currentTarget.type;
    this.roomEl.textContent = this.currentTarget.room ?? '';

    const relatedTopicIds = getTopicsForObject(this.currentTarget.objectId);
    this.topicsEl.innerHTML = '';

    if (this.currentTarget.curtainId && this.currentTarget.room) {
      this.topicsEl.appendChild(this.renderCurtainSection(this.currentTarget.room, this.currentTarget.curtainKind ?? 'sheer_blackout'));
    }

    for (const topicId of relatedTopicIds) {
      const topic = this.topics.find((t) => t.id === topicId);
      if (!topic) continue;

      const selection = this.scheme?.selections[topicId];
      if (!selection) continue;

      const section = this.renderTopicSection(topic, selection, this.currentTarget.room);
      this.topicsEl.appendChild(section);
    }
  }

  private renderCurtainSection(roomId: string, kind: 'sheer_blackout' | 'blinds'): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'info-topic-section';
    const current = this.presentationState?.roomOverrides[roomId] ?? this.presentationState?.default ?? 'open';
    const normalized = kind === 'blinds' && current === 'blackout' ? 'privacy' : current;
    const header = document.createElement('h4');
    header.textContent = `窗帘状态：${normalized === 'open' ? '完全收起' : normalized === 'privacy' ? '隐私' : '遮光'}`;
    section.appendChild(header);
    const list = document.createElement('div');
    list.className = 'info-scope-row';
    const options: Array<{ state: CurtainState; label: string }> = kind === 'blinds'
      ? [{ state: 'open', label: '完全收起' }, { state: 'privacy', label: '隐私' }]
      : [{ state: 'open', label: '完全收起' }, { state: 'privacy', label: '纱帘' }, { state: 'blackout', label: '遮光' }];
    for (const option of options) {
      const button = document.createElement('button');
      button.className = `info-option-btn${option.state === normalized ? ' active' : ''}`;
      button.textContent = option.label;
      button.onclick = () => this.callbacks.onCurtainStateChange?.(option.state, roomId);
      list.appendChild(button);
    }
    section.appendChild(list);
    return section;
  }

  private renderTopicSection(
    topic: Topic,
    selection: TopicSelection,
    roomId?: string
  ): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'info-topic-section';

    const header = document.createElement('h4');
    const effectiveOptionId = roomId && selection.roomOverrides[roomId]
      ? selection.roomOverrides[roomId]
      : selection.default;
    const effectiveOption = topic.options.find((o) => o.id === effectiveOptionId);
    header.textContent = `${topic.name}：${effectiveOption?.name ?? '未选择'}`;
    section.appendChild(header);

    if (roomId && selection.roomOverrides[roomId]) {
      const badge = document.createElement('span');
      badge.className = 'info-badge';
      badge.textContent = '房间覆盖';
      section.appendChild(badge);
    }

    const optionsList = document.createElement('div');
    optionsList.className = 'info-options-list';

    for (const option of topic.options) {
      if (roomId) {
        const wrapper = document.createElement('div');
        wrapper.className = 'info-option-wrapper';

        const btn = document.createElement('button');
        btn.className = `info-option-btn${option.id === effectiveOptionId ? ' active' : ''}`;
        btn.textContent = option.name;
        wrapper.appendChild(btn);

        const scopeRow = document.createElement('div');
        scopeRow.className = 'info-scope-row';

        const roomBtn = document.createElement('button');
        roomBtn.className = 'info-scope-btn';
        roomBtn.textContent = '仅当前房间';
        roomBtn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, roomId);

        const globalBtn = document.createElement('button');
        globalBtn.className = 'info-scope-btn';
        globalBtn.textContent = '所有房间';
        globalBtn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, null);

        scopeRow.appendChild(roomBtn);
        scopeRow.appendChild(globalBtn);
        wrapper.appendChild(scopeRow);
        optionsList.appendChild(wrapper);
      } else {
        const btn = document.createElement('button');
        btn.className = `info-option-btn${option.id === effectiveOptionId ? ' active' : ''}`;
        btn.textContent = option.name;
        btn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, null);
        optionsList.appendChild(btn);
      }
    }

    section.appendChild(optionsList);
    return section;
  }
}
