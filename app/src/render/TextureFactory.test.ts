import { describe, it, expect, vi } from 'vitest';

const mockCtx: Partial<CanvasRenderingContext2D> = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: 'srgb' as PredefinedColorSpace,
  })),
  createImageData: vi.fn((w: number, h: number) => ({
    colorSpace: 'srgb' as PredefinedColorSpace,
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
  })) as unknown as CanvasRenderingContext2D['createImageData'],
  putImageData: vi.fn(),
};

const mockCanvas: Partial<HTMLCanvasElement> = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => mockCtx) as unknown as HTMLCanvasElement['getContext'],
};

(globalThis as any).document = {
  createElement: vi.fn((_tag: string) => mockCanvas),
};

vi.mock('three', () => ({
  CanvasTexture: class {
    wrapS = 0;
    wrapT = 0;
    colorSpace = '';
    constructor(_canvas: HTMLCanvasElement) {}
  },
  Texture: class {
    wrapS = 0;
    wrapT = 0;
  },
  TextureLoader: class {
    load(_url: string) {
      return { wrapS: 0, wrapT: 0 };
    }
  },
  RepeatWrapping: 1000,
  SRGBColorSpace: 'srgb',
}));

import { createMaterialTexture } from './TextureFactory';

describe('TextureFactory', () => {
  it('creates a CanvasTexture for wood_grain appearance', () => {
    const tex = createMaterialTexture({ type: 'wood_grain', color: '#c49a6c' });
    expect(tex).toBeDefined();
  });

  it('creates a CanvasTexture for ceramic_tile appearance', () => {
    const tex = createMaterialTexture({ type: 'ceramic_tile', color: '#f5f5f5' });
    expect(tex).toBeDefined();
  });

  it('creates a CanvasTexture for matte_paint appearance', () => {
    const tex = createMaterialTexture({ type: 'matte_paint', color: '#f7f5ef' });
    expect(tex).toBeDefined();
  });

  it('falls back to solid fill for unknown type', () => {
    const tex = createMaterialTexture({ type: 'unknown', color: '#ff0000' });
    expect(tex).toBeDefined();
  });

  it('wood_plank straight: returns PBR triple + worldSize (800×800 → 4.8m, 行数须偶)', () => {
    const result = createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'straight',
      plank_mm: [800, 800], finish: 'soft', seed: 42,
    });
    expect('map' in result && result.map).toBeDefined();
    if ('map' in result) {
      expect(result.normalMap).toBeDefined();
      expect(result.roughnessMap).toBeDefined();
      expect(result.worldSize).toBeCloseTo(4.8, 5);
    }
  });

  it('wood_plank herringbone: worldSize = m·(L+W)/√2（150×900 → m=7）', () => {
    const result = createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone',
      plank_mm: [150, 900], finish: 'soft', seed: 42,
    });
    if ('map' in result) {
      expect(result.worldSize).toBeCloseTo((7 * 1050) / Math.SQRT2 / 1000, 3);
      expect(result.roughnessMap).toBeDefined();
    }
  });

  it('wood_plank 同 seed 逐调用一致，异 seed 不同（确定性随机）', () => {
    const base = { type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone', plank_mm: [150, 900] };
    const snapshot = () => {
      vi.clearAllMocks();
      createMaterialTexture({ ...base, seed: 42 });
      return JSON.stringify([
        (mockCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls,
        (mockCtx.lineTo as ReturnType<typeof vi.fn>).mock.calls,
        (mockCtx.stroke as ReturnType<typeof vi.fn>).mock.calls.length,
      ]);
    };
    const a = snapshot();
    const b = snapshot();
    expect(a).toBe(b);
    vi.clearAllMocks();
    createMaterialTexture({ ...base, seed: 7 });
    const c = JSON.stringify([
      (mockCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls,
      (mockCtx.lineTo as ReturnType<typeof vi.fn>).mock.calls,
      (mockCtx.stroke as ReturnType<typeof vi.fn>).mock.calls.length,
    ]);
    expect(c).not.toBe(a);
  });
});
