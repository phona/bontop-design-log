import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { ArchivedSchemesStore, generateSlug } from '../../server/archived-schemes.js';
import type { CurrentScheme } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-archived';

function makeScheme(hvacId = 'A1'): CurrentScheme {
  return {
    updatedAt: new Date().toISOString(),
    selections: {
      hvac: { default: hvacId, roomOverrides: {} },
      floor: { default: 'floor_tile_01', roomOverrides: {} },
      wall: { default: 'wall_tile_01', roomOverrides: {} },
      paint: { default: 'latex_paint_01', roomOverrides: {} },
    },
  };
}

describe('generateSlug', () => {
  it('converts Chinese to pinyin slug', () => {
    const slug = generateSlug('奶油白主卧');
    assert.equal(slug, 'naiyoubaizhuwo');
  });

  it('handles English input', () => {
    const slug = generateSlug('Modern Minimalist');
    assert.equal(slug, 'modern-minimalist');
  });

  it('truncates to 30 chars', () => {
    const slug = generateSlug('a'.repeat(50));
    assert.ok(slug.length <= 30);
  });

  it('falls back to archive for empty result', () => {
    const slug = generateSlug('!!!');
    assert.equal(slug, 'archive');
  });
});

describe('ArchivedSchemesStore', () => {
  beforeEach(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  it('creates and lists archived schemes', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const result = store.create(makeScheme(), '奶油白主卧', '预算12万');
    assert.ok(result.scheme);
    assert.ok(result.scheme.id.startsWith('archived_'));
    assert.equal(result.scheme.name, '奶油白主卧');
    assert.equal(store.list().length, 1);
  });

  it('rejects duplicate names', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    store.create(makeScheme(), '奶油白主卧');
    const result = store.create(makeScheme(), '奶油白主卧');
    assert.equal(result.error, 'name_conflict');
  });

  it('gets archived scheme by id', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme } = store.create(makeScheme(), '测试方案');
    const found = store.get(scheme.id);
    assert.ok(found);
    assert.equal(found.name, '测试方案');
  });

  it('deletes archived scheme', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme } = store.create(makeScheme(), '测试方案');
    assert.equal(store.delete(scheme.id), true);
    assert.equal(store.list().length, 0);
  });

  it('returns false for deleting nonexistent', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    assert.equal(store.delete('nonexistent'), false);
  });

  it('computes diff between archived and current', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const { scheme: archived } = store.create(makeScheme('A1'), '方案A');
    const current = makeScheme('A2');
    const diff = store.diff(archived.id, current);
    assert.ok(diff);
    const hvacDiff = diff.find((d) => d.path === 'hvac.default');
    assert.ok(hvacDiff);
    assert.equal(hvacDiff.current, 'A2');
    assert.equal(hvacDiff.archived, 'A1');
  });

  it('diff includes room overrides', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const schemeA = makeScheme('A1');
    schemeA.selections.floor.roomOverrides.master_bedroom = 'floor_tile_01';
    const { scheme: archived } = store.create(schemeA, '方案B');

    const current = makeScheme('A1');
    current.selections.floor.roomOverrides.master_bedroom = 'floor_tile_02';
    const diff = store.diff(archived.id, current);
    assert.ok(diff);
    const overrideDiff = diff.find(
      (d) => d.path === 'floor.roomOverrides.master_bedroom'
    );
    assert.ok(overrideDiff);
    assert.equal(overrideDiff.current, 'floor_tile_02');
    assert.equal(overrideDiff.archived, 'floor_tile_01');
  });

  it('diff returns undefined for nonexistent scheme', () => {
    const store = new ArchivedSchemesStore(TEST_DATA_DIR);
    const diff = store.diff('nonexistent', makeScheme());
    assert.equal(diff, undefined);
  });

  it('persists to disk and reloads', () => {
    const store1 = new ArchivedSchemesStore(TEST_DATA_DIR);
    store1.create(makeScheme(), '持久化测试');
    const store2 = new ArchivedSchemesStore(TEST_DATA_DIR);
    assert.equal(store2.list().length, 1);
    assert.equal(store2.list()[0].name, '持久化测试');
  });
});
