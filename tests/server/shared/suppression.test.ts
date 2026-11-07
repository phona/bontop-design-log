import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import {
  elementWallRefs,
  glassJoinSpecs,
  isWallSuppressed,
  joinDeclarationsOf,
  suppressedWallIdSet,
  suppressedWallIds,
  suppressionOf,
  validateWallSuppressions,
} from '../../../shared/suppression.js';

/**
 * suppress 语义唯一权威实现（shared/suppression.ts，2026-11-07 issue #98 第三阶段 S3）。
 *
 * 改判前的形态：overlay 顶层 suppress 8 条（wall/walls/region 选择器）+ spatial-validation.yaml
 * 的 overlay_replacements 镜像表 14 行 + shared/spatial-validation.ts 的
 * validateOverlayReplacements（~100 行）+ 10 处各自 flatMap 的语义副本。改判后：
 * model-geometry 墙条目 suppressed:{reason,replacement} + 本模块。
 *
 * 断言四件事：
 *   ① 墙属性 → 判定（isWallSuppressed / suppressedWallIds / suppressionOf）；
 *   ② replacement 直引用自洽（对象存在 / 结构类型 / 覆盖该墙 / 不双接管 / 结构对象不挂活墙）；
 *   ③ join 语义从 envelope 对象声明机械派生（part 级优先于根级），与原镜像表 14 行等价；
 *   ④ elementWallRefs：parts 是规范来源，无 parts 退根级 wall/walls。
 */

const wall = (id: string, suppressed?: { reason: string; replacement: string }) => ({
  id,
  x1: 0,
  z1: 0,
  x2: 1,
  z2: 0,
  ...(suppressed ? { suppressed } : {}),
}) as { id: string; suppressed?: { reason: string; replacement: string } };

test('墙属性 → suppress 判定', () => {
  const walls = [
    wall('w_a', { reason: '玻璃幕墙', replacement: 'glass_a' }),
    wall('w_b'),
    wall('w_c', { reason: '栏杆', replacement: 'railing_c' }),
  ];
  assert.equal(isWallSuppressed(walls[0]), true);
  assert.equal(isWallSuppressed(walls[1]), false);
  assert.equal(isWallSuppressed(undefined), false);
  assert.deepEqual(suppressedWallIds(walls), ['w_a', 'w_c'], '按墙列表原序、去重');
  assert.deepEqual([...suppressedWallIdSet(walls)], ['w_a', 'w_c']);
  assert.deepEqual(suppressionOf(walls, 'w_c'), { reason: '栏杆', replacement: 'railing_c' });
  assert.equal(suppressionOf(walls, 'w_b'), undefined);
  assert.equal(suppressionOf(walls, undefined), undefined);
});

test('validateWallSuppressions：replacement 直引用自洽时零 issue', () => {
  const walls = [
    wall('w_a', { reason: '玻璃幕墙', replacement: 'glass' }),
    wall('w_b'),
  ];
  const elements = [
    { id: 'glass', type: 'curtain_run', walls: ['w_a'] },
    { id: 'paint', type: 'paint_region', wall: 'w_b', room: 'r', along: [0, 1], height: 2.8 },
  ];
  assert.deepEqual(validateWallSuppressions(walls, elements), []);
});

test('validateWallSuppressions：五类坏引用逐条显形（fail-closed）', () => {
  const base = [
    { id: 'glass', type: 'curtain_run', walls: ['w_a'] },
    { id: 'bay', type: 'bay_sill', wall: 'w_b' },
  ];
  // ① replacement 不是已声明对象
  assert.ok(validateWallSuppressions(
    [wall('w_a', { reason: 'x', replacement: 'ghost' })], base,
  ).some((i) => i.code === 'suppression_replacement_unknown' && i.level === 'error'));

  // ② replacement 类型不是结构围护（bay_sill 不能接管墙的实体表现）
  assert.ok(validateWallSuppressions(
    [wall('w_b', { reason: 'x', replacement: 'bay' })], base,
  ).some((i) => i.code === 'suppression_replacement_kind_invalid'));

  // ③ replacement 没引用这面墙
  assert.ok(validateWallSuppressions(
    [wall('w_z', { reason: 'x', replacement: 'glass' })], base,
  ).some((i) => i.code === 'suppression_replacement_not_covering'));

  // ④ 一面墙被两个结构对象接管
  assert.ok(validateWallSuppressions(
    [wall('w_a', { reason: 'x', replacement: 'glass' })],
    [{ id: 'glass', type: 'curtain_run', walls: ['w_a'] }, { id: 'glass2', type: 'railing_run', walls: ['w_a'] }],
  ).some((i) => i.code === 'suppression_replacement_duplicate'));

  // ⑤ 结构对象挂在未 suppress 的活墙上
  assert.ok(validateWallSuppressions(
    [wall('w_a')],
    [{ id: 'glass', type: 'curtain_run', walls: ['w_a'] }],
  ).some((i) => i.code === 'overlay_on_unsuppressed_wall'));

  // 声明缺 reason/replacement（只写一半）同样报错，不静默按 truthy 放过
  assert.ok(validateWallSuppressions(
    [{ id: 'w_a', suppressed: { replacement: 'glass' } as never }], base,
  ).some((i) => i.code === 'suppression_declaration_invalid'));
});

test('elementWallRefs：parts 是规范来源，无 parts 退根级', () => {
  assert.deepEqual(elementWallRefs({
    id: 'e', type: 'curtain_run', walls: ['w_summary'],
    parts: [{ id: 'p1', wall: 'w_a' }, { id: 'p2', walls: ['w_b', 'w_c'] }, { id: 'p3', wallRefs: ['w_d'] }],
  }), ['w_a', 'w_b', 'w_c', 'w_d'], 'parts 存在时根级 walls 汇总不算第二结构属主');
  assert.deepEqual(elementWallRefs({ id: 'e', type: 'railing_run', wall: 'w_a', walls: ['w_b'] }), ['w_a', 'w_b']);
});

test('glassJoinSpecs：part 级 join 优先，根级 join 覆盖全部墙引用', () => {
  const specs = glassJoinSpecs([
    { id: 'multi', type: 'curtain_run', walls: ['w_a', 'w_b'], join: 'butt', parts: [{ id: 'w_a', wall: 'w_a', join: 'continuous' }, { id: 'w_b', wall: 'w_b' }] },
    { id: 'plain', type: 'curtain_run', wall: 'w_c', join: 'butt' },
    { id: 'rail', type: 'railing_run', walls: ['w_d', 'w_e'], join: 'continuous' },
    { id: 'nojoin', type: 'curtain_run', wall: 'w_f' },
    { id: 'paint', type: 'paint_region', wall: 'w_g', join: 'continuous' },
  ]);
  assert.deepEqual(specs, [
    { wall: 'w_a', replacement: 'multi', kind: 'curtain_run', part: 'w_a', join: 'continuous' },
    { wall: 'w_c', replacement: 'plain', kind: 'curtain_run', join: 'butt' },
    { wall: 'w_d', replacement: 'rail', kind: 'railing_run', join: 'continuous' },
    { wall: 'w_e', replacement: 'rail', kind: 'railing_run', join: 'continuous' },
  ]);
});

test('真实配置：14 面 suppress 墙全部有 replacement 且引用自洽；join 规格与原镜像表 14 行等价', () => {
  // 迁移等价性回归：S3 前这 14 行住在 config/spatial-validation.yaml 的 overlay_replacements
  // （已删），现在必须能从 model-geometry 墙属性 + envelope 对象声明机械复现出来。
  const geometry = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as {
    walls: Array<{ id: string; suppressed?: { reason: string; replacement: string } }>;
  };
  const openings = load(readFileSync('config/model/envelope/openings.yaml', 'utf8')) as {
    elements: Array<Record<string, unknown>>;
  };
  const structural = openings.elements.filter((element) => element.type === 'curtain_run' || element.type === 'railing_run') as unknown as Parameters<typeof validateWallSuppressions>[1];
  const suppressedWalls = geometry.walls.filter((w) => w.suppressed);
  assert.equal(suppressedWalls.length, 14, '8 条原 suppress 声明覆盖 14 面墙（勘察文档 §1.1 实测值）');
  assert.deepEqual(validateWallSuppressions(geometry.walls, structural), [], '真实配置的 replacement 直引用必须全部自洽');

  const specs = glassJoinSpecs(joinDeclarationsOf(openings.elements));
  // 原镜像表实测 14 行（勘察文档 §6.1 记「16 行」系笔误：一行一墙，8 条 suppress 覆盖 14 墙），
  // 派生规格必须逐行复现，一条不多一条不少。
  assert.equal(specs.length, 14, 'join 规格条数 = 原镜像表行数（一行一墙）');
  assert.deepEqual(specs.map((s) => `${s.wall}|${s.replacement}|${s.part ?? 'root'}|${s.join}`).sort(), [
    'w_bath_north|north_recess_curtain|root|continuous',
    'w_be_south|south_east_curtain|root|butt',
    'w_ent_north_railing|entry_garden_north_railing|root|butt',
    'w_kit_north|kitchen_north_curtain|root|butt',
    'w_liv_south|living_south_curtain|root|butt',
    'w_mb_south|west_curtain|w_mb_south|continuous',
    'w_nw_north|north_recess_curtain|root|continuous',
    'w_st_south|west_curtain|w_st_south|continuous',
    'w_vrv_north|vrv_nw_railing|root|continuous',
    'w_vrv_nw_gap|vrv_nw_railing|root|continuous',
    'w_west_ap|west_curtain|w_west_ap|continuous',
    'w_west_lower|west_curtain|w_west_lower|continuous',
    'w_west_mid|west_curtain|w_west_mid|continuous',
    'w_west_upper|west_curtain|w_west_upper|continuous',
  ].sort(), '逐行对齐原 overlay_replacements 的 wall↔replacement↔part↔join');
});
