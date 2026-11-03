/**
 * 墙段纯几何：按洞口切分墙段。原实现自 three-scene-geometry.ts 抽出（2026-11-03，
 * DXF 导出需要同一口径但不引入 three.js），three-scene-geometry.ts 改为 re-export，
 * 全仓仍只有这一份实现。
 */

export interface SceneSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface SceneOpening {
  x: number;
  z: number;
  width: number;
  height: number;
}

export function splitSegmentByOpenings(segment: SceneSegment, openings: SceneOpening[]): SceneSegment[] {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return [];
  const ux = dx / length;
  const uz = dz / length;
  const blocked = openings
    .filter((opening) => opening.height > 0 && opening.width > 0)
    .map((opening) => {
      const center = (opening.x - segment.x1) * ux + (opening.z - segment.z1) * uz;
      return [Math.max(0, center - opening.width / 2), Math.min(length, center + opening.width / 2)] as const;
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const result: SceneSegment[] = [];
  let cursor = 0;
  for (const [start, end] of blocked) {
    if (start > cursor) {
      result.push({
        x1: segment.x1 + ux * cursor,
        z1: segment.z1 + uz * cursor,
        x2: segment.x1 + ux * start,
        z2: segment.z1 + uz * start,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) {
    result.push({ x1: segment.x1 + ux * cursor, z1: segment.z1 + uz * cursor, x2: segment.x2, z2: segment.z2 });
  }
  return result;
}

/**
 * 沿折线链（墙的 segments 细分或单段主线）逐段累计取距离处的点——wall_region/paint_region/
 * skirting_region 的 along 语义（3D 侧 SceneBuilder.pointAt 同算法，DXF 导出共用本实现）。
 * 超出总长返回 null。
 */
export function pointAlongPolyline(segments: readonly SceneSegment[], distance: number): { x: number; z: number } | null {
  let remaining = distance;
  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= 1e-9) continue;
    if (remaining <= length + 1e-9) {
      const t = Math.min(1, Math.max(0, remaining / length));
      return { x: segment.x1 + (segment.x2 - segment.x1) * t, z: segment.z1 + (segment.z2 - segment.z1) * t };
    }
    remaining -= length;
  }
  return null;
}

/** 折线链总长（wall_region along 区间合法性校验用，与 SceneBuilder wall_region 分支同口径）。 */
export function polylineLength(segments: readonly SceneSegment[]): number {
  return segments.reduce((sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
}

/**
 * 沿折线链裁剪 [from, to] 区间，保留区间内的全部墙段（转角处逐段输出，不连弦）。
 * 原实现自 render/SceneBuilder.ts 抽出（2026-11-03，DXF 出图共用同一裁剪口径）。
 */
export function clipAlongSpan(
  segments: readonly SceneSegment[],
  from: number,
  to: number,
): Array<{ a: { x: number; z: number }; b: { x: number; z: number } }> {
  const clipped: Array<{ a: { x: number; z: number }; b: { x: number; z: number } }> = [];
  const total = polylineLength(segments);
  let cursor = 0;
  const lo = Math.max(0, from), hi = Math.min(total, to);
  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= 1e-9) continue;
    const s0 = cursor, s1 = cursor + length;
    cursor = s1;
    const a = Math.max(lo, s0), b = Math.min(hi, s1);
    if (b - a <= 1e-9) continue;
    const t0 = (a - s0) / length, t1 = (b - s0) / length;
    clipped.push({
      a: { x: segment.x1 + (segment.x2 - segment.x1) * t0, z: segment.z1 + (segment.z2 - segment.z1) * t0 },
      b: { x: segment.x1 + (segment.x2 - segment.x1) * t1, z: segment.z1 + (segment.z2 - segment.z1) * t1 },
    });
  }
  return clipped;
}
