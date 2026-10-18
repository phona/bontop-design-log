import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintElectricalTopology } from '../../shared/electrical-lint.js';
import type { ElectricalLintIssue, ElectricalPoint, ElectricalTopology, FurnishingsYaml } from '../../shared/types.js';

// ── 2026-10-17 lint 加固三条（review 盲区）的内联合成数据测试 ─────────────────────
// 只测 shared/electrical-lint.ts 的纯函数判定，不读 live config（live 树另有并行修复：
// ac_panel_dining/switch_corridor 错位、light_balcony_dome 补点、sock_kitchen_fridge 重绑，
// 本文件对 live 树零断言，全部用合成点位/拓扑）。
//
//   (d) point_coordinate_collision        同 room + 平面 <0.05m + |Δh| <0.15m + 双强电 → error
//   (e) furnishing_light_without_point    ceiling_light 预算行 count>0 的房间无照明点位 → error
//   (f) circuit_member_dangling_or_superseded  悬空/superseded 成员 → error；blocked → warning

const makePoint = (overrides: Partial<ElectricalPoint> & { id: string }): ElectricalPoint => ({
  room: 'living_dining',
  type: 'socket',
  x: 1,
  z: 1,
  height: 0.3,
  ...overrides,
});

const panelMain = makePoint({ id: 'panel_main', type: 'strong_panel' });

const circuit = (memberPointIds: string[]): ElectricalTopology['circuits'][number] => ({
  id: 'circuit_test',
  panel_id: 'panel_strong',
  purpose: 'ordinary_power',
  status: 'confirmed',
  member_point_ids: memberPointIds,
  capacity: '2.5kW',
  wire_size: '2.5mm²',
  breaker: 'C16A+漏保',
});

const lint = (points: ElectricalPoint[], circuits: ElectricalTopology['circuits'] = [], furnishings?: FurnishingsYaml) =>
  lintElectricalTopology(
    {
      version: 'test',
      panels: [{ id: 'panel_strong', kind: 'strong', status: 'confirmed', source_point_id: 'panel_main' }],
      circuits,
      controls: [],
      pending_parameters: [],
    },
    [panelMain, ...points],
    furnishings ? { furnishings } : {},
  );

const hitsOf = (result: ReturnType<typeof lintElectricalTopology>, code: string): ElectricalLintIssue[] =>
  [...result.errors, ...result.warnings].filter((item) => item.code === code);

// ── (d) point_coordinate_collision ────────────────────────────────────────────

test('point_coordinate_collision: ac_controller + switch stacked at one coordinate is an error naming both ids and coords', () => {
  // 合成复现 review 案例形态（ac_panel_dining × switch_corridor 同落 (7.20,4.10) h1.3）
  const result = lint([
    makePoint({ id: 'ac_panel_x', type: 'ac_controller', x: 7.2, z: 4.1, height: 1.3 }),
    makePoint({ id: 'switch_y', type: 'switch', x: 7.2, z: 4.1, height: 1.3 }),
  ]);
  const hits = result.errors.filter((item) => item.code === 'point_coordinate_collision');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.message, /ac_panel_x/);
  assert.match(hits[0]!.message, /switch_y/);
  assert.match(hits[0]!.message, /7\.20, 4\.10/);
});

test('point_coordinate_collision: strong+weak co-location (socket+network) is an exempted design pattern', () => {
  const result = lint([
    makePoint({ id: 'sock_a', x: 3, z: 3, height: 0.3 }),
    makePoint({ id: 'net_a', type: 'network', x: 3, z: 3, height: 0.3 }),
  ]);
  assert.equal(hitsOf(result, 'point_coordinate_collision').length, 0);
});

test('point_coordinate_collision: thresholds and exemptions (height gap, planar gap, other room, declared 86mm panel group)', () => {
  // 高差 0.20m ≥ 0.15m：上下错位不算重叠
  const heightApart = lint([
    makePoint({ id: 'switch_low', type: 'switch', x: 3, z: 3, height: 1.3 }),
    makePoint({ id: 'switch_high', type: 'switch_2way', x: 3, z: 3, height: 1.5 }),
  ]);
  assert.equal(hitsOf(heightApart, 'point_coordinate_collision').length, 0);

  // 平面 0.06m ≥ 0.05m：相邻底盒不算重叠
  const planarApart = lint([
    makePoint({ id: 'sock_p', x: 3, z: 3 }),
    makePoint({ id: 'sock_q', type: 'floor_socket', x: 3.06, z: 3 }),
  ]);
  assert.equal(hitsOf(planarApart, 'point_coordinate_collision').length, 0);

  // 跨房间不比对
  const crossRoom = lint([
    makePoint({ id: 'sock_r1', room: 'kitchen', x: 3, z: 3 }),
    makePoint({ id: 'sock_r2', room: 'corridor', x: 3, z: 3 }),
  ]);
  assert.equal(hitsOf(crossRoom, 'point_coordinate_collision').length, 0);

  // 声明了同一 panel_group（86mm 双联）的两位豁免；panel_group 不同仍要报
  const groupAppearance = {
    style: 'warm_white_matte_modular',
    module: 'five_hole_replaceable_usb_c',
    faceplate_width: 0.086,
    faceplate_height: 0.086,
    projection: 0.01,
  } as const;
  const declaredPair = lint([
    makePoint({ id: 'sock_g1', x: 3, z: 3, appearance: { ...groupAppearance, panel_group: { id: 'pg_a', role: 'north', center_spacing: 0.006, union_width: 0.166 } } }),
    makePoint({ id: 'sock_g2', x: 3, z: 3, appearance: { ...groupAppearance, panel_group: { id: 'pg_a', role: 'south', center_spacing: 0.006, union_width: 0.166 } } }),
  ]);
  assert.equal(hitsOf(declaredPair, 'point_coordinate_collision').length, 0);
  const undeclaredPair = lint([
    makePoint({ id: 'sock_h1', x: 3, z: 3, appearance: { ...groupAppearance, panel_group: { id: 'pg_a', role: 'north', center_spacing: 0.006, union_width: 0.166 } } }),
    makePoint({ id: 'sock_h2', x: 3, z: 3, appearance: { ...groupAppearance, panel_group: { id: 'pg_b', role: 'south', center_spacing: 0.006, union_width: 0.166 } } }),
  ]);
  assert.equal(hitsOf(undeclaredPair, 'point_coordinate_collision').length, 1);
});

test('point_coordinate_collision: covers the whole strong-power set (night_light, floor_socket)', () => {
  const result = lint([
    makePoint({ id: 'nl_a', type: 'night_light', x: 5, z: 5, height: 0.25 }),
    makePoint({ id: 'fs_a', type: 'floor_socket', x: 5, z: 5, height: 0.15 }),
  ]);
  const hits = result.errors.filter((item) => item.code === 'point_coordinate_collision');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.message, /nl_a/);
  assert.match(hits[0]!.message, /fs_a/);
});

// ── (e) furnishing_light_without_point ────────────────────────────────────────

test('furnishing_light_without_point: ceiling_light budget row with a matching lighting point passes', () => {
  // dome 满足要求（同 review 案例形态：阳台补 light_balcony_dome 后应归零）
  const result = lint(
    [makePoint({ id: 'light_balcony_dome', type: 'dome', room: 'balcony_laundry', x: 5.9, z: 1.5, height: 2.2 })],
    [],
    { balcony_laundry: [{ type: 'ceiling_light' }] },
  );
  assert.equal(hitsOf(result, 'furnishing_light_without_point').length, 0);
});

test('furnishing_light_without_point: ceiling_light budget row with no lighting point in the room is an error naming the room', () => {
  const result = lint(
    [makePoint({ id: 'sock_balcony_washer', room: 'balcony_laundry', x: 5.6, z: 1.5 })],
    [],
    { balcony_laundry: [{ type: 'ceiling_light' }] },
  );
  const hits = result.errors.filter((item) => item.code === 'furnishing_light_without_point');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.message, /balcony_laundry/);
});

test('furnishing_light_without_point: count semantics (default 1, count>1, count=0) and qualifying light types', () => {
  // count 缺省 = 1（与 ProjectCatalog.getFurnishingCounts 的 `count ?? 1` 同口径）→ 需要照明点位
  const defaultCount = lint([], [], { balcony_laundry: [{ type: 'ceiling_light' }] });
  assert.equal(defaultCount.errors.filter((item) => item.code === 'furnishing_light_without_point').length, 1);

  // count: 2 同样要求
  const twoCount = lint([], [], { balcony_laundry: [{ type: 'ceiling_light', count: 2 }] });
  assert.equal(twoCount.errors.filter((item) => item.code === 'furnishing_light_without_point').length, 1);

  // count: 0 是合法声明（显式清零），不产生照明点位要求
  const zeroCount = lint([], [], { balcony_laundry: [{ type: 'ceiling_light', count: 0 }] });
  assert.equal(hitsOf(zeroCount, 'furnishing_light_without_point').length, 0);

  // night_light 属照明类，可满足要求
  const nightLight = lint([makePoint({ id: 'nl_b', type: 'night_light', room: 'balcony_laundry' })], [], { balcony_laundry: [{ type: 'ceiling_light' }] });
  assert.equal(hitsOf(nightLight, 'furnishing_light_without_point').length, 0);

  // wall_lamp 不在豁免集合内（规格收敛为 dome/downlight/pendant/ceiling_light/night_light）
  const wallLamp = lint([makePoint({ id: 'lamp_b', type: 'wall_lamp', room: 'balcony_laundry' })], [], { balcony_laundry: [{ type: 'ceiling_light' }] });
  assert.equal(wallLamp.errors.filter((item) => item.code === 'furnishing_light_without_point').length, 1);
});

// ── (f) circuit_member_dangling_or_superseded ─────────────────────────────────

test('circuit_member_dangling_or_superseded: dangling member id is an error', () => {
  const sock = makePoint({ id: 'sock_ok' });
  const result = lint([sock], [circuit(['sock_ghost'])]);
  const hits = result.errors.filter((item) => item.code === 'circuit_member_dangling_or_superseded');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.message, /sock_ghost/);
  assert.match(hits[0]!.message, /circuit_test/);
});

test('circuit_member_dangling_or_superseded: superseded member stays in circuit is an error', () => {
  // 合成复现 review 案例形态（sock_kitchen_fridge superseded 仍挂回路）
  const result = lint(
    [makePoint({ id: 'sock_old', serviceability_status: 'superseded' })],
    [circuit(['sock_old'])],
  );
  const hits = result.errors.filter((item) => item.code === 'circuit_member_dangling_or_superseded');
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.message, /sock_old/);
  assert.match(hits[0]!.message, /superseded/);
});

test('circuit_member_dangling_or_superseded: blocked member is a warning only (交底不拦)', () => {
  // blocked 属"位置待改"口径（如 sock_balcony_washer），回路仍服务该电器
  const result = lint(
    [makePoint({ id: 'sock_move', serviceability_status: 'blocked' })],
    [circuit(['sock_move'])],
  );
  assert.equal(result.errors.filter((item) => item.code === 'circuit_member_dangling_or_superseded').length, 0);
  const warnings = result.warnings.filter((item) => item.code === 'circuit_member_dangling_or_superseded');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /sock_move/);
});

test('circuit_member_dangling_or_superseded: normal and usable members are silent', () => {
  const plain = lint([makePoint({ id: 'sock_plain' })], [circuit(['sock_plain'])]);
  assert.equal(hitsOf(plain, 'circuit_member_dangling_or_superseded').length, 0);
  const usable = lint([makePoint({ id: 'sock_usable', serviceability_status: 'usable' })], [circuit(['sock_usable'])]);
  assert.equal(hitsOf(usable, 'circuit_member_dangling_or_superseded').length, 0);
});
