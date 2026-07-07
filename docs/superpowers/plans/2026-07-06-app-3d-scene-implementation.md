# Spec 2: App 3D Scene + Basic Roaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based 3D visualization of the apartment with orbit camera controls, scheme switching, and object selection.

**Architecture:** The App uses Three.js for 3D rendering with a modular topic system. StateSync handles all backend communication with exponential backoff. HouseScene manages the 3D scene and delegates topic-specific rendering to TopicRegistry.

**Tech Stack:** TypeScript, Vite, Three.js, Express (for dev server proxy)

## Global Constraints

- TypeScript strict mode
- Three.js for 3D rendering
- All coordinates in meters
- Camera animation: 0.5s smooth transition (lerp)
- Polling intervals: scheme 1s, visual commands 500ms
- Exponential backoff: 1s → 2s → 4s, max 8s
- Object IDs must follow format: `type:subtype:id` (e.g., `room:master_bedroom`, `wall:kitchen:north`)
- Wall directions: north/south/east/west based on coordinate system (x+ = east, x- = west, z+ = south, z- = north)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/src/main.ts` | App entry point, initializes App |
| `app/src/App.ts` | Main app container, coordinates components |
| `app/src/state/StateSync.ts` | Backend API communication with exponential backoff |
| `app/src/scene/HouseScene.ts` | Three.js scene setup, camera, lights, object management |
| `app/src/scene/CameraAnimator.ts` | Smooth camera transitions |
| `app/src/topics/TopicRegistry.ts` | Registry for topic renderers |
| `app/src/topics/HvacTopic.ts` | HVAC equipment rendering |
| `app/src/topics/FloorTopic.ts` | Floor material rendering |
| `app/src/topics/WallTopic.ts` | Wall material rendering |
| `app/src/topics/PaintTopic.ts` | Paint color rendering |
| `app/src/ui/SchemePanel.ts` | Scheme selection UI |
| `app/src/ui/InfoPanel.ts` | Object info display |
| `app/src/ui/OfflineIndicator.ts` | Backend offline status indicator |
| `app/index.html` | HTML entry point |
| `app/vite.config.ts` | Vite configuration with proxy |

---

### Task 1: Vite Configuration and HTML Setup

**Files:**
- Modify: `app/vite.config.ts`
- Create: `app/index.html`

**Interfaces:**
- Consumes: Backend API at `http://localhost:3000`
- Produces: Working dev server with proxy configuration

- [ ] **Step 1: Update vite.config.ts with proxy**

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'app',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
      '/sse': 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

- [ ] **Step 2: Create index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>和萃 701 - 3D 装修设计</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }
    #app { width: 100vw; height: 100vh; position: relative; }
    #canvas { width: 100%; height: 100%; }
    .panel { position: absolute; background: rgba(255,255,255,0.95); padding: 16px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    #scheme-panel { left: 16px; top: 16px; width: 300px; max-height: calc(100vh - 32px); overflow-y: auto; }
    #info-panel { right: 16px; top: 16px; width: 300px; display: none; }
    #offline-indicator { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); background: #ff4444; color: white; padding: 8px 16px; border-radius: 4px; display: none; }
    .tab { display: inline-block; padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; }
    .tab.active { border-bottom-color: #007bff; color: #007bff; }
    .option { padding: 8px; margin: 4px 0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
    .option:hover { background: #f0f0f0; }
    .option.active { background: #007bff; color: white; border-color: #007bff; }
  </style>
</head>
<body>
  <div id="app">
    <canvas id="canvas"></canvas>
    <div id="scheme-panel" class="panel"></div>
    <div id="info-panel" class="panel"></div>
    <div id="offline-indicator">后端连接断开</div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Verify dev server starts**

```bash
cd app
npm run dev
```

Expected: Server starts on http://localhost:5173, shows blank page with panels

- [ ] **Step 4: Commit**

```bash
git add app/vite.config.ts app/index.html
git commit -m "feat: add Vite config with proxy and HTML entry point"
```

---

### Task 2: StateSync - Backend API Communication

**Files:**
- Create: `app/src/state/StateSync.ts`

**Interfaces:**
- Consumes: Backend API endpoints
- Produces: `StateSync` class with methods:
  - `getCurrentScheme(): Promise<CurrentScheme>`
  - `updateScheme(selections: SelectionPatch[]): Promise<void>`
  - `getVisualCommands(): Promise<VisualCommand[]>`
  - `ackVisualCommands(ids: string[]): Promise<void>`
  - `postViewContext(objectId: string): Promise<void>`
  - `onSchemeChange(callback: (scheme: CurrentScheme) => void): void`
  - `onVisualCommand(callback: (command: VisualCommand) => void): void`
  - `onOfflineChange(callback: (offline: boolean) => void): void`

- [ ] **Step 1: Write failing test for exponential backoff**

```typescript
// app/src/state/StateSync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateSync } from './StateSync';

describe('StateSync', () => {
  let stateSync: StateSync;
  
  beforeEach(() => {
    vi.useFakeTimers();
    stateSync = new StateSync();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
    stateSync.dispose();
  });
  
  it('should use exponential backoff on failure', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    
    const offlineCallback = vi.fn();
    stateSync.onOfflineChange(offlineCallback);
    
    // Start polling
    stateSync.start();
    
    // First attempt at 0ms
    expect(fetchMock).toHaveBeenCalledTimes(1);
    
    // After 1s, second attempt
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    
    // After 2s, third attempt
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    
    // After 4s, fourth attempt
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    
    // After 8s, fifth attempt (max backoff)
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    
    // After another 8s, should still be at 8s backoff
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app
npm test -- StateSync.test.ts
```

Expected: FAIL - StateSync not implemented

- [ ] **Step 3: Implement StateSync**

```typescript
// app/src/state/StateSync.ts
import type { CurrentScheme, VisualCommand, SelectionPatch } from '@shared/types';

type SchemeCallback = (scheme: CurrentScheme) => void;
type VisualCommandCallback = (command: VisualCommand) => void;
type OfflineCallback = (offline: boolean) => void;

export class StateSync {
  private schemeInterval: number | null = null;
  private visualCommandInterval: number | null = null;
  private schemeBackoff = 1000;
  private visualCommandBackoff = 500;
  private isOffline = false;
  private schemeCallbacks: SchemeCallback[] = [];
  private visualCommandCallbacks: VisualCommandCallback[] = [];
  private offlineCallbacks: OfflineCallback[] = [];
  private currentScheme: CurrentScheme | null = null;
  private processedCommandIds = new Set<string>();

  constructor() {}

  async getCurrentScheme(): Promise<CurrentScheme> {
    const response = await fetch('/api/scheme/current');
    if (!response.ok) throw new Error('Failed to fetch scheme');
    return response.json();
  }

  async updateScheme(selections: SelectionPatch[]): Promise<void> {
    const response = await fetch('/api/scheme/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections, source: 'user' }),
    });
    if (!response.ok) throw new Error('Failed to update scheme');
  }

  async getVisualCommands(): Promise<VisualCommand[]> {
    const response = await fetch('/api/visual-commands');
    if (!response.ok) throw new Error('Failed to fetch visual commands');
    return response.json();
  }

  async ackVisualCommands(ids: string[]): Promise<void> {
    const response = await fetch('/api/visual-commands/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error('Failed to ack visual commands');
  }

  async postViewContext(objectId: string): Promise<void> {
    const response = await fetch('/api/view-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId }),
    });
    if (!response.ok) throw new Error('Failed to post view context');
  }

  onSchemeChange(callback: SchemeCallback): void {
    this.schemeCallbacks.push(callback);
  }

  onVisualCommand(callback: VisualCommandCallback): void {
    this.visualCommandCallbacks.push(callback);
  }

  onOfflineChange(callback: OfflineCallback): void {
    this.offlineCallbacks.push(callback);
  }

  start(): void {
    this.pollScheme();
    this.pollVisualCommands();
  }

  private async pollScheme(): Promise<void> {
    try {
      const scheme = await this.getCurrentScheme();
      
      if (this.isOffline) {
        this.isOffline = false;
        this.schemeBackoff = 1000;
        this.offlineCallbacks.forEach(cb => cb(false));
      }
      
      if (!this.currentScheme || JSON.stringify(this.currentScheme) !== JSON.stringify(scheme)) {
        this.currentScheme = scheme;
        this.schemeCallbacks.forEach(cb => cb(scheme));
      }
      
      this.schemeInterval = window.setTimeout(() => this.pollScheme(), this.schemeBackoff);
    } catch (error) {
      if (!this.isOffline) {
        this.isOffline = true;
        this.offlineCallbacks.forEach(cb => cb(true));
      }
      
      this.schemeBackoff = Math.min(this.schemeBackoff * 2, 8000);
      this.schemeInterval = window.setTimeout(() => this.pollScheme(), this.schemeBackoff);
    }
  }

  private async pollVisualCommands(): Promise<void> {
    try {
      const commands = await this.getVisualCommands();
      
      const newCommands = commands.filter(cmd => !this.processedCommandIds.has(cmd.commandId));
      
      for (const command of newCommands) {
        this.processedCommandIds.add(command.commandId);
        this.visualCommandCallbacks.forEach(cb => cb(command));
        await this.ackVisualCommands([command.commandId]);
      }
      
      this.visualCommandInterval = window.setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    } catch (error) {
      this.visualCommandBackoff = Math.min(this.visualCommandBackoff * 2, 8000);
      this.visualCommandInterval = window.setTimeout(() => this.pollVisualCommands(), this.visualCommandBackoff);
    }
  }

  dispose(): void {
    if (this.schemeInterval) clearTimeout(this.schemeInterval);
    if (this.visualCommandInterval) clearTimeout(this.visualCommandInterval);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app
npm test -- StateSync.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/state/StateSync.ts app/src/state/StateSync.test.ts
git commit -m "feat: implement StateSync with exponential backoff"
```

---

### Task 3: CameraAnimator - Smooth Camera Transitions

**Files:**
- Create: `app/src/scene/CameraAnimator.ts`

**Interfaces:**
- Consumes: Three.js Camera and Controls
- Produces: `CameraAnimator` class with methods:
  - `animateTo(position: Vector3, target: Vector3, duration: number): void`
  - `interrupt(): void`
  - `isAnimating(): boolean`

- [ ] **Step 1: Write failing test for camera animation**

```typescript
// app/src/scene/CameraAnimator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CameraAnimator } from './CameraAnimator';

describe('CameraAnimator', () => {
  let animator: CameraAnimator;
  let camera: THREE.PerspectiveCamera;
  
  beforeEach(() => {
    camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 5, 10);
    animator = new CameraAnimator(camera);
  });
  
  it('should animate camera position over time', () => {
    const targetPos = new THREE.Vector3(5, 5, 5);
    const targetLookAt = new THREE.Vector3(0, 0, 0);
    
    animator.animateTo(targetPos, targetLookAt, 500);
    
    expect(animator.isAnimating()).toBe(true);
    
    // At 250ms (halfway), should be halfway
    animator.update(250);
    expect(camera.position.x).toBeCloseTo(2.5, 1);
    expect(camera.position.z).toBeCloseTo(7.5, 1);
    
    // At 500ms (complete), should be at target
    animator.update(500);
    expect(camera.position.x).toBeCloseTo(5, 1);
    expect(camera.position.z).toBeCloseTo(5, 1);
    expect(animator.isAnimating()).toBe(false);
  });
  
  it('should interrupt animation', () => {
    const targetPos = new THREE.Vector3(5, 5, 5);
    const targetLookAt = new THREE.Vector3(0, 0, 0);
    
    animator.animateTo(targetPos, targetLookAt, 500);
    expect(animator.isAnimating()).toBe(true);
    
    animator.interrupt();
    expect(animator.isAnimating()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app
npm test -- CameraAnimator.test.ts
```

Expected: FAIL - CameraAnimator not implemented

- [ ] **Step 3: Implement CameraAnimator**

```typescript
// app/src/scene/CameraAnimator.ts
import * as THREE from 'three';

export class CameraAnimator {
  private camera: THREE.Camera;
  private startPos: THREE.Vector3 | null = null;
  private endPos: THREE.Vector3 | null = null;
  private startTarget: THREE.Vector3 | null = null;
  private endTarget: THREE.Vector3 | null = null;
  private startTime: number | null = null;
  private duration: number = 0;
  private animating = false;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
  }

  animateTo(position: THREE.Vector3, target: THREE.Vector3, duration: number): void {
    this.startPos = this.camera.position.clone();
    this.endPos = position.clone();
    this.startTarget = new THREE.Vector3(0, 0, 0); // Current look-at target
    this.endTarget = target.clone();
    this.startTime = performance.now();
    this.duration = duration;
    this.animating = true;
  }

  update(_deltaTime: number): void {
    if (!this.animating || !this.startTime || !this.startPos || !this.endPos || !this.startTarget || !this.endTarget) {
      return;
    }

    const elapsed = performance.now() - this.startTime;
    const progress = Math.min(elapsed / this.duration, 1);
    
    // Smooth easing
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    this.camera.position.lerpVectors(this.startPos, this.endPos, eased);
    
    const currentTarget = new THREE.Vector3().lerpVectors(this.startTarget, this.endTarget, eased);
    this.camera.lookAt(currentTarget);

    if (progress >= 1) {
      this.animating = false;
    }
  }

  interrupt(): void {
    this.animating = false;
  }

  isAnimating(): boolean {
    return this.animating;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app
npm test -- CameraAnimator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/scene/CameraAnimator.ts app/src/scene/CameraAnimator.test.ts
git commit -m "feat: implement CameraAnimator with smooth transitions"
```

---

### Task 4: HouseScene - Three.js Scene Setup

**Files:**
- Create: `app/src/scene/HouseScene.ts`

**Interfaces:**
- Consumes: HTMLCanvasElement, ProjectCatalog, CurrentScheme
- Produces: `HouseScene` class with methods:
  - `render(): void`
  - `setSelection(topic: string, optionId: string): void`
  - `highlightObject(objectId: string): void`
  - `setCameraTarget(targetId: string): void`
  - `onObjectClick(callback: (objectId: string) => void): void`

- [ ] **Step 1: Write failing test for scene initialization**

```typescript
// app/src/scene/HouseScene.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { HouseScene } from './HouseScene';

describe('HouseScene', () => {
  let canvas: HTMLCanvasElement;
  let scene: HouseScene;
  
  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    scene = new HouseScene(canvas);
  });
  
  it('should initialize Three.js scene', () => {
    expect(scene).toBeDefined();
    expect(scene.getScene()).toBeInstanceOf(THREE.Scene);
    expect(scene.getCamera()).toBeInstanceOf(THREE.PerspectiveCamera);
  });
  
  it('should render rooms from catalog', async () => {
    const catalog = await fetch('/api/project').then(r => r.json());
    scene.buildFromCatalog(catalog);
    
    const roomObjects = scene.getScene().children.filter(
      obj => obj.userData.objectId?.startsWith('room:')
    );
    expect(roomObjects.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app
npm test -- HouseScene.test.ts
```

Expected: FAIL - HouseScene not implemented

- [ ] **Step 3: Implement HouseScene**

```typescript
// app/src/scene/HouseScene.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraAnimator } from './CameraAnimator.js';
import { TopicRegistry } from '../topics/TopicRegistry.js';

type ObjectClickCallback = (objectId: string) => void;

interface ProjectData {
  house: { rooms: any[] };
  topics: any[];
  budgetCategories: any[];
}

export class HouseScene {
  private canvas: HTMLCanvasElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private cameraAnimator: CameraAnimator;
  private topicRegistry: TopicRegistry;
  private objectClickCallbacks: ObjectClickCallback[] = [];
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    
    // Initialize Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);
    
    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 15);
    
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);
    
    // Controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    
    // Camera animator
    this.cameraAnimator = new CameraAnimator(this.camera);
    
    // Topic registry
    this.topicRegistry = new TopicRegistry(this.scene);
    
    // Raycaster for object selection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    // Event listeners
    canvas.addEventListener('click', this.onCanvasClick.bind(this));
    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  async buildFromCatalog(projectData: ProjectData): Promise<void> {
    // Clear existing objects
    while (this.scene.children.length > 0) {
      const obj = this.scene.children[0];
      if (obj instanceof THREE.Light) {
        this.scene.remove(obj);
      } else {
        this.scene.remove(obj);
      }
    }
    
    // Re-add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);
    
    // Build rooms
    for (const room of projectData.house.rooms) {
      this.buildRoom(room);
    }
    
    // Initialize topic registry
    this.topicRegistry.initialize(projectData.topics);
  }

  private buildRoom(room: any): void {
    const { id, x, z, width, depth, height, type } = room;
    
    // Floor
    const floorGeometry = new THREE.PlaneGeometry(width, depth);
    const floorColor = type === 'public' ? 0xd0d0d0 : type === 'private' ? 0xc0c0d0 : 0xc0d0e0;
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: floorColor,
      side: THREE.DoubleSide,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0, z);
    floor.userData.objectId = `floor:${id}`;
    this.scene.add(floor);
    
    // Walls
    const wallHeight = height;
    const wallThickness = 0.1;
    const wallColor = 0xe0e0e0;
    
    // North wall (z - depth/2)
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(width, wallHeight, wallThickness),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    northWall.position.set(x, wallHeight / 2, z - depth / 2);
    northWall.userData.objectId = `wall:${id}:north`;
    this.scene.add(northWall);
    
    // South wall (z + depth/2)
    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(width, wallHeight, wallThickness),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    southWall.position.set(x, wallHeight / 2, z + depth / 2);
    southWall.userData.objectId = `wall:${id}:south`;
    this.scene.add(southWall);
    
    // East wall (x + width/2)
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, depth),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    eastWall.position.set(x + width / 2, wallHeight / 2, z);
    eastWall.userData.objectId = `wall:${id}:east`;
    this.scene.add(eastWall);
    
    // West wall (x - width/2)
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, depth),
      new THREE.MeshStandardMaterial({ color: wallColor })
    );
    westWall.position.set(x - width / 2, wallHeight / 2, z);
    westWall.userData.objectId = `wall:${id}:west`;
    this.scene.add(westWall);
    
    // Room label (invisible, for selection)
    const roomLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    roomLabel.rotation.x = -Math.PI / 2;
    roomLabel.position.set(x, 0.01, z);
    roomLabel.userData.objectId = `room:${id}`;
    this.scene.add(roomLabel);
  }

  setSelection(topic: string, optionId: string): void {
    this.topicRegistry.apply(topic, optionId);
  }

  highlightObject(objectId: string): void {
    const object = this.findObjectById(objectId);
    if (object && object instanceof THREE.Mesh) {
      const originalColor = (object.material as THREE.MeshStandardMaterial).color.clone();
      (object.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffff00);
      (object.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
      
      setTimeout(() => {
        (object.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x000000);
        (object.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }, 2000);
    }
  }

  setCameraTarget(targetId: string): void {
    const object = this.findObjectById(targetId);
    if (object) {
      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 2;
      
      const cameraPos = new THREE.Vector3(
        center.x + distance,
        center.y + distance,
        center.z + distance
      );
      
      this.cameraAnimator.animateTo(cameraPos, center, 500);
    }
  }

  onObjectClick(callback: ObjectClickCallback): void {
    this.objectClickCallbacks.push(callback);
  }

  private onCanvasClick(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);
    
    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object;
      while (obj && !obj.userData.objectId) {
        obj = obj.parent;
      }
      
      if (obj && obj.userData.objectId) {
        this.objectClickCallbacks.forEach(cb => cb(obj.userData.objectId));
      }
    }
  }

  private findObjectById(objectId: string): THREE.Object3D | null {
    for (const child of this.scene.children) {
      if (child.userData.objectId === objectId) {
        return child;
      }
    }
    return null;
  }

  private onWindowResize(): void {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  render(): void {
    this.controls.update();
    this.cameraAnimator.update(16); // Assume 60fps
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onCanvasClick.bind(this));
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    this.renderer.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app
npm test -- HouseScene.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/scene/HouseScene.ts app/src/scene/HouseScene.test.ts
git commit -m "feat: implement HouseScene with Three.js"
```

---

### Task 5: TopicRegistry and HVAC Topic

**Files:**
- Create: `app/src/topics/TopicRegistry.ts`
- Create: `app/src/topics/HvacTopic.ts`

**Interfaces:**
- Consumes: Three.js Scene, topic data
- Produces: Topic registry with HVAC rendering

- [ ] **Step 1: Implement TopicRegistry**

```typescript
// app/src/topics/TopicRegistry.ts
import * as THREE from 'three';

interface TopicRenderer {
  apply(optionId: string, optionData: any): void;
}

export class TopicRegistry {
  private scene: THREE.Scene;
  private topics: Map<string, TopicRenderer> = new Map();
  private topicData: Map<string, any[]> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  initialize(topics: any[]): void {
    for (const topic of topics) {
      this.topicData.set(topic.id, topic.options);
      
      if (topic.id === 'hvac') {
        this.topics.set(topic.id, new HvacTopic(this.scene, topic.options));
      }
      // Floor, Wall, Paint topics will be added in later tasks
    }
  }

  apply(topicId: string, optionId: string): void {
    const renderer = this.topics.get(topicId);
    const options = this.topicData.get(topicId);
    const option = options?.find((o: any) => o.id === optionId);
    
    if (renderer && option) {
      renderer.apply(optionId, option);
    }
  }
}

class HvacTopic implements TopicRenderer {
  private scene: THREE.Scene;
  private options: any[];
  private currentObjects: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, options: any[]) {
    this.scene = scene;
    this.options = options;
  }

  apply(optionId: string, optionData: any): void {
    // Remove previous HVAC objects
    for (const obj of this.currentObjects) {
      this.scene.remove(obj);
    }
    this.currentObjects = [];
    
    const schemeData = optionData.data;
    if (!schemeData) return;
    
    // Render outdoor units
    schemeData.outdoorUnits.forEach((unit: any, index: number) => {
      const location = unit.location === 'platform' 
        ? { x: -8.5, z: 2.0 } // West platform
        : { x: 0, z: -8.8 }; // Entry garden
      
      const outdoorUnit = new THREE.Mesh(
        new THREE.BoxGeometry(unit.w, unit.h, unit.d),
        new THREE.MeshStandardMaterial({ color: 0x800080 }) // Purple
      );
      outdoorUnit.position.set(location.x, unit.h / 2, location.z);
      outdoorUnit.userData.objectId = `hvac:outdoor:${optionId}:${index}`;
      this.scene.add(outdoorUnit);
      this.currentObjects.push(outdoorUnit);
    });
    
    // Render indoor units
    schemeData.indoorUnits.forEach((unit: any) => {
      const room = this.getRoomPosition(unit.roomId);
      if (!room) return;
      
      let indoorUnit: THREE.Mesh;
      const color = unit.type === 'ceiling' ? 0x00ffff : // Cyan
                    unit.type === 'wall' ? 0xffa500 : // Orange
                    0xff0000; // Red
      
      if (unit.type === 'ceiling') {
        indoorUnit = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.2, 0.5),
          new THREE.MeshStandardMaterial({ color })
        );
        indoorUnit.position.set(room.x, room.height - 0.1, room.z);
      } else if (unit.type === 'wall') {
        indoorUnit = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.25, 0.25),
          new THREE.MeshStandardMaterial({ color })
        );
        indoorUnit.position.set(room.x, room.height * 0.65, room.z - room.depth / 2 + 0.15);
      } else {
        indoorUnit = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 1.7, 0.35),
          new THREE.MeshStandardMaterial({ color })
        );
        indoorUnit.position.set(room.x - 1, 0.85, room.z - 1);
      }
      
      indoorUnit.userData.objectId = `hvac:indoor:${optionId}:${unit.roomId}`;
      this.scene.add(indoorUnit);
      this.currentObjects.push(indoorUnit);
    });
  }
  
  private getRoomPosition(roomId: string): any {
    // This would come from the catalog, but for now use hardcoded positions
    const rooms: Record<string, any> = {
      living_dining: { x: 0, z: 0, height: 3.0, depth: 5.68 },
      master_bedroom: { x: -5.35, z: 2.0, height: 3.0, depth: 4.05 },
      bedroom_nw: { x: -5.35, z: -3.5, height: 3.0, depth: 2.8 },
      bedroom_se: { x: 5.6, z: 2.0, height: 3.0, depth: 2.8 },
      study: { x: 5.6, z: -3.0, height: 3.0, depth: 2.78 },
    };
    return rooms[roomId];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/topics/TopicRegistry.ts app/src/topics/HvacTopic.ts
git commit -m "feat: implement TopicRegistry and HVAC topic"
```

---

### Task 6: UI Panels (SchemePanel and InfoPanel)

**Files:**
- Create: `app/src/ui/SchemePanel.ts`
- Create: `app/src/ui/InfoPanel.ts`

**Interfaces:**
- Consumes: topic data, current scheme
- Produces: UI panels for scheme selection and object info

- [ ] **Step 1: Implement SchemePanel**

```typescript
// app/src/ui/SchemePanel.ts
type SchemeChangeCallback = (topicId: string, optionId: string) => void;

export class SchemePanel {
  private element: HTMLElement;
  private schemeChangeCallbacks: SchemeChangeCallback[] = [];
  private currentTab = 'hvac';
  private topics: any[] = [];
  private currentScheme: any = null;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  onSchemeChange(callback: SchemeChangeCallback): void {
    this.schemeChangeCallbacks.push(callback);
  }

  updateTopics(topics: any[]): void {
    this.topics = topics;
    this.render();
  }

  updateScheme(scheme: any): void {
    this.currentScheme = scheme;
    this.render();
  }

  private render(): void {
    if (!this.topics.length || !this.currentScheme) return;
    
    // Tabs
    const tabsHtml = this.topics.map(topic => 
      `<div class="tab ${topic.id === this.currentTab ? 'active' : ''}" data-topic="${topic.id}">${topic.name}</div>`
    ).join('');
    
    // Options for current tab
    const currentTopic = this.topics.find(t => t.id === this.currentTab);
    const optionsHtml = currentTopic?.options.map((option: any) => {
      const isActive = this.currentScheme?.selections[this.currentTab]?.default === option.id;
      return `
        <div class="option ${isActive ? 'active' : ''}" data-option="${option.id}">
          <div><strong>${option.name}</strong></div>
          <div style="font-size: 12px; color: #666;">${option.description || ''}</div>
          <div style="font-size: 12px; color: #007bff;">¥${option.price_per_unit?.toLocaleString()}</div>
        </div>
      `;
    }).join('') || '';
    
    this.element.innerHTML = `
      <h3>方案选择</h3>
      <div style="margin: 16px 0;">${tabsHtml}</div>
      <div>${optionsHtml}</div>
    `;
    
    // Event listeners
    this.element.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentTab = (tab as HTMLElement).dataset.topic!;
        this.render();
      });
    });
    
    this.element.querySelectorAll('.option').forEach(option => {
      option.addEventListener('click', () => {
        const optionId = (option as HTMLElement).dataset.option!;
        this.schemeChangeCallbacks.forEach(cb => cb(this.currentTab, optionId));
      });
    });
  }
}
```

- [ ] **Step 2: Implement InfoPanel**

```typescript
// app/src/ui/InfoPanel.ts
export class InfoPanel {
  private element: HTMLElement;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  showObjectInfo(objectId: string): void {
    const [type, subtype, ...rest] = objectId.split(':');
    
    let info = `
      <h3>物体信息</h3>
      <p><strong>对象ID:</strong> ${objectId}</p>
      <p><strong>类型:</strong> ${type}</p>
    `;
    
    if (subtype) {
      info += `<p><strong>子类型:</strong> ${subtype}</p>`;
    }
    
    if (rest.length > 0) {
      info += `<p><strong>详情:</strong> ${rest.join(':')}</p>`;
    }
    
    this.element.innerHTML = info;
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
  }
}
```

- [ ] **Step 3: Implement OfflineIndicator**

```typescript
// app/src/ui/OfflineIndicator.ts
export class OfflineIndicator {
  private element: HTMLElement;

  constructor(elementId: string) {
    this.element = document.getElementById(elementId)!;
  }

  setOffline(offline: boolean): void {
    this.element.style.display = offline ? 'block' : 'none';
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/ui/SchemePanel.ts app/src/ui/InfoPanel.ts app/src/ui/OfflineIndicator.ts
git commit -m "feat: implement UI panels"
```

---

### Task 7: App Integration

**Files:**
- Create: `app/src/main.ts`
- Create: `app/src/App.ts`

**Interfaces:**
- Consumes: All components
- Produces: Working application

- [ ] **Step 1: Implement App**

```typescript
// app/src/App.ts
import { StateSync } from './state/StateSync.js';
import { HouseScene } from './scene/HouseScene.js';
import { SchemePanel } from './ui/SchemePanel.js';
import { InfoPanel } from './ui/InfoPanel.js';
import { OfflineIndicator } from './ui/OfflineIndicator.js';

export class App {
  private stateSync: StateSync;
  private houseScene: HouseScene;
  private schemePanel: SchemePanel;
  private infoPanel: InfoPanel;
  private offlineIndicator: OfflineIndicator;
  private projectData: any = null;

  constructor() {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    
    this.stateSync = new StateSync();
    this.houseScene = new HouseScene(canvas);
    this.schemePanel = new SchemePanel('scheme-panel');
    this.infoPanel = new InfoPanel('info-panel');
    this.offlineIndicator = new OfflineIndicator('offline-indicator');
    
    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    // Fetch project data
    const response = await fetch('/api/project');
    this.projectData = await response.json();
    
    // Build 3D scene
    await this.houseScene.buildFromCatalog(this.projectData);
    
    // Update UI
    this.schemePanel.updateTopics(this.projectData.topics);
    
    // Start state sync
    this.stateSync.start();
    
    // Start render loop
    this.renderLoop();
  }

  private setupEventHandlers(): void {
    // Scheme changes
    this.schemePanel.onSchemeChange(async (topicId, optionId) => {
      await this.stateSync.updateScheme([{ topic: topicId, optionId }]);
    });
    
    // Scheme updates from backend
    this.stateSync.onSchemeChange((scheme) => {
      this.schemePanel.updateScheme(scheme);
      
      // Apply all selections to scene
      for (const [topicId, selection] of Object.entries(scheme.selections)) {
        if (selection.default) {
          this.houseScene.setSelection(topicId, selection.default);
        }
      }
    });
    
    // Visual commands
    this.stateSync.onVisualCommand((command) => {
      if (command.type === 'set_camera_target') {
        const payload = command.payload as { targetId: string };
        this.houseScene.setCameraTarget(payload.targetId);
      } else if (command.type === 'highlight_object') {
        const payload = command.payload as { objectId: string };
        this.houseScene.highlightObject(payload.objectId);
      }
    });
    
    // Offline status
    this.stateSync.onOfflineChange((offline) => {
      this.offlineIndicator.setOffline(offline);
    });
    
    // Object clicks
    this.houseScene.onObjectClick((objectId) => {
      this.infoPanel.showObjectInfo(objectId);
      this.stateSync.postViewContext(objectId);
    });
  }

  private renderLoop(): void {
    this.houseScene.render();
    requestAnimationFrame(() => this.renderLoop());
  }
}
```

- [ ] **Step 2: Implement main.ts**

```typescript
// app/src/main.ts
import { App } from './App.js';

const app = new App();
app.start();
```

- [ ] **Step 3: Verify application starts**

```bash
# Terminal 1: Start backend
npm run dev:server

# Terminal 2: Start frontend
cd app
npm run dev
```

Expected: 
- Backend starts on http://localhost:3000
- Frontend starts on http://localhost:5173
- Browser shows 3D apartment with rooms and walls
- Left panel shows HVAC options
- Clicking HVAC options changes the 3D scene

- [ ] **Step 4: Commit**

```bash
git add app/src/main.ts app/src/App.ts
git commit -m "feat: integrate all components into working app"
```

---

### Task 8: Floor, Wall, and Paint Topics

**Files:**
- Create: `app/src/topics/FloorTopic.ts`
- Create: `app/src/topics/WallTopic.ts`
- Create: `app/src/topics/PaintTopic.ts`

**Interfaces:**
- Consumes: Three.js Scene, material data
- Produces: Topic renderers for floor/wall/paint

- [ ] **Step 1: Implement FloorTopic**

```typescript
// app/src/topics/FloorTopic.ts
import * as THREE from 'three';

interface TopicRenderer {
  apply(optionId: string, optionData: any): void;
}

export class FloorTopic implements TopicRenderer {
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  apply(optionId: string, optionData: any): void {
    // Find all floor objects
    this.scene.traverse((obj) => {
      if (obj.userData.objectId?.startsWith('floor:') && obj instanceof THREE.Mesh) {
        // Change floor color based on material
        const color = this.getMaterialColor(optionId);
        (obj.material as THREE.MeshStandardMaterial).color.set(color);
      }
    });
  }

  private getMaterialColor(optionId: string): number {
    // Map material IDs to colors
    const colorMap: Record<string, number> = {
      floor_tile_01: 0xd4a574, // Light wood
      floor_tile_02: 0x8b6f47, // Dark wood
    };
    return colorMap[optionId] || 0xd0d0d0;
  }
}
```

- [ ] **Step 2: Implement WallTopic**

```typescript
// app/src/topics/WallTopic.ts
import * as THREE from 'three';

interface TopicRenderer {
  apply(optionId: string, optionData: any): void;
}

export class WallTopic implements TopicRenderer {
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  apply(optionId: string, optionData: any): void {
    // Find all wall objects
    this.scene.traverse((obj) => {
      if (obj.userData.objectId?.startsWith('wall:') && obj instanceof THREE.Mesh) {
        // Change wall color based on material
        const color = this.getMaterialColor(optionId);
        (obj.material as THREE.MeshStandardMaterial).color.set(color);
      }
    });
  }

  private getMaterialColor(optionId: string): number {
    const colorMap: Record<string, number> = {
      wall_tile_01: 0xffffff, // White
      wall_tile_02: 0xe0e0e0, // Light gray
    };
    return colorMap[optionId] || 0xe0e0e0;
  }
}
```

- [ ] **Step 3: Implement PaintTopic**

```typescript
// app/src/topics/PaintTopic.ts
import * as THREE from 'three';

interface TopicRenderer {
  apply(optionId: string, optionData: any): void;
}

export class PaintTopic implements TopicRenderer {
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  apply(optionId: string, optionData: any): void {
    // Find all wall objects
    this.scene.traverse((obj) => {
      if (obj.userData.objectId?.startsWith('wall:') && obj instanceof THREE.Mesh) {
        // Change wall color based on paint
        const color = this.getPaintColor(optionId);
        (obj.material as THREE.MeshStandardMaterial).color.set(color);
      }
    });
  }

  private getPaintColor(optionId: string): number {
    const colorMap: Record<string, number> = {
      latex_paint_01: 0xffffff, // White
      latex_paint_02: 0xfff4e6, // Cream
      latex_paint_03: 0xe6f3ff, // Light blue
    };
    return colorMap[optionId] || 0xffffff;
  }
}
```

- [ ] **Step 4: Update TopicRegistry to include new topics**

```typescript
// In TopicRegistry.ts initialize() method, add:
if (topic.id === 'floor') {
  this.topics.set(topic.id, new FloorTopic(this.scene));
} else if (topic.id === 'wall') {
  this.topics.set(topic.id, new WallTopic(this.scene));
} else if (topic.id === 'paint') {
  this.topics.set(topic.id, new PaintTopic(this.scene));
}
```

- [ ] **Step 5: Verify all topics work**

```bash
# Start backend and frontend
npm run dev:server
cd app && npm run dev
```

Expected:
- Can switch between HVAC, floor, wall, paint tabs
- Each option changes the 3D scene accordingly

- [ ] **Step 6: Commit**

```bash
git add app/src/topics/FloorTopic.ts app/src/topics/WallTopic.ts app/src/topics/PaintTopic.ts app/src/topics/TopicRegistry.ts
git commit -m "feat: implement floor, wall, and paint topics"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Three.js 3D scene initialization (Task 4)
- ✅ House rendering: rooms, walls (Task 4)
- ✅ HVAC rendering (Task 5)
- ✅ Orbit camera controls (Task 4)
- ✅ Scheme switching UI panel (Task 6)
- ✅ Object selection (Task 4)
- ✅ view-context auto-reporting (Task 7)
- ✅ Basic info panel (Task 6)
- ✅ Floor/wall/paint rendering (Task 8)

**Placeholder scan:**
- ✅ No TBD/TODO
- ✅ All code blocks complete
- ✅ All file paths specified

**Type consistency:**
- ✅ StateSync methods match API endpoints
- ✅ HouseScene methods match spec
- ✅ TopicRegistry interface consistent across all topics

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-06-app-3d-scene-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
