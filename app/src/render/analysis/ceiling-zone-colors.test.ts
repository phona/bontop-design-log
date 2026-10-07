import { describe, it, expect } from 'vitest';
import { ceilingZoneColor, TRADE_COLOR, UNCLASSIFIED_COLOR } from './ceiling-zone-colors.js';
import type { CeilingTradeClass } from '@shared/ceiling-takeoff';

/** config/ceiling.yaml 的 19 个实心分区 id，按工艺分类（DEC-2026-10-08-C01）。 */
const GYPSUM = [
  'ceiling_living', 'ceiling_dining_west_band', 'ceiling_dining_north_band', 'ceiling_main_corridor',
  'ceiling_corridor', 'ceiling_entry_foyer', 'ceiling_master_ac', 'ceiling_study_ac',
  'ceiling_study_ac_corner', 'ceiling_child_ac',
];
const BUCKLE = ['ceiling_kitchen', 'ceiling_master_bath', 'ceiling_guest_bath'];
const CURTAIN = [
  'curtain_box_living', 'curtain_box_master_west', 'curtain_box_master_south',
  'curtain_box_parent_south', 'curtain_box_study_south',
];
const DRYING = ['drying_rack_living'];

describe('吊顶分区配色', () => {
  it('19 个实心分区拿到 19 个互不相同的颜色', () => {
    const all: Array<[string, CeilingTradeClass]> = [
      ...GYPSUM.map((id) => [id, 'gypsum_board'] as [string, CeilingTradeClass]),
      ...BUCKLE.map((id) => [id, 'aluminum_buckle'] as [string, CeilingTradeClass]),
      ...CURTAIN.map((id) => [id, 'curtain_box'] as [string, CeilingTradeClass]),
      ...DRYING.map((id) => [id, 'drying_rack'] as [string, CeilingTradeClass]),
    ];
    expect(all.length).toBe(19);
    const colors = all.map(([id, trade]) => ceilingZoneColor(id, trade));
    expect(new Set(colors).size).toBe(19);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('同工艺族内颜色接近，跨族明显区分（看得出一眼分类）', () => {
    const gypsum = GYPSUM.map((id) => ceilingZoneColor(id, 'gypsum_board'));
    const buckle = BUCKLE.map((id) => ceilingZoneColor(id, 'aluminum_buckle'));
    // 族基准色就是 trade 模式的色，按分区取色时不应等于别族基准
    for (const color of gypsum) expect(BUCKLE.map((id) => ceilingZoneColor(id, 'aluminum_buckle'))).not.toContain(color);
    for (const color of buckle) expect(TRADE_COLOR.gypsum_board).not.toBe(color);
  });

  it('哈希稳定：与声明顺序、传入次数无关', () => {
    const first = ceilingZoneColor('ceiling_living', 'gypsum_board');
    for (let i = 0; i < 5; i += 1) expect(ceilingZoneColor('ceiling_living', 'gypsum_board')).toBe(first);
    expect(ceilingZoneColor('ceiling_living', 'gypsum_board', 'zone')).toBe(first);
  });

  it('按工艺归并模式：同族同色、跨族异色', () => {
    expect(ceilingZoneColor('ceiling_living', 'gypsum_board', 'trade')).toBe(ceilingZoneColor('ceiling_corridor', 'gypsum_board', 'trade'));
    expect(ceilingZoneColor('ceiling_living', 'gypsum_board', 'trade')).toBe(TRADE_COLOR.gypsum_board);
    expect(TRADE_COLOR.gypsum_board).not.toBe(TRADE_COLOR.aluminum_buckle);
    expect(TRADE_COLOR.curtain_box).not.toBe(TRADE_COLOR.drying_rack);
  });

  it('未归类分区用专用警示色，不冒充任何工艺族', () => {
    expect(ceilingZoneColor('whatever', null)).toBe(UNCLASSIFIED_COLOR);
    expect(UNCLASSIFIED_COLOR).not.toBe(TRADE_COLOR.gypsum_board);
  });
});
