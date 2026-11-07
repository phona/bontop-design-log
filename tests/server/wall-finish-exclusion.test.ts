import { parseOverlayFiles, mergeSceneElements, validateWallFinish } from '../../server/overlay-merge.js';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import assert from 'node:assert/strict';
import test from 'node:test';
import { wallFaceOffset } from '../../shared/wall-segments.js';
import { resolveLayout } from '../../server/layout-resolver.js';

/**
 * 面层配方下沉（2026-11-07 issue #98 第三阶段 S4）后新增的两条机器规则：
 *   ① 砖漆互斥：同一 (墙, 房间) 脸上，贴砖带与涂装带沿墙区间相交时竖向必须不相交
 *      （原 DEC-2026-10-09-P07 的 7 处人工 bottom 对齐 → loader 一条规则）；
 *   ② 完成面偏移由 wallFaceOffset 解析器按 line_datum 解算，#76 量房裁前不给未声明的墙设默认值。
 */

const MG: any = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const layout = resolveLayout(MG);

/** 合成墙（最小契约：id + finish）。 */
function wall(id: string, tile: any[], paint: any[]) {
  return { id, finish: { tile_bands: tile, paint_bands: paint } };
}

test('真实配置通过砖漆互斥：18 段涂漆带全部让出同脸贴砖带', () => {
  // 不抛即过。真实配置里 7 处人工对齐（DEC-2026-10-09-P07）现在由规则托底：
  // 客卫 5 处 + 主卫 2 处，含开放洗漱区东墙「0.30 砖 / 0.30→0.77 漆 / 0.77→1.10 砖 / 1.10→2.80 漆」四层交替。
  assert.doesNotThrow(() => validateWallFinish(MG.walls ?? []));
});

test('真实配置：每面承载涂漆带的墙都显式声明 line_datum（#76 裁前不设默认值）', () => {
  const paintHosts = (MG.walls ?? []).filter((w: any) => w.finish?.paint_bands?.length);
  assert.equal(paintHosts.length, 18, '18 面墙带涂漆带');
  for (const host of paintHosts) {
    assert.equal(host.line_datum, 'centerline', `${host.id} 必须显式声明 line_datum`);
  }
});

test('砖漆互斥：漆带 bottom 低于同脸砖带顶即抛错（人工对齐时代的口径）', () => {
  assert.throws(
    () => validateWallFinish([
      wall('w_x', [{ id: 't', room: 'r', along: [0, 2], bottom: 0, height: 0.30 }], [
        { id: 'p', room: 'r', along: [0, 2], bottom: 0, height: 2.8 },
      ]),
    ]),
    /w_x 房间 r.*贴砖带 t.*涂装带 p.*双计/s,
  );
});

test('砖漆互斥：贴面交接合法（paint.bottom === tile.top，边界不算重叠）', () => {
  assert.doesNotThrow(() => validateWallFinish([
    wall('w_x', [{ id: 't', room: 'r', along: [0, 2], bottom: 0, height: 0.30 }], [
      { id: 'p', room: 'r', along: [0, 2], bottom: 0.30, height: 2.8 },
    ]),
  ]));
});

test('砖漆互斥：砖带叠在漆带之上也合法（客卫开放洗漱区的四层交替）', () => {
  assert.doesNotThrow(() => validateWallFinish([
    wall('w_vanity', [
      { id: 't_skirt', room: 'guest_bath', along: [0, 0.75], bottom: 0, height: 0.30 },
      { id: 't_splash', room: 'guest_bath', along: [0, 0.75], bottom: 0.77, height: 1.10 },
    ], [
      { id: 'p_lower', room: 'guest_bath', along: [0, 0.75], bottom: 0.30, height: 0.77 },
      { id: 'p_upper', room: 'guest_bath', along: [0, 0.75], bottom: 1.10, height: 2.80 },
    ]),
  ]));
});

test('砖漆互斥：沿墙区间不交则互不约束（共墙两侧/不同段各贴各的）', () => {
  assert.doesNotThrow(() => validateWallFinish([
    wall('w_x', [{ id: 't', room: 'r', along: [0, 1], bottom: 0, height: 0.30 }], [
      { id: 'p', room: 'r', along: [1, 2], bottom: 0, height: 2.8 },
    ]),
  ]));
});

test('砖漆互斥：不同房间（共墙双面）互不约束', () => {
  assert.doesNotThrow(() => validateWallFinish([
    wall('w_x', [{ id: 't', room: 'kitchen', along: [0, 2], bottom: 0, height: 0.30 }], [
      { id: 'p', room: 'living_dining', along: [0, 2], bottom: 0, height: 2.8 },
    ]),
  ]));
});

test('wallFaceOffset：centerline = 半墙厚 + 8mm（0.068m），未声明即抛错（不设默认值）', () => {
  assert.equal(wallFaceOffset({ id: 'w_x', line_datum: 'centerline' }), 0.068);
  assert.throws(() => wallFaceOffset({ id: 'w_y' }), /未声明 line_datum/);
});

test('mergeSceneElements 把墙的 finish 与 line_datum 透传成 wall 元素（mesh 属性驱动的入口）', () => {
  const merged = mergeSceneElements(layout.walls as any, parseOverlayFiles());
  const walls = merged.filter((element) => element.type === 'wall');
  const tileBands = walls.flatMap((element: any) => element.finish?.tile_bands ?? []);
  const paintBands = walls.flatMap((element: any) => element.finish?.paint_bands ?? []);
  assert.equal(tileBands.length, 18, '18 段贴砖带随墙进场景');
  assert.equal(paintBands.length, 31, '31 段涂装带随墙进场景');
  const datumWalls = walls.filter((element: any) => element.line_datum === 'centerline');
  assert.ok(datumWalls.length >= 18, '完成面宿主墙的 datum 必须透传（涂漆带出网要用）');
  // bay_sill 构件的面层配方同样透传（元素间引用 28 → 0：sill 的 tile/paint 就住在构件里）
  const bays = merged.filter((element) => element.type === 'bay_sill');
  assert.equal(bays.flatMap((element: any) => element.finish?.tile ?? []).length, 20, '20 段防水台贴砖');
  assert.equal(bays.flatMap((element: any) => element.finish?.paint ?? []).length, 8, '8 段飘窗涂装');
});
