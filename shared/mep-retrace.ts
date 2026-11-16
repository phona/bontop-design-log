/**
 * 同路由折返（retrace）检测——量价算法审计（MEP D2 的后续）。
 *
 * 背景：PR #248 的全仓重合段扫描只比「整段相等」，漏掉了**部分重叠的折返**：
 * 一条路由走到某点又沿同一条线折回来一截（短段完全含在相邻长段里）。
 * Lint 的 pairwise 循环只比**不同**路由，所以同路由折返没有任何检查在看。
 * 实测 4 处（2026-11-16）：strong-light-dining +0.30m、strong-power-garden
 * +0.30m、strong-light-entry-night-corridor +0.15m、weak-master +0.05m
 * （定价侧多计 conduit，routeLength 多计两倍）。
 *
 * 本模块是纯函数检测器，不接任何 verify/lint 输出（加 finding 会改动
 * verify:mep 的 88/226 基线，也不在本次审计的修复范围内——路由几何本身
 * 的修正另走跟进 PR，届时 `fold scan == 0` 的不变量才能落地）。
 * 折返的定义：两段（可相邻——D2 的 4 处全是相邻段在折点处折返）共线、
 * 区间重叠长度 > EPS。相邻段正常转弯只交于一点（重叠 0），直行续接
 * 同样只交于一点，都不报；零长段（25 处 benign 端点重复）跳过。
 */

export interface MepPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface RouteRetrace {
  /** 第一段的下标（points[segmentA] → points[segmentA + 1]）。 */
  segmentA: number;
  /** 第二段的下标。 */
  segmentB: number;
  /** 两段在同一条线上的重叠长度（m）。 */
  overlapM: number;
  /** 两段的走向：'opposite' 为折返（出后折回），'same' 为同向重走。 */
  direction: 'opposite' | 'same';
}

const EPS = 1e-9;

function sub(a: MepPoint3D, b: MepPoint3D): MepPoint3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: MepPoint3D, b: MepPoint3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: MepPoint3D, b: MepPoint3D): MepPoint3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(a: MepPoint3D): number {
  return Math.hypot(a.x, a.y, a.z);
}

/**
 * 一条已解算路由（points 为 3D 折线点列）的全部折返。
 * 只认共线 + 正长度重叠；平行但不同线、只交于一点的转弯、零长段都不报。
 */
export function findRouteRetraces(points: MepPoint3D[]): RouteRetrace[] {
  const retraces: RouteRetrace[] = [];
  const n = points.length - 1;
  for (let i = 0; i < n; i += 1) {
    const d1 = sub(points[i + 1], points[i]);
    const len1 = norm(d1);
    if (len1 <= EPS) continue;
    for (let j = i + 1; j < n; j += 1) {
      const d2 = sub(points[j + 1], points[j]);
      const len2 = norm(d2);
      if (len2 <= EPS) continue;
      // 平行：方向叉积 ~0
      if (norm(cross(d1, d2)) > EPS * len1 * len2) continue;
      // 共线：第二段起点落在第一段直线上
      if (norm(cross(sub(points[j], points[i]), d1)) > EPS * len1) continue;
      // 把第二段投影到第一段的参数轴上，求区间重叠
      const t0 = dot(sub(points[j], points[i]), d1) / (len1 * len1);
      const t1 = dot(sub(points[j + 1], points[i]), d1) / (len1 * len1);
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(1, Math.max(t0, t1));
      const overlapM = (hi - lo) * len1;
      if (overlapM <= EPS) continue;
      retraces.push({
        segmentA: i,
        segmentB: j,
        overlapM,
        direction: dot(d1, d2) < 0 ? 'opposite' : 'same',
      });
    }
  }
  return retraces;
}
