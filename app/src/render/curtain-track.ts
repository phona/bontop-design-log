import type { CurtainPoint } from '@shared/types';

export interface CurtainTrackPoint {
  x: number;
  z: number;
  distance: number;
}

function arcDescriptor(a: CurtainPoint, c: CurtainPoint, b: CurtainPoint) {
  const radius = c.radius ?? 0;
  if (radius <= 0) return null;
  const v1 = { x: c.x - a.x, z: c.z - a.z };
  const v2 = { x: b.x - c.x, z: b.z - c.z };
  const len1 = Math.hypot(v1.x, v1.z);
  const len2 = Math.hypot(v2.x, v2.z);
  if (len1 < 1e-9 || len2 < 1e-9) return null;
  const u1 = { x: v1.x / len1, z: v1.z / len1 };
  const u2 = { x: v2.x / len2, z: v2.z / len2 };
  const theta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.z * u2.z)));
  if (theta < 0.001 || Math.abs(theta - Math.PI) < 0.001) return null;
  const tangent = radius / Math.tan(theta / 2);
  if (tangent > len1 + 0.001 || tangent > len2 + 0.001) return null;
  const start = { x: c.x - u1.x * tangent, z: c.z - u1.z * tangent };
  const end = { x: c.x + u2.x * tangent, z: c.z + u2.z * tangent };
  const cross = u1.x * u2.z - u1.z * u2.x;
  const normal = { x: -u1.z, z: u1.x };
  const center = c.cx !== undefined && c.cz !== undefined
    ? { x: c.cx, z: c.cz }
    : { x: c.x - u1.x * tangent + Math.sign(cross) * normal.x * radius, z: c.z - u1.z * tangent + Math.sign(cross) * normal.z * radius };
  const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
  let delta = Math.atan2(end.z - center.z, end.x - center.x) - startAngle;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return { center, radius, start, delta };
}

export function sampleCurtainTrack(points: CurtainPoint[], arcSteps = 24): CurtainTrackPoint[] {
  if (points.length < 2) return [];
  const sampled: Array<{ x: number; z: number }> = [{ x: points[0].x, z: points[0].z }];
  for (let i = 1; i < points.length - 1; i++) {
    const arc = arcDescriptor(points[i - 1], points[i], points[i + 1]);
    if (!arc) {
      sampled.push({ x: points[i].x, z: points[i].z });
      continue;
    }
    const last = sampled[sampled.length - 1];
    if (Math.hypot(last.x - arc.start.x, last.z - arc.start.z) > 1e-6) sampled.push(arc.start);
    const steps = Math.max(4, Math.ceil(Math.abs(arc.delta) / (Math.PI / arcSteps)));
    for (let step = 1; step <= steps; step++) {
      const angle = Math.atan2(arc.start.z - arc.center.z, arc.start.x - arc.center.x) + arc.delta * step / steps;
      sampled.push({ x: arc.center.x + Math.cos(angle) * arc.radius, z: arc.center.z + Math.sin(angle) * arc.radius });
    }
  }
  const end = points[points.length - 1];
  const last = sampled[sampled.length - 1];
  if (Math.hypot(last.x - end.x, last.z - end.z) > 1e-6) sampled.push({ x: end.x, z: end.z });

  let distance = 0;
  return sampled.map((point, index) => {
    if (index > 0) distance += Math.hypot(point.x - sampled[index - 1].x, point.z - sampled[index - 1].z);
    return { ...point, distance };
  });
}

function pointAtDistance(track: CurtainTrackPoint[], distance: number): CurtainTrackPoint {
  const total = track.at(-1)?.distance ?? 0;
  const target = Math.max(0, Math.min(total, distance));
  for (let i = 1; i < track.length; i++) {
    if (track[i].distance < target) continue;
    const a = track[i - 1];
    const b = track[i];
    const span = b.distance - a.distance;
    const t = span > 0 ? (target - a.distance) / span : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, distance: target };
  }
  return track.at(-1) ?? { x: 0, z: 0, distance: 0 };
}

export function sliceCurtainTrack(track: CurtainTrackPoint[], start: number, end: number): CurtainPoint[] {
  if (track.length < 2 || end <= start) return [];
  const result: CurtainPoint[] = [pointAtDistance(track, start)];
  for (const point of track) {
    if (point.distance > start && point.distance < end) result.push({ x: point.x, z: point.z });
  }
  result.push(pointAtDistance(track, end));
  return result.map(({ x, z }) => ({ x, z }));
}

export function gatheredCurtainSegments(points: CurtainPoint[], ratio = 0.08): [CurtainPoint[], CurtainPoint[]] {
  const track = sampleCurtainTrack(points);
  const total = track.at(-1)?.distance ?? 0;
  const stackLength = Math.min(0.6, Math.max(0.18, total * ratio));
  return [sliceCurtainTrack(track, 0, stackLength), sliceCurtainTrack(track, Math.max(0, total - stackLength), total)];
}
