/**
 * 弧感知折线几何（纯函数，无 THREE）。原实现自 render/CurtainGeometry.ts 抽出（2026-11-03，
 * DXF 出图需要同一弧口径但不引入 three.js），CurtainGeometry 改为 re-export，全仓仍只有这一份实现。
 */

import type { CurtainPoint } from './types.js';

export type Point = { x: number; z: number };
type Arc = { center: Point; radius: number; start: Point; end: Point; startAngle: number; delta: number };

function arcDescriptor(a: CurtainPoint, c: CurtainPoint, b: CurtainPoint): Arc | null {
  const radius = c.radius ?? 0;
  if (radius <= 0) return null;

  // Resolved wall references carry the actual arc endpoints in `a`/`b` and
  // the authoritative center on the rounded point. Do not treat `c` as a
  // corner again: doing so computes a second set of tangent points and can
  // collapse the intended arc or create a long cross-boundary arc.
  const authoritativeCenter = c.cx !== undefined && c.cz !== undefined
    ? { x: c.cx, z: c.cz }
    : undefined;
  if (authoritativeCenter) {
    const project = (edge: Point): Point | null => {
      const dx = edge.x - c.x; const dz = edge.z - c.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-9) return null;
      const t = ((authoritativeCenter.x - c.x) * dx + (authoritativeCenter.z - c.z) * dz) / lengthSquared;
      return { x: c.x + t * dx, z: c.z + t * dz };
    };
    const directStart = { x: a.x, z: a.z };
    const directEnd = { x: b.x, z: b.z };
    const start = Math.abs(Math.hypot(directStart.x - authoritativeCenter.x, directStart.z - authoritativeCenter.z) - radius) <= 0.01
      ? directStart : project(a);
    const end = Math.abs(Math.hypot(directEnd.x - authoritativeCenter.x, directEnd.z - authoritativeCenter.z) - radius) <= 0.01
      ? directEnd : project(b);
    if (start && end
      && Math.abs(Math.hypot(start.x - authoritativeCenter.x, start.z - authoritativeCenter.z) - radius) <= 0.01
      && Math.abs(Math.hypot(end.x - authoritativeCenter.x, end.z - authoritativeCenter.z) - radius) <= 0.01) {
      const startAngle = Math.atan2(start.z - authoritativeCenter.z, start.x - authoritativeCenter.x);
      let delta = Math.atan2(end.z - authoritativeCenter.z, end.x - authoritativeCenter.x) - startAngle;
      while (delta <= -Math.PI) delta += Math.PI * 2;
      while (delta > Math.PI) delta -= Math.PI * 2;
      return Math.abs(delta) > 0.001 ? { center: authoritativeCenter, radius, start, end, startAngle, delta } : null;
    }
  }
  const toPrev = { x: a.x - c.x, z: a.z - c.z };
  const toNext = { x: b.x - c.x, z: b.z - c.z };
  const len1 = Math.hypot(toPrev.x, toPrev.z); const len2 = Math.hypot(toNext.x, toNext.z);
  if (len1 < 1e-9 || len2 < 1e-9) return null;
  const uPrev = { x: toPrev.x / len1, z: toPrev.z / len1 }; const uNext = { x: toNext.x / len2, z: toNext.z / len2 };
  const theta = Math.acos(Math.max(-1, Math.min(1, uPrev.x * uNext.x + uPrev.z * uNext.z)));
  if (theta < 0.001 || Math.abs(theta - Math.PI) < 0.001) return null;
  const tangent = radius / Math.tan(theta / 2);
  if (tangent > len1 + 0.001 || tangent > len2 + 0.001) return null;
  const start = { x: c.x + uPrev.x * tangent, z: c.z + uPrev.z * tangent };
  const end = { x: c.x + uNext.x * tangent, z: c.z + uNext.z * tangent };
  const cross = uPrev.x * uNext.z - uPrev.z * uNext.x;
  const normal = { x: -uPrev.z, z: uPrev.x };
  const center = authoritativeCenter ?? { x: start.x + Math.sign(cross) * normal.x * radius, z: start.z + Math.sign(cross) * normal.z * radius };
  const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
  let delta = Math.atan2(end.z - center.z, end.x - center.x) - startAngle;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return { center, radius, start, end, startAngle, delta };
}

/** 弧感知折线采样（圆角点按 radius/cx/cz 展开为密采样段）。导出供 DXF 出图复用同一弧口径。 */
export function centerlineSamples(points: CurtainPoint[], closed: boolean, arcSteps = 32): Point[] {
  if (points.length < 2) return [];
  const samples: Point[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const curr = points[i];
    const endpoint = !closed && (i === 0 || i === points.length - 1);
    const previous = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const arc = !endpoint ? arcDescriptor(previous, curr, next) : null;
    if (!arc) {
      samples.push({ x: curr.x, z: curr.z });
      continue;
    }
    const before = samples.at(-1);
    if (!before || Math.hypot(before.x - arc.start.x, before.z - arc.start.z) > 1e-6) samples.push(arc.start);
    const steps = Math.max(4, Math.ceil(Math.abs(arc.delta) / (Math.PI / arcSteps)));
    for (let step = 1; step <= steps; step++) {
      const angle = arc.startAngle + arc.delta * step / steps;
      samples.push({ x: arc.center.x + Math.cos(angle) * arc.radius, z: arc.center.z + Math.sin(angle) * arc.radius });
    }
  }
  if (closed && samples.length > 0) samples.push({ ...samples[0] });
  else {
    const end = points[points.length - 1];
    const before = samples.at(-1);
    if (!before || Math.hypot(before.x - end.x, before.z - end.z) > 1e-6) samples.push({ x: end.x, z: end.z });
  }
  return samples;
}

