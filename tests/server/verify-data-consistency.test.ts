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
  // 墙线基准（口径 A）：离完成面距离按 line_datum 解算，真实墙条目均声明
  line_datum: 'centerline' as const,
};

describe('wall point placement consistency', () => {
  it('errors for a point inside a door opening', () => {
    // 2026-11-07 issue #98 S1：along 直接对 openingsAlongWall 的 span 判定（门洞 span [4,6]）
    const issues = checkWallPointPlacements([wall], [{ id: 'inside', wall: 'w_test', wall_side: 'north', along: 5 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'error' && issue.opening === 'd_test'), true);
  });

  it('accepts a point outside the opening', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'outside', wall: 'w_test', wall_side: 'north', along: 3.5 }], new Set());
    assert.equal(issues.length, 0);
  });

  it('maps wall_side to the resolved normal direction on a vertical wall', () => {
    // 沿墙点位的侧别由 wall_side 决定（不再从坐标反推）：西脸 → 解算结果在墙线西侧
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    const west = checkWallPointPlacements([vertical], [{ id: 'west', wall: 'w_test', wall_side: 'west', along: 5 }], new Set());
    assert.equal(west.some(i => i.level === 'error'), false);
    const east = checkWallPointPlacements([vertical], [{ id: 'east', wall: 'w_test', wall_side: 'east', along: 5 }], new Set());
    assert.equal(east.some(i => i.level === 'error'), false);
  });

  it('resolves side normals on diagonal walls by the nearest axis', () => {
    // 斜墙不再报「无法唯一映射」：along 沿折线累计，wall_side 取两个垂直方向里更接近的那个
    const diagonal = { ...wall, x1: 0, z1: 0, x2: 10, z2: 10, openings: [] };
    const issues = checkWallPointPlacements([diagonal], [{ id: 'diagonal', wall: 'w_test', wall_side: 'north', along: 5 }], new Set());
    assert.equal(issues.some(i => i.level === 'error'), false);
    assert.equal(issues.some(i => i.message.includes('斜墙')), false);
  });

  it('maps wall_side YAML to wallSide for render facts', () => {
    // 不声明 x/z：issue #98 S1（E2）起 wall 来源禁带 x/z（resolver 忽略它们，直读消费者会读到
    // stale 值——探针 P1），fixture 按同一纪律写。
    const [point] = parseElectricalPoints('- id: p\n  room: r\n  type: socket\n  wall: w_test\n  wall_side: west\n  along: 1\n  height: 0.3\n');
    assert.equal(point.wallSide, 'west');
  });

  it('preserves panel mount and body heights as separate render facts', () => {
    const [point] = parseElectricalPoints('- id: panel\n  room: living_dining\n  type: strong_panel\n  absolute: true\n  x: 13.4\n  z: 3.6\n  mount_height: 0.6\n  body_height: 0.6\n  width: 0.39\n  depth: 0.21\n');
    assert.equal(point.mount_height, 0.6);
    assert.equal(point.body_height, 0.6);
  });

  it('rejects a point that declares no placement source', () => {
    // x/z 是断言字段不是定位来源：wall/along/mount/anchor/absolute 一个都不声明即拒绝加载
    assert.throws(() => parseElectricalPoints('- id: p\n  room: r\n  type: socket\n  x: 1\n  z: 2\n  height: 0.3\n'), /定位来源/);
  });

  it('rejects a wall point without along', () => {
    assert.throws(() => parseElectricalPoints('- id: p\n  room: r\n  type: socket\n  wall: w_test\n  wall_side: west\n  height: 0.3\n'), /along 齐备/);
  });

  it('warns when a wall point has no wall side', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'noside', wall: 'w_test', along: 3 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.message === '缺少墙面侧别'), true);
  });

  it('warns when a point is less than 0.15m from an opening edge', () => {
    const issues = checkWallPointPlacements([wall], [{ id: 'edge', wall: 'w_test', wall_side: 'north', along: 3.9 }], new Set());
    assert.equal(issues.some(issue => issue.level === 'warning' && issue.opening === 'd_test' && issue.distance !== undefined && issue.distance < 0.15), true);
  });

  // 2026-10-04 A4-b：治「几何坏了 → 提前 continue → 后续检查静默跳过」。
  // 这条病根让 sock_child_ac 长期只说一句「投影超出墙段 0.45m」，
  // 既不报它缺 wall_side，也不报它会不会撞洞口、渲染面朝哪边。
  it('keeps checking a point whose along overruns the wall span', () => {
    // 墙长 10m；along=12 越界。越界照记，但后续语义检查不被跳过（缺 wall_side 仍要报）；
    // 「距墙段端点」不刷屏——不钳位时它不是 clamp 的必然复读。
    const issues = checkWallPointPlacements([wall], [{ id: 'beyond', wall: 'w_test', along: 12 }], new Set());
    assert.equal(issues.some(i => i.message.includes('越出墙段')), true);
    assert.equal(issues.some(i => i.level === 'warning' && i.message === '缺少墙面侧别'), true);
    assert.equal(issues.some(i => i.message.includes('距墙段端点')), false);
  });

  it('keeps checking openings for a point that sits far off the wall line', () => {
    // along=5 正落在门洞 span [4,6] 上，同时 face_offset 0.3 把点位推离完成面：
    // 两个问题都必须说出来（修复前只报前者，洞口检查被 continue 吞掉）。
    const issues = checkWallPointPlacements([wall], [{ id: 'offline', wall: 'w_test', wall_side: 'south', along: 5, face_offset: 0.3 }], new Set());
    assert.equal(issues.some(i => i.message.includes('离墙线垂直距离')), true);
    assert.equal(issues.some(i => i.level === 'error' && i.opening === 'd_test'), true);
  });

  it('keeps checking the room-facing side for an out-of-span point', () => {
    // 竖墙 z[0,10]；along=14 越界，且声明 wall_side: east 而房间质心在西侧：
    // 越界与「渲染面与房间异侧」两个问题都要说出来。
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    const centroids = new Map([['room_west', { x: -2, z: 5 }]]);
    const issues = checkWallPointPlacements([vertical], [{ id: 'beyond_side', room: 'room_west', wall: 'w_test', wall_side: 'east', along: 14 }], new Set(), 0.15, centroids);
    assert.equal(issues.some(i => i.message.includes('越出墙段')), true);
    assert.equal(issues.some(i => i.level === 'error' && i.message.includes('异侧')), true);
  });

  it('errors when the declared render side faces away from the owning room', () => {    // 竖墙 from (0,0) 到 (0,10)：left 朝西；房间质心在西侧时朝西 = 正确，质心在东侧 = 渲染面与房间异侧
    const vertical = { ...wall, x1: 0, z1: 0, x2: 0, z2: 10, openings: [] };
    const centroids = new Map([
      ['room_west', { x: -2, z: 5 }],
      ['room_east', { x: 2, z: 5 }],
    ]);
    const ok = checkWallPointPlacements([vertical], [{ id: 'p1', room: 'room_west', wall: 'w_test', wall_side: 'west', along: 5 }], new Set(), 0.15, centroids);
    assert.equal(ok.some(i => i.level === 'error' && i.message.includes('异侧')), false);
    const bad = checkWallPointPlacements([vertical], [{ id: 'p2', room: 'room_east', wall: 'w_test', wall_side: 'west', along: 5 }], new Set(), 0.15, centroids);
    assert.equal(bad.some(i => i.level === 'error' && i.message.includes('异侧')), true);
    // 显式 wall_side 朝东后不再报错
    const fixed = checkWallPointPlacements([vertical], [{ id: 'p3', room: 'room_east', wall: 'w_test', wall_side: 'east', along: 5 }], new Set(), 0.15, centroids);
    assert.equal(fixed.some(i => i.level === 'error' && i.message.includes('异侧')), false);
  });
});
