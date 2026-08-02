import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  return {
    Color: class {
      constructor(public hex: number | string = 0) {}
      lerp = vi.fn();
      set(hex: number | string) { this.hex = hex; return this; }
    },
    MeshStandardMaterial: class { color = { set: vi.fn(), copy: vi.fn() }; clone() { return this; } },
    Sprite: class { position = new Vector3(); scale = { set: vi.fn() }; visible = true; constructor(public material: unknown) {} },
    SpriteMaterial: class {
      map: unknown;
      constructor(opts: { map?: unknown } = {}) { this.map = opts.map; }
      dispose = vi.fn();
    },
    CanvasTexture: class { constructor(public canvas: unknown) {} dispose = vi.fn(); },
    Vector3,
  };
});

import { DaylightHeatmap } from './DaylightHeatmap.js';

function makeHouseScene() {
  const floorMat = { color: { set: vi.fn(), copy: vi.fn() }, clone: vi.fn() };
  const floor = { userData: { roomId: 'living_dining' }, material: floorMat };
  return {
    getFloorMeshes: () => [floor],
    rooms: { living_dining: { x: 10, z: 7, name: '客餐厅' } },
    scene: { add: vi.fn(), remove: vi.fn() },
    topDownView: { enable: vi.fn(), disable: vi.fn(), isEnabled: () => false },
    _floor: floor,
  };
}

describe('DaylightHeatmap', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        date: '12-22',
        rooms: [{ id: 'living_dining', name: '客餐厅', directHours: 3.5, westSunWarning: false, intervals: [], windows: [] }],
      }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggle 开启：拉取数据、着色 floor、切俯视', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    expect(heatmap.isActive()).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/analysis/sunlight?date=12-22');
    expect(hs._floor.material.color.set).toHaveBeenCalled();
    expect(hs.topDownView.enable).toHaveBeenCalled();
  });

  it('toggle 关闭：恢复材质、退出俯视、释放 label GPU 资源', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    const sprite = (hs.scene.add as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as {
      material: { dispose: ReturnType<typeof vi.fn>; map: { dispose: ReturnType<typeof vi.fn> } };
    };
    await heatmap.toggle();
    expect(heatmap.isActive()).toBe(false);
    expect(hs.topDownView.disable).toHaveBeenCalled();
    expect(sprite.material.map.dispose).toHaveBeenCalled();
    expect(sprite.material.dispose).toHaveBeenCalled();
  });

  it('refresh 使用新日期', async () => {
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await heatmap.toggle();
    await heatmap.refresh('06-22');
    expect(fetch).toHaveBeenLastCalledWith('/api/analysis/sunlight?date=06-22');
  });

  it('非 ok 响应：不着色、不抛错，activate 仍完成', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const hs = makeHouseScene();
    const heatmap = new DaylightHeatmap(hs as never);
    await expect(heatmap.toggle()).resolves.toBeUndefined();
    expect(heatmap.isActive()).toBe(true);
    expect(hs._floor.material.color.set).not.toHaveBeenCalled();
    expect(hs.topDownView.enable).toHaveBeenCalled();
  });
});
