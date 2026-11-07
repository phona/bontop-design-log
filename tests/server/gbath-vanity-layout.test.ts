// 客卫台盆柜布局与机器人仓挂位（issue #98 PR-3，DEC-2026-11-05-R5「仓+抽屉」定案）。
// 覆盖：vanity 挂墙定位 + vanity_layout 声明驱动、robot_dock mount 派生世界坐标、
// 移墙/改仓宽跟随、断引用/负净宽诊断（页面 + DXF + verify:furniture 三处消费）、
// FixtureFactory.buildVanity 参数化几何。
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
const WALL: WallLike = { x1: 7.20, z1: 3.55, x2: 7.20, z2: 4.30 };
/** 电热毛巾架宿主墙（guest_bath 实读条目里有挂它的家具，测试输入必须一起给）。 */
const WEST_WALL: WallLike = { x1: 5.60, z1: 3.55, x2: 5.60, z2: 4.30 };

function segments(wall: WallLike, id = 'w_gbath_east_open_vanity'): Map<string, WallLike[]> {
  return new Map([[id, [wall]]]);
}

function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);
}

/** 实读 house.yaml 的 guest_bath 条目（深拷贝，测试可改副本来模拟配置演化）。 */
function guestBathItems(): FurnishingItem[] {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings: { guest_bath: FurnishingItem[] } };
  return JSON.parse(JSON.stringify(house.furnishings.guest_bath)) as FurnishingItem[];
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

describe('gbath vanity layout (issue #98 PR-3)', () => {
  it('vanity 声明挂墙定位 + vanity_layout，不再写绝对 x/z', () => {
    const vanity = byId(guestBathItems(), 'gbath.vanity');
    assert.equal(vanity.type, 'vanity');
    assert.equal(vanity.x, undefined);
    assert.equal(vanity.z, undefined);
    assert.equal(vanity.wall, 'w_gbath_east_open_vanity');
    assert.equal(vanity.wall_side, 'west');
    closeTo(vanity.along as number, 0.405);
    assert.equal(vanity.rotation, 270);
    // 同一数字只留一处：目录 FURNITURE_DIMS 已不存 vanity，外框从声明取。
    assert.deepEqual(declaredFurnitureDims(vanity), { width: 0.69, depth: 0.50 });
    assert.deepEqual(furnitureFootprint(vanity), { width: 0.69, depth: 0.50 });
    const layout = resolveVanityLayout(vanity.vanity_layout);
    assert.equal(layout.ok, true);
    if (!layout.ok) return;
    closeTo(layout.layout.drawer_width, 0.19); // 抽屉区宽 = 0.69 − 0.50（剩余尺寸算出，不声明）
  });

  it('独立基准：基站中心世界坐标 = (6.9235, 3.86)（DEC-2026-11-05-R5 定案值，改挂载前手写同值）', () => {
    // 手算：柜中心 = 墙线 7.20 − 半墙厚 0.06 − 柜深 0.50/2 = 6.89；z = 墙段北端 3.55 + along 0.405 = 3.955。
    // 挂位（robot_bay，宿主局部系）：lx = −0.69/2 + 0.50/2 = −0.095（仓区中心）；
    // lz = −0.50/2 + 0.433/2 = −0.0335（背沿贴柜背 + 基站半深）。rotation=270：
    // 世界 Δx = lx·cos270 + lz·sin270 = 0 + (−0.0335)(−1) = +0.0335；
    // 世界 Δz = −lx·sin270 + lz·cos270 = −(−0.095)(−1) + 0 = −0.095。
    // 基站中心 = (6.89 + 0.0335, 3.955 − 0.095) = (6.9235, 3.860)。
    const items = guestBathItems();
    const dock = byId(items, 'gbath.robot_dock');
    assert.equal(dock.x, undefined, 'robot_dock must not declare absolute x (issue #98 PR-3)');
    assert.equal(dock.z, undefined, 'robot_dock must not declare absolute z (issue #98 PR-3)');
    assert.deepEqual(dock.mount, { furniture_id: 'gbath.vanity', slot: 'robot_bay' });
    const hosts = furnitureHostIndex(items);
    const placement = mustResolve(dock, hosts, segments(WALL));
    closeTo(placement.x, 6.9235);
    closeTo(placement.z, 3.86);
    // 包络自检：基站 0.41×0.433，背沿贴东完成面 7.14、北缘 z=3.655（仓区中点两侧各 25mm 口径）。
    closeTo(placement.x + 0.433 / 2, 7.14);
    closeTo(placement.z - 0.41 / 2, 3.655);
  });

  it('移墙后柜体与基站跟随（墙线与墙段北端同时平移）', () => {
    const items = guestBathItems();
    const hosts = furnitureHostIndex(items);
    const before = mustResolve(byId(items, 'gbath.robot_dock'), hosts, segments(WALL));
    // 墙东移 0.10m、北端南延 0.05m：along 0.405 自新北端起算，完成面随线平移。
    const moved: WallLike = { x1: 7.30, z1: 3.60, x2: 7.30, z2: 4.35 };
    const afterVanity = mustResolve(byId(items, 'gbath.vanity'), hosts, segments(moved));
    const afterDock = mustResolve(byId(items, 'gbath.robot_dock'), hosts, segments(moved));
    closeTo(afterVanity.x, 6.89 + 0.10);
    closeTo(afterVanity.z, 3.955 + 0.05);
    closeTo(afterDock.x, before.x + 0.10);
    closeTo(afterDock.z, before.z + 0.05);
  });

  it('改仓宽后抽屉宽与基站位置跟随（剩余尺寸重算）', () => {
    const items = guestBathItems();
    const vanity = byId(items, 'gbath.vanity');
    const hosts = furnitureHostIndex(items);
    const dock = byId(items, 'gbath.robot_dock');
    const base = mustResolve(dock, hosts, segments(WALL));
    closeTo(base.z, 3.86);

    // 仓区加宽 0.06m（0.50→0.56）：抽屉区 0.69−0.56 = 0.13；仓区自北端向南扩，仓中心南移 0.03
    // （local +x = 世界 +z）→ 基站 z 3.86→3.89。
    const wider = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (wider.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.56;
    const widerLayout = resolveVanityLayout(wider.vanity_layout);
    assert.equal(widerLayout.ok, true);
    if (!widerLayout.ok) return;
    closeTo(widerLayout.layout.drawer_width, 0.13);
    const widerDock = mustResolve(dock, furnitureHostIndex([...items.filter((item) => item.id !== 'gbath.vanity'), wider]), segments(WALL));
    closeTo(widerDock.z, 3.86 + 0.03);
    closeTo(widerDock.x, base.x); // x 只跟柜深，不随仓宽变

    // 仓区收窄 0.04m（0.50→0.46，声明净宽同步降到 0.42 以过门禁）：抽屉区 0.69−0.46 = 0.23；
    // 仓中心北移 0.02 → 基站 z 3.84。（净宽不变时仓区最窄就只能到 0.50——内腔 0.46 是下限。）
    const narrower = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (narrower.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.46;
    (narrower.vanity_layout as VanityLayoutDecl).robot_bay_clear_width = 0.42;
    const narrowerLayout = resolveVanityLayout(narrower.vanity_layout);
    assert.equal(narrowerLayout.ok, true);
    if (!narrowerLayout.ok) return;
    closeTo(narrowerLayout.layout.drawer_width, 0.23);
    const narrowerDock = mustResolve(dock, furnitureHostIndex([...items.filter((item) => item.id !== 'gbath.vanity'), narrower]), segments(WALL));
    closeTo(narrowerDock.z, 3.86 - 0.02);
  });

  it('断引用 / 负净宽 / 缺声明 → 返回诊断而不是静默跳过', () => {
    const items = guestBathItems();
    const vanity = byId(items, 'gbath.vanity');
    const dock = byId(items, 'gbath.robot_dock');
    const hosts = furnitureHostIndex(items);

    // ① 断引用：宿主 id 拼错。
    const brokenHost = JSON.parse(JSON.stringify(dock)) as FurnishingItem;
    brokenHost.mount = { furniture_id: 'gbath.vanity_typo', slot: 'robot_bay' };
    const brokenHostResolution = resolveFurniturePlacement(brokenHost, segments(WALL), hosts);
    assert.equal(brokenHostResolution.placement, null);
    assert.match(brokenHostResolution.diagnostic ?? '', /mount host "gbath\.vanity_typo" not found/);

    // ② 负净宽：仓区宽超过柜宽（剩余尺寸为负）。
    const negativeBay = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (negativeBay.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.80;
    const negativeBayResolution = resolveFurniturePlacement(negativeBay, segments(WALL), hosts);
    assert.equal(negativeBayResolution.placement, null);
    assert.match(negativeBayResolution.diagnostic ?? '', /剩余尺寸为负/);
    const negativeMount = resolveFurniturePlacement(dock, segments(WALL), furnitureHostIndex([negativeBay, dock]));
    assert.equal(negativeMount.placement, null);
    assert.match(negativeMount.diagnostic ?? '', /mount host "gbath\.vanity".*剩余尺寸为负/);

    // ③ 仓门净宽超过仓区内腔。
    const fatDoor = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    (fatDoor.vanity_layout as VanityLayoutDecl).robot_bay_clear_width = 0.60;
    const fatDoorResolution = resolveFurniturePlacement(fatDoor, segments(WALL), hosts);
    assert.equal(fatDoorResolution.placement, null);
    assert.match(fatDoorResolution.diagnostic ?? '', /超过仓区内腔/);

    // ④ 缺 vanity_layout 声明。
    const noLayout = JSON.parse(JSON.stringify(vanity)) as FurnishingItem;
    delete noLayout.vanity_layout;
    const noLayoutResolution = resolveFurniturePlacement(noLayout, segments(WALL), hosts);
    assert.equal(noLayoutResolution.placement, null);
    assert.match(noLayoutResolution.diagnostic ?? '', /缺少 vanity_layout/);

    // ⑤ 定位来源不唯一：mount 与绝对 x/z 同声明。
    const bothSources = JSON.parse(JSON.stringify(dock)) as FurnishingItem;
    bothSources.x = 6.9235;
    const bothResolution = resolveFurniturePlacement(bothSources, segments(WALL), hosts);
    assert.equal(bothResolution.placement, null);
    assert.match(bothResolution.diagnostic ?? '', /mount 与绝对 x\/z 不得同时声明/);

    // ⑥ 修复后恢复：换回合法声明即解出原位。
    const fixed = mustResolve(dock, hosts, segments(WALL));
    closeTo(fixed.x, 6.9235);
    closeTo(fixed.z, 3.86);
  });

  it('resolveVanityLayout 派生抽屉区宽并拒绝非正数', () => {
    const ok = resolveVanityLayout({ width: 0.69, depth: 0.5, height: 0.75, robot_bay_width: 0.5, robot_bay_clear_width: 0.46, panel_thickness: 0.02 });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    closeTo(ok.layout.drawer_width, 0.19);
    assert.equal(resolveVanityLayout(undefined).ok, false);
    const zero = resolveVanityLayout({ width: 0.69, depth: 0.5, height: 0.75, robot_bay_width: 0.5, robot_bay_clear_width: 0.46, panel_thickness: 0 });
    assert.equal(zero.ok, false);
    if (zero.ok) return;
    assert.match(zero.diagnostic, /panel_thickness 必须为正数/);
  });

  it('SceneBuilder：诊断进 report.placementDiagnostics，坏件不进场景；修好即恢复', () => {
    const items = guestBathItems();
    const wall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_east_open_vanity', x1: WALL.x1, z1: WALL.z1, x2: WALL.x2, z2: WALL.z2 };
    const westWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_west_open_vanity', x1: WEST_WALL.x1, z1: WEST_WALL.z1, x2: WEST_WALL.x2, z2: WEST_WALL.z2 };
    const build = (furnishings: FurnishingItem[]) => buildScene({
      rooms: [ROOM],
      walls: [
        { id: 'w_gbath_east_open_vanity', ...WALL, height: 2.8 },
        { id: 'w_gbath_west_open_vanity', ...WEST_WALL, height: 2.8 },
      ],
      elements: [wall, westWall],
      furnishings: { guest_bath: furnishings },
    });

    const healthy = build(items);
    assert.deepEqual(healthy.report.placementDiagnostics, []);
    const healthyVanity = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'gbath.vanity');
    const healthyDock = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'gbath.robot_dock');
    assert.ok(healthyVanity && healthyDock, 'vanity 与 robot_dock 都必须进场景');
    closeTo(healthyVanity!.position.x, 6.89);
    closeTo(healthyVanity!.position.z, 3.955);
    closeTo(healthyDock!.position.x, 6.9235);
    closeTo(healthyDock!.position.z, 3.86);

    // 断引用：dock 宿主拼错 → 诊断显形、dock 缺席，vanity 仍在。
    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    broken.find((item) => item.id === 'gbath.robot_dock')!.mount = { furniture_id: 'gbath.vanity_typo', slot: 'robot_bay' };
    const brokenResult = build(broken);
    assert.equal(brokenResult.report.placementDiagnostics.length, 1);
    assert.match(brokenResult.report.placementDiagnostics[0], /guest_bath:robot_dock_gbath: mount host "gbath\.vanity_typo" not found/);
    assert.ok(brokenResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.vanity'));
    assert.ok(!brokenResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'gbath.robot_dock'));

    // 负净宽：vanity 自身也诊断（宿主布局非法），两件都不进场景。
    const negative = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    (negative.find((item) => item.id === 'gbath.vanity')!.vanity_layout as VanityLayoutDecl).robot_bay_width = 0.80;
    const negativeResult = build(negative);
    assert.equal(negativeResult.report.placementDiagnostics.length, 2);
    for (const diagnostic of negativeResult.report.placementDiagnostics) assert.match(diagnostic, /剩余尺寸为负/);
  });

  it('DXF 导出：摆位诊断即失败（errors 非空），健康配置导出柜体与基站外框', () => {
    const items = guestBathItems();
    const wall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_east_open_vanity', x1: WALL.x1, z1: WALL.z1, x2: WALL.x2, z2: WALL.z2 };
    const westWall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_gbath_west_open_vanity', x1: WEST_WALL.x1, z1: WEST_WALL.z1, x2: WEST_WALL.x2, z2: WEST_WALL.z2 };
    const dxfInput = (furnishings: FurnishingItem[]) => ({
      house: { rooms: [ROOM], furnishings: { guest_bath: furnishings } as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [wall, westWall] },
    });

    const healthy = buildProjectDxf(dxfInput(items));
    assert.deepEqual(healthy.errors, []);
    const furnLines = healthy.dxf.split('\n');
    assert.ok(furnLines.some((line) => line.trim() === DXF_LAYERS.FURN[0]), 'A-FURN 图层必须有家具几何');
    // 家具中心文字坐标（DXF y = −z×1000，fmt 4 位小数）：基站 (6923.5000, −3860.0000)、
    // 柜体 (6890.0000, −3955.0000)——与改挂载前手写的 (6.9235, 3.86)/(6.89, 3.955) 逐位相同。
    // 组码序列：10=x、20=y（DXF y = −z×1000），fmt 4 位小数。
    assert.ok(healthy.dxf.includes('10\n6923.5000\n20\n-3860.0000'), '基站中心文字坐标');
    assert.ok(healthy.dxf.includes('10\n6890.0000\n20\n-3955.0000'), '柜体中心文字坐标');

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    broken.find((item) => item.id === 'gbath.robot_dock')!.mount = { furniture_id: 'gbath.vanity_typo', slot: 'robot_bay' };
    const brokenResult = buildProjectDxf(dxfInput(broken));
    assert.equal(brokenResult.errors.length, 1);
    assert.match(brokenResult.errors[0], /guest_bath:robot_dock_gbath: mount host "gbath\.vanity_typo" not found/);
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
    // 外包络：宽 0.69（local x ±0.345）、深 0.50（local z ±0.25）、台面顶 0.79、盆顶 0.87。
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    // Box3 由矩阵实测得出，容差取 1e-6（消浮点/矩阵合成噪声）。
    closeTo(box.max.x, 0.345, 1e-6);
    closeTo(box.min.x, -0.345, 1e-6);
    closeTo(box.min.z, -0.25, 1e-6);
    closeTo(box.max.z, 0.27, 1e-6); // 三只把手前沿 0.27（装饰件突出柜面 0.25 达 20mm，声明值）
    closeTo(box.max.y, 0.87, 1e-6);
    // 柜体（carcass/台面）外深仍是声明的 0.50：local z ±0.25；台面宽 = 声明柜宽 0.69。
    const countertop = partBox('countertop');
    closeTo(countertop.max.z, 0.25, 1e-6);
    closeTo(countertop.min.z, -0.25, 1e-6);
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
