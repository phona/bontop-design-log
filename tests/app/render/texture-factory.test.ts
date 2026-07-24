import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialTexture } from '../../../app/src/render/TextureFactory.js';

before(() => {
  let canvasId = 0;
  let mockSaveRestore: (() => void)[] = [];
  const mockCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => { mockSaveRestore.push(() => {}); },
    restore: () => { mockSaveRestore.pop(); },
    translate: () => {},
    rotate: () => {},
    strokeRect: () => {},
    getImageData: () => ({
      data: new Uint8ClampedArray(512 * 512 * 4).fill(128),
      width: 512,
      height: 512,
      colorSpace: 'srgb' as PredefinedColorSpace,
    }),
    putImageData: () => {},
    createImageData: (sw: number, sh: number) => ({
      data: new Uint8ClampedArray(sw * sh * 4),
      width: sw,
      height: sh,
    }),
  } as unknown as CanvasRenderingContext2D;

  const mockCanvas = {
    width: 512,
    height: 512,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;

  (globalThis as any).document = {
    createElement: () => mockCanvas,
  };
});

describe('TextureFactory - Enhanced Textures', () => {
  it('generates wood_grain_v2 with map and normalMap', () => {
    const tex = createMaterialTexture({ type: 'wood_grain_v2', color: '#c49a6c', species: 'oak' });
    assert.ok(tex, 'result should be truthy');
    assert.ok('map' in tex, 'should have map property');
    assert.ok('normalMap' in tex, 'should have normalMap property');
    if ('map' in tex) {
      assert.ok(tex.map, 'map should be truthy');
    }
    if ('normalMap' in tex) {
      assert.ok(tex.normalMap, 'normalMap should be truthy');
    }
  });

  it('generates ceramic_tile_v2 with herringbone pattern', () => {
    const tex = createMaterialTexture({ type: 'ceramic_tile_v2', color: '#f5f5f5', pattern: 'herringbone' });
    assert.ok(tex);
    assert.ok('map' in tex);
    assert.ok(tex.map);
  });

  it('generates ceramic_tile_v2 with basket weave pattern', () => {
    const tex = createMaterialTexture({ type: 'ceramic_tile_v2', color: '#f5f5f5', pattern: 'basket' });
    assert.ok(tex);
    assert.ok('map' in tex);
    assert.ok(tex.map);
  });

  it('generates stone marble texture', () => {
    const tex = createMaterialTexture({ type: 'stone', color: '#e8e0d5', variety: 'marble' });
    assert.ok(tex);
    assert.ok('map' in tex);
    assert.ok(tex.map);
  });

  it('generates stone terrazzo texture', () => {
    const tex = createMaterialTexture({ type: 'stone', color: '#e8e0d5', variety: 'terrazzo' });
    assert.ok(tex);
    assert.ok('map' in tex);
    assert.ok(tex.map);
  });

  it('generates normal map for new types', () => {
    const tex = createMaterialTexture({ type: 'wood_grain_v2', color: '#c49a6c' });
    assert.ok('normalMap' in tex);
    assert.ok(tex.normalMap);
  });

  it('preserves backward compat for old types returning a single texture', () => {
    const tex = createMaterialTexture({ type: 'wood_grain', color: '#c49a6c' });
    assert.ok(!('map' in tex) || tex.map === undefined, 'old types should return single texture');
  });
});
