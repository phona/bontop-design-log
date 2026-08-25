import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseElectricalPoints } from '../../shared/project-render-facts-schema.js';
import { checkWallPointPlacements } from '../../scripts/verify-point-placement.js';

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

  it('maps wall_side YAML to wallSide for render facts', () => {
    const [point] = parseElectricalPoints('- id: p\n  room: r\n  type: socket\n  x: 1\n  z: 2\n  wall: w_test\n  wall_side: west\n  height: 0.3\n');
    assert.equal(point.wallSide, 'west');
  });

  it('warns when a centerline point has no wall side', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'centerline', wall: 'w_test', x: 3, z: 0 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.message === '缺少墙面侧别'), true);
  });

  it('warns when a point is less than 0.15m from an opening edge', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'edge', wall: 'w_test', x: 3.9, z: 0 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.opening === 'd_test' && issue.distance !== undefined && issue.distance < 0.15), true);
  });
});
