import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Color { constructor(public hex: number | string = 0) {} setHex(h: number) { this.hex = h; } }
  class Light {
    position = new Vector3();
    color = new Color();
    intensity = 1;
    visible = true;
    castShadow = false;
    shadow = { mapSize: { set: vi.fn() }, bias: 0, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0, updateProjectionMatrix: vi.fn() } };
  }
  return {
    Scene: class { environment: unknown = null; background: unknown = null; add = vi.fn(); },
    AmbientLight: class extends Light {},
    DirectionalLight: class extends Light {},
    CanvasTexture: class { needsUpdate = false; constructor(public canvas: unknown) {} dispose = vi.fn(); },
    PMREMGenerator: class { fromScene() { return { texture: {} }; } dispose = vi.fn(); },
    Color,
    Vector3,
  };
});

import * as THREE from 'three';
import { EnvironmentManager } from './EnvironmentManager.js';

const originalGetContext = HTMLCanvasElement.prototype.getContext;

function makeManager() {
  const scene = new THREE.Scene();
  const renderer = { domElement: document.createElement('canvas') } as unknown as THREE.WebGLRenderer;
  const mgr = new EnvironmentManager(scene, renderer);
  mgr.setup();
  return { mgr, scene };
}

describe('EnvironmentManager.setSolarState', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      fillRect: vi.fn(),
      fillStyle: '',
    })) as never;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('白天：主光可见，位置在太阳方向 × 60', () => {
    const { mgr, scene } = makeManager();
    mgr.setSolarState({ altitudeDeg: 45, azimuthDeg: 180 });
    const state = mgr.getLightingState();
    expect(state.isNight).toBe(false);
    expect(state.altitudeDeg).toBe(45);

    const added = (scene.add as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const dirLight = added.find((o) => o.castShadow === true);
    expect(dirLight).toBeDefined();
    expect(dirLight.visible).toBe(true);
    expect(Math.abs(dirLight.position.x)).toBeLessThan(1e-6);
    expect(dirLight.position.y).toBeCloseTo(42.4264, 1);
    expect(dirLight.position.z).toBeCloseTo(42.4264, 1);
    expect(dirLight.intensity).toBeCloseTo(0.3 + 0.7 * Math.sin(Math.PI / 4), 4);
    expect((scene.background as { hex: string }).hex).toBe('#1a1a20');
  });

  it('夜间：主光关闭，ambient 降至 0.15', () => {
    const { mgr, scene } = makeManager();
    mgr.setSolarState({ altitudeDeg: -10, azimuthDeg: 0 });
    expect(mgr.getLightingState().isNight).toBe(true);

    const added = (scene.add as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const dirLight = added.find((o) => o.castShadow === true);
    expect(dirLight).toBeDefined();
    expect(dirLight.visible).toBe(false);
    const ambient = added.find((o) => o instanceof THREE.AmbientLight);
    expect(ambient).toBeDefined();
    expect(ambient.intensity).toBe(0.15);
    expect((scene.background as { hex: string }).hex).toBe('#0a0a18');
  });

  it('setTimeOfDay 已移除', () => {
    const { mgr } = makeManager();
    expect((mgr as unknown as Record<string, unknown>).setTimeOfDay).toBeUndefined();
  });
});
