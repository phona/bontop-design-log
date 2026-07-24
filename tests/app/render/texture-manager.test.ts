import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextureManager } from '../../../app/src/render/TextureManager.js';

describe('TextureManager', () => {
  it('returns a material for a known appearanceId', () => {
    const tm = new TextureManager();
    const mat = tm.getMaterial('floor_tile_01');
    assert.ok(mat);
    assert.equal(mat.type, 'MeshStandardMaterial');
  });

  it('falls back on unknown appearanceId', () => {
    const tm = new TextureManager();
    const mat = tm.getMaterial('nonexistent_id');
    assert.ok(mat);
  });

  it('preload does not throw', () => {
    const tm = new TextureManager();
    tm.preload();
  });

  it('preload caches materials from YAML config', () => {
    const tm = new TextureManager();
    assert.equal(tm.cachedMaterialCount, 0);
    tm.preload();
    assert.ok(tm.cachedMaterialCount > 0, 'expected preload to populate material cache from YAML');
    const mat = tm.getMaterial('floor_tile_01');
    assert.ok(mat);
    assert.equal(mat.type, 'MeshStandardMaterial');
  });
});
