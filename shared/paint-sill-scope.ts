import type { BaySillGeometry, BaySillPoint } from './render/BaySillGeometry.js';
import type { CeilingZoneSpec } from './render/CeilingZoneBuilder.js';
import type { ResolvedRoom, WallSegment } from './types.js';
import { ceilingFinishY } from './render/CeilingZoneBuilder.js';

export interface PaintSillFaceInput {
  id: string;
  element: string;
  room: string;
  faces: Array<'underside' | 'front' | 'start_end' | 'end_end'>;
  finish: 'ordinary' | 'wet_area';
}

export interface PaintSillSurface {
  id: string;
  kind: 'underside' | 'front' | 'start_end' | 'end_end';
  points: BaySillPoint[];
  bottom: number;
  top: number;
  /**
   * 单张面面积，**内部保留全精度**（不逐段 round3）：弧段折线的每段宽度是无理数量级，
   * 先 round3 再累加会系统性放大误差——真实主卫上飘窗逐段 round3 曾汇总成 4.198㎡，
   * 而独立三角网格复算只有 4.193365㎡。round3 只发生在最终汇总（totalAreaSqm /
   * areaByFinish），那才是给业主看的口径。
   */
  areaSqm: number;
  /** 同 areaSqm：被吊顶遮挡而不计的面积，保留全精度。 */
  occludedAreaSqm: number;
}

export interface PaintSillScopeResult {
  declaration: PaintSillFaceInput;
  surfaces: PaintSillSurface[];
  totalAreaSqm: number;
  areaByFinish: Record<'ordinary' | 'wet_area', number>;
  warnings: string[];
}

const EPS = 1e-8;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export function polygonArea(points: BaySillPoint[]): number {
  if (points.length < 3) return 0;
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0) / 2);
}

function distance(a: BaySillPoint, b: BaySillPoint): number { return Math.hypot(b.x - a.x, b.z - a.z); }

function coveredIntervals(a: BaySillPoint, b: BaySillPoint, zones: CeilingZoneSpec[], room: ResolvedRoom): Array<{ from: number; to: number; y: number }> {
  const breaks = new Set<number>([0, 1]);
  const relevant = zones.filter((zone) => zone.room === room.id && zone.area && zone.thickness && ['aluminum_buckle', 'drop', 'integrated'].includes(zone.type));
  for (const zone of relevant) {
    const [x1, z1, x2, z2] = zone.area!;
    const dx = b.x - a.x; const dz = b.z - a.z;
    if (Math.abs(dx) > EPS) for (const x of [x1, x2]) { const t = (x - a.x) / dx; if (t > EPS && t < 1 - EPS) breaks.add(t); }
    if (Math.abs(dz) > EPS) for (const z of [z1, z2]) { const t = (z - a.z) / dz; if (t > EPS && t < 1 - EPS) breaks.add(t); }
  }
  const sorted = [...breaks].sort((x, y) => x - y);
  const intervals: Array<{ from: number; to: number; y: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i], to = sorted[i + 1], mid = (from + to) / 2;
    const p = { x: a.x + (b.x - a.x) * mid, z: a.z + (b.z - a.z) * mid };
    const y = relevant
      .filter((zone) => { const [x1, z1, x2, z2] = zone.area!; return p.x >= x1 - EPS && p.x <= x2 + EPS && p.z >= z1 - EPS && p.z <= z2 + EPS; })
      .map((zone) => ceilingFinishY(zone, room.height))
      .reduce((lowest, candidate) => Math.min(lowest, candidate), Infinity);
    if (Number.isFinite(y)) intervals.push({ from, to, y });
  }
  return intervals;
}

function wallCoversCap(a: BaySillPoint, b: BaySillPoint, walls: WallSegment[]): boolean {
  const length = distance(a, b);
  if (length <= EPS) return true;
  const dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
  let covered = 0;
  for (const wall of walls) {
    const segments = wall.segments?.length ? wall.segments : [wall];
    for (const segment of segments) {
      const sx = segment.x2 - segment.x1, sz = segment.z2 - segment.z1;
      const sl = Math.hypot(sx, sz);
      if (sl <= EPS || Math.abs(dx * sz - dz * sx) > 1e-5) continue;
      const cross = Math.abs((segment.x1 - a.x) * dz - (segment.z1 - a.z) * dx);
      if (cross > 1e-5) continue;
      const p1 = (segment.x1 - a.x) * dx + (segment.z1 - a.z) * dz;
      const p2 = (segment.x2 - a.x) * dx + (segment.z2 - a.z) * dz;
      covered += Math.max(0, Math.min(length, Math.max(p1, p2)) - Math.max(0, Math.min(p1, p2)));
    }
  }
  return covered >= length - 1e-5;
}

function verticalSurface(id: string, kind: PaintSillSurface['kind'], a: BaySillPoint, b: BaySillPoint, sill: number, top: number, zones: CeilingZoneSpec[], room: ResolvedRoom): PaintSillSurface[] {
  const length = distance(a, b);
  if (length <= EPS) return [];
  const cuts = coveredIntervals(a, b, zones, room);
  const bounds = new Set<number>([0, 1]);
  for (const c of cuts) { bounds.add(c.from); bounds.add(c.to); }
  const sorted = [...bounds].sort((x, y) => x - y);
  const result: PaintSillSurface[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i], to = sorted[i + 1], mid = (from + to) / 2;
    const blockedBelow = cuts.filter((c) => mid >= c.from - EPS && mid <= c.to + EPS).map((c) => c.y).reduce((lowest, y) => Math.min(lowest, y), Infinity);
    const exposedTop = Math.min(top, blockedBelow);
    const p1 = { x: a.x + (b.x - a.x) * from, z: a.z + (b.z - a.z) * from };
    const p2 = { x: a.x + (b.x - a.x) * to, z: a.z + (b.z - a.z) * to };
    const width = distance(p1, p2);
    const area = width * Math.max(0, exposedTop - sill);
    if (area > EPS) result.push({ id: `${id}:${i}`, kind, points: [p1, p2], bottom: sill, top: exposedTop, areaSqm: area, occludedAreaSqm: width * Math.max(0, top - exposedTop) });
  }
  return result;
}

/** Calculate only explicitly declared sill faces, using the same outline/paths used by the scene mesh. */
export function computePaintSillScope(
  declaration: PaintSillFaceInput,
  geometry: BaySillGeometry,
  bay: { sill: number; height: number },
  room: ResolvedRoom,
  ceilingZones: CeilingZoneSpec[],
  walls: WallSegment[],
): PaintSillScopeResult {
  const surfaces: PaintSillSurface[] = [];
  const warnings: string[] = [];
  const sill = bay.sill, top = bay.sill + bay.height;
  if (declaration.faces.includes('underside')) {
    const areaSqm = polygonArea(geometry.outline);
    if (areaSqm > 0) surfaces.push({ id: declaration.id, kind: 'underside', points: geometry.outline, bottom: sill, top: sill, areaSqm, occludedAreaSqm: 0 });
  }
  if (declaration.faces.includes('front')) {
    for (let i = 0; i < geometry.frontPath.length - 1; i++) surfaces.push(...verticalSurface(`${declaration.id}:front:${i}`, 'front', geometry.frontPath[i], geometry.frontPath[i + 1], sill, top, ceilingZones, room));
  }
  for (const [face, a, b] of [
    ['start_end', geometry.wallPath[0], geometry.frontPath[0]],
    ['end_end', geometry.frontPath.at(-1), geometry.wallPath.at(-1)],
  ] as const) {
    if (!declaration.faces.includes(face) || !a || !b) continue;
    if (wallCoversCap(a, b, walls)) {
      warnings.push(`${declaration.id} ${face} fully coincides with a declared wall and was excluded as concealed`);
      continue;
    }
    surfaces.push(...verticalSurface(declaration.id, face, a, b, sill, top, ceilingZones, room));
  }
  const totalAreaSqm = round3(surfaces.reduce((sum, face) => sum + face.areaSqm, 0));
  return { declaration, surfaces, totalAreaSqm, areaByFinish: { ordinary: declaration.finish === 'ordinary' ? totalAreaSqm : 0, wet_area: declaration.finish === 'wet_area' ? totalAreaSqm : 0 }, warnings };
}
