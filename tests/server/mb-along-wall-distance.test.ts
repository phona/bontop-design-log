// 主卫东墙（w_mbath_east）along 语义收口：issue #98 删除「along = 绝对 z」历史特例后，
// along 一律是「从墙段起点顶点沿墙向的距离」（与 overlay.yaml wall_region/paint_region 的
// along 区间同一口径）。本文件把受影响家具（2026-11-13 issue #116 通顶柜；2026-11-15
// #98 Tier 1 书房季节柜两腿；2026-11-27 干湿分离放弃后移入主卫的洗手柜；#98 Tier 2
// 西北卧窄桌）的世界包络用手算基准钉死，并证明越界的 along 不再被静默解析
// 成绝对坐标，而是走 PR-3 已建的摆位诊断链（页面 / DXF / verify:furniture）。原 4 件
// （底柜 + 双悬浮板 + PVC 墙行包管）已随 #116 退役，清单守卫现认通顶柜 + 洗手柜 +
// 窄桌 + 两腿共 5 件。
//
// 期望值全部手算写死（算式见各断言旁注释），不经被测代码推导；墙几何与条目声明从
// config/layout/model-geometry.yaml、config/house.yaml 实读，防止本文件字面输入随配置漂移。
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load as loadYaml } from 'js-yaml';
import { resolveFurniturePlacement, WALL_THICKNESS, type FurniturePlacement, type PlacementItem } from '../../shared/furniture-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import type { FurnishingItem, FurnishingsYaml, HvacDiagram, ResolvedRoom, SceneElement, VertexLayoutYaml } from '../../shared/types.js';

const ROOT = resolve(import.meta.dirname, '../..');

interface WallLike { x1: number; z1: number; x2: number; z2: number }

// 手抄 config/layout/model-geometry.yaml 的宿主墙几何（下方有实读一致性断言）。
// w_mbath_east：v_bath_ne(2.90,−0.04) → v_bath_s(2.90,3.75)，长 3.79（2026-11-27 量房回填：
//   墙线 2.60→2.90、北端 1.10→−0.04、南端 4.30→3.75）；
// w_mb_east：    v_mb_ne (4.16,5.455) → v_mb_se(4.16,9.80)，长 4.345（2026-11-27 量房回填：
//   墙线 4.20→4.16、北端 5.55→5.455）；
// w_mbath_south：v_mb_sw(0.00,2.655) → v_mbath_se(2.90,2.655)，长 2.90；
// w_west_upper：v_mb_nw(0.00,5.455) → v_sw(0.00,9.80)，但 v_sw 带 radius 0.45 圆角，
// resolveLayout 的直段止于 z=9.35（9.80−0.45）——手抄值须与实读一致，取 9.35。
// 后两面是 #98 Tier 1 新增墙锚家具（洗手柜 / 梳妆台）的宿主墙：DXF 与 SceneBuilder
// 的合成场景只喂 master_bedroom 条目时须含它们，否则健康态即报 wall not found。
const WALLS: Record<string, WallLike> = {
  w_mbath_east: { x1: 2.90, z1: -0.04, x2: 2.90, z2: 3.75 },
  w_mb_east: { x1: 4.16, z1: 5.455, x2: 4.16, z2: 9.80 },
  w_mbath_south: { x1: 0.00, z1: 2.655, x2: 2.90, z2: 2.655 },
  w_west_upper: { x1: 0.00, z1: 5.455, x2: 0.00, z2: 9.35 },
};

function segments(...ids: string[]): Map<string, WallLike[]> {
  return new Map(ids.map((id) => [id, [WALLS[id]]]));
}

function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);
}

/** 解析并断言「无诊断 + 有摆位」；诊断路径由本文件后半专测。 */
function resolveOk(item: PlacementItem, wallSegments: Map<string, WallLike[]>): FurniturePlacement {
  const resolution = resolveFurniturePlacement(item, wallSegments);
  assert.equal(resolution.diagnostic, undefined, `unexpected diagnostic: ${resolution.diagnostic ?? ''}`);
  assert.ok(resolution.placement, 'placement must resolve');
  return resolution.placement;
}

/** 实读 house.yaml 的 master_bedroom 条目（按稳定 id 取，深拷贝后可改）。 */
function masterBedroomItems(): FurnishingItem[] {
  const house = loadYaml(readFileSync(`${ROOT}/config/house.yaml`, 'utf8')) as { furnishings: { master_bedroom: FurnishingItem[] } };
  return JSON.parse(JSON.stringify(house.furnishings.master_bedroom)) as FurnishingItem[];
}

/** 实读 house.yaml 的 master_bath 条目（按稳定 id 取，深拷贝后可改）。 */
function masterBathItems(): FurnishingItem[] {
  const house = loadYaml(readFileSync(`${ROOT}/config/house.yaml`, 'utf8')) as { furnishings: { master_bath: FurnishingItem[] } };
  return JSON.parse(JSON.stringify(house.furnishings.master_bath)) as FurnishingItem[];
}

/** 实读 house.yaml 全屋 furnishings（按房间分组），供清单穷尽性守卫遍历。 */
function houseFurnishings(): Record<string, FurnishingItem[]> {
  const house = loadYaml(readFileSync(`${ROOT}/config/house.yaml`, 'utf8')) as { furnishings: Record<string, FurnishingItem[]> };
  return house.furnishings;
}

function byId(items: FurnishingItem[], id: string): FurnishingItem {
  const item = items.find((candidate) => candidate.id === id);
  assert.ok(item, `${id} must be declared in config/house.yaml`);
  return item;
}

/** 奇数 quarter-turn 旋转交换 width/depth（与 verify-furniture-placement / DXF 同一口径）。 */
function worldEnvelope(item: PlacementItem, x: number, z: number, width: number, depth: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const quarterTurns = Math.round((item.rotation ?? 0) / 90) % 2 !== 0;
  const [w, d] = quarterTurns ? [depth, width] : [width, depth];
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

/** 主卧房间实读 model-geometry.yaml（DXF / 场景输入随配置走，不在本文件手抄第二份）。 */
function masterBedroomRoom(): ResolvedRoom {
  const layout = resolveLayout(loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml);
  const room = layout.rooms.find((candidate) => candidate.id === 'master_bedroom');
  assert.ok(room, 'master_bedroom must exist in model-geometry.yaml');
  return room;
}

/** 主卫房间实读 model-geometry.yaml（通顶柜 / 洗手柜已移入主卫，见下）。 */
function masterBathRoom(): ResolvedRoom {
  const layout = resolveLayout(loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml);
  const room = layout.rooms.find((candidate) => candidate.id === 'master_bath');
  assert.ok(room, 'master_bath must exist in model-geometry.yaml');
  return room;
}

describe('w_mbath_east / w_mb_east along 语义（issue #98：绝对 z 特例已删）', () => {
  it('两面宿主墙几何与 model-geometry.yaml 实读一致（沿墙距离的起算原点）', () => {
    const layout = resolveLayout(loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml);
    for (const [id, wall] of Object.entries(WALLS)) {
      const declared = layout.walls.find((candidate) => candidate.id === id);
      assert.ok(declared, `${id} must exist in model-geometry.yaml`);
      closeTo(declared.x1, wall.x1);
      closeTo(declared.z1, wall.z1);
      closeTo(declared.x2, wall.x2);
      closeTo(declared.z2, wall.z2);
    }
    closeTo(WALL_THICKNESS, 0.12);
  });

  it('受影响条目清单已穷尽：这两面墙上只有这 5 件挂墙家具，且 along = 当前锚点 z − 墙起点 z', () => {
    // 清单穷尽性守卫：原特例只在 w_mbath_east / w_mb_east 上生效，house.yaml 里挂在这两面
    // 墙上的家具必须且只能是被改写的条目——新增第 6 件而不按沿墙距离书写时这里显形。
    // 右侧期望值是当前解算的世界锚点 z（along + 墙起点 z，逐件手算核对后钉死；沿墙换算
    // 算术本身由本文件后半的柜体 / 反向 / 越界测试覆盖）。
    // 2026-11-13 issue #116：底柜 + 双悬浮板 + PVC 墙行包管退役，只剩通顶柜 1 件。
    // 2026-11-15 #98 Tier 1：书房季节柜两腿（step_north / step_south）改墙锚至 w_mb_east，
    // 沿墙距离按同一口径书写（along = 世界锚点 z − 墙起点 z），清单扩为 3 件。
    // （#98 Tier 2）新增第 4 件 bnw.desk：沿墙距离书写（along 1.00 = 原绝对 z 2.10 − 起点 z 1.10），
    // 与通顶柜同一条 along 规则核对。
    // 2026-11-27 干湿分离放弃：洗手柜 mb.washbasin_cabinet 移入主卫（w_mbath_east 西脸，沿位 0.575），
    // 清单扩为 5 件。通顶柜亦同日移入主卫（沿位 2.245，宽 0.90）。
    // 注意：bnw.desk 与 step_north 的声明注记仍写旧口径——桌注记称「沿墙南移 0.30m
    // （along 1.00→1.30）」，但墙起点北移 1.14m 后 along 1.30 解算到 z=1.26，比旧位 2.10
    // 反而北移 0.84m；北腿注记仍称中心 6.289 / 止于 6.45，沿位未随墙起点重算（现解算中心
    // 6.194 / 止于 6.355），而南腿已重算（along 1.83→1.79，中心 7.245 与注记一致）。两处
    // 均为「注记未跟墙起点走」的可疑漂移，待裁定；本测试只钉沿墙换算算术，不替注记背书。
    const currentAnchorZ: Record<string, number> = {
      'mb.full_height_cabinet': 2.205,
      'mb.washbasin_cabinet': 0.535,
      'bnw.desk': 1.26,
      'study.seasonal_wardrobe_step_north': 6.194,
      'study.seasonal_wardrobe_step_south': 7.245,
    };
    const anchored = Object.entries(houseFurnishings()).flatMap(([room, items]) =>
      items
        .filter((item) => item.wall === 'w_mbath_east' || item.wall === 'w_mb_east')
        .map((item) => ({ room, item })));
    assert.deepEqual(
      anchored.map(({ item }) => item.id).sort(),
      Object.keys(currentAnchorZ).sort(),
      '这两面墙上的挂墙家具必须恰好是被特例改写的 5 件',
    );
    for (const { room, item } of anchored) {
      const wall = WALLS[item.wall as string];
      assert.ok(wall, `${room}/${item.type}: 宿主墙必须在本文件登记的几何里`);
      // along = 世界锚点 − 起点顶点沿墙坐标（两面墙均为竖向，沿墙向 = +z）。
      closeTo(item.along as number, currentAnchorZ[item.id as string] - wall.z1);
      // 反算回世界锚点，与当前解算值逐位相等（几何零漂移的另一半证据）。
      closeTo(wall.z1 + (item.along as number), currentAnchorZ[item.id as string]);
    }
  });

  it('全屋挂墙家具的 along 均短于宿主墙长（别处没有同类「绝对坐标当沿墙距离」写法）', () => {
    // 绝对坐标写成 along 的共性特征：数值远超墙段长度（例：w_mb_east 长 4.345，电气注释里的
    // 绝对 z=8.82 若当 along 书写就会在此显形）。合法沿墙距离必 ≤ 墙长 − 半宽 + 端部容差。
    const layout = resolveLayout(loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml);
    const lengths = new Map(layout.walls.map((wall) => [wall.id, Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)]));
    const anchored = Object.entries(houseFurnishings()).flatMap(([room, items]) =>
      items.filter((item) => item.wall !== undefined && item.along !== undefined).map((item) => ({ room, item })));
    assert.ok(anchored.length >= 4, `house.yaml 应有 ≥4 件挂墙家具，现 ${anchored.length}`);
    for (const { room, item } of anchored) {
      const length = lengths.get(item.wall as string);
      assert.ok(length !== undefined, `${room}/${item.type}: wall "${String(item.wall)}" 不在 model-geometry.yaml`);
      assert.ok(
        (item.along as number) < length,
        `${room}/${item.type}: along ${String(item.along)} 不短于墙 "${String(item.wall)} 长度 ${length.toFixed(3)}——疑似把绝对坐标当沿墙距离书写`,
      );
    }
  });

  it('mb_full_height_cabinet：along 2.245 → 中心 (2.5425, 2.205)，包络 x[2.26,2.825] z[1.755,2.655]', () => {
    // 手算：along 2.245 自起点顶点 v_bath_ne(2.90,−0.04) 沿墙向北 → 锚点 (2.90, −0.04+2.245=2.205)；
    // 中心 x = 2.90 − 0.06(半墙厚) − 0.015(wall_clearance) − 0.565/2 = 2.5425；
    // 宽 0.90 / 深 0.565 / 总高 2.48 行内声明（issue #116 参数化单点定义；2026-11-27 干湿分离
    // 放弃后移入主卫：宽由 1.38 收窄为 0.90、高由 2.80（柜身 2.50 + 顶封 0.30）降为 2.48，
    // 原 0.30m 顶封作废，SceneBuilder 按 cabinetHeight 缩放配方总高）；rotation 270 交换轴
    // → 世界宽 = 深 0.565、世界深 = 宽 0.90。
    const item = byId(masterBathItems(), 'mb.full_height_cabinet');
    assert.equal(item.wall, 'w_mbath_east');
    assert.equal(item.wall_side, 'west');
    assert.equal(item.rotation, 270);
    closeTo(item.along as number, 2.245);
    assert.equal(item.width, 0.90);
    assert.equal(item.depth, 0.565);
    assert.equal(item.cabinetHeight, 2.48);
    closeTo(item.wall_clearance as number, 0.015);
    const placement = resolveOk(item, segments('w_mbath_east'));
    closeTo(placement.x, 2.5425);
    closeTo(placement.z, 2.205);
    const box = worldEnvelope(item, placement.x, placement.z, 0.90, 0.565);
    closeTo(box.minX, 2.26);
    closeTo(box.maxX, 2.825);
    closeTo(box.minZ, 1.755);
    closeTo(box.maxZ, 2.655);
  });

  it('along 自起点顶点沿墙向量起算：墙段反向声明时同一点落在另一端', () => {
    // 同一锚点世界 z=2.205：正向墙（v_bath_ne→v_bath_s）along 2.245；反向声明则 along 1.545
    // （墙长 3.79；宽 0.90 的合法域为 [0.450, 3.340]，两值均在域内）。
    const forward = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 2.245, width: 0.90, depth: 0.565, wall_clearance: 0.015, support: { kind: 'floor' } },
      segments('w_mbath_east'),
    );
    const reversed = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 1.545, width: 0.90, depth: 0.565, wall_clearance: 0.015, support: { kind: 'floor' } },
      new Map([['w_mbath_east', [{ x1: 2.90, z1: 3.75, x2: 2.90, z2: -0.04 }]]]),
    );
    closeTo(forward.z, 2.205);
    closeTo(reversed.z, 2.205); // 2.205 = 3.75(起点) − 1.545(along)
    closeTo(reversed.x, forward.x);
  });

  it('旧绝对 z 值（3.61 / 3.70）在这两面墙上越界，返回诊断而非静默按绝对坐标解析', () => {
    // 特例删除前 along 3.61/3.70 是合法绝对 z；删除后它们是越界的沿墙距离（墙长 3.79），
    // 必须显形——若仍按绝对 z 解析，这里会拿到一个 x≈2.54、z=3.61 的"正常"摆位。
    // 合法域 = [0 + 半宽, 墙长 − 半宽]：宽 1.38 → [0.690, 3.100]；宽 1.20 → [0.600, 3.190]。
    const cases: Array<{ type: string; along: number; width: number; diagnostic: string }> = [
      { type: 'mb_vanity_base_cabinet', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 3.100] on "w_mbath_east"' },
      { type: 'mb_vanity_lower_board', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 3.100] on "w_mbath_east"' },
      { type: 'mb_vanity_main_board', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 3.100] on "w_mbath_east"' },
      { type: 'mb_vanity_pvc_box', along: 3.70, width: 1.20, diagnostic: 'wall anchor along=3.7 places furniture outside wall span [0.600, 3.190] on "w_mbath_east"' },
    ];
    for (const { type, along, width, diagnostic } of cases) {
      const resolution = resolveFurniturePlacement(
        { type, wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along, width, depth: 0.565 },
        segments('w_mbath_east'),
      );
      assert.equal(resolution.placement, null, `${type} must not silently resolve`);
      assert.equal(resolution.diagnostic, diagnostic);
    }
    // w_mb_east（原 ABSOLUTE_ALONG_WALLS 的另一员，已无任何家具消费方）同样按沿墙距离解释：
    // 合法域 = [0.690, 4.345 − 0.690 = 3.655]；电气注释里的绝对 z=8.82 越界。
    const mbEast = resolveFurniturePlacement(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mb_east', wall_side: 'west', rotation: 270, along: 8.82, width: 1.38, depth: 0.565 },
      segments('w_mb_east'),
    );
    assert.equal(mbEast.placement, null);
    assert.equal(mbEast.diagnostic, 'wall anchor along=8.82 places furniture outside wall span [0.690, 3.655] on "w_mb_east"');
    // 合法沿墙距离仍可解：along 2.00 自 v_mb_ne(4.16,5.455) 向南 → z=7.455。
    const legal = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mb_east', wall_side: 'west', rotation: 270, along: 2.00, width: 1.38, depth: 0.565, support: { kind: 'floor' } },
      segments('w_mb_east'),
    );
    closeTo(legal.x, 3.8175); // 4.16 − 0.06(半墙厚) − 0 − 0.565/2
    closeTo(legal.z, 7.455);
  });

  it('DXF：越界 along 令整次导出失败，合法 along 导出改前同一组中心文字坐标', () => {
    // 2026-11-27 干湿分离放弃：通顶柜已移入主卫，本测试只喂主卫的该件（furnishings 键
    // master_bath），宿主墙只须 w_mbath_east；其余主卧条目（洗手柜 w_mbath_south、梳妆台
    // w_west_upper）由各自的沿墙测试覆盖，不在此合成场景里。
    const items = masterBathItems().filter((item) => item.id === 'mb.full_height_cabinet');
    const walls: Array<Extract<SceneElement, { type: 'wall' }>> = (['w_mbath_east'] as const)
      .map((id) => ({ type: 'wall', id, ...WALLS[id] }));
    const dxfInput = (furnishings: FurnishingItem[]) => ({
      house: { rooms: [masterBathRoom()], furnishings: { master_bath: furnishings } as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: walls },
    });

    const healthy = buildProjectDxf(dxfInput(items));
    assert.deepEqual(healthy.errors, []);
    // 中心文字坐标（DXF x = local_x×1000、y = −local_z×1000，4 位小数）：期望值由
    // 通顶柜的解算摆位换算得出，不钉手写坐标——DXF 导出须把解算出的摆位中心
    // 原样印出来（解算本身由本文件前半与 resolver-baseline 覆盖，导出只验印字）。
    // 2026-11-13 issue #116：pvc_box（冷凝水走向代理，DXF 不画、只告警）随冷凝链退役，
    // 协调示意件告警在本房已无主体。
    const cabinet = resolveOk(byId(items, 'mb.full_height_cabinet'), segments('w_mbath_east'));
    const expectedCenterText = `10\n${(cabinet.x * 1000).toFixed(4)}\n20\n${(-cabinet.z * 1000).toFixed(4)}`;
    assert.ok(healthy.dxf.includes(expectedCenterText), '通顶柜中心文字坐标应等于解算摆位的 DXF 换算');

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    byId(broken, 'mb.full_height_cabinet').along = 3.61;
    // 1 条 error：通顶柜 along 越界即整次导出失败。
    const brokenResult = buildProjectDxf(dxfInput(broken));
    assert.equal(brokenResult.errors.length, 1);
    assert.match(brokenResult.errors[0], /master_bath:mb_full_height_cabinet: wall anchor along=3\.61 places furniture outside wall span/);
  });

  it('页面（SceneBuilder）：越界 along 进 report.placementDiagnostics，坏件不进场景', () => {
    // 2026-11-27 干湿分离放弃：通顶柜已移入主卫，本测试只喂主卫的该件（furnishings 键
    // master_bath）；链解算的宿主墙与 HVAC 锚点上下文照旧喂入，覆盖「带 HVAC 图建场」路径。
    const items = masterBathItems().filter((item) => item.id === 'mb.full_height_cabinet');
    // 链解算的三面宿主墙（shared/condensate-chain.ts 从 w_mb_east / w_mbath_east /
    // w_mbath_south 派生段端点）+ hvac 锚点/候选点与 MEP 穿墙点：2026-11-13 issue #116
    // 冷凝链退役，场景不再喂链条家具；此处仍喂 HVAC 锚点上下文（indoor_master +
    // condensate_master_candidate），覆盖「带 HVAC 图建场」路径，健康态仍须零诊断。
    const chainWalls = [
      { id: 'w_mbath_east', ...WALLS.w_mbath_east, height: 2.8 },
      { id: 'w_mb_east', ...WALLS.w_mb_east, height: 2.8 },
      { id: 'w_mbath_south', x1: 0.40, z1: 2.86, x2: 2.60, z2: 2.86, height: 2.8 },
      // #98 Tier 1：梳妆台 + 凳墙锚至 w_west_upper，合成场景须含该墙，否则健康态即报诊断。
      { id: 'w_west_upper', ...WALLS.w_west_upper, height: 2.8 },
    ];
    const chainOptions = {
      hvac: {
        diagram: {
          anchors: [{ id: 'indoor_master', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_master' } }],
          terminals: [{
            id: 'condensate_master_candidate', kind: 'condensate_drain_candidate', status: 'pending', confirmed: false,
            render_interior: false, render_coordination: true, system: 'condensate', position: { x: 2.0, y: 0.1, z: 2.5 },
          }],
          routes: [],
          reference_constraints: [],
        } as unknown as HvacDiagram,
        sources: { ceiling: [{ id: 'ac_master', x: 3.70, z: 5.10, height: 2.85 }] as never },
      },
      condensatePenetration: { x: 2.30, z: 2.86 },
    };
    const build = (furnishings: FurnishingItem[]) => buildScene({
      rooms: [masterBathRoom()],
      walls: chainWalls,
      elements: chainWalls.map((wall) => ({ type: 'wall', ...wall }) as SceneElement),
      furnishings: { master_bath: furnishings } as FurnishingsYaml,
      options: chainOptions,
    });

    const healthy = build(items);
    assert.deepEqual(healthy.report.placementDiagnostics, []);
    const cabinet = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'mb.full_height_cabinet');
    assert.ok(cabinet, 'healthy config must place mb.full_height_cabinet');
    closeTo(cabinet!.position.x, 2.5425);
    closeTo(cabinet!.position.z, 2.205);

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    byId(broken, 'mb.full_height_cabinet').along = 3.61;
    const brokenResult = build(broken);
    // 1 条 = 通顶柜 along 越界。2026-11-13 issue #116 冷凝链退役：链级根因不再产生
    // （wallRun 宿主已删，resolveCondensateChain 返回空几何、无诊断），越界件本身不进场景。
    assert.equal(brokenResult.report.placementDiagnostics.length, 1);
    assert.match(
      brokenResult.report.placementDiagnostics[0],
      /master_bath:mb_full_height_cabinet: wall anchor along=3\.61 places furniture outside wall span/,
    );
    assert.ok(!brokenResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'mb.full_height_cabinet'), '坏件不得静默进场景');
  });

  it('verify:furniture：越界 along 令校验退出非零并点名 wall span', () => {
    // 校验器读 cwd 下的 config/，故复制 config 到临时 workspace 再改 house.yaml，
    // 脚本本体（及其对 shared/ 的相对 import）仍用仓库内那一份。
    const workspace = mkdtempSync(join(tmpdir(), 'mb-along-verify-'));
    try {
      cpSync(`${ROOT}/config`, join(workspace, 'config'), { recursive: true });
      const mutated = readFileSync(`${ROOT}/config/house.yaml`, 'utf8')
        .replaceAll('along: 2.245', 'along: 3.61');
      assert.match(mutated, /along: 3\.61/);
      writeFileSync(join(workspace, 'config', 'house.yaml'), mutated, 'utf8');

      const result = spawnSync(
        process.execPath,
        [`${ROOT}/node_modules/tsx/dist/cli.mjs`, `${ROOT}/scripts/verify/placement/verify-furniture-placement.ts`],
        { cwd: workspace, encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0, `verify:furniture must fail on out-of-range along\n${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /wall anchor along=3\.61 places furniture outside wall span \[0\.450, 3\.340\] on "w_mbath_east"/);
      assert.match(`${result.stdout}${result.stderr}`, /furniture placement: \d+ error\(s\)/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
