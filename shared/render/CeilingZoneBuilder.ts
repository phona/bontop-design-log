import * as THREE from 'three';
import { scaleBoxUvToMeters, scalePlaneUvToMeters } from './uv-utils.js';
import type { CeilingTradeClass } from '../ceiling-takeoff.js';

/** Plan corners of a ceiling zone footprint, in the area `[x1, z1, x2, z2]` order. */
export type CeilingCorner = 'nw' | 'ne' | 'se' | 'sw';

/** Edges of a ceiling zone footprint keyed against the `area` rectangle sides. */
export type CoveEdge = 'north' | 'east' | 'south' | 'west';

/** 铝扣板分格缝声明：`module` 为单块边长（米），`seam_width` 缝宽，`seam_color` 缝色。 */
export interface BucklePanelSpec {
  module: number;
  seam_width?: number;
  seam_color?: string;
}

export interface CeilingZoneSpec {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  /** Optional plan rounding radius applied to all four corners, in metres. */
  corner_radius?: number;
  /**
   * Optional per-corner rounding radii (metres). Declared corners override
   * `corner_radius`; a corner absent from the map falls back to `corner_radius`
   * (or square when neither is declared). Use this to round only genuinely
   * exposed convex corners — butt joints, coplanar joints and wall junctions
   * must stay orthogonal (DEC-2026-10-05-R18 附则).
   */
  corner_radii?: Partial<Record<CeilingCorner, number>>;
  /**
   * Optional concave (reentrant) corner fillets in metres, keyed by plan corner.
   * A fillet ADDS material: the outline runs `radius` past the corner along both
   * adjacent edges and joins them with a tangent arc, so a sharp reentrant corner
   * of a drop band becomes a soft elbow. Use it where two exposed bulkhead faces
   * of the same ring meet (DEC-2026-10-07-R01: 餐厅吊顶环「一圈圆」).
   */
  concave_fillets?: Partial<Record<CeilingCorner, number>>;
  /**
   * Optional per-corner open-quadrant declaration for concave fillets. A fillet
   * declared here is MIRRORED: the outline runs `radius` BACKWARD along both
   * adjacent edges and the arc centre sits at `corner − R·(dirIn + dirOut)`,
   * filling the declared quadrant. Use it for a cross-zone elbow whose opening
   * faces the zone's own footprint (DEC-2026-10-08-R05: 门头盒 SE 凹弧填西南开口、
   * 与门厅吊顶西缘相切——默认方向会扎进邻区体量). The declared quadrant must be
   * the mirrored centre's quadrant (sw→nw, se→sw, ne→se, nw→ne), else fail closed.
   */
  concave_fillets_open?: Partial<Record<CeilingCorner, CeilingCorner>>;
  /**
   * Optional elevation coves (metres) keyed by footprint edge. A cove adds a
   * quarter-round strip along that edge where the drop fascia meets the room's
   * flat ceiling, softening the orthogonal step (DEC-2026-10-08-R01: 北带南缘
   * 弧面衔接). The radius must fit the fascia height (`thickness`) and the
   * straight run left by adjacent corner treatments.
   */
  cove_fillets?: Partial<Record<CoveEdge, number>>;
  /** Optional aluminium panel module declaration for `aluminum_buckle` zones. */
  buckle_panel?: BucklePanelSpec;
  /** Optional inspection layer applied to every generated part of this zone. */
  inspection_layer?: string;
  /** Material opacity while the declared inspection layer is active. */
  inspection_opacity?: number;
  /**
   * 工艺/计价类别（算量与高亮口径，与 `type` 正交）。只随 `userData.ceiling` 透出，
   * 不影响几何；省略时按 type 回退（见 shared/ceiling-takeoff.ts）。
   */
  trade?: CeilingTradeClass;
  note?: string;
}

const SLAB_EPS = 0.002;
const SKIRT_THICKNESS = 0.02;
const SKIRT_INSET = SKIRT_THICKNESS / 2;
const SEAM_HEIGHT = 0.002;
const SEAM_GAP = 0.0015;
const COLOR_DROP = '#f5f5f5';
const COLOR_BUCKLE = '#eceff1';
const COLOR_SEAM = '#6b7a82';

const SOLID_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);
const CORNERS: readonly CeilingCorner[] = ['nw', 'ne', 'se', 'sw'];
const COVE_EDGES: readonly CoveEdge[] = ['north', 'east', 'south', 'west'];

/** Nominal finish plane elevation; the render builder adds a 2mm anti-z-fighting offset. */
export function ceilingFinishY(zone: Pick<CeilingZoneSpec, 'thickness'>, ceilingHeight = 2.8): number {
  if (zone.thickness === undefined || zone.thickness <= 0) throw new Error('ceiling zone thickness must be positive');
  return ceilingHeight - zone.thickness;
}

function roundedRectangleShape(width: number, depth: number, radii: Record<CeilingCorner, number>): THREE.Shape {
  const halfW = width / 2;
  const halfD = depth / 2;
  const { nw, ne, se, sw } = radii;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + sw, -halfD);
  shape.lineTo(halfW - se, -halfD);
  shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + se);
  shape.lineTo(halfW, halfD - ne);
  shape.quadraticCurveTo(halfW, halfD, halfW - ne, halfD);
  shape.lineTo(-halfW + nw, halfD);
  shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - nw);
  shape.lineTo(-halfW, -halfD + sw);
  shape.quadraticCurveTo(-halfW, -halfD, -halfW + sw, -halfD);
  shape.closePath();
  return shape;
}

function roundedPerimeterShape(width: number, depth: number, radii: Record<CeilingCorner, number>, wallThickness: number): THREE.Shape {
  const outer = roundedRectangleShape(width, depth, radii);
  const innerWidth = Math.max(0.001, width - wallThickness * 2);
  const innerDepth = Math.max(0.001, depth - wallThickness * 2);
  const innerRadii = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    innerRadii[corner] = Math.max(0.001, Math.min(radii[corner] - wallThickness, innerWidth / 2, innerDepth / 2));
  }
  outer.holes.push(roundedRectangleShape(innerWidth, innerDepth, innerRadii));
  return outer;
}

/**
 * Resolve per-corner radii. Returns null when any declared radius is invalid
 * (non-finite, negative or larger than half of the smaller footprint side) —
 * the caller then skips the zone instead of emitting broken geometry.
 */
function resolveCornerRadii(zone: CeilingZoneSpec, width: number, depth: number): Record<CeilingCorner, number> | null {
  const max = Math.min(width, depth) / 2;
  const radii = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    const declared = zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0;
    if (!Number.isFinite(declared) || declared < 0 || declared > max) return null;
    radii[corner] = declared;
  }
  return radii;
}

function isUniform(radii: Record<CeilingCorner, number>): number | undefined {
  const first = radii.nw;
  return CORNERS.every((corner) => radii[corner] === first) ? first : undefined;
}

/**
 * 镜像凹弧的合法开口象限：声明后弧心落在该象限（sw→nw, se→sw, ne→se, nw→ne）。
 * 用于跨分区拐肘——开口在本分区footprint一侧，默认方向会扎进邻区体量。
 */
const MIRRORED_OPEN: Record<CeilingCorner, CeilingCorner> = { sw: 'nw', se: 'sw', ne: 'se', nw: 'ne' };

/**
 * Resolve concave fillet radii. Returns null when a fillet is invalid
 * (non-finite, negative, larger than half of the smaller footprint side, or
 * declared next to a convex round on the same corner), or when an open-quadrant
 * declaration names a corner without a fillet or a quadrant that is not the
 * mirrored centre's quadrant.
 */
function resolveConcaveFillets(zone: CeilingZoneSpec, width: number, depth: number): Record<CeilingCorner, number> | null {
  const max = Math.min(width, depth) / 2;
  const fillets = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    const declared = zone.concave_fillets?.[corner] ?? 0;
    if (declared === 0) continue;
    if (!Number.isFinite(declared) || declared < 0 || declared > max) return null;
    if ((zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0) > 0) return null;
    fillets[corner] = declared;
  }
  for (const [corner, open] of Object.entries(zone.concave_fillets_open ?? {}) as Array<[CeilingCorner, CeilingCorner]>) {
    if (!CORNERS.includes(corner) || fillets[corner] <= 0) return null;
    if (open !== MIRRORED_OPEN[corner]) return null;
  }
  return fillets;
}

/** Plan point in model coordinates (x east, z south). */
interface PlanPoint { x: number; z: number }

const dist2 = (a: PlanPoint, b: PlanPoint): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Sample one corner arc into chords so the outline stays a plain polygon. */
function arcSamples(center: PlanPoint, start: PlanPoint, end: PlanPoint): PlanPoint[] {
  const radius = dist2(center, start);
  const a0 = Math.atan2(start.z - center.z, start.x - center.x);
  const a1 = Math.atan2(end.z - center.z, end.x - center.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 16)));
  const samples: PlanPoint[] = [];
  for (let step = 1; step < steps; step++) {
    const angle = a0 + (delta * step) / steps;
    samples.push({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  }
  return samples;
}

/**
 * Sample an inner quarter round with an explicit turn direction.  Concave
 * corners are part of the union footprint, so using the generic shortest arc
 * is unsafe: a sign change at ±PI can send the arc into the wrong quadrant.
 */
function concaveQuarterSamples(center: PlanPoint, start: PlanPoint, end: PlanPoint): PlanPoint[] {
  const radius = dist2(center, start);
  const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
  const endAngle = startAngle + Math.PI / 2;
  const expectedEnd = { x: center.x + Math.cos(endAngle) * radius, z: center.z + Math.sin(endAngle) * radius };
  // The caller supplies tangent points for this explicit quadrant.  Keep the
  // endpoint check local so a future corner mapping cannot silently flip.
  if (dist2(expectedEnd, end) > 1e-6) return arcSamples(center, start, end);
  const samples: PlanPoint[] = [];
  const steps = 8;
  for (let step = 1; step < steps; step++) {
    const angle = startAngle + (Math.PI / 2) * (step / steps);
    samples.push({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  }
  return samples;
}

/**
 * Outline of a rectangle whose corners carry mixed treatments:
 * - convex round  → stop `r` before the corner, arc with the corner as centre
 * - concave fillet → run `R` past the corner along both edges, arc around the
 *   centre `corner + R·(dirIn + dirOut)` (material added → soft elbow);
 *   declaring the corner in `openQuadrants` MIRRORS it: the outline runs `R`
 *   backward along both edges, arc around `corner − R·(dirIn + dirOut)`, filling
 *   the declared quadrant (cross-zone elbow — DEC-2026-10-08-R05)
 *
 * Traversal starts at the SW corner's south-edge exit and walks
 * SW → SE → NE → NW, matching `roundedRectangleShape`. Returns null when the
 * two corners sharing an edge would consume more than that edge's length.
 */
export function buildMixedRectangleOutline(
  x1: number, z1: number, x2: number, z2: number,
  radii: Record<CeilingCorner, number>,
  fillets: Record<CeilingCorner, number>,
  openQuadrants?: Partial<Record<CeilingCorner, CeilingCorner>>,
): PlanPoint[] | null {
  const width = Math.abs(x2 - x1);
  const depth = Math.abs(z2 - z1);
  const events: Array<{ key: CeilingCorner; point: PlanPoint; dirIn: PlanPoint; dirOut: PlanPoint }> = [
    { key: 'sw', point: { x: x1, z: z2 }, dirIn: { x: 0, z: 1 }, dirOut: { x: 1, z: 0 } },
    { key: 'se', point: { x: x2, z: z2 }, dirIn: { x: 1, z: 0 }, dirOut: { x: 0, z: -1 } },
    { key: 'ne', point: { x: x2, z: z1 }, dirIn: { x: 0, z: -1 }, dirOut: { x: -1, z: 0 } },
    { key: 'nw', point: { x: x1, z: z1 }, dirIn: { x: -1, z: 0 }, dirOut: { x: 0, z: 1 } },
  ];
  const edges: Array<[CeilingCorner, CeilingCorner, number]> = [
    ['sw', 'se', width],
    ['se', 'ne', depth],
    ['ne', 'nw', width],
    ['nw', 'sw', depth],
  ];
  const consumed = (key: CeilingCorner): number => (fillets[key] > 0 ? fillets[key] : radii[key]);
  for (const [a, b, length] of edges) {
    if (consumed(a) + consumed(b) > length + 1e-9) return null;
  }

  const outline: PlanPoint[] = [];
  for (const event of events) {
    const { point, dirIn, dirOut } = event;
    const fillet = fillets[event.key];
    const round = radii[event.key];
    let entry: PlanPoint;
    let exit: PlanPoint;
    let arc: { center: PlanPoint; start: PlanPoint; end: PlanPoint } | null = null;
    if (fillet > 0) {
      // 声明了开口象限 → 镜像凹弧：沿两邻边往回跑 R，弧心在 corner − R·(dirIn+dirOut)，
      // 填补声明象限的开口（跨分区拐肘；默认方向会扎进邻区体量）。
      const sign = openQuadrants?.[event.key] ? -1 : 1;
      entry = { x: point.x + sign * dirIn.x * fillet, z: point.z + sign * dirIn.z * fillet };
      exit = { x: point.x + sign * dirOut.x * fillet, z: point.z + sign * dirOut.z * fillet };
      arc = {
        center: { x: point.x + sign * (dirIn.x + dirOut.x) * fillet, z: point.z + sign * (dirIn.z + dirOut.z) * fillet },
        start: entry,
        end: exit,
      };
    } else if (round > 0) {
      entry = { x: point.x - dirIn.x * round, z: point.z - dirIn.z * round };
      exit = { x: point.x + dirOut.x * round, z: point.z + dirOut.z * round };
      arc = { center: { x: point.x, z: point.z }, start: entry, end: exit };
    } else {
      entry = { x: point.x, z: point.z };
      exit = { x: point.x, z: point.z };
    }
    if (outline.length === 0 || dist2(outline[outline.length - 1], entry) > 1e-9) outline.push(entry);
    if (arc) {
      const samples = fillet > 0
        ? concaveQuarterSamples(arc.center, arc.start, arc.end)
        : arcSamples(arc.center, arc.start, arc.end);
      outline.push(...samples);
    }
    if (!arc || dist2(entry, exit) > 1e-9) outline.push(exit);
  }
  return outline.length >= 3 ? outline : null;
}

/** Plan outline → THREE.Shape in the builder's local frame (local y = −world z). */
function outlineShape(outline: PlanPoint[], cx: number, cz: number): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((point, index) => {
    const lx = point.x - cx;
    const ly = cz - point.z;
    if (index === 0) shape.moveTo(lx, ly);
    else shape.lineTo(lx, ly);
  });
  shape.closePath();
  return shape;
}

/**
 * Resolve elevation cove radii. Returns null when a declared cove is invalid
 * (non-finite, negative, deeper than the fascia height, or longer than the
 * straight run left on its edge by adjacent corner treatments).
 */
function resolveCoveFillets(
  zone: CeilingZoneSpec,
  radii: Record<CeilingCorner, number>,
  fillets: Record<CeilingCorner, number>,
  w: number,
  d: number,
  thickness: number,
): Record<CoveEdge, number> | null {
  const consumed = (corner: CeilingCorner): number => (fillets[corner] > 0 ? fillets[corner] : radii[corner]);
  const available: Record<CoveEdge, number> = {
    north: w - consumed('nw') - consumed('ne'),
    south: w - consumed('sw') - consumed('se'),
    west: d - consumed('nw') - consumed('sw'),
    east: d - consumed('ne') - consumed('se'),
  };
  const coves = { north: 0, east: 0, south: 0, west: 0 } as Record<CoveEdge, number>;
  for (const edge of COVE_EDGES) {
    const declared = zone.cove_fillets?.[edge] ?? 0;
    if (declared === 0) continue;
    if (!Number.isFinite(declared) || declared <= 0 || declared > thickness || declared > available[edge]) return null;
    coves[edge] = declared;
  }
  return coves;
}

/** Closed cove cross-section in local (u = outward, v = up) coords, sampled for sweeping. */
function coveProfilePoints(r: number): Array<{ u: number; v: number }> {
  const points: Array<{ u: number; v: number }> = [
    { u: 0, v: 0 },
    { u: 0, v: r },
    { u: r, v: r },
  ];
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const phi = Math.PI / 2 + (Math.PI / 2) * (i / steps);
    points.push({ u: r + r * Math.cos(phi), v: r * Math.sin(phi) });
  }
  return points;
}

interface CovePathPoint { x: number; z: number; ox: number; oz: number }

interface CoveRun { points: CovePathPoint[] }

type CoveSegment =
  | { kind: 'edge'; edge: CoveEdge; from: PlanPoint; to: PlanPoint }
  | { kind: 'corner'; included: boolean; points: PlanPoint[]; center?: PlanPoint; radial: 'inward' | 'outward' };

/**
 * Ordered cyclic sequence of cove-eligible segments for a zone footprint,
 * walking the same sw→se→ne→nw order as `buildMixedRectangleOutline`.
 * Corner arcs: concave fillets always included (they transition tangentially
 * into a zone boundary or buried interior); convex rounds only when BOTH
 * adjacent edges are coved; square corners join through the corner point when
 * both adjacent edges are coved. Straight edges are included only when coved.
 */
function buildCoveSegments(
  x1: number, z1: number, x2: number, z2: number,
  radii: Record<CeilingCorner, number>,
  fillets: Record<CeilingCorner, number>,
  coves: Record<CoveEdge, number>,
): CoveSegment[] {
  const events: Array<{ key: CeilingCorner; point: PlanPoint; dirIn: PlanPoint; dirOut: PlanPoint; edgeIn: CoveEdge; edgeOut: CoveEdge }> = [
    { key: 'sw', point: { x: x1, z: z2 }, dirIn: { x: 0, z: 1 }, dirOut: { x: 1, z: 0 }, edgeIn: 'west', edgeOut: 'south' },
    { key: 'se', point: { x: x2, z: z2 }, dirIn: { x: 1, z: 0 }, dirOut: { x: 0, z: -1 }, edgeIn: 'south', edgeOut: 'east' },
    { key: 'ne', point: { x: x2, z: z1 }, dirIn: { x: 0, z: -1 }, dirOut: { x: -1, z: 0 }, edgeIn: 'east', edgeOut: 'north' },
    { key: 'nw', point: { x: x1, z: z1 }, dirIn: { x: -1, z: 0 }, dirOut: { x: 0, z: 1 }, edgeIn: 'north', edgeOut: 'west' },
  ];
  const edgeDeclared = (edge: CoveEdge): boolean => coves[edge] > 0;
  const segments: CoveSegment[] = [];
  for (const event of events) {
    const { key, point, dirIn, dirOut } = event;
    const r = fillets[key] > 0 ? fillets[key] : radii[key];
    if (fillets[key] > 0) {
      const entry = { x: point.x + dirIn.x * r, z: point.z + dirIn.z * r };
      const exit = { x: point.x + dirOut.x * r, z: point.z + dirOut.z * r };
      const center = { x: point.x + (dirIn.x + dirOut.x) * r, z: point.z + (dirIn.z + dirOut.z) * r };
      const both = edgeDeclared(event.edgeIn) && edgeDeclared(event.edgeOut);
      // 统一规则：拐肘/凸圆角都只在两邻边都声明弧面时包裹——
      // 包裹让弧线转过角去（扎进墙或连续到邻带）；单边声明时在切点干净截断，
      // 不做悬空的 flare 收尾（DEC-2026-10-08-R01 业主评审判丑后统一）。
      segments.push({ kind: 'corner', included: both, points: both ? [entry, ...arcSamples(center, entry, exit), exit] : [entry, exit], center, radial: 'inward' });
    } else if (r > 0) {
      const entry = { x: point.x - dirIn.x * r, z: point.z - dirIn.z * r };
      const exit = { x: point.x + dirOut.x * r, z: point.z + dirOut.z * r };
      const inDeclared = edgeDeclared(event.edgeIn);
      const outDeclared = edgeDeclared(event.edgeOut);
      const center = { x: point.x, z: point.z };
      if (inDeclared && outDeclared) {
        segments.push({ kind: 'corner', included: true, points: [entry, ...arcSamples(center, entry, exit), exit], center, radial: 'outward' });
      } else if (inDeclared !== outDeclared) {
        // 悬空端半程包裹：凸圆角只包到弧中点、端面转进转角空气腔——
        // 房间内读到「弧线消失进转角」，不出现裸切面，也不产生越过体量的悬空回转段。
        const midRadial = { x: -dirIn.x + dirOut.x, z: -dirIn.z + dirOut.z };
        const midLen = Math.hypot(midRadial.x, midRadial.z) || 1;
        const mid = { x: center.x + (r * midRadial.x) / midLen, z: center.z + (r * midRadial.z) / midLen };
        segments.push({ kind: 'corner', included: true, points: [entry, ...arcSamples(center, entry, mid), mid], center, radial: 'outward' });
      } else {
        segments.push({ kind: 'corner', included: false, points: [entry, exit], center, radial: 'outward' });
      }
    } else {
      segments.push({ kind: 'corner', included: edgeDeclared(event.edgeIn) && edgeDeclared(event.edgeOut), points: [point], radial: 'outward' });
    }
    segments.push({ kind: 'edge', edge: event.edgeOut, from: { x: 0, z: 0 }, to: { x: 0, z: 0 } });
  }
  // Resolve straight-edge endpoints from the corner in the same pair (its
  // edgeOut) and the next corner (its edgeIn).
  const resolved: CoveSegment[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const corner = segments[i];
    const edge = segments[i + 1] as Extract<CoveSegment, { kind: 'edge' }>;
    const nextCorner = segments[(i + 2) % segments.length];
    const from = lastPoint(corner);
    const to = firstPoint(nextCorner);
    resolved.push(corner);
    resolved.push({ kind: 'edge', edge: edge.edge, from, to });
  }
  return resolved;
}

function firstPoint(segment: CoveSegment): PlanPoint {
  return segment.kind === 'edge' ? segment.from : segment.points[0];
}

function lastPoint(segment: CoveSegment): PlanPoint {
  return segment.kind === 'edge' ? segment.to : segment.points[segment.points.length - 1];
}

/**
 * Contiguous cove runs: maximal chains of declared edges joined through
 * included corner treatments. Runs start/end with a plain cut at tangency
 * points (or die buried where the path continues into an adjacent zone mass).
 * Each point carries its plan outward normal: rotate90(travel) on straight
 * edges, radial (toward/away from the arc centre) on corner arcs.
 */
function buildCoveRuns(segments: CoveSegment[], coves: Record<CoveEdge, number>): CoveRun[] {
  const runs: CoveRun[] = [];
  let current: CovePathPoint[] = [];
  const pushPoint = (point: PlanPoint, ox: number, oz: number): void => {
    const last = current[current.length - 1];
    if (last && Math.hypot(last.x - point.x, last.z - point.z) < 1e-9) return;
    current.push({ x: point.x, z: point.z, ox, oz });
  };
  const flush = (): void => {
    if (current.length >= 2) runs.push({ points: current });
    current = [];
  };
  const radialOut = (segment: Extract<CoveSegment, { kind: 'corner' }>, point: PlanPoint): { ox: number; oz: number } => {
    const center = segment.center!;
    let ox = point.x - center.x;
    let oz = point.z - center.z;
    if (segment.radial === 'inward') {
      ox = -ox;
      oz = -oz;
    }
    const len = Math.hypot(ox, oz) || 1;
    return { ox: ox / len, oz: oz / len };
  };
  for (let i = 0; i < segments.length; i += 2) {
    const corner = segments[i] as Extract<CoveSegment, { kind: 'corner' }>;
    const edge = segments[i + 1] as Extract<CoveSegment, { kind: 'edge' }>;
    const edgeIncluded = coves[edge.edge] > 0;
    if (edgeIncluded) {
      const ex = edge.to.x - edge.from.x;
      const ez = edge.to.z - edge.from.z;
      const len = Math.hypot(ex, ez) || 1;
      const eox = -ez / len;
      const eoz = ex / len;
      if (corner.included) {
        const pts = corner.points;
        for (let k = 0; k < pts.length; k++) {
          const normal = radialOut(corner, pts[k]);
          pushPoint(pts[k], normal.ox, normal.oz);
        }
        // Last corner point sits on the next edge: hand over to the edge normal.
        if (current.length > 0) {
          const lastPoint = current[current.length - 1];
          lastPoint.ox = eox;
          lastPoint.oz = eoz;
        }
      } else {
        pushPoint(firstPoint(edge), eox, eoz);
      }
      pushPoint(edge.to, eox, eoz);
    } else {
      if (corner.included) {
        const pts = corner.points;
        for (let k = 0; k < pts.length; k++) {
          const normal = radialOut(corner, pts[k]);
          pushPoint(pts[k], normal.ox, normal.oz);
        }
      }
      flush();
    }
  }
  flush();
  return runs;
}

/**
 * Sweep one cove run: stations along the plan path, profile offset outward
 * (perpendicular) and hanging `r` below the ceiling corner line. Profile is
 * split into its three segments (fascia line / ceiling line / quarter arc)
 * as independent vertex blocks so `computeVertexNormals` never averages
 * across the tangent creases — flat stays flat, only the arc reads smooth.
 */
function buildCoveRunMesh(
  zone: CeilingZoneSpec,
  run: CoveRun,
  ceilingHeight: number,
  r: number,
  material: THREE.Material,
): THREE.Mesh | null {
  const pts = run.points;
  if (pts.length < 2) return null;
  const profile = coveProfilePoints(r);
  const segs: Array<Array<{ u: number; v: number }>> = [
    [profile[0], profile[1]],
    [profile[1], profile[2]],
    profile.slice(2),
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const seg of segs) {
    const segOffset = positions.length / 3;
    for (const point of pts) {
      for (const { u, v } of seg) {
        positions.push(point.x + point.ox * u, ceilingHeight + v - r, point.z + point.oz * u);
      }
    }
    const k = seg.length;
    for (let s = 0; s < pts.length - 1; s++) {
      for (let j = 0; j < k - 1; j++) {
        const a = segOffset + s * k + j;
        const b = a + 1;
        const c = a + k;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = {
    part: 'cove',
    ceilingPersistent: true,
    ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
    ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
  };
  return mesh;
}

/**
 * 铝扣板分格缝：沿 `area` 最小角起按 `module` 排块，缝为略低于板面的暗色细条。
 * 只对无圆角的矩形 footprint 生效——带圆角/异形边直接用直缝会越出板面。
 */
function buildBuckleSeams(zone: CeilingZoneSpec, area: [number, number, number, number], topY: number): THREE.Mesh[] {
  const panel = zone.buckle_panel;
  if (!panel) return [];
  const module = panel.module;
  if (!Number.isFinite(module) || module < 0.1 || module > 1.2) return [];
  const seamWidth = panel.seam_width ?? 0.006;
  if (!Number.isFinite(seamWidth) || seamWidth <= 0 || seamWidth >= module) return [];
  const [x1, z1, x2, z2] = area;
  const w = x2 - x1;
  const d = z2 - z1;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const countX = Math.floor((w + 1e-9) / module);
  const countZ = Math.floor((d + 1e-9) / module);
  if (countX < 2 && countZ < 2) return [];
  const material = new THREE.MeshStandardMaterial({
    color: panel.seam_color ?? COLOR_SEAM,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const seamY = topY - SEAM_GAP - SEAM_HEIGHT / 2;
  const mkSeam = (sizeX: number, sizeZ: number, px: number, pz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, SEAM_HEIGHT, sizeZ), material);
    mesh.position.set(px, seamY, pz);
    mesh.userData = {
      part: 'buckle-seam',
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
    return mesh;
  };  const seams: THREE.Mesh[] = [];
  for (let i = 1; i < countX; i++) seams.push(mkSeam(seamWidth, d, x1 + i * module, cz));
  for (let i = 1; i < countZ; i++) seams.push(mkSeam(w, seamWidth, cx, z1 + i * module));
  return seams;
}

export function buildCeilingZone(zone: CeilingZoneSpec, ceilingHeight = 2.8): THREE.Group | null {
  if (!SOLID_TYPES.has(zone.type)) return null;
  if (!zone.area || zone.thickness === undefined) return null;
  if (zone.thickness <= 0) return null;

  const [x1, z1, x2, z2] = zone.area;
  const w = x2 - x1;
  const d = z2 - z1;
  if (w <= 0 || d <= 0) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const topY = ceilingFinishY(zone, ceilingHeight) + SLAB_EPS;
  const isBuckle = zone.type === 'aluminum_buckle';
  const radii = resolveCornerRadii(zone, w, d);
  if (!radii) return null;
  const fillets = resolveConcaveFillets(zone, w, d);
  if (!fillets) return null;
  const coves = resolveCoveFillets(zone, radii, fillets, w, d, zone.thickness);
  if (!coves) return null;
  const radius = Math.max(radii.nw, radii.ne, radii.se, radii.sw);
  const filletRadius = Math.max(fillets.nw, fillets.ne, fillets.se, fillets.sw);
  // Mixed outline (convex rounds and/or concave fillets) needs a sampled polygon
  // plus a solid prism for the sides; pure convex rounding keeps the Bézier path.
  const outline = filletRadius > 0
    ? buildMixedRectangleOutline(x1, z1, x2, z2, radii, fillets, zone.concave_fillets_open)
    : null;
  if (filletRadius > 0 && !outline) return null;

  const slabMat = new THREE.MeshStandardMaterial({
    color: isBuckle ? COLOR_BUCKLE : COLOR_DROP,
    roughness: isBuckle ? 0.6 : 0.9,
    metalness: isBuckle ? 0.3 : 0.02,
    side: THREE.DoubleSide,
  });
  let slabGeo: THREE.BufferGeometry;
  let perimeter: THREE.Mesh | undefined;
  if (outline) {
    slabGeo = new THREE.ShapeGeometry(outlineShape(outline, cx, cz));
    const perimeterGeo = new THREE.ExtrudeGeometry(outlineShape(outline, cx, cz), { depth: zone.thickness, bevelEnabled: false, steps: 1 });
    perimeterGeo.translate(0, 0, -zone.thickness);
    perimeter = new THREE.Mesh(perimeterGeo, slabMat);
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.set(cx, ceilingHeight + SLAB_EPS, cz);
    perimeter.userData = {
      part: 'rounded-perimeter',
      ceilingPersistent: true,
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
  } else if (radius > 0) {
    slabGeo = new THREE.ShapeGeometry(roundedRectangleShape(w, d, radii));
    const perimeterGeo = new THREE.ExtrudeGeometry(roundedPerimeterShape(w, d, radii, SKIRT_THICKNESS), { depth: zone.thickness, bevelEnabled: false, steps: 1 });
    perimeterGeo.translate(0, 0, -zone.thickness);
    perimeter = new THREE.Mesh(perimeterGeo, slabMat);
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.set(cx, ceilingHeight + SLAB_EPS, cz);
    perimeter.userData = {
      part: 'rounded-perimeter',
      ceilingPersistent: true,
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
  } else {
    const planeGeo = new THREE.PlaneGeometry(w, d);
    scalePlaneUvToMeters(planeGeo, w, d);
    slabGeo = planeGeo;
  }
  // The extrusion is already a closed solid for rounded/filleted footprints;
  // keep the legacy slab metadata for consumers/tests but do not render its
  // coplanar top face over the extrusion.
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.visible = !perimeter;
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(cx, topY, cz);
  slab.userData = {
    part: 'slab',
    ...(radius > 0 || filletRadius > 0 ? { ceilingPersistent: true } : {}),
    ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
    ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
  };

  const skirtMat = new THREE.MeshStandardMaterial({
    color: COLOR_DROP,
    roughness: 0.9,
    metalness: 0.02,
  });
  const skirtH = zone.thickness;
  const skirtY = ceilingHeight - skirtH / 2;
  const mkSkirt = (len: number, px: number, pz: number, rotY: number) => {
    const geo = new THREE.BoxGeometry(len, skirtH, SKIRT_THICKNESS);
    scaleBoxUvToMeters(geo, len, skirtH);
    const m = new THREE.Mesh(geo, skirtMat);
    m.position.set(px, skirtY, pz);
    m.rotation.y = rotY;
    m.userData = { part: 'skirt' };
    return m;
  };
  const skirts = radius > 0 || filletRadius > 0 ? [] : [
      mkSkirt(w, cx, z1 + SKIRT_INSET, 0),
      mkSkirt(w, cx, z2 - SKIRT_INSET, 0),
      mkSkirt(d, x1 + SKIRT_INSET, cz, Math.PI / 2),
      mkSkirt(d, x2 - SKIRT_INSET, cz, Math.PI / 2),
    ];

  const seams = isBuckle && radius === 0 && filletRadius === 0 ? buildBuckleSeams(zone, zone.area, topY) : [];
  const coveRadius = Math.max(...COVE_EDGES.map((edge) => coves[edge]));
  const coveStrips: THREE.Mesh[] = [];
  if (coveRadius > 0) {
    const segments = buildCoveSegments(x1, z1, x2, z2, radii, fillets, coves);
    for (const run of buildCoveRuns(segments, coves)) {
      const mesh = buildCoveRunMesh(zone, run, ceilingHeight, coveRadius, slabMat);
      if (mesh) coveStrips.push(mesh);
    }
  }

  const group = new THREE.Group();
  group.add(slab, ...(perimeter ? [perimeter] : skirts), ...seams, ...coveStrips);
  const uniform = isUniform(radii);
  group.userData = {
    type: 'ceiling_zone',
    objectId: zone.id,
    roomId: zone.room,
    cornerRadii: radii,
    concaveRadii: fillets,
    coveRadii: coves,
    ...(uniform !== undefined ? { cornerRadius: uniform } : {}),
  };
  return group;
}
