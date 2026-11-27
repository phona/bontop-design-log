// 客卫台盆柜布局（issue #98 PR-3 起；2026-11-27 干湿分离放弃后改位）。
// 覆盖：vanity 挂墙定位 + vanity_layout 声明驱动、断引用/负净宽诊断（页面 + DXF + verify:furniture 三处消费）、
// FixtureFactory.buildVanity 参数化几何、机器人泊位落厨房西墙北段。
// 2026-11-27 改动：台盆柜由东侧开放区（w_gbath_east_open_vanity，0.515m 墙）移入内卫南墙内侧
// （w_gbath_south，沿位 1.335），深由 0.50 收窄为 0.30；机器人泊位由台盆柜机器人仓先移至主走廊
// 北墙作默认位（w_nw_south，沿位 1.53），2026-11-27 业主裁定再改锚厨房西墙北段
// （w_vrv_east，沿位 0.87，面朝东），不再挂 vanity 的 robot_bay。原 robot_bay 挂载派生
// 与跟随断言随本次改位删除（挂载机制本身仍由 shared/furniture-placement.ts 与其它测试覆盖）。
// 期望值全部手算写死（算式见各断言旁注释），条目声明从 config/house.yaml 实读。
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load as loadYaml } from 'js-yaml';
import * as THREE from 'three';
import {
  declaredFurnitureDims,
  furnitureFootprint,
  furnitureHostIndex,
  resolveFurniturePlacement,
  resolveVanityLayout,
  type PlacementItem,
} from '../../shared/furniture-placement.js';
import { buildFixture, buildVanity } from '../../shared/render/FixtureFactory.js';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { buildProjectDxf, DXF_LAYERS } from '../../shared/dxf/project-dxf.js';
import type { FurnishingItem, FurnishingsYaml, SceneElement, VanityLayoutDecl } from '../../shared/types.js';

interface WallLike { x1: number; z1: number; x2: number; z2: number }

/** 手抄现行宿主墙几何（与 model-geometry.yaml 实读比对见 gbath-wall-datum.test.ts）。 */
const SOUTH_WALL: WallLike = { x1: 5.69, z1: 3.64, x2: 7.50, z2: 3.64 }; // w_gbath_south（台盆/镜柜宿主）
const EAST_WALL: WallLike = { x1: 7.50, z1: 2.40, x2: 7.50, z2: 3.64 }; // w_gbath_east（毛巾架宿主）
const WEST_WALL: WallLike = { x1: 5.69, z1: 1.36, x2: 5.69, z2: 3.64 }; // w_gbath_west（淋浴区毛巾架宿主）
const KITCHEN_WEST_WALL_NORTH: WallLike = { x1: 7.50, z1: -0.15, x2: 7.50, z2: 1.36 }; // w_vrv_east（机器人泊位宿主，厨房西墙北段）

function segments(walls: Record<string, WallLike>): Map<string, WallLike[]> {
  return new Map(Object.entries(walls).map(([id, wall]) => [id, [wall]]));
}

function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);
}

/** 实读 house.yaml 的 guest_bath 条目（深拷贝，测试可改副本来模拟配置演化）。 */
function guestBathItems(): FurnishingItem[] {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings: { guest_bath: FurnishingItem[] } };
  return JSON.parse(JSON.stringify(house.furnishings.guest_bath)) as FurnishingItem[];
}

/** 实读 house.yaml 的 kitchen 条目（机器人泊位）。 */
function kitchenItems(): FurnishingItem[] {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings: { kitchen: FurnishingItem[] } };
  return JSON.parse(JSON.stringify(house.furnishings.kitchen)) as FurnishingItem[];
}

function byId(items: FurnishingItem[], id: string): FurnishingItem {
  const item = items.find((candidate) => candidate.id === id);
  assert.ok(item, `${id} must be declared in config/house.yaml`);
  return item;
}

/** 解析并断言「无诊断 + 有摆位」。 */
function mustResolve(item: PlacementItem, hosts: ReadonlyMap<string, PlacementItem>, wallSegments: Map<string, WallLike[]>): { x: number; z: number } {
  const resolution = resolveFurniturePlacement(item, wallSegments, hosts);
  assert.equal(resolution.diagnostic, undefined, `unexpected diagnostic: ${resolution.diagnostic ?? ''}`);
  assert.ok(resolution.placement, 'placement must resolve');
  return resolution.placement;
}

const ROOM = { id: 'guest_bath', name: '客卫', x: 6.40, z: 3.25, width: 1.60, depth: 2.10, height: 2.80, type: 'private' as const, boundary_count: 4 };
const SOUTH_SEGMENTS = segments({ w_gbath_south: SOUTH_WALL, w_gbath_east: EAST_WALL });

describe('gbath vanity layout (issue #98 PR-3)', () => {
  it('vanity 声明挂墙定位 + vanity_layout，不再写绝对 x/z', () => {
    const vanity = byId(guestBathItems(), 'gbath.vanity');
    assert.equal(vanity.type, 'vanity');
    assert.equal(vanity.x, undefined);
    assert.equal(vanity.z, undefined);
    // 2026-11-27 干湿分离放弃：由东侧开放区（w_gbath_east_open_vanity，沿位 0.405，rotation 270）
    // 移入内卫南墙内侧（w_gbath_south 北脸，沿位 1.335，rotation 180），深 0.50→0.30。
    assert.equal(vanity.wall, 'w_gbath_south');
    assert.equal(vanity.wall_side, 'north');
    closeTo(vanity.along as number, 1.335);
    assert.equal(vanity.rotation, 180);
    // 同一数字只留一处：目录 FURNITURE_DIMS 已不存 vanity，外框从声明取。
    assert.deepEqual(declaredFurnitureDims(vanity), { width: 0.69, depth: 0.30 });
    assert.deepEqual(furnitureFootprint(vanity), { width: 0.69, depth: 0.30 });
    const layout = resolveVanityLayout(vanity.vanity_layout);
    assert.equal(layout.ok, true);
    if (!layout.ok) return;
    closeTo(layout.layout.drawer_width, 0.19); // 抽屉区宽 = 0.69 − 0.50（剩余尺寸算出，不声明）
    // 摆位手算：x = 墙段西端 5.69 + 沿位 1.335 = 7.025；
    // z = 墙北完成面 3.58 − 柜深 0.30/2 = 3.43。
    const hosts = furnitureHostIndex(guestBathItems());
    const placement = mustResolve(vanity, hosts, SOUTH_SEGMENTS);
    closeTo(placement.x, 7.025);
    closeTo(placement.z, 3.43);
  });

  it('移墙后柜体跟随（墙线平移）', () => {
    const items = guestBathItems();
    const hosts = furnitureHostIndex(items);
    const before = mustResolve(byId(items, 'gbath.vanity'), hosts, SOUTH_SEGMENTS);
    // 墙东移 0.10m、南移 0.05m：沿位 1.335 自新西端起算，完成面随线平移。
    const moved: WallLike = { x1: 5.79, z1: 3.69, x2: 7.60, z2: 3.69 };
    const after = mustResolve(byId(items, 'gbath.vanity'), hosts, segments({ w_gbath_south: moved, w_gbath_east: EAST_WALL }));
    closeTo(after.x, before.x + 0.10);
    closeTo(after.z, before.z + 0.05);
  });

  it('改仓宽后抽屉宽跟随（剩余尺寸重算）', () => {
    const items = guestBathItems();
    const vanity = byId(items, 'gbath.vanity');
    // 仓区加宽 0.06m（0.50→0.56）：抽屉区 0.69−0.56 = 0.13。
    const wider = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (wider.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.56;
    const widerLayout = resolveVanityLayout(wider.vanity_layout);
    assert.equal(widerLayout.ok, true);
    if (!widerLayout.ok) return;
    closeTo(widerLayout.layout.drawer_width, 0.13);

    // 仓区收窄 0.04m（0.50→0.46，声明净宽同步降到 0.42 以过门禁）：抽屉区 0.69−0.46 = 0.23。
    // （净宽不变时仓区最窄就只能到 0.50——内腔 0.46 是下限。）
    const narrower = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (narrower.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.46;
    (narrower.vanity_layout as VanityLayoutDecl).robot_bay_clear_width = 0.42;
    const narrowerLayout = resolveVanityLayout(narrower.vanity_layout);
    assert.equal(narrowerLayout.ok, true);
    if (!narrowerLayout.ok) return;
    closeTo(narrowerLayout.layout.drawer_width, 0.23);
  });

  it('断引用 / 负净宽 / 缺声明 → 返回诊断而不是静默跳过', () => {
    const items = guestBathItems();
    const vanity = byId(items, 'gbath.vanity');
    const hosts = furnitureHostIndex(items);

    // ① 负净宽：仓区宽超过柜宽（剩余尺寸为负）。
    const negativeBay = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (negativeBay.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.80;
    const negativeBayResolution = resolveFurniturePlacement(negativeBay, SOUTH_SEGMENTS, hosts);
    assert.equal(negativeBayResolution.placement, null);
    assert.match(negativeBayResolution.diagnostic ?? '', /剩余尺寸为负/);

    // ② 仓门净宽超过仓区内腔。
    const fatDoor = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (fatDoor.vanity_layout as VanityLayoutDecl).robot_bay_clear_width = 0.60;
    const fatDoorResolution = resolveFurniturePlacement(fatDoor, SOUTH_SEGMENTS, hosts);
    assert.equal(fatDoorResolution.placement, null);
    assert.match(fatDoorResolution.diagnostic ?? '', /超过仓区内腔/);

    // ③ 缺 vanity_layout 声明。
    const noLayout = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    delete noLayout.vanity_layout;
    const noLayoutResolution = resolveFurniturePlacement(noLayout, SOUTH_SEGMENTS, hosts);
    assert.equal(noLayoutResolution.placement, null);
    assert.match(noLayoutResolution.diagnostic ?? '', /缺少 vanity_layout/);

    // ④ 修复后恢复：换回合法声明即解出原位。
    const fixed = mustResolve(vanity, hosts, SOUTH_SEGMENTS);
    closeTo(fixed.x, 7.025);
    closeTo(fixed.z, 3.43);
  });

  it('机器人泊位落厨房西墙北段，不再挂台盆柜', () => {
    // 2026-11-27 干湿分离放弃：柜深 0.50→0.30m 后基站（433mm 深）放不进原机器人仓；
    // 2026-11-27 业主裁定：泊位落厨房西墙北段（w_vrv_east），热水器北侧，面朝东进厨房。
    // 业主原指定 z≈0.35 与北侧地柜冲突（柜体南沿 z=0.47），实落沿位 0.87（中心 z=0.72）。
    const guestItems = guestBathItems();
    assert.equal(guestItems.find((item) => item.id === 'gbath.robot_dock'), undefined, 'robot_dock must not be in guest_bath any more');
    const dock = byId(kitchenItems(), 'gbath.robot_dock');
    assert.equal(dock.type, 'robot_dock_gbath');
    assert.equal(dock.mount, undefined, 'robot_dock must not mount to the vanity any more');
    assert.equal(dock.wall, 'w_vrv_east');
    assert.equal(dock.wall_side, 'east');
    closeTo(dock.along as number, 0.87);
    assert.equal(dock.rotation, 90);
    // 摆位手算：z = 墙段北端 −0.15 + 沿位 0.87 = 0.72；
    // x = 墙东完成面 7.56 + 基站深 0.433/2 = 7.7765。
    const hosts = furnitureHostIndex([...guestItems, ...kitchenItems()]);
    const placement = mustResolve(dock, hosts, segments({ w_vrv_east: KITCHEN_WEST_WALL_NORTH }));
    closeTo(placement.x, 7.7765);
    closeTo(placement.z, 0.72);
  });

  it('resolveVanityLayout 派生抽屉区宽并拒绝非正数', () => {
    const ok = resolveVanityLayout({ width: 0.69, depth: 0.3, height: 0.75, robot_bay_width: 0.5, robot_bay_clear_width: 0.46, panel_thickness: 0.02 });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    closeTo(ok.layout.drawer_width, 0.19);
    assert.equal(resolveVanityLayout(undefined).ok, false);
    const zero = resolveVanityLayout({ width: 0.69, depth: 0.3, height: 0.75, robot_bay_width: 0.5, robot_bay_clear_width: 0.46, panel_thickness: 0 });
    assert.equal(zero.ok, false);
    if (zero.ok) return;
    assert.match(zero.diagnostic, /panel_thickness 必须为正数/);
  });

  it('SceneBuilder：诊断进 report.placementDiagnostics，坏件不进场景；修好即恢复', () => {
    const items = guestBathItems();
    const southWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_south', x1: SOUTH_WALL.x1, z1: SOUTH_WALL.z1, x2: SOUTH_WALL.x2, z2: SOUTH_WALL.z2 };
    const eastWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_east', x1: EAST_WALL.x1, z1: EAST_WALL.z1, x2: EAST_WALL.x2, z2: EAST_WALL.z2 };
    const westWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_west', x1: WEST_WALL.x1, z1: WEST_WALL.z1, x2: WEST_WALL.x2, z2: WEST_WALL.z2 };
    const build = (furnishings: FurnishingItem[]) => buildScene({
      rooms: [ROOM],
      walls: [
        { id: 'w_gbath_south', ...SOUTH_WALL, height: 2.8 },
        { id: 'w_gbath_east', ...EAST_WALL, height: 2.8 },
        { id: 'w_gbath_west', ...WEST_WALL, height: 2.8 },
      ],
      elements: [southWall, eastWall, westWall],
      furnishings: { guest_bath: furnishings },
    });

    const healthy = build(items);
    assert.deepEqual(healthy.report.placementDiagnostics, []);
    const healthyVanity = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'gbath.vanity');
    const healthyMirror = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'gbath.mirror_cabinet');
    const healthyTowel = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'gbath.towel_set');
    assert.ok(healthyVanity && healthyMirror && healthyTowel, 'vanity、mirror 与 towel set 都必须进场景');
    closeTo(healthyVanity!.position.x, 7.025);
    closeTo(healthyVanity!.position.z, 3.43);
    closeTo(healthyMirror!.position.x, 7.025);
    closeTo(healthyMirror!.position.z, 3.51);
    // 2026-11-27 业主裁定撤电热毛巾架改普通毛巾架：淋浴区西墙沿位 1.25，x = 墙线 5.69 + 半墙厚 0.06 + clearance 0.04 + 深 0.28/2 = 5.93；z = 1.36 + 1.25 = 2.61（沿位由 1.30 北移 0.05m，避让门扇扫掠弧）。
    closeTo(healthyTowel!.position.x, 5.93);
    closeTo(healthyTowel!.position.z, 2.61);
    // 机器人泊位已移出客卫，不在客卫场景里。
    assert.ok(!healthy.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.robot_dock'));

    // 负净宽：vanity 自身诊断，不进场景；镜柜与毛巾架仍在。
    const negative = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    (negative.find((item) => item.id === 'gbath.vanity')!.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.80;
    const negativeResult = build(negative);
    assert.equal(negativeResult.report.placementDiagnostics.length, 1);
    assert.match(negativeResult.report.placementDiagnostics[0], /剩余尺寸为负/);
    assert.ok(!negativeResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.vanity'));
    assert.ok(negativeResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.mirror_cabinet'));
    assert.ok(negativeResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.towel_set'));
  });

  it('DXF 导出：摆位诊断即失败（errors 非空），健康配置导出柜体外框', () => {
    const items = guestBathItems();
    const southWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_south', x1: SOUTH_WALL.x1, z1: SOUTH_WALL.z1, x2: SOUTH_WALL.x2, z2: SOUTH_WALL.z2 };
    const eastWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_east', x1: EAST_WALL.x1, z1: EAST_WALL.z1, x2: EAST_WALL.x2, z2: EAST_WALL.z2 };
    const westWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_west', x1: WEST_WALL.x1, z1: WEST_WALL.z1, x2: WEST_WALL.x2, z2: WEST_WALL.z2 };
    const dxfInput = (furnishings: FurnishingItem[]) => ({
      house: { rooms: [ROOM], furnishings: { guest_bath: furnishings } as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [southWall, eastWall, westWall] },
    });

    const healthy = buildProjectDxf(dxfInput(items));
    assert.deepEqual(healthy.errors, []);
    const furnLines = healthy.dxf.split('\n');
    assert.ok(furnLines.some((line) => line.trim() === DXF_LAYERS.FURN[0]), 'A-FURN 图层必须有家具几何');
    // 家具中心文字坐标（DXF y = −z×1000，fmt 4 位小数）：柜体 (7025.0000, −3430.0000)。
    // 组码序列：10=x、20=y（DXF y = −z×1000），fmt 4 位小数。
    assert.ok(healthy.dxf.includes('10\n7025.0000\n20\n-3430.0000'), '柜体中心文字坐标');
    // 机器人泊位已移出客卫，不在客卫 DXF 里。
    assert.ok(!healthy.dxf.includes('10\n7776.5000\n20\n-720.0000'), '基站中心不得出现在客卫 DXF');

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    (broken.find((item) => item.id === 'gbath.vanity')!.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.80;
    const brokenResult = buildProjectDxf(dxfInput(broken));
    assert.equal(brokenResult.errors.length, 1);
    assert.match(brokenResult.errors[0], /剩余尺寸为负/);
  });

  it('FixtureFactory：buildVanity 由声明参数生成 13 个零件，写死 recipe 已删', () => {
    // 不再有 FIXTURE_RECIPES 里的 vanity 配方：走通用路径会拿到 null（立刻显形）。
    assert.equal(buildFixture('vanity'), null);
    const vanity = byId(guestBathItems(), 'gbath.vanity');
    const layout = resolveVanityLayout(vanity.vanity_layout);
    assert.equal(layout.ok, true);
    if (!layout.ok) return;
    const group = buildVanity(layout.layout);
    const parts = group.children.map((child) => child.userData.part as string).sort();
    assert.deepEqual(parts, [
      'basin',
      'countertop',
      'vanity-bay-drawer-divider',
      'vanity-bay-north-end-panel',
      'vanity-drawer-carcass',
      'vanity-drawer-front-lower',
      'vanity-drawer-front-lower-handle',
      'vanity-drawer-front-upper',
      'vanity-drawer-front-upper-handle',
      'vanity-drawer-seam-shadow',
      'vanity-drawer-south-end-panel',
      'vanity-robot-bay-door',
      'vanity-robot-bay-door-handle',
    ]);

    const partBox = (part: string): THREE.Box3 => {
      const child = group.children.find((candidate) => candidate.userData.part === part);
      assert.ok(child, `${part} must exist`);
      child.updateWorldMatrix(true, false);
      return new THREE.Box3().setFromObject(child);
    };
    // 外包络：宽 0.69（local x ±0.345）、深 0.30（local z ±0.15）；台面顶 0.79、盆顶 0.87。
    // 2026-11-27 柜深 0.50→0.30：min.z 由台上盆后沿 −0.19 决定（盆深 0.28、中心 z=−0.05），
    // max.z 由三只把手前沿 0.17 决定（柜面 0.15 + 板厚 0.02）。
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    // Box3 由矩阵实测得出，容差取 1e-6（消浮点/矩阵合成噪声）。
    closeTo(box.max.x, 0.345, 1e-6);
    closeTo(box.min.x, -0.345, 1e-6);
    closeTo(box.min.z, -0.19, 1e-6);
    closeTo(box.max.z, 0.17, 1e-6);
    closeTo(box.max.y, 0.87, 1e-6);
    // 柜体（carcass/台面）外深仍是声明的 0.30：local z ±0.15；台面宽 = 声明柜宽 0.69。
    const countertop = partBox('countertop');
    closeTo(countertop.max.z, 0.15, 1e-6);
    closeTo(countertop.min.z, -0.15, 1e-6);
    closeTo(countertop.max.x - countertop.min.x, 0.69, 1e-6);
    // 仓门按仓净宽 0.46 生成，落在仓区内腔 [xMin+0.02, xMin+0.48]。
    const door = partBox('vanity-robot-bay-door');
    closeTo(door.max.x - door.min.x, 0.46, 1e-6);
    closeTo(door.min.x, -0.325, 1e-6);
    closeTo(door.max.x, 0.135, 1e-6);
    closeTo(door.min.y, 0.15, 1e-6); // 底缝 0.15m 供机器人进出
    closeTo(door.max.y, 0.75, 1e-6); // 通高到盆底
    // 抽屉 carcass 收在南端板内侧：宽 0.19−0.02 = 0.17，x[0.155,0.325]。
    const carcass = partBox('vanity-drawer-carcass');
    closeTo(carcass.max.x - carcass.min.x, 0.17, 1e-6);
    closeTo(carcass.min.x, 0.155, 1e-6);
    closeTo(carcass.max.x, 0.325, 1e-6);
    closeTo(carcass.min.y, 0.03, 1e-6); // 通顶双抽落地槛

    // 改仓宽即改几何：仓区 0.56 → 仓门/内腔 0.52、抽屉 carcass 0.13 且整体南移。
    const widerLayout = resolveVanityLayout({ ...(vanity.vanity_layout as VanityLayoutDecl), robot_bay_width: 0.56 });
    assert.equal(widerLayout.ok, true);
    if (!widerLayout.ok) return;
    const wider = buildVanity(widerLayout.layout);
    const widerDoor = new THREE.Box3().setFromObject(wider.children.find((child) => child.userData.part === 'vanity-robot-bay-door')!);
    closeTo(widerDoor.max.x - widerDoor.min.x, 0.52, 1e-6);
    const widerCarcass = new THREE.Box3().setFromObject(wider.children.find((child) => child.userData.part === 'vanity-drawer-carcass')!);
    closeTo(widerCarcass.max.x - widerCarcass.min.x, 0.11, 1e-6); // 0.13 − 0.02
    closeTo(widerCarcass.min.x, 0.215, 1e-6);
    closeTo(widerCarcass.max.x, 0.325, 1e-6); // 南端仍贴南端板内侧
  });
});
