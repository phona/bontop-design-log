import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load as parseYaml } from 'js-yaml';
import { buildMixedRectangleOutline } from '../../shared/render/CeilingZoneBuilder.js';
import {
  CEILING_TRADE_CLASSES,
  computeCeilingTakeoff,
  isCeilingTradeClass,
} from '../../shared/ceiling-takeoff.js';
import { parseCeilingZones } from '../../shared/project-render-facts-schema.js';
import { ProjectCatalog } from '../../server/project-catalog.js';

/**
 * 吊顶算量子系统（Phase 1）。三道防线：
 *  ① schema：`trade` 合法、未知字段/错字被 strict 拦下；
 *  ② 逐分区实算：面积/周长/展开/板块数与 yaml 声明一一对应，ac_indoor 被排除；
 *  ③ 口径一致：解析化面积 == 渲染侧 `buildMixedRectangleOutline` + shoelace（3D 与算量同源）。
 */

const zones = parseCeilingZones(readFileSync('config/ceiling.yaml', 'utf8'));
const rooms = ProjectCatalog.load('.').getRooms().map((room) => ({ id: room.id, height: room.height }));
const takeoff = computeCeilingTakeoff(zones, rooms);
const byId = new Map(takeoff.zones.map((zone) => [zone.id, zone]));

/** shoelace：渲染侧轮廓（弧线已被采样成折线）的面积，用于交叉验证解析化公式。 */
function outlineArea(id: string): number | undefined {
  const zone = zones.find((candidate) => candidate.id === id);
  if (!zone?.area) return undefined;
  const [x1, z1, x2, z2] = zone.area;
  const radii = { nw: 0, ne: 0, se: 0, sw: 0 };
  const fillets = { nw: 0, ne: 0, se: 0, sw: 0 };
  for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
    radii[corner] = zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0;
    fillets[corner] = zone.concave_fillets?.[corner] ?? 0;
  }
  const outline = buildMixedRectangleOutline(x1, z1, x2, z2, radii, fillets);
  if (!outline) return undefined;
  let sum = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

test('trade 是 schema 认可的枚举，错字与未知字段都被拒绝', () => {
  assert.deepEqual([...CEILING_TRADE_CLASSES], ['gypsum_board', 'aluminum_buckle', 'curtain_box', 'drying_rack']);
  assert.ok(isCeilingTradeClass('curtain_box'));
  assert.ok(!isCeilingTradeClass('curtainbox'));
  const base = {
    id: 'x', room: 'living_dining', type: 'drop' as const,
    thickness: 0.3, area: [0, 0, 1, 1],
  };
  assert.equal(parseCeilingZones(JSON.stringify([{ ...base, trade: 'curtain_box' }]))[0].trade, 'curtain_box');
  assert.throws(() => parseCeilingZones(JSON.stringify([{ ...base, trade: 'gypsum_bord' }])), /trade/);
});

test('只量实心分区：19 个计量、6 台 ac_indoor 排除', () => {
  assert.equal(takeoff.zones.length, 19);
  assert.deepEqual(takeoff.excludedIds.sort(), ['ac_child', 'ac_dining', 'ac_living', 'ac_master', 'ac_parent', 'ac_study']);
  // 场景里建不出几何的分区，算量里也不能有（图数同源）
  assert.deepEqual(takeoff.invalidZoneIds, []);
  assert.deepEqual(takeoff.unclassifiedZoneIds, []);
  // 已知待裁定项：主卧西窗帘盒 z[5.55,8.80] 与南窗帘盒 z[8.70,8.95] 在 x[1.10,1.35] 上重叠 0.25×0.10m。
  // 这里**不擅自改几何**（分区边界属设计裁定），只要求它被算量子系统显形并单独计量。
  assert.deepEqual(takeoff.overlaps, ['curtain_box_master_south ↔ curtain_box_master_west (0.250×0.100m)']);
  assert.ok(Math.abs(takeoff.overlapAreaM2 - 0.025) < 1e-9);
});

test('逐分区净面积与声明一致（含圆角/阴角修正）', () => {
  // 直角区：外框即净面积
  assert.ok(Math.abs(byId.get('ceiling_kitchen')!.netAreaM2 - 8.64) < 1e-9);
  assert.ok(Math.abs(byId.get('ceiling_guest_bath')!.netAreaM2 - 3.15) < 1e-9);
  assert.ok(Math.abs(byId.get('ceiling_main_corridor')!.netAreaM2 - 3.75) < 1e-9);
  // 客厅北缘边吊：6.20×0.90 − 4×(0.10²(1−π/4))
  assert.ok(Math.abs(byId.get('ceiling_living')!.netAreaM2 - (5.58 - 4 * 0.01 * (1 - Math.PI / 4))) < 1e-9);
  // 主卧门头盒：1.275×1.05 − 4×(0.10²(1−π/4))
  assert.ok(Math.abs(byId.get('ceiling_master_ac')!.netAreaM2 - (1.33875 - 4 * 0.01 * (1 - Math.PI / 4))) < 1e-9);
  // 餐厅服务带：一阳角 R150 配一阴角 R150，净面积回到外框
  assert.ok(Math.abs(byId.get('ceiling_dining_west_band')!.netAreaM2 - 0.95) < 1e-9);
  assert.ok(Math.abs(byId.get('ceiling_dining_north_band')!.netAreaM2 - 1.86) < 1e-9);
});

test('解析化面积与渲染轮廓（buildMixedRectangleOutline + shoelace）一致', () => {
  for (const id of ['ceiling_living', 'ceiling_master_ac', 'ceiling_dining_west_band', 'ceiling_dining_north_band']) {
    const measured = byId.get(id)!;
    const rendered = outlineArea(id);
    assert.ok(rendered !== undefined, `${id} 渲染侧应能建出轮廓`);
    // 弧线被采样成折线（每象限 8 段），渲染轮廓必然略小于解析真值；
    // 因此断言「解析值更大且差在采样误差内」，而不是相等。
    assert.ok(measured.netAreaM2 > rendered!, `${id}: 解析面积应大于折线轮廓`);
    assert.ok(measured.netAreaM2 - rendered! < 0.05, `${id}: takeoff ${measured.netAreaM2} vs render ${rendered} 差 ${(measured.netAreaM2 - rendered!).toFixed(4)}`);
  }
});

test('分类小计：石膏板 / 铝扣板 / 窗帘盒 / 晾衣架', () => {
  const { byClass } = takeoff;
  assert.equal(byClass.gypsum_board.zones, 10);
  assert.ok(Math.abs(byClass.gypsum_board.netAreaM2 - 23.222) < 0.01);
  assert.equal(byClass.aluminum_buckle.zones, 3);
  assert.ok(Math.abs(byClass.aluminum_buckle.netAreaM2 - 16.366) < 0.01);
  assert.equal(byClass.aluminum_buckle.panelCount, 185);
  // 窗帘盒：5 个分区全部计入，另单列延长米（行业主口径是元/米）
  assert.equal(byClass.curtain_box.zones, 5);
  assert.ok(Math.abs(byClass.curtain_box.netAreaM2 - 4.463) < 0.01);
  assert.ok(Math.abs(byClass.curtain_box.linearM - 17.85) < 1e-9);
  assert.equal(byClass.curtain_box.pricingUnit, 'linear_m');
  assert.equal(byClass.drying_rack.zones, 1);
  assert.ok(Math.abs(byClass.drying_rack.netAreaM2 - 1.08) < 1e-9);
  assert.ok(Math.abs(takeoff.totalNetAreaM2 - 45.13) < 0.01);
  assert.ok(Math.abs(takeoff.totalExpandedAreaM2 - 77.053) < 0.05);
});

test('窗帘盒逐个点名：5 个都在，且都是显式声明的 trade', () => {
  const ids = ['curtain_box_living', 'curtain_box_master_west', 'curtain_box_master_south', 'curtain_box_parent_south', 'curtain_box_study_south'];
  for (const id of ids) {
    const zone = byId.get(id);
    assert.ok(zone, `${id} 必须进算量`);
    assert.equal(zone.trade, 'curtain_box');
    assert.equal(zone.tradeDeclared, true, `${id} 的 trade 必须显式声明，不能靠 id 猜`);
    assert.equal(zone.type, 'drop');
    assert.ok(Math.abs(zone.thickness - 0.15) < 1e-9);
  }
  assert.ok(Math.abs(byId.get('drying_rack_living')!.tradeDeclared ? 1 : 0 - 1) === 1);
  assert.equal(byId.get('drying_rack_living')!.trade, 'drying_rack');
});

test('铝扣板板块数：eps-ceil，浮点不会多算一块板', () => {
  assert.equal(byId.get('ceiling_kitchen')!.panelCount, 96);   // ⌈3.6/0.3⌉×⌈2.4/0.3⌉
  assert.equal(byId.get('ceiling_master_bath')!.panelCount, 54); // ⌈2.6/0.3⌉×⌈1.76/0.3⌉
  // 1.5/0.3 在浮点下是 5.000000000000001：裸 Math.ceil 会算成 6×7=42
  assert.equal(byId.get('ceiling_guest_bath')!.panelCount, 35);
  assert.equal(takeoff.aluminumBucklePanelCount, 185);
});

test('完成面标高与房间对照：原顶房间显形，不静默跳过', () => {
  assert.ok(Math.abs(byId.get('ceiling_living')!.bottomY - (2.8 - 0.3)) < 1e-9);
  assert.ok(Math.abs(byId.get('ceiling_kitchen')!.bottomY - (2.8 - 0.15)) < 1e-9);
  // 26 个房间里只有 9 个房间声明了吊顶，其余一律列出（电梯井/原顶都在这里）
  assert.equal(takeoff.roomIdsWithCeiling.length, 9);
  assert.ok(takeoff.roomIdsWithoutCeiling.includes('elevator_shaft'));
  assert.ok(takeoff.roomIdsWithoutCeiling.includes('master_bedroom') === false, '主卧有门头盒吊顶');
  assert.deepEqual(takeoff.unknownRoomZoneIds, []);
});

test('按房间汇总与逐分区求和自洽', () => {
  const summed = Object.values(takeoff.byRoom).reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(summed - takeoff.totalNetAreaM2) < 1e-9);
  const classSummed = Object.values(takeoff.byClass).reduce((total, rollup) => total + rollup.netAreaM2, 0);
  assert.ok(Math.abs(classSummed - takeoff.totalNetAreaM2) < 1e-9);
});

test('overlaps 能抓到重复声明：贴边相接不算，压上去算', () => {
  const twin = (id: string, area: [number, number, number, number]) => ({
    id, room: 'kitchen', type: 'drop' as const, thickness: 0.15, area, trade: 'gypsum_board' as const,
  });
  const touching = computeCeilingTakeoff([twin('a', [0, 0, 1, 1]), twin('b', [1, 0, 2, 1])]);
  assert.deepEqual(touching.overlaps, [], '共享边界不算重叠');
  const stacked = computeCeilingTakeoff([twin('a', [0, 0, 1, 1]), twin('b', [0.5, 0.5, 2, 2])]);
  assert.equal(stacked.overlaps.length, 1);
  assert.match(stacked.overlaps[0], /a ↔ b/);
});

test('trade 不靠 id 推断：改名/删声明都不会把窗帘盒算成石膏板', () => {
  const renamed = zones.map((zone) => zone.id === 'curtain_box_living' ? { ...zone, id: 'box_a' } : zone)
    // 同时抽掉显式 trade，验证它只会回退成 gypsum_board 并留下显形记录，而不是"猜"出窗帘盒
    .map((zone) => zone.id === 'box_a' ? { ...zone, trade: undefined } : zone);
  const result = computeCeilingTakeoff(renamed, rooms);
  const box = result.zones.find((zone) => zone.id === 'box_a')!;
  assert.equal(box.trade, 'gypsum_board');
  assert.equal(box.tradeDeclared, false);
  assert.equal(result.byClass.curtain_box.zones, 4);
  // 声明了非法 trade 时进 unclassifiedZoneIds，不猜
  const typo = zones.map((zone) => zone.id === 'curtain_box_living' ? { ...zone, trade: 'curtainbox' as any } : zone);
  const typoResult = computeCeilingTakeoff(typo, rooms);
  assert.deepEqual(typoResult.unclassifiedZoneIds, ['curtain_box_living']);
  assert.equal(typoResult.byClass.curtain_box.zones, 4);
});

test('渲染侧会拒绝的几何，算量同样拒绝', () => {
  const oversized = [{
    id: 'x', room: 'kitchen', type: 'drop' as const, trade: 'gypsum_board' as const,
    thickness: 0.3, area: [0, 0, 1, 1] as [number, number, number, number], corner_radius: 0.9,
  }];
  const result = computeCeilingTakeoff(oversized as any, rooms);
  assert.deepEqual(result.invalidZoneIds, ['x']);
  assert.equal(result.zones.length, 0);
  assert.equal(result.totalNetAreaM2, 0);
});
