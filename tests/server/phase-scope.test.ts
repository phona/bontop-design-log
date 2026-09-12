import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterFurnishings, isBudgetTopicIncluded, loadPhaseScopes } from '../../server/phase-scope.js';

describe('phase scope', () => {
  it('fails closed for unlisted furnishing types and preserves source identity', () => {
    const scopes = loadPhaseScopes();
    const filtered = filterFurnishings({
      guest_bath: [
        { type: 'vanity', x: 6.79, z: 3.925 },
        { type: 'future_guest_bath_furniture', x: 6.5, z: 3.5 },
        { type: 'robot_dock_gbath', x: 6.823, z: 3.925 },
      ],
      bedroom_nw: [
        { type: 'future_bed', x: 4.6, z: 2.3 },
        { type: 'curtain_set' },
      ],
    }, 'phase_1_basic_occupancy', scopes);

    assert.deepEqual(filtered.guest_bath.map((item) => item.type), ['vanity', 'robot_dock_gbath']);
    assert.deepEqual(filtered.guest_bath.map((item) => item.sourceIndex), [0, 2]);
    assert.deepEqual(filtered.bedroom_nw.map((item) => item.type), ['curtain_set']);
    assert.equal(filtered.bedroom_nw[0]?.sourceIndex, 1);
  });

  it('keeps deferred fixed appliance topics out of phase 1 only', () => {
    const scopes = loadPhaseScopes();
    for (const topic of ['dishwasher', 'water_purifier', 'dryer']) {
      assert.equal(isBudgetTopicIncluded(topic, 'phase_1_basic_occupancy', scopes), false);
      assert.equal(isBudgetTopicIncluded(topic, 'full', scopes), true);
    }
    assert.equal(isBudgetTopicIncluded('robot_vacuum', 'phase_1_basic_occupancy', scopes), true);
  });
});
