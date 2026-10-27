import { describe, it, expect, beforeEach } from 'vitest';
import { SchemePanel, type SchemePanelElements } from './SchemePanel';
import type { Topic } from '@shared/types';

function createMockElement(): HTMLElement {
  const el: any = {
    _tag: 'div',
    _className: '',
    textContent: '',
    _innerHTML: '',
    _children: [] as HTMLElement[],
    onclick: null,
    appendChild(child: HTMLElement) {
      this._children.push(child);
    },
    querySelectorAll(selector: string): HTMLElement[] {
      return this._children.filter((c: any) => {
        if (selector === 'button') return c._tag === 'button';
        if (selector === 'li') return c._tag === 'li';
        if (selector === '.warning') return c._tag === 'div' && c._className === 'warning';
        return false;
      });
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v: string) {
      this._innerHTML = v;
      this._children = [];
    },
  });
  Object.defineProperty(el, 'className', {
    get() { return this._className; },
    set(v: string) { this._className = v; },
  });
  return el as HTMLElement;
}

function setupMockDocument() {
  const mockCreateElement = (tag: string): HTMLElement => {
    const el: any = {
      _tag: tag,
      _className: '',
      textContent: '',
      innerHTML: '',
      _innerHTML: '',
      _style: {},
      _children: [] as HTMLElement[],
      onclick: null,
      get style() { return this._style; },
      set style(v: any) { this._style = v; },
      appendChild(child: HTMLElement) {
        this._children.push(child);
      },
      querySelectorAll(selector: string): HTMLElement[] {
        return this._children.filter((c: any) => {
          if (selector === 'button') return c._tag === 'button';
          if (selector === 'li') return c._tag === 'li';
          if (selector === '.warning') return c._tag === 'div' && c._className === 'warning';
          return false;
        });
      },
    };
    Object.defineProperty(el, 'innerHTML', {
      get() { return this._innerHTML; },
      set(v: string) {
        this._innerHTML = v;
        this._children = [];
      },
    });
    Object.defineProperty(el, 'className', {
      get() { return this._className; },
      set(v: string) { this._className = v; },
    });
    return el as HTMLElement;
  };

  (globalThis as any).document = {
    createElement: mockCreateElement,
  };
}

describe('SchemePanel', () => {
  let panel: SchemePanel;
  let tabsEl: HTMLElement;
  let optionsEl: HTMLElement;
  let nameEl: HTMLElement;
  let descEl: HTMLElement;
  let prosEl: HTMLElement;
  let consEl: HTMLElement;
  let warningsEl: HTMLElement;

  const mockTopics: Topic[] = [
    {
      id: 'hvac',
      name: '空调方案',
      options: [
        { id: 'A1', name: 'A1 方案', description: '标准方案', pros: ['高效'], cons: ['价格高'] },
        { id: 'E1', name: 'E1 方案', description: '经济方案', pros: ['便宜'], cons: ['噪音大'] },
      ],
      apply: () => [],
    },
    {
      id: 'floor',
      name: '地面方案',
      options: [
        { id: 'tile', name: '瓷砖', description: '耐磨' },
      ],
      apply: () => [],
    },
  ];

  let comparePanelEl: HTMLElement;

  beforeEach(() => {
    setupMockDocument();
    tabsEl = createMockElement();
    optionsEl = createMockElement();
    nameEl = createMockElement();
    descEl = createMockElement();
    prosEl = createMockElement();
    consEl = createMockElement();
    warningsEl = createMockElement();
    comparePanelEl = createMockElement();

    panel = new SchemePanel({
      topicTabs: tabsEl,
      topicOptions: optionsEl,
      schemeName: nameEl,
      schemeDesc: descEl,
      schemePros: prosEl,
      schemeCons: consEl,
      warnings: warningsEl,
      comparePanel: comparePanelEl,
    });
  });

  it('should render topic tabs on init', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    const buttons = (tabsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('空调方案');
    expect(buttons[1].textContent).toBe('地面方案');
  });

  it('should render options for active topic', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    const buttons = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].innerHTML).toContain('A1 方案');
    expect(buttons[1].innerHTML).toContain('E1 方案');
  });

  it('should switch active topic on tab click', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveTopic('floor');

    const buttons = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].innerHTML).toContain('瓷砖');
  });

  it('should call onSelect when option clicked', () => {
    let selectedTopic = '';
    let selectedOption = '';
    const onSelect = (topicId: string, optionId: string) => {
      selectedTopic = topicId;
      selectedOption = optionId;
    };
    panel.init(mockTopics, onSelect);

    const buttons = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    buttons[0].onclick!();

    expect(selectedTopic).toBe('hvac');
    expect(selectedOption).toBe('A1');
  });

  it('should show option info with pros, cons, and warnings', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', ['注意安装位置']);

    expect(nameEl.textContent).toBe('A1 方案');
    expect(descEl.textContent).toBe('标准方案');
    const prosItems = (prosEl as any)._children.filter((c: any) => c._tag === 'li');
    expect(prosItems.length).toBe(1);
    expect(prosItems[0].textContent).toContain('高效');
    const consItems = (consEl as any)._children.filter((c: any) => c._tag === 'li');
    expect(consItems.length).toBe(1);
    expect(consItems[0].textContent).toContain('价格高');
    const warningDivs = (warningsEl as any)._children.filter((c: any) => c._tag === 'div' && c._className === 'warning');
    expect(warningDivs.length).toBe(1);
    expect(warningDivs[0].textContent).toContain('注意安装位置');
  });

  it('clears info when switching to a topic with no remembered selection', () => {
    // 新语义：切 tab 不再无条件清空选案——只有目标主题没有记忆选案时才 clearInfo。
    // 这里 floor 从未被选过，所以切过去 info 仍被清空（结果同旧行为，但原因已变）。
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', []);
    panel.setActiveTopic('floor');

    expect(nameEl.textContent).toBe('请选择一个方案');
    expect(descEl.textContent).toBe('');
    expect((prosEl as any)._children.length).toBe(0);
    expect((consEl as any)._children.length).toBe(0);
    expect((warningsEl as any)._children.length).toBe(0);
  });

  it('should render budget bar with correct values on updateBudget', () => {
    const containerChildren: any[] = [];
    const container = {
      _children: containerChildren,
      appendChild(child: any) {
        this._children.push(child);
      },
      querySelector(selector: string) {
        if (selector === '.budget-bar') {
          return this._children.find((c: any) => c.className === 'budget-bar') ?? null;
        }
        return null;
      },
    };
    Object.defineProperty(warningsEl, 'parentElement', { get() { return container; }, configurable: true });

    panel.updateBudget({ totalBudget: 200000, totalActual: 150000, categories: [], lineItems: [] });

    const bar = container.querySelector('.budget-bar');
    expect(bar).toBeDefined();
    expect(bar.className).toBe('budget-bar');
    expect(bar.innerHTML).toContain('150,000');
    expect(bar.innerHTML).toContain('200,000');
  });

  it('should use phase ceiling when the backend provides one', () => {
    const containerChildren: any[] = [];
    const container = {
      _children: containerChildren,
      appendChild(child: any) { this._children.push(child); },
      querySelector(selector: string) {
        return selector === '.budget-bar' ? this._children.find((c: any) => c.className === 'budget-bar') ?? null : null;
      },
    };
    Object.defineProperty(warningsEl, 'parentElement', { get() { return container; }, configurable: true });
    panel.updateBudget({ totalBudget: 208000, totalActual: 10000, phaseCeiling: 200000, categories: [], lineItems: [] });
    const bar = container.querySelector('.budget-bar');
    expect(bar.innerHTML).toContain('场景估算 / 阶段上限');
    expect(bar.innerHTML).toContain('200,000');
    expect(bar.innerHTML).not.toContain('208,000');
  });

  it('should mark active tab and option', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', []);

    const tabs = (tabsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(tabs[0]._className).toContain('active');

    const options = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(options[0]._className).toContain('active');
  });

  it('applySchemeSelections shows the first topic that has a selection and marks its option active', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    // topics 顺序 [hvac, floor]，两者都有选案 → 展示第一个（hvac）
    panel.applySchemeSelections({ floor: 'tile', hvac: 'A1' });

    expect(panel.getActiveTopicId()).toBe('hvac');
    expect(panel.getActiveOptionId()).toBe('A1');
    const options = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(options[0]._className).toContain('active'); // A1
    expect(options[1]._className).not.toContain('active'); // E1
    expect(nameEl.textContent).toBe('A1 方案');
  });

  it('switching to another topic with a selection shows that topic selection and info', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.applySchemeSelections({ floor: 'tile', hvac: 'A1' });
    panel.setActiveTopic('floor');

    expect(panel.getActiveTopicId()).toBe('floor');
    expect(panel.getActiveOptionId()).toBe('tile');
    expect(nameEl.textContent).toBe('瓷砖');
    const options = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(options[0]._className).toContain('active'); // tile
  });

  it('switching to a topic without a selection shows an empty selection', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.applySchemeSelections({ hvac: 'A1' }); // 只选了 hvac
    panel.setActiveTopic('floor'); // floor 无选案

    expect(panel.getActiveTopicId()).toBe('floor');
    expect(panel.getActiveOptionId()).toBe('');
    expect(nameEl.textContent).toBe('请选择一个方案');
    const options = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(options[0]._className).not.toContain('active');
  });

  it('applySchemeSelections ignores unknown topicIds and falls back to the first panel topic', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    // robot_vacuum 不在面板导航主题里：进 map 但不影响展示，回退到第一个主题 hvac。
    // 这条正是缺陷 2 的根因回归——旧实现会把 activeTopicId 停在 robot_vacuum，
    // 导致无 tab 激活、选项列表全空。
    panel.applySchemeSelections({ robot_vacuum: 'X1' });
    expect(panel.getActiveTopicId()).toBe('hvac');
    expect(panel.getActiveOptionId()).toBe('');

    // 未知键与已知键并存时，展示第一个「面板拥有的」有选案主题，而非最后一个 selections 键。
    panel.applySchemeSelections({ robot_vacuum: 'X1', floor: 'tile', hvac: 'A1' });
    expect(panel.getActiveTopicId()).toBe('hvac');
    expect(panel.getActiveOptionId()).toBe('A1');
  });

  it('setActiveOption memory is restored when switching back via setActiveTopic', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', ['注意安装位置']);
    panel.setActiveTopic('floor');
    panel.setActiveTopic('hvac');

    expect(panel.getActiveTopicId()).toBe('hvac');
    expect(panel.getActiveOptionId()).toBe('A1');
    expect(nameEl.textContent).toBe('A1 方案');
  });
});
