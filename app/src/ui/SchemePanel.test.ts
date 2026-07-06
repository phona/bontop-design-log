// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SchemePanel } from './SchemePanel';
import type { Topic } from '@shared/types';

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
    document.body.innerHTML = `
      <div id="topic-tabs"></div>
      <div id="topic-options"></div>
      <div id="scheme-name"></div>
      <div id="scheme-desc"></div>
      <div id="scheme-pros"></div>
      <div id="scheme-cons"></div>
      <div id="warnings"></div>
    `;
    tabsEl = document.getElementById('topic-tabs')!;
    optionsEl = document.getElementById('topic-options')!;
    nameEl = document.getElementById('scheme-name')!;
    descEl = document.getElementById('scheme-desc')!;
    prosEl = document.getElementById('scheme-pros')!;
    consEl = document.getElementById('scheme-cons')!;
    warningsEl = document.getElementById('warnings')!;

    panel = new SchemePanel();
  });

  it('should render topic tabs on init', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    const buttons = tabsEl.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe('空调方案');
    expect(buttons[1].textContent).toBe('地面方案');
  });

  it('should render options for active topic', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    const buttons = optionsEl.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0].innerHTML).toContain('A1 方案');
    expect(buttons[1].innerHTML).toContain('E1 方案');
  });

  it('should switch active topic on tab click', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveTopic('floor');

    const buttons = optionsEl.querySelectorAll('button');
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

    const buttons = optionsEl.querySelectorAll('button');
    (buttons[0] as HTMLElement).click();

    expect(selectedTopic).toBe('hvac');
    expect(selectedOption).toBe('A1');
  });

  it('should show option info with pros, cons, and warnings', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', ['注意安装位置']);

    expect(nameEl.textContent).toBe('A1 方案');
    expect(descEl.textContent).toBe('标准方案');
    expect(prosEl.querySelectorAll('li').length).toBe(1);
    expect(prosEl.textContent).toContain('高效');
    expect(consEl.querySelectorAll('li').length).toBe(1);
    expect(consEl.textContent).toContain('价格高');
    expect(warningsEl.querySelectorAll('.warning').length).toBe(1);
    expect(warningsEl.textContent).toContain('注意安装位置');
  });

  it('should clear info when switching topic', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', []);
    panel.setActiveTopic('floor');

    expect(nameEl.textContent).toBe('请选择一个方案');
    expect(descEl.textContent).toBe('');
    expect(prosEl.innerHTML).toBe('');
    expect(consEl.innerHTML).toBe('');
    expect(warningsEl.innerHTML).toBe('');
  });

  it('should mark active tab and option', () => {
    const onSelect = () => {};
    panel.init(mockTopics, onSelect);

    panel.setActiveOption('hvac', 'A1', []);

    const tabs = tabsEl.querySelectorAll('button');
    expect(tabs[0].className).toContain('active');

    const options = optionsEl.querySelectorAll('button');
    expect(options[0].className).toContain('active');
  });
});
