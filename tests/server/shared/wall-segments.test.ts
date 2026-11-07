import assert from 'node:assert/strict';
import test from 'node:test';
import { openingsAlongWall, splitSegmentByOpenings } from '../../../shared/wall-segments.js';

/**
 * 开洞投影唯一入口（shared/wall-segments.ts 的 openingsAlongWall，issue #98 第三阶段 S2 收编
 * 三份副本：shared/paint-scope.ts 的 doorGapsOnWall、shared/masonry-takeoff.ts 的
 * masonryOpeningSpans、scripts/verify/finish/verify-finish-scope.ts 的 inline 循环，
 * splitSegmentByOpenings 也改调同一投影内核）。
 *
 * 断言三件事：
 *   ① 投影口径：洞口中心（世界坐标）→ 沿墙区间（折线累计，自 from 端）；
 *   ② fail-closed 洞底标高：门 → 完成面 0，非门洞缺 sill 抛错（不按落地默认，
 *      那是设计文档 §5.6 明令裁决的语义分歧，取涂装侧那条守卫）；
 *   ③ 两个出口同核：openingsAlongWall 的区间与 splitSegmentByOpenings 切出的缺口边界一致。
 */

const close = (actual: number, expected: number, message: string, tolerance = 1e-12): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}（容差 ${tolerance}）`);
};

test('openingsAlongWall：单段墙按中心投影出沿墙区间（门洞底 = 完成面 0）', () => {
  const spans = openingsAlongWall({
    id: 'w_mbath_south',
    x1: 0,
    z1: 2.86,
    x2: 2.6,
    z2: 2.86,
    openings: [{ id: 'd_mbath', type: 'door', x: 1.55, z: 2.86, width: 0.8, height: 2.1 }],
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].id, 'd_mbath');
  assert.equal(spans[0].kind, 'door');
  close(spans[0].from, 1.15, 'from = 洞口中心 − 半宽');
  close(spans[0].to, 1.95, 'to = 洞口中心 + 半宽');
  assert.equal(spans[0].bottom, 0, '门洞底 = 完成面');
  assert.equal(spans[0].top, 2.1, '洞顶 = 洞底 + height');
});

test('openingsAlongWall：沿墙区间按折线累计（投影落到后段时要加上前段长度）', () => {
  const spans = openingsAlongWall({
    id: 'w_polyline',
    x1: 0,
    z1: 0,
    x2: 2,
    z2: 3,
    segments: [
      { x1: 0, z1: 0, x2: 2, z2: 0 },
      { x1: 2, z1: 0, x2: 2, z2: 3 },
    ],
    // 洞口中心 (2.2, 1.5)：在第一段上的投影 t=1.1 越界 → 跳过；第二段垂足 t=0.5
    openings: [{ id: 'w1', type: 'window', x: 2.2, z: 1.5, width: 1, height: 1.2, sill: 0.9 }],
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, 'window');
  close(spans[0].from, 3.0, 'from = 前段长 2 + 本段垂足 1.5 − 半宽 0.5');
  close(spans[0].to, 4.0, 'to = 前段长 2 + 本段垂足 1.5 + 半宽 0.5');
  assert.equal(spans[0].bottom, 0.9, '窗洞底 = 声明 sill');
  close(spans[0].top, 2.1, '窗洞顶 = sill + height');
});

test('openingsAlongWall：投影不落在任一段内的洞口整个跳过（不属于这面墙）', () => {
  const spans = openingsAlongWall({
    id: 'w_skip',
    x1: 0,
    z1: 0,
    x2: 4,
    z2: 0,
    openings: [{ id: 'far', type: 'door', x: 40, z: 0, width: 0.9, height: 2.1 }],
  });
  assert.deepEqual(spans, []);
});

test('openingsAlongWall：fail-closed——门取完成面 0，非门洞缺 sill 抛错', () => {
  const wall = {
    id: 'w_fc',
    x1: 0,
    z1: 0,
    x2: 4,
    z2: 0,
  };
  // 门：物理依据是「门从完成面起算」，0 是唯一被保留的默认
  const door = openingsAlongWall({ ...wall, openings: [{ id: 'd', type: 'door', x: 2, z: 0, width: 0.9, height: 2.1 }] });
  assert.equal(door[0].bottom, 0);
  // 非门洞（窗 / 垭口 cased_opening）：缺 sill 即抛错——按 0 算会把整段墙当落地洞口扣掉
  for (const type of ['window', 'cased_opening']) {
    assert.throws(
      () => openingsAlongWall({ ...wall, openings: [{ id: 'o', type, x: 2, z: 0, width: 1.2, height: 1.5 }] }),
      new RegExp(`洞口 o（type=${type}）缺 sill`),
      `${type} 缺 sill 必须抛错`,
    );
  }
  // 垭口同样映射 kind=window（非 door 即 window）
  const cased = openingsAlongWall({ ...wall, openings: [{ id: 'o', type: 'cased_opening', x: 2, z: 0, width: 1.2, height: 1.5, sill: 0 }] });
  assert.equal(cased[0].kind, 'window');
});

test('openingsAlongWall：openings 缺省按「没有洞」处理（必填由调用侧类型把守）', () => {
  assert.deepEqual(openingsAlongWall({ id: 'w_none', x1: 0, z1: 0, x2: 4, z2: 0 }), []);
});

test('两个出口同核：openingsAlongWall 的区间边界 = splitSegmentByOpenings 切出的缺口', () => {
  const segment = { x1: 0, z1: 0, x2: 10, z2: 0 };
  const openings = [
    { x: 4, z: 0, width: 2, height: 2.1 },
    { x: 8, z: 0, width: 1, height: 2.1 },
  ];
  const spans = openingsAlongWall({
    id: 'w_shared',
    ...segment,
    openings: openings.map((opening, index) => ({ ...opening, id: `o${index}`, type: 'door' })),
  });
  const pieces = splitSegmentByOpenings(segment, openings);
  // 切口边界应逐一对上 spans 的 from/to（两洞 → 三段：[0,3] [5,7.5] [8.5,10]）
  const boundaries = pieces.flatMap((piece) => [piece.x2, piece.x1]).sort((a, b) => a - b);
  assert.deepEqual(boundaries, [0, 3, 5, 7.5, 8.5, 10]);
  assert.ok(Math.abs(spans[0].from - 3) < 1e-12 && Math.abs(spans[0].to - 5) < 1e-12);
  assert.ok(Math.abs(spans[1].from - 7.5) < 1e-12 && Math.abs(spans[1].to - 8.5) < 1e-12);
});
