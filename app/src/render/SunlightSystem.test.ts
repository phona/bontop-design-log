import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
  }
  return {
    Scene: class { add = vi.fn(); remove = vi.fn(); },
    Line: class { constructor(public geometry: unknown, public material: unknown) {} },
    Sprite: class { position = new Vector3(); scale = { set: vi.fn() }; constructor(public material: unknown) {} },
    SpriteMaterial: class { constructor(public opts: unknown) {} },
    CanvasTexture: class { constructor(public canvas: unknown) {} },
    BufferGeometry: class { setFromPoints = vi.fn(); },
    LineBasicMaterial: class { constructor(public opts: unknown) {} },
    Vector3,
  };
});

import * as THREE from 'three';
import { SunlightSystem } from './SunlightSystem.js';

const LOCATION = { latitude: 22.82, longitude: 108.37, timezone: 8 };

function makeSystem() {
  const scene = new THREE.Scene();
  const envManager = { setSolarState: vi.fn() } as never;
  const sys = new SunlightSystem(scene, envManager, LOCATION, { x: 7, z: 4 });
  return { sys, envManager: envManager as { setSolarState: ReturnType<typeof vi.fn> } };
}

describe('SunlightSystem', () => {
  it('setHour 驱动 envManager.setSolarState', () => {
    const { sys, envManager } = makeSystem();
    sys.setHour(12.75);
    expect(envManager.setSolarState).toHaveBeenCalled();
    const arg = envManager.setSolarState.mock.calls.at(-1)![0];
    expect(arg.altitudeDeg).toBeGreaterThan(40);
  });

  it('setDate 改变太阳高度（冬至 vs 夏至）', () => {
    const { sys, envManager } = makeSystem();
    sys.setDate(12, 22);
    sys.setHour(12.75);
    const winter = envManager.setSolarState.mock.calls.at(-1)![0].altitudeDeg;
    sys.setDate(6, 22);
    sys.setHour(12.75);
    const summer = envManager.setSolarState.mock.calls.at(-1)![0].altitudeDeg;
    expect(summer).toBeGreaterThan(winter);
  });

  it('getSolarReadout 返回当前太阳位置', () => {
    const { sys } = makeSystem();
    sys.setDate(12, 22);
    sys.setHour(12.75);
    const readout = sys.getSolarReadout();
    expect(readout.altitudeDeg).toBeGreaterThan(0);
    expect(readout.azimuthDeg).toBeGreaterThan(170);
    expect(readout.azimuthDeg).toBeLessThan(190);
  });

  it('update 在播放时推进时刻（24h/10s）', () => {
    const { sys } = makeSystem();
    sys.setHour(0);
    sys.togglePlay();
    expect(sys.isPlaying()).toBe(true);
    sys.update(5);
    expect(sys.getHour()).toBeCloseTo(12, 0);
  });

  it('时刻超过 24 回绕', () => {
    const { sys } = makeSystem();
    sys.setHour(23);
    sys.togglePlay();
    sys.update(5);
    expect(sys.getHour()).toBeLessThan(12);
  });

  it('togglePlay 再次调用停止', () => {
    const { sys } = makeSystem();
    sys.togglePlay();
    expect(sys.togglePlay()).toBe(false);
  });

  it('showTrajectory/hideTrajectory 不抛错', () => {
    const { sys } = makeSystem();
    expect(() => sys.showTrajectory()).not.toThrow();
    expect(() => sys.hideTrajectory()).not.toThrow();
  });
});
