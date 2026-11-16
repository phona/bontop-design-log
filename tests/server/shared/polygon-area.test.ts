import assert from 'node:assert/strict';
import test from 'node:test';
import { roundedPolygonArea } from '../../../shared/polygon-area.js';

/**
 * shared/polygon-area.ts 的圆角闭式解。2026-11-16 量价算法审计 D1：
 * 房间面积曾用尖角鞋带公式，三处 r=1.0 圆角各多算 0.2146㎡——
 * 本函数是 floor_region 与房间面积的唯一同源实现。
 */

test('尖角多边形 = 鞋带面积', () => {
  assert.ok(Math.abs(roundedPolygonArea([
    { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 },
  ]) - 12) < 1e-9);
});

test('凸圆角扣 r²(1−π/4)：north_platform_floor 的 1.60→1.3854', () => {
  // 与 config/model/envelope/floor-zones.yaml 的 north_platform_floor 同形：
  // 西北角 (5.6,0) r=1.0、弧心 (6.6,1.0)。
  const area = roundedPolygonArea([
    { x: 5.6, z: 0.0, radius: 1.0, cx: 6.6, cz: 1.0 },
    { x: 7.2, z: 0.0 },
    { x: 7.2, z: 1.0 },
    { x: 5.6, z: 1.0 },
  ]);
  assert.ok(Math.abs(area - (1.6 - (1 - Math.PI / 4))) < 1e-9);
});

test('凹圆角补面积：L 形内凹角 r=0.5 加回圆弓外的角料', () => {
  // L 形 (0,0)-(2,0)-(2,2)-(1,2)-(1,1)-(0,1)，内凹角 (1,1) r=0.5、弧心 (0.5,1.5)。
  // 补回 = 角三角形 0.125 − 圆弓 0.25×(π/2−1)/2。
  const area = roundedPolygonArea([
    { x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 1, z: 2 },
    { x: 1, z: 1, radius: 0.5, cx: 0.5, cz: 1.5 },
    { x: 0, z: 1 },
  ]);
  const expected = 3 + (0.125 - 0.25 * (Math.PI / 2 - 1) / 2);
  assert.ok(Math.abs(area - expected) < 1e-9, `got ${area}, want ${expected}`);
});

test('圆角点缺 cx/cz 即抛错，不静默按尖角算', () => {
  assert.throws(
    () => roundedPolygonArea([
      { x: 0, z: 0, radius: 1.0 },
      { x: 1.6, z: 0 },
      { x: 1.6, z: 1 },
      { x: 0, z: 1 },
    ]),
    /缺 cx\/cz/,
  );
  assert.throws(
    () => roundedPolygonArea([
      { x: 0, z: 0, radius: 0 },
      { x: 1.6, z: 0 },
      { x: 1.6, z: 1 },
      { x: 0, z: 1 },
    ]),
    /半径必须为正/,
  );
});

test('顺时针轮廓与逆时针等面积：凸圆角修正须随绕向变号（Codex blocking，PR #255 复审第 3 轮）', () => {
  // 2×2 矩形一角 R1：CCW 得 4 − (1 − π/4) = 3.785398…；旧式把修正直接加在
  // 带符号面积上，CW 得 4.214602（凸角越加越大），镜像校验会把正确的 CW 圆角
  // 房判成漂移。layout-resolver 先归一化为 CCW 故生产房间面积不受影响，但
  // budget 的 floor_region 与镜像校验直接传原始绕向。
  const ccw = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 2, z: 2, radius: 1, cx: 1, cz: 1 },
    { x: 0, z: 2 },
  ];
  const expected = 4 - (1 - Math.PI / 4);
  assert.ok(Math.abs(roundedPolygonArea(ccw) - expected) < 1e-9, `CCW got ${roundedPolygonArea(ccw)}`);
  assert.ok(Math.abs(roundedPolygonArea([...ccw].reverse()) - expected) < 1e-9, `CW got ${roundedPolygonArea([...ccw].reverse())}`);
});

test('顺时针轮廓与逆时针等面积：凹圆角与尖角', () => {
  const concave = [
    { x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 1, z: 2 },
    { x: 1, z: 1, radius: 0.5, cx: 0.5, cz: 1.5 },
    { x: 0, z: 1 },
  ];
  const expectedConcave = 3 + (0.125 - 0.25 * (Math.PI / 2 - 1) / 2);
  assert.ok(Math.abs(roundedPolygonArea([...concave].reverse()) - expectedConcave) < 1e-9);
  const sharp = [
    { x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 },
  ];
  assert.ok(Math.abs(roundedPolygonArea([...sharp].reverse()) - 12) < 1e-9);
});
