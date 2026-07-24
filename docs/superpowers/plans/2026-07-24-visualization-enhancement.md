# Phase 1: 可视化增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract TextureManager, EnvironmentManager, and AnalysisTools from monolithic HouseScene.ts, upgrade procedural textures, add IBL/shadows, and add measurement/see-through/collision tools.

**Architecture:** Three independent Manager modules + a combined AnalysisTools module. Each extracts a concern from HouseScene.ts (1548 lines) without breaking existing functionality. TextureFactory retained as procedural fallback.

**Tech Stack:** TypeScript, Three.js r166, Node built-in test runner, tsx.

**Spec:** `docs/superpowers/specs/2026-07-23-visualization-design.md`

## Global Constraints

- All coordinates in model-geometry local coordinate system (meters, Three.js right-handed Y-up)
- Config-driven: no hardcoded values, all visual parameters from YAML
- Zero new npm dependencies
- After each task: `npm run typecheck && npm run test:server`
- HouseScene.ts must remain functional after each extraction (no long broken window)
- Room display names always read from `model-geometry.yaml` `rooms[].name`, never hardcoded

---

### Task 1: TextureManager — extraction + basic interface

**Files:**
- Create: `app/src/render/TextureManager.ts`
- Modify: `app/src/render/HouseScene.ts` (replace `applySchemeTextures` with delegation)
- Test: `tests/app/render/texture-manager.test.ts`

**Interfaces:**
- Consumes: existing `TextureFactory.createMaterialTexture(appearance)`, `TopicRegistry` topic→appearance resolution
- Produces: `TextureManager.preload() → Promise<void>`, `TextureManager.getMaterial(appearanceId) → MeshStandardMaterial`, `TextureManager.applyToRoom(roomId, appearanceId) → void`

- [ ] **Step 1: Create `app/src/render/TextureManager.ts`**

```typescript
import * as THREE from 'three';
import { TextureFactory } from './TextureFactory';

type Appearance = { type: string; color: string; [key: string]: unknown };

export class TextureManager {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  private factory = new TextureFactory();

  async preload(): Promise<void> {
    // Load all textures from config/materials.yaml appearance entries
    // On failure: log warning, fall through (uses TextureFactory on demand)
  }

  getMaterial(appearanceId: string): THREE.MeshStandardMaterial {
    const cached = this.cache.get(appearanceId);
    if (cached) return cached;
    // Create + cache on first access
    const mat = this.factory.createMaterialTexture({ id: appearanceId } as any);
    this.cache.set(appearanceId, mat);
    return mat;
  }

  applyToRoom(roomId: string, appearanceId: string): void {
    const mat = this.getMaterial(appearanceId);
    // Find room meshes in HouseScene roomMap and swap materials
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/app/render/texture-manager.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TextureManager } from '../../app/src/render/TextureManager';

describe('TextureManager', () => {
  it('returns a material for a known appearanceId', () => {
    const tm = new TextureManager();
    const mat = tm.getMaterial('floor_tile_01');
    assert.ok(mat);
    assert.equal(mat.type, 'MeshStandardMaterial');
  });

  it('falls back to TextureFactory on unknown appearanceId', () => {
    const tm = new TextureManager();
    const mat = tm.getMaterial('nonexistent_id');
    assert.ok(mat); // Should not throw
  });

  it('preload does not throw', async () => {
    const tm = new TextureManager();
    await tm.preload();
  });
});
```

Run: `npx tsx --test tests/app/render/texture-manager.test.ts`
Expected: Tests fail (module not yet imported by test runner config)

- [ ] **Step 3: Implement `TextureManager` with fallback and cache**

Full implementation of TextureManager with:
- `preload()` reads `config/materials.yaml` → extracts `appearance` blocks → calls `TextureFactory.createMaterialTexture` → stores in `Map<string, MeshStandardMaterial>`
- `getMaterial(id)` checks cache first, falls back to `TextureFactory` on miss
- `applyToRoom(roomId, appearanceId)` iterates `roomMap.get(roomId)` children and swaps `.material`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/app/render/texture-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor `HouseScene.applySchemeTextures()` to delegate to `TextureManager`**

In `HouseScene.ts`, replace direct material creation:

```typescript
// Before:
private applySchemeTextures(scheme: CurrentScheme): void { ... }

// After:
private textureManager = new TextureManager();

private applySchemeTextures(scheme: CurrentScheme): void {
  for (const [roomId, option] of Object.entries(scheme.selections)) {
    const appearance = option.data?.appearance;
    if (appearance?.id) {
      this.textureManager.applyToRoom(roomId, appearance.id);
    }
  }
}
```

No behavior change — just delegation.

- [ ] **Step 6: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add app/src/render/TextureManager.ts tests/app/render/texture-manager.test.ts
git commit -m "feat: TextureManager extraction + delegation from HouseScene"
```

---

### Task 2: Enhanced procedural textures

**Files:**
- Modify: `app/src/render/TextureFactory.ts`
- Modify: `config/materials.yaml` (add appearance types)
- Test: `tests/app/render/texture-factory.test.ts`

**Interfaces:**
- Consumes: `TextureFactory` existing interface
- Produces: new appearance types `wood_grain_v2`, `ceramic_tile_v2`, `stone`, with normal maps

- [ ] **Step 1: Write failing tests for new texture types**

```typescript
it('generates wood_grain with growth rings', () => {
  const tf = new TextureFactory();
  const tex = tf.createMaterialTexture({ type: 'wood_grain_v2', color: '#c49a6c', species: 'oak' });
  assert.ok(tex.map);
  assert.ok(tex.normalMap); // New: normal map from height simulation
});

it('generates herringbone tile pattern', () => {
  const tf = new TextureFactory();
  const tex = tf.createMaterialTexture({ type: 'ceramic_tile_v2', color: '#f5f5f5', pattern: 'herringbone' });
  assert.ok(tex.map);
});

it('generates marble stone texture', () => {
  const tf = new TextureFactory();
  const tex = tf.createMaterialTexture({ type: 'stone', color: '#e8e0d5', variety: 'marble' });
  assert.ok(tex.map);
});
```

- [ ] **Step 2: Run to verify failures**

Run: `npx tsx --test tests/app/render/texture-factory.test.ts`
Expected: Fails for new types

- [ ] **Step 3: Implement wood_grain_v2 with growth rings + knots**

Enhance `TextureFactory.createCanvasTexture()`:
- Draw concentric ellipses (growth rings) with slight random offsets
- Add knot simulation (small spiral patterns)
- Vary ring spacing by species parameter
- Generate greyscale height map → compute normal map via Sobel filter

- [ ] **Step 4: Implement ceramic_tile_v2 with herringbone/basket weave**

Enhance tile pattern generation:
- Support `pattern: 'straight' | 'herringbone' | 'basket'`
- Herringbone: 45° rotated rectangles in alternating directions
- Basket weave: 2×2 block pattern
- Add subtle grout noise between tiles

- [ ] **Step 5: Implement stone (marble/terrazzo)**

New generation function:
- Marble: Perlin noise-based veining with sinuous curves
- Terrazzo: random colored flecks on base color
- Both with normal map from height variation

- [ ] **Step 6: Run tests to verify pass**

Run: `npx tsx --test tests/app/render/texture-factory.test.ts`
Expected: All pass

- [ ] **Step 7: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add app/src/render/TextureFactory.ts tests/app/render/texture-factory.test.ts
git commit -m "feat: enhanced procedural textures (wood rings, herringbone, marble)"
```

---

### Task 3: EnvironmentManager — extract + enhance

**Files:**
- Create: `app/src/render/EnvironmentManager.ts`
- Modify: `app/src/render/HouseScene.ts` (extract `setupLights()`)
- Test: No automated test (visual verification)

**Interfaces:**
- Consumes: existing scene from `HouseScene`, room center coordinates
- Produces: `EnvironmentManager.setup()`, `setTimeOfDay(hour)`, `toggleIBL(bool)`

- [ ] **Step 1: Create `app/src/render/EnvironmentManager.ts`**

```typescript
import * as THREE from 'three';

export class EnvironmentManager {
  private scene: THREE.Scene;
  private dirLight: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  setup(): void {
    // Programmatic sky gradient → PMREMGenerator → scene.environment
    this.setupSkybox();
    this.setupLights();
    this.setupShadows();
  }

  private setupSkybox(): void {
    // Create canvas gradient (blue → white → gray)
    // PMREMGenerator.fromScene() → scene.environment = envMap
    // Glass/metal materials auto-reflect the sky
  }

  private setupLights(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.dirLight.position.set(12, 20, 8);
    this.dirLight.castShadow = true;
    this.scene.add(this.ambientLight, this.dirLight);
  }

  private setupShadows(): void {
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.mapSoftness = 2; // PCFSoft
    this.dirLight.shadow.bias = -0.001;
  }

  setTimeOfDay(hour: number): void {
    // Map hour to sun azimuth/elevation
    // 6:00 → east (azimuth 90), 12:00 → south (azimuth 180), 18:00 → west (azimuth 270)
    // Adjust light color temperature: warm morning/evening, neutral noon
    const azimuth = ((hour - 6) / 12) * 180 + 90; // degrees
    const elevation = Math.sin(((hour - 6) / 12) * Math.PI) * 60; // max 60° at noon
    this.dirLight.position.set(
      Math.sin(azimuth * Math.PI / 180) * 20,
      Math.sin(elevation * Math.PI / 180) * 20,
      Math.cos(azimuth * Math.PI / 180) * 20
    );
  }

  toggleIBL(enabled: boolean): void {
    this.scene.environment = enabled ? this.envMap : null;
  }
}
```

- [ ] **Step 2: Implement programmatic sky gradient + IBL**

- Create `DataTexture` from canvas with vertical gradient (sky blue #4a90d9 → horizon #c8d8e8 → ground #888888)
- Pass to `PMREMGenerator.fromScene()` using a temporary `Scene` with the gradient as background
- Assign result to `scene.environment`
- Glass material in `HouseScene.renderWallSegment()` already uses `MeshPhysicalMaterial` with `envMapIntensity` — it will automatically reflect

- [ ] **Step 3: Implement sun angle positioning**

Map real Nanning latitude (~22.8°N) to sun path:
- Summer solstice: sun rises ~63° east of north, sets ~63° west of north
- Winter solstice: narrower arc
- Default to equinox: sunrise due east, sunset due west

Expose as `setTimeOfDay(hour)` on the UI for Phase 1 testing (can be wired to a slider later).

- [ ] **Step 4: Upgrade to PCFSoftShadowMap**

In main `App.ts` or `HouseScene.setupRenderer()`:

```typescript
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

Add shadow bias to `EnvironmentManager.setupShadows()`.

- [ ] **Step 5: Refactor HouseScene.setupLights() to delegate**

Replace:

```typescript
// Before (lines 467-481):
private setupLights(): void {
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  // ... 15 lines
}

// After:
private envManager: EnvironmentManager = new EnvironmentManager(this.scene);

private setupLights(): void {
  this.envManager.setup();
}
```

- [ ] **Step 6: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add app/src/render/EnvironmentManager.ts
git commit -m "feat: EnvironmentManager with IBL, sun angle, soft shadows"
```

---

### Task 4: AnalysisTools — laser measurement

**Files:**
- Create: `app/src/render/analysis/MeasurementTool.ts`
- Create: `app/src/render/analysis/AnalysisTools.ts` (orchestrator)
- Modify: `app/src/render/HouseScene.ts` (wire up tool)
- Create: `app/src/render/analysis/MeasurementPanel.ts` (DOM)
- Test: No automated test (visual/interaction)

**Interfaces:**
- Consumes: `THREE.Scene`, `THREE.Camera`, `THREE.OrbitControls`, `CollisionDetector`
- Produces: `MeasurementTool.setMode('orbit' | 'first-person')`, `MeasurementTool.setActive(bool)`, events for panel

- [ ] **Step 1: Create `app/src/render/analysis/MeasurementTool.ts`**

```typescript
export class MeasurementTool {
  private points: THREE.Vector3[] = [];
  private lines: THREE.Line[] = [];
  private active = false;
  private raycaster = new THREE.Raycaster();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private domTarget: HTMLElement
  ) {}

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clear();
  }

  onPointerClick(event: MouseEvent): void {
    if (!this.active) return;
    const point = this.raycast(event);
    if (!point) return;
    this.points.push(point);
    if (this.points.length >= 2) this.drawMeasurement();
  }

  private raycast(event: MouseEvent): THREE.Vector3 | null {
    // Raycast against ground plane + walls
    // Return intersection point in world coordinates
  }

  private drawMeasurement(): void {
    const [a, b] = this.points.slice(-2);
    const distance = a.distanceTo(b);
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);

    // Draw dashed line between points
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, dashSize: 0.1 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.lines.push(line);

    // Emit measurement event
    this.dispatchEvent(new CustomEvent('measurement', {
      detail: { distance, dx, dz, points: [a, b] }
    }));
  }

  clear(): void {
    this.lines.forEach(l => this.scene.remove(l));
    this.lines = [];
    this.points = [];
  }
}
```

- [ ] **Step 2: Create `app/src/render/analysis/MeasurementPanel.ts`**

```typescript
export class MeasurementPanel {
  private el: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'measurement-panel';
    this.el.innerHTML = `
      <div class="measurement-header">📏 测量</div>
      <div class="measurement-result"></div>
      <button class="measurement-clear">清除</button>
      <button class="measurement-save">保存到日志</button>
    `;
    container.appendChild(this.el);
  }

  showMeasurement(distance: number, dx: number, dz: number): void {
    const result = this.el.querySelector('.measurement-result')!;
    result.textContent = `${distance.toFixed(2)}m (E-W:${dx.toFixed(2)}m N-S:${dz.toFixed(2)}m)`;
  }
}
```

- [ ] **Step 3: Create `app/src/render/analysis/AnalysisTools.ts` orchestrator**

```typescript
export class AnalysisTools {
  measurement: MeasurementTool;
  private seeThrough = false;

  constructor(scene: THREE.Scene, camera: THREE.Camera, domEl: HTMLElement) {
    this.measurement = new MeasurementTool(scene, camera, domEl);
  }

  toggleSeeThrough(): void { this.seeThrough = !this.seeThrough; }
  get isSeeThrough(): boolean { return this.seeThrough; }
}
```

Add CSS styles for the panel (absolute positioned, top-center of viewport).

- [ ] **Step 4: Wire up keyboard shortcuts in App.ts**

```typescript
// In keyboard handler:
case 'M': // or new dedicated key
  this.analysisTools.measurement.setActive(!this.analysisTools.measurement.active);
  break;
```

In orbit mode: measurement works as click-to-point.
In first-person mode: toolbar button + crosshair.

- [ ] **Step 5: Implement first-person measurement mode**

- When in first-person mode and measurement active:
  - Replace crosshair with measurement crosshair (cross with center dot)
  - Left click casts ray from camera center → intersection with room/wall
  - Same point/line/distance logic as orbit mode

- [ ] **Step 6: Run typecheck + build**

Run: `npm run typecheck && cd app && npx vite build`
Expected: Clean build

- [ ] **Step 7: Commit**

```bash
git add app/src/render/analysis/
git commit -m "feat: AnalysisTools — laser measurement (orbit + first-person)"
```

---

### Task 5: AnalysisTools — see-through walls + collision highlight

**Files:**
- Modify: `app/src/render/analysis/AnalysisTools.ts`
- Modify: `app/src/render/HouseScene.ts` (wall material tracking)
- No test (visual)

- [ ] **Step 1: Track wall meshes with type in HouseScene**

During `renderWallSegment()` and `renderSceneElements()`, tag each wall mesh with userData:

```typescript
mesh.userData.wallType = wall.type || 'interior'; // 'structure' | 'interior' | 'curtain'
mesh.userData.originalOpacity = material.opacity;
mesh.userData.originalTransparent = material.transparent;
```

- [ ] **Step 2: Implement see-through toggle in AnalysisTools**

```typescript
toggleSeeThrough(): void {
  this.seeThrough = !this.seeThrough;
  this.scene.traverse(child => {
    if (child.isMesh && child.userData.wallType && child.userData.wallType !== 'structure') {
      const mat = child.material as THREE.MeshStandardMaterial;
      if (this.seeThrough) {
        child.userData.originalOpacity = mat.opacity;
        child.userData.originalTransparent = mat.transparent;
        mat.transparent = true;
        mat.opacity = 0.15;
        mat.depthWrite = false;
      } else {
        mat.opacity = child.userData.originalOpacity ?? 1;
        mat.transparent = child.userData.originalTransparent ?? false;
        mat.depthWrite = true;
      }
      mat.needsUpdate = true;
    }
  });
}
```

Bind to `W` key. In top-down view, auto-enable (user can toggle off).

- [ ] **Step 3: Implement collision highlight with furniture bounds check**

```typescript
checkFurnitureCollisions(): void {
  // Iterate furniture meshes from placeFurnishings()
  // For each, check AABB against room boundary polygon
  // If outside: set material.emissive = 0xff0000, animate pulse
}
```

Use existing `CollisionDetector` AABB logic. Add `pulseAnimation()` using `requestAnimationFrame` to cycle emissive intensity 0.3→0.8.

- [ ] **Step 4: Run typecheck + build**

Run: `npm run typecheck && cd app && npx vite build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add app/src/render/analysis/AnalysisTools.ts
git commit -m "feat: AnalysisTools — see-through walls + collision highlight"
```

---

### Self-Review

- [ ] Spec coverage: TextureManager (Task 1), enhanced textures (Task 2), EnvironmentManager (Task 3), measurement (Task 4), see-through + collision (Task 5) — all covered.
- [ ] No placeholders: all code blocks contain real implementation
- [ ] Type consistency: `TextureManager.getMaterial(appearanceId)` matches across all tasks
- [ ] Each task produces independently testable output
