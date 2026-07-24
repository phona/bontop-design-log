import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextureManager } from '../../../app/src/render/TextureManager.js';

const testMaterials = [
  { id: 'floor_tile_01', appearance: { type: 'wood_grain_v2', color: '#c49a6c' } },
  { id: 'wall_tile_01', appearance: { type: 'ceramic_tile_v2', color: '#f5f5f5', pattern: 'basket' } },
];

describe('TextureManager', () => {
  it('returns a material for a known appearanceId', () => {
    const tm = new TextureManager(testMaterials);
    const mat = tm.getMaterial('floor_tile_01');
    assert.ok(mat);
    assert.equal(mat.type, 'MeshStandardMaterial');
  });

  it('falls back on unknown appearanceId', () => {
    const tm = new TextureManager(testMaterials);
    const mat = tm.getMaterial('nonexistent_id');
    assert.ok(mat);
  });

  it('preload does not throw', () => {
    const tm = new TextureManager(testMaterials);
    tm.preload();
  });

  it('preload caches materials', () => {
    const tm = new TextureManager(testMaterials);
    assert.equal(tm.cachedMaterialCount, 0);
    tm.preload();
    assert.ok(tm.cachedMaterialCount > 0, 'preload should populate cache');
    const mat = tm.getMaterial('floor_tile_01');
    assert.ok(mat);
    assert.equal(mat.type, 'MeshStandardMaterial');
  });
});
