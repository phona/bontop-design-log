import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WallSegment } from '@shared/types';

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

  beforeEach(() => {
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

  describe('pitch clamping', () => {
    it('clamps pitch to ±80 degrees when looking down', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      simulateLock();

      simulateMouseMove(0, 5000);
      for (let i = 0; i < 60; i++) fp.update(0.016);

      const { pitch } = getYawPitch(camera.quaternion);
      const limit = 80 * Math.PI / 180;
      expect(pitch).toBeGreaterThanOrEqual(-limit - 0.02);
      fp.dispose();
    });

    it('clamps pitch to ±80 degrees when looking up', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      simulateLock();

      simulateMouseMove(0, -5000);
      for (let i = 0; i < 60; i++) fp.update(0.016);

      const { pitch } = getYawPitch(camera.quaternion);
      const limit = 80 * Math.PI / 180;
      expect(pitch).toBeLessThanOrEqual(limit + 0.02);
      fp.dispose();
    });
  });

  describe('rotation smoothing', () => {
    it('does not snap to full rotation in one frame', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      simulateLock();

      simulateMouseMove(200, 0);
      fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      const fullRotation = 200 * 0.002;
      expect(Math.abs(yaw)).toBeLessThan(fullRotation * 0.9);
      fp.dispose();
    });

    it('converges to target rotation over multiple frames', async () => {
      const { FirstPersonController } = await import('./FirstPersonController.js');
      const { CollisionDetector } = await import('./CollisionDetector.js');
      const fp = new FirstPersonController(camera, canvas, new CollisionDetector(walls));
      fp.enable();
      fp.requestLock();
      simulateLock();

      simulateMouseMove(100, 0);
      for (let i = 0; i < 60; i++) fp.update(0.016);

      const { yaw } = getYawPitch(camera.quaternion);
      const target = -(100 * 0.002);
      expect(Math.abs(yaw - target)).toBeLessThan(0.02);
      fp.dispose();
    });
  });
});
