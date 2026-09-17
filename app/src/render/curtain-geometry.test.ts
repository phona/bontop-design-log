import { describe, it, expect } from 'vitest';
import { curtainRibbonShape, curtainShape } from '@shared/render/CurtainGeometry';

type Pt = [number, number];

function outline(shape: ReturnType<typeof curtainRibbonShape>): Pt[] {
  const pts = shape.getPoints().map((p) => [+p.x.toFixed(4), +p.y.toFixed(4)] as Pt);
  const last = pts[pts.length - 1];
  if (last && Math.abs(last[0] - pts[0][0]) < 1e-9 && Math.abs(last[1] - pts[0][1]) < 1e-9) pts.pop();
  return pts;
}

/** 严格内部穿越检测（端点相接不算），用于断言轮廓不自相交。 */
function hasCrossing(pts: Pt[]): boolean {
  const n = pts.length;
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const rx = b[0] - a[0]; const rz = b[1] - a[1];
    const sx = d[0] - c[0]; const sz = d[1] - c[1];
    const denom = rx * sz - rz * sx;
    if (Math.abs(denom) < 1e-12) return false;
    const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denom;
    const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denom;
    return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

// 主卫西北角幕墙折返：西墙直线段南下至切点 (0,2.10)，圆弧从同一点折回北绕。
const NW_FOLD_POINTS = [
  { x: 0, z: 0 },
  { x: 0, z: 2.1 },
  { x: 0, z: 1.1, radius: 1, cx: 1, cz: 2.1 },
  { x: 1, z: 1.1 },
  { x: 2.6, z: 1.1 },
  { x: 5.6, z: 1.1 },
];

describe('curtainRibbonShape fold joints', () => {
  it('keeps the fold ribbon simple and preserves both straight edges', () => {
    const pts = outline(curtainRibbonShape(NW_FOLD_POINTS, false));
    expect(pts.length).toBeGreaterThan(20);
    expect(hasCrossing(pts)).toBe(false);
    // 西墙西缘（外侧）保留到折返截面，不被 miter 兜底丢弃
    expect(pts.some(([x, z]) => Math.abs(x + 0.012) < 1e-6 && Math.abs(z - 2.1) < 1e-3)).toBe(true);
    // 两端帽：v_nw (0,0) 与 recess 末端 (5.6,1.1)
    expect(pts.some(([x, z]) => Math.abs(x + 0.012) < 1e-6 && Math.abs(z) < 1e-6)).toBe(true);
    expect(pts.some(([x, z]) => Math.abs(x - 5.6) < 1e-6 && Math.abs(z - 1.112) < 1e-3)).toBe(true);
    expect(pts.some(([x, z]) => Math.abs(x - 5.6) < 1e-6 && Math.abs(z - 1.088) < 1e-3)).toBe(true);
    // 折返外侧重叠环被剪除：东缘在 pinch 点（≈1.884，折返点下方）截断，
    // x≈0.012 处不得存在 z∈(1.9,2.05) 的上穿点（buggy 走链为 (0.012,2.1)→(0.012,0) 全段东缘）
    const eastEdge = pts.filter(([x]) => Math.abs(x - 0.012) < 1e-6);
    expect(eastEdge.length).toBeGreaterThan(0);
    expect(eastEdge.some(([, z]) => z > 1.9 && z < 2.05)).toBe(false);
  });

  it('does not change plain corner output', () => {
    const pts = outline(curtainRibbonShape([{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 2, z: 2 }], false));
    expect(pts.map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)])).toEqual([
      [-0.012, 0], [-0.012, 2.012], [2, 2.012], [2, 1.988], [0.012, 1.988], [0.012, 0],
    ]);
    expect(hasCrossing(pts)).toBe(false);
  });
});

describe('curtainShape fold joints (sided fabric ribbon)', () => {
  it('keeps the out-and-back blinds path simple', () => {
    const pts = outline(curtainShape(NW_FOLD_POINTS, 0.04));
    expect(pts.length).toBeGreaterThan(20);
    expect(hasCrossing(pts)).toBe(false);
  });
});
