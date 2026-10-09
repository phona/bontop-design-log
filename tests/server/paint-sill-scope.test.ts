import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { mergeSceneElements, parseOverlay } from '../../server/overlay-merge.js';
import { loadCeilingConfig } from '../../server/config-loader.js';
import { buildBaySillGeometry } from '../../shared/render/BaySillGeometry.js';
import {
  computePaintSillScope,
  polygonArea,
  type PaintSillFaceInput,
  type PaintSillScopeResult,
} from '../../shared/paint-sill-scope.js';
import { computePaintScopeForLayout, loadPaintScopeInputs } from '../../server/paint-cost-comparison.js';
import type { BaySillGeometry, BaySillPoint } from '../../shared/render/BaySillGeometry.js';
import type { CeilingZoneSpec } from '../../shared/render/CeilingZoneBuilder.js';
import type { ResolvedRoom, WallSegment } from '../../shared/types.js';

/**
 * 上飘窗涂装范围（paint_sill_region / shared/paint-sill-scope.ts）。
 * 这个模块是「声明 → 几何 → 面积」链路的最后一级：只算 overlay.yaml 显式声明的那几张脸，
 * 顶面按 outline 多边形、垂面按吊顶完成面裁外露部分、被实体墙吃掉的端面直接排除并留 warning。
 * 本文件守七条不变量（每条测试的注释里写明「这条在守什么」）：
 *   ① underside 面积 == outline 多边形面积（鞋带公式独立复算，错一条即红）；
 *   ② front 面被吊顶遮挡的部分被扣除：外露面积 + 遮挡面积 == 宽度 × (top − sill)（守恒）；
 *   ③ 与声明墙完全重合的端面被排除，并 push 指名道姓的 warning；
 *   ④ faces 没声明的面一律不算（不许多算一张脸）；
 *   ⑤ finish 分流：ordinary 与 wet_area 互斥，面积只落到声明的那一格；
 *   ⑥ 真实声明端到端（config/layout/overlay.yaml 的 paint_master_bath_west_bay）数字可对账；
 *   ⑦ fail-closed：bay_sill element / room 不存在时调用方 computePaintScopeForLayout 必须抛错。
 *
 * 纪律：期望值一律用基本几何自己算（自有鞋带公式 / 数值积分 / 从 config 独立推导），
 * 不「调用实现两次」；需要合成几何时用字面量构造 BaySillGeometry 与 CeilingZoneSpec，
 * 不为好算而改产品代码。面积单位为 ㎡，长度单位为 m。
 */

// ───────────────────────── 独立复算工具（不 import 被测模块的面积函数） ─────────────────────────

/** 独立鞋带公式：与 shared/paint-sill-scope.ts 的 polygonArea 同算法但各自实现，用于对账。 */
function shoelace(points: BaySillPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.z - q.x * p.z;
  }
  return Math.abs(sum) / 2;
}

const dist = (a: BaySillPoint, b: BaySillPoint): number => Math.hypot(b.x - a.x, b.z - a.z);

/** 四舍五入到 3 位的「整数毫平方米」判定：面积必须是 3 位小数，否则口径漂了。 */
function isRoundedTo3(value: number): boolean {
  return Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;
}

/** 会遮挡垂面的吊顶类型（声明级常量，与被测模块的过滤条件同一份口径）。 */
const OBSCURING_CEILING_TYPES = ['aluminum_buckle', 'drop', 'integrated'];

/**
 * 独立复算垂面面积：把线段密采样，逐点判定「是否落在某块会遮挡的吊顶投影内」，
 * 再数值积分外露面积与遮挡面积。与被测实现的「区间切分 + 解析乘积」是两条路：
 * 这里不做任何区间运算，只做点判定 + 求和，采样数足够密时误差 < 1e-5㎡。
 */
function verticalAreaBySampling(
  a: BaySillPoint,
  b: BaySillPoint,
  sill: number,
  top: number,
  roomHeight: number,
  zones: CeilingZoneSpec[],
  samples = 200_001,
): { areaSqm: number; occludedAreaSqm: number } {
  let exposed = 0;
  let occluded = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = (i + 0.5) / samples;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    let ceilingY = Infinity;
    for (const zone of zones) {
      if (!zone.area || !zone.thickness || !OBSCURING_CEILING_TYPES.includes(zone.type)) continue;
      const [x1, z1, x2, z2] = zone.area;
      if (p.x < x1 - 1e-9 || p.x > x2 + 1e-9 || p.z < z1 - 1e-9 || p.z > z2 + 1e-9) continue;
      ceilingY = Math.min(ceilingY, roomHeight - zone.thickness);
    }
    const exposedTop = Math.min(top, ceilingY);
    exposed += Math.max(0, exposedTop - sill);
    occluded += Math.max(0, top - exposedTop);
  }
  const width = dist(a, b);
  return { areaSqm: (exposed * width) / samples, occludedAreaSqm: (occluded * width) / samples };
}

/** 点是否落在矩形投影内（独立判定，不用被测代码）。 */
function insideRect(p: BaySillPoint, rect: [number, number, number, number], eps = 1e-9): boolean {
  const [x1, z1, x2, z2] = rect;
  return p.x >= x1 - eps && p.x <= x2 + eps && p.z >= z1 - eps && p.z <= z2 + eps;
}

// ───────────────────────── 合成几何（字面量构造，不为好算改产品代码） ─────────────────────────

/** 合成房间：2m×1m 矩形，层高 2.80m；computePaintSillScope 只用到 id 与 height。 */
const SYNTH_ROOM: ResolvedRoom = {
  id: 'synth_room',
  name: '合成房间',
  x: 1,
  z: 0.5,
  width: 2,
  depth: 1,
  height: 2.8,
  type: 'service',
  boundary_count: 4,
};

/**
 * 合成窗台条带：贴墙脚 z=0 的 1.1m 进深条带（outline 2m×1m 矩形 = 2㎡），
 * frontPath 是朝室内的前缘（z=1，全长 2m），wallPath 是贴墙的根缘（z=0）。
 * 端面即 x=0 / x=2 两条 1m 竖肢。
 */
function synthStrip(): BaySillGeometry {
  return {
    outline: [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 1 },
      { x: 0, z: 1 },
    ],
    segments: [],
    frontPath: [
      { x: 0, z: 1 },
      { x: 2, z: 1 },
    ],
    wallPath: [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
    ],
  };
}

/** 合成吊顶：x[0,1] 一整条 drop，底 2.65m（2.80 − 0.15），z 向覆盖整条前缘。 */
const SYNTH_DROP: CeilingZoneSpec = {
  id: 'synth_drop',
  room: SYNTH_ROOM.id,
  type: 'drop',
  thickness: 0.15,
  area: [0, 0, 1, 3],
};

/** 合成窗台：sill 2.07 / height 0.76（与 overlay.yaml 的 bay_sill 系列同值），top = 2.83。 */
const SYNTH_BAY = { sill: 2.07, height: 0.76 };
const SYNTH_TOP = SYNTH_BAY.sill + SYNTH_BAY.height; // 2.83

function declaration(faces: PaintSillFaceInput['faces'], finish: PaintSillFaceInput['finish'] = 'ordinary'): PaintSillFaceInput {
  return { id: 'synth_sill', element: 'synth_bay', room: SYNTH_ROOM.id, faces, finish };
}

// ───────────────────────── 真实链路（config 驱动，与 server 同源） ─────────────────────────

const MODEL_GEOMETRY = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0];
const OVERLAY = load(readFileSync('config/layout/overlay.yaml', 'utf8')) as {
  elements?: Array<Record<string, unknown>>;
};

const layout = resolveLayout(MODEL_GEOMETRY);
const mergedElements = mergeSceneElements(layout.walls as any, parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
const ceilingZones = loadCeilingConfig();

/** 从 overlay.yaml 直接读真实声明（不经过 server 的 loader，保证输入侧也是独立的）。 */
const REAL_DECLARATION = (OVERLAY.elements ?? []).find(
  (element) => element?.type === 'paint_sill_region' && element?.id === 'paint_master_bath_west_bay',
) as unknown as PaintSillFaceInput | undefined;

function realBaySill(): { wallRefs: NonNullable<Extract<typeof mergedElements[number], { type: 'bay_sill' }>['wallRefs']>; depth: number; sill: number; height: number } {
  const bay = mergedElements.find((element) => element.type === 'bay_sill' && element.id === 'master_bath_west_bay');
  if (!bay || bay.type !== 'bay_sill' || !bay.wallRefs?.length) throw new Error('overlay.yaml master_bath_west_bay not resolvable');
  return { wallRefs: bay.wallRefs, depth: bay.depth, sill: bay.sill, height: bay.height };
}

function realScope(): PaintSillScopeResult {
  if (!REAL_DECLARATION) throw new Error('overlay.yaml has no paint_sill_region paint_master_bath_west_bay');
  const room = layout.rooms.find((candidate) => candidate.id === REAL_DECLARATION!.room);
  if (!room) throw new Error(`resolved layout has no room ${REAL_DECLARATION.room}`);
  const bay = realBaySill();
  const geometry = buildBaySillGeometry(bay.wallRefs, layout.rooms, bay.depth);
  return computePaintSillScope(REAL_DECLARATION, geometry, bay, room, ceilingZones, layout.walls as any);
}

// ───────────────────────── ① underside 面积 = outline 多边形面积 ─────────────────────────

test('underside 面积等于 outline 多边形面积：独立鞋带公式 + 解析闭式双重对账', () => {
  // 守的不变量：顶面面积只能来自窗台脚印的 outline 多边形本身（不允许另立口径、不允许手写常量）。
  // 独立复算：(a) 本文件自己的鞋带公式跑 geom.outline；(b) 按墙线几何推解析闭式；
  // (c) 再与被测模块导出的 polygonArea 对账（项目既有的「同款算法独立复算」纪律）。
  const scope = realScope();
  const underside = scope.surfaces.find((surface) => surface.kind === 'underside');
  assert.ok(underside, 'faces 声明了 underside，必须产出一张顶面');

  const sampled = shoelace(realBaySillGeometryForCase1().outline);
  // 解析闭式（主卫西北角上飘窗，2.60×1.00 墙脚矩形，西北角内切圆角圆心 (1,2.1) r=1）：
  //   2.6×1.0 矩形 − 圆角切掉的方角 (1 − π/4) + 北墙内飘带 1.6×0.1
  //   − 飘带西端小三角 0.005 − 半径 0.1 反向偏移弧切掉的小弓形 (π·0.1²/4 − 0.005)
  const analytic = 2.6 * 1.0 - (1 - Math.PI / 4) + 1.6 * 0.1 - 0.1 * 0.1 / 2 - (Math.PI * 0.1 ** 2 / 4 - 0.1 * 0.1 / 2);
  assert.ok(Math.abs(analytic - sampled) < 0.002, `解析闭式 ${analytic} 与折线采样 ${sampled} 偏差超差（弧被 16 段折线逼近，系统性略小）`);
  assert.ok(Math.abs(sampled - underside!.areaSqm) < 1e-3, `outline 折线面积 ${sampled} 与实现顶面 ${underside!.areaSqm} 对不上`);
  assert.equal(underside!.areaSqm, 2.536); // 实测（2026-10 配置）：round3(2.536295751…)
  assert.equal(polygonArea(realBaySillGeometryForCase1().outline), sampled); // 与模块同款算法交叉对账
  assert.ok(isRoundedTo3(underside!.areaSqm));
  assert.equal(underside!.occludedAreaSqm, 0); // 顶面是水平面，不存在被吊顶遮挡一说
  assert.equal(underside!.id, REAL_DECLARATION!.id);
});

/** ① 用的几何单独取一次，避免在每个断言里重复 build。 */
let cachedRealGeometry: BaySillGeometry | undefined;
function realBaySillGeometryForCase1(): BaySillGeometry {
  cachedRealGeometry ??= buildBaySillGeometry(realBaySill().wallRefs, layout.rooms, realBaySill().depth);
  return cachedRealGeometry;
}

// ───────────────────────── ② front 面被吊顶遮挡的部分被扣除 ─────────────────────────

test('front 面只计到吊顶完成面：被遮挡段不计入面积，且外露 + 遮挡 == 宽度 × 窗台高度', () => {
  // 守的不变量：铝扣板/drop/integrated 吊顶覆盖到的垂面段，只从窗台面算到吊顶完成面，
  // 完成面以上的部分记作 occludedAreaSqm（藏而不计），且两边相加必须守恒——
  // 少算是漏账，多算是把吊顶里面的面积也算给业主。
  const geometry = synthStrip();
  const scope = computePaintSillScope(declaration(['underside', 'front']), geometry, SYNTH_BAY, SYNTH_ROOM, [SYNTH_DROP], []);

  const front = scope.surfaces.filter((surface) => surface.kind === 'front');
  assert.equal(front.length, 2, '前缘被吊顶投影边界切成两段：盖住的一段 + 外露的一段');

  // 独立复算：密采样数值积分（不做区间运算），容差 1e-3 吸收 round3。
  const expectedCovered = verticalAreaBySampling(geometry.frontPath[0], { x: 1, z: 1 }, SYNTH_BAY.sill, SYNTH_TOP, SYNTH_ROOM.height, [SYNTH_DROP]);
  const expectedExposed = verticalAreaBySampling({ x: 1, z: 1 }, geometry.frontPath[1], SYNTH_BAY.sill, SYNTH_TOP, SYNTH_ROOM.height, [SYNTH_DROP]);
  const covered = front.find((surface) => Math.abs(surface.points[1].x - 1) < 1e-9)!;
  const exposed = front.find((surface) => Math.abs(surface.points[0].x - 1) < 1e-9)!;

  // 被吊顶盖住的半段：只算 2.07 → 2.65（吊顶完成面 = 2.80 − 0.15），其余进 occluded
  assert.equal(covered.top, 2.65);
  assert.ok(Math.abs(covered.areaSqm - expectedCovered.areaSqm) < 1e-3, `${covered.areaSqm} vs ${expectedCovered.areaSqm}`);
  assert.ok(Math.abs(covered.occludedAreaSqm - expectedCovered.occludedAreaSqm) < 1e-3);
  assert.equal(covered.areaSqm, 0.58); // 1.0m 宽 × (2.65 − 2.07)
  assert.equal(covered.occludedAreaSqm, 0.18); // 1.0m 宽 × (2.83 − 2.65)

  // 外露半段：一路算到窗台顶 2.83，零遮挡
  assert.equal(exposed.top, SYNTH_TOP);
  assert.equal(exposed.areaSqm, 0.76); // 1.0m 宽 × (2.83 − 2.07)
  assert.equal(exposed.occludedAreaSqm, 0);
  assert.ok(Math.abs(exposed.areaSqm - expectedExposed.areaSqm) < 1e-3);

  // 守恒：整条前缘的面积 + 遮挡 == 总宽 × 窗台全高（2 × 0.76 = 1.52）
  const area = front.reduce((sum, surface) => sum + surface.areaSqm, 0);
  const occluded = front.reduce((sum, surface) => sum + surface.occludedAreaSqm, 0);
  assert.ok(Math.abs(area + occluded - dist(geometry.frontPath[0], geometry.frontPath[1]) * SYNTH_BAY.height) < 1e-9, '外露 + 遮挡必须守恒');
  assert.ok(Math.abs(area - 1.34) < 1e-9, `前缘外露面积 ${area}`); // 0.58 + 0.76
  assert.ok(Math.abs(occluded - 0.18) < 1e-9, `前缘遮挡面积 ${occluded}`);
});

test('吊顶完成面低于窗台面时该段完全隐蔽：零面积、不产 surface', () => {
  // 守的不变量：遮挡不是「打个折」，完成面落到窗台以下就是整段隐蔽——
  // 既不许记面积，也不许留一张 0㎡ 的占位 surface 污染明细。
  const geometry = synthStrip();
  const deepDrop: CeilingZoneSpec = { id: 'synth_deep', room: SYNTH_ROOM.id, type: 'drop', thickness: 0.9, area: [0, 0, 2, 3] };
  const scope = computePaintSillScope(declaration(['underside', 'front']), geometry, SYNTH_BAY, SYNTH_ROOM, [deepDrop], []);
  assert.deepEqual(scope.surfaces.map((surface) => surface.kind), ['underside']);
  assert.equal(scope.totalAreaSqm, 2); // 只剩顶面 2㎡；1.9m 完成面整条前缘都在吊顶里
});

// ───────────────────────── ③ 与墙完全重合的端面被排除并给 warning ─────────────────────────

test('与声明墙完全重合的端面被排除为隐蔽面，并留下指名道姓的 warning', () => {
  // 守的不变量：端面（start_end / end_end）若整段落在某条已声明墙的墙线里，
  // 它在现场被墙身/抹灰吞掉，不是可涂面——必须剔除且必须在 warnings 里留名，
  // 否则业主会为一堵墙里面的面积付两次钱。
  const geometry = synthStrip();
  const westWall: WallSegment = { id: 'w_synth_west', x1: 0, z1: 0, x2: 0, z2: 1 };
  const scope = computePaintSillScope(declaration(['underside', 'front', 'start_end', 'end_end']), geometry, SYNTH_BAY, SYNTH_ROOM, [SYNTH_DROP], [westWall]);

  assert.deepEqual(scope.warnings, ['synth_sill start_end fully coincides with a declared wall and was excluded as concealed']);
  assert.ok(!scope.surfaces.some((surface) => surface.kind === 'start_end'), '被墙吃掉的端面不许产 surface');
  // 另一端面没有墙重合，照算——排除只针对重合的那一端，不是一律砍掉端面
  const endEnd = scope.surfaces.filter((surface) => surface.kind === 'end_end');
  assert.equal(endEnd.length, 1);
  assert.equal(endEnd[0].areaSqm, 0.76); // 1.0m × (2.83 − 2.07)，x=2 在合成吊顶投影外，无遮挡
  assert.deepEqual(scope.surfaces.map((surface) => surface.kind).sort(), ['end_end', 'front', 'front', 'underside']);
});

// ───────────────────────── ④ faces 未声明的面不计算 ─────────────────────────

test('faces 没声明的面一律不算：真实声明只产出 underside / front / start_end', () => {
  // 守的不变量：这个模块是「显式声明驱动」的——声明 [underside, front, start_end] 时
  // end_end（隐藏的东端面）绝不许出现在 surfaces 里；多算一张脸就是替业主加钱。
  const scope = realScope();
  assert.deepEqual(REAL_DECLARATION!.faces, ['underside', 'front', 'start_end']);
  const kinds = new Set(scope.surfaces.map((surface) => surface.kind));
  assert.deepEqual([...kinds].sort(), ['front', 'start_end', 'underside']);
  assert.ok(!kinds.has('end_end'), 'overlay.yaml 未声明 end_end，实现不许自行补算');

  // 合成几何再验一次：只声明三张脸时端面种类严格受控
  const synth = computePaintSillScope(declaration(['underside', 'front', 'start_end']), synthStrip(), SYNTH_BAY, SYNTH_ROOM, [], []);
  assert.deepEqual([...new Set(synth.surfaces.map((surface) => surface.kind))].sort(), ['front', 'start_end', 'underside']);
  assert.equal(synth.surfaces.filter((surface) => surface.kind === 'start_end').length, 1);
});

// ───────────────────────── ⑤ finish 分流 ─────────────────────────

test('finish 分流：面积只落到声明的那一格，ordinary 与 wet_area 互斥', () => {
  // 守的不变量：湿区（主卫上飘窗）面积必须与普通墙漆面积分开落账，
  // 否则会被普通墙漆的单价/材料/人工一起吃进去——主卫是淋浴湿区，不能混算。
  const geometry = synthStrip();
  const ordinary = computePaintSillScope(declaration(['underside', 'front'], 'ordinary'), geometry, SYNTH_BAY, SYNTH_ROOM, [SYNTH_DROP], []);
  const wet = computePaintSillScope(declaration(['underside', 'front'], 'wet_area'), geometry, SYNTH_BAY, SYNTH_ROOM, [SYNTH_DROP], []);

  assert.equal(ordinary.areaByFinish.ordinary, ordinary.totalAreaSqm);
  assert.equal(ordinary.areaByFinish.wet_area, 0);
  assert.equal(wet.areaByFinish.wet_area, wet.totalAreaSqm);
  assert.equal(wet.areaByFinish.ordinary, 0);
  assert.equal(ordinary.totalAreaSqm, wet.totalAreaSqm); // 同一几何，finish 只改分流不改面积
  assert.equal(ordinary.totalAreaSqm, 3.34); // 顶面 2.0 + 前缘外露 1.34

  // 真实声明走 wet_area：普通墙漆那一格必须是 0
  const scope = realScope();
  assert.equal(REAL_DECLARATION!.finish, 'wet_area');
  assert.equal(scope.areaByFinish.wet_area, scope.totalAreaSqm);
  assert.equal(scope.areaByFinish.ordinary, 0);
});

// ───────────────────────── ⑥ 真实声明端到端 ─────────────────────────

test('真实声明端到端：paint_master_bath_west_bay 的面积/种类/告警可逐项对账', () => {
  // 守的不变量：从 overlay.yaml 声明 → buildBaySillGeometry → 真实 master_bath 房间
  // → 真实 config/ceiling.yaml 跑通，且每个数字都能从 config 独立推出来（给业主看的账）。
  // 实测来源：npx tsx --test tests/server/paint-sill-scope.test.ts（本文件 ⑥）
  // 于 HEAD=3bdff54 + 未提交的 paint-sill-scope.ts / overlay.yaml / ceiling.yaml 下测得；
  // 各期望值的推导见下方注释。
  const scope = realScope();
  const bay = realBaySill();
  const room = layout.rooms.find((candidate) => candidate.id === REAL_DECLARATION!.room)!;
  const geometry = buildBaySillGeometry(bay.wallRefs, layout.rooms, bay.depth);
  const masterBathCeiling = ceilingZones.find((zone) => zone.id === 'ceiling_master_bath')!;

  assert.ok(scope.totalAreaSqm > 0);
  assert.deepEqual(scope.warnings, []); // 三张脸都没有与声明墙重合，fail-closed 不需要触发
  assert.deepEqual([...new Set(scope.surfaces.map((surface) => surface.kind))].sort(), ['front', 'start_end', 'underside']);

  // 窗台与吊顶的标高全部从 config 独立推得：sill/height 来自 overlay.yaml 的 bay_sill，
  // 铝扣板完成面 = 房间层高 − ceiling.yaml 的 ceiling_master_bath.thickness。
  assert.equal(bay.sill, 2.07);
  assert.equal(bay.height, 0.76);
  assert.equal(masterBathCeiling.thickness, 0.15);
  const ceilingFinish = room.height - masterBathCeiling.thickness; // 2.80 − 0.15 = 2.65
  assert.equal(ceilingFinish, 2.65);

  // 顶面：outline 折线鞋带公式（36 点，含 16 段圆角折线 + 16 段反向小弧折线）
  const underside = scope.surfaces.find((surface) => surface.kind === 'underside')!;
  assert.equal(underside.areaSqm, 2.536); // round3(2.536295751…) = 实测 2.536

  // 前缘：整条 frontPath 都落在 ceiling_master_bath 的投影 [0,1.1,2.6,2.86] 内
  //（独立点判定），所以每一段都只算到 2.65 完成面，2.65→2.83 记遮挡。
  assert.ok(geometry.frontPath.every((point) => insideRect(point, masterBathCeiling.area!)));
  const frontSurfaces = scope.surfaces.filter((surface) => surface.kind === 'front');
  assert.equal(frontSurfaces.length, geometry.frontPath.length - 1); // 17 段（16 段弧折线 + 1 段直线）
  for (const surface of frontSurfaces) {
    assert.equal(surface.bottom, 2.07);
    assert.equal(surface.top, ceilingFinish);
    assert.ok(isRoundedTo3(surface.areaSqm) && isRoundedTo3(surface.occludedAreaSqm));
    // 逐段守恒：外露 + 遮挡 == 段宽 × 0.76（容差 1e-3 吸收 round3）
    assert.ok(Math.abs(surface.areaSqm + surface.occludedAreaSqm - dist(surface.points[0], surface.points[1]) * bay.height) < 1e-3);
  }
  const frontWidth = geometry.frontPath.slice(1).reduce((sum, point, index) => sum + dist(geometry.frontPath[index], point), 0);
  assert.ok(Math.abs(frontWidth - 1.757017) < 1e-6, `前缘总宽 ${frontWidth}`);
  const frontArea = frontSurfaces.reduce((sum, surface) => sum + surface.areaSqm, 0);
  const frontOccluded = frontSurfaces.reduce((sum, surface) => sum + surface.occludedAreaSqm, 0);
  assert.equal(frontArea, 1.024); // 实测：16 × 0.006 + 0.928（逐段 round3 后累加）
  assert.equal(frontOccluded, 0.32); // 实测：16 × 0.002 + 0.288
  // 独立复算（整条前缘一次算，不逐段 round3）：1.757017 × 0.58 = 1.019070 / × 0.18 = 0.316263
  assert.ok(Math.abs(frontWidth * (ceilingFinish - bay.sill) - frontArea) < 0.01, '前缘外露面积与总宽 × 外露高度对账');
  assert.ok(Math.abs(frontWidth * (bay.sill + bay.height - ceilingFinish) - frontOccluded) < 0.01, '前缘遮挡面积与总宽 × 遮挡高度对账');

  // start_end 端面：从 wallPath[0] 到 frontPath[0]，同样整段在铝扣板投影内 → 只算到 2.65
  // ⚠ 已知缺陷（不在本文件修，仅登记）：buildBaySillGeometry 第 189 行
  //   `[...outerLeft, ...outerRight.reverse()]` 的 reverse() 是原地反转，
  //   返回的 wallPath 因此与 frontPath 方向相反，start_end/end_end 于是被配成
  //   「横跨整条窗台的斜肢」而不是两端的 1.1m 端面。当前模型输出即下列实测值；
  //   若按声明 reason「西端面」的本意，应为 (0,2.1)→(1.1,2.1) 宽 1.1m、
  //   外露 1.1 × 0.58 = 0.638㎡。修复前本测试只锁当前行为 + 守守恒，不背书语义。
  const startEnd = scope.surfaces.filter((surface) => surface.kind === 'start_end');
  assert.equal(startEnd.length, 1);
  assert.equal(startEnd[0].bottom, 2.07);
  assert.equal(startEnd[0].top, ceilingFinish);
  assert.equal(startEnd[0].areaSqm, 1.046); // 实测：round3(1.802776 × 0.58) = 1.046
  assert.equal(startEnd[0].occludedAreaSqm, 0.324); // 实测：round3(1.802776 × 0.18) = 0.324
  const capWidth = dist(geometry.wallPath[0], geometry.frontPath[0]);
  assert.ok(Math.abs(capWidth - 1.802776) < 1e-6, `端面宽度 ${capWidth}`);
  assert.ok(Math.abs(capWidth * (ceilingFinish - bay.sill) - startEnd[0].areaSqm) < 1e-3);
  assert.ok(Math.abs(capWidth * (bay.sill + bay.height - ceilingFinish) - startEnd[0].occludedAreaSqm) < 1e-3);

  // 汇总账（业主口径）：顶面 + 前缘 + 端面
  assert.equal(scope.totalAreaSqm, 4.606); // 实测：2.536 + 1.024 + 1.046
  assert.equal(scope.areaByFinish.wet_area, 4.606);
  assert.equal(scope.areaByFinish.ordinary, 0);
  for (const surface of scope.surfaces) {
    assert.ok(isRoundedTo3(surface.areaSqm), '面积必须四舍五入到 3 位');
    assert.ok(surface.areaSqm >= 0 && surface.occludedAreaSqm >= 0);
  }
});

// ───────────────────────── ⑦ fail-closed ─────────────────────────

test('fail-closed：paint_sill_region 引用不存在的 bay_sill 或房间时 computePaintScopeForLayout 抛错', () => {
  // 守的不变量：声明引用悬空（element / room 不存在）时绝不静默算 0㎡ 糊弄，
  // 必须抛错让路由降级——与 tile/paint 其他模块同一套 fail-closed 纪律。
  const catalog = ProjectCatalog.load('.');
  const inputs = loadPaintScopeInputs();
  const real = inputs.sillRegions[0];
  assert.ok(real, 'overlay.yaml 至少声明一条 paint_sill_region');

  assert.throws(
    () => computePaintScopeForLayout(layout, catalog, { ...inputs, sillRegions: [{ ...real, element: 'no_such_bay_sill' }] }),
    /references unresolved bay_sill no_such_bay_sill/,
  );
  assert.throws(
    () => computePaintScopeForLayout(layout, catalog, { ...inputs, sillRegions: [{ ...real, room: 'no_such_room' }] }),
    /references unknown room no_such_room/,
  );
});
