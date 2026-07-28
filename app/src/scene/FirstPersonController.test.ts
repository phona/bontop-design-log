import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WallSegment } from '@shared/types';
import { PITCH_LIMIT, MAX_FRAME_ANGLE, MOUSE_SENSITIVITY } from './first-person-tuning.js';

class MockVector3 {
  x = 0; y = 0; z = 0;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new MockVector3(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() {
    const len = this.length();
    if (len > 0) { this.x /= len; this.y /= len; this.z /= len; }
    return this;
  }
  applyQuaternion(q: any) {
    const { x, y, z } = this;
    const { x: qx, y: qy, z: qz, w: qw } = q;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
  add(v: any) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  distanceTo(v: any) {
    return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2);
  }
}

class MockQuaternion {
  x = 0; y = 0; z = 0; w = 1;
  set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  setFromEuler(euler: any) {
    const { x: ex, y: ey, z: ez } = euler;
    const c1 = Math.cos(ex / 2), s1 = Math.sin(ex / 2);
    const c2 = Math.cos(ey / 2), s2 = Math.sin(ey / 2);
    const c3 = Math.cos(ez / 2), s3 = Math.sin(ez / 2);
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }
}

class MockEuler {
  x = 0; y = 0; z = 0; order = 'XYZ';
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
    this.x = x; this.y = y; this.z = z; this.order = order;
  }
  setFromQuaternion(q: any, order: string) {
    this.order = order;
    const { x, y, z, w } = q;
    const m32 = 2 * (y * z + w * x);
    const m31 = 2 * (x * z - w * y);
    const m33 = 1 - 2 * (x * x + y * y);
    const m12 = 2 * (x * y - w * z);
    const m22 = 1 - 2 * (x * x + z * z);
    if (order === 'YXZ') {
      this.x = Math.asin(Math.max(-1, Math.min(1, m32)));
      this.y = Math.atan2(-m31, m33);
      this.z = Math.atan2(-m12, m22);
    } else {
      const m13 = 2 * (x * z + w * y);
      const m23 = 2 * (y * z - w * x);
      const m11 = 1 - 2 * (y * y + z * z);
      this.y = Math.asin(Math.max(-1, Math.min(1, m13)));
      this.x = Math.atan2(-m23, m33);
      this.z = Math.atan2(-m12, m11);
    }
    return this;
  }
}

vi.mock('three', () => ({
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  Euler: MockEuler,
  PerspectiveCamera: class {
    position = new MockVector3(0, 1.7, 0);
    quaternion = new MockQuaternion();
  },
}));

vi.mock('three/examples/jsm/controls/PointerLockControls.js', () => ({
  PointerLockControls: vi.fn().mockImplementation(function (this: any, cam: any) {
    this.lock = vi.fn(() => { this.isLocked = true; });
    this.unlock = vi.fn(() => { this.isLocked = false; });
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.isLocked = false;
    this.pointerSpeed = 1;
    this.getObject = () => cam;
  }),
}));

const walls: WallSegment[] = [
  { id: 'north', x1: -5, z1: -5, x2: 5, z2: -5 },
  { id: 'south', x1: 5, z1: 5, x2: -5, z2: 5 },
  { id: 'east', x1: 5, z1: -5, x2: 5, z2: 5 },
  { id: 'west', x1: -5, z1: 5, x2: -5, z2: -5 },
];

describe('FirstPersonController', () => {
  let camera: any;
  let canvas: any;
  let eventListeners: Record<string, Array<(e: any) => void>>;
  let fakeTime = 0;

  beforeEach(() => {
    fakeTime = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeTime);
    camera = {
      position: new MockVector3(0, 1.7, 0),
      quaternion: new MockQuaternion(),
    };
    canvas = {};
    eventListeners = {};
    vi.stubGlobal('document', {
      addEventListener: vi.fn((event: string, handler: (e: any) => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: (e: any) => void) => {
        if (eventListeners[event]) {
          eventListeners[event] = eventListeners[event].filter(h => h !== handler);
        }
      }),
      pointerLockElement: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function simulateMouseMove(movementX: number, movementY: number) {
    const handlers = eventListeners['mousemove'] ?? [];
    for (const h of handlers) {
      h({ movementX, movementY });
    }
  }

  function simulateLock() {
    const handlers = eventListeners['pointerlockchange'] ?? [];
    for (const h of handlers) {
      h({});
    }
  }

  function getYawPitch(quat: any): { yaw: number; pitch: number } {
    const q = quat;
    const m32 = 2 * (q.y * q.z + q.w * q.x);
    const m31 = 2 * (q.x * q.z - q.w * q.y);
    const m33 = 1 - 2 * (q.x * q.x + q.y * q.y);
    const m12 = 2 * (q.x * q.y - q.w * q.z);
    const m22 = 1 - 2 * (q.x * q.x + q.z * q.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, m32)));
    const yaw = Math.atan2(-m31, m33);
    return { yaw, pitch };
  }

  it('creates without error', async () => {
    const { FirstPersonController } = await import('./FirstPersonController.js');
    const { CollisionDetector } = await import('./CollisionDetector.js');
    const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
    expect(fp).toBeDefined();
    expect(fp.isLocked).toBe(false);
    fp.dispose();
  });

  it('enable/disable toggles state', async () => {
    const { FirstPersonController } = await import('./FirstPersonController.js');
    const { CollisionDetector } = await import('./CollisionDetector.js');
    const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
    fp.enable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.disable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.dispose();
  });

  describe('direct 1:1 mapping (no inertia)', () => {
    it('applies mouse delta immediately in one update', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      simulateMouseMove(30, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      const expected = -(30 * MOUSE_SENSITIVITY);
      expect(Math.abs(yaw - expected)).toBeLessThan(0.001);
      fp.dispose();
    });

    it('does not lag behind target (no lerp tail)', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      simulateMouseMove(20, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      const expected = -(20 * MOUSE_SENSITIVITY);
      expect(Math.abs(yaw - expected)).toBeLessThan(0.001);
      fp.dispose();
    });
  });

  describe('pitch clamping', () => {
    it('clamps pitch to ±PITCH_LIMIT when looking down', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      for (let i = 0; i < 20; i++) { simulateMouseMove(0, 10000); fp.update(0.016); }

      const { pitch } = getYawPitch(camera.quaternion);
      expect(pitch).toBeLessThan(-0.5);
      expect(pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT - 0.01);
      fp.dispose();
    });

    it('clamps pitch to ±PITCH_LIMIT when looking up', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      for (let i = 0; i < 20; i++) { simulateMouseMove(0, -10000); fp.update(0.016); }

      const { pitch } = getYawPitch(camera.quaternion);
      expect(pitch).toBeGreaterThan(0.5);
      expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT + 0.01);
      fp.dispose();
    });
  });

  describe('per-frame drop-cap', () => {
    it('caps a single giant mouse delta per frame', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      simulateMouseMove(100000, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      const maxExpected = MAX_FRAME_ANGLE;
      expect(Math.abs(yaw)).toBeLessThanOrEqual(maxExpected + 0.001);
      fp.dispose();
    });

    it('does NOT carry excess into the next frame (no ghost drift after hand stops)', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      simulateMouseMove(300, 0);
      fp.update(0.016);
      const y1 = getYawPitch(camera.quaternion).yaw;
      expect(Math.abs(y1)).toBeGreaterThan(0.001);

      fp.update(0.016);
      const y2 = getYawPitch(camera.quaternion).yaw;
      expect(Math.abs(y2 - y1)).toBeLessThan(0.0001);
      fp.dispose();
    });

    it('angle cap holds regardless of sensitivity (dynamic pixel cap)', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      fp.setSensitivity(0.002);
      simulateMouseMove(1000, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(MAX_FRAME_ANGLE + 0.001);
      fp.dispose();
    });
  });

  describe('sensitivity (slider-driven)', () => {
    it('setSensitivity changes the yaw-per-pixel factor', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      fp.setSensitivity(0.002);
      simulateMouseMove(10, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      expect(Math.abs(yaw - -(10 * 0.002))).toBeLessThan(0.001);
      fp.dispose();
    });

    it('getSensitivity returns the current factor', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.setSensitivity(0.00123);
      expect(fp.getSensitivity()).toBeCloseTo(0.00123, 6);
      fp.dispose();
    });
  });

  describe('syncFromCamera discards queued movement', () => {
    it('drops accumulation gathered before sync (entry-animation guard)', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      simulateMouseMove(5000, 0);
      fp.syncFromCamera();
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      expect(Math.abs(yaw)).toBeLessThan(0.001);
      fp.dispose();
    });
  });

  describe('undefined/NaN movementX/Y guard', () => {
    it('does not corrupt yaw when movementX is undefined', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      const handlers = eventListeners['mousemove'] ?? [];
      for (const h of handlers) h({ movementX: undefined, movementY: undefined });
      fp.update(0.016);

      const { yaw, pitch } = getYawPitch(camera.quaternion);
      expect(Number.isFinite(yaw)).toBe(true);
      expect(Number.isFinite(pitch)).toBe(true);
      expect(Math.abs(yaw)).toBeLessThan(0.001);
      expect(Math.abs(pitch)).toBeLessThan(0.001);
      fp.dispose();
    });

    it('does not corrupt yaw when movementX is NaN', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      const handlers = eventListeners['mousemove'] ?? [];
      for (const h of handlers) h({ movementX: NaN, movementY: NaN });
      fp.update(0.016);

      const { yaw, pitch } = getYawPitch(camera.quaternion);
      expect(Number.isFinite(yaw)).toBe(true);
      expect(Number.isFinite(pitch)).toBe(true);
      expect(Math.abs(yaw)).toBeLessThan(0.001);
      expect(Math.abs(pitch)).toBeLessThan(0.001);
      fp.dispose();
    });

    it('NaN self-heal in update resets corrupted state', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      (fp as any).yaw = NaN;
      (fp as any).pitch = NaN;
      fp.update(0.016);

      const { yaw, pitch } = getYawPitch(camera.quaternion);
      expect(Number.isFinite(yaw)).toBe(true);
      expect(Number.isFinite(pitch)).toBe(true);
      fp.dispose();
    });
  });

  describe('pointer lock integration', () => {
    it('disconnects PointerLockControls internal listeners on construct', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const plModule = await import('three/examples/jsm/controls/PointerLockControls.js');
      const PL = plModule.PointerLockControls as any;
      new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      expect(PL.mock.instances[0].disconnect).toHaveBeenCalled();
    });

    it('isLocked reflects document.pointerLockElement, not internal flag', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      expect(fp.isLocked).toBe(true);
      (document as any).pointerLockElement = null;
      simulateLock();
      fakeTime = 200;
      expect(fp.isLocked).toBe(false);
      fp.dispose();
    });

    it('ignores mouse moves within 150ms of lock (pointer-lock garbage delta)', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();

      fakeTime = 50;
      simulateMouseMove(9999, 0);
      fp.update(0.016);
      const { yaw: yawInWindow } = getYawPitch(camera.quaternion);
      expect(Math.abs(yawInWindow)).toBeLessThan(0.001);

      fakeTime = 200;
      simulateMouseMove(30, 0);
      fp.update(0.016);
      const { yaw: yawAfterWindow } = getYawPitch(camera.quaternion);
      expect(Math.abs(yawAfterWindow)).toBeGreaterThan(0.01);
      fp.dispose();
    });

    it('syncFromCamera adopts the live orientation', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      camera.quaternion.setFromEuler(new MockEuler(0.2, 0.5, 0, 'YXZ'));

      fp.syncFromCamera();
      fp.update(0.016);
      const { yaw, pitch } = getYawPitch(camera.quaternion);
      expect(Math.abs(yaw - 0.5)).toBeLessThan(0.01);
      expect(Math.abs(pitch - 0.2)).toBeLessThan(0.01);
      fp.dispose();
    });

    it('clamps a steep syncFromCamera pitch', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      const steep = 89 * Math.PI / 180;
      camera.quaternion.setFromEuler(new MockEuler(steep, 0, 0, 'YXZ'));

      fp.syncFromCamera();
      fp.update(0.016);

      const { pitch } = getYawPitch(camera.quaternion);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(PITCH_LIMIT + 0.01);
      fp.dispose();
    });

    it('clamps a steep onLockChange pitch', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      const steep = -88 * Math.PI / 180;
      camera.quaternion.setFromEuler(new MockEuler(steep, 0, 0, 'YXZ'));
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;

      fp.update(0.016);

      const { pitch } = getYawPitch(camera.quaternion);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(PITCH_LIMIT + 0.01);
      fp.dispose();
    });

    it('syncFromCamera with NaN quaternion resets to 0, not NaN', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      camera.quaternion.set(NaN, NaN, NaN, NaN);

      fp.syncFromCamera();
      fp.update(0.016);

      const { yaw, pitch } = getYawPitch(camera.quaternion);
      expect(Number.isFinite(yaw)).toBe(true);
      expect(Number.isFinite(pitch)).toBe(true);
      fp.dispose();
    });

    it('update final clamp catches pitch set beyond limit externally', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      (fp as any).pitch = 999;
      fp.update(0.016);

      const { pitch } = getYawPitch(camera.quaternion);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(PITCH_LIMIT + 0.01);
      fp.dispose();
    });
  });

  describe('pointer-lock loss race window', () => {
    it('ignores mousemove when DOM lock is gone even if cached _isLocked is stale', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      (document as any).pointerLockElement = canvas;
      simulateLock();
      fakeTime = 200;
      simulateMouseMove(0, 0);

      (document as any).pointerLockElement = null;

      simulateMouseMove(200, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      expect(Math.abs(yaw)).toBeLessThan(0.001);
      fp.dispose();
    });
  });
});
