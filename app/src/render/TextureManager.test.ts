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
    normalScale = { set: vi.fn() };
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

  it('applyToFloorRegions 只更新 floor_region 网格，不碰房间地面（DEC-011：走廊随 floor topic）', async () => {
    const THREE = await import('three');
    const tm = new TextureManager();
    const region = { userData: { type: 'floor_region', objectId: 'corridor_floor' }, material: new THREE.MeshStandardMaterial() };
    const roomFloor = { userData: { type: 'floor', roomId: 'study', objectId: 'floor:study' }, material: new THREE.MeshStandardMaterial() };
    tm.setMeshes([region as never, roomFloor as never], []);
    tm.applyToFloorRegions({ type: 'wood_plank', color: '#c49a6c', pattern: 'straight', plank_mm: [800, 800], seed: 42 });
    expect((region.material as unknown as Record<string, unknown>).map).toBeDefined();
    expect((roomFloor.material as unknown as Record<string, unknown>).map).toBeUndefined();
  });

  it('applyToFloorRegions 与 applyToRoom 同色同参共用缓存材质', async () => {
    const THREE = await import('three');
    const tm = new TextureManager();
    const region = { userData: { type: 'floor_region', objectId: 'corridor_floor' }, material: new THREE.MeshStandardMaterial() };
    const roomFloor = { userData: { type: 'floor', roomId: 'living_dining', objectId: 'floor:living_dining' }, material: new THREE.MeshStandardMaterial() };
    tm.setMeshes([region as never, roomFloor as never], []);
    const appearance = { type: 'wood_plank', color: '#c49a6c', pattern: 'straight', plank_mm: [800, 800], seed: 42 };
    tm.applyToRoom('living_dining', appearance, 'floor');
    tm.applyToFloorRegions(appearance);
    expect(tm.cachedMaterialCount).toBe(1);
  });

  it('DEC-041: 带 follow 的 floor_region 跟随目标房间材质，其余跟随 default', async () => {
    const THREE = await import('three');
    const tm = new TextureManager();
    const foyer = { userData: { type: 'floor_region', objectId: 'entry_foyer_floor', follow: 'living_dining' }, material: new THREE.MeshStandardMaterial() };
    const corridor = { userData: { type: 'floor_region', objectId: 'corridor_floor' }, material: new THREE.MeshStandardMaterial() };
    tm.setMeshes([foyer as never, corridor as never], []);
    const defaultApp = { type: 'wood_plank', color: '#c49a6c', pattern: 'straight', plank_mm: [800, 800], seed: 42 };
    const herringbone = { type: 'wood_plank', color: '#c49a6c', pattern: 'herringbone', plank_mm: [150, 900], seed: 42 };
    tm.applyToFloorRegions(defaultApp, (roomId) => (roomId === 'living_dining' ? herringbone : null));
    const foyerMat = foyer.material as unknown as Record<string, unknown>;
    const corridorMat = corridor.material as unknown as Record<string, unknown>;
    expect(foyerMat.map).toBeDefined();
    expect(corridorMat.map).toBeDefined();
    // 两种拼法不得共用材质（缓存键区分）
    expect(foyerMat.map).not.toBe(corridorMat.map);
    expect(tm.cachedMaterialCount).toBe(2);
  });

  it('DEC-041: applyToRoom(ceiling) 只染基础天花，不碰墙/地板/吊顶 solid', async () => {
    const THREE = await import('three');
    const tm = new TextureManager();
    const ceiling = { userData: { type: 'ceiling', roomId: 'living_dining' }, material: new THREE.MeshStandardMaterial() };
    const zoneSolid = { userData: { type: 'ceiling_zone_solid', roomId: 'living_dining' }, material: new THREE.MeshStandardMaterial() };
    const wall = { userData: { type: 'wall', roomId: 'living_dining' }, material: new THREE.MeshStandardMaterial() };
    tm.setMeshes([], [wall as never], [ceiling as never, zoneSolid as never]);
    tm.applyToRoom('living_dining', { type: 'matte_paint', color: '#f7f5ef' }, 'ceiling');
    expect((ceiling.material as unknown as Record<string, unknown>).map).toBeDefined();
    expect((zoneSolid.material as unknown as Record<string, unknown>).map).toBeUndefined();
    expect((wall.material as unknown as Record<string, unknown>).map).toBeUndefined();
  });
});
