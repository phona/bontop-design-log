import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElementStatePanel } from './ElementStatePanel.js';
import type { HouseScene } from '../HouseScene.js';

// 与 CeilingQuotePanel.test 同用 jsdom 真实 DOM；用假 HouseScene 驱动 inspect/solo。
function makeInspection() {
  return {
    summary: { total: 4, byStatus: { confirmed: 1, pending: 2, undeclared: 1 }, byKind: { electrical: 2, ceiling: 1, plumbing: 1 } },
    byStatus: [
      { status: 'confirmed', count: 1 },
      { status: 'pending', count: 2 },
      { status: 'undeclared', count: 1 },
    ],
    byKind: [
      { kind: 'electrical', count: 2 },
      { kind: 'ceiling', count: 1 },
      { kind: 'plumbing', count: 1 },
    ],
    elements: [
      { id: 'ceiling:ceiling_living', kind: 'ceiling', label: '石膏板 ceiling_living', room: 'living_dining', status: 'confirmed', statusSource: 'config:confirmed', conflicts: [], batched: false, inScene: true },
      { id: 'electrical:sock_child_ac', kind: 'electrical', label: 'socket sock_child_ac', room: 'child', status: 'pending', statusSource: 'pending-site-data #42', openQuestion: { ref: '42', summary: '儿童房空调电源', blockedBy: '卡在空调厂家深化图' }, conflicts: [], batched: true, inScene: true },
      { id: 'plumbing:drain_kitchen', kind: 'plumbing', label: 'drain drain_kitchen', room: 'kitchen', status: 'pending', statusSource: 'config:pending', conflicts: ['spatial.clearance'], batched: true, inScene: true },
      { id: 'electrical:panel_weak', kind: 'electrical', label: 'weak panel', status: 'undeclared', statusSource: 'no status field', conflicts: [], batched: true, inScene: false },
    ],
  } as unknown as ReturnType<HouseScene['inspectElementStates']>;
}

describe('ElementStatePanel', () => {
  let solo: string | null;
  let houseScene: HouseScene;
  let panel: ElementStatePanel;

  beforeEach(() => {
    document.body.innerHTML = '<div id="right-panel-stack"></div>';
    solo = null;
    const inspection = makeInspection();
    houseScene = {
      inspectElementStates: () => inspection,
      getElementStateSolo: () => solo,
      setElementStateSolo: vi.fn((target: string | null) => { solo = target; }),
    } as unknown as HouseScene;
    panel = new ElementStatePanel(houseScene);
  });

  it('renders legend counts and by-kind summary', () => {
    panel.show();
    const body = document.querySelector('#element-state-body') as HTMLElement;
    expect(body.textContent).toContain('共 4 个构件');
    expect(body.textContent).toContain('已确认 1');
    expect(body.textContent).toContain('待现场数据 2');
    expect(body.textContent).toContain('未申报 1');
    expect(body.textContent).toContain('电气 2');
    expect(body.textContent).toContain('给排水 1');
  });

  it('未决问题列显示 openQuestion.blockedBy，冲突列显示 issue code', () => {
    panel.show();
    const body = document.querySelector('#element-state-body') as HTMLElement;
    const sockRow = body.querySelector('tr[data-solo-id="electrical:sock_child_ac"]') as HTMLElement;
    expect(sockRow.textContent).toContain('卡在空调厂家深化图');
    const drainRow = body.querySelector('tr[data-solo-id="plumbing:drain_kitchen"]') as HTMLElement;
    expect(drainRow.textContent).toContain('spatial.clearance');
  });

  it('点击图例 status 触发 solo，再点取消', () => {
    panel.show();
    const legendBtn = document.querySelector('[data-solo-status="pending"]') as HTMLButtonElement;
    legendBtn.click();
    expect(houseScene.setElementStateSolo).toHaveBeenCalledWith('pending');
    legendBtn.click();
    expect(houseScene.setElementStateSolo).toHaveBeenLastCalledWith(null);
  });

  it('点击构件行触发 solo 该 id，再点取消', () => {
    panel.show();
    const row = document.querySelector('tr[data-solo-id="electrical:sock_child_ac"]') as HTMLElement;
    row.click();
    expect(houseScene.setElementStateSolo).toHaveBeenCalledWith('electrical:sock_child_ac');
    row.click();
    expect(houseScene.setElementStateSolo).toHaveBeenLastCalledWith(null);
  });

  it('solo 中显示取消隔离入口', () => {
    solo = 'pending';
    panel.show();
    const clear = document.querySelector('#element-state-clear-solo') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear.click();
    expect(houseScene.setElementStateSolo).toHaveBeenCalledWith(null);
  });

  it('hide 后面板隐藏', () => {
    panel.show();
    expect(panel.isVisible()).toBe(true);
    panel.hide();
    expect(panel.isVisible()).toBe(false);
    expect((document.querySelector('#element-state-panel') as HTMLElement).style.display).toBe('none');
  });
});
