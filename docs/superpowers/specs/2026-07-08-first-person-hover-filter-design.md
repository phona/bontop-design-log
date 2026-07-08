# Design: Filter Room Labels from First-Person Hover Raycast

## 1. Background

In first-person mode, the user moves around the house with WASD and controls the camera with the mouse. The center of the screen acts as a crosshair. On every frame, `App.renderLoop()` calls `HouseScene.raycastFromScreenCenter()` to detect which object the crosshair is pointing at, and the `HoverTooltip` shows the object name.

The problem: `HouseScene.createRoom()` creates an **invisible room-label plane** that covers the entire room floor:

```ts
const roomLabel = new THREE.Mesh(
  new THREE.PlaneGeometry(r.width, r.depth),
  new THREE.MeshBasicMaterial({ visible: false })
);
roomLabel.userData = { objectId: `room:${r.id}` };
```

Although invisible, the plane still participates in raycasting. Because it is large and close to the floor, the crosshair almost always hits it first. The result is that the hover tooltip "snaps" to a room ID (`room:xxx`) instead of letting the user aim at walls, floors, HVAC units, or other objects.

## 2. Goal

Make the first-person crosshair feel precise: the hover tooltip should only appear when the crosshair is genuinely pointing at a meaningful object, not when it is merely over the room floor.

## 3. Scope

### In scope

- Mark the room-label mesh as non-hoverable.
- Update `HouseScene.raycastFromScreenCenter()` to support an optional `hoverableOnly` filter.
- Use the filtered raycast in first-person mode.
- Keep orbit-mode click behavior unchanged.
- Update/add tests.

### Out of scope

- Changing the first-person movement speed or collision detection.
- Changing the camera transition animation.
- Adding new UI elements.
- Changing the object-mapping or info-panel logic.

## 4. Design

### 4.1 Mark the room label as non-hoverable

In `HouseScene.createRoom()`, change the room label `userData`:

```ts
roomLabel.userData = { objectId: `room:${r.id}`, hoverable: false };
```

### 4.2 Add `hoverableOnly` filter to raycast

Update `HouseScene.raycastFromScreenCenter()`:

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

### 4.3 Use filtered raycast in first-person mode

In `App.renderLoop()`:

```ts
if (this.houseScene.mode === 'first-person' && !this.houseScene.cameraAnimator.isAnimating()) {
  this.fpController.update(dt);
  const target = this.houseScene.raycastFromScreenCenter({ hoverableOnly: true });
  this.hoverTooltip.update(target);
}
```

### 4.4 Preserve orbit-mode clicks

`HouseScene.onPointerDown()` is used for clicking in both orbit and first-person modes. Its behavior remains unchanged: it still returns the first object with an `objectId` or `roomId`, including the room label. This keeps orbit-mode room selection working.

## 5. Behavior

After the change:

- In first-person mode, looking at empty floor/space shows no hover tooltip.
- In first-person mode, the crosshair must be on a wall, floor mesh, HVAC unit, or other topic object to trigger a tooltip.
- In orbit mode, clicking a room floor still opens the room info panel.
- Existing tests continue to pass.
- TypeScript typecheck remains clean.

## 6. Verification

1. Start the app and switch to first-person mode.
2. Aim at the center of a room floor: no tooltip appears.
3. Aim at a wall or HVAC unit: the correct tooltip appears.
4. Switch back to orbit mode and click a room floor: the room info panel opens.
5. Run `npm run test` in `app/`: expect all tests to pass.
6. Run `npm run typecheck` from the root: expect no errors.

## 7. Non-Goals

- No changes to the first-person movement model (speed, acceleration, collision).
- No changes to the crosshair visual design.
- No changes to the info-panel content or layout.
