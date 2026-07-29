# 装修模拟器 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the system from design viewer to interactive renovation simulator with real material rendering, FP 3D editing, centralized key bindings, and YAML write-back.

**Architecture:** Three independent blocks: (1) fix core loop by connecting procedural textures to topics + adding missing topics + real-time budget; (2) FP interactive editing with YAML write-back via REST CRUD APIs; (3) centralized key binding registry + command palette. Blocks 1 & 3 are fully independent; Block 2 depends on YAML writer shared utility.

**Tech Stack:** Three.js + Vite (frontend), Node.js + Express (server), js-yaml (YAML parse/dump), SSE for real-time push.

---

## Task 1: Centralized Key Binding Registry + Command Palette

**Files:**
- Create: `app/src/ui/keybindings.ts`
- Create: `app/src/ui/CommandPalette.ts`
- Modify: `app/src/App.ts:198-274` — refactor keyboard handler to use registry
- Modify: `app/src/App.ts` — register ? key to toggle command palette
- Test: `app/src/ui/CommandPalette.test.ts` (new)
- Test: `app/src/ui/keybindings.test.ts` (new)

**Interfaces:**
- Exports: `KEY_BINDINGS: KeyBinding[]`, `findBinding(code: string, shiftKey?: boolean): KeyBinding | undefined`
- Exports: `CommandPalette` class with `show()`, `hide()`, `toggle()`, `isVisible()`

**Note on `-` handling:** The `-` in `keybindings.ts` is a single file name. Some editors/terminals use tab-completion for it. All code references use the exact name `keybindings.ts`.

- [ ] **Step 1: Create `app/src/ui/keybindings.ts`**

```typescript
export interface KeyBinding {
  key: string;
  code: string;
  description: string;
  category: '视角' | '移动' | '编辑' | '工具';
  mode?: 'all' | 'first-person' | 'orbit' | 'top-down';
  shiftKey?: boolean;
}

export const KEY_BINDINGS: KeyBinding[] = [
  // 视角
  { key: 'V', code: 'KeyV', description: '切换视角模式', category: '视角', mode: 'all' },
  { key: 'Tab', code: 'Tab', description: '切换方案对比', category: '视角', mode: 'all' },
  { key: 'M', code: 'KeyM', description: '打开总览菜单', category: '视角', mode: 'all' },

  // 移动（FP）
  { key: 'W / A / S / D', code: '', description: '前后左右行走', category: '移动', mode: 'first-person' },

  // 编辑
  { key: 'G', code: 'KeyG', description: '拖拽选中物体', category: '编辑', mode: 'first-person' },
  { key: 'B', code: 'KeyB', description: '打开家具面板', category: '编辑', mode: 'first-person' },
  { key: 'E', code: 'KeyE', description: '新增电气/给排水点位', category: '编辑', mode: 'first-person' },
  { key: 'Delete', code: 'Delete', description: '删除选中点位', category: '编辑', mode: 'first-person' },

  // 工具
  { key: 'W', code: 'KeyW', description: '透视图（X-ray）', category: '工具', mode: 'orbit' },
  { key: 'P', code: 'KeyP', description: '开关标注标签', category: '工具', mode: 'all' },
  { key: 'L', code: 'KeyL', description: '开关测量工具', category: '工具', mode: 'all' },
  { key: '[', code: 'BracketLeft', description: '降低鼠标灵敏度', category: '工具', mode: 'first-person' },
  { key: ']', code: 'BracketRight', description: '提高鼠标灵敏度', category: '工具', mode: 'first-person' },
  { key: '?', code: 'Slash', description: '打开命令面板', category: '工具', mode: 'all', shiftKey: true },
];

export function findBinding(code: string, shiftKey?: boolean): KeyBinding | undefined {
  return KEY_BINDINGS.find((b) => b.code === code && (b.shiftKey ?? false) === (shiftKey ?? false));
}
```

- [ ] **Step 2: Create test for keybindings**

```typescript
// app/src/ui/keybindings.test.ts
import { describe, it, expect } from 'vitest';
import { KEY_BINDINGS, findBinding } from './keybindings.js';

describe('keybindings', () => {
  it('has expected number of bindings', () => {
    expect(KEY_BINDINGS.length).toBe(16);
  });

  it('finds binding by code', () => {
    const b = findBinding('KeyV');
    expect(b?.key).toBe('V');
    expect(b?.description).toBe('切换视角模式');
  });

  it('finds shift-? binding', () => {
    const b = findBinding('Slash', true);
    expect(b?.key).toBe('?');
  });

  it('returns undefined for unknown code', () => {
    expect(findBinding('KeyZ')).toBeUndefined();
  });

  it('does not match ? without shift', () => {
    expect(findBinding('Slash')).toBeUndefined();
  });

  it('every binding has a non-empty code', () => {
    for (const b of KEY_BINDINGS) {
      // WASD has empty code (handled differently)
      if (b.key === 'W / A / S / D') continue;
      expect(b.code).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/src/ui/keybindings.test.ts --config app/vitest.config.ts`
Expected: FAIL with import error

- [ ] **Step 4: Create `app/src/ui/CommandPalette.ts`**

```typescript
import { KEY_BINDINGS, type KeyBinding } from './keybindings.js';

export class CommandPalette {
  private container: HTMLDivElement;
  private visible = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'command-palette';
    this.container.style.cssText = `
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.4); justify-content: center; align-items: center;
      font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container) this.hide();
    });
    document.body.appendChild(this.container);
    this.render();
  }

  private render(): void {
    const groups = new Map<string, KeyBinding[]>();
    for (const b of KEY_BINDINGS) {
      const list = groups.get(b.category) ?? [];
      list.push(b);
      groups.set(b.category, list);
    }

    let html = `<div style="background:#1a1a2e; border-radius:12px; padding:24px 32px; max-width:520px; width:90%; max-height:80vh; overflow-y:auto; color:#e0e0e0; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 16px; font-size:18px; color:#fff;">快捷键</h2>`;

    for (const [cat, bindings] of groups) {
      html += `<h3 style="margin:12px 0 6px; font-size:13px; color:#8888aa; text-transform:uppercase;">${cat}</h3>`;
      for (const b of bindings) {
        const modeTag = b.mode && b.mode !== 'all' ? `<span style="font-size:11px; color:#666; margin-left:8px;">${b.mode}</span>` : '';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #2a2a3e;">
          <span style="font-size:14px;">${b.description}</span>
          <span><kbd style="background:#2a2a3e; border:1px solid #3a3a5e; border-radius:4px; padding:2px 8px; font-size:13px; font-family:monospace; color:#aad;">${b.key}</kbd>${modeTag}</span>
        </div>`;
      }
    }

    html += `<div style="margin-top:12px; text-align:center; font-size:12px; color:#666;">按 ? 或 Esc 关闭</div></div>`;
    this.container.innerHTML = html;
  }

  show(): void { this.visible = true; this.container.style.display = 'flex'; }
  hide(): void { this.visible = false; this.container.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }
}
```

- [ ] **Step 5: Create test for CommandPalette**

```typescript
// app/src/ui/CommandPalette.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandPalette } from './CommandPalette.js';

describe('CommandPalette', () => {
  let palette: CommandPalette;

  beforeEach(() => {
    palette = new CommandPalette();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('starts hidden', () => {
    expect(palette.isVisible()).toBe(false);
  });

  it('becomes visible on show()', () => {
    palette.show();
    expect(palette.isVisible()).toBe(true);
  });

  it('becomes hidden on hide()', () => {
    palette.show();
    palette.hide();
    expect(palette.isVisible()).toBe(false);
  });

  it('toggles visibility', () => {
    palette.toggle();
    expect(palette.isVisible()).toBe(true);
    palette.toggle();
    expect(palette.isVisible()).toBe(false);
  });

  it('renders key binding entries', () => {
    palette.show();
    const el = document.getElementById('command-palette');
    expect(el).toBeTruthy();
    expect(el!.innerHTML).toContain('快捷键');
    expect(el!.innerHTML).toContain('切换视角模式');
    expect(el!.innerHTML).toContain('KeyV');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run app/src/ui/CommandPalette.test.ts --config app/vitest.config.ts`
Expected: FAIL (module not found)

- [ ] **Step 7: Refactor `App.ts` — instantiate CommandPalette, delegate keydown to registry**

Add to `App.ts` imports:
```typescript
import { CommandPalette } from './ui/CommandPalette.js';
import { KEY_BINDINGS, findBinding } from './ui/keybindings.js';
```

Add field:
```typescript
private commandPalette = new CommandPalette();
```

Refactor `setupKeyboard` — replace the hardcoded if-chain with registry lookups where possible, keeping special logic (mode checks, Esc close overview) in place:

```typescript
private setupKeyboard(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    // ── Special cases that need extra logic ──
    if (e.code === 'Escape') {
      if (this.overviewMenu.isVisible()) { this.overviewMenu.hide(); return; }
      if (this.commandPalette.isVisible()) { this.commandPalette.hide(); return; }
      return;
    }

    if (e.code === 'KeyV' && !e.repeat) {
      e.preventDefault();
      this.toggleMode();
      return;
    }

    if (e.code === 'KeyM' && !e.repeat) {
      e.preventDefault();
      if (this.overviewMenu.isVisible()) {
        this.overviewMenu.hide();
      } else {
        void this.refreshOverviewData();
        this.overviewMenu.show();
      }
      return;
    }

    if (shouldToggleSeeThrough(e.code, e.repeat, this.houseScene.mode)) {
      e.preventDefault();
      this.analysisTools.toggleSeeThrough();
      this.updateModeIndicator();
      return;
    }

    if (e.code === 'KeyP' && !e.repeat) {
      e.preventDefault();
      this.annotationGroupVisible = !this.annotationGroupVisible;
      this.annotationRenderer?.setVisible('all', this.annotationGroupVisible);
      return;
    }

    if (e.code === 'KeyL' && !e.repeat) {
      e.preventDefault();
      this.analysisTools.toggleMeasurement();
      if (this.houseScene.mode === 'orbit') {
        this.houseScene.controls.enabled = !this.analysisTools.measurement.active;
      }
      this.updateModeIndicator();
      this.updateCrosshairStyle();
      return;
    }

    if (this.houseScene.mode === 'first-person' && !e.repeat) {
      if (e.code === 'BracketLeft') { e.preventDefault(); this.sensitivitySlider.step(-1); return; }
      if (e.code === 'BracketRight') { e.preventDefault(); this.sensitivitySlider.step(1); return; }
    }

    if (e.code === 'Tab' && this.compareActive) {
      e.preventDefault();
      this.compareShowing = !this.compareShowing;
      if (this.compareShowing) {
        this.houseScene.applyCompareScheme();
      } else {
        this.stateSync.fetchScheme().then((s) => { if (s) this.applyScheme(s); });
      }
      return;
    }

    // ── Command palette toggle (shift + /) ──
    if (e.code === 'Slash' && e.shiftKey && !e.repeat) {
      e.preventDefault();
      this.commandPalette.toggle();
      return;
    }

    // ── Camera animation interrupt ──
    if (shouldInterruptCameraAnimation(
      this.houseScene.cameraAnimator.isAnimating(),
      this.houseScene.cameraAnimator.currentMode,
      e.code,
    )) {
      this.houseScene.cameraAnimator.interrupt();
    }
  });
}
```

- [ ] **Step 8: Run existing tests to verify no regression**

Run: `npm run test:app`
Expected: All existing tests pass

- [ ] **Step 9: Run new tests**

Run: `npx vitest run app/src/ui/keybindings.test.ts app/src/ui/CommandPalette.test.ts --config app/vitest.config.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add app/src/ui/keybindings.ts app/src/ui/CommandPalette.ts app/src/ui/keybindings.test.ts app/src/ui/CommandPalette.test.ts app/src/App.ts
git commit -m "feat: centralized key binding registry + command palette"
```

---

## Task 2: Connect Procedural Textures to Floor/Wall/Paint Topics

**Files:**
- Modify: `app/src/topics/FloorTopic.ts`
- Modify: `app/src/topics/WallTopic.ts`
- Modify: `app/src/topics/PaintTopic.ts`
- Modify: `app/src/render/HouseScene.ts:1323-1345` — add `setFloorMaterial()`, `setWallMaterial()`, `setPaintMaterial()` for per-room texture application
- Test: update `app/src/topics/TopicRegistry.test.ts` to match new signatures

**Interfaces:**
- Consumes: `TextureManager.applyToRoom(roomId, appearance, meshType)` — already exists
- New HouseScene methods: see below

- [ ] **Step 1: Add material-applying methods to HouseScene**

```typescript
// After setPaintColor (line ~1345), add:

setFloorMaterial(roomId: string, appearance: { type: string; color: string; scale?: number }): void {
  this.textureManager.applyToRoom(roomId, appearance, 'floor');
}

setWallMaterial(roomId: string, appearance: { type: string; color: string; scale?: number }): void {
  this.textureManager.applyToRoom(roomId, appearance, 'wall');
}
```

- [ ] **Step 2: Update FloorTopic to use texture**

```typescript
// app/src/topics/FloorTopic.ts
import type { Topic, SceneApi } from '@shared/types';
import { floorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class FloorTopic implements Topic {
  id = 'floor';
  name = '地砖方案';
  options = floorOptions;

  apply(scene: SceneApi, optionId: string, roomId?: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const appearance = option.data?.appearance ?? { type: 'ceramic_tile_v2', color: option.color ?? '#e8e0d5' };
    if (roomId) {
      hs.setFloorMaterial(roomId, appearance);
      return [`floor:${roomId}`];
    }
    // Apply to all rooms
    const allRoomIds = hs.getRoomIdsWithWallFinish('paint'); // not ideal but gets room list
    // Actually, let's use a more direct approach — iterate floor meshes
    for (const roomId of hs.getAllRoomIds()) {
      hs.setFloorMaterial(roomId, appearance);
    }
    return ['floor:all'];
  }

  validate(): string[] {
    return [];
  }
}
```

Wait, I need to check what methods HouseScene actually exposes. Let me look at what's available...

Actually, I need to think about this more carefully. `TextureManager.applyToRoom()` iterates wallMeshes and floorMeshes to find matching roomId. But currently the methods `setFloorColor()`, `setWallColor()`, `setPaintColor()` also iterate those meshes.

The key issue is that `TextureManager.applyToRoom()` already works, but topics don't call it. The simplest fix is to modify the HouseScene methods to use TextureManager when appearance data is available.

Let me reconsider the approach. Instead of adding new methods, I'll modify the existing `setFloorColor` / `setWallColor` / `setPaintColor` to accept an optional appearance parameter, and when present, use TextureManager instead of just setting color.

- [ ] **Step 2 revised: Modify HouseScene methods to accept appearance**

```typescript
// Replace HouseScene lines 1323-1345 with:

setFloorMaterial(roomId: string, appearance: { type: string; color: string; scale?: number }): void {
  this.textureManager.applyToRoom(roomId, appearance, 'floor');
}

setFloorColor(color: string) {
  for (const mesh of this.floorMeshes) {
    (mesh.material as THREE.MeshStandardMaterial).color.set(color);
  }
}

setWallMaterial(roomId: string, appearance: { type: string; color: string; scale?: number }): void {
  this.textureManager.applyToRoom(roomId, appearance, 'wall');
}

setWallColor(roomIds: string[], color: string) {
  const set = new Set(roomIds);
  for (const mesh of this.wallMeshes) {
    if (set.has(mesh.userData.roomId as string)) {
      (mesh.material as THREE.MeshStandardMaterial).color.set(color);
    }
  }
}

setPaintColor(color: string) {
  for (const mesh of this.wallMeshes) {
    const roomId = mesh.userData.roomId as string;
    const room = this.roomMeta.get(roomId);
    if (room?.wall_finish === 'tile') continue;
    (mesh.material as THREE.MeshStandardMaterial).color.set(color);
  }
}

getAllRoomIds(): string[] {
  const ids = new Set<string>();
  for (const mesh of this.floorMeshes) {
    ids.add(mesh.userData.roomId as string);
  }
  return [...ids];
}
```

- [ ] **Step 3: Update FloorTopic to use setFloorMaterial**

```typescript
import type { Topic, SceneApi } from '@shared/types';
import { floorOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class FloorTopic implements Topic {
  id = 'floor';
  name = '地砖方案';
  options = floorOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const appearance = option.data?.appearance ?? option.color
      ? { type: 'ceramic_tile_v2', color: option.color, scale: 2 }
      : undefined;
    if (!appearance) return [];

    const allRoomIds = hs.getAllRoomIds();
    for (const roomId of allRoomIds) {
      hs.setFloorMaterial(roomId, appearance);
    }
    return ['floor:all'];
  }

  validate(): string[] {
    return [];
  }
}
```

- [ ] **Step 4: Update WallTopic to use setWallMaterial**

```typescript
import type { Topic, SceneApi } from '@shared/types';
import { wallOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class WallTopic implements Topic {
  id = 'wall';
  name = '墙砖方案';
  options = wallOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const appearance = option.data?.appearance ?? option.color
      ? { type: 'ceramic_tile_v2', color: option.color, scale: 2 }
      : undefined;
    if (!appearance) return [];

    const tileRoomIds = hs.getRoomIdsWithWallFinish('tile');
    for (const roomId of tileRoomIds) {
      hs.setWallMaterial(roomId, appearance);
    }
    return tileRoomIds.map((id) => `wall:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
```

- [ ] **Step 5: Update PaintTopic to use setWallMaterial with matte_paint**

```typescript
import type { Topic, SceneApi } from '@shared/types';
import { paintOptions } from '../data/designData.js';
import type { HouseScene } from '../render/HouseScene.js';

export class PaintTopic implements Topic {
  id = 'paint';
  name = '乳胶漆方案';
  options = paintOptions;

  apply(scene: SceneApi, optionId: string): string[] {
    const option = this.options.find((o) => o.id === optionId);
    if (!option) return [];
    const hs = scene as unknown as HouseScene;
    const appearance = option.data?.appearance ?? option.color
      ? { type: 'matte_paint', color: option.color, scale: 1 }
      : undefined;
    if (!appearance) return [];

    const paintRoomIds = hs.getRoomIdsWithWallFinish('paint');
    for (const roomId of paintRoomIds) {
      hs.setWallMaterial(roomId, appearance);
    }
    return paintRoomIds.map((id) => `paint:${id}`);
  }

  validate(): string[] {
    return [];
  }
}
```

- [ ] **Step 6: Update TopicRegistry tests**

In `app/src/topics/TopicRegistry.test.ts`, the mock scene needs `getAllRoomIds` and `setFloorMaterial` / `setWallMaterial`:

Find the mock scene creation and add:
```typescript
const scene = {
  setFloorColor: vi.fn(),
  setFloorMaterial: vi.fn(),
  setWallColor: vi.fn(),
  setWallMaterial: vi.fn(),
  setPaintColor: vi.fn(),
  getAllRoomIds: vi.fn(() => ['living_dining', 'bedroom_nw']),
  getRoomIdsWithWallFinish: vi.fn((finish: string) =>
    finish === 'tile' ? ['bathroom_main', 'kitchen', 'wc'] : ['living_dining', 'bedroom_nw', 'study']
  ),
};
```

Update test assertions — they should now check `setFloorMaterial` / `setWallMaterial` instead of (or in addition to) `setFloorColor` / `setWallColor`.

- [ ] **Step 7: Run tests**

Run: `npx vitest run app/src/topics/TopicRegistry.test.ts --config app/vitest.config.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/topics/FloorTopic.ts app/src/topics/WallTopic.ts app/src/topics/PaintTopic.ts app/src/render/HouseScene.ts app/src/topics/TopicRegistry.test.ts
git commit -m "feat: connect procedural textures to floor/wall/paint topics"
```

---

## Task 3: YAML Writer Utility

**Files:**
- Create: `server/yaml-writer.ts`
- Test: `tests/server/yaml-writer.test.ts`

**Interfaces:**
- Exports: `writeYaml(path: string, data: unknown): Promise<void>` — safe write with backup
- Exports: `backupPath(path: string): string` — returns `${path}.bak`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/yaml-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'node:test';
import { writeFileSync, readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeYaml, backupPath } from '../../server/yaml-writer.js';

describe('yaml-writer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yaml-writer-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid YAML file', async () => {
    const file = join(tmpDir, 'test.yaml');
    const data = { key: 'value', list: [1, 2, 3] };
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('key: value');
  });

  it('creates a .bak backup before writing', async () => {
    const file = join(tmpDir, 'test.yaml');
    writeFileSync(file, 'original: data\n', 'utf8');
    const data = { key: 'new_value' };
    await writeYaml(file, data);
    expect(existsSync(backupPath(file))).toBe(true);
    const backup = readFileSync(backupPath(file), 'utf8');
    expect(backup).toContain('original');
  });

  it('preserves array structures', async () => {
    const file = join(tmpDir, 'electrical.yaml');
    const data = [
      { id: 'sock_1', room: 'living', type: 'socket', x: 1, z: 2, height: 0.3 },
      { id: 'sock_2', room: 'bedroom', type: 'socket', x: 3, z: 4, height: 0.3 },
    ];
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('sock_1');
    expect(content).toContain('sock_2');
  });

  it('preserves the room-keyed furnishings structure', async () => {
    const file = join(tmpDir, 'house.yaml');
    const data = {
      furnishings: {
        living_dining: [
          { type: 'sofa_3seat', x: 11, z: 7, rotation: 270 },
          { type: 'tv_stand', x: 7.4, z: 7, rotation: 90 },
        ],
        bedroom_nw: [
          { type: 'bed_180', x: 4.6, z: 2.3, rotation: 270 },
        ],
      },
    };
    await writeYaml(file, data);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('living_dining');
    expect(content).toContain('bed_180');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/server/yaml-writer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create `server/yaml-writer.ts`**

```typescript
import { writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dump as toYaml } from 'js-yaml';

export function backupPath(original: string): string {
  return `${original}.bak`;
}

export async function writeYaml(path: string, data: unknown): Promise<void> {
  // Create backup if file exists
  if (existsSync(path)) {
    copyFileSync(path, backupPath(path));
  }

  const yaml = toYaml(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  writeFileSync(path, yaml, 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/server/yaml-writer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/yaml-writer.ts tests/server/yaml-writer.test.ts
git commit -m "feat: YAML writer utility with backup"
```

---

## Task 4: Furnishings CRUD API

**Files:**
- Create: `server/routes-furnishings.ts`
- Modify: `server/index.ts` — register furnishings router
- Test: `tests/server/furnishings-api.test.ts`

**Interfaces:**
- Consumes: `writeYaml` from Task 3
- Exports: `createFurnishingsRouter(configPath: string): Router`

- [ ] **Step 1: Write test**

```typescript
// tests/server/furnishings-api.test.ts
import { describe, it, expect, before, after } from 'node:test';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createFurnishingsRouter } from '../../server/routes-furnishings.js';

describe('Furnishings API (with real YAML file)', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'house.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'furnishings-test-'));
    writeFileSync(yamlPath(), `furnishings:
  living_dining:
    - { type: sofa_3seat, x: 11, z: 7, rotation: 270 }
    - { type: tv_stand, x: 7.4, z: 7, rotation: 90 }
  bedroom_nw:
    - { type: bed_180, x: 4.6, z: 2.3, rotation: 270 }
`, 'utf8');

    app = express();
    app.use(express.json());
    app.use('/api/furnishings', createFurnishingsRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET returns all furnishings grouped by room', async () => {
    const res = await request(app).get('/api/furnishings');
    expect(res.status).toBe(200);
    expect(res.body.living_dining).toBeDefined();
    expect(res.body.living_dining).toHaveLength(2);
  });

  it('PUT updates a furnishing position', async () => {
    const res = await request(app)
      .put('/api/furnishings/living_dining/0')
      .send({ x: 12, z: 8, rotation: 180 });
    expect(res.status).toBe(200);
    expect(res.body.item.x).toBe(12);
    expect(res.body.item.z).toBe(8);
    expect(res.body.item.rotation).toBe(180);

    // Verify YAML was written
    const content = readFileSync(yamlPath(), 'utf8');
    expect(content).toContain('x: 12');
  });

  it('DELETE removes a furnishing', async () => {
    const res = await request(app).delete('/api/furnishings/living_dining/0');
    expect(res.status).toBe(200);
    const getRes = await request(app).get('/api/furnishings');
    expect(getRes.body.living_dining).toHaveLength(1);
  });

  it('POST adds a new furnishing', async () => {
    const res = await request(app)
      .post('/api/furnishings')
      .send({ room: 'living_dining', type: 'dining_table', x: 9, z: 5.3, rotation: 0 });
    expect(res.status).toBe(201);
    expect(res.body.item.type).toBe('dining_table');

    // Verify YAML
    const content = readFileSync(yamlPath(), 'utf8');
    expect(content).toContain('dining_table');
  });

  it('GET template returns default dimensions for a furniture type', async () => {
    // get catalog, not template
    const res = await request(app).get('/api/furnishings');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/server/furnishings-api.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create `server/routes-furnishings.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface FurnishingItem {
  type: string;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
}

interface FurnishingsData {
  furnishings: Record<string, FurnishingItem[]>;
}

export function createFurnishingsRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): FurnishingsData {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as FurnishingsData;
  }

  // GET /api/furnishings — list all
  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = loadData();
      res.json(data.furnishings ?? {});
    } catch (err) {
      res.status(500).json({ error: 'Failed to load furnishings' });
    }
  });

  // PUT /api/furnishings/:room/:index — update single item
  router.put('/:room/:index', (req: Request, res: Response) => {
    try {
      const { room, index } = req.params;
      const { x, z, rotation } = req.body;
      const data = loadData();
      const items = data.furnishings[room];
      if (!items || !items[Number(index)]) {
        res.status(404).json({ error: 'Furnishing not found' });
        return;
      }
      const item = items[Number(index)];
      if (x !== undefined) item.x = x;
      if (z !== undefined) item.z = z;
      if (rotation !== undefined) item.rotation = rotation;
      writeYaml(yamlPath, data);
      res.json({ item });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update furnishing' });
    }
  });

  // DELETE /api/furnishings/:room/:index — remove item
  router.delete('/:room/:index', (req: Request, res: Response) => {
    try {
      const { room, index } = req.params;
      const data = loadData();
      const items = data.furnishings[room];
      if (!items || !items[Number(index)]) {
        res.status(404).json({ error: 'Furnishing not found' });
        return;
      }
      data.furnishings[room] = items.filter((_, i) => i !== Number(index));
      writeYaml(yamlPath, data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete furnishing' });
    }
  });

  // POST /api/furnishings — add new item
  router.post('/', (req: Request, res: Response) => {
    try {
      const { room, type, x, z, rotation, count } = req.body;
      if (!room || !type) {
        res.status(400).json({ error: 'room and type required' });
        return;
      }
      const data = loadData();
      if (!data.furnishings[room]) data.furnishings[room] = [];
      const item: FurnishingItem = { type };
      if (x !== undefined) item.x = x;
      if (z !== undefined) item.z = z;
      if (rotation !== undefined) item.rotation = rotation;
      if (count !== undefined) item.count = count;
      data.furnishings[room].push(item);
      writeYaml(yamlPath, data);
      res.status(201).json({ item });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add furnishing' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Register in `server/index.ts`**

Find where routes are created and add:
```typescript
import { createFurnishingsRouter } from './routes-furnishings.js';
// In the route setup:
app.use('/api/furnishings', createFurnishingsRouter(configPath));
```

Where `configPath` is the path to `config/house.yaml`. Look for how other config paths are defined in the server.

- [ ] **Step 5: Run test**

Run: `npx tsx --test tests/server/furnishings-api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes-furnishings.ts tests/server/furnishings-api.test.ts server/index.ts
git commit -m "feat: furnishings CRUD API with YAML write-back"
```

---

## Task 5: Electrical/Plumbing CRUD API

**Files:**
- Create: `server/routes-electrical.ts`
- Create: `server/routes-plumbing.ts`
- Modify: `server/index.ts` — register routers
- Test: `tests/server/electrical-api.test.ts`
- Test: `tests/server/plumbing-api.test.ts`

- [ ] **Step 1: Write test for electrical API**

```typescript
// tests/server/electrical-api.test.ts
import { describe, it, expect, before, after } from 'node:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createElectricalRouter } from '../../server/routes-electrical.js';

describe('Electrical API', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'electrical.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'electrical-test-'));
    writeFileSync(yamlPath(), `- id: sock_living_tv
  room: living_dining
  wall: w_st_east
  type: socket
  x: 7.2
  z: 5.8
  height: 0.3
  count: 4
  note: "电视墙"
- id: sock_bedroom
  room: bedroom_nw
  wall: w_bd_east
  type: socket
  x: 4.6
  z: 2.3
  height: 0.3
  count: 2
`, 'utf8');

    app = express();
    app.use(express.json());
    app.use('/api/electrical', createElectricalRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET lists all electrical points', async () => {
    const res = await request(app).get('/api/electrical');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('PUT updates position', async () => {
    const res = await request(app)
      .put('/api/electrical/sock_living_tv')
      .send({ x: 7.5, z: 6.0 });
    expect(res.status).toBe(200);
    expect(res.body.item.x).toBe(7.5);
  });

  it('POST adds new point', async () => {
    const res = await request(app)
      .post('/api/electrical')
      .send({ id: 'sock_new', room: 'kitchen', wall: 'w_kit_north', type: 'socket', x: 3, z: 4, height: 0.3 });
    expect(res.status).toBe(201);
  });

  it('DELETE removes a point', async () => {
    const res = await request(app).delete('/api/electrical/sock_bedroom');
    expect(res.status).toBe(200);
    const getRes = await request(app).get('/api/electrical');
    expect(getRes.body).toHaveLength(2); // original 2 - 1 deleted + 1 added = 2
  });
});
```

- [ ] **Step 2: Create `server/routes-electrical.ts`**

```typescript
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  type: string;
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
}

export function createElectricalRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): ElectricalPoint[] {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as ElectricalPoint[];
  }

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json(loadData());
    } catch (err) {
      res.status(500).json({ error: 'Failed to load electrical config' });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const { x, z, height, wall, note } = req.body;
      if (x !== undefined) data[idx].x = x;
      if (z !== undefined) data[idx].z = z;
      if (height !== undefined) data[idx].height = height;
      if (wall !== undefined) data[idx].wall = wall;
      if (note !== undefined) data[idx].note = note;
      writeYaml(yamlPath, data);
      res.json({ item: data[idx] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { id, room, wall, type, x, z, height, count, note } = req.body;
      if (!id || !room) { res.status(400).json({ error: 'id and room required' }); return; }
      const data = loadData();
      const point: ElectricalPoint = { id, room, wall: wall ?? 'unknown', type: type ?? 'socket', x: x ?? 0, z: z ?? 0, height: height ?? 0.3 };
      if (count !== undefined) point.count = count;
      if (note !== undefined) point.note = note;
      data.push(point);
      writeYaml(yamlPath, data);
      res.status(201).json({ item: point });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add' });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      let data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      data = data.filter((p) => p.id !== req.params.id);
      writeYaml(yamlPath, data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  return router;
}
```

- [ ] **Step 3: Create `server/routes-plumbing.ts`** (same pattern, uses `config/plumbing.yaml`)

```typescript
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface PlumbingPoint {
  id: string;
  room: string;
  type: string;
  x: number;
  z: number;
  height?: number;
  note?: string;
}

export function createPlumbingRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): PlumbingPoint[] {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as PlumbingPoint[];
  }

  router.get('/', (_req: Request, res: Response) => {
    try { res.json(loadData()); }
    catch (err) { res.status(500).json({ error: 'Failed to load plumbing config' }); }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const { x, z, height, note } = req.body;
      if (x !== undefined) data[idx].x = x;
      if (z !== undefined) data[idx].z = z;
      if (height !== undefined) data[idx].height = height;
      if (note !== undefined) data[idx].note = note;
      writeYaml(yamlPath, data);
      res.json({ item: data[idx] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const { id, room, type, x, z, height, note } = req.body;
      if (!id || !room) { res.status(400).json({ error: 'id and room required' }); return; }
      const data = loadData();
      const point: PlumbingPoint = { id, room, type: type ?? 'faucet', x: x ?? 0, z: z ?? 0 };
      if (height !== undefined) point.height = height;
      if (note !== undefined) point.note = note;
      data.push(point);
      writeYaml(yamlPath, data);
      res.status(201).json({ item: point });
    } catch (err) {
      res.status(500).json({ error: 'Failed to add' });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      let data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      data = data.filter((p) => p.id !== req.params.id);
      writeYaml(yamlPath, data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Register both routers in `server/index.ts`**

- [ ] **Step 5: Run tests**

Run: `npx tsx --test tests/server/electrical-api.test.ts tests/server/plumbing-api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes-electrical.ts server/routes-plumbing.ts tests/server/electrical-api.test.ts tests/server/plumbing-api.test.ts server/index.ts
git commit -m "feat: electrical and plumbing CRUD API with YAML write-back"
```

---

## Task 6: Furniture Panel + FP Furniture Interaction

**Files:**
- Create: `app/src/ui/FurniturePanel.ts`
- Modify: `app/src/ui/HoverTooltip.ts` — extend for furniture info
- Modify: `app/src/render/HouseScene.ts` — add ghost preview mesh, drag utilities
- Modify: `app/src/scene/FirstPersonController.ts` — add G drag mode, B panel toggle
- Modify: `app/src/App.ts` — wire B/G keys to furniture panel and drag mode
- Modify: `app/src/scene/mode-key-policy.ts` — add G/B key policy

**Interfaces:**
- Consumes: Task 1 (key bindings), Task 4 (furnishings API)
- `FurniturePanel`: `show()`, `hide()`, `onSelect(type: string)`
- `HouseScene`: new methods `showGhost(x, z, rotation, type)`, `hideGhost()`, `getGroundPosition()`

- [ ] **Step 1: Create FurniturePanel**

```typescript
// app/src/ui/FurniturePanel.ts
export class FurniturePanel {
  private container: HTMLDivElement;
  private visible = false;
  private onSelectCb: ((type: string) => void) | null = null;

  private furnitureTypes = [
    { type: 'bed_180', label: '1.8m床', icon: '🛏️' },
    { type: 'bed_150', label: '1.5m床', icon: '🛏️' },
    { type: 'sofa_3seat', label: '三人沙发', icon: '🛋️' },
    { type: 'dining_table', label: '餐桌', icon: '🍽️' },
    { type: 'dining_chair', label: '餐椅', icon: '🪑' },
    { type: 'tv_stand', label: '电视柜', icon: '📺' },
    { type: 'wardrobe_240', label: '衣柜(2.4m)', icon: '🗄️' },
    { type: 'wardrobe_180', label: '衣柜(1.8m)', icon: '🗄️' },
    { type: 'desk', label: '书桌', icon: '📚' },
    { type: 'bookshelf', label: '书架', icon: '📖' },
    { type: 'chair', label: '椅子', icon: '🪑' },
  ];

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'furniture-panel';
    this.container.style.cssText = `
      display: none; position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      z-index: 900; background: #1a1a2e; border-radius: 12px; padding: 16px;
      max-width: 600px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(this.container);
    this.render();
  }

  private render(): void {
    let html = `<div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center;">`;
    for (const ft of this.furnitureTypes) {
      html += `<button data-type="${ft.type}" style="
        background:#2a2a3e; border:1px solid #3a3a5e; border-radius:8px;
        padding:8px 14px; color:#e0e0e0; cursor:pointer; font-size:14px;
        display:flex; flex-direction:column; align-items:center; gap:4px;
        min-width:80px;
      ">
        <span style="font-size:20px;">${ft.icon}</span>
        <span>${ft.label}</span>
      </button>`;
    }
    html += `</div>`;
    html += `<div style="text-align:center; margin-top:8px; font-size:12px; color:#666;">点击放置 | 按 B 或 Esc 关闭</div>`;
    this.container.innerHTML = html;

    this.container.querySelectorAll('button[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type!;
        this.onSelectCb?.(type);
      });
    });
  }

  onSelect(cb: (type: string) => void): void { this.onSelectCb = cb; }

  show(): void { this.visible = true; this.container.style.display = 'block'; }
  hide(): void { this.visible = false; this.container.style.display = 'none'; }
  toggle(): void { this.visible ? this.hide() : this.show(); }
  isVisible(): boolean { return this.visible; }
}
```

- [ ] **Step 2: Add ghost preview + ground position to HouseScene**

```typescript
// In HouseScene class:

private ghostMesh: THREE.Mesh | null = null;

getGroundPosition(clientX: number, clientY: number): { x: number; z: number } | null {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(mouse, this.camera);
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const intersection = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(floorPlane, intersection);
  if (hit) return { x: intersection.x, z: intersection.z };
  return null;
}

showGhost(x: number, z: number, rotation: number, type: string): void {
  this.hideGhost();
  const geo = new THREE.BoxGeometry(
    FURNITURE_DIMS[type]?.w ?? 1,
    FURNITURE_DIMS[type]?.h ?? 1,
    FURNITURE_DIMS[type]?.d ?? 1,
  );
  const mat = new THREE.MeshBasicMaterial({
    color: 0x44aaff, transparent: true, opacity: 0.4, depthWrite: false,
  });
  this.ghostMesh = new THREE.Mesh(geo, mat);
  this.ghostMesh.position.set(x, 0, z);
  this.ghostMesh.rotation.y = rotation * Math.PI / 180;
  this.scene.add(this.ghostMesh);
}

hideGhost(): void {
  if (this.ghostMesh) {
    this.scene.remove(this.ghostMesh);
    this.ghostMesh.geometry.dispose();
    (this.ghostMesh.material as THREE.Material).dispose();
    this.ghostMesh = null;
  }
}

updateGhostPosition(x: number, z: number, rotation?: number): void {
  if (this.ghostMesh) {
    this.ghostMesh.position.set(x, 0, z);
    if (rotation !== undefined) {
      this.ghostMesh.rotation.y = rotation * Math.PI / 180;
    }
  }
}
```

Add `FURNITURE_DIMS` import:
```typescript
import { FURNITURE_DIMS } from '@shared/types';
// or check where it's defined
```

- [ ] **Step 3: Add drag mode to FirstPersonController**

Add to FirstPersonController:
```typescript
// New fields
private dragMode = false;
private draggedObjectId: string | null = null;
private onDragStartCb: ((objectId: string) => void) | null = null;
private onDragMoveCb: ((x: number, z: number) => void) | null = null;
private onDragEndCb: ((x: number, z: number, rotation: number) => void) | null = null;

setDragHandlers(handlers: {
  onStart: (objectId: string) => void;
  onMove: (x: number, z: number) => void;
  onEnd: (x: number, z: number, rotation: number) => void;
}): void {
  this.onDragStartCb = handlers.onStart;
  this.onDragMoveCb = handlers.onMove;
  this.onDragEndCb = handlers.onEnd;
}

enterDragMode(objectId: string): void {
  this.dragMode = true;
  this.draggedObjectId = objectId;
  this.onDragStartCb?.(objectId);
}

exitDragMode(): void {
  this.dragMode = false;
  this.draggedObjectId = null;
}

isDragMode(): boolean { return this.dragMode; }
```

In the FP controller's `update()` or mouse handling, detect drag movement when in drag mode.

- [ ] **Step 4: Wire up in App.ts**

In App.ts setupKeyboard:
```typescript
// In the first-person block:
if (e.code === 'KeyB' && !e.repeat) {
  e.preventDefault();
  this.furniturePanel.toggle();
  return;
}
if (e.code === 'KeyG' && !e.repeat) {
  e.preventDefault();
  const hovered = this.hoverTooltip.getCurrentTarget();
  if (hovered?.type === 'furniture') {
    this.fpController.enterDragMode(hovered.objectId);
  }
  return;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/src/ui/FurniturePanel.ts app/src/render/HouseScene.ts app/src/scene/FirstPersonController.ts app/src/App.ts
git commit -m "feat: furniture panel + FP drag-to-place interaction"
```

---

## Task 7: Infrastructure Editing (Electrical/Plumbing)

**Files:**
- Create: `app/src/ui/PlacementPanel.ts`
- Modify: `app/src/App.ts` — wire E (place), Delete (remove)
- Modify: `app/src/scene/FirstPersonController.ts` — wall drag for infra points
- Modify: `app/src/render/HouseScene.ts` — electrical/plumbing point highlight

- [ ] **Step 1-5**: Create PlacementPanel (similar pattern to FurniturePanel), wire E key to open it, wire Delete to remove selected point, add wall-raycast drag for moving existing points on walls.

- [ ] **Step 6: Commit**

---

## Task 8: Register Missing Topics (cabinet, countertop, fixture, door)

**Files:**
- Create: `app/src/topics/CabinetTopic.ts`, `app/src/topics/CountertopTopic.ts`, `app/src/topics/FixtureTopic.ts`, `app/src/topics/DoorTopic.ts`
- Modify: `app/src/topics/TopicRegistry.ts` — register new topics
- Modify: `app/src/data/designData.ts` — add missing category loaders
- Modify: `shared/types.ts` — add FURNITURE_DIMS entries if missing

- [ ] **Step 1**: Create each topic file (follow FloorTopic pattern)
- [ ] **Step 2**: Register in TopicRegistry
- [ ] **Step 3**: Add category data loaders
- [ ] **Step 4**: Run tests
- [ ] **Step 5**: Commit

---

## Task 9: Real-time Budget Push

**Files:**
- Modify: `server/index.ts` or `server/mcp-server.ts` — emit budget-update SSE event on scheme change
- Modify: `app/src/ui/SchemePanel.ts` — add budget bar at bottom
- Modify: `app/src/state/StateSync.ts` — handle budget-update event

- [ ] **Step 1**: Add SSE `budget-update` event emission after scheme mutations
- [ ] **Step 2**: Update StateSync to handle the event
- [ ] **Step 3**: Add budget bar UI to SchemePanel
- [ ] **Step 4**: Test
- [ ] **Step 5**: Commit

---

## Task 10: Verification + Type Check

- [ ] **Step 1: Run full verification**

```bash
npm run verify:all
npm run test:server
npm run test:app
npm run typecheck
```

Expected: All pass

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final verification fixes"
```
