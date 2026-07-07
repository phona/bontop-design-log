import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RoomLayout } from '@shared/types';

const mockObject3D = {
  position: { x: 0, y: 1.6, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
};

vi.mock('three', () => {
  class Vector3 {
    x = 0; y = 0; z = 0;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    normalize() {
      const len = Math.sqrt(this.lengthSq());
      if (len > 0) { this.x /= len; this.y /= len; this.z /= len; }
      return this;
    }
    applyQuaternion() { return this; }
  }
  return {
    Vector3,
    PerspectiveCamera: class {
      position = { x: 0, y: 1.6, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
    },
    Object3D: class {
      position = { ...mockObject3D.position };
      quaternion = { ...mockObject3D.quaternion };
    },
  };
});

vi.mock('three/examples/jsm/controls/PointerLockControls.js', () => {
  return {
    PointerLockControls: vi.fn().mockImplementation(function () {
      return {
        lock: vi.fn(),
        unlock: vi.fn(),
        isLocked: false,
        getObject: () => mockObject3D,
      };
    }),
  };
});

const rooms: RoomLayout[] = [
  { id: 'r', name: 'R', x: 0, z: 0, width: 10, depth: 10, height: 3, type: 'public' },
];

describe('FirstPersonController', () => {
  let camera: any;
  let canvas: any;
  let eventListeners: Record<string, Array<(e: any) => void>>;

  beforeEach(() => {
    camera = { position: { x: 0, y: 1.6, z: 0 } };
    canvas = {};
    eventListeners = {};
    vi.stubGlobal('document', {
      addEventListener: vi.fn((event: string, handler: (e: any) => void) => {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handler);
      }),
      removeEventListener: vi.fn(),
      pointerLockElement: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates without error', async () => {
    const { FirstPersonController } = await import('./FirstPersonController.js');
    const { CollisionDetector } = await import('./CollisionDetector.js');
    const fp = new FirstPersonController(camera, canvas, new CollisionDetector(rooms));
    expect(fp).toBeDefined();
    expect(fp.isLocked).toBe(false);
    fp.dispose();
  });

  it('enable/disable toggles state', async () => {
    const { FirstPersonController } = await import('./FirstPersonController.js');
    const { CollisionDetector } = await import('./CollisionDetector.js');
    const fp = new FirstPersonController(camera, canvas, new CollisionDetector(rooms));
    fp.enable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.disable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.dispose();
  });
});
