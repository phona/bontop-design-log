import assert from 'node:assert/strict';
import test from 'node:test';
import { baySillBbox, buildBaySillGeometry } from '../../../shared/render/BaySillGeometry.js';
import type { ResolvedRoom } from '../../../shared/types.js';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlay } from '../../../server/overlay-merge.js';

const room = (id: string, x: number, z: number, width: number, depth: number): ResolvedRoom => ({ id, name: id, x, z, width, depth, height: 2.8, type: 'private', boundary_count: 4 });

test('bay sill expands a south wall inward (into the room) by the full depth', () => {
  // 上飘窗收敛到户型内部：南墙飘窗占用室内南侧条带 z 8.7..9.8，不向室外凸出
  const geometry = buildBaySillGeometry([{ wallId: 'south', rooms: ['r'], segments: [{ wallId: 'south', rooms: ['r'], x1: 0, z1: 9.8, x2: 4.2, z2: 9.8 }] }], [room('r', 2.1, 7, 4.2, 5.6)], 1.1);
  const box = baySillBbox(geometry);
  assert.ok(Math.abs(box.minX - 0) < 1e-6 && Math.abs(box.maxX - 4.2) < 1e-6, JSON.stringify(box));
  assert.ok(Math.abs(box.minZ - 8.7) < 1e-6 && Math.abs(box.maxZ - 9.8) < 1e-6, JSON.stringify(box));
});

test('bay sill expands north/east/west walls inward by the full depth', () => {
  const cases = [
    { id: 'north', segment: { x1: 0, z1: 0, x2: 4, z2: 0 }, r: room('r', 2, 2, 4, 4), expected: { minX: 0, maxX: 4, minZ: 0, maxZ: 1.1 } },
    { id: 'east', segment: { x1: 4, z1: 0, x2: 4, z2: 4 }, r: room('r', 2, 2, 4, 4), expected: { minX: 2.9, maxX: 4, minZ: 0, maxZ: 4 } },
    { id: 'west', segment: { x1: 0, z1: 4, x2: 0, z2: 0 }, r: room('r', 2, 2, 4, 4), expected: { minX: 0, maxX: 1.1, minZ: 0, maxZ: 4 } },
  ] as const;
  for (const item of cases) {
    const geometry = buildBaySillGeometry([{ wallId: item.id, rooms: ['r'], segments: [{ wallId: item.id, rooms: ['r'], ...item.segment }] }], [item.r], 1.1);
    const box = baySillBbox(geometry);
    for (const key of ['minX', 'maxX', 'minZ', 'maxZ'] as const) {
      assert.ok(Math.abs(box[key] - item.expected[key]) < 1e-6, `${item.id} ${key}: ${JSON.stringify(box)}`);
    }
  }
});

test('bay sill joins an interior corner without leaving the room', () => {
  const geometry = buildBaySillGeometry([
    { wallId: 'west', rooms: ['r'], segments: [{ wallId: 'west', rooms: ['r'], x1: 0, z1: 4, x2: 0, z2: 0 }] },
    { wallId: 'north', rooms: ['r'], segments: [{ wallId: 'north', rooms: ['r'], x1: 0, z1: 0, x2: 4, z2: 0 }] },
  ], [room('r', 2, 2, 4, 4)], 1.1);
  const box = baySillBbox(geometry);
  // 收敛到室内：西臂 x 0..1.1 + 北臂 z 0..1.1，角部在室内闭合，不越过墙线
  assert.ok(Math.abs(box.minX - 0) < 1e-6, JSON.stringify(box));
  assert.ok(Math.abs(box.maxZ - 4) < 1e-6, JSON.stringify(box));
  assert.ok(geometry.outline.every((point) => point.x >= -1e-6 && point.z >= -1e-6), 'must stay on the room side of the walls');
});

test('bay sill retains arc segments owned by the referenced wall only', () => {
  const geometry = buildBaySillGeometry([{ wallId: 'arc-wall', rooms: ['r'], segments: [
    { wallId: 'arc-wall', rooms: ['r'], x1: 0, z1: 0, x2: 0, z2: 1, kind: 'arc', radius: 1, cx: 1, cz: 1 },
    { wallId: 'arc-wall', rooms: ['r'], x1: 0, z1: 1, x2: 1, z2: 2, kind: 'arc', radius: 1, cx: 1, cz: 1 },
  ] }], [room('r', 2, 2, 4, 4)], 1.1);
  assert.equal(geometry.segments.length, 2);
  assert.ok(geometry.segments.every((segment) => segment.wallId === 'arc-wall'));
});

test('bay sill rejects a source gap instead of mitering across it', () => {
  assert.throws(() => buildBaySillGeometry([{ wallId: 'gap', rooms: ['r'], segments: [
    { wallId: 'gap', rooms: ['r'], x1: 0, z1: 0, x2: 1, z2: 0 },
    { wallId: 'gap', rooms: ['r'], x1: 1.01, z1: 0, x2: 1, z2: 1 },
  ] }], [room('r', 0.5, 0.5, 2, 2)], 1.1), /gap/);
});

test('bay sill accepts a reversed contiguous segment without a diagonal gap', () => {
  const geometry = buildBaySillGeometry([{ wallId: 'corner', rooms: ['r'], segments: [
    { wallId: 'corner', rooms: ['r'], x1: 0, z1: 1, x2: 0, z2: 0 },
    { wallId: 'corner', rooms: ['r'], x1: 1, z1: 0, x2: 0, z2: 0 },
  ] }], [room('r', 0.5, 0.5, 2, 2)], 1.1);
  assert.equal(geometry.segments[1].x1, 0);
  assert.equal(geometry.segments[1].z1, 0);
  assert.equal(geometry.segments[1].x2, 1);
  assert.equal(geometry.segments[1].z2, 0);
});

test('real bay footprints stay within their declared wall spans', () => {
  const layout = resolveLayout(yaml.load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0]);
  const elements = mergeSceneElements(layout.walls, parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
  const bays = elements.filter((element): element is Extract<typeof element, { type: 'bay_sill' }> => element.type === 'bay_sill');
  for (const bay of bays) {
    const geometry = buildBaySillGeometry(bay.wallRefs!, layout.rooms, bay.depth);
    const box = baySillBbox(geometry);
    assert.ok(Number.isFinite(box.minX) && Number.isFinite(box.maxX) && Number.isFinite(box.minZ) && Number.isFinite(box.maxZ), bay.id);
    if (bay.id === 'master_bath_west_bay') {
      // 主卫西北角上飘窗收敛到室内：绕内切圆角（圆心 (1,2.1) r=1）进入主卫，
      // 占 x 0..2.6 / z 1.1..2.2 的室内条带，不越过幕墙墙线（x<0 或 z<1.1）。
      assert.ok(box.minX >= -1e-6 && box.maxX <= 2.6 + 1e-6, JSON.stringify(box));
      assert.ok(box.minZ >= 1.1 - 1e-6 && box.maxZ <= 2.2 + 1e-6, JSON.stringify(box));
      for (const point of geometry.outline) {
        assert.ok(point.x >= -1e-6 && point.x <= 2.6 + 1e-6 && point.z >= 1.1 - 1e-6 && point.z <= 2.86 + 1e-6, `point leaves room: ${JSON.stringify(point)}`);
      }
    }
  }
});
