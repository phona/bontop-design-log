# First-Person Hover Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the first-person crosshair hover tooltip from snapping to the invisible room-label plane, so the user can aim at walls, floors, and topic objects instead.

**Architecture:** Mark the room label mesh with `hoverable: false`, add an optional `hoverableOnly` filter to `HouseScene.raycastFromScreenCenter()`, and use that filter in the first-person render loop. Orbit-mode clicks remain unchanged.

**Tech Stack:** TypeScript, Vite, Vitest, Three.js (mocked in tests), jsdom.

## Global Constraints

- TypeScript `strict: true` in both root and `app/`.
- No changes to movement speed, collision detection, camera transitions, or UI panels.
- Orbit-mode click behavior must remain unchanged.
- All changes must be committed to Git with clear messages.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `app/src/render/HouseScene.ts` | Creates room labels and performs crosshair raycasts | Add `hoverable: false` to room label; add `hoverableOnly` filter to `raycastFromScreenCenter()` |
| `app/src/App.ts` | Runs the render loop and updates the hover tooltip in first-person mode | Pass `{ hoverableOnly: true }` to `raycastFromScreenCenter()` in first-person mode |
| `app/src/scene/HouseScene.test.ts` | Tests for HouseScene | Add tests that verify the room label is non-hoverable and that `raycastFromScreenCenter({ hoverableOnly: true })` skips it |

---

### Task 1: Filter Room Labels from First-Person Hover Raycast

**Files:**
- Modify: `app/src/render/HouseScene.ts:226`
- Modify: `app/src/render/HouseScene.ts:387-402`
- Modify: `app/src/App.ts:360`
- Modify: `app/src/scene/HouseScene.test.ts`

**Interfaces:**
- Consumes: Existing `HouseScene.raycastFromScreenCenter()` returning `HoverTarget | null`.
- Produces: `HouseScene.raycastFromScreenCenter(options?: { hoverableOnly?: boolean })` returning `HoverTarget | null`; first-person render loop uses `hoverableOnly: true`.

- [ ] **Step 1: Mark the room label as non-hoverable**

In `app/src/render/HouseScene.ts`, locate the `roomLabel` creation inside `createRoom()`:

```ts
const roomLabel = new THREE.Mesh(
  new THREE.PlaneGeometry(r.width, r.depth),
  new THREE.MeshBasicMaterial({ visible: false })
);
roomLabel.userData = { objectId: `room:${r.id}` };
```

Change to:

```ts
roomLabel.userData = { objectId: `room:${r.id}`, hoverable: false };
```

- [ ] **Step 2: Add `hoverableOnly` filter to `raycastFromScreenCenter()`**

In `app/src/render/HouseScene.ts`, replace the current method with:

```ts
raycastFromScreenCenter(options?: { hoverableOnly?: boolean }): HoverTarget | null {
  const { hoverableOnly = false } = options ?? {};
  this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
  const intersects = this.raycaster.intersectObjects(this.scene.children, true);
  for (const hit of intersects) {
    const data = hit.object.userData;
    if (hoverableOnly && data?.hoverable === false) continue;
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

- [ ] **Step 3: Use filtered raycast in first-person mode**

In `app/src/App.ts`, locate the render-loop block:

```ts
if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
  this.fpController.update(dt);
  const target = this.houseScene.raycastFromScreenCenter();
  this.hoverTooltip.update(target);
}
```

Change to:

```ts
if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
  this.fpController.update(dt);
  const target = this.houseScene.raycastFromScreenCenter({ hoverableOnly: true });
  this.hoverTooltip.update(target);
}
```

- [ ] **Step 4: Write a test for the room label hoverable flag**

In `app/src/scene/HouseScene.test.ts`, add a test after the existing tests:

```ts
it('marks room label as non-hoverable', async () => {
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const scene = new HouseScene(canvas);

  const projectData = {
    house: {
      rooms: [
        { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
      ],
    },
    topics: [],
    budgetCategories: [],
  };
  await scene.buildFromCatalog(projectData);

  let roomLabelHoverable: boolean | undefined = undefined;
  scene.getScene().traverse((obj: any) => {
    if (obj.userData?.objectId === 'room:test_room') {
      roomLabelHoverable = obj.userData.hoverable;
    }
  });
  expect(roomLabelHoverable).toBe(false);
});
```

- [ ] **Step 5: Write a test for hoverableOnly filtering**

In `app/src/scene/HouseScene.test.ts`, add a test that verifies the filter. The mock Raycaster returns `[]` by default, so override it for this test:

```ts
it('raycastFromScreenCenter with hoverableOnly skips non-hoverable objects', async () => {
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const scene = new HouseScene(canvas);

  const projectData = {
    house: {
      rooms: [
        { id: 'test_room', name: 'Test', x: 0, z: 0, width: 3, depth: 3, height: 3, type: 'public' },
      ],
    },
    topics: [],
    budgetCategories: [],
  };
  await scene.buildFromCatalog(projectData);

  // Mock the raycaster to return a room label first, then a wall
  const mockedThree = await import('three');
  const originalRaycaster = mockedThree.Raycaster;
  let callIndex = 0;
  (mockedThree as any).Raycaster = class {
    setFromCamera() {}
    intersectObjects() {
      return [
        { object: { userData: { objectId: 'room:test_room', hoverable: false } } },
        { object: { userData: { objectId: 'wall:test_room:north', part: 'wall', roomId: 'test_room' } } },
      ];
    }
  };

  const withoutFilter = scene.raycastFromScreenCenter();
  expect(withoutFilter?.objectId).toBe('room:test_room');

  const withFilter = scene.raycastFromScreenCenter({ hoverableOnly: true });
  expect(withFilter?.objectId).toBe('wall:test_room:north');

  (mockedThree as any).Raycaster = originalRaycaster;
});
```

If the test fails due to import timing (the mock is already established before the test body runs), use the Vitest `vi.doMock` pattern or inspect the scene's actual raycaster property directly. The key assertion is: with `hoverableOnly: true`, the returned `objectId` is not `room:test_room`.

- [ ] **Step 6: Run the app tests**

```bash
cd app && npm run test
```

Expected: all tests pass, including the two new ones.

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/render/HouseScene.ts app/src/App.ts app/src/scene/HouseScene.test.ts
git commit -m "fix(first-person): filter room labels from hover raycast"
```

---

## Spec Coverage Check

| Spec Section | Task | Step |
|--------------|------|------|
| Mark room label as non-hoverable | Task 1 | Step 1 |
| Add `hoverableOnly` filter to raycast | Task 1 | Step 2 |
| Use filtered raycast in first-person mode | Task 1 | Step 3 |
| Preserve orbit-mode clicks | Task 1 | (implicit: `onPointerDown` unchanged) |
| Tests | Task 1 | Steps 4-5 |
| Verification | Task 1 | Steps 6-7 |

## Placeholder Scan

- No TBD/TODO/fill-in details.
- No vague "add tests" without test code.
- All code blocks contain actual TypeScript.
- Exact commands with expected output.

## Type Consistency Check

- `raycastFromScreenCenter` signature changes from `(): HoverTarget | null` to `(options?: { hoverableOnly?: boolean }): HoverTarget | null`; the existing call in `App.ts` is updated to pass the new option.
- `App.ts` render loop continues to call `this.hoverTooltip.update(target)` with the same type.
- Room label `userData` gains a new `hoverable` boolean property without breaking existing consumers.
