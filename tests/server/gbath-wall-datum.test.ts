// 墙线基准语义（2026-11-06 业主口径 A，落实 pending #76）几何基准测试。
// 期望值全部手算写死（算式见各断言旁注释），不经被测代码推导；墙线声明与几何从
// config/layout/model-geometry.yaml 实读比对，家具条目从 config/house.yaml 实读，
// 防止本文件的字面输入随配置漂移。
// 口径：墙线 = 渲染墙盒中心线，完成面 = 线 ± WALL_THICKNESS/2；所有 wall/wall_side/along
// 家具一律从完成面起算（shared/furniture-placement.ts 单一实现）。
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load as loadYaml } from 'js-yaml';
import { resolveFurniturePlacement, WALL_THICKNESS, type FurniturePlacement, type PlacementItem } from '../../shared/furniture-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { FurnishingItem, VertexLayoutYaml } from '../../shared/types.js';

interface WallLike { x1: number; z1: number; x2: number; z2: number }

// 手抄 config/layout/model-geometry.yaml 的五面宿主墙几何（下方有实读一致性断言）。
// 2026-11-27 干湿分离放弃：两卫洗漱件移入内卫，宿主墙由开放区短墙改为内卫南/西墙；
// 主卫通顶柜随之贴 w_mbath_east（墙线 2.60→2.90、起止随量房回填）。
const WALLS: Record<string, WallLike> = {
  w_gbath_east_open_vanity: { x1: 7.50, z1: 3.64, x2: 7.50, z2: 4.04 },
  w_gbath_west_open_vanity: { x1: 5.69, z1: 3.64, x2: 5.69, z2: 4.04 },
  w_gbath_south: { x1: 5.69, z1: 3.64, x2: 7.50, z2: 3.64 },
  w_gbath_west: { x1: 5.69, z1: 1.36, x2: 5.69, z2: 3.64 },
  w_mbath_east: { x1: 2.90, z1: -0.04, x2: 2.90, z2: 3.75 },
};
const SEGMENTS = new Map(Object.entries(WALLS).map(([id, wall]) => [id, [wall]]));

function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);
}

/** 解析并断言「无诊断 + 有摆位」：诊断路径由 gbath-vanity-layout.test.ts 专测。 */
function resolve(item: PlacementItem): FurniturePlacement {
  const resolution = resolveFurniturePlacement(item, SEGMENTS);
  assert.equal(resolution.diagnostic, undefined, `unexpected diagnostic: ${resolution.diagnostic ?? ''}`);
  assert.ok(resolution.placement, 'placement must resolve');
  return resolution.placement;
}

/** 实读 house.yaml 的 guest_bath 条目（按稳定 id 取），防止测试输入随配置漂移。 */
function guestBathItem(id: string): FurnishingItem {
  const house = loadYaml(readFileSync('config/house.yaml', 'utf8')) as { furnishings: { guest_bath: FurnishingItem[] } };
  const item = house.furnishings.guest_bath.find((candidate) => candidate.id === id);
  assert.ok(item, `${id} must be declared in config/house.yaml`);
  return item;
}

describe('gbath wall datum (2026-11-06 口径 A)', () => {
  it('WALL_THICKNESS stays the single declared wall thickness', () => {
    closeTo(WALL_THICKNESS, 0.12);
  });

  it('every wall hosting wall-anchored furniture declares line_datum: centerline with the hand-copied geometry', () => {
    // 经 resolveLayout 解析（同时覆盖 line_datum 的 resolver 透传），再与手抄几何比对。
    const layout = resolveLayout(loadYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml);
    for (const [id, wall] of Object.entries(WALLS)) {
      const declared = layout.walls.find((candidate) => candidate.id === id);
      assert.ok(declared, `${id} must exist in model-geometry.yaml`);
      assert.equal(declared.line_datum, 'centerline', `${id} must declare line_datum: centerline`);
      closeTo(declared.x1, wall.x1);
      closeTo(declared.z1, wall.z1);
      closeTo(declared.x2, wall.x2);
      closeTo(declared.z2, wall.z2);
    }
  });

  it('vanity is anchored to the datum finish face: center (7.025, 3.43), envelope x[6.68,7.37] z[3.28,3.58]', () => {
    // 2026-11-27 干湿分离放弃 + 业主裁定接受窄深柜：vanity 移入内卫南墙内侧东段（w_gbath_south 北脸），
    // vanity_layout 0.69×0.30。手算：中心 x = 5.69(墙段西端) + 1.335(along) = 7.025；
    // 中心 z = 3.64(墙线) − 0.06(半墙厚) − 0.0(clearance) − 0.30/2 = 3.43，宽 0.69 → x[6.68,7.37]，深 0.30 → z[3.28,3.58]。
    const vanity = guestBathItem('gbath.vanity');
    assert.equal(vanity.x, undefined, 'vanity must not declare absolute x (issue #98 PR-3)');
    assert.equal(vanity.z, undefined, 'vanity must not declare absolute z (issue #98 PR-3)');
    assert.equal(vanity.wall, 'w_gbath_south');
    assert.equal(vanity.wall_side, 'north');
    closeTo(vanity.along as number, 1.335);
    const placement = resolve(vanity);
    closeTo(placement.x, 7.025);
    closeTo(placement.z, 3.43);
    closeTo(placement.z + 0.30 / 2, 3.58); // 背面（rotation=180，depth 沿世界 z，北向贴完成面）
    closeTo(placement.z - 0.30 / 2, 3.28); // 正面
    closeTo(placement.x - 0.69 / 2, 6.68); // 西端
    closeTo(placement.x + 0.69 / 2, 7.37); // 东端
  });

  it('mirror_cabinet_gbath back face lands on the finish face 3.58 (was on the east open-vanity wall)', () => {
    // 2026-11-27 干湿分离放弃：镜柜随台盆移入内卫南墙内侧（w_gbath_south 北脸，沿位 1.335 对齐台盆轴线）。
    // 手算：中心 x = 5.69 + 1.335 = 7.025；中心 z = 3.64 − 0.06(半墙厚) − 0.0(clearance) − 0.14/2 = 3.51；
    // 背面 = 3.51 + 0.07 = 3.58；宽 0.66 → x[6.695,7.355]。
    const mirror = guestBathItem('gbath.mirror_cabinet');
    assert.equal(mirror.wall, 'w_gbath_south');
    assert.equal(mirror.wall_side, 'north');
    closeTo(mirror.along as number, 1.335);
    const placement = resolve(mirror);
    closeTo(placement.x, 7.025);
    closeTo(placement.z, 3.51);
    closeTo(placement.z + 0.14 / 2, 3.58); // 背面贴完成面，不再穿渲染墙盒
    closeTo(placement.z - 0.14 / 2, 3.44);
    closeTo(placement.x - 0.66 / 2, 6.695);
    closeTo(placement.x + 0.66 / 2, 7.355);
  });

  it('towel_set back face lands on the west wall finish face 5.79 (was heated_towel_rack on the open-vanity wall)', () => {
    // 2026-11-27 业主裁定撤电热毛巾架：改普通毛巾架落淋浴区西墙（w_gbath_west 东脸，沿位 1.25）。
    // 手算：中心 x = 5.69 + 0.06(半墙厚) + 0.04(clearance) + 0.28/2 = 5.93；
    // 背面 = 5.93 − 0.14 = 5.79；沿位 1.25 → z = 1.36 + 1.25 = 2.61，宽 0.04 → z[2.59,2.63]。
    const towel = guestBathItem('gbath.towel_set');
    assert.equal(towel.wall, 'w_gbath_west');
    assert.equal(towel.wall_side, 'east');
    closeTo(towel.along as number, 1.25);
    const placement = resolve(towel);
    closeTo(placement.x, 5.93);
    closeTo(placement.z, 2.61);
    closeTo(placement.x - 0.28 / 2, 5.79); // 背面贴完成面，不再穿渲染墙盒
    closeTo(placement.x + 0.28 / 2, 6.07);
    closeTo(placement.z - 0.04 / 2, 2.59);
    closeTo(placement.z + 0.04 / 2, 2.63);
  });

  it('master mb_vanity_base_cabinet placement is unchanged by the datum refactor', () => {
    // 2026-11-27 干湿分离放弃：通顶柜移入主卫、贴 w_mbath_east 西脸，沿位 2.245、宽 0.90、深 0.565、柜高 2.48。
    // 手算：中心 x = 2.90 − 0.06(半墙厚) − 0.015(clearance) − 0.565/2 = 2.5425；
    // 沿位 2.245 自墙段起点 (2.90,−0.04) 向北量 → z = −0.04 + 2.245 = 2.205；宽 0.90 → z[1.755,2.655]。
    const placement = resolve(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 2.245, wall_clearance: 0.015, support: { kind: 'floor' } },
    );
    closeTo(placement.x, 2.5425);
    closeTo(placement.z, 2.205);
    closeTo(placement.x + 0.565 / 2, 2.825); // 背面（完成面 2.84 前 15mm 退让）
    closeTo(placement.x - 0.565 / 2, 2.26);
    closeTo(placement.z - 0.90 / 2, 1.755);
    closeTo(placement.z + 0.90 / 2, 2.655);
  });
});
