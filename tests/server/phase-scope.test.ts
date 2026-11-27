import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterFurnishings, isBudgetTopicIncluded, loadPhaseScopes } from '../../server/phase-scope.js';

describe('phase scope', () => {
  it('fails closed for unlisted furnishing ids/types and preserves source identity', () => {
    const scopes = loadPhaseScopes();
    const filtered = filterFurnishings({
      guest_bath: [
        { type: 'vanity', id: 'gbath.vanity', x: 6.79, z: 3.925 },
        { type: 'future_guest_bath_furniture', id: 'gbath.future_thing', x: 6.5, z: 3.5 },
      ],
      // 2026-11-27 泊位改厨房西墙北段地柜缺口（a59f1940），phase-scope 厨房规则纳入
      // gbath.robot_dock；夹具随之从 guest_bath 改 kitchen，位置取现模型 (7.78, 0.35)。
      kitchen: [
        { type: 'robot_dock_gbath', id: 'gbath.robot_dock', x: 7.78, z: 0.35 },
      ],
      bedroom_nw: [
        { type: 'future_bed', id: 'bnw.future_bed', x: 4.6, z: 2.3 },
        { type: 'curtain_set' },
      ],
    }, 'phase_1_basic_occupancy', scopes);

    assert.deepEqual(filtered.guest_bath.map((item) => item.type), ['vanity']);
    assert.deepEqual(filtered.guest_bath.map((item) => item.sourceIndex), [0]);
    assert.deepEqual(filtered.kitchen.map((item) => item.type), ['robot_dock_gbath']);
    assert.equal(filtered.kitchen[0]?.sourceIndex, 0);
    assert.deepEqual(filtered.bedroom_nw.map((item) => item.type), ['curtain_set']);
    assert.equal(filtered.bedroom_nw[0]?.sourceIndex, 1);
  });

  it('names phase membership by stable id, so a new item of an admitted type is not swept in', () => {
    // issue #98 方案 §四①：阶段归属按 ID 指名。客餐厅一期只显示点名的 placed 家具；
    // 新增一个同 type（wall_cabinet_tall）的通顶柜，没被点名就不进一期——它不会因
    // 「排过一个同名柜」的旧 type 规则被误伤，也不会因为 type 眼熟被顺手放入。
    const scopes = loadPhaseScopes();
    const filtered = filterFurnishings({
      living_dining: [
        { type: 'wall_cabinet_tall', id: 'ld.wall_cabinet_tall', x: 7.375, z: 6.225, rotation: 270 },
        { type: 'wall_cabinet_tall', id: 'ld.wall_cabinet_tall_2', x: 8.0, z: 6.225, rotation: 270 },
        { type: 'sofa_3seat', id: 'ld.sofa_3seat', x: 11.0, z: 7.7, rotation: 270 },
      ],
    }, 'phase_1_basic_occupancy', scopes);

    assert.deepEqual(filtered.living_dining.map((item) => item.id), ['ld.sofa_3seat']);
  });

  it('keeps deferred fixed appliance topics out of phase 1 only', () => {
    const scopes = loadPhaseScopes();
    // 2026-11-15 一二期对调（#152）：洗碗机进一期，净水器/烘干机仍留二期。
    assert.equal(isBudgetTopicIncluded('dishwasher', 'phase_1_basic_occupancy', scopes), true);
    assert.equal(isBudgetTopicIncluded('dishwasher', 'full', scopes), true);
    for (const topic of ['water_purifier', 'dryer']) {
      assert.equal(isBudgetTopicIncluded(topic, 'phase_1_basic_occupancy', scopes), false);
      assert.equal(isBudgetTopicIncluded(topic, 'full', scopes), true);
    }
    assert.equal(isBudgetTopicIncluded('robot_vacuum', 'phase_1_basic_occupancy', scopes), true);
  });
});
