import type { Topic, CurrentScheme, TopicSelection, CurtainPresentationState, CurtainState, ElectricalTopology } from '@shared/types';
import { getTopicsForObject } from '../data/objectMapping.js';
import { setupCollapsiblePanel } from './CollapsiblePanel.js';

export interface HoverTarget {
  objectId: string;
  name: string;
  type: string;
  room?: string;
  curtainId?: string;
  curtainKind?: 'sheer_blackout' | 'blinds';
  layer?: 'sheer' | 'blackout' | 'blinds';
  mep?: {
    routeId?: string; status?: string; sourceStatus?: string; constructionStatus?: string;
    from?: unknown; to?: unknown; points?: Array<{ x: number; y?: number; z: number }>;
    reason?: string; label?: string; dimensions?: { diameter?: number; width?: number; depth?: number };
    lintLevel?: string; lintCodes?: string[]; lintWarnings?: string[];
    notForConstruction?: boolean; source?: string; range?: { x1: number; x2: number; z1: number; z2: number };
    height?: number; uncertainty?: string; risk?: string; surveyConfirmation?: string;
  };
  infrastructure?: { fixtureType?: string; height?: number; mountHeight?: number; bodyHeight?: number; wallSide?: string };
  electricalTopology?: {
    circuitIds: string[]; controlIds: string[]; notes: string[];
    panelId?: string; memberPointIds?: string[]; memberPointId?: string;
    purpose?: string; status?: string; pendingParameters?: string[];
    controlsIncomplete?: boolean; controlsPending?: boolean; notForConstruction?: boolean;
    representation?: string; relation?: string;
  };
  ceiling?: { area?: [number, number, number, number]; thickness?: number; type?: string; room?: string; height?: number };
}

export interface InfoPanelCallbacks {
  onSelectOption: (topicId: string, optionId: string, roomId: string | null) => void;
  onCurtainStateChange?: (state: CurtainState, roomId: string) => void;
}

export class InfoPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private objectIdEl: HTMLSpanElement;
  private typeEl: HTMLSpanElement;
  private roomEl: HTMLSpanElement;
  private topicsEl: HTMLDivElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private presentationState: CurtainPresentationState | null = null;
  private electricalTopology: ElectricalTopology | null = null;
  private callbacks: InfoPanelCallbacks;
  private currentTarget: HoverTarget | null = null;

  constructor(callbacks: InfoPanelCallbacks) {
    this.callbacks = callbacks;
    this.el = document.getElementById('info-panel') as HTMLDivElement;
    this.titleEl = document.getElementById('info-panel-title') as HTMLSpanElement;
    this.objectIdEl = document.getElementById('info-panel-object-id') as HTMLSpanElement;
    this.typeEl = document.getElementById('info-panel-type') as HTMLSpanElement;
    this.roomEl = document.getElementById('info-panel-room') as HTMLSpanElement;
    this.topicsEl = document.getElementById('info-panel-topics') as HTMLDivElement;
    const getElementById = document.getElementById?.bind(document);
    const toggle = getElementById?.('info-panel-toggle') as HTMLButtonElement | null;
    const content = getElementById?.('info-panel-content');
    if (toggle && content) setupCollapsiblePanel(toggle, content, true);
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

  setElectricalTopology(topology: ElectricalTopology | null) {
    this.electricalTopology = topology;
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
    this.objectIdEl.textContent = `objectId: ${this.currentTarget.objectId}`;
    this.typeEl.textContent = this.currentTarget.type;
    this.roomEl.textContent = this.currentTarget.room ?? '';

    const relatedTopicIds = getTopicsForObject(this.currentTarget.objectId);
    this.topicsEl.innerHTML = '';
    const pointId = this.currentTarget.objectId.startsWith('electrical:') ? this.currentTarget.objectId.slice('electrical:'.length) : undefined;
    if (pointId && this.electricalTopology) {
      const circuits = this.electricalTopology.circuits.filter((c) => c.member_point_ids.includes(pointId));
      const circuitIds = circuits.map((c) => c.id);
      const controls = this.electricalTopology.controls.filter((c) => c.switch_point_ids.includes(pointId) || c.target_point_ids.includes(pointId));
      const controlIds = controls.map((c) => c.id);
      const notes = circuits.map((c) => c.note).filter((note): note is string => Boolean(note));
      const controlsIncomplete = controls.some((control) => control.target_point_ids.length === 0);
      if (controlsIncomplete) notes.push('受控灯具待电气交底');
      this.currentTarget.electricalTopology = {
        circuitIds, controlIds, notes, pendingParameters: this.electricalTopology.pending_parameters,
        controlsIncomplete, controlsPending: controls.some((control) => control.status !== 'confirmed'),
      };
    }
    this.renderMepContext(this.currentTarget);

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

  private renderMepContext(target: HoverTarget): void {
    const context = target.mep ?? target.infrastructure ?? target.electricalTopology ?? target.ceiling;
    if (!context) return;
    const section = document.createElement('div');
    section.className = 'info-topic-section info-mep-context';
    const title = document.createElement('h4');
    title.textContent = '机电信息';
    section.appendChild(title);
    const fields: Array<[string, string | undefined]> = [];
    if (target.mep) {
      const m = target.mep;
      if (m.routeId) fields.push(['路线', m.routeId]);
      if (m.label) fields.push(['名称', m.label]);
      if (m.from !== undefined) fields.push(['起点', this.formatEndpoint(m.from)]);
      if (m.to !== undefined) fields.push(['终点', this.formatEndpoint(m.to)]);
      if (m.status) fields.push(['状态', m.status]);
      if (m.sourceStatus) fields.push(['来源', m.sourceStatus]);
      if (m.constructionStatus) fields.push(['施工状态', m.constructionStatus]);
      if (m.lintLevel) fields.push(['Lint', m.lintLevel]);
      if (m.lintCodes?.length) fields.push(['Lint codes', m.lintCodes.join('，')]);
      if (m.lintWarnings?.length) fields.push(['Lint warnings', m.lintWarnings.join('；')]);
      if (m.height !== undefined) fields.push(['标高', `${m.height.toFixed(2)}m`]);
      if (m.points?.length) fields.push(['路线标高', m.points.map((p) => `${(p.y ?? 0).toFixed(2)}m`).join(' → ')]);
      if (m.dimensions && Object.values(m.dimensions).some((v) => v !== undefined)) fields.push(['尺寸', Object.entries(m.dimensions).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}m`).join('，')]);
      if (m.reason) fields.push(['原因', m.reason]);
      if (m.source) fields.push(['依据', m.source]);
      if (m.range) fields.push(['范围', `x[${m.range.x1},${m.range.x2}] z[${m.range.z1},${m.range.z2}]`]);
      if (m.risk) fields.push(['风险', m.risk]);
      if (m.surveyConfirmation) fields.push(['待确认', m.surveyConfirmation]);
      if (m.notForConstruction) fields.push(['提示', '非施工依据 / 待现场确认']);
    } else if (target.electricalTopology) {
      const e = target.electricalTopology;
      title.textContent = '电气回路归属（非施工路径）';
      if (e.panelId) fields.push(['面板', e.panelId]);
      if (e.circuitIds.length) fields.push(['回路', e.circuitIds.join('，')]);
      if (e.purpose) {
        const purposeLabels: Record<string, string> = { lighting: '照明', hvac_power: '空调电源', dedicated_load: '专用负载', ordinary_power: '普通功能电源' };
        fields.push(['用途', purposeLabels[e.purpose] ?? e.purpose]);
      }
      if (e.status) fields.push(['状态', e.status]);
      if (e.memberPointId) fields.push(['成员点位', e.memberPointId]);
      if (e.memberPointIds?.length) fields.push(['成员点位', e.memberPointIds.join('，')]);
      if (e.controlIds.length) fields.push(['关联控制组', e.controlIds.join('，')]);
      if (e.controlsIncomplete) fields.push(['控制组', '未闭合']);
      if (e.controlsPending) fields.push(['控制状态', '待确认']);
      if (e.notes.length) fields.push(['说明', e.notes.join('；')]);
      if (e.pendingParameters?.length) fields.push(['待定参数', e.pendingParameters.join('；')]);
      if (e.relation) fields.push(['关系', e.relation]);
      if (e.representation) fields.push(['表示', e.representation]);
      fields.push(['提示', '仅表示面板—回路—点位归属，不表示电缆、线管或墙内/吊顶内/地面施工路径']);
    } else if (target.ceiling) {
      const c = target.ceiling;
      if (c.room) fields.push(['房间', c.room]);
      if (c.type) fields.push(['类型', c.type]);
      if (c.area) fields.push(['范围', `x[${c.area[0]},${c.area[2]}] z[${c.area[1]},${c.area[3]}]`]);
      if (c.thickness !== undefined) fields.push(['厚度', `${c.thickness}m`]);
      if (c.height !== undefined) fields.push(['标高', `${c.height}m`]);
    } else if (target.infrastructure) {
      const i = target.infrastructure;
      if (i.fixtureType) fields.push(['点位类型', i.fixtureType]);
      if (i.height !== undefined) fields.push(['高度', `${i.height}m`]);
      if (i.mountHeight !== undefined) fields.push(['安装高度', `${i.mountHeight}m`]);
      if (i.bodyHeight !== undefined) fields.push(['尺寸高度', `${i.bodyHeight}m`]);
      if (i.wallSide) fields.push(['墙面', i.wallSide]);
    }
    for (const [label, value] of fields) {
      if (value === undefined) continue;
      const row = document.createElement('div');
      row.className = 'info-mep-row';
      const key = document.createElement('span'); key.textContent = `${label}：`;
      const val = document.createElement('span'); val.textContent = value;
      row.appendChild(key); row.appendChild(val); section.appendChild(row);
    }
    this.topicsEl.appendChild(section);
  }

  private formatEndpoint(value: unknown): string {
    if (typeof value === 'string') return `${value}（稳定端点 ID）`;
    return this.formatValue(value);
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object' && 'x' in value && 'z' in value) {
      const point = value as { x: number; y?: number; z: number };
      return `(${point.x}, ${point.y !== undefined ? `${point.y}, ` : ''}${point.z})`;
    }
    return '未解析';
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
