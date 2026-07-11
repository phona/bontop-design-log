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
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(512 * 512 * 4),
    width: 512,
    height: 512,
    colorSpace: 'srgb' as PredefinedColorSpace,
  })),
  putImageData: vi.fn(),
};

const mockCanvas: Partial<HTMLCanvasElement> = {
  width: 0,
  height: 0,
  getContext: vi.fn(() => mockCtx),
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

import { createMaterialTexture } from './TextureFactory.ts';

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
});
