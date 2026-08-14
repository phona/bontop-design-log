import { describe, it, expect, vi } from 'vitest';

interface CtxRecord {
  fillRectStyles: string[];
  strokeStyles: string[];
}
interface MockCanvasEntry {
  ctx: Record<string, unknown> & { fillStyle: unknown; strokeStyle: unknown };
  record: CtxRecord;
}

const canvases: MockCanvasEntry[] = [];

function makeCanvas() {
  const record: CtxRecord = { fillRectStyles: [], strokeStyles: [] };
  const ctx: Record<string, unknown> & { fillStyle: unknown; strokeStyle: unknown } = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
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
    })),
    putImageData: vi.fn(),
  };
  ctx.fillRect = vi.fn(() => record.fillRectStyles.push(String(ctx.fillStyle)));
  ctx.stroke = vi.fn(() => record.strokeStyles.push(String(ctx.strokeStyle)));
  const entry: MockCanvasEntry = { ctx, record };
  canvases.push(entry);
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
  };
}

(globalThis as any).document = {
  createElement: vi.fn((_tag: string) => makeCanvas()),
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

// wood_plank 每次调用创建 4 张 canvas：0=色 1=高度 2=粗糙度 3=法线输出
function lastPlankCanvases(): MockCanvasEntry[] {
  return canvases.slice(-4);
}

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
      const colorCtx = lastPlankCanvases()[0].ctx;
      return JSON.stringify([
        (colorCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls,
        (colorCtx.lineTo as ReturnType<typeof vi.fn>).mock.calls,
        (colorCtx.stroke as ReturnType<typeof vi.fn>).mock.calls.length,
      ]);
    };
    const a = snapshot();
    const b = snapshot();
    expect(a).toBe(b);
    vi.clearAllMocks();
    createMaterialTexture({ ...base, seed: 7 });
    const colorCtx = lastPlankCanvases()[0].ctx;
    const c = JSON.stringify([
      (colorCtx.fillRect as ReturnType<typeof vi.fn>).mock.calls,
      (colorCtx.lineTo as ReturnType<typeof vi.fn>).mock.calls,
      (colorCtx.stroke as ReturnType<typeof vi.fn>).mock.calls.length,
    ]);
    expect(c).not.toBe(a);
  });

  it('wood_plank 多版面：板底色至少 6 种（6–8 印刷面色族混铺，DEC-011 版面数要求）', () => {
    createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone',
      plank_mm: [150, 900], finish: 'soft', seed: 42,
    });
    const styles = lastPlankCanvases()[0].record.fillRectStyles.slice(1); // 首笔为整幅美缝底
    expect(new Set(styles).size).toBeGreaterThanOrEqual(6);
  });

  it('wood_plank 板内木纹：stroke 次数 ≥ 150 且 strokeStyle 种类 ≥ 10', () => {
    createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone',
      plank_mm: [150, 900], finish: 'soft', seed: 42,
    });
    const rec = lastPlankCanvases()[0].record;
    expect(rec.strokeStyles.length).toBeGreaterThanOrEqual(150);
    expect(new Set(rec.strokeStyles).size).toBeGreaterThanOrEqual(10);
  });

  it('wood_plank V 型倒角：高度图板缘含中间灰阶（非板/缝两阶跳变）', () => {
    createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone',
      plank_mm: [150, 900], finish: 'soft', seed: 42,
    });
    const heightStyles = new Set(lastPlankCanvases()[1].record.fillRectStyles);
    expect(heightStyles.has('#7c7c7c')).toBe(true); // 缝底
    expect(heightStyles.has('#8a8a8a')).toBe(true); // 倒角外阶
    expect(heightStyles.has('#909090')).toBe(true); // 倒角内阶
    expect(heightStyles.has('#969696')).toBe(true); // 板面
  });

  it('wood_plank 800×800 大板：板缘 AO 加粗加深（alpha 0.65），否则砖缝在 1024 画布上不可见', () => {
    createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'straight',
      plank_mm: [800, 800], finish: 'soft', seed: 42,
    });
    const rec = lastPlankCanvases()[0].record;
    expect(rec.strokeStyles.some((s) => s.endsWith(',0.65)'))).toBe(true);
  });

  it('wood_plank 800×800 大板：木纹带数随板宽放大（≥300 次 stroke，防"大理石波浪"）', () => {
    createMaterialTexture({
      type: 'wood_plank', color: '#c49a6c', pattern: 'straight',
      plank_mm: [800, 800], finish: 'soft', seed: 42,
    });
    const rec = lastPlankCanvases()[0].record;
    expect(rec.strokeStyles.length).toBeGreaterThanOrEqual(300);
  });
});
