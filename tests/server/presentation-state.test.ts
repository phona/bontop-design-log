import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { PresentationStateStore } from '../../server/presentation-state.js';
import { parseOverlay } from '../../server/overlay-merge.js';

const TEST_DATA_DIR = './tmp/test-data-presentation-state';
const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
  - { id: bath, type: curtain, points: [{x: 0, z: 1}, {x: 2, z: 1}], room: master_bath, kind: blinds }
`);

describe('PresentationStateStore', () => {
  beforeEach(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  it('initializes open and reloads persisted state', () => {
    const store = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    assert.equal(store.get().default, 'open');
    store.setCurtainState({ roomId: 'living_dining', state: 'privacy' });
    const reloaded = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    assert.equal(reloaded.get().roomOverrides.living_dining, 'privacy');
  });

  it('sets all curtains and clears room overrides', () => {
    const store = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    store.setCurtainState({ roomId: 'living_dining', state: 'privacy' });
    const result = store.setCurtainState({ state: 'blackout' });
    assert.equal(result.state.default, 'blackout');
    assert.deepEqual(result.state.roomOverrides, {});
  });

  it('normalizes blind blackout to privacy', () => {
    const store = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    store.setCurtainState({ roomId: 'master_bath', state: 'blackout' });
    assert.equal(store.get().roomOverrides.master_bath, 'privacy');
    assert.equal(store.getEffectiveStates().master_bath, 'privacy');
  });

  it('rejects rooms without curtains and detects conflicts', () => {
    const store = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    assert.throws(() => store.setCurtainState({ roomId: 'kitchen', state: 'open' }), /has no curtain/);
    const result = store.setCurtainState({ state: 'privacy', expectedUpdatedAt: 'stale' });
    assert.equal(result.conflict, true);
    assert.equal(result.updated, false);
  });
});
