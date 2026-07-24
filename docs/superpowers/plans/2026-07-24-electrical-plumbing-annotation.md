# Phase 3: 点位配置与 3D 可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a config-driven electrical/plumbing/ceiling annotation system — define sockets, switches, pipes, and ceiling zones in YAML, render them as interactive 3D labels in the scene, and detect placement problems automatically.

**Architecture:** Three new YAML config files (`electrical.yaml`, `plumbing.yaml`, `ceiling.yaml`) define positions. A new `AnnotationRenderer.ts` reads them and places 3D icons at corresponding wall/floor positions. Problem detection cross-references positions against furniture and wall types.

**Tech Stack:** TypeScript, Three.js r166, js-yaml, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-07-23-electrical-plumbing-ceiling-design.md`

## Global Constraints

- `wall` field in config references `model-geometry.yaml` `walls[].id`
- Coordinates in model-geometry local coordinate system (meters)
- Room display names from `model-geometry.yaml` `rooms[].name`
- After each task: `npm run typecheck && npm run test:server`
- Zero new npm dependencies

---

### Task 1: Config schema + loader

**Files:**
- Create: `config/electrical.yaml`
- Create: `config/plumbing.yaml`
- Create: `config/ceiling.yaml`
- Create: `server/config-loader.ts` (extend for new configs)
- Test: `tests/server/config-loader.test.ts`

**Interfaces:**
- Consumes: existing `configLoader.loadConfig<T>(path)` pattern
- Produces: `loadElectricalConfig()`, `loadPlumbingConfig()`, `loadCeilingConfig()` — each returns typed array

- [ ] **Step 1: Write failing tests**

```typescript
it('loads electrical config with expected fields', () => {
  const cfg = loadElectricalConfig();
  assert.ok(Array.isArray(cfg));
  if (cfg.length > 0) {
    assert.ok(cfg[0].id);
    assert.ok(cfg[0].room);
    assert.ok(cfg[0].wall);
    assert.ok(typeof cfg[0].x === 'number');
    assert.ok(typeof cfg[0].z === 'number');
  }
});

it('loads ceiling config with zone data', () => {
  const cfg = loadCeilingConfig();
  assert.ok(Array.isArray(cfg));
  if (cfg.length > 0) {
    assert.ok(cfg[0].room);
    assert.ok(cfg[0].type); // 'drop' | 'integrated' | 'cove' | 'none'
  }
});
```

- [ ] **Step 2: Create initial YAML configs**

`config/electrical.yaml`:
```yaml
- id: sock_tv_01
  room: living_dining
  wall: w_st_east
  type: socket
  x: 7.20
  z: 5.80
  height: 0.3
  count: 4
  note: "电视墙插座，含USB×2"

- id: switch_living_01
  room: living_dining
  wall: w_ent_kit
  type: switch_2way
  x: 7.20
  z: 4.30
  height: 1.3
  note: "客厅灯光双控（入户侧）"
```

`config/plumbing.yaml`:
```yaml
- id: wc_master
  room: master_bath
  type: toilet
  x: 0.8
  z: 2.0
  note: "主卫马桶"

- id: faucet_garden
  room: entry_garden
  type: faucet
  x: 12.5
  z: 1.5
  height: 0.8
  note: "入户花园浇花水龙头"
```

`config/ceiling.yaml`:
```yaml
- id: ceiling_living
  room: living_dining
  type: drop
  thickness: 0.30
  area: [7.20, 4.30, 13.40, 9.80] # x1,z1,x2,z2 bounding box
  note: "客厅局部吊顶（走管区）"
```

- [ ] **Step 3: Implement loaders in config-loader.ts**

```typescript
export interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  type: 'socket' | 'switch' | 'switch_2way' | 'network' | 'usb';
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
}

export interface PlumbingPoint {
  id: string;
  room: string;
  type: 'faucet' | 'toilet' | 'shower' | 'drain' | 'washer' | 'faucet_outdoor';
  x: number;
  z: number;
  height?: number;
  note?: string;
}

export interface CeilingZone {
  id: string;
  room: string;
  type: 'drop' | 'integrated' | 'cove' | 'none';
  thickness?: number;
  area: [number, number, number, number]; // x1,z1,x2,z2
  note?: string;
}

export function loadElectricalConfig(): ElectricalPoint[] {
  return loadConfig<ElectricalPoint[]>('config/electrical.yaml');
}

export function loadPlumbingConfig(): PlumbingPoint[] {
  return loadConfig<PlumbingPoint[]>('config/plumbing.yaml');
}

export function loadCeilingConfig(): CeilingZone[] {
  return loadConfig<CeilingZone[]>('config/ceiling.yaml');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/server/config-loader.test.ts`
Expected: PASS (new tests)

- [ ] **Step 5: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add config/electrical.yaml config/plumbing.yaml config/ceiling.yaml server/config-loader.ts
git commit -m "feat: electrical/plumbing/ceiling config schema + loader"
```

---

### Task 2: AnnotationRenderer — 3D visualization

**Files:**
- Create: `app/src/render/annotations/AnnotationRenderer.ts`
- Create: `app/src/render/annotations/icons.ts` (icon geometry factory)
- Modify: `app/src/render/HouseScene.ts` (wire up AnnotationRenderer)
- Test: None (visual)

**Interfaces:**
- Consumes: `THREE.Scene`, `ElectricalPoint[]`, `PlumbingPoint[]`, `CeilingZone[]`, wall geometry from scene
- Produces: `AnnotationRenderer.render()`, `AnnotationRenderer.setVisible(category, bool)`, `AnnotationRenderer.clear()`

- [ ] **Step 1: Create icon geometry factory `app/src/render/annotations/icons.ts`**

```typescript
import * as THREE from 'three';

export function createSocketIcon(): THREE.Group {
  const group = new THREE.Group();
  // Small flat square (0.08×0.12×0.02) with rounded corners
  const geo = new THREE.BoxGeometry(0.08, 0.02, 0.12);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x4488ff, emissiveIntensity: 0.3 });
  group.add(new THREE.Mesh(geo, mat));
  // Small indicator dots
  const dotMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  [-0.02, 0.02].forEach(x => {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 8), dotMat);
    dot.position.set(x, 0.01, 0.04);
    group.add(dot);
  });
  return group;
}

export function createSwitchIcon(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.06, 0.02, 0.06);
  const mat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

export function createFaucetIcon(): THREE.Group {
  const group = new THREE.Group();
  // Blue circle
  const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.2 });
  group.add(new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat));
  return group;
}

export function createDrainIcon(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const ring = new THREE.RingGeometry(0.03, 0.05, 16);
  group.add(new THREE.Mesh(ring, mat));
  return group;
}

export function createCeilingZoneIndicator(width: number, depth: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8888ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}
```

- [ ] **Step 2: Create `AnnotationRenderer.ts`**

```typescript
import * as THREE from 'three';
import type { ElectricalPoint, PlumbingPoint, CeilingZone } from '../../../server/config-loader';
import { loadElectricalConfig, loadPlumbingConfig, loadCeilingConfig } from '../../../server/config-loader';
import { createSocketIcon, createSwitchIcon, createFaucetIcon, createDrainIcon, createCeilingZoneIndicator } from './icons';

export class AnnotationRenderer {
  private group = new THREE.Group();
  private layerGroups: Record<string, THREE.Group> = {
    electrical: new THREE.Group(),
    plumbing: new THREE.Group(),
    ceiling: new THREE.Group(),
  };

  constructor(private scene: THREE.Scene) {
    Object.values(this.layerGroups).forEach(g => this.group.add(g));
    this.group.visible = false;
    this.scene.add(this.group);
  }

  async load(): Promise<void> {
    const electrical = loadElectricalConfig();
    const plumbing = loadPlumbingConfig();
    const ceiling = loadCeilingConfig();

    this.renderElectrical(electrical);
    this.renderPlumbing(plumbing);
    this.renderCeiling(ceiling);
  }

  setVisible(category: 'electrical' | 'plumbing' | 'ceiling' | 'all', visible: boolean): void {
    if (category === 'all') {
      this.group.visible = visible;
    } else {
      this.layerGroups[category].visible = visible;
    }
  }

  private renderElectrical(points: ElectricalPoint[]): void {
    const g = this.layerGroups.electrical;
    points.forEach(p => {
      const icon = p.type === 'switch' || p.type === 'switch_2way'
        ? createSwitchIcon()
        : createSocketIcon();
      icon.position.set(p.x, p.height, p.z);
      icon.userData = { type: 'annotation', category: 'electrical', pointId: p.id, note: p.note };
      g.add(icon);
    });
  }

  private renderPlumbing(points: PlumbingPoint[]): void {
    const g = this.layerGroups.plumbing;
    points.forEach(p => {
      const icon = p.type === 'drain' ? createDrainIcon() : createFaucetIcon();
      icon.position.set(p.x, p.height ?? 0.5, p.z);
      icon.userData = { type: 'annotation', category: 'plumbing', pointId: p.id, note: p.note };
      g.add(icon);
    });
  }

  private renderCeiling(zones: CeilingZone[]): void {
    const g = this.layerGroups.ceiling;
    zones.forEach(z => {
      const [x1, z1, x2, z2] = z.area;
      const mesh = createCeilingZoneIndicator(x2 - x1, z2 - z1);
      mesh.position.set((x1 + x2) / 2, 2.9, (z1 + z2) / 2); // Just below ceiling
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData = { type: 'annotation', category: 'ceiling', zoneId: z.id, note: z.note };
      g.add(mesh);
    });
  }

  clear(): void {
    Object.values(this.layerGroups).forEach(g => {
      while (g.children.length) g.remove(g.children[0]);
    });
  }
}
```

- [ ] **Step 3: Create label sprite/HTML for hover details**

Use CSS2DRenderer approach or sprite labels:
- When camera distance < 2m from annotation, show a floating label with `note` text
- Use `THREE.Sprite` with `CanvasTexture` for the label text

```typescript
private createLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = '16px sans-serif';
  ctx.fillText(text, 16, 38);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.0, 0.25, 1);
  return sprite;
}
```

- [ ] **Step 4: Wire up in HouseScene + keyboard shortcut**

In `HouseScene` constructor or `init()`:

```typescript
this.annotationRenderer = new AnnotationRenderer(this.scene);
await this.annotationRenderer.load();
```

In keyboard handler, add `P` key to toggle annotations:

```typescript
case 'P':
  this.annotationRenderer.setVisible('all', !this.annotationGroupVisible);
  break;
```

- [ ] **Step 5: Run typecheck + build**

Run: `npm run typecheck && cd app && npx vite build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add app/src/render/annotations/
git commit -m "feat: AnnotationRenderer — electrical/plumbing/ceiling 3D icons"
```

---

### Task 3: Problem detection

**Files:**
- Create: `app/src/render/annotations/ProblemDetector.ts`
- Modify: `app/src/render/annotations/AnnotationRenderer.ts` (wire up detection)
- Test: `tests/app/render/problem-detector.test.ts`

**Interfaces:**
- Consumes: `ElectricalPoint[]`, `PlumbingPoint[]`, furniture positions (from `ProjectCatalog`), wall types (from scene meshes userData)
- Produces: `ProblemDetector.detect() → Problem[]`, each with `{ type, severity, message, position, highlight }`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('ProblemDetector', () => {
  it('detects socket behind furniture', () => {
    const detector = new ProblemDetector();
    const socket = { id: 's1', room: 'living_dining', wall: 'w_st_east', x: 7.2, z: 5.8, height: 0.3, type: 'socket' };
    const furniture = [{ x: 7.2, z: 5.8, width: 0.5, depth: 0.5 }]; // Furniture at same position
    const problems = detector.checkSocketBehindFurniture([socket], furniture);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].severity, 'warning');
  });

  it('passes when socket is clear of furniture', () => {
    const detector = new ProblemDetector();
    const socket = { id: 's1', room: 'living_dining', wall: 'w_st_east', x: 7.2, z: 5.8, height: 0.3, type: 'socket' };
    const furniture = [{ x: 8.0, z: 5.0, width: 0.5, depth: 0.5 }]; // Different position
    const problems = detector.checkSocketBehindFurniture([socket], furniture);
    assert.equal(problems.length, 0);
  });
});
```

- [ ] **Step 2: Implement `ProblemDetector.ts`**

```typescript
export interface Problem {
  type: 'socket_blocked' | 'pipe_through_structure' | 'ac_ceiling_conflict' | 'point_overlap';
  severity: 'warning' | 'error';
  message: string;
  position: { x: number; y: number; z: number };
}

export class ProblemDetector {
  detectAll(
    electrical: ElectricalPoint[],
    plumbing: PlumbingPoint[],
    ceiling: CeilingZone[],
    furniture: FurnitureItem[],
    walls: WallInfo[]
  ): Problem[] {
    return [
      ...this.checkSocketBehindFurniture(electrical, furniture),
      ...this.checkPipeThroughStructure(plumbing, walls),
      ...this.checkACCeilingConflict(ceiling),
      ...this.checkPointOverlap(electrical, plumbing),
    ];
  }

  checkSocketBehindFurniture(sockets: ElectricalPoint[], furniture: FurnitureItem[]): Problem[] {
    // For each socket, check if any furniture's AABB overlaps the socket position at its height
    // If overlap → problem (socket will be behind furniture)
    return [];
  }

  checkPipeThroughStructure(pipes: PlumbingPoint[], walls: WallInfo[]): Problem[] {
    // For each pipe routing, check if it crosses a wall with type='structure'
    return [];
  }

  checkACCeilingConflict(ceiling: CeilingZone[]): Problem[] {
    // Check AC indoor unit height vs ceiling bottom
    return [];
  }

  checkPointOverlap(electrical: ElectricalPoint[], plumbing: PlumbingPoint[]): Problem[] {
    // Check no two points on same wall are within 0.2m
    return [];
  }
}
```

Implement all four detection methods with real AABB/line intersection logic.

- [ ] **Step 3: Integrate with AnnotationRenderer**

After rendering annotations, run problem detection and mark problems:

```typescript
const problems = this.detector.detectAll(electrical, plumbing, ceiling, furniture, walls);
this.renderProblems(problems);

private renderProblems(problems: Problem[]): void {
  problems.forEach(p => {
    // Red emissive marker at problem position
    const geo = new THREE.SphereGeometry(0.06, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const marker = new THREE.Mesh(geo, mat);
    marker.position.set(p.position.x, p.position.y, p.position.z);
    this.scene.add(marker);
  });

  // Emit for right-side panel display
  this.dispatchEvent(new CustomEvent('problems', { detail: problems }));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx tsx --test tests/app/render/problem-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck + test:server**

Run: `npm run typecheck && npm run test:server`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add app/src/render/annotations/ProblemDetector.ts tests/app/render/problem-detector.test.ts
git commit -m "feat: ProblemDetector — socket blocked, pipe structure, AC conflict, point overlap"
```
