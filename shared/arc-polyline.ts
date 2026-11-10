/**
 * 弧感知折线几何（纯函数，无 THREE）。原实现自 render/CurtainGeometry.ts 抽出（2026-11-03，
 * DXF 出图需要同一弧口径但不引入 three.js），CurtainGeometry 改为 re-export，全仓仍只有这一份实现。
 *
 * 切点/弧心解算不在本文件：2026-11-07（issue #98 第三阶段 S2）已统一到 `shared/arc.ts` 的
 * `tangentArc(corner, prev, next, radius, center?)`，本文件只保留「折线圆角点 → 密采样段」
 * 这一种输出形态（采样器不强制合一，但切点与弧心必须走 descriptor）。
 */

import type { CurtainPoint } from './types.js';
import { tangentArc, type ArcPoint } from './arc.js';

export type Point = ArcPoint;

/** 圆角点的声明式弧心（radius/cx/cz 同时齐备才认；缺一个即按纯切线公式解）。 */
function authoritativeCenter(corner: CurtainPoint): ArcPoint | undefined {
  return corner.cx !== undefined && corner.cz !== undefined ? { x: corner.cx, z: corner.cz } : undefined;
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
    const arc = !endpoint ? tangentArc(curr, previous, next, curr.radius ?? 0, authoritativeCenter(curr)) : null;
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

