import { describe, it, expect, vi, beforeEach } from 'vitest';

// 记录所有创建的 texture 实例，供 repeat/anisotropy 断言
const createdTextures: Array<{ repeat: { set: ReturnType<typeof vi.fn> }; anisotropy: number }> = [];

const mockCtx: Partial<CanvasRenderingContext2D> = {
  fillStyle: '', strokeStyle: '', lineWidth: 0,
  fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
    colorSpace: 'srgb' as PredefinedColorSpace,
  })),
  createImageData: vi.fn((w: number, h: number) => ({
    colorSpace: 'srgb' as PredefinedColorSpace,
    data: new Uint8ClampedArray(w * h * 4), width: w, height: h,
  })) as unknown as CanvasRenderingContext2D['createImageData'],
  putImageData: vi.fn(),
};
const mockCanvas: Partial<HTMLCanvasElement> = {
  width: 0, height: 0,
  getContext: vi.fn(() => mockCtx) as unknown as HTMLCanvasElement['getContext'],
};
(globalThis as any).document = { createElement: vi.fn(() => mockCanvas) };

vi.mock('three', () => ({
  CanvasTexture: class {
    wrapS = 0; wrapT = 0; colorSpace = ''; anisotropy = 0;
    repeat = { set: vi.fn() };
    constructor(_canvas: HTMLCanvasElement) { createdTextures.push(this); }
  },
  Texture: class { wrapS = 0; wrapT = 0; repeat = { set: vi.fn() }; },
  TextureLoader: class { load() { return { wrapS: 0, wrapT: 0, repeat: { set: vi.fn() } }; } },
  MeshStandardMaterial: class {
    needsUpdate = false;
    constructor(public opts?: Record<string, unknown>) { if (opts) Object.assign(this, opts); }
    copy(m: this) { Object.assign(this, m); }
  },
  RepeatWrapping: 1000,
  SRGBColorSpace: 'srgb',
}));

import { TextureManager } from './TextureManager';

describe('TextureManager（PBR 升级）', () => {
  beforeEach(() => {
    createdTextures.length = 0;
    vi.clearAllMocks();
  });

  it('同 type+color 但不同 pattern 不共用缓存（直铺 vs 人字拼）', () => {
    const tm = new TextureManager();
    tm.setMeshes([], []);
    tm.applyToRoom('living_dining', { type: 'wood_plank', color: '#c49a6c', pattern: 'straight', plank_mm: [800, 800], seed: 42 }, 'floor');
    tm.applyToRoom('living_dining', { type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone', plank_mm: [150, 900], seed: 42 }, 'floor');
    expect(tm.cachedMaterialCount).toBe(2);
  });

  it('带 worldSize 的 appearance 触发米制 repeat（800 直铺 → 1/4.8）并设 anisotropy', () => {
    const tm = new TextureManager();
    tm.setMeshes([], []);
    tm.applyToRoom('living_dining', { type: 'wood_plank', color: '#c49a6c', pattern: 'straight', plank_mm: [800, 800], seed: 42 }, 'floor');
    expect(createdTextures.length).toBeGreaterThan(0);
    for (const t of createdTextures) {
      expect(t.repeat.set).toHaveBeenCalledWith(1 / 4.8, 1 / 4.8);
      expect(t.anisotropy).toBe(8);
    }
  });

  it('旧类型（无 worldSize）保持 repeat(2,2) 兼容', () => {
    const tm = new TextureManager();
    tm.setMeshes([], []);
    tm.applyToRoom('master_bedroom', { type: 'matte_paint', color: '#f7f5ef' }, 'wall');
    expect(createdTextures.length).toBeGreaterThan(0);
    expect(createdTextures[0].repeat.set).toHaveBeenCalledWith(2, 2);
  });
});
