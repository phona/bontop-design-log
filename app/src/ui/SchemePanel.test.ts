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

  beforeEach(() => {
    setupMockDocument();
    tabsEl = createMockElement();
    optionsEl = createMockElement();
    nameEl = createMockElement();
    descEl = createMockElement();
    prosEl = createMockElement();
    consEl = createMockElement();
    warningsEl = createMockElement();

    panel = new SchemePanel({
      topicTabs: tabsEl,
      topicOptions: optionsEl,
      schemeName: nameEl,
      schemeDesc: descEl,
      schemePros: prosEl,
      schemeCons: consEl,
      warnings: warningsEl,
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

  it('should clear info when switching topic', () => {
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

  it('should mark active tab and option', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', []);

    const tabs = (tabsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(tabs[0]._className).toContain('active');

    const options = (optionsEl as any)._children.filter((c: any) => c._tag === 'button');
    expect(options[0]._className).toContain('active');
  });
});
