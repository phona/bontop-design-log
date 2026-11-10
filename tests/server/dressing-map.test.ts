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
    bedroom_nw: [{ type: 'bed_150', id: 'bnw.bed_150', x: 4.6, z: 2.3, rotation: 270 }],
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(lines, ['| bedroom_nw | bed_150 | 1 | 1.5×2 | (4.6, 2.3) / 270° |']);
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

test('冷凝链三件从真实配置解出迁移后的坐标（不是「解算失败」）', () => {
  const context = loadDressingMapContext();
  assert.deepEqual(context.chainDiagnostics, []);
  assert.ok(context.anchors.condensateChain, '冷凝链几何必须解出');

  const section = buildFurnishingSection(context.furnishings, (item) =>
    resolveFurniturePlacement(item, context.wallSegments, context.hosts, context.anchors));
  assert.deepEqual(section.failures, []);

  const rowOf = (type: string): string => {
    const row = section.lines.find((line) => line.includes(`| ${type} |`));
    assert.ok(row, `${type} 必须出现在家具体块清单里`);
    assert.ok(!row.includes('解算失败'), `${type} 不得再显示「解算失败」`);
    assert.match(row, /\(\d+(?:\.\d+)?, \d+(?:\.\d+)?\)/u);
    return row;
  };
  const chain = context.anchors.condensateChain.points;
  const coord = (point: { x: number; z: number }) => `(${point.x.toFixed(3)}, ${point.z.toFixed(3)})`;
  // 文档坐标 = 链几何解果（同一份锚点，不另写坐标）。
  assert.ok(rowOf('condensate_pipe_ac_outlet').includes(coord(chain.unit)));
  assert.ok(rowOf('mb_vanity_pvc_wardrobe_entry').includes(coord(chain.wardrobeEastBand)));
  assert.ok(rowOf('mb_vanity_pvc_service_chase').includes(coord(chain.wardrobeEastBand)));
});

test('灯光摆放单：沿墙/挂载起夜灯输出解算坐标，不再是 (—, —)', () => {
  const context = loadDressingMapContext();
  const lights = context.electrical.filter((point) => isLightingFixtureType(point.type));
  const section = buildLightingSection(
    lights,
    () => '—',
    (point) => resolvePointPlacementInWalls(point, context.pointWalls, context.mountHosts),
  );
  assert.deepEqual(section.failures, []);

  const positionOf = (id: string): string => {
    const row = section.lines.find((line) => line.startsWith(`| ${id} |`));
    assert.ok(row, `${id} 必须出现在灯光点位表里`);
    const match = row.match(/\| \((\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\) \|/u);
    assert.ok(match, `${id} 的位置列必须是数值坐标（当前行：${row}）`);
    return `(${match[1]}, ${match[2]})`;
  };
  // 三件历史报告点：位置来自墙锚 / 家具挂载的单一解算，与 config note 的设计值一致。
  assert.equal(positionOf('night_guest_head'), '(16.4, 8.55)');
  assert.equal(positionOf('night_living_mid'), '(11.42, 4.8)');
  assert.equal(positionOf('night_corridor'), '(7.45, 5.55)');
});
