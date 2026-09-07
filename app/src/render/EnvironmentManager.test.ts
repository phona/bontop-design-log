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
  const renderer = {
    domElement: document.createElement('canvas'),
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
  } as unknown as THREE.WebGLRenderer;
  const mgr = new EnvironmentManager(scene, renderer);
  mgr.setup();
  return { mgr, scene, renderer };
}

describe('EnvironmentManager', () => {
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

  function addedObjects(scene: THREE.Scene) {
    return (scene.add as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
  }

  function findDirLight(scene: THREE.Scene) {
    return addedObjects(scene).find((o) => o.castShadow === true)!;
  }

  it('setup: 阴影贴图改为按需更新', () => {
    const { renderer } = makeManager();
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('日照开启：白天主光可见，位置在太阳方向 × 60', () => {
    const { mgr, scene, renderer } = makeManager();
    mgr.setSunlightEnabled(true);
    mgr.setSolarState({ altitudeDeg: 45, azimuthDeg: 180 });
    const state = mgr.getLightingState();
    expect(state.isNight).toBe(false);
    expect(state.altitudeDeg).toBe(45);

    const dirLight = findDirLight(scene);
    expect(dirLight).toBeDefined();
    expect(dirLight.visible).toBe(true);
    expect(Math.abs(dirLight.position.x)).toBeLessThan(1e-6);
    expect(dirLight.position.y).toBeCloseTo(42.4264, 1);
    expect(dirLight.position.z).toBeCloseTo(42.4264, 1);
    expect(dirLight.intensity).toBeCloseTo(0.3 + 0.7 * Math.sin(Math.PI / 4), 4);
    expect((scene.background as unknown as { hex: string }).hex).toBe('#1a1a20');
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('日照开启：夜间主光关闭，ambient 降至 0.15', () => {
    const { mgr, scene } = makeManager();
    mgr.setSunlightEnabled(true);
    mgr.setSolarState({ altitudeDeg: -10, azimuthDeg: 0 });
    expect(mgr.getLightingState().isNight).toBe(true);

    const dirLight = findDirLight(scene);
    expect(dirLight).toBeDefined();
    expect(dirLight.visible).toBe(false);
    const ambient = addedObjects(scene).find((o) => o instanceof THREE.AmbientLight)!;
    expect(ambient).toBeDefined();
    expect(ambient.intensity).toBe(0.15);
    expect((scene.background as unknown as { hex: string }).hex).toBe('#0a0a18');
  });

  it('日照关闭（默认）：setSolarState 只更新状态，不改场景', () => {
    const { mgr, scene } = makeManager();
    mgr.setSolarState({ altitudeDeg: -10, azimuthDeg: 0 });
    expect(mgr.getLightingState().isNight).toBe(true);

    const dirLight = findDirLight(scene);
    expect(dirLight.visible).toBe(true);
    expect(dirLight.position.x).toBe(12);
    expect(dirLight.position.y).toBe(20);
    expect(scene.background).toBeNull();
  });

  it('关闭日照：恢复静态预设', () => {
    const { mgr, scene } = makeManager();
    mgr.setSunlightEnabled(true);
    mgr.setSolarState({ altitudeDeg: -10, azimuthDeg: 0 });
    mgr.setSunlightEnabled(false);

    const dirLight = findDirLight(scene);
    expect(dirLight.visible).toBe(true);
    expect(dirLight.intensity).toBe(0.9);
    expect(dirLight.position.x).toBe(12);
    expect(dirLight.position.y).toBe(20);
    expect(dirLight.position.z).toBe(8);
    const ambient = addedObjects(scene).find((o) => o instanceof THREE.AmbientLight)!;
    expect(ambient.intensity).toBe(0.55);
    expect((scene.background as unknown as { hex: string }).hex).toBe('#1a1a20');
  });

  it('requestShadowUpdate 置 needsUpdate', () => {
    const { mgr, renderer } = makeManager();
    renderer.shadowMap.needsUpdate = false;
    mgr.requestShadowUpdate();
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('setTimeOfDay 已移除', () => {
    const { mgr } = makeManager();
    expect((mgr as unknown as Record<string, unknown>).setTimeOfDay).toBeUndefined();
  });
});
