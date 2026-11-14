/**
 * Issue #98 二阶段 Stage 1 修复轮 Fix 2：多段墙解算一致性。
 *
 * wallSegmentsFromElements（批量解算用墙段表）此前只取主线，而逐件解算（resolveItem /
 * SceneBuilder / DXF / verify）取 segments 首段——3 弧形墙（w_mb_south / w_bath_north /
 * w_vrv_north 各 17 段）上批量与逐件位置分裂。本文件用合成三段墙证明：批量与逐件
 * 永不给出不同位置（正例），超出首段域时两路同报越界（反例），且旧主线口径会把
 * 反例静默放在弦上（对照）。
 *
 * 全部用合成夹具，不读 config；现 4 件墙锚家具均在单段墙上，几何零漂移由等价
 * 校验与全量套件覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlacementIndexes, wallSegmentsFromElements } from '../../shared/placement-indexes.js';
import { resolveFurniturePlacement } from '../../shared/furniture-placement.js';

// 合成三段墙：主线 (0,0)→(4,0)；首段短（0.5m）且偏离主线，余段沿主线方向。
// along=0.45、半宽 0.2 时：主线域 [0.2, 3.8] 放行，首段域 [0.2, ~0.30] 越界——
// 恰是审计报告里的反例形状（w_mb_south 上 along=0.5、半宽 0.5 过主线域、不过首段域）。
const ARC_WALL = {
  id: 'w_arc_test',
  x1: 0, z1: 0, x2: 4, z2: 0,
  segments: [
    { x1: 0, z1: 0, x2: 0.5, z2: 0.05 },
    { x1: 0.5, z1: 0.05, x2: 2.2, z2: 0.12 },
    { x1: 2.2, z1: 0.12, x2: 4, z2: 0 },
  ],
};

function makeItem(along: number) {
  return {
    id: 'test.arc_cab',
    type: 'test_cabinet',
    wall: 'w_arc_test',
    wall_side: 'south' as const,
    along,
    width: 0.4,
    depth: 0.3,
    rotation: 0,
  };
}

test('wallSegmentsFromElements：有 segments 走细分段，无 segments 才取主线', () => {
  const segments = wallSegmentsFromElements([ARC_WALL]);
  assert.deepEqual(segments.get('w_arc_test'), ARC_WALL.segments);
  const mainlineOnly = wallSegmentsFromElements([{ ...ARC_WALL, segments: undefined }]);
  assert.deepEqual(mainlineOnly.get('w_arc_test'), [{ x1: 0, z1: 0, x2: 4, z2: 0 }]);
});

test('正例：批量与逐件在多段墙上给出同一位置，且该位置在弧上而非弦上', () => {
  const item = makeItem(0.25);
  const indexes = buildPlacementIndexes({
    geometry: { walls: [ARC_WALL] },
    furnishings: { test_room: [item] },
  });
  assert.deepEqual(indexes.furnitureDiagnostics, []);
  const host = indexes.mountHosts.get('test.arc_cab');
  assert.ok(host?.x !== undefined && host?.z !== undefined, '批量解算出的宿主必须进 mountHosts 且有位置');
  const single = resolveFurniturePlacement(item, wallSegmentsFromElements([ARC_WALL]));
  assert.ok(single.placement, '逐件解算必须解出位置');
  assert.ok(Math.abs(host.x - single.placement.x) < 1e-9, `批量 x=${host.x} 与逐件 x=${single.placement.x} 不一致`);
  assert.ok(Math.abs(host.z - single.placement.z) < 1e-9, `批量 z=${host.z} 与逐件 z=${single.placement.z} 不一致`);
  // 位置必须在首段几何上：沿首段切线 0.25m，再沿南向法线离完成面 0.06 + 0.15m。
  const s1 = ARC_WALL.segments[0];
  const len = Math.hypot(s1.x2 - s1.x1, s1.z2 - s1.z1);
  const tx = (s1.x2 - s1.x1) / len;
  const tz = (s1.z2 - s1.z1) / len;
  const expected = {
    x: s1.x1 + tx * 0.25 - tz * 0.21,
    z: s1.z1 + tz * 0.25 + tx * 0.21,
  };
  assert.ok(Math.abs(host.x - expected.x) < 1e-9, `宿主 x=${host.x}，首段几何期望 ${expected.x}`);
  assert.ok(Math.abs(host.z - expected.z) < 1e-9, `宿主 z=${host.z}，首段几何期望 ${expected.z}`);
  // 同一 along 在主线（弦）上的位置是 (0.25, 0.21)：弧上位置必须与之可区分。
  assert.ok(
    Math.hypot(host.x - 0.25, host.z - 0.21) > 0.01,
    `弧上位置 (${host.x}, ${host.z}) 与弦上 (0.25, 0.21) 几乎重合，segments 未生效`,
  );
});

test('反例：along 超出首段域时批量与逐件同报越界，且诊断文本一致', () => {
  const item = makeItem(0.45);
  const indexes = buildPlacementIndexes({
    geometry: { walls: [ARC_WALL] },
    furnishings: { test_room: [item] },
  });
  assert.equal(indexes.furnitureDiagnostics.length, 1);
  assert.equal(indexes.furnitureDiagnostics[0].id, 'test.arc_cab');
  assert.match(indexes.furnitureDiagnostics[0].diagnostic, /outside wall span/);
  assert.equal(indexes.mountHosts.has('test.arc_cab'), false, '解不出的件不得进 mountHosts');
  const single = resolveFurniturePlacement(item, wallSegmentsFromElements([ARC_WALL]));
  assert.equal(single.placement, null);
  assert.equal(single.diagnostic, indexes.furnitureDiagnostics[0].diagnostic, '两路诊断文本必须一致');
});

test('对照：同一条目去掉 segments 后旧主线口径会静默放在弦上（反例的反证）', () => {
  const item = makeItem(0.45);
  const mainlineWall = { ...ARC_WALL, segments: undefined };
  const single = resolveFurniturePlacement(item, wallSegmentsFromElements([mainlineWall]));
  assert.ok(single.placement, '主线口径下 along=0.45 在域内，应解出位置');
  assert.ok(Math.abs(single.placement.x - 0.45) < 1e-9, `主线位置 x 应为 0.45，实际 ${single.placement.x}`);
  assert.ok(Math.abs(single.placement.z - 0.21) < 1e-9, `主线位置 z 应为 0.21，实际 ${single.placement.z}`);
});
