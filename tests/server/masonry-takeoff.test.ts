import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { resolveLayout } from '../../server/layout-resolver.js';
import {
  computeMasonryTakeoff,
  masonryOpeningSpans,
  masonryPointAt,
  masonryTileableWallLength,
  masonryUnionLength,
  masonryWallLength,
  type MasonryTakeoffInput,
  type MasonryWallInput,
} from '../../shared/masonry-takeoff.js';

// 瓦工算量子系统（shared/masonry-takeoff.ts）。DEC-2026-10-13「预算计算架构根治」阶段 2 第一半。
// 四道防线：
//   ① overlay 的 wall_region / sill_region 声明能过 L2 几何交叉层（不抛错）
//   ② 数量独立复算：声明值 vs 从 model-geometry 推出的几何值，逐房对账
//   ③ fail-closed：坏输入（suppress 墙 / along 越界 / 二维重叠 / 超净高 / 盖住洞口）必须抛错
//   ④ 显形清单：没有计价归属的量（生活阳台地面、反边/开孔 extras）必须出现在 unpriced/unresolved
//
// 与 tmp/verify-wall-tile.ts 的关系：那个脚本（.gitignore 里、退出码 1）是同一套 L2 的**打印版**，
// 且它的 DEC 对账锚点停在 R11（15.33㎡ / 1.86㎡ / 4.80m）。本测试钉的是 overlay 当前声明的实算值。

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OV: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));

/** overlay.suppress 压制的墙 id（玻璃幕墙 / 实体已删除）。 */
function suppressedWallIds(): Set<string> {
  const ids = new Set<string>();
  for (const entry of OV.suppress ?? []) {
    for (const key of ['wall', 'walls'] as const) {
      const value = (entry as Record<string, unknown>)[key];
      if (!value) continue;
      for (const wall of Array.isArray(value) ? value : [value]) ids.add(String(wall));
    }
  }
  return ids;
}

const SUPPRESSED = suppressedWallIds();

/** config → 模块输入。与 tmp/verify-wall-tile.ts 的解析口径一致（js-yaml，不用正则）。 */
function buildInput(): MasonryTakeoffInput {
  const layout = resolveLayout(MG);
  const walls: MasonryWallInput[] = (layout.walls as any[]).map((wall) => ({
    id: wall.id,
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    ...(wall.segments?.length
      ? { segments: wall.segments.map((segment: any) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 })) }
      : {}),
    ...(wall.openings?.length ? { openings: wall.openings } : {}),
    suppressed: SUPPRESSED.has(wall.id),
  }));
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));
  const elements: any[] = OV.elements ?? [];

  const baySills = elements
    .filter((element) => element.type === 'bay_sill')
    .map((element) => {
      const wallIds: string[] = element.walls ?? (element.wall ? [element.wall] : []);
      const wall = wallById.get(wallIds[0]);
      return {
        id: element.id,
        wall: wallIds[0],
        height: element.height,
        depth: element.depth,
        sill: element.sill ?? 0,
        ...(wall?.segments ? { segments: wall.segments } : {}),
      };
    });

  const rooms = (layout.rooms as any[]).filter((room) => !room.semantic_only).map((room) => ({
    id: room.id,
    areaSqm: room.area ?? room.width * room.depth,
    // 异形房给 boundary 折线；轴对齐矩形房给包围盒（resolveRoom 的 x/z/width/depth 口径）。
    ...((room.points ?? []).length
      ? { points: room.points.map((point: any) => ({ x: point.x, z: point.z })) }
      : { rect: { x: room.x, z: room.z, width: room.width, depth: room.depth } }),
  }));

  return {
    walls,
    wallRegions: elements
      .filter((element) => element.type === 'wall_region')
      .map((element) => ({
        id: element.id,
        wall: element.wall,
        room: element.room,
        along: element.along,
        bottom: element.bottom ?? 0,
        height: element.height,
        zone: element.zone,
      })),
    sillRegions: elements
      .filter((element) => element.type === 'sill_region')
      .map((element) => ({
        id: element.id,
        element: element.element,
        room: element.room,
        face: element.face,
        along: element.along,
        zone: element.zone,
      })),
    baySills,
    rooms,
    // config/tile-comparison.yaml 的 dry_room_ids（六个干区主地面）；湿区 = 两间卫生间。
    dryRoomIds: ['living_dining', 'kitchen', 'master_bedroom', 'study', 'bedroom_nw', 'bedroom_se'],
    wetRoomIds: ['master_bath', 'guest_bath'],
    floorRegions: elements
      .filter((element) => element.type === 'floor_region')
      .map((element) => ({
        id: element.id,
        // 面积为调用方责任（圆角闭式解暂在 server/budget-calculator.ts）；测试里用朴素多边形面积，
        // north_platform_floor 的圆角不计（它被 excluded，只验证「被排除」不验证面积）。
        areaSqm: Math.abs(
          (element.points ?? []).reduce((sum: number, point: any, index: number, all: any[]) => {
            const next = all[(index + 1) % all.length];
            return sum + point.x * next.z - next.x * point.z;
          }, 0) / 2,
        ),
        points: (element.points ?? []).map((point: any) => ({ x: point.x, z: point.z })),
        excluded: element.excluded === true,
        follow: element.follow,
      })),
    // 厨卫铝扣板完成面。必填、不设默认值（阶段 4 要清掉的正是 `?? 2.65` 这类兜底）。
    clearHeight: 2.65,
  };
}

const close = (actual: number, expected: number, note?: string, tolerance = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `期望 ${expected}，实际 ${actual}（差 ${(actual - expected).toFixed(9)}）${note ? ` — ${note}` : ''}`,
  );
};

// ── ① L2 几何交叉层：现行声明必须全部通过（不抛错）────────────────────────────

test('overlay 的 37 段贴砖声明全部通过 L2 几何交叉层', () => {
  const result = computeMasonryTakeoff(buildInput());
  assert.equal(result.regions.length, 37, 'wall_region 17 + sill_region 20');
  assert.equal(result.regions.filter((region) => region.kind === 'wall').length, 17);
  assert.equal(result.regions.filter((region) => region.kind === 'sill').length, 20);
  assert.deepEqual(result.unknownRoomZoneIds, [], '所有声明的 room 都在房间表里');
  assert.deepEqual(result.unknownDryRoomIds, []);
  assert.deepEqual(result.unknownWetRoomIds, []);
  assert.deepEqual(result.unresolved, [], '没有解析缺口');
  assert.equal(result.openingsProjected > 0, true, '洞口已投影，F07a 校验真的跑了');
});

// ── ② 数量独立复算 ───────────────────────────────────────────────────────────

test('wall_region 17 段实算 21.256㎡，逐房拆分', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.wallTileSqm, 21.2555);
  close(result.byRoom.kitchen.wallTileSqm, 9.9);
  close(result.byRoom.balcony.wallTileSqm, 0.81);
  close(result.byRoom.master_bath.wallTileSqm, 3.7705);
  close(result.byRoom.guest_bath.wallTileSqm, 6.775);
  close(result.byRoom.living_dining.wallTileSqm, 0, '客厅只有 sill_region（防水台），没有 wall_region');
});

test('sill_region 20 段实算 15.468㎡（含卧室/书房防水台 front+top）', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.sillTileSqm, 15.468099347, undefined, 1e-4);
  close(result.byRoom.kitchen.sillTileSqm, 6.516, 'kitchen_north_bay front 3.60×0.71 + underside 3.60×1.10');
  close(result.byRoom.master_bath.sillTileSqm, 1.17905, undefined, 1e-4);
  close(result.byRoom.living_dining.sillTileSqm, 1.86, '客厅防水台 front 6.20×0.15 + top 6.20×0.15');
  close(result.byRoom.master_bedroom.sillTileSqm, 3.2130496735, '主卧 west_upper 3.25m + west_mid 2.69m + south 4.770165578m，front+top 各 0.15m');
  close(result.byRoom.study.sillTileSqm, 0.9, '书房 south 3.00m，front+top 各 0.15m');
  close(result.byRoom.bedroom_nw.sillTileSqm, 0.9, '西北次卧 north 3.00m，front+top 各 0.15m');
  close(result.byRoom.bedroom_se.sillTileSqm, 0.9, '东南客房 south 3.00m，front+top 各 0.15m');
  // 单条最大的一块：厨房上飘窗底面（DEC-2026-10-09-P09 业主裁定「底面肯定要的」）
  const underside = result.regions.find((region) => region.id === 'silltile_kitchen_north_bay_underside')!;
  close(underside.areaSqm, 3.96);
  close(underside.band, 1.1, 'underside 用 bay_sill 的 depth，不是 height');
  close(underside.planeY!, 2.12, 'underside 标高 = target.sill（与 SceneBuilder 的 position.y 同源）');
  const front = result.regions.find((region) => region.id === 'silltile_kitchen_north_bay_front')!;
  close(front.band, 0.71, 'front 用 bay_sill 的 height');
  close(front.bottom, 2.12);
  close(front.top, 2.83, 'front 是竖面，top = sill + height');
});

test('全部贴砖 36.853㎡ = wall_region + sill_region', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.totalTileSqm, 36.723599347, undefined, 1e-4);
  close(result.totalTileSqm, result.wallTileSqm + result.sillTileSqm);
  assert.deepEqual(Object.keys(result.byZone), ['visible'], 'C18 废止杂砖后全部 zone=visible');
});

test('along 单位是米不是毫米（0.5–2.9 = 2.4m，除 1000 会得 0.02㎡）', () => {
  const result = computeMasonryTakeoff(buildInput());
  const region = result.regions.find((item) => item.id === 'walltile_kitchen_ent_west')!;
  close(region.from, 0.5);
  close(region.to, 2.9);
  close(region.spanM, 2.4);
  close(region.areaSqm, 2.4 * 2.65, '6.36㎡；若误按毫米会得到 0.024㎡');
});

test('干区地面 111.864㎡ / 湿区 7.726㎡ / 合计 119.59㎡', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.dryRoomFloorSqm, 111.864);
  close(result.wetRoomFloorSqm, 7.726);
  close(result.totalRoomFloorSqm, 119.59);
  // 与 schedule/phase-1/control.yaml:1081 的锚点（干区 111.864 + 湿区 7.726 = 119.59）逐位一致
  close(result.byRoom.living_dining.dryFloorSqm, 44.58);
  close(result.byRoom.kitchen.dryFloorSqm, 8.64, '厨房归干区主地面（KT 200×1200 木纹砖）');
  close(result.byRoom.master_bath.wetFloorSqm, 4.576);
  close(result.byRoom.guest_bath.wetFloorSqm, 3.15);
});

test('floor_region：走廊 3.75㎡ 计入，落在已计费房内的 10.39㎡ 跳过，14.505㎡ 显式排除', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.floorRegionExtraSqm, 3.75, 'main_corridor_floor（DEC-2026-10-09-P16）');
  close(result.floorRegionSkippedInsideRoomSqm, 10.39, 'corridor_floor 6.75（整块在 study 内）+ entry_foyer_floor 3.64（整块在 living_dining 内）');
  close(result.floorRegionExcludedSqm, 14.505, 'entry_garden_floor 12.905 + north_platform_floor 1.60（圆角真实面积 1.3854 由调用方给）');
  close(result.dryFloorSqm, 111.864 + 3.75, '干区含走廊 extra');
  assert.deepEqual(result.skippedInsideRoomFloorRegionIds, ['entry_foyer_floor', 'corridor_floor']);
  assert.deepEqual(result.excludedFloorRegionIds, ['entry_garden_floor', 'north_platform_floor']);
});

test('防水台延长米 33.440m（按构件对 run 取并集，一条矮台只算一次台长）', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.extrasLinearM, 33.440331156477376);
  close(result.byRoom.living_dining.extrasLinearM, 6.2, 'COST-060-05 的「20 元/米 × 6.20m ≈ 124 元」同口径');
  close(result.byRoom.kitchen.extrasLinearM, 3.6);
  close(result.byRoom.master_bath.extrasLinearM, 0.76 + 3.170165578477376);
  close(result.byRoom.master_bedroom.extrasLinearM, 10.710165578, '主卧 west_upper + west_mid + south 防水台取构件并集');
  close(result.byRoom.study.extrasLinearM, 3.0);
  close(result.byRoom.bedroom_nw.extrasLinearM, 3.0);
  close(result.byRoom.bedroom_se.extrasLinearM, 3.0);
  // 逐面 run 之和（front/top 各算各的）与去重后台长必须分开显形，否则 20 元/米会被双计
  close(result.sillFaceLinearM, 66.88066231295475);
  assert.ok(result.sillFaceLinearM > result.extrasLinearM * 1.9, 'front+top 两条面 ≈ 2× 台长');
});

test('L2 独立推导：可贴墙长 vs 声明 union（厨房 4.80 / 主卫 4.36 / 客卫 5.70 / 阳台 3.90）', () => {
  const result = computeMasonryTakeoff(buildInput());
  close(result.tileableWallLengthM.kitchen, 4.8);
  close(result.tileableWallLengthM.master_bath, 4.36, '北墙 suppress_north_recess、西墙 suppress_west_wall 均为玻璃幕墙');
  close(result.tileableWallLengthM.guest_bath, 5.7, '南侧 z=4.30 不封横墙');
  close(result.tileableWallLengthM.balcony, 3.9, 'D3=B 口径：门洞墙阳台侧 1.20m 既定不贴');
  // 声明 union 必须 ⊆ 可贴墙长（union 按墙分组，多段堆叠只算一次墙长）
  for (const room of ['kitchen', 'master_bath', 'guest_bath', 'balcony', 'living_dining']) {
    const declared = result.declaredUnionLengthM[room] ?? 0;
    const tileable = result.tileableWallLengthM[room] ?? 0;
    assert.ok(declared <= tileable + 1e-9, `${room} 声明 union ${declared} 超可贴墙长 ${tileable}`);
  }
  close(result.declaredUnionLengthM.guest_bath, 5.7, '客卫声明把可贴墙长贴满');
  close(result.declaredUnionLengthM.balcony, 2.7, '阳台只贴洗衣机墙 + 南墙，缺口 1.20m = 门洞墙阳台侧');
  close(result.declaredUnionLengthM.kitchen, 4.0, '缺口 0.80m = w_balc_east 上的 d_kit_balc 门洞（P11 瓷砖不扣洞）');
  close(result.declaredUnionLengthM.master_bath, 3.56, '缺口 0.80m = w_mbath_south 上的 d_mbath 门洞（P11）');
});

test('生活阳台地面 1.92㎡ 既不在干区也不在湿区 → 显形，不静默计入任何一档', () => {
  const result = computeMasonryTakeoff(buildInput());
  assert.deepEqual(result.unresolvedRoomIds, ['balcony', 'entry_garden', 'elevator_shaft']);
  assert.ok(!result.unresolvedRoomIds.includes('main_corridor'), 'semantic-only 走廊不作为独立房间地面计量');
  assert.ok(Math.abs(result.floorRegionExtraSqm - 3.75) < 1e-9, '主走廊地面仅由 main_corridor_floor 显式计量');
  const balcony = result.unpriced.find((item) => item.id === 'balcony')!;
  close(balcony.quantity!, 1.92);
  // 反边/开孔/壁龛在 overlay 无声明源，必须显形（COST-060-05 锚点待报价轮）
  assert.ok(result.unpriced.some((item) => item.id === 'extras_uncovered'), 'extras 无声明源必须显形');
  // 生活阳台虽不进门地面干/湿两档，墙砖声明照算（D3=B 湿区 0.30m 口径）
  close(result.byRoom.balcony.wallTileSqm, 0.81);
});

test('sill_region 贴附 suppress 幕墙合法但留名；弧墙缺 along 的口径分叉必须告警', () => {
  const result = computeMasonryTakeoff(buildInput());
  const suppressed = result.regions.filter((region) => region.kind === 'sill' && region.suppressedWall);
  assert.equal(suppressed.length, 20, '20 条 sill_region 全部落在玻璃幕墙根部（防水台/上飘窗）');
  const arcWarnings = result.warnings.filter((warning) => warning.includes('是弧墙'));
  assert.equal(arcWarnings.length, 4, 'mbath_north 与 master_bedroom_south 两座弧墙防水台的 front/top 未声明 along');
  assert.ok(
    arcWarnings[0].includes('3.1702') && arcWarnings[0].includes('2.7857'),
    '告警必须同时给出折线全长与弦长，业主才能判断补哪个 along',
  );
  assert.ok(arcWarnings.some((warning) => warning.includes('silltile_master_bedroom_south_front')),
    '主卧南墙弧墙防水台 front 的折线/弦长分叉必须显形');
  assert.ok(arcWarnings.some((warning) => warning.includes('silltile_master_bedroom_south_top')),
    '主卧南墙弧墙防水台 top 的折线/弦长分叉必须显形');
});

// ── ③ fail-closed：坏输入必须抛错 ────────────────────────────────────────────

test('fail-closed：wall_region 引用 suppress 的玻璃幕墙即抛错', () => {
  const input = buildInput();
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_kitchen_west_stub' ? { ...region, wall: 'w_kit_north' } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /references suppressed wall w_kit_north/);
});

test('fail-closed：wall_region 引用不存在的墙即抛错', () => {
  const input = buildInput();
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_kitchen_west_stub' ? { ...region, wall: 'w_does_not_exist' } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /references unknown wall w_does_not_exist/);
});

test('fail-closed：sill_region 引用不存在的 bay_sill 即抛错', () => {
  const input = buildInput();
  input.sillRegions = input.sillRegions.map((region) =>
    region.id === 'silltile_living_south_front' ? { ...region, element: 'no_such_ledge' } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /references unknown bay_sill no_such_ledge/);
});

test('fail-closed：along 越出墙长即抛错', () => {
  const input = buildInput();
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_kitchen_west_stub' ? { ...region, along: [0, 0.9] as [number, number] } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /along \[0, 0\.9\] is outside wall w_kit_west/);
});

test('fail-closed：sill_region 的 along 越出构件 run 即抛错', () => {
  const input = buildInput();
  input.sillRegions = input.sillRegions.map((region) =>
    region.id === 'silltile_living_south_front' ? { ...region, along: [0, 99] as [number, number] } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /along \[0, 99\] is outside target run/);
});

test('fail-closed：同 (墙,房间) 沿墙+竖向同时重叠即抛错（竖直接帖合法）', () => {
  const input = buildInput();
  // 主卫南墙：淋浴段 [0,1.15]×[0,2.65] 之上再叠一段 [0.5,1.5]×[0,0.30] → 二维重叠
  input.wallRegions = [
    ...input.wallRegions,
    { id: 'walltile_probe_overlap', wall: 'w_mbath_south', room: 'master_bath', along: [0.5, 1.5] as [number, number], bottom: 0, height: 0.3 },
  ];
  assert.throws(() => computeMasonryTakeoff(input), /walltile_probe_overlap 二维重叠/);

  // 竖直接贴不算双计（R11：东墙 0.90m 带与 0.90→1.40m 挡水条同墙堆叠合法）
  const stacked = buildInput();
  stacked.wallRegions = [
    ...stacked.wallRegions,
    { id: 'walltile_probe_stacked', wall: 'w_mbath_south', room: 'master_bath', along: [1.95, 2.6] as [number, number], bottom: 0.3, height: 0.9 },
  ];
  const stackedResult = computeMasonryTakeoff(stacked);
  assert.ok(stackedResult.regions.some((region) => region.id === 'walltile_probe_stacked'));
});

test('fail-closed：同一 bay_sill 同一标高的水平贴砖面沿墙重叠即抛错', () => {
  const input = buildInput();
  input.sillRegions = [
    ...input.sillRegions,
    { id: 'silltile_probe_top_dup', element: 'living_south_waterproof_ledge', room: 'living_dining', face: 'top' as const, along: [1, 3] as [number, number] },
  ];
  assert.throws(() => computeMasonryTakeoff(input), /水平贴砖面沿墙重叠/);
});

test('fail-closed：贴砖带顶标高超净高即抛错（弧墙防水台按 sill 标高豁免）', () => {
  const input = buildInput();
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_mbath_south_shower' ? { ...region, height: 2.8 } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /顶标高 2\.8 超净高 2\.65/);
  // clearHeight 必填：不设默认值，缺了就直接抛（阶段 4 要清掉的 `?? 2.65`）
  const noClearHeight = buildInput();
  delete (noClearHeight as Partial<MasonryTakeoffInput>).clearHeight;
  assert.throws(() => computeMasonryTakeoff(noClearHeight as MasonryTakeoffInput), /clearHeight 必填/);
});

test('fail-closed：瓷砖声明盖住门洞即抛错（瓷砖不扣洞，DEC-2026-10-09-P11 F07a）', () => {
  const input = buildInput();
  // w_mbath_south 的门洞 d_mbath 沿墙 [1.15,1.95]；把淋浴段推回 P11 之前的 [0,1.20]
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_mbath_south_shower' ? { ...region, along: [0, 1.2] as [number, number] } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /盖住门洞 d_mbath/);
});

test('fail-closed：声明区间越出该房间侧脸即抛错（贴错脸 / 区间爬进邻居家）', () => {
  const input = buildInput();
  // w_mbath_east 只有 z[1.10,2.86] 属于主卫；along 推到 2.00 就爬到邻居家
  input.wallRegions = input.wallRegions.map((region) =>
    region.id === 'walltile_mbath_east' ? { ...region, along: [0, 2.0] as [number, number] } : region,
  );
  assert.throws(() => computeMasonryTakeoff(input), /不在房间 master_bath 的 boundary 上/);
});

test('fail-closed：dryRoomIds 与 wetRoomIds 交叠即抛错', () => {
  const input = buildInput();
  input.dryRoomIds = [...input.dryRoomIds, 'master_bath'];
  assert.throws(() => computeMasonryTakeoff(input), /dryRoomIds 与 wetRoomIds 交叠/);
});

// ── ④ 纯函数 ────────────────────────────────────────────────────────────────

test('纯函数：墙长 / 沿线取点 / 洞口投影 / union', () => {
  const layout = resolveLayout(MG);
  const arcWall = (layout.walls as any[]).find((wall) => wall.id === 'w_bath_north')!;
  const wall: MasonryWallInput = {
    id: arcWall.id,
    x1: arcWall.x1,
    z1: arcWall.z1,
    x2: arcWall.x2,
    z2: arcWall.z2,
    segments: arcWall.segments.map((segment: any) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 })),
  };
  close(masonryWallLength(wall), 3.170165578477376, '弧墙按折线累计，不是弦长');
  const straight: MasonryWallInput = { id: 'w_balc_west', x1: 5.6, z1: 1, x2: 5.6, z2: 2.2 };
  close(masonryWallLength(straight), 1.2);
  const mid = masonryPointAt(straight, 0.6)!;
  close(mid.x, 5.6);
  close(mid.z, 1.6);
  assert.equal(masonryPointAt(straight, 99), null, '越界返回 null 而不是外推');

  const withOpening: MasonryWallInput = {
    id: 'w_mbath_south',
    x1: 0,
    z1: 2.86,
    x2: 2.6,
    z2: 2.86,
    openings: [{ id: 'd_mbath', type: 'door', x: 1.55, z: 2.86, width: 0.8, height: 2.1 }],
  };
  const spans = masonryOpeningSpans(withOpening);
  assert.equal(spans.length, 1);
  close(spans[0].from, 1.15, 'offset 语义是「锚点到洞口中心」，与 layout-resolver 同口径');
  close(spans[0].to, 1.95);
  close(spans[0].bottom, 0);
  close(spans[0].top, 2.1);

  close(masonryUnionLength([[0, 1], [1, 1.2], [0.5, 2]]), 2, '相接与重叠都只算一次');
  close(masonryUnionLength([]), 0);
});

test('纯函数：masonryTileableWallLength 与 tmp/verify-wall-tile.ts 的 tileableOf 同值', () => {
  const layout = resolveLayout(MG);
  const walls: MasonryWallInput[] = (layout.walls as any[]).map((wall) => ({
    id: wall.id,
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    ...(wall.segments?.length
      ? { segments: wall.segments.map((segment: any) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 })) }
      : {}),
    suppressed: SUPPRESSED.has(wall.id),
  }));
  const points = (id: string): Array<{ x: number; z: number }> => {
    const room = (layout.rooms as any[]).find((candidate) => candidate.id === id)!;
    return (room.points ?? []).map((point: any) => ({ x: point.x, z: point.z }));
  };
  // tmp/verify-wall-tile.ts L2 的四个锚点（DEC-2026-10-07-R06 复算改判后的值）
  close(masonryTileableWallLength(points('kitchen'), walls), 4.8);
  close(masonryTileableWallLength(points('master_bath'), walls), 4.36);
  close(masonryTileableWallLength(points('guest_bath'), walls), 5.7);
  close(masonryTileableWallLength(points('balcony'), walls), 3.9);
  // suppress 的墙不计：主卫北墙/西墙整段是玻璃幕墙
  close(masonryTileableWallLength(points('master_bath'), walls.filter((wall) => !wall.suppressed)), 4.36);
});
