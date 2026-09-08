/**
 * Pure geometry and report primitives shared by the spatial verification CLI
 * and server tests.  Coordinates are metres in the project x/z frame and y is
 * the vertical axis.  This module deliberately has no Three.js dependency so
 * synthetic topology/collision cases can be tested without a renderer.
 */

export type SpatialLevel = 'error' | 'warning' | 'info';

export interface SpatialIssue {
  level: SpatialLevel;
  code: string;
  entity: string;
  source: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface Aabb3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface PlanSegment {
  id?: string;
  wallId: string;
  kind?: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface JunctionSpec {
  id: string;
  type: 'l' | 't' | 'tee' | 'cross';
  walls: string[];
  x?: number;
  z?: number;
}

export interface WallTopologyOptions {
  endpointTolerance?: number;
  overlapTolerance?: number;
  nearMissTolerance?: number;
  junctions?: JunctionSpec[];
  allowedCollinearOverlaps?: Array<{ walls: string[]; max_overlap: number; reason?: string }>;
  source?: string;
}

export interface SpatialToleranceProfile {
  survey_uncertainty?: number;
  fabrication_tolerance?: number;
  installation_tolerance?: number;
  minimum_clearance?: number;
  collision_margin?: number;
  contact_tolerance?: number;
  orientation_tolerance_deg?: number;
  require_finish_face?: boolean;
  site_trim?: boolean;
  mounting_allowed?: boolean;
}

export function requiredClearance(profile: SpatialToleranceProfile): number {
  return (profile.survey_uncertainty ?? 0)
    + (profile.fabrication_tolerance ?? 0)
    + (profile.installation_tolerance ?? 0)
    + (profile.minimum_clearance ?? 0);
}

export function expandAabb(box: Aabb3, margin: number): Aabb3 {
  return {
    minX: box.minX - margin,
    maxX: box.maxX + margin,
    minY: box.minY - margin,
    maxY: box.maxY + margin,
    minZ: box.minZ - margin,
    maxZ: box.maxZ + margin,
  };
}

export function aabbIntersects(a: Aabb3, b: Aabb3, epsilon = 1e-6): boolean {
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon
    && a.minY < b.maxY - epsilon && a.maxY > b.minY + epsilon
    && a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;
}

export function aabbPlanIntersects(a: Aabb3, b: Aabb3, epsilon = 1e-6): boolean {
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon
    && a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;
}

export function aabbGap(a: Aabb3, b: Aabb3): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  const dz = Math.max(0, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ));
  return Math.hypot(dx, dy, dz);
}

/**
 * Positive overlap depth on all three axes.  The return value is deliberately
 * `undefined` for contact, containment by tolerance, or a separating axis so
 * callers can distinguish an actual collision from two objects merely
 * touching.  This is used for runtime furniture envelopes and is kept here so
 * the CLI and focused tests share exactly the same epsilon semantics.
 */
export function aabbOverlapDepth(a: Aabb3, b: Aabb3, epsilon = 1e-6): { x: number; y: number; z: number } | undefined {
  const x = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const y = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const z = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (x <= epsilon || y <= epsilon || z <= epsilon) return undefined;
  return { x, y, z };
}

/**
 * Returns the smaller plan penetration through an axis-aligned wall/glass
 * segment's centerline. A body that merely reaches the centerline returns
 * undefined; a body crossing it returns a positive penetration depth.
 */
export function segmentCrossingDepth(box: Aabb3, segment: PlanSegment, tolerance = 0.005): number | undefined {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-12) return undefined;

  // Project the AABB onto the segment tangent and normal.  The previous
  // dominant-axis approximation silently treated diagonal/arc chord walls as
  // horizontal or vertical, producing both false positives and missed
  // crossings.  An AABB has a closed-form projection radius, so no polygon
  // library or renderer dependency is needed here.
  const tx = dx / length;
  const tz = dz / length;
  const nx = -tz;
  const nz = tx;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const rz = (box.maxZ - box.minZ) / 2;
  const originX = segment.x1;
  const originZ = segment.z1;
  const centerAlong = (cx - originX) * tx + (cz - originZ) * tz;
  const alongRadius = Math.abs(tx) * rx + Math.abs(tz) * rz;
  const alongOverlap = Math.min(centerAlong + alongRadius, length) - Math.max(centerAlong - alongRadius, 0);
  if (alongOverlap <= tolerance) return undefined;
  // A box that only touches an endpoint is legal contact, not a wall
  // crossing.  Keep this exact check separate from the installation tolerance
  // below so a real near-end collision is still reported.
  if (centerAlong + alongRadius <= 1e-9 || centerAlong - alongRadius >= length - 1e-9) return undefined;
  if (centerAlong + alongRadius <= -tolerance || centerAlong - alongRadius >= length + tolerance) return undefined;
  const centerNormal = (cx - originX) * nx + (cz - originZ) * nz;
  const normalRadius = Math.abs(nx) * rx + Math.abs(nz) * rz;
  const minNormal = centerNormal - normalRadius;
  const maxNormal = centerNormal + normalRadius;
  // `tolerance` is only for endpoint/along-span contact.  A positive normal
  // penetration, however small, is a real crossing and must not be
  // downgraded by an installation tolerance.  Keep only numerical epsilon
  // here so a shallow entity-wall penetration remains fail-closed.
  const normalEpsilon = Math.max(1e-7, tolerance);
  if (minNormal >= -normalEpsilon || maxNormal <= normalEpsilon) return undefined;
  return Math.min(-minNormal, maxNormal);
}

/**
 * Positive overlap between an AABB and the finite solid slab represented by a
 * runtime wall segment.  Unlike segmentCrossingDepth this accounts for the
 * wall's actual thickness, so an object may not hide a shallow penetration on
 * one face simply because it does not reach the centreline.
 */
export function segmentSolidOverlapDepth(box: Aabb3, segment: PlanSegment, thickness: number, tolerance = 1e-6): number | undefined {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-12 || thickness <= 0) return undefined;
  const tx = dx / length;
  const tz = dz / length;
  const nx = -tz;
  const nz = tx;
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const rx = (box.maxX - box.minX) / 2;
  const rz = (box.maxZ - box.minZ) / 2;
  const wallHalfLength = length / 2;
  const wallHalfThickness = thickness / 2;
  const wallCenterX = (segment.x1 + segment.x2) / 2;
  const wallCenterZ = (segment.z1 + segment.z2) / 2;
  const centerX = cx - wallCenterX;
  const centerZ = cz - wallCenterZ;

  // A projection onto only the wall tangent/normal is not a separating-axis
  // test: it reports corner false positives when an AABB's projection reaches
  // a finite wall segment without the two plan rectangles intersecting.  Test
  // both world axes and both wall axes, which is the exact SAT for an AABB
  // against this oriented rectangular wall slab.
  const axes = [
    { center: centerX, boxRadius: rx, wallRadius: Math.abs(tx) * wallHalfLength + Math.abs(nx) * wallHalfThickness },
    { center: centerZ, boxRadius: rz, wallRadius: Math.abs(tz) * wallHalfLength + Math.abs(nz) * wallHalfThickness },
    { center: centerX * tx + centerZ * tz, boxRadius: Math.abs(tx) * rx + Math.abs(tz) * rz, wallRadius: wallHalfLength },
    { center: centerX * nx + centerZ * nz, boxRadius: Math.abs(nx) * rx + Math.abs(nz) * rz, wallRadius: wallHalfThickness },
  ];
  const overlaps = axes.map((axis) => axis.boxRadius + axis.wallRadius - Math.abs(axis.center));
  if (overlaps.some((overlap) => overlap <= tolerance)) return undefined;
  return Math.min(...overlaps);
}

export interface WallLampMountInput {
  id: string;
  x: number;
  z: number;
  wall?: PlanSegment;
  wallId?: string;
  wallSide?: string;
  suppressed?: boolean;
  distanceTolerance?: number;
  normalDot?: number;
  orientationToleranceDeg?: number;
}

/** Shared wall-lamp host checks used by the renderer-facing verifier/tests. */
export function validateWallLampMount(input: WallLampMountInput, source = 'config/electrical.yaml'): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  if (!input.wall || !input.wallId || !input.wallSide) {
    issues.push({ level: 'error', code: 'lighting_mount_host_missing', entity: input.id, source, message: `wall lamp ${input.id} must declare wall, wall_side and a resolvable host`, evidence: { wall: input.wallId, wall_side: input.wallSide } });
    return issues;
  }
  if (input.suppressed) {
    issues.push({ level: 'error', code: 'lighting_mount_glass_forbidden', entity: input.id, source, message: `wall lamp ${input.id} cannot mount on a suppressed/curtain wall`, evidence: { wall: input.wallId, wall_side: input.wallSide } });
  }
  const dx = input.wall.x2 - input.wall.x1;
  const dz = input.wall.z2 - input.wall.z1;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((input.x - input.wall.x1) * dx + (input.z - input.wall.z1) * dz) / lenSq)) : 0;
  const px = input.wall.x1 + t * dx;
  const pz = input.wall.z1 + t * dz;
  const distance = Math.hypot(input.x - px, input.z - pz);
  const distanceTolerance = input.distanceTolerance ?? 0.05;
  if (distance > distanceTolerance) {
    issues.push({ level: 'error', code: 'lighting_mount_off_wall', entity: input.id, source, message: `wall lamp ${input.id} is ${distance.toFixed(3)}m away from host wall`, evidence: { wall: input.wallId, distance_m: distance, tolerance_m: distanceTolerance } });
  }
  if (input.normalDot !== undefined) {
    const threshold = Math.cos(((input.orientationToleranceDeg ?? 5) * Math.PI) / 180);
    if (input.normalDot < threshold) {
      issues.push({ level: 'error', code: 'lighting_mount_orientation_reversed', entity: input.id, source, message: `wall lamp ${input.id} faces away from its declared wall side`, evidence: { wall: input.wallId, wall_side: input.wallSide, normal_dot: input.normalDot, minimum_dot: threshold } });
    }
  }
  return issues;
}

export function segmentLength(segment: PlanSegment): number {
  return Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function orient(a: PlanSegment, x: number, z: number): number {
  return cross(a.x2 - a.x1, a.z2 - a.z1, x - a.x1, z - a.z1);
}

function within(value: number, min: number, max: number, epsilon: number): boolean {
  return value >= Math.min(min, max) - epsilon && value <= Math.max(min, max) + epsilon;
}

function pointOnSegment(x: number, z: number, segment: PlanSegment, epsilon: number): boolean {
  return distancePointToLine(x, z, segment) <= epsilon
    && within(x, segment.x1, segment.x2, epsilon)
    && within(z, segment.z1, segment.z2, epsilon);
}

function distancePointToLine(x: number, z: number, segment: PlanSegment): number {
  const length = segmentLength(segment);
  if (length <= 1e-12) return Math.hypot(x - segment.x1, z - segment.z1);
  return Math.abs(orient(segment, x, z)) / length;
}

function endpointDistance(a: PlanSegment, b: PlanSegment): number {
  const points = [[a.x1, a.z1], [a.x2, a.z2]] as const;
  const other = [[b.x1, b.z1], [b.x2, b.z2]] as const;
  let result = Infinity;
  for (const [x, z] of points) for (const [ox, oz] of other) result = Math.min(result, Math.hypot(x - ox, z - oz));
  return result;
}

function hasSharedEndpoint(a: PlanSegment, b: PlanSegment, epsilon: number): boolean {
  return endpointDistance(a, b) <= epsilon;
}

function distancePointToSegment(x: number, z: number, segment: PlanSegment): number {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-18) return Math.hypot(x - segment.x1, z - segment.z1);
  const t = Math.max(0, Math.min(1, ((x - segment.x1) * dx + (z - segment.z1) * dz) / lengthSquared));
  return Math.hypot(x - (segment.x1 + t * dx), z - (segment.z1 + t * dz));
}

export function collinearOverlapLength(a: PlanSegment, b: PlanSegment): number {
  const length = segmentLength(a);
  if (length <= 1e-12) return 0;
  // Project both segments onto a unit tangent derived from A.  Choosing the
  // dominant world axis loses metres on diagonal walls and can turn a legal
  // endpoint into a false overlap (or miss a real one).
  const tx = (a.x2 - a.x1) / length;
  const tz = (a.z2 - a.z1) / length;
  const project = (x: number, z: number) => (x - a.x1) * tx + (z - a.z1) * tz;
  const a1 = 0;
  const a2 = length;
  const b1 = project(b.x1, b.z1);
  const b2 = project(b.x2, b.z2);
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
}

function hasInteriorIntersection(a: PlanSegment, b: PlanSegment, epsilon: number): boolean {
  const c1 = orient(a, b.x1, b.z1);
  const c2 = orient(a, b.x2, b.z2);
  const c3 = orient(b, a.x1, a.z1);
  const c4 = orient(b, a.x2, a.z2);
  return ((c1 > epsilon && c2 < -epsilon) || (c1 < -epsilon && c2 > epsilon))
    && ((c3 > epsilon && c4 < -epsilon) || (c3 < -epsilon && c4 > epsilon));
}

function endpointOnInterior(a: PlanSegment, b: PlanSegment, epsilon: number): { x: number; z: number } | undefined {
  const candidates = [[a.x1, a.z1], [a.x2, a.z2], [b.x1, b.z1], [b.x2, b.z2]] as const;
  for (const [x, z] of candidates) {
    const onA = pointOnSegment(x, z, a, epsilon);
    const onB = pointOnSegment(x, z, b, epsilon);
    const endpointA = Math.min(Math.hypot(x - a.x1, z - a.z1), Math.hypot(x - a.x2, z - a.z2)) <= epsilon;
    const endpointB = Math.min(Math.hypot(x - b.x1, z - b.z1), Math.hypot(x - b.x2, z - b.z2)) <= epsilon;
    if (onA && onB && endpointA !== endpointB) return { x, z };
  }
  return undefined;
}

function junctionAllows(
  junctions: JunctionSpec[],
  a: PlanSegment,
  b: PlanSegment,
  relation: 'cross' | 'tee',
  point?: { x: number; z: number },
): boolean {
  return junctions.some((junction) => {
    if (!junction.walls.includes(a.wallId) || !junction.walls.includes(b.wallId)) return false;
    if (relation === 'cross' && junction.type !== 'cross') return false;
    if (relation === 'tee' && junction.type !== 't' && junction.type !== 'tee') return false;
    if (point && junction.x !== undefined && junction.z !== undefined) return Math.hypot(point.x - junction.x, point.z - junction.z) <= 0.01;
    return true;
  });
}

export function validateWallTopology(segments: PlanSegment[], options: WallTopologyOptions = {}): SpatialIssue[] {
  const endpointTolerance = options.endpointTolerance ?? 0.001;
  const overlapTolerance = options.overlapTolerance ?? 0.010;
  const nearMissTolerance = options.nearMissTolerance ?? 0.010;
  const source = options.source ?? 'config/layout/model-geometry.yaml';
  const issues: SpatialIssue[] = [];

  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    if (segmentLength(a) < endpointTolerance) continue;
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      if (a.wallId === b.wallId || segmentLength(b) < endpointTolerance) continue;
      const sameLine = distancePointToLine(b.x1, b.z1, a) <= endpointTolerance
        && distancePointToLine(b.x2, b.z2, a) <= endpointTolerance;
      if (sameLine) {
        const overlap = collinearOverlapLength(a, b);
        if (overlap > overlapTolerance) {
          const allowed = options.allowedCollinearOverlaps?.find((item) => item.walls.includes(a.wallId) && item.walls.includes(b.wallId));
          if (!allowed || overlap > allowed.max_overlap + overlapTolerance) {
            issues.push({
              level: 'error', code: 'wall_collinear_overlap', entity: `${a.wallId}↔${b.wallId}`, source,
              message: `wall centerlines overlap ${overlap.toFixed(3)}m; duplicate wall geometry is not a legal junction`,
              evidence: { wallA: a.wallId, wallB: b.wallId, overlap_m: overlap, ...(allowed ? { allowed_max_overlap_m: allowed.max_overlap, reason: allowed.reason } : {}) },
            });
          }
        }
        continue;
      }
      const interior = hasInteriorIntersection(a, b, endpointTolerance);
      const tee = endpointOnInterior(a, b, endpointTolerance);
      if (interior || tee) {
        const point = tee ?? { x: (a.x1 + a.x2 + b.x1 + b.x2) / 4, z: (a.z1 + a.z2 + b.z1 + b.z2) / 4 };
        if (!junctionAllows(options.junctions ?? [], a, b, interior ? 'cross' : 'tee', point)) {
          issues.push({
            level: 'error', code: 'wall_intersection_without_junction', entity: `${a.wallId}↔${b.wallId}`, source,
            message: `${interior ? 'wall centerlines cross' : 'T junction is not declared'} at (${point.x.toFixed(3)},${point.z.toFixed(3)})`,
            evidence: { wallA: a.wallId, wallB: b.wallId, x: point.x, z: point.z, relation: interior ? 'cross' : 'tee' },
          });
        }
        continue;
      }
      const sharedEndpoint = hasSharedEndpoint(a, b, endpointTolerance);
      // Tessellated curve chords can run a few millimetres from a tangent
      // straight segment while sharing the curve's true endpoint. They are
      // topology-valid and must not become false near-miss reports.
      const curvedPair = a.kind === 'arc' || b.kind === 'arc';
      if (!sharedEndpoint && !curvedPair && endpointDistance(a, b) <= nearMissTolerance) {
        const distance = endpointDistance(a, b);
        issues.push({
          level: 'warning', code: 'wall_near_miss', entity: `${a.wallId}↔${b.wallId}`, source,
          message: `wall endpoints are ${distance.toFixed(3)}m apart without a shared node`,
          evidence: { wallA: a.wallId, wallB: b.wallId, distance_m: distance },
        });
      }
      const distances = [
        distancePointToSegment(a.x1, a.z1, b), distancePointToSegment(a.x2, a.z2, b),
        distancePointToSegment(b.x1, b.z1, a), distancePointToSegment(b.x2, b.z2, a),
      ];
      const closest = Math.min(...distances);
      if (!sharedEndpoint && !curvedPair && closest <= nearMissTolerance && endpointDistance(a, b) > nearMissTolerance) {
        issues.push({
          level: 'warning', code: 'wall_near_miss', entity: `${a.wallId}↔${b.wallId}`, source,
          message: `wall lines pass within ${closest.toFixed(3)}m without a declared junction`,
          evidence: { wallA: a.wallId, wallB: b.wallId, distance_m: closest },
        });
      }
    }
  }
  return issues;
}

export interface OverlayElementRef {
  id: string;
  type: string;
  wall?: string;
  walls?: string[];
  parts?: Array<{ id?: string; wall?: string; walls?: string[]; wallRefs?: string[] }>;
}

export interface OverlayReplacement {
  wall: string;
  replacement: string;
  kind: string;
  join?: string;
  /** Concrete overlay part selected by this replacement mapping; root means a single-mesh element. */
  part?: string;
  /** Optional concrete structural path id when a part contains multiple paths. */
  path?: string;
  max_overlap?: number;
}

function refsForElement(element: OverlayElementRef): string[] {
  const refs: string[] = [];
  const parts = element.parts ?? [];
  // Overlay parts are canonical when present; a top-level walls summary is
  // metadata and must not count as a second structural owner.
  if (parts.length > 0) {
    for (const part of parts) {
      if (part.wall) refs.push(part.wall);
      if (part.walls) refs.push(...part.walls);
      if (part.wallRefs) refs.push(...part.wallRefs);
    }
    return refs;
  }
  if (element.wall) refs.push(element.wall);
  if (element.walls) refs.push(...element.walls);
  return refs;
}

export function validateOverlayReplacements(
  suppressedWalls: string[],
  elements: OverlayElementRef[],
  replacements: OverlayReplacement[],
  source = 'config/layout/overlay.yaml',
  allWallIds?: string[],
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const suppressed = new Set(suppressedWalls);
  const knownWalls = allWallIds ? new Set(allWallIds) : undefined;
  const allowedKinds = new Set(['curtain_run', 'glass_infill', 'railing_run']);
  const allowedJoins = new Set(['continuous', 'butt', 'endpoint', 't', 'overlap']);
  const byWall = new Map<string, OverlayReplacement[]>();
  for (const replacement of replacements) {
    if (knownWalls && !knownWalls.has(replacement.wall)) {
      issues.push({ level: 'error', code: 'overlay_replacement_wall_unknown', entity: replacement.wall, source, message: `replacement mapping targets unknown wall ${replacement.wall}`, evidence: { wall: replacement.wall, replacement: replacement.replacement } });
    }
    if (!allowedKinds.has(replacement.kind)) {
      issues.push({ level: 'error', code: 'overlay_replacement_kind_invalid', entity: `${replacement.wall}↔${replacement.replacement}`, source, message: `replacement kind ${replacement.kind} is not a structural overlay kind`, evidence: { wall: replacement.wall, replacement: replacement.replacement, kind: replacement.kind, allowed: [...allowedKinds] } });
    }
    if (replacement.join !== undefined && !allowedJoins.has(replacement.join)) {
      issues.push({ level: 'error', code: 'overlay_replacement_join_invalid', entity: `${replacement.wall}↔${replacement.replacement}`, source, message: `replacement join ${replacement.join} is not a declared join semantic`, evidence: { wall: replacement.wall, replacement: replacement.replacement, join: replacement.join, allowed: [...allowedJoins] } });
    }
    const list = byWall.get(replacement.wall) ?? [];
    list.push(replacement);
    byWall.set(replacement.wall, list);
  }
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const collidable = new Set(['curtain_run', 'glass_infill', 'railing_run']);
  const structuralOwners = new Map<string, string[]>();

  for (const [wall, count] of [...new Set(suppressedWalls)].map((wall) => [wall, suppressedWalls.filter((candidate) => candidate === wall).length] as const)) {
    if (count > 1) {
      issues.push({ level: 'error', code: 'overlay_suppress_duplicate', entity: wall, source, message: `wall ${wall} is suppressed by ${count} declarations`, evidence: { wall, count } });
    }
  }

  for (const wall of suppressed) {
    const mappings = byWall.get(wall) ?? [];
    if (mappings.length === 0) {
      issues.push({ level: 'error', code: 'overlay_replacement_missing', entity: wall, source, message: `suppressed wall ${wall} has no declared replacement`, evidence: { wall } });
      continue;
    }
    if (mappings.length > 1) {
      issues.push({ level: 'error', code: 'overlay_replacement_duplicate', entity: wall, source, message: `suppressed wall ${wall} has ${mappings.length} replacement declarations`, evidence: { wall, replacements: mappings.map((item) => item.replacement) } });
    }
    for (const mapping of mappings) {
      const element = elementById.get(mapping.replacement);
      if (!element) {
        issues.push({ level: 'error', code: 'overlay_replacement_unknown', entity: mapping.replacement, source, message: `replacement element does not exist for suppressed wall ${wall}`, evidence: { wall, replacement: mapping.replacement } });
        continue;
      }
      if (element.type !== mapping.kind) {
        issues.push({ level: 'error', code: 'overlay_replacement_type_mismatch', entity: element.id, source, message: `replacement ${element.id} is ${element.type}, expected ${mapping.kind}`, evidence: { wall, replacement: element.id, actual: element.type, expected: mapping.kind } });
      }
      if (mapping.part !== undefined) {
        const knownParts = element.parts?.map((part) => part.id) ?? [];
        const validPart = knownParts.length > 0
          ? knownParts.includes(mapping.part)
          : mapping.part === 'root';
        if (!validPart) {
          issues.push({ level: 'error', code: 'overlay_replacement_part_unknown', entity: `${element.id}↔${wall}`, source, message: `replacement ${element.id} does not contain declared concrete part ${mapping.part}`, evidence: { wall, replacement: element.id, part: mapping.part, known_parts: knownParts.length > 0 ? knownParts : ['root'] } });
        }
      }
      const refs = refsForElement(element);
      const count = refs.filter((ref) => ref === wall).length;
      if (count === 0) {
        issues.push({ level: 'error', code: 'overlay_replacement_not_covering', entity: element.id, source, message: `replacement ${element.id} does not reference suppressed wall ${wall}`, evidence: { wall, replacement: element.id, refs } });
      } else if (count > 1) {
        issues.push({ level: 'error', code: 'overlay_replacement_duplicate', entity: `${element.id}↔${wall}`, source, message: `replacement references wall ${wall} ${count} times`, evidence: { wall, replacement: element.id, count } });
      }
    }
  }

  for (const element of elements) {
    if (!collidable.has(element.type)) continue;
    for (const wall of refsForElement(element)) {
      if (knownWalls && !knownWalls.has(wall)) {
        issues.push({ level: 'error', code: 'overlay_wall_unknown', entity: `${element.id}↔${wall}`, source, message: `structural overlay ${element.id} references unknown wall ${wall}`, evidence: { element: element.id, wall } });
        continue;
      }
      if (!suppressed.has(wall)) {
        issues.push({ level: 'error', code: 'overlay_on_unsuppressed_wall', entity: `${element.id}↔${wall}`, source, message: `structural overlay ${element.id} references wall ${wall} without suppressing it`, evidence: { element: element.id, wall } });
      }
      if (!suppressed.has(wall)) continue;
      const owners = structuralOwners.get(wall) ?? [];
      owners.push(element.id);
      structuralOwners.set(wall, owners);
    }
  }
  for (const [wall, owners] of structuralOwners) {
    const unique = [...new Set(owners)];
    if (unique.length > 1) {
      issues.push({ level: 'error', code: 'overlay_replacement_duplicate', entity: wall, source, message: `suppressed wall ${wall} is covered by multiple structural overlay elements`, evidence: { wall, owners: unique } });
    }
  }
  for (const mapping of replacements) {
    if (!suppressed.has(mapping.wall)) {
      issues.push({ level: 'error', code: 'overlay_replacement_orphan', entity: mapping.wall, source, message: `replacement mapping targets a wall that is not suppressed`, evidence: { wall: mapping.wall, replacement: mapping.replacement } });
    }
  }
  return issues;
}

export interface GlassPathSegment extends PlanSegment {
  elementId: string;
  /** Overlay part identity is intentionally retained; duplicate references are physical duplicates. */
  partId?: string;
  refIndex?: number;
  join?: string;
}

export type RuntimeGlassJoinKind = 'continuous' | 'butt' | 'endpoint' | 't' | 'overlap';

/**
 * A runtime closure is bound to two concrete structural path ids.  Element
 * identity alone is deliberately insufficient: a multi-part curtain or
 * railing must still report a real overlap between two distinct paths.
 */
export interface RuntimeGlassJoinSpec {
  elementId: string;
  pathA: string;
  pathB: string;
  join: RuntimeGlassJoinKind;
  max_overlap?: number;
  source?: string;
}

function glassPathIdentity(path: GlassPathSegment): string {
  if (path.id) return path.id;
  return [
    path.elementId,
    path.partId ?? 'root',
    path.refIndex ?? 0,
    path.wallId,
    path.x1.toFixed(6),
    path.z1.toFixed(6),
    path.x2.toFixed(6),
    path.z2.toFixed(6),
  ].join(':');
}

function replacementMatchesPath(replacement: OverlayReplacement, path: GlassPathSegment): boolean {
  if (replacement.replacement !== path.elementId || replacement.wall !== path.wallId) return false;
  if (replacement.part !== undefined && replacement.part !== (path.partId ?? 'root')) return false;
  if (replacement.path !== undefined && replacement.path !== glassPathIdentity(path)) return false;
  return true;
}

/**
 * Convert wall-level replacement semantics into concrete path-pair joins.
 * The generated specs are still geometry-gated at runtime; this function only
 * supplies the explicit source declaration that may authorize an exact joint.
 */
export function deriveRuntimeGlassJoins(
  paths: GlassPathSegment[],
  replacements: OverlayReplacement[] = [],
): RuntimeGlassJoinSpec[] {
  const joins: RuntimeGlassJoinSpec[] = [];
  for (let i = 0; i < paths.length; i++) {
    const a = paths[i];
    const aMappings = replacements.filter((mapping) => replacementMatchesPath(mapping, a) && mapping.join !== undefined);
    if (aMappings.length === 0) continue;
    for (let j = i + 1; j < paths.length; j++) {
      const b = paths[j];
      if (a.elementId !== b.elementId || glassPathIdentity(a) === glassPathIdentity(b)) continue;
      const bMappings = replacements.filter((mapping) => replacementMatchesPath(mapping, b) && mapping.join !== undefined);
      if (bMappings.length === 0) continue;
      // A pair is authorized only when both concrete path declarations agree
      // on the join semantic. Conflicting wall mappings remain fail-closed.
      const matching = aMappings.find((left) => bMappings.some((right) => right.join === left.join));
      if (!matching || !matching.join || !['continuous', 'butt', 'endpoint', 't', 'overlap'].includes(matching.join)) continue;
      const right = bMappings.find((candidate) => candidate.join === matching.join);
      joins.push({
        elementId: a.elementId,
        pathA: glassPathIdentity(a),
        pathB: glassPathIdentity(b),
        join: matching.join as RuntimeGlassJoinKind,
        ...(matching.max_overlap !== undefined && right?.max_overlap !== undefined
          ? { max_overlap: Math.min(matching.max_overlap, right.max_overlap) }
          : {}),
      });
    }
  }
  return joins;
}

export interface OverlayWallJunctionSpec {
  element: string;
  wall: string;
  type?: 'endpoint' | 't' | 'overlap';
  x?: number;
  z?: number;
  tolerance?: number;
  max_overlap?: number;
  reason?: string;
}

export interface RuntimeSpatialObject {
  id: string;
  type: string;
  room?: string;
  box: Aabb3;
  /** Wall id for a deliberately wall-hosted object; that host is checked separately. */
  hostWallId?: string;
  wallId?: string;
  /** Runtime wall mesh is centered on the authored wall line in SceneBuilder. */
  wallContactPolicy?: 'solid' | 'centerline';
  /** Structural element identity for runtime glass/railing joins. */
  elementId?: string;
  /** Concrete runtime part identity; sibling meshes can share a structural path. */
  partId?: string;
  /** Internal railing bars/handrail are construction pieces, not separate panes. */
  collisionRole?: 'structural' | 'internal';
  pathSegments?: GlassPathSegment[];
  segment?: PlanSegment;
  thickness?: number;
}

export interface RuntimeSceneValidationInput {
  furniture: RuntimeSpatialObject[];
  expectedFurnitureIds?: string[];
  /** Structural element ids that must have at least one real runtime mesh. */
  expectedGlassElementIds?: string[];
  walls?: RuntimeSpatialObject[];
  glass?: RuntimeSpatialObject[];
  ceilings?: RuntimeSpatialObject[];
  relationships?: RelationshipSpec[];
  glassJoins?: RuntimeGlassJoinSpec[];
  mepTypes?: string[];
  collisionMargin?: number;
  glassRequiredClearance?: number;
  source?: string;
}

export interface RelationshipSpec {
  id: string;
  type: string;
  objects?: string[];
  inner?: string;
  outer?: string;
}

/** Config-level guard against silently reintroducing type-wide exemptions. */
export function validateRelationshipSpecs(
  relationships: RelationshipSpec[] = [],
  runtimeIds: string[] = [],
  source = 'config/spatial-validation.yaml',
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const known = new Set(runtimeIds);
  for (const relationship of relationships) {
    const objects = relationship.objects?.length === 2
      ? relationship.objects
      : relationship.inner && relationship.outer
        ? [relationship.inner, relationship.outer]
        : [];
    if (objects.length !== 2) {
      issues.push({ level: 'error', code: 'relationship_instance_shape_invalid', entity: relationship.id, source, message: `relationship ${relationship.id} must bind exactly two runtime instances`, evidence: { relationship, object_count: objects.length } });
      continue;
    }
    for (const objectId of objects) {
      if (!objectId.includes(':')) {
        issues.push({ level: 'error', code: 'relationship_instance_unstable', entity: `${relationship.id}:${objectId}`, source, message: `relationship ${relationship.id} uses a type/global name instead of a stable runtime instance id`, evidence: { relationship: relationship.id, object: objectId } });
      } else if (known.size > 0 && !known.has(objectId)) {
        issues.push({ level: 'error', code: 'relationship_object_unknown', entity: `${relationship.id}:${objectId}`, source, message: `relationship ${relationship.id} references an unknown runtime instance`, evidence: { relationship: relationship.id, object: objectId } });
      }
    }
  }
  return issues;
}

function sharedEndpointPoint(a: PlanSegment, b: PlanSegment, epsilon: number): { x: number; z: number } | undefined {
  const points = [[a.x1, a.z1], [a.x2, a.z2]] as const;
  const other = [[b.x1, b.z1], [b.x2, b.z2]] as const;
  for (const [x, z] of points) {
    for (const [ox, oz] of other) {
      if (Math.hypot(x - ox, z - oz) <= epsilon) return { x: (x + ox) / 2, z: (z + oz) / 2 };
    }
  }
  return undefined;
}

function pathEndpointOnWallInterior(path: PlanSegment, wall: PlanSegment, epsilon: number): { x: number; z: number } | undefined {
  const candidates = [[path.x1, path.z1], [path.x2, path.z2]] as const;
  for (const [x, z] of candidates) {
    if (!pointOnSegment(x, z, wall, epsilon)) continue;
    const atWallEndpoint = Math.min(
      Math.hypot(x - wall.x1, z - wall.z1),
      Math.hypot(x - wall.x2, z - wall.z2),
    ) <= epsilon;
    if (!atWallEndpoint) return { x, z };
  }
  return undefined;
}

interface GlassWallRelation {
  kind: 'overlap' | 'cross' | 'tee' | 'endpoint' | 'shared_endpoint' | 'none';
  point?: { x: number; z: number };
  overlap?: number;
}

function glassWallRelation(path: GlassPathSegment, wall: PlanSegment, epsilon = 0.001): GlassWallRelation {
  const sameLine = distancePointToLine(wall.x1, wall.z1, path) <= epsilon
    && distancePointToLine(wall.x2, wall.z2, path) <= epsilon;
  const overlap = sameLine ? collinearOverlapLength(path, wall) : 0;
  if (sameLine && overlap > 0.012) return { kind: 'overlap', overlap };
  if (!sameLine && hasInteriorIntersection(path, wall, epsilon)) return { kind: 'cross' };
  if (!sameLine) {
    const pathEndpoint = pathEndpointOnWallInterior(path, wall, epsilon);
    if (pathEndpoint) return { kind: 'endpoint', point: pathEndpoint };
    const tee = endpointOnInterior(path, wall, epsilon);
    if (tee) return { kind: 'tee', point: tee };
  }
  // A path that closes exactly at a wall endpoint is legal only when a
  // matching, coordinate-bound junction is declared.  Treat it as a distinct
  // endpoint relation rather than silently falling through to "none".
  const shared = sharedEndpointPoint(path, wall, epsilon);
  if (shared) return { kind: 'shared_endpoint', point: shared };
  return { kind: 'none', ...(overlap > 0 ? { overlap } : {}) };
}

function overlayJunctionMatches(path: GlassPathSegment, wall: PlanSegment, spec: OverlayWallJunctionSpec | undefined, epsilon = 0.001): boolean {
  if (!spec || spec.element !== path.elementId || spec.wall !== wall.wallId) return false;
  if (spec.type === undefined || !Number.isFinite(spec.x) || !Number.isFinite(spec.z)) return false;
  const relation = glassWallRelation(path, wall, epsilon);
  const tolerance = spec.tolerance ?? 0.01;
  if (relation.point && Math.hypot(relation.point.x - spec.x!, relation.point.z - spec.z!) > tolerance) return false;
  if (relation.kind === 'overlap') {
    return spec.type === 'overlap'
      && spec.max_overlap !== undefined
      && Number.isFinite(spec.max_overlap)
      && relation.overlap! <= spec.max_overlap + tolerance
      && pointOnSegment(spec.x!, spec.z!, path, tolerance)
      && pointOnSegment(spec.x!, spec.z!, wall, tolerance);
  }
  if (relation.kind === 'endpoint') {
    if (spec.type === 't') return pathEndpointOnWallInterior(path, wall, tolerance) !== undefined;
    return spec.type === 'endpoint';
  }
  if (relation.kind === 'shared_endpoint') return spec.type === 'endpoint';
  if (relation.kind === 'tee') return spec.type === 't';
  return false;
}

/** Validate explicit overlay↔wall exceptions before they can suppress a collision. */
export function validateOverlayJunctionSpecs(
  specs: OverlayWallJunctionSpec[] = [],
  paths: GlassPathSegment[],
  walls: PlanSegment[],
  source = 'config/spatial-validation.yaml',
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const pathElements = new Set(paths.map((path) => path.elementId));
  const wallIds = new Set(walls.map((wall) => wall.wallId));
  const allowedTypes = new Set(['endpoint', 't', 'overlap']);
  for (const spec of specs) {
    if (!pathElements.has(spec.element)) {
      issues.push({ level: 'error', code: 'overlay_junction_element_unknown', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction references unknown structural element ${spec.element}`, evidence: { element: spec.element, wall: spec.wall } });
      continue;
    }
    if (!wallIds.has(spec.wall)) {
      issues.push({ level: 'error', code: 'overlay_junction_wall_unknown', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction references unknown wall ${spec.wall}`, evidence: { element: spec.element, wall: spec.wall } });
      continue;
    }
    if (!spec.type || !allowedTypes.has(spec.type)) {
      issues.push({ level: 'error', code: 'overlay_junction_type_invalid', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction must declare endpoint, t, or overlap type`, evidence: { element: spec.element, wall: spec.wall, type: spec.type } });
      continue;
    }
    if (!Number.isFinite(spec.x) || !Number.isFinite(spec.z)) {
      issues.push({ level: 'error', code: 'overlay_junction_coordinate_missing', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction must declare finite x/z coordinates`, evidence: { element: spec.element, wall: spec.wall, x: spec.x, z: spec.z } });
      continue;
    }
    if (spec.tolerance !== undefined && (!Number.isFinite(spec.tolerance) || spec.tolerance < 0 || spec.tolerance > 0.5)) {
      issues.push({ level: 'error', code: 'overlay_junction_tolerance_invalid', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction tolerance must be finite and within [0, 0.5]m`, evidence: { element: spec.element, wall: spec.wall, tolerance: spec.tolerance } });
      continue;
    }
    if (spec.type === 'overlap' && (!Number.isFinite(spec.max_overlap) || spec.max_overlap! <= 0)) {
      issues.push({ level: 'error', code: 'overlay_junction_overlap_range_invalid', entity: `${spec.element}↔${spec.wall}`, source, message: `overlap junction must declare a positive max_overlap`, evidence: { element: spec.element, wall: spec.wall, max_overlap: spec.max_overlap } });
      continue;
    }
    const matches = paths.some((path) => path.elementId === spec.element
      && overlayJunctionMatches(path, walls.find((candidate) => candidate.wallId === spec.wall)!, spec));
    if (!matches) {
      issues.push({ level: 'error', code: 'overlay_junction_geometry_mismatch', entity: `${spec.element}↔${spec.wall}`, source, message: `overlay junction declaration does not match the referenced path geometry at its declared coordinate`, evidence: { element: spec.element, wall: spec.wall, type: spec.type, x: spec.x, z: spec.z } });
    }
  }
  return issues;
}

export function validateGlassSegments(segments: GlassPathSegment[], source = 'config/layout/overlay.yaml'): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j];
      const sameLine = distancePointToLine(b.x1, b.z1, a) <= 0.001 && distancePointToLine(b.x2, b.z2, a) <= 0.001;
      if (sameLine) {
        const overlap = collinearOverlapLength(a, b);
        if (overlap > 0.012) {
          issues.push({ level: 'error', code: 'glass_duplicate_overlap', entity: `${a.elementId}↔${b.elementId}`, source, message: `glass paths overlap ${overlap.toFixed(3)}m`, evidence: { elementA: a.elementId, elementB: b.elementId, wallA: a.wallId, wallB: b.wallId, overlap_m: overlap } });
        }
        continue;
      }
      // A shared endpoint is the normal representation of a declared corner.
      // Crossing an interior point, however, means two physical glass/railing
      // paths occupy the same joint and must be fixed at the source.
      if (hasInteriorIntersection(a, b, 0.001)) {
        issues.push({ level: 'error', code: 'glass_path_intersection', entity: `${a.elementId}↔${b.elementId}`, source, message: `glass paths cross at an undeclared interior intersection`, evidence: { elementA: a.elementId, elementB: b.elementId, wallA: a.wallId, wallB: b.wallId } });
      } else {
        const tee = endpointOnInterior(a, b, 0.001);
        if (tee) {
          issues.push({ level: 'error', code: 'glass_path_t_junction', entity: `${a.elementId}↔${b.elementId}`, source, message: `glass path terminates on the interior of another path`, evidence: { elementA: a.elementId, elementB: b.elementId, wallA: a.wallId, wallB: b.wallId, x: tee.x, z: tee.z } });
        }
      }
    }
  }
  return issues;
}

/**
 * Structural overlay paths must not be drawn over a wall that remains in the
 * scene.  Suppressed wall ids are excluded because their replacement is
 * intentionally coincident with the source centerline.  Endpoint contact is
 * legal; positive overlap, crossing, and a T-junction are not.
 */
export function validateGlassAgainstWalls(
  paths: GlassPathSegment[],
  walls: PlanSegment[],
  suppressedWalls: string[] = [],
  source = 'config/layout/model-geometry.yaml + config/layout/overlay.yaml',
  allowedJunctions: OverlayWallJunctionSpec[] = [],
): SpatialIssue[] {
  const suppressed = new Set(suppressedWalls);
  const issues: SpatialIssue[] = [];
  for (const path of paths) {
    for (const wall of walls) {
      if (suppressed.has(wall.wallId)) continue;
      const allowed = allowedJunctions.find((junction) => overlayJunctionMatches(path, wall, junction));
      const relation = glassWallRelation(path, wall);
      if (relation.kind === 'overlap') {
        if (allowed) continue;
        issues.push({ level: 'error', code: 'glass_wall_overlap', entity: `${path.elementId}↔${wall.wallId}`, source, message: `structural glass/railing path overlaps unsuppressed wall ${wall.wallId}`, evidence: { element: path.elementId, wall: wall.wallId, overlap_m: relation.overlap, ...(allowedJunctions.some((junction) => junction.element === path.elementId && junction.wall === wall.wallId) ? { declared_junction_type: allowedJunctions.find((junction) => junction.element === path.elementId && junction.wall === wall.wallId)?.type } : {}) } });
      } else if (relation.kind === 'cross') {
        // A crossing is never accepted by an endpoint/T/overlap declaration;
        // it needs an explicit wall-topology crossing declaration at the
        // source, otherwise a structural path can silently cut through a
        // real wall.
        issues.push({ level: 'error', code: 'glass_wall_intersection', entity: `${path.elementId}↔${wall.wallId}`, source, message: `structural glass/railing path crosses unsuppressed wall ${wall.wallId}`, evidence: { element: path.elementId, wall: wall.wallId } });
      } else if (relation.kind === 'endpoint' || relation.kind === 'tee') {
        if (!allowed) issues.push({ level: 'error', code: 'glass_wall_t_junction', entity: `${path.elementId}↔${wall.wallId}`, source, message: `structural glass/railing path terminates on unsuppressed wall ${wall.wallId}`, evidence: { element: path.elementId, wall: wall.wallId, ...(relation.point ? { x: relation.point.x, z: relation.point.z } : {}) } });
      }
    }
  }
  return issues;
}

function relationshipAllowsExact(idA: string, idB: string, relationships: RuntimeSceneValidationInput['relationships'] = []): boolean {
  return (relationships ?? []).some((relationship) => {
    const objects = relationship.objects?.length === 2
      ? relationship.objects
      : relationship.inner && relationship.outer
        ? [relationship.inner, relationship.outer]
        : [];
    return objects.length === 2
      && ((objects[0] === idA && objects[1] === idB) || (objects[0] === idB && objects[1] === idA));
  });
}

function pointInAabb(point: { x: number; z: number }, box: Aabb3, epsilon = 0.01): boolean {
  return point.x >= box.minX - epsilon && point.x <= box.maxX + epsilon
    && point.z >= box.minZ - epsilon && point.z <= box.maxZ + epsilon;
}

function overlapCenter(a: Aabb3, b: Aabb3): { x: number; z: number } {
  return {
    x: (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2,
    z: (Math.max(a.minZ, b.minZ) + Math.min(a.maxZ, b.maxZ)) / 2,
  };
}

function runtimeGlassJoinSpec(
  pathA: GlassPathSegment,
  pathB: GlassPathSegment,
  joins: RuntimeGlassJoinSpec[] = [],
): RuntimeGlassJoinSpec | undefined {
  const identityA = glassPathIdentity(pathA);
  const identityB = glassPathIdentity(pathB);
  return joins.find((join) => join.elementId === pathA.elementId
    && ((join.pathA === identityA && join.pathB === identityB) || (join.pathA === identityB && join.pathB === identityA)));
}

function overlapMidpoint(a: PlanSegment, b: PlanSegment): { x: number; z: number } | undefined {
  const length = segmentLength(a);
  if (length <= 1e-12) return undefined;
  const tx = (a.x2 - a.x1) / length;
  const tz = (a.z2 - a.z1) / length;
  const project = (x: number, z: number) => (x - a.x1) * tx + (z - a.z1) * tz;
  const lo = Math.max(0, Math.min(project(b.x1, b.z1), project(b.x2, b.z2)));
  const hi = Math.min(length, Math.max(project(b.x1, b.z1), project(b.x2, b.z2)));
  if (hi <= lo) return undefined;
  const t = (lo + hi) / 2;
  return { x: a.x1 + tx * t, z: a.z1 + tz * t };
}

function runtimeGlassJoinPoint(
  pathA: GlassPathSegment,
  pathB: GlassPathSegment,
  join: RuntimeGlassJoinSpec,
): { x: number; z: number } | undefined {
  const sameLine = distancePointToLine(pathB.x1, pathB.z1, pathA) <= 0.001
    && distancePointToLine(pathB.x2, pathB.z2, pathA) <= 0.001;
  const overlap = sameLine ? collinearOverlapLength(pathA, pathB) : 0;
  if (join.join === 'overlap') {
    if (overlap <= 0.012 || join.max_overlap === undefined || overlap > join.max_overlap + 0.001) return undefined;
    return overlapMidpoint(pathA, pathB);
  }
  if (join.join === 't') return endpointOnInterior(pathA, pathB, 0.001);
  if (join.join === 'continuous' || join.join === 'butt' || join.join === 'endpoint') {
    if (overlap > 0.012 || hasInteriorIntersection(pathA, pathB, 0.001) || endpointOnInterior(pathA, pathB, 0.001)) return undefined;
    return sharedEndpointPoint(pathA, pathB, 0.001);
  }
  return undefined;
}

function runtimeGlassJoinAllowed(a: RuntimeSpatialObject, b: RuntimeSpatialObject, joins: RuntimeGlassJoinSpec[] = []): boolean {
  if (!a.elementId || !b.elementId || !a.pathSegments?.length || !b.pathSegments?.length) return false;
  const center = overlapCenter(a.box, b.box);
  for (const pathA of a.pathSegments) {
    for (const pathB of b.pathSegments) {
      if (glassPathIdentity(pathA) === glassPathIdentity(pathB)) continue;
      const declared = runtimeGlassJoinSpec(pathA, pathB, joins);
      const joint = declared
        ? runtimeGlassJoinPoint(pathA, pathB, declared)
        : a.elementId !== b.elementId
          ? sharedEndpointPoint(pathA, pathB, 0.001)
          : undefined;
      if (!joint || !pointInAabb(joint, a.box) || !pointInAabb(joint, b.box)) continue;
      if (Math.hypot(center.x - joint.x, center.z - joint.z) <= 0.06) return true;
    }
  }
  return false;
}

function furniturePathCrossingDepth(box: Aabb3, glassBox: Aabb3, paths: GlassPathSegment[]): number | undefined {
  let deepest: number | undefined;
  for (const path of paths) {
    if (box.maxY <= glassBox.minY + 1e-6 || box.minY >= glassBox.maxY - 1e-6) continue;
    const depth = segmentCrossingDepth(box, path, 1e-6);
    if (depth !== undefined && (deepest === undefined || depth > deepest)) deepest = depth;
  }
  return deepest;
}

function glassPathCollision(a: RuntimeSpatialObject, b: RuntimeSpatialObject, joins: RuntimeGlassJoinSpec[] = []): boolean {
  if (!a.pathSegments?.length || !b.pathSegments?.length) return false;
  for (const pathA of a.pathSegments) {
    for (const pathB of b.pathSegments) {
      // Several runtime meshes may be children of one structural part (for
      // example a railing handrail and its sampled mesh pieces). They share a
      // path identity and must not self-collide. Distinct path identities in
      // the same element remain fully checked below.
      if (glassPathIdentity(pathA) === glassPathIdentity(pathB)) continue;
      const sameLine = distancePointToLine(pathB.x1, pathB.z1, pathA) <= 0.001
        && distancePointToLine(pathB.x2, pathB.z2, pathA) <= 0.001;
      const overlap = sameLine ? collinearOverlapLength(pathA, pathB) : 0;
      const interior = hasInteriorIntersection(pathA, pathB, 0.001);
      const tee = endpointOnInterior(pathA, pathB, 0.001);
      const shared = sharedEndpointPoint(pathA, pathB, 0.001);
      const sameElementUnjoinedEndpoint = a.elementId === b.elementId && shared !== undefined;
      if (overlap <= 0.012 && !interior && !tee && !sameElementUnjoinedEndpoint) continue;
      if (runtimeGlassJoinAllowed(a, b, joins)) continue;
      // Exact shared endpoints are legal between distinct structural elements,
      // but a same-element corner/closure needs a concrete configured join.
      if (shared && a.elementId !== b.elementId && overlap <= 0.012 && !interior && !tee) continue;
      return true;
    }
  }
  return false;
}

/**
 * Pure runtime-scene collision/cardinality gate.  The CLI adapts Three.js
 * objects to this shape; tests can inject missing, extra, or unknown runtime
 * objects without constructing a renderer.
 */
export function validateRuntimeScene(input: RuntimeSceneValidationInput): SpatialIssue[] {
  const source = input.source ?? 'runtime-scene';
  const issues: SpatialIssue[] = [];
  const mep = new Set(input.mepTypes ?? []);
  const furniture = input.furniture.filter((item) => !mep.has(item.type));
  const walls = input.walls ?? [];
  const glass = input.glass ?? [];
  const ceilings = input.ceilings ?? [];
  const expected = input.expectedFurnitureIds ? new Set(input.expectedFurnitureIds) : undefined;
  if (expected) {
    const runtimeIds = new Set(input.furniture.map((item) => item.id));
    for (const id of expected) {
      if (!runtimeIds.has(id)) issues.push({ level: 'error', code: 'furniture_runtime_missing', entity: id, source, message: `placed furniture ${id} did not produce a runtime mesh`, evidence: { expected_id: id } });
    }
    for (const item of input.furniture) {
      if (!expected.has(item.id)) issues.push({ level: 'error', code: 'furniture_runtime_unknown', entity: item.id, source, message: `runtime furniture ${item.id} has no placed source instance`, evidence: { runtime_id: item.id } });
    }
  }
  if (input.expectedGlassElementIds) {
    const expectedGlass = new Set(input.expectedGlassElementIds);
    const runtimeGlassElements = new Set(glass.map((item) => item.elementId).filter((id): id is string => Boolean(id)));
    for (const elementId of expectedGlass) {
      if (!runtimeGlassElements.has(elementId)) issues.push({ level: 'error', code: 'glass_runtime_missing', entity: elementId, source, message: `structural glass/railing element ${elementId} did not produce a runtime mesh`, evidence: { expected_element: elementId } });
    }
    for (const elementId of runtimeGlassElements) {
      if (!expectedGlass.has(elementId)) issues.push({ level: 'error', code: 'glass_runtime_unknown', entity: elementId, source, message: `runtime glass/railing element ${elementId} has no structural overlay source`, evidence: { runtime_element: elementId } });
    }
  }

  for (const item of furniture) {
    for (const wall of walls) {
      if (item.box.maxY <= wall.box.minY + 1e-9 || item.box.minY >= wall.box.maxY - 1e-9) continue;
      // A wall face contact is not a crossing. When the runtime adapter has a
      // segment and measured thickness, use the finite solid slab first: a
      // body can enter one wall face without reaching the centreline and must
      // still fail closed. The centreline helper remains the fallback for
      // legacy injected walls that do not expose thickness.
      const solidDepth = wall.segment && wall.thickness !== undefined
        ? segmentSolidOverlapDepth(item.box, wall.segment, wall.thickness, 1e-6)
        : undefined;
      const centerlineDepth = wall.segment ? segmentCrossingDepth(item.box, wall.segment, 1e-6) : undefined;
      // The renderer's authored furniture/wall datum places wall-backed
      // envelopes against the source centreline, so a one-sided slab overlap
      // is a representation contact for that adapter. Injected runtime scenes
      // default to the stricter finite-solid policy and therefore catch a
      // shallow entry that never reaches the centreline.
      const depth = wall.wallContactPolicy === 'centerline'
        ? centerlineDepth
        : wall.segment && wall.thickness !== undefined
          ? solidDepth
          : centerlineDepth ?? aabbOverlapDepth(item.box, wall.box)?.x;
      if (depth !== undefined) {
        issues.push({ level: 'error', code: 'furniture_wall_collision', entity: `${item.id}↔${wall.id}`, source, message: `runtime furniture ${item.type} penetrates solid wall geometry`, evidence: { furniture: item.box, wall: wall.box, wall_entity: wall.id, wall_id: wall.wallId, penetration_m: depth, ...(solidDepth !== undefined ? { solid_overlap_m: solidDepth } : {}) } });
      }
    }
    for (const other of glass) {
      const pathDepth = other.pathSegments?.length ? furniturePathCrossingDepth(item.box, other.box, other.pathSegments) : undefined;
      const overlap = other.pathSegments?.length ? undefined : aabbOverlapDepth(item.box, other.box);
      if (pathDepth !== undefined || overlap) {
        issues.push({ level: 'error', code: 'furniture_glass_collision', entity: `${item.id}↔${other.id}`, source, message: `runtime furniture ${item.type} intersects curtain/glass/railing geometry`, evidence: { furniture: item.box, glass: other.box, glass_entity: other.id, ...(overlap ? { overlap_m: overlap } : { crossing_depth_m: pathDepth }) } });
      } else if (input.glassRequiredClearance !== undefined) {
        const gap = aabbGap(item.box, other.box);
        if (gap > 1e-9 && gap < input.glassRequiredClearance) issues.push({ level: 'warning', code: 'furniture_glass_clearance_insufficient', entity: `${item.id}↔${other.id}`, source, message: `runtime furniture ${item.type} is ${gap.toFixed(3)}m from glass; ${input.glassRequiredClearance.toFixed(3)}m is required`, evidence: { gap_m: gap, required_clearance_m: input.glassRequiredClearance, glass_entity: other.id } });
      }
    }
    for (const ceiling of ceilings) {
      // Box3 carries sub-micron transform noise at shared ceiling/furniture
      // faces.  A 10^-5m numerical epsilon removes contact duplicates while
      // leaving any meaningful vertical penetration as an error.
      if (aabbIntersects(item.box, ceiling.box, 1e-5)) issues.push({ level: 'error', code: 'furniture_ceiling_collision', entity: `${item.id}↔${ceiling.id}`, source, message: `runtime furniture ${item.type} intersects solid ceiling/drop geometry`, evidence: { furniture: item.box, ceiling: ceiling.box, ceiling_entity: ceiling.id } });
    }
  }

  const collisionMargin = input.collisionMargin ?? 0.005;
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      const a = furniture[i];
      const b = furniture[j];
      // Box3 transforms at shared room/wall boundaries carry tiny binary
      // drift; keep the deliberate 3mm contact visible while suppressing
      // sub-10µm cross-room face noise.
      const overlap = aabbOverlapDepth(a.box, b.box, 1e-5);
      if (!overlap || relationshipAllowsExact(a.id, b.id, input.relationships)) continue;
      const penetration = Math.min(overlap.x, overlap.y, overlap.z);
      const level = penetration <= collisionMargin ? 'warning' : 'error';
      issues.push({ level, code: level === 'error' ? 'furniture_furniture_collision' : 'furniture_furniture_contact_tolerance', entity: `${a.id}↔${b.id}`, source, message: `runtime furniture envelopes overlap by ${penetration.toFixed(3)}m`, evidence: { furnitureA: a.box, furnitureB: b.box, overlap_m: overlap, collision_margin_m: collisionMargin, ids: [a.id, b.id] } });
    }
  }

  const collisionGlass = glass.filter((item) => item.collisionRole !== 'internal');
  for (let i = 0; i < collisionGlass.length; i++) {
    for (let j = i + 1; j < collisionGlass.length; j++) {
      const a = collisionGlass[i];
      const b = collisionGlass[j];
      const overlap = aabbOverlapDepth(a.box, b.box, 1e-6);
      if (!overlap || (a.pathSegments?.length && b.pathSegments?.length && !glassPathCollision(a, b, input.glassJoins)) || runtimeGlassJoinAllowed(a, b, input.glassJoins)) continue;
      issues.push({ level: 'error', code: 'glass_runtime_collision', entity: `${a.id}↔${b.id}`, source, message: `runtime glass/railing meshes overlap without a shared-endpoint closure`, evidence: { glassA: a.box, glassB: b.box, overlap_m: overlap, elementA: a.elementId, elementB: b.elementId } });
    }
  }
  return issues;
}

export function makeSpatialReport(issues: SpatialIssue[]): { issues: SpatialIssue[]; errors: SpatialIssue[]; warnings: SpatialIssue[]; counts: { errors: number; warnings: number; info: number } } {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return { issues, errors, warnings, counts: { errors: errors.length, warnings: warnings.length, info: issues.length - errors.length - warnings.length } };
}
