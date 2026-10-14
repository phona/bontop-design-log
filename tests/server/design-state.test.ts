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
    // 2026-10-13 阶段 3：hvac 只剩成交方案 A2（与 catalog 默认值相同，选了不产生变更），
    // 「换一个选项」改用 floor topic。
    const result = state.applySelections([{ topic: 'floor', optionId: 'floor_tile_herringbone_01' }], 'cheaper', 'user');
    assert.equal(result.updated, true);
    assert.equal(result.entries.length, 1);
    assert.equal(state.getCurrentScheme().selections.floor.default, 'floor_tile_herringbone_01');
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
      { topic: 'floor', optionId: 'floor_tile_herringbone_01' },
      { topic: 'floor', optionId: 'floor_tile_herringbone_01' },
    ]);
    assert.equal(result.entries.length, 1);
    assert.equal(state.getCurrentScheme().selections.floor.default, 'floor_tile_herringbone_01');
  });

  it('detects expectedUpdatedAt conflict', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const result = state.applySelections(
      [{ topic: 'hvac', optionId: 'A2' }],
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

  it('returns previousScheme snapshot before mutation', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    // 2026-10-13 阶段 3：hvac 只剩成交方案 A2 一个选项（七套 invented 报价表已删），
    // 「换成另一个选项」改用 floor topic 验证——选型仍可换，只是空调已经成交。
    const before = state.getCurrentScheme().selections.floor.default;
    const result = state.applySelections([{ topic: 'floor', optionId: 'floor_tile_herringbone_01' }], 'test', 'user');
    assert.ok(result.previousScheme);
    assert.equal(result.previousScheme.selections.floor.default, before);
    assert.equal(state.getCurrentScheme().selections.floor.default, 'floor_tile_herringbone_01');
    // previousScheme must be a deep copy, not a live reference
    assert.notEqual(result.previousScheme.selections.floor.default, state.getCurrentScheme().selections.floor.default);
  });

  it('returns previousScheme even on conflict', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const result = state.applySelections(
      [{ topic: 'hvac', optionId: 'A2' }],
      undefined,
      'user',
      '2000-01-01T00:00:00Z'
    );
    assert.equal(result.conflict, true);
    assert.ok(result.previousScheme);
  });

  it('setCompareArchive and clearCompare', () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const scheme = state.getCurrentScheme();
    state.setCompareArchive('arch-001', scheme);
    assert.equal(state.getCompareArchiveId(), 'arch-001');
    assert.ok(state.getCompareScheme());
    state.clearCompare();
    assert.equal(state.getCompareArchiveId(), null);
    assert.equal(state.getCompareScheme(), null);
  });
});
