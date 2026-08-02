import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  return {
    Color: class { constructor(public hex: number | string = 0) {} set(h: number | string) { this.hex = h; return this; } },
    MeshStandardMaterial: class {
      color = { set: vi.fn(), hex: 0 };
      transparent = false;
      opacity = 1;
      clone() { return this; }
    },
    Sprite: class {
      position = new Vector3();
      scale = { x: 1, y: 1, z: 1, set: vi.fn() };
      visible = true;
      constructor(public material: unknown) {}
    },
    SpriteMaterial: class { constructor(public opts: unknown) {} dispose = vi.fn(); },
    CanvasTexture: class { constructor(public canvas: unknown) {} dispose = vi.fn(); },
    Vector3,
  };
});

import { HumidityOverlay } from './HumidityOverlay.js';

const BODY = {
  confidence: 'estimated',
  huinanActive: true,
  rooms: [
    { id: 'master_bath', name: '主卫', score: 55, tier: 'high', factors: [{ label: '湿源', delta: 30 }], declared: true },
    { id: 'living_dining', name: '客餐厅', score: 10, tier: 'low', factors: [], declared: true },
  ],
  surfaces: [
    { id: 'entry_garden_slab', room: 'master_bath', kind: 'slab', score: 60, tier: 'high' },
    { id: 'living_north_wall', room: 'living_dining', kind: 'ext_wall', faces: 'north', score: 20, tier: 'low' },
  ],
};

function makeHouseScene() {
  const pristineClone = { cloned: true, color: { set: vi.fn(), hex: 0 }, transparent: false, opacity: 1 };
  const floorMat = { color: { set: vi.fn(), hex: 0 }, transparent: false, opacity: 1, clone: vi.fn(() => pristineClone) };
  const floor = { userData: { roomId: 'master_bath' }, material: floorMat };
  const domElement = document.createElement('canvas');
  return {
    getFloorMeshes: () => [floor],
    rooms: { master_bath: { x: 2, z: 3, width: 2.6, depth: 4 }, living_dining: { x: 9, z: 7, width: 6, depth: 5 } },
    scene: { add: vi.fn(), remove: vi.fn() },
    renderer: { domElement },
    raycastRoomAtPointer: vi.fn(() => 'master_bath'),
    _floor: floor,
    _originalMat: pristineClone,
    _domElement: domElement,
  };
}

describe('HumidityOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => BODY })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('toggle 开启：拉取数据、按 tier 着色、高风险表面加标记', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    expect(overlay.isActive()).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/analysis/humidity?date=03-15');
    expect(hs._floor.material.color.set).toHaveBeenCalledWith('#f56565');
    expect(hs._floor.material.transparent).toBe(true);
    expect(hs.scene.add).toHaveBeenCalled();
  });

  it('toggle 关闭：恢复材质、移除标记、隐藏面板', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    const original = hs._floor.material;
    await overlay.toggle();
    expect(hs._floor.material).toBe(original);
    await overlay.toggle();
    expect(overlay.isActive()).toBe(false);
    expect(hs._floor.material).toBe(hs._originalMat);
    expect(hs._floor.material).not.toBe(original);
    expect(hs.scene.remove).toHaveBeenCalled();
  });

  it('点击房间显示因子面板', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    hs._domElement.dispatchEvent(new Event('click'));
    const panel = document.getElementById('humidity-info-panel');
    expect(panel).toBeTruthy();
    expect(panel!.innerHTML).toContain('主卫');
    expect(panel!.innerHTML).toContain('湿源');
  });

  it('res.ok=false 时不着色', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    expect(hs._floor.material.color.set).not.toHaveBeenCalled();
  });

  it('refresh 使用新日期', async () => {
    const hs = makeHouseScene();
    const overlay = new HumidityOverlay(hs as never);
    await overlay.toggle();
    await overlay.refresh('12-22');
    expect(fetch).toHaveBeenLastCalledWith('/api/analysis/humidity?date=12-22');
  });
});
