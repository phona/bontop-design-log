import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';

const TEST_DATA_DIR = './tmp/test-data-design-state';

describe('DesignState', () => {
  beforeEach(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  it('initializes with first option per topic', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const scheme = state.getCurrentScheme();
    assert.ok(scheme.selections.hvac.default);
    assert.deepEqual(scheme.selections.hvac.roomOverrides, {});
  });

  it('applies selection and writes decision log', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const result = state.applySelections([{ topic: 'hvac', optionId: 'A2' }], 'cheaper', 'user');
    assert.equal(result.updated, true);
    assert.equal(result.entries.length, 1);
    assert.equal(state.getCurrentScheme().selections.hvac.default, 'A2');
    assert.equal(state.getDecisionLog().length, 1);
  });

  it('rejects invalid topic', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    assert.throws(() => state.applySelections([{ topic: 'nope', optionId: 'x' }]));
  });

  it('rejects null optionId without roomId', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    assert.throws(() => state.applySelections([{ topic: 'hvac', optionId: null }]));
  });

  it('deduplicates same topic+room in one batch', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const result = state.applySelections([
      { topic: 'hvac', optionId: 'A1' },
      { topic: 'hvac', optionId: 'A2' },
    ]);
    assert.equal(result.entries.length, 1);
    assert.equal(state.getCurrentScheme().selections.hvac.default, 'A2');
  });

  it('detects expectedUpdatedAt conflict', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const result = state.applySelections(
      [{ topic: 'hvac', optionId: 'A1' }],
      undefined,
      'user',
      '2000-01-01T00:00:00Z'
    );
    assert.equal(result.conflict, true);
    assert.equal(result.updated, false);
  });

  it('visual commands expire and ack', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const cmd = state.appendVisualCommand('set_camera_target', { targetId: 'room:master_bedroom' });
    assert.ok(state.getVisualCommands().some((c) => c.commandId === cmd.commandId));
    state.ackVisualCommands([cmd.commandId]);
    assert.ok(!state.getVisualCommands().some((c) => c.commandId === cmd.commandId));
  });
});
