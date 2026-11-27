import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFurnishingSection,
  buildLightingSection,
  loadDressingMapContext,
} from '../../scripts/generate-dressing-map.js';
import { furnitureHostIndex, resolveFurniturePlacement, type WallLike } from '../../shared/furniture-placement.js';
import { isLightingFixtureType } from '../../shared/lighting-fixtures.js';
import { resolvePointPlacementInWalls } from '../../shared/point-placement.js';
import type { FurnishingsYaml } from '../../shared/types.js';

// 装扮映射生成器三态与冷凝链锚点的回归（PR #122 Codex e44cc676 blocking + major；
// d797ff2e 同主题三条 major 中的灯光项）。契约见 scripts/generate-dressing-map.ts 文件头。

const NO_WALLS = new Map<string, WallLike[]>();

/** 合成条目 → §2 段落。不读真实配置，只喂判据本身。 */
function sectionFor(furnishings: FurnishingsYaml) {
  const hosts = furnitureHostIndex(Object.values(furnishings).flat());
  return buildFurnishingSection(furnishings, (item) => resolveFurniturePlacement(item, NO_WALLS, hosts, undefined));
}

test('家具三态①：有效摆位进已摆位行，数量按实例数', () => {
  const { lines, failures } = sectionFor({
    bedroom_nw: [{ type: 'bed_150', id: 'bnw.bed_150', x: 4.6, z: 2.3, rotation: 270, support: { kind: 'floor' } }],
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(lines, ['| bedroom_nw | bed_150 | 1 | 1.5×2 | (4.6, 2.3) / 270° |']);
});

test('行内尺寸优先于目录：无目录条目的参数化柜仍显示行内宽×深（issue #116 通顶柜）', () => {
  // declaredFurnitureDims 口径（行内 > 目录）：通顶柜 mb_full_height_cabinet 无
  // FURNITURE_DIMS 条目，旧实现只读目录会写成「体块无尺寸记录」。
  // 通顶柜的真实声明是墙锚（无 x/z）：先用真实墙段解算摆位，再以解算出的摆位
  // 喂合成绝对条目——本测试只验「行内尺寸显示」，墙锚解算由 resolver-baseline /
  // mb-along-wall-distance 覆盖。期望行由条目自身的行内宽/深与解算摆位拼出，不钉绝对坐标。
  const context = loadDressingMapContext();
  // 2026-11-27 干湿分离放弃：通顶柜由主卧衣柜改为主卫东墙通顶柜（house.yaml master_bath），
  // 不再属于 master_bedroom；行内尺寸显示口径不变。
  const real = context.furnishings.master_bath?.find((item) => item.id === 'mb.full_height_cabinet');
  assert.ok(real, 'mb.full_height_cabinet must be declared in config/house.yaml');
  const { placement, diagnostic } = resolveFurniturePlacement(real, context.wallSegments, context.hosts, context.anchors);
  assert.equal(diagnostic, undefined, `unexpected diagnostic: ${diagnostic ?? ''}`);
  assert.ok(placement, 'mb.full_height_cabinet must resolve against real walls');
  // 墙锚与绝对 x/z 不得同时声明：合成条目只取绝对字段（类型/id/旋转/行内尺寸/支撑），
  // 墙锚字段（wall/wall_side/along/wall_clearance）剥掉，摆位置只来自解算结果。
  const fixture = {
    type: real.type,
    id: real.id,
    x: placement.x,
    z: placement.z,
    rotation: real.rotation,
    width: real.width,
    depth: real.depth,
    support: real.support,
  };
  const { lines, failures } = sectionFor({
    master_bath: [fixture],
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(lines, [
    `| master_bath | ${real.type} | 1 | ${real.width}×${real.depth} | (${placement.x}, ${placement.z}) / ${real.rotation}° |`,
  ]);
});

test('家具三态②：count-only 按声明 count 累计，不按条目数（厨房 5/2/5 不得写成 1）', () => {
  const { lines, failures } = sectionFor({
    kitchen: [
      { type: 'cabinet_base', count: 5 },
      { type: 'cabinet_base', count: 2 },
      { type: 'cabinet_wall', count: 2 },
      { type: 'countertop_quartz', count: 5 },
      { type: 'curtain_set' },
    ],
  });
  assert.deepEqual(failures, []);
  assert.ok(lines.includes('| kitchen | cabinet_base | 7 | — | count-only（无家具体块，按实物补摆） |'));
  assert.ok(lines.includes('| kitchen | cabinet_wall | 2 | — | count-only（无家具体块，按实物补摆） |'));
  assert.ok(lines.includes('| kitchen | countertop_quartz | 5 | — | count-only（无家具体块，按实物补摆） |'));
  assert.ok(lines.includes('| kitchen | curtain_set | 1 | — | count-only（无家具体块，按实物补摆） |'));
});

test('家具三态③：定位失败必须显形，不得静默落进 count-only', () => {
  const { lines, failures } = sectionFor({
    bedroom_nw: [{ type: 'bed_150', id: 'bnw.bad', wall: 'w_missing', wall_side: 'north', along: 1 }],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^bedroom_nw:bed_150 \(bnw\.bad\): wall "w_missing" not found$/);
  // 失败条目不出任何表格行：既不进已摆位，也不被当成「正常计数」。
  assert.deepEqual(lines, []);
});

test('冷凝链家具缺锚点上下文 → 定位失败（旧实现会写成「解算失败」的已摆位行）', () => {
  const { lines, failures } = sectionFor({
    master_bedroom: [{ type: 'mb_vanity_pvc_wardrobe_entry', id: 'mb.vanity_pvc_wardrobe_entry', anchor: { source: 'chain', id: 'wardrobe_east_band' } }],
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /condensateChain 上下文缺失/);
  assert.deepEqual(lines, []);
});

test('冷凝链已退役：真实配置不再解出链几何，退役三件不出清单行', () => {
  // 2026-11-13 issue #116：冷凝链退役（950 衣柜 + 三件 PVC 链件 + 内机出口示意
  // mb.condensate_pipe 已删，链宿主全空）；装扮映射不再喂链几何，退役件不得再出现在
  // 家具体块清单里——亦不再是「解算失败」行：失败是无锚点可解，退役是无件可列。
  const context = loadDressingMapContext();
  assert.deepEqual(context.chainDiagnostics, []);
  assert.ok(!context.anchors.condensateChain, '冷凝链已退役，不再解出几何');

  const section = buildFurnishingSection(context.furnishings, (item) =>
    resolveFurniturePlacement(item, context.wallSegments, context.hosts, context.anchors));
  assert.deepEqual(section.failures, []);
  for (const token of ['condensate_pipe', 'vanity_pvc']) {
    assert.ok(!section.lines.some((line) => line.includes(token)), `退役件（含 ${token}）不得出现在家具体块清单里`);
  }
});

test('灯光摆放单：along_host 起夜灯（宿主为灯具筛选外的插座）能解出坐标', () => {
  const context = loadDressingMapContext();
  const lights = context.electrical.filter((point) => isLightingFixtureType(point.type));
  // 宿主必须是灯具筛选外的点位（插座）：若索引只由 lights 建，宿主不在索引里，
  // 解算报「断引用」——本测试钉的就是「索引取自全量 electrical + plumbing」这一口径。
  const host = context.electrical.find((point) => point.id === 'sock_master_bed_r');
  assert.ok(host, 'sock_master_bed_r must be declared in config/electrical.yaml');
  assert.ok(!lights.some((point) => point.id === host.id), '宿主插座不得在灯具筛选结果里');
  assert.equal(host.type, 'socket');
  assert.ok(host.wall !== undefined && host.along !== undefined, '宿主须为沿墙点位');

  // 合成 along_host 起夜灯：只声明宿主 + 偏移，不声明 wall/mount/anchor/absolute。
  const synthetic = {
    id: 'night_test_along_host',
    room: 'master_bedroom',
    type: 'night_light',
    along_host: { id: host.id, offset: 0.15 },
    height: 0.3,
  } as const;
  const section = buildLightingSection(
    [synthetic],
    () => '—',
    (point) => resolvePointPlacementInWalls(point, context.pointWalls, context.mountHosts, context.pointSiblings),
  );
  assert.deepEqual(section.failures, []);

  // 派生规则（不钉绝对坐标）：沿墙位置 = 宿主解算 along + 声明 offset，墙/面继承宿主
  // 的解算结果（解算器即按 hostResolved.placement 派生，不读宿主的字面字段）。
  const { placement, diagnostic } = resolvePointPlacementInWalls(synthetic, context.pointWalls, context.mountHosts, context.pointSiblings);
  assert.equal(diagnostic, undefined, `unexpected diagnostic: ${diagnostic ?? ''}`);
  assert.ok(placement, 'along_host 起夜灯必须解出位置');
  assert.equal(placement.kind, 'wall');
  const hostPlacement = resolvePointPlacementInWalls(host, context.pointWalls, context.mountHosts, context.pointSiblings).placement;
  assert.ok(hostPlacement, '宿主插座必须解出位置');
  assert.equal(hostPlacement.kind, 'wall');
  if (placement.kind === 'wall' && hostPlacement.kind === 'wall') {
    assert.equal(placement.wallId, hostPlacement.wallId);
    assert.equal(placement.wallSide, hostPlacement.wallSide);
    assert.equal(placement.along, hostPlacement.along + 0.15);
  }
  const formatCoord = (value: number): string => String(Number(value.toFixed(3)));
  const row = section.lines.find((line) => line.startsWith('| night_test_along_host |'));
  assert.ok(row, '合成起夜灯必须出现在灯光点位表里');
  assert.ok(
    row.includes(`(${formatCoord(placement.x)}, ${formatCoord(placement.z)})`),
    `位置列必须是解算坐标（当前行：${row}）`,
  );
});

test('灯光摆放单：沿墙/挂载起夜灯输出解算坐标，不再是 (—, —)', () => {
  const context = loadDressingMapContext();
  const lights = context.electrical.filter((point) => isLightingFixtureType(point.type));
  const section = buildLightingSection(
    lights,
    () => '—',
    (point) => resolvePointPlacementInWalls(point, context.pointWalls, context.mountHosts, context.pointSiblings),
  );
  assert.deepEqual(section.failures, []);

  const positionOf = (id: string): string => {
    const row = section.lines.find((line) => line.startsWith(`| ${id} |`));
    assert.ok(row, `${id} 必须出现在灯光点位表里`);
    const match = row.match(/\| \((\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\) \|/u);
    assert.ok(match, `${id} 的位置列必须是数值坐标（当前行：${row}）`);
    return `(${match[1]}, ${match[2]})`;
  };
  // 三件历史报告点：位置来自墙锚 / 家具挂载的单一解算（config note 明言平面位置
  // 只有解算器一个来源）；期望值由同一解算器独立复算、按地图的坐标显示格式
  // （3 位小数、去浮点尾巴）拼出，验的是「地图把解算坐标印进正确的行」，
  // 解算本身由 resolver-baseline 覆盖。
  const formatCoord = (value: number): string => String(Number(value.toFixed(3)));
  for (const id of ['night_guest_head', 'night_living_mid', 'night_corridor']) {
    const point = lights.find((candidate) => candidate.id === id);
    assert.ok(point, `${id} must be declared in config/electrical.yaml`);
    const { placement } = resolvePointPlacementInWalls(point, context.pointWalls, context.mountHosts, context.pointSiblings);
    assert.ok(placement, `${id} must resolve`);
    assert.equal(positionOf(id), `(${formatCoord(placement.x)}, ${formatCoord(placement.z)})`);
  }
});
