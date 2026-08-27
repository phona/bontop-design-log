import type { BaySillSegment, BaySillWallReference, ResolvedRoom } from '../types.js';

export interface BaySillPoint { x: number; z: number }
export interface BaySillGeometry { outline: BaySillPoint[]; segments: BaySillSegment[] }

type Segment = BaySillSegment & { wall: BaySillPoint; inner: BaySillPoint };

function cross(a: BaySillPoint, b: BaySillPoint, c: BaySillPoint): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function lineIntersection(a: BaySillPoint, b: BaySillPoint, c: BaySillPoint, d: BaySillPoint): BaySillPoint | null {
  const abx = b.x - a.x; const abz = b.z - a.z;
  const cdx = d.x - c.x; const cdz = d.z - c.z;
  const denominator = abx * cdz - abz * cdx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * cdz - (c.z - a.z) * cdx) / denominator;
  return { x: a.x + t * abx, z: a.z + t * abz };
}

function rectanglePoints(room: ResolvedRoom): BaySillPoint[] {
  const halfW = room.width / 2; const halfD = room.depth / 2;
  return [{ x: room.x - halfW, z: room.z - halfD }, { x: room.x + halfW, z: room.z - halfD }, { x: room.x + halfW, z: room.z + halfD }, { x: room.x - halfW, z: room.z + halfD }];
}

function roomContains(room: ResolvedRoom, point: BaySillPoint): boolean {
  const polygon = room.points?.map(({ x, z }) => ({ x, z })) ?? rectanglePoints(room);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function sideForSegment(segment: BaySillSegment, rooms: ResolvedRoom[]): 1 | -1 {
  const dx = segment.x2 - segment.x1; const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) throw new Error(`bay_sill wall ${segment.wallId} contains a zero-length segment`);
  const left = { x: -dz / length, z: dx / length };
  const midpoint = { x: (segment.x1 + segment.x2) / 2, z: (segment.z1 + segment.z2) / 2 };
  const epsilon = Math.min(0.05, Math.max(0.005, length * 0.02));
  const leftPoint = { x: midpoint.x + left.x * epsilon, z: midpoint.z + left.z * epsilon };
  const rightPoint = { x: midpoint.x - left.x * epsilon, z: midpoint.z - left.z * epsilon };
  const topologyRooms = segment.rooms?.length ? rooms.filter((room) => segment.rooms!.includes(room.id)) : rooms;
  if (topologyRooms.length === 0) throw new Error(`bay_sill wall ${segment.wallId} has no declared room topology`);
  if (topologyRooms.length === 1) {
    const centerSide = cross({ x: segment.x1, z: segment.z1 }, { x: segment.x2, z: segment.z2 }, { x: topologyRooms[0].x, z: topologyRooms[0].z });
    if (Math.abs(centerSide) > 1e-9) return centerSide > 0 ? 1 : -1;
  }
  const roomOnLeft = topologyRooms.some((room) => roomContains(room, leftPoint));
  const roomOnRight = topologyRooms.some((room) => roomContains(room, rightPoint));
  if (roomOnLeft && !roomOnRight) return 1;
  if (roomOnRight && !roomOnLeft) return -1;
  const room = topologyRooms[0];
  const centerSide = cross({ x: segment.x1, z: segment.z1 }, { x: segment.x2, z: segment.z2 }, { x: room.x, z: room.z });
  if (Math.abs(centerSide) < 1e-9) throw new Error(`bay_sill wall ${segment.wallId} has ambiguous declared room side`);
  return centerSide > 0 ? 1 : -1;
}

const CONTINUITY_EPSILON = 1e-6;

function offsetPoint(segment: BaySillSegment, side: 1 | -1, distance: number, atEnd = false): BaySillPoint {
  const point = atEnd ? { x: segment.x2, z: segment.z2 } : { x: segment.x1, z: segment.z1 };
  if (segment.kind === 'arc' && segment.cx !== undefined && segment.cz !== undefined && segment.radius !== undefined) {
    const dx = point.x - segment.cx; const dz = point.z - segment.cz;
    const length = Math.hypot(dx, dz);
    if (length < CONTINUITY_EPSILON) throw new Error(`bay_sill wall ${segment.wallId} arc has invalid center`);
    // Arc references describe the rounded recess centerline. Offset its
    // radius directly; do not miter the sampled chords as independent lines.
    // side 是直线约定的"行进方向左侧为正"：对逆时针弧（delta>0）左侧=朝向圆心，
    // 对顺时针弧（delta<0）左侧=远离圆心，因此径向偏移必须乘上 -sign(delta)，
    // 否则逆时针弧会把飘窗压进房间（如 master_bath_west_bay 的西北角弧）。
    const r1x = segment.x1 - segment.cx; const r1z = segment.z1 - segment.cz;
    const r2x = segment.x2 - segment.cx; const r2z = segment.z2 - segment.cz;
    const deltaSign = Math.sign(r1x * r2z - r1z * r2x) || 1;
    const radial = (segment.radius >= 0 ? 1 : -1) * -deltaSign;
    return { x: point.x + (dx / length) * distance * side * radial, z: point.z + (dz / length) * distance * side * radial };
  }
  const dx = segment.x2 - segment.x1; const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length < CONTINUITY_EPSILON) throw new Error(`bay_sill wall ${segment.wallId} contains a zero-length segment`);
  const nx = (-dz / length) * side; const nz = (dx / length) * side;
  return { x: point.x + nx * distance, z: point.z + nz * distance };
}

function offsetLine(segment: BaySillSegment, side: 1 | -1, distance: number): [BaySillPoint, BaySillPoint] {
  return [offsetPoint(segment, side, distance), offsetPoint(segment, side, distance, true)];
}

function normalizeArcRuns(segments: BaySillSegment[]): BaySillSegment[] {
  const normalized: BaySillSegment[] = [];
  for (let start = 0; start < segments.length;) {
    const first = segments[start];
    if (first.kind !== 'arc' || first.cx === undefined || first.cz === undefined || first.radius === undefined) {
      normalized.push(first);
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < segments.length && segments[end].kind === 'arc' && segments[end].cx === first.cx && segments[end].cz === first.cz && segments[end].radius === first.radius) end += 1;
    const last = segments[end - 1];
    const startAngle = Math.atan2(first.z1 - first.cz, first.x1 - first.cx);
    const endAngle = Math.atan2(last.z2 - first.cz, last.x2 - first.cx);
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    for (let i = start; i < end; i += 1) {
      const source = segments[i];
      const a1 = startAngle + delta * (i - start) / (end - start);
      const a2 = startAngle + delta * (i - start + 1) / (end - start);
      normalized.push({ ...source, x1: first.cx + Math.cos(a1) * Math.abs(first.radius), z1: first.cz + Math.sin(a1) * Math.abs(first.radius), x2: first.cx + Math.cos(a2) * Math.abs(first.radius), z2: first.cz + Math.sin(a2) * Math.abs(first.radius) });
    }
    start = end;
  }
  return normalized;
}

function orderedSegments(refs: BaySillWallReference[]): BaySillSegment[] {
  const segments = normalizeArcRuns(refs.flatMap((ref) => ref.segments.map((segment) => ({ ...segment, rooms: segment.rooms ?? ref.rooms }))));
  if (segments.length < 1) throw new Error('bay_sill requires at least one non-degenerate wall segment');
  const ordered: BaySillSegment[] = [];
  for (const original of segments) {
    if (Math.hypot(original.x2 - original.x1, original.z2 - original.z1) <= CONTINUITY_EPSILON) {
      throw new Error(`bay_sill wall ${original.wallId} contains a zero-length segment`);
    }
    if (ordered.length === 0) {
      ordered.push(original);
      continue;
    }
    const previous = ordered[ordered.length - 1];
    const forwardGap = Math.hypot(original.x1 - previous.x2, original.z1 - previous.z2);
    const reverseGap = Math.hypot(original.x2 - previous.x2, original.z2 - previous.z2);
    if (forwardGap <= CONTINUITY_EPSILON) ordered.push(original);
    else if (reverseGap <= CONTINUITY_EPSILON) ordered.push({ ...original, x1: original.x2, z1: original.z2, x2: original.x1, z2: original.z1, arcStart: original.arcEnd, arcEnd: original.arcStart });
    else throw new Error(`bay_sill wall path has a gap between ${previous.wallId} and ${original.wallId}`);
  }
  return ordered;
}

export function buildBaySillGeometry(refs: BaySillWallReference[], rooms: ResolvedRoom[], depth: number): BaySillGeometry {
  if (!(depth > 0) || !Number.isFinite(depth)) throw new Error('bay_sill depth must be positive and finite');
  const source = orderedSegments(refs);
  // 上飘窗收敛到户型内部：窗台/窗带位于幕墙内侧，从墙线向所属房间一侧延伸 depth，
  // 绝不凸出建筑外轮廓（依据 survey/neighbor_ys01 原始结构图与 DEC-035；
  // "x<1.1 为飘窗不可站"等室内设计决策也以室内条带语义为准）。
  const prepared: Segment[] = source.map((segment) => {
    const inwardSide = sideForSegment(segment, rooms);
    return { ...segment, wall: offsetPoint(segment, inwardSide, 0), inner: offsetPoint(segment, inwardSide, depth) };
  });
  const outerLeft: BaySillPoint[] = [];
  const outerRight: BaySillPoint[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const current = prepared[i];
    const side = sideForSegment(current, rooms);
    const inwardSide = side;
    const line = offsetLine(current, inwardSide, depth);
    if (i === 0) outerLeft.push(line[0]);
    if (i > 0) {
      const previous = prepared[i - 1];
      const previousSide = sideForSegment(previous, rooms);
      const previousInwardSide = previousSide;
      const previousLine = offsetLine(previous, previousInwardSide, depth);
      const previousEnd = previousLine[1];
      // A sampled arc is already a continuous radial-offset path. Joining
      // its chords with infinite-line miter intersections creates spikes;
      // use the shared offset endpoint for every arc/line transition.
      if (previous.kind === 'arc' || current.kind === 'arc') {
        if (Math.hypot(previousEnd.x - line[0].x, previousEnd.z - line[0].z) > CONTINUITY_EPSILON) outerLeft.push(line[0]);
      } else {
        const join = lineIntersection(previousLine[0], previousLine[1], line[0], line[1]);
        const joinDistance = join ? Math.hypot(join.x - previousEnd.x, join.z - previousEnd.z) : Infinity;
        if (join && joinDistance <= depth * 2) outerLeft.push(join);
        else if (Math.hypot(previousEnd.x - line[0].x, previousEnd.z - line[0].z) > CONTINUITY_EPSILON) throw new Error(`bay_sill offset path has an unjoinable corner at ${current.wallId}`);
      }
    }
    if (Math.hypot(outerLeft.at(-1)!.x - line[1].x, outerLeft.at(-1)!.z - line[1].z) > CONTINUITY_EPSILON) outerLeft.push(line[1]);
    const innerLine = offsetLine(current, side, 0);
    if (i === 0) outerRight.push(innerLine[0]);
    if (Math.hypot(outerRight.at(-1)!.x - innerLine[1].x, outerRight.at(-1)!.z - innerLine[1].z) > CONTINUITY_EPSILON) outerRight.push(innerLine[1]);
  }
  const outline = [...outerLeft, ...outerRight.reverse()];
  if (outline.length < 4 || Math.abs(outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]; return sum + p.x * q.z - q.x * p.z; }, 0)) < 1e-9) throw new Error('bay_sill produced a degenerate footprint');
  return { outline, segments: source };
}

export function baySillBbox(geometry: BaySillGeometry): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return { minX: Math.min(...geometry.outline.map((point) => point.x)), maxX: Math.max(...geometry.outline.map((point) => point.x)), minZ: Math.min(...geometry.outline.map((point) => point.z)), maxZ: Math.max(...geometry.outline.map((point) => point.z)) };
}

export function isPointOnRoomSide(point: BaySillPoint, room: ResolvedRoom): boolean {
  return roomContains(room, point);
}

export function segmentCross(a: BaySillPoint, b: BaySillPoint, c: BaySillPoint): number {
  return cross(a, b, c);
}
