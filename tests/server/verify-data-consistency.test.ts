import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseElectricalPoints } from '../../shared/project-render-facts-schema.js';
import { checkWallPointPlacements } from '../../scripts/verify/placement/verify-point-placement.js';

const wall = {
  id: 'w_test',
  x1: 0,
  z1: 0,
  x2: 10,
  z2: 0,
  openings: [{ id: 'd_test', type: 'door', x: 5, z: 0, width: 2 }],
};

describe('wall point placement consistency', () => {
  it('errors for a point inside a door opening', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'inside', wall: 'w_test', x: 5, z: 0 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'error' && issue.opening === 'd_test'), true);
  });

  it('accepts a point outside the opening', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'outside', wall: 'w_test', x: 3.5, z: 0, wall_side: 'north' }], new Set());
    assert.equal(issues.length, 0);
  });

  it('checks west/east sides on a vertical wall', () => {
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    assert.equal(checkWallPointPlacements([vertical], [{ id: 'west', wall: 'w_test', x: -0.1, z: 5, wall_side: 'west' }], new Set()).some(i => i.level === 'error'), false);
    assert.equal(checkWallPointPlacements([vertical], [{ id: 'wrong', wall: 'w_test', x: -0.1, z: 5, wall_side: 'east' }], new Set()).some(i => i.level === 'error'), true);
  });

  it('does not infer side for diagonal walls', () => {
    const diagonal = { ...wall, x1: 0, z1: 0, x2: 10, z2: 10, openings: [] };
    const issues = checkWallPointPlacements([diagonal], [{ id: 'diagonal', wall: 'w_test', x: 5, z: 4.9, wall_side: 'north' }], new Set());
    assert.equal(issues.some(i => i.level === 'error'), false);
    assert.equal(issues.some(i => i.level === 'warning' && i.message.includes('斜墙')), true);
  });

  it('maps wall_side YAML to wallSide for render facts', () => {
    const [point] = parseElectricalPoints('- id: p\n  room: r\n  type: socket\n  x: 1\n  z: 2\n  wall: w_test\n  wall_side: west\n  height: 0.3\n');
    assert.equal(point.wallSide, 'west');
  });

  it('preserves panel mount and body heights as separate render facts', () => {
    const [point] = parseElectricalPoints('- id: panel\n  room: living_dining\n  type: strong_panel\n  x: 13.4\n  z: 3.6\n  mount_height: 0.6\n  body_height: 0.6\n  width: 0.39\n  depth: 0.21\n');
    assert.equal(point.mount_height, 0.6);
    assert.equal(point.body_height, 0.6);
  });

  it('warns when a centerline point has no wall side', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'centerline', wall: 'w_test', x: 3, z: 0 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.message === '缺少墙面侧别'), true);
  });

  it('warns when a point is less than 0.15m from an opening edge', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'edge', wall: 'w_test', x: 3.9, z: 0 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.opening === 'd_test' && issue.distance !== undefined && issue.distance < 0.15), true);
  });

  it('errors when the default render side faces away from the owning room', () => {
    // 竖墙 from (0,0) 到 (0,10)：left 朝西；房间质心在西侧时默认朝西 = 正确，质心在东侧 = 渲染面与房间异侧
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    const centroids = new Map([
      ['room_west', { x: -2, z: 5 }],
      ['room_east', { x: 2, z: 5 }],
    ]);
    const ok = checkWallPointPlacements([vertical], [{ id: 'p1', room: 'room_west', wall: 'w_test', x: 0, z: 5 }], new Set(), 0.15, centroids);
    assert.equal(ok.some(i => i.level === 'error' && i.message.includes('异侧')), false);
    const bad = checkWallPointPlacements([vertical], [{ id: 'p2', room: 'room_east', wall: 'w_test', x: 0, z: 5 }], new Set(), 0.15, centroids);
    assert.equal(bad.some(i => i.level === 'error' && i.message.includes('异侧')), true);
    // 显式 wall_side 朝东后不再报错
    const fixed = checkWallPointPlacements([vertical], [{ id: 'p3', room: 'room_east', wall: 'w_test', wall_side: 'east', x: 0, z: 5 }], new Set(), 0.15, centroids);
    assert.equal(fixed.some(i => i.level === 'error' && i.message.includes('异侧')), false);
  });
});
