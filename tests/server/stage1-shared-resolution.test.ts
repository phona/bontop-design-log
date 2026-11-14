/**
 * Issue #98 二阶段 Stage 1 机制测试（A7a）：共享家具解算 + 点位 anchor 家具来源。
 *
 * 全部用合成夹具，不读 config——机制本身与真实配置无关；真实配置的等价性由
 * verify:* 门禁与等价校验脚本覆盖（见 PR 描述）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFurniturePlacement,
  resolveFurniturePlacements,
  type PlacementItem,
} from '../../shared/furniture-placement.js';
import {
  pointMountHostIndexFromResolved,
  resolvePointPlacementInWalls,
} from '../../shared/point-placement.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import type { FurnishingsYaml } from '../../shared/types.js';

const WALLS = new Map([['w1', [{ x1: 0, z1: 0, x2: 5, z2: 0 }]]]);

const VANITY_LAYOUT = {
  width: 0.9, depth: 0.5, height: 0.75,
  robot_bay_width: 0.5, robot_bay_clear_width: 0.46, panel_thickness: 0.02,
};

/** Stage 2 真实几何的合成复刻：tv_65 (7.42, 8.00) + offset (+3.58, −0.30) = 沙发 (11.00, 7.70)。 */
const TV_SOFA: PlacementItem[] = [
  { type: 'tv_65', id: 'test.tv', x: 7.42, z: 8.0 },
  { type: 'sofa_3seat', id: 'test.sofa', anchor: { source: 'furniture', id: 'test.tv', offset: { x: 3.58, z: -0.3 } } },
];

test('批量解算：绝对 + 墙锚 + 挂载 + 家具锚点一次解出，与单件解算同值', () => {
  const list: PlacementItem[] = [
    ...TV_SOFA,
    { type: 'cabinet', id: 'test.cab', wall: 'w1', wall_side: 'south', along: 2.5, width: 1.0, depth: 0.5 },
    { type: 'vanity', id: 'test.vanity', x: 5, z: 5, vanity_layout: VANITY_LAYOUT },
    { type: 'robot_dock', id: 'test.dock', mount: { furniture_id: 'test.vanity', slot: 'robot_bay' }, width: 0.4, depth: 0.4 },
  ];
  const { placements, diagnostics } = resolveFurniturePlacements(list, WALLS);
  assert.deepEqual(diagnostics, []);
  assert.equal(placements.size, 5);
  // 沙发 = 电视中心 + offset（Stage 2 关系形态）。
  assert.deepEqual([placements.get('test.sofa')!.x, placements.get('test.sofa')!.z], [11.0, 7.7]);
  // 墙锚：沿墙 2.5，朝南完成面（0.06）+ 半深（0.25）= 0.31。
  assert.deepEqual([placements.get('test.cab')!.x, placements.get('test.cab')!.z], [2.5, 0.31]);
  // 挂载：robot_bay 沿墙取仓区中心（−0.45 + 0.25 = −0.2），进深背沿贴柜背板 + 半深（−0.25 + 0.2 = −0.05）。
  assert.deepEqual([placements.get('test.dock')!.x, placements.get('test.dock')!.z], [4.8, 4.95]);
  // 与单件解算逐件同值（批量出口不得另立口径）。
  const hosts = new Map(list.filter((item) => item.id !== undefined).map((item) => [item.id!, item]));
  for (const item of list) {
    const single = resolveFurniturePlacement(item, WALLS, hosts);
    assert.deepEqual(
      single.placement ? [single.placement.x, single.placement.z] : null,
      [placements.get(item.id!)!.x, placements.get(item.id!)!.z],
      `${item.id} 批量与单件解算必须同值`,
    );
  }
});

test('无来源规则：有 id 无定位来源即诊断；无 id 的 count-only / type-only 合法', () => {
  const list: PlacementItem[] = [
    { type: 'sofa_3seat', id: 'test.orphan' },
    { type: 'chair', count: 4 } as PlacementItem,
    { type: 'stool' },
  ];
  const { placements, diagnostics } = resolveFurniturePlacements(list, WALLS);
  assert.equal(placements.size, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].id, 'test.orphan');
  assert.match(diagnostics[0].diagnostic, /无定位来源/);
});

test('家具锚点：断引用 / 循环 / 宿主无位置 / offset 越权均显式诊断', () => {
  const broken = resolveFurniturePlacement(
    { type: 'sofa_3seat', id: 'a', anchor: { source: 'furniture', id: 'missing' } }, WALLS,
  );
  assert.match(broken.diagnostic ?? '', /anchor host "missing" not found/);
  const cyclic: PlacementItem[] = [
    { type: 'sofa_3seat', id: 'a', anchor: { source: 'furniture', id: 'b' } },
    { type: 'chair', id: 'b', anchor: { source: 'furniture', id: 'a' } },
  ];
  const cycled = resolveFurniturePlacements(cyclic, WALLS);
  assert.ok(cycled.diagnostics.some((d) => /循环依赖/.test(d.diagnostic)), '循环依赖必须诊断');
  assert.equal(cycled.placements.size, 0);
  const hostless: PlacementItem[] = [
    { type: 'chair', id: 'host' },
    { type: 'sofa_3seat', id: 'dep', anchor: { source: 'furniture', id: 'host' } },
  ];
  const r2 = resolveFurniturePlacements(hostless, WALLS);
  assert.ok(r2.diagnostics.some((d) => d.id === 'dep' && /anchor host "host"/.test(d.diagnostic)));
  const badOffset = resolveFurniturePlacement(
    { type: 'x', id: 'c', anchor: { source: 'hvac', id: 'indoor_master', offset: { x: 1, z: 0 } } }, WALLS,
  );
  assert.match(badOffset.diagnostic ?? '', /offset 只允许 furniture/);
});

test('pointMountHostIndexFromResolved：与旧索引同形态，x/z 来自解算结果；墙锚家具至此进索引', () => {
  const list: PlacementItem[] = [
    ...TV_SOFA,
    { type: 'cabinet', id: 'test.cab', wall: 'w1', wall_side: 'south', along: 2.5, width: 1.0, depth: 0.5, rotation: 90 },
  ];
  const { placements } = resolveFurniturePlacements(list, WALLS);
  const hosts = pointMountHostIndexFromResolved(placements);
  assert.equal(hosts.size, 3);
  assert.deepEqual(
    { x: hosts.get('test.sofa')!.x, z: hosts.get('test.sofa')!.z },
    { x: 11.0, z: 7.7 },
  );
  // 墙锚家具在旧 pointMountHostIndex 里没有 x/z（手写坐标缺失）；新索引由解算结果供数。
  assert.deepEqual(
    { x: hosts.get('test.cab')!.x, z: hosts.get('test.cab')!.z, rotation: hosts.get('test.cab')!.rotation, width: hosts.get('test.cab')!.width, depth: hosts.get('test.cab')!.depth },
    { x: 2.5, z: 0.31, rotation: 90, width: 1.0, depth: 0.5 },
  );
});

test('buildPlacementIndexes：诊断随 indexes 流出；缺 geometry 时部分上下文显式受限、不回落手写 x/z', () => {
  const furnishings: FurnishingsYaml = {
    room: [
      { type: 'tv_65', id: 'test.tv', x: 7.42, z: 8.0 },
      { type: 'cabinet', id: 'test.cab', wall: 'w1', wall_side: 'south', along: 2.5, width: 1.0, depth: 0.5 },
    ],
  };
  const full = buildPlacementIndexes({
    geometry: { walls: [{ id: 'w1', x1: 0, z1: 0, x2: 5, z2: 0 }] },
    furnishings,
  });
  assert.deepEqual(full.furnitureDiagnostics, []);
  assert.equal(full.mountHosts.get('test.cab')!.x, 2.5);
  assert.ok(full.pointWalls.has('w1'));

  const partial = buildPlacementIndexes({ furnishings });
  // 墙锚家具显式失败（墙段表为空），绝对家具照常解出；不回落手写 x/z。
  assert.ok(partial.furnitureDiagnostics?.some((d) => d.id === 'test.cab' && /wall "w1" not found/.test(d.diagnostic)));
  assert.equal(partial.mountHosts?.get('test.tv')?.x, 7.42);
  assert.equal(partial.mountHosts?.has('test.cab'), false);
  assert.equal(partial.pointWalls, undefined);
});

test('点位 anchor furniture 来源：宿主中心 + offset；断引用 / 未实现来源 / 缺索引均显式处理', () => {
  const { placements } = resolveFurniturePlacements(TV_SOFA, WALLS);
  const mountHosts = pointMountHostIndexFromResolved(placements);
  const walls = new Map();
  const ok = resolvePointPlacementInWalls(
    { id: 'test.sock', anchor: { source: 'furniture', id: 'test.sofa', offset: { x: 0.5, z: 0 } } },
    walls, mountHosts,
  );
  assert.equal(ok.placement?.kind, 'absolute');
  assert.deepEqual([ok.placement?.x, ok.placement?.z], [11.5, 7.7]);
  const broken = resolvePointPlacementInWalls(
    { id: 'p2', anchor: { source: 'furniture', id: 'missing' } }, walls, mountHosts,
  );
  assert.match(broken.diagnostic ?? '', /不在家具宿主索引/);
  const hvac = resolvePointPlacementInWalls(
    { id: 'p3', anchor: { source: 'hvac', id: 'a' } }, walls, mountHosts,
  );
  assert.match(hvac.diagnostic ?? '', /anchor 定位解析未实现/);
  assert.throws(
    () => resolvePointPlacementInWalls(
      { id: 'p4', anchor: { source: 'furniture', id: 'test.sofa' } }, walls, undefined,
    ),
    /mountHosts/,
  );
});
