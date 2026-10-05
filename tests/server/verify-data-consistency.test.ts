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

  // 2026-10-04 A4-b：治「投影超出墙段 → 提前 continue → 后续检查静默跳过」。
  // 这条病根让 sock_child_ac 长期只说一句「投影超出墙段 0.45m」，
  // 既不报它缺 wall_side，也不报它会不会撞洞口、渲染面朝哪边。
  it('keeps checking a point whose projection falls outside the wall segment', () => {
    // 墙 x[0,10]，门洞在 x=5 宽 2。点位 x=12 → 投影超段（clamp 到端点 x=10）。
    const issues = checkWallPointPlacements([wall], [{ id: 'beyond', wall: 'w_test', x: 12, z: 0 }], new Set());
    // ① 几何问题照记
    assert.equal(issues.some(i => i.message.includes('投影超出墙段')), true);
    // ② 但后续检查没有被跳过：缺 wall_side 仍然要报（修复前这条永不出现）
    assert.equal(issues.some(i => i.level === 'warning' && i.message === '缺少墙面侧别'), true);
    // ③ 「距墙段端点」是 clamp 的必然结果（0.00m），只复读同一次失败，不允许刷屏
    assert.equal(issues.some(i => i.message.includes('距墙段端点')), false);
  });

  it('keeps checking openings for a point that overshoots the wall line', () => {
    // x=5 在墙段内、但离墙线 0.6m（超容差 0.15），且正落在门洞 x[4,6] 上方：
    // 两个问题都必须说出来（修复前只报前者，洞口检查被 continue 吞掉）。
    const issues = checkWallPointPlacements([wall], [{ id: 'offline', wall: 'w_test', x: 5, z: 0.3, wall_side: 'south' }], new Set());
    assert.equal(issues.some(i => i.message.includes('离墙线垂直距离')), true);
    assert.equal(issues.some(i => i.level === 'error' && i.opening === 'd_test'), true);
  });

  it('still reports wall_side errors for an out-of-segment point', () => {
    // 竖墙 z[0,10]；点位 z=14 超段（clamp 到 z=10），且声明 wall_side: east 而实际偏移在西侧。
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    const issues = checkWallPointPlacements([vertical], [{ id: 'beyond_side', wall: 'w_test', x: -0.3, z: 14, wall_side: 'east' }], new Set());
    assert.equal(issues.some(i => i.message.includes('投影超出墙段')), true);
    assert.equal(issues.some(i => i.level === 'error' && i.message.includes('错误侧别')), true);
  });

  it('errors when the default render side faces away from the owning room', () => {    // 竖墙 from (0,0) 到 (0,10)：left 朝西；房间质心在西侧时默认朝西 = 正确，质心在东侧 = 渲染面与房间异侧
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
