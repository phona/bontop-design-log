import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { buildCeilingZone, buildMixedRectangleOutline } from '../../shared/render/CeilingZoneBuilder.js';
import { parseCeilingZones } from '../../shared/project-render-facts-schema.js';

const zones = parseCeilingZones(readFileSync('config/ceiling.yaml', 'utf8'));
const northBand = zones.find((zone) => zone.id === 'ceiling_dining_north_band');
const westBand = zones.find((zone) => zone.id === 'ceiling_dining_west_band');
const foyer = zones.find((zone) => zone.id === 'ceiling_entry_foyer');

const covesOf = (group: NonNullable<ReturnType<typeof buildCeilingZone>>) =>
  group.children.filter((child) => child.userData.part === 'cove');

const hasPoint = (outline: Array<{ x: number; z: number }>, x: number, z: number, eps = 1e-6): boolean =>
  outline.some((p) => Math.abs(p.x - x) < eps && Math.abs(p.z - z) < eps);

test('DEC-2026-10-08-R05: 垂面弧全拆（回 R02 硬垂直面），三区均无 cove', () => {
  assert.ok(northBand && westBand && foyer, '三个分区都应存在');
  for (const zone of zones) {
    assert.equal(zone.cove_fillets, undefined, `${zone.id} 不应声明 cove（R05 全拆）`);
  }
  // 平面语言全部保留：北带 SW 阴角 + SE 镜像凹弧；西带 NW 外圆角 + SE 阴角
  assert.deepEqual(northBand?.concave_fillets, { sw: 0.15, se: 0.15 });
  assert.deepEqual(northBand?.concave_fillets_open, { se: 'sw' }, 'SE 凹弧填补西南开口（镜像，跨分区）');
  assert.equal(northBand?.corner_radii, undefined, '北带 SE 不再有阳角圆（R04 阳角圆已被 R05 废止）');
  assert.deepEqual(northBand?.area, [7.70, 2.40, 10.80, 3.00]);
  assert.deepEqual(westBand?.corner_radii, { nw: 0.15 });
  assert.deepEqual(westBand?.concave_fillets, { se: 0.15 });
  assert.deepEqual(foyer?.area, [10.80, 2.90, 13.40, 4.30]);
});

test('DEC-2026-10-08-R05: 三区渲染均无 cove mesh，立面与平顶硬相交', () => {
  for (const zone of [northBand!, westBand!, foyer!]) {
    const group = buildCeilingZone(zone as any);
    assert.ok(group, `${zone.id} 应生成几何`);
    assert.equal(covesOf(group!).length, 0, `${zone.id} 不应有 cove mesh`);
  }
});

test('DEC-2026-10-08-R05: 门头盒 SE 镜像凹弧——切点 (10.65,3.00)/(10.80,3.15)，与门厅西缘相切、不扎进邻区', () => {
  const group = buildCeilingZone(northBand!);
  assert.ok(group);
  const box = new Box3().setFromObject(group!);
  // 镜像凹弧向西南开口加料：南界仍 z=3.00（南缘切点），东缘延至 z=3.15（与门厅西缘的切点）
  assert.ok(Math.abs(box.max.z - 3.15) < 0.01, `轮廓南界应到 3.15（凹弧加料），实际 ${box.max.z}`);
  assert.ok(Math.abs(box.max.x - 10.80) < 0.01, `轮廓东界应仍在 10.80（与门厅西缘共线），实际 ${box.max.x}`);
  assert.ok(Math.abs(box.min.y - 2.50) < 0.01 && Math.abs(box.max.y - 2.80) < 0.01, '底面 2.50 / 原顶 2.80 不变');
  assert.ok(group!.children.some((child) => child.userData.part === 'rounded-perimeter'), '凹弧分区走挤出周边');

  const radii = { nw: 0, ne: 0, se: 0, sw: 0 };
  const fillets = { nw: 0, ne: 0, se: 0.15, sw: 0.15 };
  const outline = buildMixedRectangleOutline(7.70, 2.40, 10.80, 3.00, radii, fillets, { se: 'sw' })!;
  assert.ok(outline, '镜像凹弧应能建出轮廓');
  // 两个切点必须精确在轮廓上（相切的条件）
  assert.ok(hasPoint(outline, 10.65, 3.00), '南缘切点 (10.65,3.00) 应在轮廓上');
  assert.ok(hasPoint(outline, 10.80, 3.15), '门厅西缘切点 (10.80,3.15) 应在轮廓上');
  // SW 阴角（默认方向）不受影响
  assert.ok(hasPoint(outline, 7.85, 3.00), 'SW 阴角南缘切点 (7.85,3.00) 仍在');
  assert.ok(hasPoint(outline, 7.70, 3.15), 'SW 阴角西缘切点 (7.70,3.15) 仍在');
  // 不加进邻区：没有任何点东于 x=10.80（门厅）或北于 z=2.85 的东缘段之外
  assert.ok(outline.every((p) => p.x <= 10.80 + 1e-9), '镜像凹弧不得越过 x=10.80（不扎进门厅体量）');
  assert.ok(outline.every((p) => p.z <= 3.15 + 1e-9), '轮廓南界不超过切点 z=3.15');
  // 弧上点都在以 (10.65,3.15) 为圆心、R0.15 的圆上（切点之间的采样）
  const arcPts = outline.filter((p) => p.x > 10.65 + 1e-6 && p.x < 10.80 - 1e-6 && p.z > 3.00 + 1e-6 && p.z < 3.15 - 1e-6);
  assert.ok(arcPts.length >= 4, `应有足够弧采样点，实际 ${arcPts.length}`);
  for (const p of arcPts) {
    assert.ok(Math.abs(Math.hypot(p.x - 10.65, p.z - 3.15) - 0.15) < 1e-6, '弧采样点应在 R0.15 圆上');
  }
});

test('镜像凹弧声明 fail-closed：非法象限 / 无凹弧的角', () => {
  const badQuadrant = { ...northBand!, concave_fillets_open: { se: 'ne' } } as never;
  assert.equal(buildCeilingZone(badQuadrant), null, 'se:ne 不是镜像弧心象限（应为 sw），必须 fail closed');
  const noFillet = { ...northBand!, concave_fillets_open: { sw: 'se' } } as never;
  assert.equal(buildCeilingZone(noFillet), null, '对没有凹弧的角声明开口象限，必须 fail closed');
  const badOutline = buildMixedRectangleOutline(7.70, 2.40, 10.80, 3.00,
    { nw: 0, ne: 0, se: 0, sw: 0 }, { nw: 0, ne: 0, se: 0.15, sw: 0.15 }, { se: 'ne' as never });
  // 直接调用只按象限存在性镜像，不做象限校验（校验在 schema/resolve 层）；此处仅确认不抛错
  assert.ok(badOutline === null || Array.isArray(badOutline), '直接调用不应抛错');
});
