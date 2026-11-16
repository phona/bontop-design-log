import assert from 'node:assert/strict';
import test from 'node:test';
import { findRouteRetraces, type MepPoint3D } from '../../shared/mep-retrace.js';

const p = (x: number, y: number, z: number): MepPoint3D => ({ x, y, z });

test('相邻段折返：走 0.30m 又折回，检出 1 处、重叠 0.30m（审计 D2 形态）', () => {
  // strong-light-dining 的折点形态：(7.45, z 4.3→4.6→2.7)
  const points = [p(7.45, 2.55, 4.3), p(7.45, 2.55, 4.6), p(7.45, 2.55, 2.7)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.equal(found[0].segmentA, 0);
  assert.equal(found[0].segmentB, 1);
  assert.ok(Math.abs(found[0].overlapM - 0.3) < 1e-9);
  assert.equal(found[0].direction, 'opposite');
});

test('正常转弯与直行续接不报：只交于一点，重叠为 0', () => {
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1)]), []);
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(2, 0, 0)]), []);
  // 平行但不同线（两条走廊轴线）不报
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(0, 0, 2), p(2, 0, 2), p(2, 0, 0)]), []);
});

test('非相邻段同向重走同样检出', () => {
  // S1 在 x=0 上走 z 0→2；绕一圈后 S5 在同一条线上走 z 0→1（同向重走 1m）
  const points = [p(0, 0, 0), p(0, 0, 2), p(2, 0, 2), p(2, 0, 0), p(0, 0, 0), p(0, 0, 1)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.equal(found[0].segmentA, 0);
  assert.equal(found[0].segmentB, 4);
  assert.ok(Math.abs(found[0].overlapM - 1) < 1e-9);
  assert.equal(found[0].direction, 'same');
});

test('零长段（端点重复）跳过，不误报', () => {
  assert.deepEqual(findRouteRetraces([p(0, 0, 0), p(1, 0, 0), p(1, 0, 0), p(1, 0, 1)]), []);
});

test('垂直折返同样检出（strong-light-entry-night-corridor 形态）', () => {
  // (7.45,5.55) 处 y 2.55→2.7→0.3：上 0.15m 又折回，重叠 0.15m
  const points = [p(7.45, 2.55, 5.55), p(7.45, 2.7, 5.55), p(7.45, 0.3, 5.55)];
  const found = findRouteRetraces(points);
  assert.equal(found.length, 1);
  assert.ok(Math.abs(found[0].overlapM - 0.15) < 1e-9);
  assert.equal(found[0].direction, 'opposite');
});
