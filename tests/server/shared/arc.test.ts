import assert from 'node:assert/strict';
import test from 'node:test';
import { tangentArc, type ArcPoint, type TangentArc } from '../../../shared/arc.js';

/**
 * 切线弧描述符（shared/arc.ts，issue #98 第三阶段 S2 建立）——全仓唯一的「切点 + 弧心」
 * 解算器，取代三份同公式副本：server/layout-resolver.ts 的 tangentPoints（墙圆角）、
 * shared/arc-polyline.ts 的 arcDescriptor（折线圆角点）、server/budget-calculator.ts 的
 * tangentPointOnEdge（floor_region 声明弧心）。采样器（16 段墙弧 / centerlineSamples /
 * CeilingZoneBuilder 四角 / BaySillGeometry）不合一，但切点与弧心都必须走这里。
 *
 * 两层断言：
 *   ① 解算值：切点距角点 r/tan(θ/2)、弧心距角点 r/sin(θ/2)（内角平分线）；声明式弧心
 *      （center）走垂足形态，越界/不自洽即 null（fail-closed，不回落切线公式）。
 *   ② 属性：budget 的圆弓闭式 r²(θ−sinθ)/2 与 ceiling 的 CORNER_AREA_K = 1−π/4 都等于
 *      「descriptor 采样」的面积——原 ceiling-takeoff.test.ts 的「闭式 vs 渲染采样」
 *      断言在此提升为与具体分区无关的通用属性（闭式保留，采样改用 descriptor 弧参数）。
 */

const close = (actual: number, expected: number, message: string, tolerance = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}（容差 ${tolerance}）`);
};

/** 按 descriptor 的弧参数采样（与 shared/arc-polyline.ts centerlineSamples 同一参数化）。 */
function sampleArc(arc: TangentArc, steps: number): ArcPoint[] {
  const samples: ArcPoint[] = [];
  for (let step = 1; step < steps; step++) {
    const angle = arc.startAngle + (arc.delta * step) / steps;
    samples.push({ x: arc.center.x + Math.cos(angle) * arc.radius, z: arc.center.z + Math.sin(angle) * arc.radius });
  }
  return samples;
}

/** shoelace 面积（闭合多边形）。 */
function polygonArea(points: ArcPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

test('切线公式：90° 角的切点/弧心/扫角', () => {
  const arc = tangentArc({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }, 1);
  assert.ok(arc, '直角应解得出');
  close(arc.start.x, 0, 'start.x'); close(arc.start.z, -1, 'start.z');
  close(arc.end.x, 1, 'end.x'); close(arc.end.z, 0, 'end.z');
  close(arc.center.x, 1, 'center.x'); close(arc.center.z, -1, 'center.z');
  close(Math.hypot(arc.start.x, arc.start.z), 1 / Math.tan(Math.PI / 4), '切点距角点 = r/tan(θ/2)');
  close(Math.hypot(arc.center.x, arc.center.z), 1 / Math.sin(Math.PI / 4), '弧心距角点 = r/sin(θ/2)');
  close(Math.hypot(arc.start.x - arc.center.x, arc.start.z - arc.center.z), 1, '切点在圆上');
  close(Math.abs(arc.delta), Math.PI / 2, '扫角 = 夹角');
});

test('切线公式：120° 钝角同样成立（公式不依赖正交）', () => {
  const theta = (120 * Math.PI) / 180;
  const r = 0.5;
  const arc = tangentArc({ x: 0, z: 0 }, { x: -2, z: 0 }, { x: 10 * Math.cos(Math.PI - theta), z: 10 * Math.sin(Math.PI - theta) }, r);
  assert.ok(arc, '120° 应解得出');
  const tangent = r / Math.tan(theta / 2);
  const centerDist = r / Math.sin(theta / 2);
  close(Math.hypot(arc.start.x, arc.start.z), tangent, '切点距角点');
  close(Math.hypot(arc.center.x, arc.center.z), centerDist, '弧心距角点');
  close(arc.start.x, -tangent, 'start.x'); close(arc.start.z, 0, 'start.z');
  close(arc.center.x, centerDist * Math.cos(Math.PI - theta / 2), 'center.x（内角平分线）');
  close(arc.center.z, centerDist * Math.sin(Math.PI - theta / 2), 'center.z（内角平分线）');
  close(Math.hypot(arc.end.x - arc.center.x, arc.end.z - arc.center.z), r, 'end 切点在圆上');
});

test('声明式弧心：邻点在圆上直取，否则取垂足', () => {
  // 邻点本身在圆上 → 直接采用（resolver 产出的弧端点即此路径）
  const direct = tangentArc({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }, 1, { x: 1, z: -1 });
  assert.ok(direct);
  close(direct.start.x, 0, 'direct start.x'); close(direct.start.z, -1, 'direct start.z');
  close(direct.end.x, 1, 'direct end.x'); close(direct.end.z, 0, 'direct end.z');
  close(direct.center.x, 1, 'direct center.x'); close(direct.center.z, -1, 'direct center.z');
  // 邻点不在圆上 → 取弧心在邻边上的垂足（floor_region 的声明弧心即此路径）
  const projected = tangentArc({ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 2, z: 0 }, 1, { x: 1, z: -1 });
  assert.ok(projected);
  close(projected.start.x, 0, 'projected start.x'); close(projected.start.z, -1, 'projected start.z');
  close(projected.end.x, 1, 'projected end.x'); close(projected.end.z, 0, 'projected end.z');
});

test('fail-closed：解不出一律 null，不猜不兜底', () => {
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }, 0), null, '半径非正');
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 }, 1), null, '夹角退化（共线）');
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -0.5 }, { x: 1, z: 0 }, 1), null, '切点超出邻边线段');
  // 声明弧心的垂足落在邻边延长线上（t=1.5 > 边长 2）→ null（原 budget tangentPointOnEdge 在此抛错）
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 2, z: 0 }, 1, { x: 1, z: -3 }), null, '垂足越出邻边线段');
  // 声明弧心与半径不自洽（垂足到弧心 1.5 ≠ radius 1）→ null（原 budget 在此抛错）
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 2, z: 0 }, 1, { x: 1.5, z: -1 }), null, '半径与弧心不自洽');
  // 声明形态解不出时**不回落到切线公式**：回落会拿不一致的声明弧心配切线切点，
  // 产出端点不在自己圆上的弧（预算侧原实现直接抛错，不许抹成静默）。
  assert.equal(tangentArc({ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 2, z: 0 }, 1, { x: 9, z: -9 }), null, '声明形态失败不回落');
});

test('属性：闭式 vs descriptor 采样（budget 圆弓 r²(θ−sinθ)/2 与 ceiling K = 1−π/4 同一来源）', () => {
  const radii = [0.05, 0.1, 0.15, 0.3, 1.0];
  const degrees = [30, 45, 60, 90, 120, 150];
  for (const r of radii) {
    for (const deg of degrees) {
      const theta = (deg * Math.PI) / 180;
      // 角点在原点、入边朝西；出边与入边夹角 θ（uNext 极角 = π − θ）。
      const corner = { x: 0, z: 0 };
      const prev = { x: -10, z: 0 };
      const next = { x: 10 * Math.cos(Math.PI - theta), z: 10 * Math.sin(Math.PI - theta) };
      const arc = tangentArc(corner, prev, next, r);
      assert.ok(arc, `r=${r} θ=${deg}° 应解得出`);
      const steps = Math.max(128, Math.ceil((Math.abs(arc.delta) * 128) / Math.PI));
      const samples = sampleArc(arc, steps);
      const tolerance = 1e-3 * r * r;

      // ① 扇形（弧心 + 半径到起点 + 采样 + 弧终点）= (δ/2)r²，δ = 弧扫角 = π − 夹角
      const sector = polygonArea([arc.center, arc.start, ...samples, arc.end]);
      close(sector, (Math.abs(arc.delta) / 2) * r * r, `r=${r} θ=${deg}° 扇形 vs (δ/2)r²`, tolerance);

      // ② 圆弓 = 扇形 − 弧心三角形；闭式 = r²(θ−sinθ)/2（server/budget-calculator.ts 的 segment）
      const centerTriangle = polygonArea([arc.center, arc.start, arc.end]);
      const segment = sector - centerTriangle;
      const segmentClosed = (r * r * (Math.abs(arc.delta) - Math.sin(Math.abs(arc.delta)))) / 2;
      close(segment, segmentClosed, `r=${r} θ=${deg}° 圆弓采样 vs 闭式 r²(θ−sinθ)/2`, tolerance);

      // ③ budget 的 cut = 角点三角形 − 圆弓（roundedPolygonArea 同式）
      const cornerTriangle = polygonArea([corner, arc.start, arc.end]);
      close(cornerTriangle - segment, cornerTriangle - segmentClosed, `r=${r} θ=${deg}° cut 采样 vs 闭式`, tolerance);

      // ④ θ=90° 时 cut 恒等于 r²(1−π/4)——shared/ceiling-takeoff.ts 的 CORNER_AREA_K
      //    （凹角加料与凸角切料同形，这就是勘察文档所说两条闭式的「恒等变换」）。
      if (deg === 90) {
        close(cornerTriangle - segmentClosed, r * r * (1 - Math.PI / 4), `r=${r} 90° cut vs CORNER_AREA_K·r²`, 1e-12);
      }
    }
  }
});
