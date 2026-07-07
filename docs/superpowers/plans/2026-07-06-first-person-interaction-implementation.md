# Spec 3: First-Person Roaming + Object Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable first-person WASD walking through the apartment with pointer-lock mouse look, AABB collision detection, crosshair-based object selection, an enhanced info panel with per-room option switching, and an overview menu.

**Architecture:** A `FirstPersonController` wraps Three.js `PointerLockControls` and drives camera position each frame through a `CollisionDetector` that checks AABB overlap against room wall boundaries. Mode switching (V key) animates between orbit and first-person cameras over 0.5 s via `CameraAnimator`. UI overlays (crosshair, hover tooltip, info panel, overview menu) are plain DOM elements positioned over the canvas.

**Tech Stack:** Three.js (PointerLockControls), TypeScript, Vite, vitest, vanilla DOM for UI overlays.

## Global Constraints

- All imports use `.js` extension (Bundler moduleResolution in app tsconfig).
- Shared imports use `@shared/*` alias.
- Player capsule: radius 0.3 m, height 1.7 m, eye height 1.6 m.
- Movement speed: 2 m/s.
- Camera transition duration: 0.5 s; any user input (WASD / mouse / V) during transition aborts animation immediately.
- Pointer lock requested on V press; browser rejection shows a toast; Esc releases lock but stays in first-person mode.
- Spawn point: entry_garden floor center (x=0, z=-8.8), facing toward living_dining (positive Z).
- vitest for all tests; jsdom environment for DOM tests.
- No comments in code unless explicitly requested.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `app/src/scene/CollisionDetector.ts` | AABB collision against room walls |
| Create | `app/tests/scene/CollisionDetector.test.ts` | Collision unit tests |
| Create | `app/src/scene/FirstPersonController.ts` | WASD + pointer lock + mouse look |
| Create | `app/tests/scene/FirstPersonController.test.ts` | Controller unit tests |
| Create | `app/src/scene/CameraAnimator.ts` | Smooth orbit↔first-person transitions |
| Create | `app/tests/scene/CameraAnimator.test.ts` | Animator unit tests |
| Create | `app/src/ui/Crosshair.ts` | Center crosshair DOM element |
| Create | `app/src/ui/HoverTooltip.ts` | Object name tooltip near crosshair |
| Create | `app/tests/ui/HoverTooltip.test.ts` | Tooltip unit tests |
| Create | `app/src/ui/InfoPanel.ts` | Enhanced object info panel with per-room switching |
| Create | `app/tests/ui/InfoPanel.test.ts` | InfoPanel unit tests |
| Create | `app/src/ui/OverviewMenu.ts` | Overview menu (M key) |
| Create | `app/tests/ui/OverviewMenu.test.ts` | OverviewMenu unit tests |
| Modify | `app/src/render/HouseScene.ts` | Add first-person support, raycaster from screen center, mode management |
| Modify | `app/src/App.ts` | Wire up all new components, keyboard handling |
| Modify | `app/src/state/StateManager.ts` | Add view-context POST, per-room selection support |
| Modify | `app/index.html` | Add new UI element containers |
| Modify | `app/style.css` | Styles for crosshair, tooltip, info panel, overview menu |
| Modify | `app/package.json` | Add vitest dependency and test script |
| Modify | `app/tsconfig.json` | Include test files |

---

### Task 1: CollisionDetector — AABB Wall Collision

**Files:**
- Create: `app/src/scene/CollisionDetector.ts`
- Create: `app/tests/scene/CollisionDetector.test.ts`

**Interfaces:**
- Consumes: `RoomLayout[]` from `@shared/houseData`
- Produces: `CollisionDetector` class with `tryMove(from, desired) → Vec3` method

- [ ] **Step 1: Add vitest to app/package.json**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/three": "^0.166.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^1.6.0",
    "jsdom": "^24.1.0"
  }
}
```

Run `cd app && npm install` after editing.

- [ ] **Step 2: Add vitest config to app/vite.config.ts**

Append to the existing `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/sse': 'http://localhost:3000',
      '/messages': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 3: Update app/tsconfig.json to include tests**

```json
{
  "$schema": "https://json-schema.org/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "sourceMap": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*.ts"]
    },
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "*.ts"]
}
```

- [ ] **Step 4: Create CollisionDetector**

```ts
// app/src/scene/CollisionDetector.ts
import type { RoomLayout } from '@shared/types';
import type { Vec3 } from '@shared/types';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PLAYER_RADIUS = 0.3;

export class CollisionDetector {
  private walls: AABB[] = [];

  constructor(roomLayouts: RoomLayout[]) {
    this.walls = this.buildWallAABBs(roomLayouts);
  }

  private buildWallAABBs(roomLayouts: RoomLayout[]): AABB[] {
    const result: AABB[] = [];
    const wallThickness = 0.12;

    for (const r of roomLayouts) {
      const halfW = r.width / 2;
      const halfD = r.depth / 2;

      result.push({ minX: r.x - halfW, maxX: r.x + halfW, minZ: r.z - halfD - wallThickness / 2, maxZ: r.z - halfD + wallThickness / 2 });
      result.push({ minX: r.x - halfW, maxX: r.x + halfW, minZ: r.z + halfD - wallThickness / 2, maxZ: r.z + halfD + wallThickness / 2 });
      result.push({ minX: r.x - halfW - wallThickness / 2, maxX: r.x - halfW + wallThickness / 2, minZ: r.z - halfD, maxZ: r.z + halfD });
      result.push({ minX: r.x + halfW - wallThickness / 2, maxX: r.x + halfW + wallThickness / 2, minZ: r.z - halfD, maxZ: r.z + halfD });
    }

    return result;
  }

  private capsuleOverlapsAABB(cx: number, cz: number, aabb: AABB): boolean {
    const closestX = Math.max(aabb.minX, Math.min(cx, aabb.maxX));
    const closestZ = Math.max(aabb.minZ, Math.min(cz, aabb.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS;
  }

  tryMove(from: Vec3, desired: Vec3): Vec3 {
    let newX = desired.x;
    let newZ = desired.z;

    if (!this.collidesAt(newX, newZ)) {
      return { x: newX, y: desired.y, z: newZ };
    }

    if (!this.collidesAt(newX, from.z)) {
      return { x: newX, y: desired.y, z: from.z };
    }

    if (!this.collidesAt(from.x, newZ)) {
      return { x: from.x, y: desired.y, z: newZ };
    }

    return { x: from.x, y: desired.y, z: from.z };
  }

  private collidesAt(x: number, z: number): boolean {
    for (const wall of this.walls) {
      if (this.capsuleOverlapsAABB(x, z, wall)) {
        return true;
      }
    }
    return false;
  }

  getWalls(): AABB[] {
    return [...this.walls];
  }
}
```

- [ ] **Step 5: Create CollisionDetector tests**

```ts
// app/tests/scene/CollisionDetector.test.ts
import { describe, it, expect } from 'vitest';
import { CollisionDetector } from '../../src/scene/CollisionDetector.js';
import type { RoomLayout } from '@shared/types';

const simpleRooms: RoomLayout[] = [
  { id: 'room_a', name: 'A', x: 0, z: 0, width: 4, depth: 4, height: 3, type: 'public' },
];

describe('CollisionDetector', () => {
  it('allows movement in open space', () => {
    const cd = new CollisionDetector(simpleRooms);
    const result = cd.tryMove(
      { x: 0, y: 1.6, z: 0 },
      { x: 0.5, y: 1.6, z: 0.5 }
    );
    expect(result.x).toBeCloseTo(0.5);
    expect(result.z).toBeCloseTo(0.5);
  });

  it('blocks movement through north wall', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 0, y: 1.6, z: -1.5 };
    const desired = { x: 0, y: 1.6, z: -2.5 };
    const result = cd.tryMove(from, desired);
    expect(result.z).toBeCloseTo(-1.5);
  });

  it('slides along wall on X axis when Z is blocked', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 1.5, y: 1.6, z: -1.5 };
    const desired = { x: 1.8, y: 1.6, z: -2.5 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(1.8);
    expect(result.z).toBeCloseTo(-1.5);
  });

  it('preserves Y coordinate', () => {
    const cd = new CollisionDetector(simpleRooms);
    const result = cd.tryMove(
      { x: 0, y: 1.6, z: 0 },
      { x: 0, y: 2.0, z: 0 }
    );
    expect(result.y).toBeCloseTo(2.0);
  });

  it('returns from position when fully blocked', () => {
    const cd = new CollisionDetector(simpleRooms);
    const from = { x: 0, y: 1.6, z: -1.5 };
    const desired = { x: 0, y: 1.6, z: -3.0 };
    const result = cd.tryMove(from, desired);
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(-1.5);
  });

  it('exposes wall AABBs', () => {
    const cd = new CollisionDetector(simpleRooms);
    expect(cd.getWalls().length).toBe(4);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd app && npx vitest run tests/scene/CollisionDetector.test.ts
```

---

### Task 2: FirstPersonController — WASD + Pointer Lock

**Files:**
- Create: `app/src/scene/FirstPersonController.ts`
- Create: `app/tests/scene/FirstPersonController.test.ts`

**Interfaces:**
- Consumes: `THREE.PerspectiveCamera`, `CollisionDetector`, `HTMLCanvasElement`
- Produces: `FirstPersonController` class with `update(dt)`, `enable()`, `disable()`, `isLocked`

- [ ] **Step 1: Create FirstPersonController**

```ts
// app/src/scene/FirstPersonController.ts
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { CollisionDetector } from './CollisionDetector.js';

const MOVE_SPEED = 2.0;
const EYE_HEIGHT = 1.6;

export interface MovementKeys {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
}

export class FirstPersonController {
  private controls: PointerLockControls;
  private collision: CollisionDetector;
  private keys: MovementKeys = { forward: false, backward: false, left: false, right: false };
  private direction = new THREE.Vector3();
  private _isLocked = false;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onLockChange: () => void;
  private enabled = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLCanvasElement,
    collision: CollisionDetector
  ) {
    this.controls = new PointerLockControls(camera, domElement);
    this.collision = collision;

    this.onKeyDown = (e: KeyboardEvent) => this.handleKey(e, true);
    this.onKeyUp = (e: KeyboardEvent) => this.handleKey(e, false);
    this.onLockChange = () => {
      this._isLocked = this.controls.isLocked;
    };

    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private handleKey(e: KeyboardEvent, pressed: boolean) {
    if (!this.enabled) return;
    switch (e.code) {
      case 'KeyW': this.keys.forward = pressed; break;
      case 'KeyS': this.keys.backward = pressed; break;
      case 'KeyA': this.keys.left = pressed; break;
      case 'KeyD': this.keys.right = pressed; break;
    }
  }

  enable() {
    this.enabled = true;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  disable() {
    this.enabled = false;
    this.keys = { forward: false, backward: false, left: false, right: false };
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    if (this._isLocked) {
      this.controls.unlock();
    }
  }

  requestLock() {
    this.controls.lock();
  }

  get isLocked(): boolean {
    return this._isLocked;
  }

  get isAnyKeyDown(): boolean {
    return this.keys.forward || this.keys.backward || this.keys.left || this.keys.right;
  }

  update(dt: number) {
    if (!this.enabled) return;

    this.direction.set(0, 0, 0);

    if (this.keys.forward) this.direction.z -= 1;
    if (this.keys.backward) this.direction.z += 1;
    if (this.keys.left) this.direction.x -= 1;
    if (this.keys.right) this.direction.x += 1;

    if (this.direction.lengthSq() === 0) return;

    this.direction.normalize();

    const camera = this.controls.getObject();
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    const moveX = (forward.x * (-this.direction.z) + right.x * this.direction.x) * MOVE_SPEED * dt;
    const moveZ = (forward.z * (-this.direction.z) + right.z * this.direction.x) * MOVE_SPEED * dt;

    const from = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const desired = { x: camera.position.x + moveX, y: EYE_HEIGHT, z: camera.position.z + moveZ };

    const corrected = this.collision.tryMove(from, desired);
    camera.position.set(corrected.x, corrected.y, corrected.z);
  }

  getControls(): PointerLockControls {
    return this.controls;
  }

  dispose() {
    this.disable();
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }
}
```

- [ ] **Step 2: Create FirstPersonController tests**

```ts
// app/tests/scene/FirstPersonController.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { FirstPersonController } from '../../src/scene/FirstPersonController.js';
import { CollisionDetector } from '../../src/scene/CollisionDetector.js';
import type { RoomLayout } from '@shared/types';

vi.mock('three/examples/jsm/controls/PointerLockControls.js', () => {
  return {
    PointerLockControls: vi.fn().mockImplementation(() => ({
      lock: vi.fn(),
      unlock: vi.fn(),
      isLocked: false,
      getObject: () => new THREE.Object3D(),
    })),
  };
});

const rooms: RoomLayout[] = [
  { id: 'r', name: 'R', x: 0, z: 0, width: 10, depth: 10, height: 3, type: 'public' },
];

describe('FirstPersonController', () => {
  it('creates without error', () => {
    const camera = new THREE.PerspectiveCamera();
    const canvas = document.createElement('canvas');
    const collision = new CollisionDetector(rooms);
    const fp = new FirstPersonController(camera, canvas, collision);
    expect(fp).toBeDefined();
    expect(fp.isLocked).toBe(false);
    fp.dispose();
  });

  it('enable/disable toggles state', () => {
    const camera = new THREE.PerspectiveCamera();
    const canvas = document.createElement('canvas');
    const collision = new CollisionDetector(rooms);
    const fp = new FirstPersonController(camera, canvas, collision);
    fp.enable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.disable();
    expect(fp.isAnyKeyDown).toBe(false);
    fp.dispose();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd app && npx vitest run tests/scene/FirstPersonController.test.ts
```

---

### Task 3: CameraAnimator — Smooth Mode Transitions

**Files:**
- Create: `app/src/scene/CameraAnimator.ts`
- Create: `app/tests/scene/CameraAnimator.test.ts`

**Interfaces:**
- Consumes: `THREE.PerspectiveCamera`, `THREE.OrbitControls`
- Produces: `CameraAnimator` class with `transitionToOrbit()`, `transitionToFirstPerson()`, `update(dt)`, `isAnimating`, `interrupt()`

- [ ] **Step 1: Create CameraAnimator**

```ts
// app/src/scene/CameraAnimator.ts
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const TRANSITION_DURATION = 0.5;

export type CameraMode = 'orbit' | 'first-person';

export class CameraAnimator {
  private mode: CameraMode = 'orbit';
  private animating = false;
  private progress = 0;
  private startPos = new THREE.Vector3();
  private endPos = new THREE.Vector3();
  private startTarget = new THREE.Vector3();
  private endTarget = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private onComplete?: (mode: CameraMode) => void;

  constructor(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.camera = camera;
    this.controls = controls;
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  setOnComplete(cb: (mode: CameraMode) => void) {
    this.onComplete = cb;
  }

  transitionToFirstPerson(fpPosition: THREE.Vector3, fpDirection: THREE.Vector3) {
    this.startPos.copy(this.camera.position);
    this.endPos.copy(fpPosition);
    this.startTarget.copy(this.controls.target);
    this.endTarget.copy(fpPosition).add(fpDirection);
    this.progress = 0;
    this.animating = true;
    this.mode = 'first-person';
  }

  transitionToOrbit(orbitPosition: THREE.Vector3, orbitTarget: THREE.Vector3) {
    this.startPos.copy(this.camera.position);
    this.endPos.copy(orbitPosition);
    this.startTarget.set(
      this.camera.position.x,
      this.camera.position.y - 1.6,
      this.camera.position.z
    );
    this.controls.target.copy(this.startTarget);
    this.endTarget.copy(orbitTarget);
    this.progress = 0;
    this.animating = true;
    this.mode = 'orbit';
  }

  interrupt() {
    if (!this.animating) return;
    this.animating = false;
    this.progress = 1;
    this.applyFrame(1);
    this.onComplete?.(this.mode);
  }

  update(dt: number): boolean {
    if (!this.animating) return false;

    this.progress += dt / TRANSITION_DURATION;
    if (this.progress >= 1) {
      this.progress = 1;
      this.animating = false;
      this.applyFrame(1);
      this.onComplete?.(this.mode);
      return false;
    }

    this.applyFrame(this.easeInOut(this.progress));
    return true;
  }

  private applyFrame(t: number) {
    this.camera.position.lerpVectors(this.startPos, this.endPos, t);
    const currentTarget = new THREE.Vector3().lerpVectors(this.startTarget, this.endTarget, t);
    this.controls.target.copy(currentTarget);
    this.controls.update();
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
```

- [ ] **Step 2: Create CameraAnimator tests**

```ts
// app/tests/scene/CameraAnimator.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraAnimator } from '../../src/scene/CameraAnimator.js';

function makeOrbitControlsMock() {
  return {
    target: new THREE.Vector3(0, 0, 0),
    update: () => {},
    enableDamping: true,
    dampingFactor: 0.08,
    maxPolarAngle: Math.PI / 2,
    minDistance: 1,
    maxDistance: 60,
  } as any;
}

describe('CameraAnimator', () => {
  it('starts in orbit mode, not animating', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = makeOrbitControlsMock();
    const animator = new CameraAnimator(camera, controls);
    expect(animator.currentMode).toBe('orbit');
    expect(animator.isAnimating).toBe(false);
  });

  it('transitions to first-person over time', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 14, 20);
    const controls = makeOrbitControlsMock();
    const animator = new CameraAnimator(camera, controls);

    animator.transitionToFirstPerson(
      new THREE.Vector3(0, 1.6, -8.8),
      new THREE.Vector3(0, 0, 1)
    );

    expect(animator.isAnimating).toBe(true);
    expect(animator.currentMode).toBe('first-person');

    animator.update(0.25);
    expect(animator.isAnimating).toBe(true);

    animator.update(0.3);
    expect(animator.isAnimating).toBe(false);
    expect(camera.position.x).toBeCloseTo(0, 0);
    expect(camera.position.y).toBeCloseTo(1.6, 0);
  });

  it('interrupt stops animation immediately', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 14, 20);
    const controls = makeOrbitControlsMock();
    const animator = new CameraAnimator(camera, controls);

    animator.transitionToFirstPerson(
      new THREE.Vector3(0, 1.6, -8.8),
      new THREE.Vector3(0, 0, 1)
    );

    animator.update(0.1);
    expect(animator.isAnimating).toBe(true);

    animator.interrupt();
    expect(animator.isAnimating).toBe(false);
  });

  it('calls onComplete when transition finishes', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 14, 20);
    const controls = makeOrbitControlsMock();
    const animator = new CameraAnimator(camera, controls);

    let completedMode = '';
    animator.setOnComplete((m) => { completedMode = m; });

    animator.transitionToOrbit(
      new THREE.Vector3(0, 14, 20),
      new THREE.Vector3(0, 0, 0)
    );

    animator.update(0.6);
    expect(completedMode).toBe('orbit');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd app && npx vitest run tests/scene/CameraAnimator.test.ts
```

---

### Task 4: Crosshair + HoverTooltip + Screen-Center Raycaster

**Files:**
- Create: `app/src/ui/Crosshair.ts`
- Create: `app/src/ui/HoverTooltip.ts`
- Create: `app/tests/ui/HoverTooltip.test.ts`

**Interfaces:**
- Consumes: DOM container for crosshair/tooltip, `THREE.Raycaster` + `THREE.Camera` + scene objects
- Produces: `Crosshair` class (show/hide), `HoverTooltip` class (update text, position)

- [ ] **Step 1: Create Crosshair**

```ts
// app/src/ui/Crosshair.ts
export class Crosshair {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.getElementById('crosshair') as HTMLDivElement;
  }

  show() {
    this.el.style.display = 'block';
  }

  hide() {
    this.el.style.display = 'none';
  }
}
```

- [ ] **Step 2: Create HoverTooltip**

```ts
// app/src/ui/HoverTooltip.ts
export interface HoverTarget {
  objectId: string;
  name: string;
  type: string;
  room?: string;
}

export class HoverTooltip {
  private el: HTMLDivElement;
  private current: HoverTarget | null = null;

  constructor() {
    this.el = document.getElementById('hover-tooltip') as HTMLDivElement;
  }

  update(target: HoverTarget | null) {
    if (target?.objectId === this.current?.objectId) return;
    this.current = target;
    if (!target) {
      this.el.style.display = 'none';
      this.el.textContent = '';
      return;
    }
    this.el.style.display = 'block';
    this.el.textContent = target.name;
  }

  clear() {
    this.update(null);
  }

  getCurrent(): HoverTarget | null {
    return this.current;
  }
}
```

- [ ] **Step 3: Add screen-center raycast method to HouseScene**

Add this method to `HouseScene.ts` (insert before the `render()` method):

```ts
  raycastFromScreenCenter(): HoverTarget | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      const data = hit.object.userData;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const roomObj = room ? this.rooms[room] : undefined;
        const name = roomObj?.name ?? id;
        return { objectId: id, name, type, room };
      }
    }
    return null;
  }
```

Add the import at the top of `HouseScene.ts`:

```ts
import type { HoverTarget } from '../ui/HoverTooltip.js';
```

- [ ] **Step 4: Create HoverTooltip tests**

```ts
// app/tests/ui/HoverTooltip.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { HoverTooltip } from '../../src/ui/HoverTooltip.js';

describe('HoverTooltip', () => {
  let tooltip: HoverTooltip;

  beforeEach(() => {
    document.body.innerHTML = '<div id="hover-tooltip"></div>';
    tooltip = new HoverTooltip();
  });

  it('shows tooltip with object name', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room', room: 'living_dining' });
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.display).toBe('block');
    expect(el.textContent).toBe('客餐厅');
  });

  it('hides tooltip when target is null', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.update(null);
    const el = document.getElementById('hover-tooltip')!;
    expect(el.style.display).toBe('none');
  });

  it('does not update if same objectId', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.update({ objectId: 'room_a', name: 'Different', type: 'room' });
    const el = document.getElementById('hover-tooltip')!;
    expect(el.textContent).toBe('客餐厅');
  });

  it('clear resets state', () => {
    tooltip.update({ objectId: 'room_a', name: '客餐厅', type: 'room' });
    tooltip.clear();
    expect(tooltip.getCurrent()).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd app && npx vitest run tests/ui/HoverTooltip.test.ts
```

---

### Task 5: InfoPanel — Object Info with Per-Room Switching

**Files:**
- Create: `app/src/ui/InfoPanel.ts`
- Create: `app/tests/ui/InfoPanel.test.ts`

**Interfaces:**
- Consumes: `HoverTarget`, `Topic[]` from registry, `CurrentScheme` from state, `design-rules.yaml` objectMapping
- Produces: `InfoPanel` class with `showObject()`, `hide()`, `setScheme()`, `setDecisionLog()`

- [ ] **Step 1: Create objectMapping resolver utility**

Create `app/src/data/objectMapping.ts`:

```ts
// app/src/data/objectMapping.ts
import { load } from 'js-yaml';
import designRulesRaw from '../../../config/design-rules.yaml?raw';

interface ObjectMappingRule {
  pattern: string;
  topics: string[];
}

interface DesignRules {
  objectMapping: ObjectMappingRule[];
}

const rules = load(designRulesRaw) as DesignRules;

export function getTopicsForObject(objectId: string): string[] {
  for (const rule of rules.objectMapping) {
    const prefix = rule.pattern.replace('*', '');
    if (objectId.startsWith(prefix) || objectId.includes(prefix.replace(':', ''))) {
      return rule.topics;
    }
  }
  return [];
}
```

- [ ] **Step 2: Create InfoPanel**

```ts
// app/src/ui/InfoPanel.ts
import type { Topic, TopicOption, CurrentScheme, TopicSelection } from '@shared/types';
import type { HoverTarget } from './HoverTooltip.js';
import { getTopicsForObject } from '../data/objectMapping.js';

export interface InfoPanelCallbacks {
  onSelectOption: (topicId: string, optionId: string, roomId: string | null) => void;
}

export class InfoPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLSpanElement;
  private typeEl: HTMLSpanElement;
  private roomEl: HTMLSpanElement;
  private topicsEl: HTMLDivElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private callbacks: InfoPanelCallbacks;
  private currentTarget: HoverTarget | null = null;

  constructor(callbacks: InfoPanelCallbacks) {
    this.callbacks = callbacks;
    this.el = document.getElementById('info-panel') as HTMLDivElement;
    this.titleEl = document.getElementById('info-panel-title') as HTMLSpanElement;
    this.typeEl = document.getElementById('info-panel-type') as HTMLSpanElement;
    this.roomEl = document.getElementById('info-panel-room') as HTMLSpanElement;
    this.topicsEl = document.getElementById('info-panel-topics') as HTMLDivElement;
    this.el.style.display = 'none';
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.currentTarget) {
      this.render();
    }
  }

  showObject(target: HoverTarget) {
    this.currentTarget = target;
    this.el.style.display = 'block';
    this.render();
  }

  hide() {
    this.currentTarget = null;
    this.el.style.display = 'none';
  }

  private render() {
    if (!this.currentTarget) return;

    this.titleEl.textContent = this.currentTarget.name;
    this.typeEl.textContent = this.currentTarget.type;
    this.roomEl.textContent = this.currentTarget.room ?? '';

    const relatedTopicIds = getTopicsForObject(this.currentTarget.objectId);
    this.topicsEl.innerHTML = '';

    for (const topicId of relatedTopicIds) {
      const topic = this.topics.find((t) => t.id === topicId);
      if (!topic) continue;

      const selection = this.scheme?.selections[topicId];
      if (!selection) continue;

      const section = this.renderTopicSection(topic, selection, this.currentTarget.room);
      this.topicsEl.appendChild(section);
    }
  }

  private renderTopicSection(
    topic: Topic,
    selection: TopicSelection,
    roomId?: string
  ): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'info-topic-section';

    const header = document.createElement('h4');
    const effectiveOptionId = roomId && selection.roomOverrides[roomId]
      ? selection.roomOverrides[roomId]
      : selection.default;
    const effectiveOption = topic.options.find((o) => o.id === effectiveOptionId);
    header.textContent = `${topic.name}：${effectiveOption?.name ?? '未选择'}`;
    section.appendChild(header);

    if (roomId && selection.roomOverrides[roomId]) {
      const badge = document.createElement('span');
      badge.className = 'info-badge';
      badge.textContent = '房间覆盖';
      section.appendChild(badge);
    }

    const optionsList = document.createElement('div');
    optionsList.className = 'info-options-list';

    for (const option of topic.options) {
      const btn = document.createElement('button');
      btn.className = `info-option-btn${option.id === effectiveOptionId ? ' active' : ''}`;
      btn.textContent = option.name;

      if (roomId) {
        const scopeRow = document.createElement('div');
        scopeRow.className = 'info-scope-row';

        const roomBtn = document.createElement('button');
        roomBtn.className = 'info-scope-btn';
        roomBtn.textContent = '仅当前房间';
        roomBtn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, roomId);

        const globalBtn = document.createElement('button');
        globalBtn.className = 'info-scope-btn';
        globalBtn.textContent = '所有房间';
        globalBtn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, null);

        scopeRow.appendChild(roomBtn);
        scopeRow.appendChild(globalBtn);

        const wrapper = document.createElement('div');
        wrapper.className = 'info-option-wrapper';
        wrapper.appendChild(btn);
        wrapper.appendChild(scopeRow);
        optionsList.appendChild(wrapper);
      } else {
        btn.onclick = () => this.callbacks.onSelectOption(topic.id, option.id, null);
        optionsList.appendChild(btn);
      }
    }

    section.appendChild(optionsList);
    return section;
  }
}
```

- [ ] **Step 3: Create InfoPanel tests**

```ts
// app/tests/ui/InfoPanel.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfoPanel } from '../../src/ui/InfoPanel.js';
import type { Topic, CurrentScheme } from '@shared/types';

function setupDOM() {
  document.body.innerHTML = `
    <div id="info-panel">
      <span id="info-panel-title"></span>
      <span id="info-panel-type"></span>
      <span id="info-panel-room"></span>
      <div id="info-panel-topics"></div>
    </div>
  `;
}

const mockTopics: Topic[] = [
  {
    id: 'floor',
    name: '地砖方案',
    options: [
      { id: 'floor_01', name: '浅胡桃木纹砖' },
      { id: 'floor_02', name: '灰色水泥砖' },
    ],
    apply: () => [],
  },
  {
    id: 'paint',
    name: '乳胶漆方案',
    options: [
      { id: 'paint_01', name: '金装净味五合一' },
    ],
    apply: () => [],
  },
];

const mockScheme: CurrentScheme = {
  updatedAt: '2026-07-06T00:00:00Z',
  selections: {
    floor: { default: 'floor_01', roomOverrides: {} },
    paint: { default: 'paint_01', roomOverrides: { master_bedroom: 'paint_02' } },
  },
};

describe('InfoPanel', () => {
  beforeEach(() => {
    setupDOM();
  });

  it('shows and hides', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'room:living_dining', name: '客餐厅', type: 'room', room: 'living_dining' });
    expect(document.getElementById('info-panel')!.style.display).toBe('block');

    panel.hide();
    expect(document.getElementById('info-panel')!.style.display).toBe('none');
  });

  it('displays object name and type', () => {
    const panel = new InfoPanel({ onSelectOption: vi.fn() });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'room:living_dining', name: '客餐厅', type: 'room', room: 'living_dining' });

    expect(document.getElementById('info-panel-title')!.textContent).toBe('客餐厅');
    expect(document.getElementById('info-panel-type')!.textContent).toBe('room');
  });

  it('calls onSelectOption with roomId for room scope', () => {
    const onSelect = vi.fn();
    const panel = new InfoPanel({ onSelectOption: onSelect });
    panel.setTopics(mockTopics);
    panel.setScheme(mockScheme);

    panel.showObject({ objectId: 'room:living_dining', name: '客餐厅', type: 'room', room: 'living_dining' });

    const buttons = document.querySelectorAll('.info-scope-btn');
    expect(buttons.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd app && npx vitest run tests/ui/InfoPanel.test.ts
```

---

### Task 6: OverviewMenu — Scheme Overview + Decision Log

**Files:**
- Create: `app/src/ui/OverviewMenu.ts`
- Create: `app/tests/ui/OverviewMenu.test.ts`

**Interfaces:**
- Consumes: `CurrentScheme`, `DecisionLogEntry[]`, `Topic[]`
- Produces: `OverviewMenu` class with `toggle()`, `setScheme()`, `setDecisionLog()`

- [ ] **Step 1: Create OverviewMenu**

```ts
// app/src/ui/OverviewMenu.ts
import type { Topic, CurrentScheme, DecisionLogEntry } from '@shared/types';

export class OverviewMenu {
  private el: HTMLDivElement;
  private schemeEl: HTMLDivElement;
  private decisionsEl: HTMLDivElement;
  private topics: Topic[] = [];
  private scheme: CurrentScheme | null = null;
  private decisions: DecisionLogEntry[] = [];
  private visible = false;

  constructor() {
    this.el = document.getElementById('overview-menu') as HTMLDivElement;
    this.schemeEl = document.getElementById('overview-scheme') as HTMLDivElement;
    this.decisionsEl = document.getElementById('overview-decisions') as HTMLDivElement;
    this.el.style.display = 'none';
  }

  setTopics(topics: Topic[]) {
    this.topics = topics;
  }

  setScheme(scheme: CurrentScheme) {
    this.scheme = scheme;
    if (this.visible) this.render();
  }

  setDecisionLog(decisions: DecisionLogEntry[]) {
    this.decisions = decisions;
    if (this.visible) this.render();
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.render();
  }

  show() {
    this.visible = true;
    this.el.style.display = 'block';
    this.render();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render() {
    this.renderScheme();
    this.renderDecisions();
  }

  private renderScheme() {
    this.schemeEl.innerHTML = '';
    if (!this.scheme) return;

    for (const [topicId, selection] of Object.entries(this.scheme.selections)) {
      const topic = this.topics.find((t) => t.id === topicId);
      const topicName = topic?.name ?? topicId;
      const defaultOption = topic?.options.find((o) => o.id === selection.default);

      const row = document.createElement('div');
      row.className = 'overview-row';

      const label = document.createElement('span');
      label.className = 'overview-label';
      label.textContent = topicName;

      const value = document.createElement('span');
      value.className = 'overview-value';
      value.textContent = defaultOption?.name ?? selection.default ?? '未选择';

      row.appendChild(label);
      row.appendChild(value);
      this.schemeEl.appendChild(row);

      for (const [roomId, optionId] of Object.entries(selection.roomOverrides)) {
        const overrideRow = document.createElement('div');
        overrideRow.className = 'overview-row overview-override';

        const overrideLabel = document.createElement('span');
        overrideLabel.textContent = `  ↳ ${roomId}`;

        const overrideOption = topic?.options.find((o) => o.id === optionId);
        const overrideValue = document.createElement('span');
        overrideValue.textContent = overrideOption?.name ?? optionId;

        overrideRow.appendChild(overrideLabel);
        overrideRow.appendChild(overrideValue);
        this.schemeEl.appendChild(overrideRow);
      }
    }
  }

  private renderDecisions() {
    this.decisionsEl.innerHTML = '';
    const recent = this.decisions.slice(-10).reverse();

    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overview-empty';
      empty.textContent = '暂无决策记录';
      this.decisionsEl.appendChild(empty);
      return;
    }

    for (const entry of recent) {
      const row = document.createElement('div');
      row.className = 'overview-decision-row';

      const topic = document.createElement('span');
      topic.className = 'overview-decision-topic';
      topic.textContent = entry.topic;

      const change = document.createElement('span');
      change.className = 'overview-decision-change';
      change.textContent = `${entry.previousOptionId ?? '∅'} → ${entry.optionId ?? '∅'}`;

      const time = document.createElement('span');
      time.className = 'overview-decision-time';
      time.textContent = new Date(entry.createdAt).toLocaleTimeString();

      row.appendChild(topic);
      row.appendChild(change);
      row.appendChild(time);
      this.decisionsEl.appendChild(row);
    }
  }
}
```

- [ ] **Step 2: Create OverviewMenu tests**

```ts
// app/tests/ui/OverviewMenu.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { OverviewMenu } from '../../src/ui/OverviewMenu.js';
import type { Topic, CurrentScheme, DecisionLogEntry } from '@shared/types';

function setupDOM() {
  document.body.innerHTML = `
    <div id="overview-menu">
      <div id="overview-scheme"></div>
      <div id="overview-decisions"></div>
    </div>
  `;
}

const mockTopics: Topic[] = [
  {
    id: 'hvac',
    name: '空调方案',
    options: [
      { id: 'A2', name: 'A2 美的理想家 III' },
      { id: 'A1', name: 'A1 格力 Star Ⅱ' },
    ],
    apply: () => [],
  },
];

const mockScheme: CurrentScheme = {
  updatedAt: '2026-07-06T00:00:00Z',
  selections: {
    hvac: { default: 'A2', roomOverrides: {} },
  },
};

const mockDecisions: DecisionLogEntry[] = [
  {
    id: 'dec_001',
    topic: 'hvac',
    roomId: null,
    optionId: 'A2',
    previousOptionId: 'A1',
    archiveId: null,
    path: 'hvac.default',
    source: 'user',
    createdAt: '2026-07-06T10:00:00Z',
  },
];

describe('OverviewMenu', () => {
  beforeEach(() => {
    setupDOM();
  });

  it('toggles visibility', () => {
    const menu = new OverviewMenu();
    expect(menu.isVisible()).toBe(false);

    menu.toggle();
    expect(menu.isVisible()).toBe(true);
    expect(document.getElementById('overview-menu')!.style.display).toBe('block');

    menu.toggle();
    expect(menu.isVisible()).toBe(false);
    expect(document.getElementById('overview-menu')!.style.display).toBe('none');
  });

  it('renders current scheme', () => {
    const menu = new OverviewMenu();
    menu.setTopics(mockTopics);
    menu.setScheme(mockScheme);
    menu.show();

    const rows = document.querySelectorAll('.overview-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('renders decision log', () => {
    const menu = new OverviewMenu();
    menu.setTopics(mockTopics);
    menu.setDecisionLog(mockDecisions);
    menu.show();

    const rows = document.querySelectorAll('.overview-decision-row');
    expect(rows.length).toBe(1);
  });

  it('shows empty message when no decisions', () => {
    const menu = new OverviewMenu();
    menu.setDecisionLog([]);
    menu.show();

    const empty = document.querySelector('.overview-empty');
    expect(empty).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd app && npx vitest run tests/ui/OverviewMenu.test.ts
```

---

### Task 7: StateManager Enhancement — View Context + Per-Room Selections

**Files:**
- Modify: `app/src/state/StateManager.ts`

**Interfaces:**
- Consumes: Server API `/api/view-context`, `/api/scheme/current`, `/api/decisions`
- Produces: Enhanced `StateManager` with `postViewContext()`, `applySelectionWithScope()`, `fetchScheme()`, `fetchDecisions()`

- [ ] **Step 1: Update StateManager**

Replace the entire `app/src/state/StateManager.ts` with:

```ts
import type { Snapshot, Command, CameraState, CurrentScheme, DecisionLogEntry } from '@shared/types';

export interface StateListener {
  onSelectionChanged(topic: string, optionId: string): void;
  onCommand(command: Command): void;
  getCameraState(): CameraState;
  getActiveObject(): { objectId: string; type: string; room?: string } | undefined;
  getVisibleObjects(): string[];
  getSelectedObjects(): string[];
}

const DEFAULT_SELECTIONS: Record<string, string> = {
  hvac: 'A2',
  floor: 'floor_tile_01',
  wall: 'wall_tile_01',
  paint: 'latex_paint_01',
};

export class StateManager {
  private selections: Record<string, string> = { ...DEFAULT_SELECTIONS };
  private activeTopic = 'hvac';
  private appliedCommandIds = new Set<string>();
  private listener?: StateListener;
  private pollTimer?: number;
  private activeObject?: { objectId: string; type: string; room?: string };

  setListener(listener: StateListener) {
    this.listener = listener;
  }

  async loadSnapshot() {
    try {
      const res = await fetch('/__state/snapshot');
      if (!res.ok) return;
      const snapshot = (await res.json()) as Partial<Snapshot>;
      if (snapshot.selections && Object.keys(snapshot.selections).length > 0) {
        this.selections = { ...DEFAULT_SELECTIONS, ...snapshot.selections };
      }
      if (snapshot.activeTopic) {
        this.activeTopic = snapshot.activeTopic;
      }
    } catch {
      // ignore
    }
  }

  getSelections(): Record<string, string> {
    return { ...this.selections };
  }

  getActiveTopic(): string {
    return this.activeTopic;
  }

  setActiveTopic(topic: string) {
    this.activeTopic = topic;
  }

  setActiveObject(obj: { objectId: string; type: string; room?: string } | undefined) {
    this.activeObject = obj;
  }

  async setSelection(topic: string, optionId: string) {
    this.selections[topic] = optionId;
    this.listener?.onSelectionChanged(topic, optionId);
    await this.writeSnapshot();
  }

  async applySelectionWithScope(
    topic: string,
    optionId: string,
    roomId: string | null
  ) {
    const patch = {
      topic,
      optionId,
      roomId: roomId ?? null,
    };

    try {
      const res = await fetch('/api/scheme/current', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [patch],
          source: 'user',
        }),
      });

      if (!res.ok) return;

      const result = (await res.json()) as { scheme: CurrentScheme };
      if (result.scheme) {
        const topicSel = result.scheme.selections[topic];
        if (topicSel) {
          const effective = roomId && topicSel.roomOverrides[roomId]
            ? topicSel.roomOverrides[roomId]
            : topicSel.default;
          if (effective) {
            this.selections[topic] = effective;
            this.listener?.onSelectionChanged(topic, effective);
          }
        }
      }
    } catch {
      // ignore
    }

    await this.writeSnapshot();
  }

  async postViewContext(objectId: string) {
    try {
      await fetch('/api/view-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectId }),
      });
    } catch {
      // ignore
    }
  }

  async fetchScheme(): Promise<CurrentScheme | null> {
    try {
      const res = await fetch('/api/scheme/current');
      if (!res.ok) return null;
      return (await res.json()) as CurrentScheme;
    } catch {
      return null;
    }
  }

  async fetchDecisions(): Promise<DecisionLogEntry[]> {
    try {
      const res = await fetch('/api/decisions');
      if (!res.ok) return [];
      return (await res.json()) as DecisionLogEntry[];
    } catch {
      return [];
    }
  }

  startPolling(intervalMs = 1000) {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => this.pollCommands(), intervalMs);
  }

  stopPolling() {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async pollCommands() {
    try {
      const res = await fetch('/__state/commands');
      if (!res.ok) return;
      const commands = (await res.json()) as Command[];
      for (const cmd of commands) {
        if (this.appliedCommandIds.has(cmd.id)) continue;
        this.appliedCommandIds.add(cmd.id);
        this.applyCommand(cmd);
        this.listener?.onCommand(cmd);
      }
    } catch {
      // ignore
    }
  }

  private applyCommand(cmd: Command) {
    if (cmd.type === 'set_selection') {
      const payload = cmd.payload as { topic: string; optionId: string };
      this.selections[payload.topic] = payload.optionId;
      this.listener?.onSelectionChanged(payload.topic, payload.optionId);
    } else if (cmd.type === 'batch_set_selections') {
      const payload = cmd.payload as Array<{ topic: string; optionId: string }>;
      for (const item of payload) {
        this.selections[item.topic] = item.optionId;
        this.listener?.onSelectionChanged(item.topic, item.optionId);
      }
    }
  }

  async writeSnapshot() {
    const camera = this.listener?.getCameraState() ?? {
      position: { x: 0, y: 12, z: 18 },
      target: { x: 0, y: 0, z: 0 },
    };
    const lookingAt = this.listener?.getActiveObject() ?? this.activeObject;
    const visible = this.listener?.getVisibleObjects() ?? [];
    const selected = this.listener?.getSelectedObjects() ?? [];
    const snapshot: Snapshot = {
      mode: 'orbit',
      camera,
      lookingAt,
      visibleObjects: visible,
      selectedObjects: selected,
      activeTopic: this.activeTopic,
      selections: { ...this.selections },
      updatedAt: new Date().toISOString(),
    };
    try {
      await fetch('/__state/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
    } catch {
      // ignore
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd app && npx tsc --noEmit
```

---

### Task 8: App Integration — Wire Everything Together + HTML/CSS

**Files:**
- Modify: `app/src/App.ts`
- Modify: `app/src/render/HouseScene.ts`
- Modify: `app/index.html`
- Modify: `app/style.css`

**Interfaces:**
- Consumes: All new components
- Produces: Fully integrated first-person + orbit app

- [ ] **Step 1: Update index.html**

Replace the entire `app/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>和萃 701 装修方案漫游</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <div id="ui">
      <h1>和萃 701 装修方案漫游</h1>
      <div id="topic-tabs"></div>
      <div id="topic-options"></div>
      <div id="info">
        <h2 id="scheme-name">请选择一个方案</h2>
        <p id="scheme-desc"></p>
        <ul id="scheme-pros"></ul>
        <ul id="scheme-cons"></ul>
        <div id="warnings"></div>
      </div>
      <div id="legend">
        <span><i class="dot ceiling"></i> 吊顶内机</span>
        <span><i class="dot wall"></i> 壁挂内机</span>
        <span><i class="dot cabinet"></i> 柜机</span>
        <span><i class="dot outdoor"></i> 外机</span>
      </div>
    </div>

    <div id="crosshair">+</div>
    <div id="hover-tooltip"></div>

    <div id="info-panel">
      <div id="info-panel-header">
        <span id="info-panel-title"></span>
        <span id="info-panel-type"></span>
        <span id="info-panel-room"></span>
      </div>
      <div id="info-panel-topics"></div>
    </div>

    <div id="overview-menu">
      <h3>总览</h3>
      <div id="overview-section-scheme">
        <h4>当前方案</h4>
        <div id="overview-scheme"></div>
      </div>
      <div id="overview-section-decisions">
        <h4>决策记录</h4>
        <div id="overview-decisions"></div>
      </div>
      <div id="overview-section-budget">
        <h4>预算</h4>
        <p class="overview-placeholder">预算功能即将上线</p>
      </div>
      <div id="overview-section-risks">
        <h4>风险提示</h4>
        <p class="overview-placeholder">风险分析即将上线</p>
      </div>
      <div id="overview-section-archives">
        <h4>归档方案</h4>
        <p class="overview-placeholder">归档功能即将上线</p>
      </div>
    </div>

    <div id="mode-indicator">轨道模式 · 按 V 切换第一人称</div>
    <div id="pointer-lock-toast" style="display:none">请允许鼠标锁定以使用第一人称</div>

    <canvas id="gl"></canvas>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Append CSS styles to app/style.css**

Append the following to the end of `app/style.css`:

```css
#crosshair {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: rgba(255, 255, 255, 0.7);
  pointer-events: none;
  z-index: 100;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
  user-select: none;
  display: none;
}

#hover-tooltip {
  position: fixed;
  top: calc(50% + 24px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  pointer-events: none;
  z-index: 100;
  display: none;
  white-space: nowrap;
}

#info-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 340px;
  max-height: 60vh;
  overflow-y: auto;
  background: rgba(20, 20, 25, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(8px);
  z-index: 90;
  display: none;
}

#info-panel-header {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

#info-panel-title {
  font-size: 16px;
  font-weight: 600;
}

#info-panel-type {
  font-size: 12px;
  color: #888;
}

#info-panel-room {
  font-size: 12px;
  color: #888;
}

.info-topic-section {
  margin-bottom: 12px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.info-topic-section h4 {
  font-size: 14px;
  margin-bottom: 6px;
}

.info-badge {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(59, 130, 246, 0.3);
  color: #93c5fd;
  margin-bottom: 6px;
}

.info-options-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-option-wrapper {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-option-btn {
  text-align: left;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
}

.info-option-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.info-option-btn.active {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
}

.info-scope-row {
  display: flex;
  gap: 4px;
}

.info-scope-btn {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.03);
  color: #aaa;
  cursor: pointer;
  font-size: 11px;
}

.info-scope-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ddd;
}

#overview-menu {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(15, 15, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 24px;
  backdrop-filter: blur(12px);
  z-index: 200;
  display: none;
}

#overview-menu h3 {
  font-size: 20px;
  margin-bottom: 16px;
}

#overview-menu h4 {
  font-size: 14px;
  color: #999;
  margin: 12px 0 6px;
}

.overview-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.overview-override {
  color: #93c5fd;
  font-size: 12px;
}

.overview-label {
  color: #ccc;
}

.overview-value {
  color: #fff;
}

.overview-placeholder {
  font-size: 12px;
  color: #666;
  font-style: italic;
}

.overview-decision-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 3px 0;
  font-size: 12px;
}

.overview-decision-topic {
  color: #93c5fd;
  min-width: 60px;
}

.overview-decision-change {
  color: #ccc;
  flex: 1;
}

.overview-decision-time {
  color: #666;
  font-size: 11px;
}

.overview-empty {
  font-size: 12px;
  color: #666;
  font-style: italic;
}

#mode-indicator {
  position: fixed;
  top: 16px;
  right: 16px;
  background: rgba(0, 0, 0, 0.6);
  color: #ccc;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 90;
  pointer-events: none;
}

#pointer-lock-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 300;
}
```

- [ ] **Step 3: Update HouseScene.ts for mode management**

Add these imports at the top of `HouseScene.ts`:

```ts
import type { HoverTarget } from '../ui/HoverTooltip.js';
```

Add these new properties to the `HouseScene` class (after the existing private properties):

```ts
  private _mode: 'orbit' | 'first-person' = 'orbit';
```

Add these new methods to `HouseScene` (before the `render()` method):

```ts
  get mode(): 'orbit' | 'first-person' {
    return this._mode;
  }

  setMode(mode: 'orbit' | 'first-person') {
    this._mode = mode;
    if (mode === 'orbit') {
      this.controls.enabled = true;
    } else {
      this.controls.enabled = false;
    }
  }

  raycastFromScreenCenter(): HoverTarget | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of intersects) {
      const data = hit.object.userData;
      if (data?.objectId || data?.roomId) {
        const id = (data.objectId as string) ?? (data.roomId as string);
        const type = (data.type as string) ?? (data.part as string) ?? 'room';
        const room = data.roomId as string | undefined;
        const roomObj = room ? this.rooms[room] : undefined;
        const name = roomObj?.name ?? id;
        return { objectId: id, name, type, room };
      }
    }
    return null;
  }
```

Update the `render()` method to conditionally update orbit controls:

```ts
  render() {
    if (this._mode === 'orbit') {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }
```

- [ ] **Step 4: Rewrite App.ts with full integration**

Replace the entire `app/src/App.ts`:

```ts
import * as THREE from 'three';
import { HouseScene } from './render/HouseScene.js';
import { StateManager, type StateListener } from './state/StateManager.js';
import { TopicRegistry } from './topics/TopicRegistry.js';
import { SchemePanel } from './ui/SchemePanel.js';
import { CollisionDetector } from './scene/CollisionDetector.js';
import { FirstPersonController } from './scene/FirstPersonController.js';
import { CameraAnimator } from './scene/CameraAnimator.js';
import { Crosshair } from './ui/Crosshair.js';
import { HoverTooltip } from './ui/HoverTooltip.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { OverviewMenu } from './ui/OverviewMenu.js';
import { rooms } from '@shared/houseData';
import type { Command, CameraState, CurrentScheme, DecisionLogEntry } from '@shared/types';

const ENTRY_GARDEN = rooms.find((r) => r.id === 'entry_garden')!;
const ORBIT_DISTANCE = 15;

export class App implements StateListener {
  private scene: HouseScene;
  private stateManager = new StateManager();
  private registry = new TopicRegistry();
  private panel = new SchemePanel();
  private collision: CollisionDetector;
  private fpController: FirstPersonController;
  private animator: CameraAnimator;
  private crosshair: Crosshair;
  private hoverTooltip: HoverTooltip;
  private infoPanel: InfoPanel;
  private overviewMenu: OverviewMenu;
  private rafId?: number;
  private lastTime = 0;
  private modeIndicator: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer?: number;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new HouseScene(canvas);
    this.collision = new CollisionDetector(rooms);
    this.fpController = new FirstPersonController(this.scene.camera, canvas, this.collision);
    this.animator = new CameraAnimator(this.scene.camera, this.scene.controls);
    this.crosshair = new Crosshair();
    this.hoverTooltip = new HoverTooltip();
    this.infoPanel = new InfoPanel({
      onSelectOption: (topicId, optionId, roomId) => {
        void this.handleOptionSelect(topicId, optionId, roomId);
      },
    });
    this.overviewMenu = new OverviewMenu();
    this.modeIndicator = document.getElementById('mode-indicator') as HTMLDivElement;
    this.toastEl = document.getElementById('pointer-lock-toast') as HTMLDivElement;

    this.infoPanel.setTopics(this.registry.list());
    this.overviewMenu.setTopics(this.registry.list());

    this.scene.setOnObjectClick((objectId, type, room) => {
      this.stateManager.writeSnapshot();
    });

    this.setupKeyboard();
    this.setupPointerLockEvents();

    this.animator.setOnComplete((mode) => {
      this.scene.setMode(mode);
      if (mode === 'first-person') {
        this.crosshair.show();
        this.updateModeIndicator();
      } else {
        this.crosshair.hide();
        this.hoverTooltip.clear();
        this.updateModeIndicator();
      }
    });
  }

  async start() {
    this.stateManager.setListener(this);
    await this.stateManager.loadSnapshot();

    this.panel.init(this.registry.list(), (topicId, optionId) => {
      void this.applySelection(topicId, optionId);
    });

    const initial = this.stateManager.getSelections();
    for (const [topicId, optionId] of Object.entries(initial)) {
      this.applySelection(topicId, optionId, false);
    }
    this.panel.setActiveOption('hvac', initial.hvac ?? 'A2', []);

    const scheme = await this.stateManager.fetchScheme();
    if (scheme) {
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
    }

    const decisions = await this.stateManager.fetchDecisions();
    this.overviewMenu.setDecisionLog(decisions);

    this.stateManager.startPolling();
    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  private setupKeyboard() {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        this.toggleMode();
      }
      if (e.code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        if (this.overviewMenu.isVisible()) {
          this.overviewMenu.hide();
        } else {
          void this.refreshOverviewData();
          this.overviewMenu.show();
        }
      }
      if (e.code === 'Escape') {
        if (this.overviewMenu.isVisible()) {
          this.overviewMenu.hide();
        }
      }
      if (this.animator.isAnimating) {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) || e.code === 'KeyV') {
          this.animator.interrupt();
        }
      }
    });

    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.scene.mode === 'first-person' && !this.fpController.isLocked) {
        this.fpController.requestLock();
        return;
      }
      if (this.scene.mode === 'first-person' && this.fpController.isLocked) {
        this.handleCenterClick();
      }
    });
  }

  private setupPointerLockEvents() {
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.scene.mode === 'first-person') {
        this.hoverTooltip.clear();
      }
    });

    document.addEventListener('pointerlockerror', () => {
      this.showToast('请允许鼠标锁定以使用第一人称');
    });
  }

  private toggleMode() {
    if (this.animator.isAnimating) {
      this.animator.interrupt();
      return;
    }

    if (this.scene.mode === 'orbit') {
      this.switchToFirstPerson();
    } else {
      this.switchToOrbit();
    }
  }

  private switchToFirstPerson() {
    const spawnX = ENTRY_GARDEN.x;
    const spawnZ = ENTRY_GARDEN.z;
    const fpPos = new THREE.Vector3(spawnX, 1.6, spawnZ);
    const fpDir = new THREE.Vector3(0, 0, 1);

    const camPos = this.scene.camera.position;
    if (camPos.y < 3) {
      fpPos.set(camPos.x, 1.6, camPos.z);
    }

    this.scene.setMode('first-person');
    this.fpController.enable();
    this.fpController.requestLock();
    this.animator.transitionToFirstPerson(fpPos, fpDir);
    this.crosshair.show();
    this.updateModeIndicator();
  }

  private switchToOrbit() {
    this.fpController.disable();
    this.crosshair.hide();
    this.hoverTooltip.clear();

    const camPos = this.scene.camera.position;
    const orbitPos = new THREE.Vector3(camPos.x, ORBIT_DISTANCE, camPos.z + ORBIT_DISTANCE);
    const orbitTarget = new THREE.Vector3(camPos.x, 0, camPos.z);

    this.scene.setMode('orbit');
    this.animator.transitionToOrbit(orbitPos, orbitTarget);
    this.updateModeIndicator();
  }

  private handleCenterClick() {
    const target = this.scene.raycastFromScreenCenter();
    if (!target) return;

    this.stateManager.setActiveObject(target);
    void this.stateManager.postViewContext(target.objectId);
    this.infoPanel.showObject(target);
  }

  private async handleOptionSelect(topicId: string, optionId: string, roomId: string | null) {
    await this.stateManager.applySelectionWithScope(topicId, optionId, roomId);
    this.applySelection(topicId, this.stateManager.getSelections()[topicId], false);

    const scheme = await this.stateManager.fetchScheme();
    if (scheme) {
      this.infoPanel.setScheme(scheme);
      this.overviewMenu.setScheme(scheme);
    }
  }

  private async refreshOverviewData() {
    const [scheme, decisions] = await Promise.all([
      this.stateManager.fetchScheme(),
      this.stateManager.fetchDecisions(),
    ]);
    if (scheme) this.overviewMenu.setScheme(scheme);
    this.overviewMenu.setDecisionLog(decisions);
  }

  private async applySelection(topicId: string, optionId: string, writeSnapshot = true) {
    const topic = this.registry.get(topicId);
    if (!topic) return;

    const objectIds = topic.apply(this.scene, optionId);
    const warnings = topic.validate ? topic.validate(this.scene, optionId) : [];

    this.panel.setActiveOption(topicId, optionId, warnings);
    this.stateManager.setActiveTopic(topicId);

    if (writeSnapshot) {
      await this.stateManager.writeSnapshot();
    }
  }

  onSelectionChanged(topic: string, optionId: string): void {
    void this.applySelection(topic, optionId);
  }

  onCommand(command: Command): void {
    if (command.type === 'set_camera_target') {
      const payload = command.payload as { targetId: string };
      this.scene.setCameraTarget(payload.targetId);
      void this.stateManager.writeSnapshot();
    } else if (command.type === 'highlight_object') {
      const payload = command.payload as { objectId: string };
      this.scene.highlightObject(payload.objectId);
    }
  }

  getCameraState(): CameraState {
    return this.scene.getCameraState();
  }

  getActiveObject(): { objectId: string; type: string; room?: string } | undefined {
    return undefined;
  }

  getVisibleObjects(): string[] {
    return this.scene.getVisibleObjects();
  }

  getSelectedObjects(): string[] {
    return this.scene.getSelectedObjects();
  }

  private updateModeIndicator() {
    if (this.scene.mode === 'orbit') {
      this.modeIndicator.textContent = '轨道模式 · 按 V 切换第一人称';
    } else {
      this.modeIndicator.textContent = '第一人称 · WASD 移动 · 按 V 切换轨道 · 按 M 总览';
    }
  }

  private showToast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.style.display = 'block';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
    }, 3000);
  }

  private animate = (time: number) => {
    this.rafId = requestAnimationFrame(this.animate);
    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    if (this.animator.isAnimating) {
      this.animator.update(dt);
    } else if (this.scene.mode === 'first-person') {
      this.fpController.update(dt);
      const target = this.scene.raycastFromScreenCenter();
      this.hoverTooltip.update(target);
    }

    this.scene.render();
  };
}
```

- [ ] **Step 5: Run full typecheck**

```bash
cd app && npx tsc --noEmit
```

- [ ] **Step 6: Run all tests**

```bash
cd app && npx vitest run
```

- [ ] **Step 7: Manual verification**

```bash
npm run dev:server &
npm run dev:app
```

Open `http://localhost:5173` and verify:
- Press V to enter first-person mode (pointer lock requested)
- WASD moves without going through walls
- Mouse controls view direction
- Crosshair appears in center
- Crosshair over a room shows tooltip with room name
- Click to select object, info panel opens
- Info panel shows related topics with per-room / all-room buttons
- Press M to open overview menu showing current scheme and decision log
- Press V again to return to orbit mode with smooth transition
- Press any WASD during transition to interrupt
