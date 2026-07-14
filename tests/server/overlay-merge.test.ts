import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import type { WallSegment } from '../../shared/types.js';

const WALLS: WallSegment[] = [
  { x1: -5.88, z1: -3.0, x2: -5.88, z2: 5.0 },
  { x1: 0, z1: 0, x2: 3, z2: 0 },
];

describe('parseOverlay', () => {
  it('parses a valid overlay', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -6.2, z1: -3.5, x2: -5.6, z2: 5.0}
    reason: "幕墙位置残线"
elements:
  - id: west_curtain
    type: curtain_run
    points: [{x: -5.88, z: 4.87}, {x: -5.37, z: -3.36}]
    height: 3.0
`);
    assert.equal(cfg.suppress.length, 1);
    assert.equal(cfg.elements.length, 1);
  });

  it('rejects unknown element type', () => {
    assert.throws(
      () => parseOverlay(`
version: 1
elements:
  - id: x
    type: magic_auto_wall
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`),
      /type/
    );
  });

  it('rejects unknown extra fields (strict)', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: x
    type: curtain_run
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
    auto_detect: true
`)
    );
  });

  it('accepts optional radius on curtain_run points', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: west_curtain
    type: curtain_run
    points:
      - {x: 3.75, z: -4.32}
      - {x: -5.88, z: -4.32, radius: 0.8}
      - {x: -5.88, z: 5.39, radius: 0.8}
      - {x: 3.75, z: 5.39}
`);
    assert.equal(cfg.elements.length, 1);
    const el = cfg.elements[0];
    if (el.type === 'curtain_run') {
      assert.equal(el.points[1].radius, 0.8);
      assert.equal(el.points[2].radius, 0.8);
      assert.equal(el.points[0].radius, undefined);
    }
  });

  it('rejects unknown extra fields on curtain_run point (strict)', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: x
    type: curtain_run
    points: [{x: 0, z: 0, radius: 0.8, foo: 1}]
`)
    );
  });

  it('rejects suppress without reason', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: 0, z1: 0, x2: 1, z2: 1}
`)
    );
  });

  it('accepts closed: true on curtain_run', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: glass_facade
    type: curtain_run
    closed: true
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`);
    assert.equal(cfg.elements.length, 1);
    const el = cfg.elements[0];
    if (el.type === 'curtain_run') assert.equal(el.closed, true);
  });

  it('rejects non-boolean closed on curtain_run', () => {
    assert.throws(() => parseOverlay(`
version: 1
elements:
  - id: x
    type: curtain_run
    closed: "yes"
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`));
  });

  it('rejects floor_region with fewer than 3 points', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: bad_floor
    type: floor_region
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
`)
    );
  });

  it('rejects bay_sill with fewer than 2 points', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: bad_bay
    type: bay_sill
    points: [{x: 0, z: 0}]
    depth: 1.0
    sill: 0.45
    height: 2.55
`)
    );
  });

  it('rejects floor_region with unknown extra fields', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: bad_floor
    type: floor_region
    points: [{x: 0, z: 0}, {x: 1, z: 0}, {x: 1, z: 1}]
    auto_fill: true
`)
    );
  });

  it('accepts optional radius on floor_region points', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: floor_with_radius
    type: floor_region
    points:
      - {x: 0, z: 0}
      - {x: 2, z: 0, radius: 0.5}
      - {x: 2, z: 1}
      - {x: 0, z: 1}
`);
    assert.equal(cfg.elements.length, 1);
    const el = cfg.elements[0];
    if (el.type === 'floor_region') {
      assert.equal(el.points[0].radius, undefined);
      assert.equal(el.points[1].radius, 0.5);
    }
  });

  it('rejects negative radius on floor_region points', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: bad_floor
    type: floor_region
    points: [{x: 0, z: 0}, {x: 1, z: 0, radius: -0.1}, {x: 1, z: 1}]
`)
    );
  });

  it('rejects bay_sill with unknown extra fields', () => {
    assert.throws(() =>
      parseOverlay(`
version: 1
elements:
  - id: bad_bay
    type: bay_sill
    points: [{x: 0, z: 0}, {x: 1, z: 0}]
    depth: 1.0
    sill: 0.45
    height: 2.55
    width: 3.0
`)
    );
  });
});

describe('mergeSceneElements', () => {
  it('undefined overlay → all DXF segments output as wall', () => {
    const out = mergeSceneElements(WALLS, undefined);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((e) => e.type), ['wall', 'wall']);
    assert.equal(out[0].id, 'wall:seg:0');
  });

  it('guard: un-declared boundary wall is always wall', () => {
    const out = mergeSceneElements(WALLS, parseOverlay('version: 1'));
    for (const el of out) assert.equal(el.type, 'wall');
  });

  it('suppress removes segments whose midpoint is inside region', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -6.2, z1: -3.5, x2: -5.6, z2: 5.0}
    reason: "测试"
`);
    const out = mergeSceneElements(WALLS, cfg);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { type: 'wall', id: 'wall:seg:1', x1: 0, z1: 0, x2: 3, z2: 0 });
  });

  it('suppress region coordinate order independent (x1 > x2 works)', () => {
    const cfg = parseOverlay(`
version: 1
suppress:
  - id: s1
    region: {x1: -5.6, z1: 5.0, x2: -6.2, z2: -3.5}
    reason: "测试"
`);
    assert.equal(mergeSceneElements(WALLS, cfg).length, 1);
  });

  it('elements appended to output after validation', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: west_curtain
    type: curtain_run
    points: [{x: -5.88, z: 4.87}, {x: -5.37, z: -3.36}]
  - id: living_glass
    type: glass_infill
    room: living_dining
    wall: south
    width: 3.5
    height: 1.6
`);
    const out = mergeSceneElements(WALLS, cfg);
    assert.equal(out.length, 4);
    const curtain = out.find((e) => e.id === 'west_curtain');
    assert.equal(curtain?.type, 'curtain_run');
    if (curtain?.type === 'curtain_run') assert.equal(curtain.height, 3.0);
    const glass = out.find((e) => e.id === 'living_glass');
    if (glass?.type === 'glass_infill') {
      assert.equal(glass.sill, 0.9);
      assert.equal(glass.center_offset, 0);
    }
  });

  it('accepts floor_region and bay_sill in overlay', () => {
    const cfg = parseOverlay(`
version: 1
elements:
  - id: corridor_floor
    type: floor_region
    points:
      - {x: 0, z: 0}
      - {x: 2, z: 0}
      - {x: 2, z: 1}
      - {x: 0, z: 1}
    room: living_dining
  - id: master_bay
    type: bay_sill
    points:
      - {x: -5.88, z: -0.93}
      - {x: -5.88, z: 4.39}
    depth: 1.10
    sill: 0.45
    height: 2.55
`);
    const out = mergeSceneElements(WALLS, cfg);
    const floor = out.find((e) => e.id === 'corridor_floor');
    assert.equal(floor?.type, 'floor_region');
    if (floor?.type === 'floor_region') {
      assert.equal(floor.room, 'living_dining');
      assert.equal(floor.points.length, 4);
    }
    const bay = out.find((e) => e.id === 'master_bay');
    assert.equal(bay?.type, 'bay_sill');
    if (bay?.type === 'bay_sill') {
      assert.equal(bay.depth, 1.10);
      assert.equal(bay.sill, 0.45);
      assert.equal(bay.height, 2.55);
    }
  });
});
