import * as THREE from 'three';
import type { CurtainPoint, ResolvedRoom } from '../types.js';

type CurtainRoomCenter = Pick<ResolvedRoom, 'x' | 'z'>;

export function offsetCurtainPointsInterior(points: CurtainPoint[], rooms: CurtainRoomCenter[], offset = 0.12): CurtainPoint[] {
  if (points.length < 2 || rooms.length === 0 || offset === 0) return points;
  const first = points[0]; const last = points[points.length - 1];
  const dx = last.x - first.x; const dz = last.z - first.z; const length = Math.hypot(dx, dz);
  if (length < 1e-9) return points;
  const midpoint = points.reduce((sum, p) => ({ x: sum.x + p.x, z: sum.z + p.z }), { x: 0, z: 0 });
  midpoint.x /= points.length; midpoint.z /= points.length;
  const room = rooms.reduce((best, candidate) => Math.hypot(candidate.x - midpoint.x, candidate.z - midpoint.z) < Math.hypot(best.x - midpoint.x, best.z - midpoint.z) ? candidate : best, rooms[0]);
  const cross = dx * (room.z - midpoint.z) - dz * (room.x - midpoint.x);
  const sign = cross > 0 ? 1 : -1;
  const nx = (-dz / length) * sign * offset; const nz = (dx / length) * sign * offset;
  return points.map((p) => ({ ...p, x: p.x + nx, z: p.z + nz, ...(p.cx !== undefined ? { cx: p.cx + nx } : {}), ...(p.cz !== undefined ? { cz: p.cz + nz } : {}) }));
}

type Point = { x: number; z: number };
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

function centerlineSamples(points: CurtainPoint[], closed: boolean, arcSteps = 32): Point[] {
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

export interface CurtainTrackPoint {
  x: number;
  z: number;
  distance: number;
}

export function sampleCurtainTrack(points: CurtainPoint[], arcSteps = 24): CurtainTrackPoint[] {
  const sampled = centerlineSamples(points, false, arcSteps);
  let distance = 0;
  return sampled.map((point, index) => { if (index > 0) distance += Math.hypot(point.x - sampled[index - 1].x, point.z - sampled[index - 1].z); return { ...point, distance }; });
}

function pointAtDistance(track: CurtainTrackPoint[], distance: number): CurtainPoint {
  const total = track.at(-1)?.distance ?? 0; const target = Math.max(0, Math.min(total, distance));
  for (let i = 1; i < track.length; i++) { if (track[i].distance < target) continue; const a = track[i - 1]; const b = track[i]; const span = b.distance - a.distance; const t = span > 0 ? (target - a.distance) / span : 0; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; }
  const last = track.at(-1); return last ? { x: last.x, z: last.z } : { x: 0, z: 0 };
}

export function sliceCurtainTrack(track: CurtainTrackPoint[], start: number, end: number): CurtainPoint[] {
  if (track.length < 2 || end <= start) return [];
  const total = track.at(-1)?.distance ?? 0;
  const from = pointAtDistance(track, start);
  const to = pointAtDistance(track, end);
  return [from, ...track.filter((point) => point.distance > start && point.distance < end).map(({ x, z }) => ({ x, z })), to];
}

export function gatheredCurtainSegments(points: CurtainPoint[], ratio = 0.08): [CurtainPoint[], CurtainPoint[]] {
  const track = sampleCurtainTrack(points); const total = track.at(-1)?.distance ?? 0; const stack = Math.min(0.6, Math.max(0.18, total * ratio));
  const slice = (start: number, end: number): CurtainPoint[] => { if (track.length < 2 || end <= start) return []; const result: CurtainPoint[] = [pointAtDistance(track, start)]; for (const point of track) if (point.distance > start && point.distance < end) result.push({ x: point.x, z: point.z }); result.push(pointAtDistance(track, end)); return result; };
  return [slice(0, stack), slice(Math.max(0, total - stack), total)];
}

function intersectLines(a: Point, ad: Point, b: Point, bd: Point): Point | null {
  const denominator = ad.x * bd.z - ad.z * bd.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b.x - a.x) * bd.z - (b.z - a.z) * bd.x) / denominator;
  return { x: a.x + ad.x * t, z: a.z + ad.z * t };
}

function offsetPolyline(line: Point[], distance: number): Point[] {
  const offsets: Array<{ point: Point; direction: Point }> = [];
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1].x - line[i].x; const dz = line[i + 1].z - line[i].z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) continue;
    const direction = { x: dx / length, z: dz / length };
    offsets.push({ point: { x: line[i].x - direction.z * distance, z: line[i].z + direction.x * distance }, direction });
  }
  if (offsets.length === 0) return line.map((point) => ({ ...point }));
  const result: Point[] = [offsets[0].point];
  for (let i = 1; i < line.length - 1; i++) {
    const before = offsets[Math.min(i - 1, offsets.length - 1)];
    const after = offsets[Math.min(i, offsets.length - 1)];
    const join = intersectLines(before.point, before.direction, after.point, after.direction);
    const maxMiter = Math.abs(distance) * 4;
    result.push(join && Math.hypot(join.x - line[i].x, join.z - line[i].z) <= maxMiter
      ? join
      : { x: line[i].x - after.direction.z * distance, z: line[i].z + after.direction.x * distance });
  }
  const last = offsets[offsets.length - 1];
  result.push({ x: line.at(-1)!.x - last.direction.z * distance, z: line.at(-1)!.z + last.direction.x * distance });
  return result;
}

function ribbon(points: Point[], thickness: number, sided: boolean, flip: boolean, closed: boolean): THREE.Shape {
  if (points.length < 2) return new THREE.Shape();
  const line = closed ? points.slice(0, -1) : points;
  const leftOffset = sided ? (flip ? 0 : thickness) : thickness / 2;
  const rightOffset = sided ? (flip ? thickness : 0) : thickness / 2;
  const left = offsetPolyline(line, leftOffset);
  const right = offsetPolyline(line, -rightOffset);
  const area = (ps: Point[]) => ps.reduce((sum, p, i) => { const q = ps[(i + 1) % ps.length]; return sum + p.x * q.z - q.x * p.z; }, 0);
  const shape = new THREE.Shape();
  if (closed) {
    const outer = Math.abs(area(left)) >= Math.abs(area(right)) ? left : right;
    const inner = outer === left ? right : left;
    shape.moveTo(outer[0].x, outer[0].z); outer.slice(1).forEach((p) => shape.lineTo(p.x, p.z)); shape.closePath();
    const hole = new THREE.Path(); hole.moveTo(inner[inner.length - 1].x, inner[inner.length - 1].z); inner.slice(0, -1).reverse().forEach((p) => hole.lineTo(p.x, p.z)); hole.closePath(); shape.holes.push(hole);
  } else {
    shape.moveTo(left[0].x, left[0].z); left.slice(1).forEach((p) => shape.lineTo(p.x, p.z));
    right.slice().reverse().forEach((p) => shape.lineTo(p.x, p.z)); shape.closePath();
  }
  return shape;
}

export function curtainShape(points: CurtainPoint[], thickness: number, sided = true, flip = false): THREE.Shape {
  return ribbon(centerlineSamples(points, false), thickness, sided, flip, false);
}

export function curtainRibbonShape(points: CurtainPoint[], closed = false, thickness = 0.024): THREE.Shape {
  return ribbon(centerlineSamples(points, closed), thickness, false, false, closed);
}

export function roundedShape(points: Array<Point & { radius?: number; cx?: number; cz?: number }>): THREE.Shape {
  const sampled = centerlineSamples(points, true);
  const shape = new THREE.Shape();
  if (sampled.length < 2) return shape;
  shape.moveTo(sampled[0].x, -sampled[0].z);
  sampled.slice(1).forEach((point) => shape.lineTo(point.x, -point.z));
  shape.closePath();
  return shape;
}
