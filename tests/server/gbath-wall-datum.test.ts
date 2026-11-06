// 墙线基准语义（2026-11-06 业主口径 A，落实 pending #76）几何基准测试。
// 期望值全部手算写死（算式见各断言旁注释），不经被测代码推导；墙线声明与几何从
// config/layout/model-geometry.yaml 实读比对，防止本文件的字面输入随配置漂移。
// 口径：墙线 = 渲染墙盒中心线，完成面 = 线 ± WALL_THICKNESS/2；所有 wall/wall_side/along
// 家具一律从完成面起算（shared/furniture-placement.ts 单一实现）。
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load as loadYaml } from 'js-yaml';
import { resolveFurniturePlacement, WALL_THICKNESS } from '../../shared/furniture-placement.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import type { VertexLayoutYaml } from '../../shared/types.js';

interface WallLike { x1: number; z1: number; x2: number; z2: number }

// 手抄 config/layout/model-geometry.yaml 的三面宿主墙几何（下方有实读一致性断言）。
const WALLS: Record<string, WallLike> = {
  w_gbath_east_open_vanity: { x1: 7.20, z1: 3.55, x2: 7.20, z2: 4.30 },
  w_gbath_west_open_vanity: { x1: 5.60, z1: 3.55, x2: 5.60, z2: 4.30 },
  w_mbath_east: { x1: 2.60, z1: 1.10, x2: 2.60, z2: 4.30 },
};
const SEGMENTS = new Map(Object.entries(WALLS).map(([id, wall]) => [id, [wall]]));

function closeTo(actual: number, expected: number, tol = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);
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

  it('vanity envelope stays x[6.64,7.14] z[3.61,4.30] (explicit x/z, back face on the datum finish face)', () => {
    // 手算：背面 7.14 = 墙线 7.20 − 半墙厚 0.06；中心 x 6.89 = 7.14 − 0.50/2；
    // z 中心 3.955 = (南墙南脸 3.61 + 墙段南端 4.30)/2，宽 0.69 → z[3.61,4.30]。
    const placement = resolveFurniturePlacement({ type: 'vanity', x: 6.89, z: 3.955, rotation: 270 }, SEGMENTS);
    assert.ok(placement);
    closeTo(placement.x, 6.89);
    closeTo(placement.z, 3.955);
    closeTo(placement.x + 0.50 / 2, 7.14); // 背面（rotation=270，depth 沿世界 x）
    closeTo(placement.x - 0.50 / 2, 6.64); // 正面
    closeTo(placement.z - 0.69 / 2, 3.61); // 南端贴南墙南脸
    closeTo(placement.z + 0.69 / 2, 4.30); // 北端贴墙段南端
  });

  it('mirror_cabinet_gbath back face lands on the finish face 7.14 (was on the wall line 7.20)', () => {
    // 手算：中心 x = 7.20 − 0.06(半墙厚) − 0.0(clearance) − 0.14/2 = 7.07；
    // 背面 = 7.07 + 0.07 = 7.14；along 0.405 → z = 3.55 + 0.405 = 3.955，宽 0.66 → z[3.625,4.285]。
    const placement = resolveFurniturePlacement(
      { type: 'mirror_cabinet_gbath', wall: 'w_gbath_east_open_vanity', wall_side: 'west', rotation: 270, along: 0.405, wall_clearance: 0.0 },
      SEGMENTS,
    );
    assert.ok(placement);
    closeTo(placement.x, 7.07);
    closeTo(placement.z, 3.955);
    closeTo(placement.x + 0.14 / 2, 7.14); // 背面贴完成面，不再穿渲染墙盒
    closeTo(placement.x - 0.14 / 2, 7.00);
    closeTo(placement.z - 0.66 / 2, 3.625);
    closeTo(placement.z + 0.66 / 2, 4.285);
  });

  it('heated_towel_rack back face lands on the west wall finish face 5.66 (was on the wall line 5.60)', () => {
    // 手算：中心 x = 5.60 + 0.06(半墙厚) + 0.0(clearance) + 0.10/2 = 5.71；
    // 背面 = 5.71 − 0.05 = 5.66；along 0.405 → z = 3.955，宽 0.55 → z[3.68,4.23]。
    const placement = resolveFurniturePlacement(
      { type: 'heated_towel_rack', wall: 'w_gbath_west_open_vanity', wall_side: 'east', along: 0.405, wall_clearance: 0.0, rotation: 90 },
      SEGMENTS,
    );
    assert.ok(placement);
    closeTo(placement.x, 5.71);
    closeTo(placement.z, 3.955);
    closeTo(placement.x - 0.10 / 2, 5.66); // 背面贴完成面，不再穿渲染墙盒
    closeTo(placement.x + 0.10 / 2, 5.76);
    closeTo(placement.z - 0.55 / 2, 3.68);
    closeTo(placement.z + 0.55 / 2, 4.23);
  });

  it('master mb_vanity_base_cabinet placement is unchanged by the datum refactor', () => {
    // 手算：中心 x = 2.60 − 0.06(半墙厚) − 0.015(clearance) − 0.565/2 = 2.2425；
    // along 3.61 为绝对 z（w_mbath_east 特例，与基准语义无关）；宽 1.38 → z[2.92,4.30]。
    const placement = resolveFurniturePlacement(
      { type: 'mb_vanity_base_cabinet', wall: 'w_mbath_east', wall_side: 'west', rotation: 270, along: 3.61, wall_clearance: 0.015 },
      SEGMENTS,
    );
    assert.ok(placement);
    closeTo(placement.x, 2.2425);
    closeTo(placement.z, 3.61);
    closeTo(placement.x + 0.565 / 2, 2.525); // 背面（完成面 2.54 前 15mm 退让）
    closeTo(placement.x - 0.565 / 2, 1.96);
    closeTo(placement.z - 1.38 / 2, 2.92);
    closeTo(placement.z + 1.38 / 2, 4.30);
  });
});
