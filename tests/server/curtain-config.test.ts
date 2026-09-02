import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOverlay } from '../../server/overlay-merge.js';

function refs(element: { wall?: string; walls?: string[] }): string[] {
  return element.walls ?? (element.wall ? [element.wall] : []);
}

describe('curtain overlay coverage', () => {
  it('keeps required rooms and locks corrected wall ownership', () => {
    const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
    const curtains = overlay.elements.filter((element) => element.type === 'curtain');
    const rooms = new Set(curtains.map((element) => element.room));
    for (const room of ['living_dining', 'master_bedroom', 'study', 'bedroom_se', 'bedroom_nw']) {
      assert.ok(rooms.has(room), `${room} must have a curtain`);
    }
    assert.ok(!rooms.has('kitchen'), 'kitchen must remain without curtains');

    const byId = new Map(curtains.map((element) => [element.id, element]));
    // 2026-09-02 初版：w_west_mid 条带段拆分为盆区百叶格（points）+ 布帘段（points），
    // curtain_master_west 只保留 w_west_upper 墙引用；量房后切墙并恢复墙引用
    assert.deepEqual(refs(byId.get('curtain_master_west')!), ['w_west_upper']);
    assert.equal(byId.get('curtain_master_strip_fabric')!.room, 'master_bedroom');
    assert.equal(byId.get('curtain_mb_washbasin_blinds')!.kind, 'blinds');
    assert.equal(byId.get('curtain_mb_washbasin_blinds')!.room, 'master_bath');
    const frosted = overlay.elements.find((element) => element.type === 'frosted_privacy');
    assert.deepEqual(frosted && 'points' in frosted ? frosted.points : [], [{ x: 0, z: 2.86 }, { x: 0, z: 4.00 }]);
    assert.equal(frosted && 'finish' in frosted ? frosted.finish : undefined, 'frosted_privacy');
    assert.equal(byId.has('curtain_nw_west'), false);
    assert.deepEqual(refs(byId.get('curtain_nw_north')!), ['w_nw_north']);
    assert.deepEqual(refs(byId.get('curtain_mbath_corner')!), ['w_west_lower', 'w_west_ap', 'w_bath_north']);
  });
});
