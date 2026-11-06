// 主卫东墙（w_mbath_east）along 语义收口：issue #98 删除「along = 绝对 z」历史特例后，
// along 一律是「从墙段起点顶点沿墙向的距离」（与 overlay.yaml wall_region/paint_region 的
// along 区间同一口径）。本文件把 4 件受影响家具的世界包络用手算基准钉死，并证明越界的
// along 不再被静默解析成绝对坐标，而是走 PR-3 已建的摆位诊断链（页面 / DXF / verify:furniture）。
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

// 手抄 config/layout/model-geometry.yaml 的两面宿主墙几何（下方有实读一致性断言）。
// w_mbath_east：v_bath_ne(2.60,1.10) → v_bath_s(2.60,4.30)，长 3.20；
// w_mb_east：    v_mb_ne (4.20,5.55) → v_mb_se(4.20,9.80)，长 4.25。
const WALLS: Record<string, WallLike> = {
  w_mbath_east: { x1: 2.60, z1: 1.10, x2: 2.60, z2: 4.30 },
  w_mb_east: { x1: 4.20, z1: 5.55, x2: 4.20, z2: 9.80 },
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

  it('受影响条目清单已穷尽：这两面墙上只有这 4 件挂墙家具，且 along = 原绝对 z − 墙起点 z', () => {
    // 清单穷尽性守卫：原特例只在 w_mbath_east / w_mb_east 上生效，house.yaml 里挂在这两面
    // 墙上的家具必须且只能是被改写的 4 件——新增第 5 件而不按沿墙距离书写时这里显形。
    // 右侧期望值是改前（along 当绝对 z）的世界锚点 z，逐件手抄自 git 历史里的原声明。
    const historicalAnchorZ: Record<string, number> = {
      'mb.vanity_base_cabinet': 3.61,
      'mb.vanity_lower_board': 3.61,
      'mb.vanity_main_board': 3.61,
      'mb.vanity_pvc_box': 3.70,
    };
    const anchored = Object.entries(houseFurnishings()).flatMap(([room, items]) =>
      items
        .filter((item) => item.wall === 'w_mbath_east' || item.wall === 'w_mb_east')
        .map((item) => ({ room, item })));
    assert.deepEqual(
      anchored.map(({ item }) => item.id).sort(),
      Object.keys(historicalAnchorZ).sort(),
      '这两面墙上的挂墙家具必须恰好是被特例改写的 4 件',
    );
    for (const { room, item } of anchored) {
      const wall = WALLS[item.wall as string];
      assert.ok(wall, `${room}/${item.type}: 宿主墙必须在本文件登记的几何里`);
      // along = 世界锚点 − 起点顶点沿墙坐标（两面墙均为竖向，沿墙向 = +z）。
      closeTo(item.along as number, historicalAnchorZ[item.id as string] - wall.z1);
      // 反算回世界锚点，与改前声明逐位相等（几何零漂移的另一半证据）。
      closeTo(wall.z1 + (item.along as number), historicalAnchorZ[item.id as string]);
    }
  });

  it('全屋挂墙家具的 along 均短于宿主墙长（别处没有同类「绝对坐标当沿墙距离」写法）', () => {
    // 绝对坐标写成 along 的共性特征：数值远超墙段长度（例：w_mb_east 长 4.25，电气注释里的
    // 绝对 z=8.82 若当 along 书写就会在此显形）。合法沿墙距离必 ≤ 墙长 − 半宽 + 端部容差。
    const layout = resolveLayout(loadYaml(readFileSync(`${ROOT}/config/layout/model-geometry.yaml`, 'utf8')) as VertexLayoutYaml);
    const lengths = new Map(layout.walls.map((wall) => [wall.id, Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)]));
    const anchored = Object.entries(houseFurnishings()).flatMap(([room, items]) =>
      items.filter((item) => item.wall !== undefined && item.along !== undefined).map((item) => ({ room, item })));
    assert.ok(anchored.length >= 7, `house.yaml 应有 ≥7 件挂墙家具（4 主卫 + 3 客卫），现 ${anchored.length}`);
    for (const { room, item } of anchored) {
      const length = lengths.get(item.wall as string);
      assert.ok(length !== undefined, `${room}/${item.type}: wall "${String(item.wall)}" 不在 model-geometry.yaml`);
      assert.ok(
        (item.along as number) < length,
        `${room}/${item.type}: along ${String(item.along)} 不短于墙 "${String(item.wall)} 长度 ${length.toFixed(3)}——疑似把绝对坐标当沿墙距离书写`,
      );
    }
  });

  it('mb_vanity_base_cabinet：along 2.51 → 中心 (2.2425, 3.61)，包络 x[1.96,2.525] z[2.92,4.30]', () => {
    // 手算：along 2.51 自起点顶点 v_bath_ne(2.60,1.10) 沿墙向北 → 锚点 (2.60, 1.10+2.51=3.61)；
    // 中心 x = 2.60 − 0.06(半墙厚) − 0.015(wall_clearance) − 0.565/2 = 2.2425；
    // 宽 1.38 / 深 0.565 来自 FURNITURE_DIMS 目录（行内未重复声明）；rotation 270 交换轴
    // → 世界宽 = 深 0.565、世界深 = 宽 1.38。
    const item = byId(masterBedroomItems(), 'mb.vanity_base_cabinet');
    assert.equal(item.wall, 'w_mbath_east');
    assert.equal(item.wall_side, 'west');
    assert.equal(item.rotation, 270);
    closeTo(item.along as number, 2.51);
    assert.equal(item.width, undefined, '尺寸走 FURNITURE_DIMS 目录，行内不写第二套');
    closeTo(item.wall_clearance as number, 0.015);
    const placement = resolveOk(item, segments('w_mbath_east'));
    closeTo(placement.x, 2.2425);
    closeTo(placement.z, 3.61);
    const box = worldEnvelope(item, placement.x, placement.z, 1.38, 0.565);
    closeTo(box.minX, 1.96);
    closeTo(box.maxX, 2.525);
    closeTo(box.minZ, 2.92);
    closeTo(box.maxZ, 4.30);
  });

  it('mb_vanity_lower_board / mb_vanity_main_board：与底柜同轴同包络', () => {
    // 两块悬浮板与底柜同 wall/wall_side/rotation/along/width/depth/clearance → 同解。
    for (const id of ['mb.vanity_lower_board', 'mb.vanity_main_board']) {
      const item = byId(masterBedroomItems(), id);
      assert.equal(item.wall, 'w_mbath_east');
      assert.equal(item.wall_side, 'west');
      assert.equal(item.rotation, 270);
      closeTo(item.along as number, 2.51);
      closeTo(item.width as number, 1.38);
      closeTo(item.depth as number, 0.565);
      closeTo(item.wall_clearance as number, 0.015);
      const placement = resolveOk(item, segments('w_mbath_east'));
      closeTo(placement.x, 2.2425);
      closeTo(placement.z, 3.61);
      const box = worldEnvelope(item, placement.x, placement.z, 1.38, 0.565);
      closeTo(box.minX, 1.96);
      closeTo(box.maxX, 2.525);
      closeTo(box.minZ, 2.92);
      closeTo(box.maxZ, 4.30);
    }
  });

  it('mb_vanity_pvc_box：along 2.60 → 中心 (2.50, 3.70)，trim 包络 x[2.46,2.54] z[3.10,4.30]', () => {
    // 手算：目录尺寸 1.20×0.08；along 2.60 → 锚点 (2.60, 1.10+2.60=3.70)；
    // 中心 x = 2.60 − 0.06(半墙厚) − 0 − 0.08/2 = 2.50（管心 x=2.50，与 FixtureFactory 注释一致）；
    // rotation 270 → 世界宽 = 0.08、世界深 = 1.20 → z[3.10,4.30]（= 管行 z 3.10..4.30）。
    const item = byId(masterBedroomItems(), 'mb.vanity_pvc_box');
    assert.equal(item.wall, 'w_mbath_east');
    assert.equal(item.wall_side, 'west');
    assert.equal(item.rotation, 270);
    closeTo(item.along as number, 2.60);
    assert.equal(item.width, undefined);
    assert.equal(item.depth, undefined);
    const placement = resolveOk(item, segments('w_mbath_east'));
    closeTo(placement.x, 2.50);
    closeTo(placement.z, 3.70);
    const box = worldEnvelope(item, placement.x, placement.z, 1.20, 0.08);
    closeTo(box.minX, 2.46);
    closeTo(box.maxX, 2.54);
    closeTo(box.minZ, 3.10);
    closeTo(box.maxZ, 4.30);
  });

  it('along 自起点顶点沿墙向量起算：墙段反向声明时同一点落在另一端', () => {
    // 同一锚点世界 z=3.61：正向墙（v_bath_ne→v_bath_s）along 2.51；反向声明则 along 0.69。
    const forward = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 2.51, width: 1.38, depth: 0.565, wall_clearance: 0.015 },
      segments('w_mbath_east'),
    );
    const reversed = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 0.69, width: 1.38, depth: 0.565, wall_clearance: 0.015 },
      new Map([['w_mbath_east', [{ x1: 2.60, z1: 4.30, x2: 2.60, z2: 1.10 }]]]),
    );
    closeTo(forward.z, 3.61);
    closeTo(reversed.z, 3.61); // 3.61 = 4.30(起点) − 0.69(along)
    closeTo(reversed.x, forward.x);
  });

  it('旧绝对 z 值（3.61 / 3.70）在这两面墙上越界，返回诊断而非静默按绝对坐标解析', () => {
    // 特例删除前 along 3.61/3.70 是合法绝对 z；删除后它们是越界的沿墙距离（墙长 3.20），
    // 必须显形——若仍按绝对 z 解析，这里会拿到一个 x≈2.24、z=3.61 的"正常"摆位。
    // 合法域 = [0 + 半宽, 墙长 − 半宽]：宽 1.38 → [0.690, 2.510]；宽 1.20 → [0.600, 2.600]。
    const cases: Array<{ type: string; along: number; width: number; diagnostic: string }> = [
      { type: 'mb_vanity_base_cabinet', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 2.510] on "w_mbath_east"' },
      { type: 'mb_vanity_lower_board', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 2.510] on "w_mbath_east"' },
      { type: 'mb_vanity_main_board', along: 3.61, width: 1.38, diagnostic: 'wall anchor along=3.61 places furniture outside wall span [0.690, 2.510] on "w_mbath_east"' },
      { type: 'mb_vanity_pvc_box', along: 3.70, width: 1.20, diagnostic: 'wall anchor along=3.7 places furniture outside wall span [0.600, 2.600] on "w_mbath_east"' },
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
    // 合法域 = [0.690, 4.25 − 0.690 = 3.560]；电气注释里的绝对 z=8.82 越界。
    const mbEast = resolveFurniturePlacement(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mb_east', wall_side: 'west', rotation: 270, along: 8.82, width: 1.38, depth: 0.565 },
      segments('w_mb_east'),
    );
    assert.equal(mbEast.placement, null);
    assert.equal(mbEast.diagnostic, 'wall anchor along=8.82 places furniture outside wall span [0.690, 3.560] on "w_mb_east"');
    // 合法沿墙距离仍可解：along 2.00 自 v_mb_ne(4.20,5.55) 向南 → z=7.55。
    const legal = resolveOk(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mb_east', wall_side: 'west', rotation: 270, along: 2.00, width: 1.38, depth: 0.565 },
      segments('w_mb_east'),
    );
    closeTo(legal.x, 3.8575); // 4.20 − 0.06(半墙厚) − 0 − 0.565/2
    closeTo(legal.z, 7.55);
  });

  it('DXF：越界 along 令整次导出失败，合法 along 导出改前同一组中心文字坐标', () => {
    const items = masterBedroomItems();
    const wall: Extract<SceneElement, { type: 'wall' }> = { type: 'wall', id: 'w_mbath_east', ...WALLS.w_mbath_east };
    const dxfInput = (furnishings: FurnishingItem[]) => ({
      house: { rooms: [masterBedroomRoom()], furnishings: { master_bedroom: furnishings } as FurnishingsYaml, electrical: [], ceilingZones: [], sceneElements: [wall] },
    });

    const healthy = buildProjectDxf(dxfInput(items));
    assert.deepEqual(healthy.errors, []);
    // 中心文字坐标（DXF x = local_x×1000、y = −local_z×1000，4 位小数）：与「along 当绝对 z」
    // 时代的手写值逐位相同——三件柜组同为 (2242.5000, −3610.0000)。
    assert.ok(healthy.dxf.includes('10\n2242.5000\n20\n-3610.0000'), 'mb_vanity 柜组中心文字坐标');
    // mb_vanity_pvc_box 属协调示意件（冷凝水走向代理），DXF 不画、只告警——几何以 M-CAND 为准。
    assert.ok(healthy.warnings.some((warning) => /mb_vanity_pvc_box: 协调示意件/.test(warning)), 'pvc_box 必须以告警形式显形而非静默消失');

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    for (const id of ['mb.vanity_base_cabinet', 'mb.vanity_lower_board', 'mb.vanity_main_board']) {
      byId(broken, id).along = 3.61;
    }
    byId(broken, 'mb.vanity_pvc_box').along = 3.70;
    // 3 条 error：pvc_box 是协调示意件，DXF 在解算前就按 M-CAND 口径跳过（其越界诊断由
    // 解算器 / SceneBuilder / verify:furniture 三处覆盖，见本文件其余用例）。
    const brokenResult = buildProjectDxf(dxfInput(broken));
    assert.equal(brokenResult.errors.length, 3);
    for (const error of brokenResult.errors) assert.match(error, /master_bedroom:mb_vanity_\w+: wall anchor along=3\.\d+ places furniture outside wall span/);
    // 被跳过的 pvc_box 仍以告警点名（coordination schematic 豁免只免画，不免显形）——
    // 否则一次「pvc_box along 越界 + 其余三件修好」的导出会静悄悄少掉这条墙行。
    assert.ok(
      brokenResult.warnings.some((warning) => /mb_vanity_pvc_box: 协调示意件/.test(warning)),
      'pvc_box 即使在越界态也必须在 warnings 里显形',
    );
  });

  it('页面（SceneBuilder）：越界 along 进 report.placementDiagnostics，坏件不进场景', () => {
    const items = masterBedroomItems();
    // 链解算的三面宿主墙（shared/condensate-chain.ts 从 w_mb_east / w_mbath_east /
    // w_mbath_south 派生段端点）+ hvac 锚点/候选点与 MEP 穿墙点：PR-10 起 master_bedroom
    // 实配含三件 anchor 声明的链条家具（condensate_pipe_ac_outlet 等），场景不喂这些输入
    // 时链条解不出、会带与 along 无关的根因诊断打穿「无诊断」健康态——口径见
    // tests/server/shared/scene-builder.test.ts 同族用例（场景侧喂合成 diagram + 穿墙点）。
    const chainWalls = [
      { id: 'w_mbath_east', ...WALLS.w_mbath_east, height: 2.8 },
      { id: 'w_mb_east', ...WALLS.w_mb_east, height: 2.8 },
      { id: 'w_mbath_south', x1: 0.40, z1: 2.86, x2: 2.60, z2: 2.86, height: 2.8 },
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
      rooms: [masterBedroomRoom()],
      walls: chainWalls,
      elements: chainWalls.map((wall) => ({ type: 'wall', ...wall }) as SceneElement),
      furnishings: { master_bedroom: furnishings } as FurnishingsYaml,
      options: chainOptions,
    });

    const healthy = build(items);
    assert.deepEqual(healthy.report.placementDiagnostics, []);
    const cabinet = healthy.index.furnitureMeshes.find((group) => group.userData.objectId === 'mb.vanity_base_cabinet');
    assert.ok(cabinet, 'healthy config must place mb.vanity_base_cabinet');
    closeTo(cabinet!.position.x, 2.2425);
    closeTo(cabinet!.position.z, 3.61);

    const broken = JSON.parse(JSON.stringify(items)) as FurnishingItem[];
    for (const id of ['mb.vanity_base_cabinet', 'mb.vanity_lower_board', 'mb.vanity_main_board']) {
      byId(broken, id).along = 3.61;
    }
    byId(broken, 'mb.vanity_pvc_box').along = 3.70;
    const brokenResult = build(broken);
    // 5 条 = 4 件越界 along（底柜/两块板/墙行包管）+ 1 条链级根因：pvc_box 同时是链的墙行
    // 宿主（resolveCondensateChain 的 wallRun），它的 along 越界使整条链作废，三件链条锚点
    // 件按件跳过、不在件级重复根因（addFurniture 口径）。链诊断点名同一越界值，不新增第二
    // 套坐标事实；越界件本身仍一件都不进场景。
    assert.equal(brokenResult.report.placementDiagnostics.length, 5);
    const alongDiagnostics = brokenResult.report.placementDiagnostics.filter((line) => line.startsWith('master_bedroom:mb_vanity_'));
    assert.equal(alongDiagnostics.length, 4);
    for (const diagnostic of alongDiagnostics) {
      assert.match(diagnostic, /master_bedroom:mb_vanity_\w+: wall anchor along=3\.\d+ places furniture outside wall span/);
    }
    assert.ok(
      brokenResult.report.placementDiagnostics.some((line) =>
        line.startsWith('condensate chain:') && line.includes('mb.vanity_pvc_box') && line.includes('along=3.7')),
      '链级根因须显形（墙行宿主越界 → 链作废），且不带双前缀',
    );
    assert.ok(!brokenResult.index.furnitureMeshes.some((group) => group.userData.objectId === 'mb.vanity_base_cabinet'), '坏件不得静默进场景');
  });

  it('verify:furniture：越界 along 令校验退出非零并点名 wall span', () => {
    // 校验器读 cwd 下的 config/，故复制 config 到临时 workspace 再改 house.yaml，
    // 脚本本体（及其对 shared/ 的相对 import）仍用仓库内那一份。
    const workspace = mkdtempSync(join(tmpdir(), 'mb-along-verify-'));
    try {
      cpSync(`${ROOT}/config`, join(workspace, 'config'), { recursive: true });
      const mutated = readFileSync(`${ROOT}/config/house.yaml`, 'utf8')
        .replaceAll('along: 2.51', 'along: 3.61')
        .replace('along: 2.60', 'along: 3.70');
      assert.match(mutated, /along: 3\.61/);
      assert.match(mutated, /along: 3\.70/);
      writeFileSync(join(workspace, 'config', 'house.yaml'), mutated, 'utf8');

      const result = spawnSync(
        process.execPath,
        [`${ROOT}/node_modules/tsx/dist/cli.mjs`, `${ROOT}/scripts/verify/placement/verify-furniture-placement.ts`],
        { cwd: workspace, encoding: 'utf8' },
      );
      assert.notEqual(result.status, 0, `verify:furniture must fail on out-of-range along\n${result.stdout}\n${result.stderr}`);
      assert.match(`${result.stdout}${result.stderr}`, /wall anchor along=3\.61 places furniture outside wall span \[0\.690, 2\.510\] on "w_mbath_east"/);
      assert.match(`${result.stdout}${result.stderr}`, /furniture placement: \d+ error\(s\)/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
