import {
  aabbGap,
  aabbIntersects,
  aabbOverlapDepth,
  collinearOverlapLength,
  distancePointToLine,
  endpointOnInterior,
  hasInteriorIntersection,
  segmentCrossingDepth,
  segmentLength,
  segmentSolidOverlapDepth,
  sharedEndpointPoint,
  glassPathIdentity,
  type Aabb3,
  type GlassPathSegment,
  type PlanSegment,
  type RelationshipSpec,
  type RuntimeGlassJoinSpec,
  type RuntimeSpatialObject,
  type SpatialIssue,
} from '../spatial-validation.js';

/**
 * 穿透（防穿模）规则层：两块实体是否占了同一块空间。
 *
 * 本文件只做「实体互撞 + 净距」，不做声明完整性、拓扑与运行时权威性
 * （那些留在 `shared/spatial-validation.ts` 的 `validateRuntimeAuthority`）。
 * 两个 CLI（`verify:spatial` / `verify:penetration`）共用这里的同一份实现，
 * 因此并联期的 parity 由构造成立，不依赖两边各自算一遍。
 *
 * 代码自 `shared/spatial-validation.ts` 的 `validateRuntimeScene` 机械搬迁而来，
 * 只改位置与 import，不改判定逻辑与容差。
 */

export interface RuntimePenetrationInput {
  furniture: RuntimeSpatialObject[];
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

/** 精确配对豁免：只有声明绑定的这一对（顺序无关）才放行，禁止按类型全局放行。 */
export function relationshipExemptsPair(idA: string, idB: string, relationships: RelationshipSpec[] = []): boolean {
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
 * Pure pairwise penetration gate: does any two solids share the same space.
 *
 * The CLI adapts Three.js objects to this shape; tests can inject synthetic
 * scenes without constructing a renderer. Authority/cardinality checks live in
 * `validateRuntimeAuthority` so a penetration report never mixes "the renderer
 * did not build what was declared" with "two bodies occupy one space".
 */
export function validateRuntimePenetration(input: RuntimePenetrationInput): SpatialIssue[] {
  const source = input.source ?? 'runtime-scene';
  const issues: SpatialIssue[] = [];
  const mep = new Set(input.mepTypes ?? []);
  const furniture = input.furniture.filter((item) => !mep.has(item.type));
  const walls = input.walls ?? [];
  const glass = input.glass ?? [];
  const ceilings = input.ceilings ?? [];

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
      if (!overlap || relationshipExemptsPair(a.id, b.id, input.relationships)) continue;
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
