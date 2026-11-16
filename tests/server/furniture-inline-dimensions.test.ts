import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { buildCliHouseScene } from '../../scripts/render/cli-house-scene.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import {
  resolveFurniturePlacements,
  type PlacementItem,
  type WallLike,
} from '../../shared/furniture-placement.js';
import { buildFixture } from '../../shared/render/FixtureFactory.js';
import { parseCeilingZones } from '../../shared/project-render-facts-schema.js';
import { FURNITURE_DIMS, type FurnishingItem, type VertexLayoutYaml } from '../../shared/types.js';

const ROOT = resolve(import.meta.dirname, '../..');

// 回归：书房南延腿在 house.yaml 上带行内 width 2.182 / depth 0.55（目录 1.70×0.55）；
// 北段带行内 width 1.80（2026-10-27 齐平：西延顶墙）。
// 2026-10-27 业主反馈：渲染里的腿仍按目录 1.70m 画，北端离原柜、南端离墙垛各留 0.255m 缝
// （模型 AABB 是对的，渲染错）——SceneBuilder 通用家具路径只认目录尺寸，不认行内尺寸。
// 本测试断言渲染几何与模型 AABB 同口径：腿北端贴北段门面、南端贴墙垛北脸；北段西脸顶西墙。
// 2026-10-27 DEC-2026-10-27-R02 通顶：腿沿边吊南缘拆为北段 stub 与南段高腿；
// 通用路径 Y 缩放（cabinetHeight / 配方实建高）断言见第二个测试（红绿验证：暂藏 Y 缩放应失败）。
//
// 断言口径（2026-11-16 规则化）：期望值一律由当轮 config 派生，不钉绝对坐标——
// 摆位由解算器独立复算、行内尺寸直读 house.yaml 声明、配方实建尺寸由 buildFixture
// 实测、拆分点直读 ceiling_corridor 带南缘、背板贴合线直读宿主墙线。渲染与解算/声明
// 不一致即红；配置改动后本测试跟随新声明走，不再手改期望值。

const NORTH_ID = 'study.seasonal_wardrobe_wall';
const STUB_ID = 'study.seasonal_wardrobe_step_north';
const TALL_ID = 'study.seasonal_wardrobe_step_south';
const CEILING_BAND_ID = 'ceiling_corridor';

interface WardrobeContext {
  items: Record<string, FurnishingItem>;
  placements: Map<string, { x: number; z: number; rotation?: number }>;
  catalog: { width: number; depth: number };
  built: { width: number; depth: number; height: number };
  /** 门面余量 = 配方实建深 − 目录深（配方固有，实测得出，非手写值）。 */
  doorAllowance: number;
  /** 拆分点：ceiling_corridor 带南缘 z（直读 ceiling.yaml）。 */
  bandSouthEdge: number;
  /** 边吊底 = 书房层高 − 带厚（直读 model-geometry + ceiling.yaml）。 */
  bandBottom: number;
  /** 书房层高（直读 model-geometry）。 */
  roomHeight: number;
  /** 书房西缘（直读 model-geometry 房间声明：中心 x − 宽/2）。 */
  roomWestEdge: number;
  /** 宿主墙线：id → 沿墙常量坐标（南北墙取 x、东西墙取 z）。 */
  wallLine: Map<string, number>;
}

function loadWardrobeContext(): WardrobeContext {
  const house = loadYaml(readFileSync(`${ROOT}/config/house.yaml`, 'utf8')) as {
    furnishings: Record<string, FurnishingItem[]>;
  };
  const allItems = Object.values(house.furnishings).flat();
  const items: Record<string, FurnishingItem> = {};
  for (const id of [NORTH_ID, STUB_ID, TALL_ID]) {
    const item = allItems.find((candidate) => candidate.id === id);
    assert.ok(item, `${id} must be declared in config/house.yaml`);
    items[id] = item;
  }
  const layout = resolveLayout(
    loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml,
  );
  const wallSegments = new Map<string, WallLike[]>(
    layout.walls.map((wall) => [wall.id, wall.segments?.length ? wall.segments : [wall]]),
  );
  const { placements, diagnostics } = resolveFurniturePlacements(
    [NORTH_ID, STUB_ID, TALL_ID].map((id) => items[id] as unknown as PlacementItem),
    wallSegments,
  );
  assert.deepEqual(diagnostics, [], `wardrobe placements must resolve: ${JSON.stringify(diagnostics)}`);
  for (const id of [NORTH_ID, STUB_ID, TALL_ID]) {
    assert.ok(placements.has(id), `${id} must resolve`);
  }

  const catalog = FURNITURE_DIMS['study_seasonal_wardrobe_wall'];
  assert.ok(catalog, 'FURNITURE_DIMS must carry study_seasonal_wardrobe_wall');
  const recipe = buildFixture('study_seasonal_wardrobe_wall');
  assert.ok(recipe, 'wardrobe recipe must build');
  const recipeBox = new THREE.Box3().setFromObject(recipe);
  const built = {
    width: recipeBox.max.x - recipeBox.min.x,
    depth: recipeBox.max.z - recipeBox.min.z,
    height: recipeBox.max.y - recipeBox.min.y,
  };

  const zones = parseCeilingZones(readFileSync(`${ROOT}/config/model/envelope/ceiling.yaml`, 'utf8'));
  const band = zones.find((zone) => zone.id === CEILING_BAND_ID);
  assert.ok(band, `${CEILING_BAND_ID} must exist in ceiling.yaml`);
  assert.ok(band.area, `${CEILING_BAND_ID} must declare an area`);
  const studyRoom = layout.rooms.find((room) => room.id === 'study');
  assert.ok(studyRoom, 'study must exist in model-geometry.yaml');
  const roomHeight = studyRoom.height ?? 2.8;

  const wallLine = new Map<string, number>();
  for (const [id, item] of Object.entries(items)) {
    assert.ok(item.wall, `${id} must declare a host wall`);
    const wall = layout.walls.find((candidate) => candidate.id === item.wall);
    assert.ok(wall, `${item.wall} must exist in model-geometry.yaml`);
    if (wall.x1 === wall.x2) wallLine.set(id, wall.x1);
    else if (wall.z1 === wall.z2) wallLine.set(id, wall.z1);
    else assert.fail(`${item.wall} is not axis-aligned; cannot derive a single wall line`);
  }

  return {
    items,
    placements,
    catalog,
    built,
    doorAllowance: built.depth - catalog.depth,
    bandSouthEdge: band.area![3],
    bandBottom: roomHeight - (band.thickness ?? 0),
    roomHeight,
    roomWestEdge: studyRoom.x - studyRoom.width / 2,
    wallLine,
  };
}

const ctx = loadWardrobeContext();

function studyWardrobeGroups(): THREE.Object3D[] {
  const { scene } = buildCliHouseScene();
  const found: THREE.Object3D[] = [];
  scene.traverse((object) => {
    // 柜体零件（门板/层板等）与柜组共享 objectId，只取 Group 本体，勿把零件也算成柜体。
    // 按 userData 的 roomId/furnishingType 认家具（issue #98 起 objectId 是稳定 id，
    // 如 study.seasonal_wardrobe_wall，不再编码房间/类型）。
    if (
      object instanceof THREE.Group &&
      object.userData.roomId === 'study' &&
      object.userData.furnishingType === 'study_seasonal_wardrobe_wall'
    ) {
      found.push(object);
    }
  });
  return found;
}

function bboxOf(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${label}: 期望 ${expected}，实际 ${actual}`);
}

/** 按稳定 id 取柜组（不按中心坐标认件，中心坐标是解算结果不是身份）。 */
function groupById(groups: THREE.Object3D[], id: string): THREE.Object3D {
  const group = groups.find((candidate) => candidate.userData.objectId === id);
  assert.ok(group, `未找到 ${id}`);
  return group;
}

/** 奇数 quarter-turn 旋转交换宽/深轴（与 verify-furniture-placement / DXF 同一口径）。 */
function quarterTurn(item: FurnishingItem): boolean {
  return Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
}

test('行内尺寸柜体按行内宽/深渲染：书房南延腿贴合北柜与墙垛', () => {
  const groups = studyWardrobeGroups();
  assert.equal(groups.length, 3);
  const stub = groupById(groups, STUB_ID);
  const tall = groupById(groups, TALL_ID);
  const north = groupById(groups, NORTH_ID);

  // 渲染摆位 = 独立解算的摆位（同一 config，两条路径须一致）。
  for (const [id, group] of [[STUB_ID, stub], [TALL_ID, tall], [NORTH_ID, north]] as const) {
    const placement = ctx.placements.get(id)!;
    close(group.position.x, placement.x, `${id} 渲染 x 应等于解算摆位`);
    close(group.position.z, placement.z, `${id} 渲染 z 应等于解算摆位`);
  }

  const stubBox = bboxOf(stub);
  const tallBox = bboxOf(tall);
  const northBox = bboxOf(north);
  const stubItem = ctx.items[STUB_ID];
  const tallItem = ctx.items[TALL_ID];
  const northItem = ctx.items[NORTH_ID];

  // ── stub：长边（行内宽）沿 z，短边（深）沿 x；背板贴宿主墙线，东脸带门面余量。
  const stubPlacement = ctx.placements.get(STUB_ID)!;
  close(stubBox.min.z, stubPlacement.z - stubItem.width! / 2, 'stub 北端 = 摆位 − 行内宽/2');
  close(stubBox.max.z, stubPlacement.z + stubItem.width! / 2, 'stub 南端 = 摆位 + 行内宽/2');
  close(stubBox.min.x, ctx.wallLine.get(STUB_ID)!, 'stub 西脸（背板贴宿主墙线）');
  close(
    stubBox.max.x,
    stubPlacement.x + stubItem.depth! / 2 + ctx.doorAllowance,
    'stub 东脸 = 摆位 + 深/2 + 门面余量（配方实测）',
  );
  close(stubBox.min.z, northBox.max.z, 'stub 北端贴北段门面（面接）');
  close(stubBox.max.z, tallBox.min.z, 'stub 南端与高腿面接');
  close(stubBox.max.z, ctx.bandSouthEdge, 'stub 南端 = 边吊带南缘（拆分点）');
  close(stub.scale.x, stubItem.width! / ctx.catalog.width, 'stub 局部 x 缩放 = 行内宽/目录宽');
  close(stub.scale.z, stubItem.depth! / ctx.catalog.depth, 'stub 局部 z 缩放 = 行内深/目录深');
  assert.equal(stub.userData.declaredDimensions?.width, stubItem.width);
  assert.equal(stub.userData.declaredDimensions?.depth, stubItem.depth);
  assert.equal(stub.userData.declaredDimensions?.height, undefined, 'stub 不带 cabinetHeight，不编造高度');

  // ── 高腿：与 stub 同轴；两段行内宽之和 = 整腿长度（北段门面到墙垛北脸）。
  const tallPlacement = ctx.placements.get(TALL_ID)!;
  close(tallBox.min.z, tallPlacement.z - tallItem.width! / 2, '高腿北端 = 摆位 − 行内宽/2');
  close(tallBox.max.z, tallPlacement.z + tallItem.width! / 2, '高腿南端 = 摆位 + 行内宽/2');
  close(tallBox.min.x, ctx.wallLine.get(TALL_ID)!, '高腿西脸（背板贴宿主墙线）');
  close(
    tallBox.max.x,
    tallPlacement.x + tallItem.depth! / 2 + ctx.doorAllowance,
    '高腿东脸 = 摆位 + 深/2 + 门面余量（配方实测）',
  );
  close(tallBox.max.z - stubBox.min.z, stubItem.width! + tallItem.width!, '整腿长度 = 两段行内宽之和');
  close(tall.scale.x, tallItem.width! / ctx.catalog.width, '高腿局部 x 缩放 = 行内宽/目录宽');
  close(tall.scale.z, tallItem.depth! / ctx.catalog.depth, '高腿局部 z 缩放 = 行内深/目录深');
  assert.equal(tall.userData.declaredDimensions?.width, tallItem.width);
  assert.equal(tall.userData.declaredDimensions?.depth, tallItem.depth);

  // ── 北段：长边（行内宽）沿 x，短边（深）沿 z；西端齐平书房西缘，北脸贴宿主墙线，南脸带门面余量。
  const northPlacement = ctx.placements.get(NORTH_ID)!;
  close(northBox.min.x, northPlacement.x - northItem.width! / 2, '北段西端 = 摆位 − 行内宽/2');
  close(northBox.max.x, northPlacement.x + northItem.width! / 2, '北段东端 = 摆位 + 行内宽/2');
  close(northBox.min.x, ctx.roomWestEdge, '北段西端（齐平书房西缘）');
  close(northBox.min.z, ctx.wallLine.get(NORTH_ID)!, '北段北脸（背板贴宿主墙线）');
  close(
    northBox.max.z,
    northPlacement.z + northItem.depth! / 2 + ctx.doorAllowance,
    '北段南脸 = 摆位 + 深/2 + 门面余量（配方实测）',
  );
  close(north.scale.x, northItem.width! / ctx.catalog.width, '北段局部 x 缩放 = 行内宽/目录宽');
  close(north.scale.z, northItem.depth! / ctx.catalog.depth, '北段局部 z 缩放 = 行内深/目录深');
  assert.equal(north.userData.declaredDimensions?.width, northItem.width);
  assert.equal(north.userData.declaredDimensions?.depth, northItem.depth);

  // 轴向一致性：quarter-turn 件（stub/高腿）长边沿 z、北段长边沿 x。
  assert.equal(quarterTurn(stubItem), true, 'stub 应为 quarter-turn（长边沿 z）');
  assert.equal(quarterTurn(tallItem), true, '高腿应为 quarter-turn（长边沿 z）');
  assert.equal(quarterTurn(northItem), false, '北段不应转（长边沿 x）');
});

test('通顶高腿按行内高度渲染：stub 顶为配方高、高腿顶为行内高', () => {
  const groups = studyWardrobeGroups();
  const stub = groupById(groups, STUB_ID);
  const tall = groupById(groups, TALL_ID);
  const stubBox = bboxOf(stub);
  const tallBox = bboxOf(tall);
  const tallItem = ctx.items[TALL_ID];
  assert.ok(tallItem.cabinetHeight !== undefined, '高腿须声明 cabinetHeight');

  close(stubBox.min.y, 0, 'stub 底（落地）');
  close(tallBox.min.y, 0, '高腿底（落地）');
  // 无 cabinetHeight 的 stub 顶 = 配方实建高（buildFixture 实测）；留灰缝到边吊底。
  close(stubBox.max.y, ctx.built.height, 'stub 顶 = 配方实建高');
  assert.ok(stubBox.max.y < ctx.bandBottom, `stub 顶须低于边吊底（留灰缝）：顶 ${stubBox.max.y}，带底 ${ctx.bandBottom}`);
  // 有 cabinetHeight 的高腿顶 = 行内高，且行内高贴平顶（= 层高）。
  close(tallBox.max.y, tallItem.cabinetHeight, '高腿顶 = 行内 cabinetHeight');
  close(tallItem.cabinetHeight, ctx.roomHeight, '高腿行内高 = 层高（顶贴平顶）');
  close(tall.scale.y, tallItem.cabinetHeight / ctx.built.height, '高腿局部 y 缩放 = cabinetHeight / 配方实建高');
  assert.equal(tall.userData.declaredDimensions?.height, tallItem.cabinetHeight);
});
