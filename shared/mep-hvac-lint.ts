import type { CeilingZone, HvacAnchor, HvacTerminal, ResolvedLayout } from './types.js';
import {
  isMepPhysicalRoute,
  mepRoutePoints,
  resolveMepEndpoint,
  resolveMepRoutes,
  type MepCoordination,
  type MepEndpointSources,
  type MepRoute,
} from './mep-hvac-coordination-schema.js';

export type MepLintLevel = 'error' | 'warning';
export interface MepLintIssue {
  level: MepLintLevel;
  code: string;
  message: string;
  routeId?: string;
  relatedRouteId?: string;
}
export interface MepLintCounts { errors: number; warnings: number; routes: number; resolvedRoutes: number; }
export interface MepLintResult { errors: MepLintIssue[]; warnings: MepLintIssue[]; counts: MepLintCounts; }

export interface MepLintLayoutContext {
  layout?: ResolvedLayout;
  ceiling?: CeilingZone[];
  suppressedWallIds?: Set<string> | string[];
  referenceConstraints?: Array<{ id: string; range: { x1: number; x2: number; z1: number; z2: number }; reason?: string; status?: string; reference_beam_bottom_y?: number }>;
}

type Point = { x: number; y?: number; z: number };
type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

function issue(level: MepLintLevel, code: string, message: string, routeId?: string, relatedRouteId?: string): MepLintIssue {
  return { level, code, message, ...(routeId ? { routeId } : {}), ...(relatedRouteId ? { relatedRouteId } : {}) };
}
function add(result: MepLintResult, item: MepLintIssue): void { result[item.level === 'error' ? 'errors' : 'warnings'].push(item); }
function pointEqual(a: Point, b: Point): boolean { return a.x === b.x && a.z === b.z; }
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
  return ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) && ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0));
}
function routeBox(route: MepRoute, points: Point[]): Box | undefined {
  if (!points.length) return undefined;
  const heights = points.map((p) => p.y).filter((y): y is number => typeof y === 'number');
  if (heights.length !== points.length) return undefined;
  const isRectangular = route.width !== undefined || route.depth !== undefined || route.height !== undefined || route.method === 'rectangular';
  const halfX = isRectangular ? (route.width ?? 0) / 2 : (route.diameter ?? 0) / 2;
  const halfZ = isRectangular ? (route.depth ?? 0) / 2 : (route.diameter ?? 0) / 2;
  const halfY = isRectangular ? (route.height ?? 0) / 2 : (route.diameter ?? 0) / 2;
  if (halfX <= 0 || halfZ <= 0 || halfY <= 0) return undefined;
  return {
    minX: Math.min(...points.map((p) => p.x)) - halfX,
    maxX: Math.max(...points.map((p) => p.x)) + halfX,
    minY: Math.min(...heights) - halfY,
    maxY: Math.max(...heights) + halfY,
    minZ: Math.min(...points.map((p) => p.z)) - halfZ,
    maxZ: Math.max(...points.map((p) => p.z)) + halfZ,
  };
}

function airRouteBox(route: MepRoute, points: Point[]): { box?: Box; heightConfirmed: boolean } {
  if (!points.length || route.width === undefined || route.depth === undefined) return { heightConfirmed: false };
  const heights = points.map((p) => p.y).filter((y): y is number => typeof y === 'number');
  if (heights.length !== points.length) return { heightConfirmed: false };
  // Existing air-route data has no height. depth is only a provisional vertical
  // proxy here; it can produce a warning, but never supports a confirmed error.
  const halfX = route.width / 2;
  const halfZ = route.depth / 2;
  const halfY = (route.height ?? route.depth) / 2;
  return {
    heightConfirmed: route.height !== undefined,
    box: {
      minX: Math.min(...points.map((p) => p.x)) - halfX,
      maxX: Math.max(...points.map((p) => p.x)) + halfX,
      minY: Math.min(...heights) - halfY,
      maxY: Math.max(...heights) + halfY,
      minZ: Math.min(...points.map((p) => p.z)) - halfZ,
      maxZ: Math.max(...points.map((p) => p.z)) + halfZ,
    },
  };
}
function isPhysicalBoxRoute(route: MepRoute, points: Point[]): boolean {
  return isMepPhysicalRoute(route, points);
}
function sharesNormalConnection(a: MepRoute, b: MepRoute, aPoints: Point[], bPoints: Point[]): boolean {
  if (!isPhysicalBoxRoute(a, aPoints) || !isPhysicalBoxRoute(b, bPoints)) return true;
  if (a.layer !== b.layer) return false;
  return [a.from, a.to].some((endpoint) => typeof endpoint === 'string' && routeHasEndpoint(b, endpoint));
}
function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
function sourceIds(sources: MepEndpointSources): Set<string> {
  return new Set([...sources.electrical, ...sources.plumbing, ...sources.ceiling, ...sources.hvacAnchors, ...sources.hvacTerminals, ...sources.outdoor].map((x) => x.id));
}
function routeHasEndpoint(route: MepRoute, id: string): boolean { return route.from === id || route.to === id; }
function indoorAnchors(sources: MepEndpointSources): HvacAnchor[] { return sources.hvacAnchors.filter((a) => a.id.startsWith('indoor_')); }
function hvacPowerEndpointEquivalents(sources: MepEndpointSources): Map<string, string> {
  return new Map(
    sources.hvacAnchors
      .filter((anchor) => anchor.id.startsWith('power_') && anchor.ref?.source === 'electrical')
      .map((anchor) => [anchor.id, anchor.ref!.id]),
  );
}
function wallCrosses(points: Point[], wall: { x1: number; z1: number; x2: number; z2: number }): boolean {
  const wallStart = { x: wall.x1, z: wall.z1 };
  const wallEnd = { x: wall.x2, z: wall.z2 };
  for (let i = 1; i < points.length; i += 1) if (segmentsCross(points[i - 1], points[i], wallStart, wallEnd)) return true;
  return false;
}
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): { x: number; z: number } | undefined {
  const d1x = b.x - a.x, d1z = b.z - a.z, d2x = d.x - c.x, d2z = d.z - c.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return undefined;
  const t = ((c.x - a.x) * d2z - (c.z - a.z) * d2x) / denom;
  return { x: a.x + t * d1x, z: a.z + t * d1z };
}
function routeWallIntersection(points: Point[], wall: { x1: number; z1: number; x2: number; z2: number }): { x: number; z: number } | undefined {
  const wallStart = { x: wall.x1, z: wall.z1 };
  const wallEnd = { x: wall.x2, z: wall.z2 };
  for (let i = 1; i < points.length; i += 1) {
    if (segmentsCross(points[i - 1], points[i], wallStart, wallEnd)) return segmentIntersection(points[i - 1], points[i], wallStart, wallEnd);
  }
  return undefined;
}
interface PenetrationDecl { wall?: string; at?: { x: number; z: number } }
function penetrationsOf(route: MepRoute): PenetrationDecl[] {
  const raw = (route as MepRoute & { penetration?: unknown }).penetration;
  if (!Array.isArray(raw)) return [];
  const out: PenetrationDecl[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as { wall?: unknown; at?: unknown };
    const at = typeof e.at === 'object' && e.at !== null ? e.at as { x?: unknown; z?: unknown } : undefined;
    out.push({
      wall: typeof e.wall === 'string' ? e.wall : undefined,
      at: at && typeof at.x === 'number' && typeof at.z === 'number' ? { x: at.x, z: at.z } : undefined,
    });
  }
  return out;
}

export function lintMepCoordination(config: MepCoordination, sources: MepEndpointSources, context: MepLintLayoutContext = {}): MepLintResult {
  const result: MepLintResult = { errors: [], warnings: [], counts: { errors: 0, warnings: 0, routes: config.routes.length, resolvedRoutes: 0 } };
  const ids = sourceIds(sources);
  const resolved = resolveMepRoutes(config, sources);
  result.counts.resolvedRoutes = resolved.resolved;
  const boxes: Array<{ route: MepRoute; box?: Box; points: Point[]; airHeightConfirmed?: boolean }> = [];
  const ceiling = context.ceiling ?? sources.ceiling;
  const suppressed = new Set(context.suppressedWallIds ?? []);

  for (const item of resolved.routes) {
    const { route, from, to } = item;
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string' && !ids.has(endpoint)) add(result, issue('error', 'endpoint_unknown', `MEP route ${route.id} references unknown endpoint ${endpoint}`, route.id));
    }
    for (const side of item.unresolved) add(result, issue('error', 'endpoint_unresolved', `MEP route ${route.id} ${side} endpoint is unresolved`, route.id));
    const points = mepRoutePoints(route, from, to);
    const isRequirementLike = route.source_status === 'design_requirement' || route.route_kind === 'requirement' || route.route_kind === 'candidate';
    const coincidentEndpoints = Boolean(from && to && pointEqual(from, to));
    if (coincidentEndpoints) {
      add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', route.status === 'confirmed' ? 'confirmed_self_connection' : isRequirementLike ? 'degenerate_requirement' : 'nonphysical_route', `MEP route ${route.id} has coincident endpoints; it is not a physical route`, route.id));
    }
    const isDuct = route.layer === 'supply_air' || route.layer === 'return_air' || route.method === 'rectangular';
    if (route.diameter !== undefined && isDuct) add(result, issue('warning', 'diameter_not_for_duct', `MEP route ${route.id} uses diameter on rectangular/air route; use width/depth/height`, route.id));
    if (!isDuct && (route.width !== undefined || route.depth !== undefined || route.height !== undefined)) add(result, issue('warning', 'rectangular_size_not_for_round', `MEP route ${route.id} uses rectangular dimensions on a round route; use diameter`, route.id));
    if (isDuct && (route.width === undefined || route.depth === undefined || route.height === undefined)) add(result, issue('warning', 'duct_dimension_incomplete', `MEP route ${route.id} lacks complete width/depth/height`, route.id));
    if (!isDuct && route.diameter === undefined) add(result, issue('warning', 'round_dimension_missing', `MEP route ${route.id} lacks diameter`, route.id));
    const gravity = (route.layer === 'drainage' || route.layer === 'condensate') && route.method?.includes('gravity');
    if (gravity) {
      const explicitDirection = route.flow_direction;
      const slope = route.slope;
      if (!explicitDirection && slope === undefined) add(result, issue('warning', 'gravity_slope_pending', `Gravity route ${route.id} lacks explicit flow_direction or slope; elevation alone is not sufficient`, route.id));
      if (explicitDirection && route.from_height !== undefined && route.to_height !== undefined) {
        const lowToHigh = route.to_height > route.from_height;
        const down = /down|降|低|drain/i.test(explicitDirection);
        const up = /up|升|高/i.test(explicitDirection);
        if ((down && lowToHigh) || (up && !lowToHigh && route.to_height !== route.from_height)) add(result, issue('error', 'gravity_direction_height_conflict', `Gravity route ${route.id} explicit direction conflicts with heights`, route.id));
      }
    }
    if (route.source_status === 'design_requirement' && route.status === 'confirmed') add(result, issue('error', 'evidence_status_conflict', `Design requirement route ${route.id} cannot be confirmed`, route.id));
    if (route.status !== 'confirmed' && route.construction_status === 'confirmed') add(result, issue('error', 'construction_status_conflict', `Non-confirmed route ${route.id} cannot have confirmed construction status`, route.id));
    if (route.status === 'confirmed' && !route.reason) add(result, issue('warning', 'reason_missing', `Confirmed route ${route.id} lacks reason/evidence explanation`, route.id));
    if (isRequirementLike && !coincidentEndpoints && !isMepPhysicalRoute(route, points)) add(result, issue('warning', 'nonphysical_route', `Route ${route.id} is a requirement/candidate and is not treated as a physical route`, route.id));

    const layer = config.layers[route.layer];
    const air = route.layer === 'supply_air' || route.layer === 'return_air';
    const airEnvelope = air && isPhysicalBoxRoute(route, points) ? airRouteBox(route, points) : undefined;
    const box = layer && isPhysicalBoxRoute(route, points) ? (air ? airEnvelope?.box : routeBox(route, points)) : undefined;
    boxes.push({ route, box, points, airHeightConfirmed: airEnvelope?.heightConfirmed });
    if (context.layout && from && to) {
      const penetrations = penetrationsOf(route);
      for (const wall of context.layout.walls) {
        const crosses = wallCrosses(points, wall);
        if (!crosses) continue;
        if (suppressed.has(wall.id)) {
          add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', 'suppressed_wall_crossing', `Route ${route.id} enters suppressed/curtain wall ${wall.id}`, route.id));
          continue;
        }
        const declared = penetrations.find((p) => p.wall === wall.id);
        if (!declared) {
          add(result, issue(route.status === 'confirmed' ? 'error' : 'warning', 'penetration_missing', `Route ${route.id} crosses entity wall ${wall.id} without penetration information`, route.id));
        } else if (declared.at) {
          const hit = routeWallIntersection(points, wall);
          const deviation = hit ? Math.hypot(hit.x - declared.at.x, hit.z - declared.at.z) : 0;
          if (deviation > 0.25) add(result, issue('warning', 'penetration_point_mismatch', `Route ${route.id} declared penetration on ${wall.id} deviates ${deviation.toFixed(2)}m from the actual crossing point`, route.id));
        }
        if (wall.structure === 'shear') {
          const hard = wall.structure_status === 'confirmed' && route.status === 'confirmed';
          const suffix = wall.structure_status === 'confirmed' ? '' : ' (wall structure inferred from neighbor plan, pending survey confirmation)';
          add(result, issue(hard ? 'error' : 'warning', 'shear_wall_penetration', `Route ${route.id} penetrates shear wall ${wall.id}${suffix}; core drilling on shear walls requires confirmed structure data, sleeves and avoidance of rebar zones`, route.id));
        }
      }
    }
    if (ceiling.length) {
      for (const zone of ceiling) {
        if (!zone.area || zone.height === undefined) continue;
        const [x1, z1, x2, z2] = zone.area;
        const inside = points.some((p) => p.x >= Math.min(x1, x2) && p.x <= Math.max(x1, x2) && p.z >= Math.min(z1, z2) && p.z <= Math.max(z1, z2));
        const zoneHeight = zone.height;
        if (inside && points.some((p) => (p.y ?? layer?.height ?? 0) > zoneHeight)) add(result, issue('warning', 'ceiling_clearance_unverified', `Route ${route.id} enters ceiling zone ${zone.id} above its declared height`, route.id));
      }
    }
    // 梁碰撞：只有 status: confirmed 且带 reference_beam_bottom_y 的约束才构成硬碰撞（inferred/pending 仅走 reference_constraint_uncertain 提醒）
    if (isPhysicalBoxRoute(route, points)) {
      for (const ref of context.referenceConstraints ?? []) {
        if (ref.status !== 'confirmed' || ref.reference_beam_bottom_y === undefined) continue;
        const beamBottom = ref.reference_beam_bottom_y;
        const minX = Math.min(ref.range.x1, ref.range.x2), maxX = Math.max(ref.range.x1, ref.range.x2);
        const minZ = Math.min(ref.range.z1, ref.range.z2), maxZ = Math.max(ref.range.z1, ref.range.z2);
        const inRange = (p: Point) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
        const corners: Point[] = [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
        const hitsBeam = points.some((p, i) => {
          const height = p.y ?? layer?.height ?? 0;
          if (height <= beamBottom) return false;
          if (inRange(p)) return true;
          const next = points[i + 1];
          if (!next) return false;
          // 顶点都在约束带外时，线段仍可能横穿约束带（如直线穿梁）：检测与带边界的相交
          return corners.some((c, ci) => segmentsCross(p, next, c, corners[(ci + 1) % corners.length]));
        });
        if (hitsBeam) add(result, issue('error', 'beam_collision', `Route ${route.id} passes above confirmed beam bottom ${beamBottom}m within reference constraint ${ref.id}`, route.id));
      }
    }
  }

  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i], b = boxes[j];
    if (!a.box || !b.box || !boxesOverlap(a.box, b.box)) continue;
    if (sharesNormalConnection(a.route, b.route, a.points, b.points)) continue;
    const bothAir = (a.route.layer === 'supply_air' && b.route.layer === 'return_air') || (a.route.layer === 'return_air' && b.route.layer === 'supply_air');
    const sameIndoorAnchor = bothAir && typeof a.route.from === 'string' && a.route.from === b.route.from && a.route.from.startsWith('indoor_');
    if (sameIndoorAnchor) {
      const bothConfirmed = a.route.status === 'confirmed' && b.route.status === 'confirmed';
      const level = bothConfirmed && a.route.source_status !== 'design_requirement' && b.route.source_status !== 'design_requirement' && a.airHeightConfirmed && b.airHeightConfirmed ? 'error' : 'warning';
      add(result, issue(level, 'supply_return_overlap', `Supply/return air envelopes overlap at ${a.route.from}: ${a.route.id} / ${b.route.id}`, a.route.id, b.route.id));
      continue;
    }
    const bothConfirmed = a.route.status === 'confirmed' && b.route.status === 'confirmed';
    const complete = Boolean(a.box && b.box && a.points.every((p) => p.y !== undefined) && b.points.every((p) => p.y !== undefined));
    if (!bothConfirmed || !complete) continue;
    add(result, issue(a.route.source_status !== 'design_requirement' && b.route.source_status !== 'design_requirement' ? 'error' : 'warning', 'route_overlap', `MEP route envelopes overlap: ${a.route.id} / ${b.route.id}`, a.route.id, b.route.id));
  }

  for (const ref of context.referenceConstraints ?? []) {
    if (ref.status === 'confirmed') continue;
    add(result, issue('warning', 'reference_constraint_uncertain', `Reference constraint ${ref.id} is uncertain and not treated as confirmed collision: ${ref.reason ?? 'survey reference only'}`));
  }

  const required = ['refrigerant', 'supply_air', 'return_air', 'condensate', 'power'] as const;
  const powerEndpointEquivalents = hvacPowerEndpointEquivalents(sources);
  for (const anchor of indoorAnchors(sources)) {
    for (const system of required) {
      const layer = system === 'power' ? 'strong_power' : system;
      const powerId = `power_${anchor.id.slice('indoor_'.length)}`;
      const powerEndpoint = powerEndpointEquivalents.get(powerId);
      const present = config.routes.some((route) => (route.layer === layer && routeHasEndpoint(route, anchor.id)) || (
        system === 'power' && route.layer === 'strong_power' && (
          routeHasEndpoint(route, powerId) || (powerEndpoint !== undefined && routeHasEndpoint(route, powerEndpoint))
        )
      ));
      if (!present) add(result, issue('warning', 'hvac_coverage_missing', `HVAC coverage missing ${system} relation for ${anchor.id}`, anchor.id));
    }
  }
  result.counts.errors = result.errors.length;
  result.counts.warnings = result.warnings.length;
  return result;
}

export function lintLevel(result: MepLintResult): 'error' | 'warning' | 'ok' { return result.errors.length ? 'error' : result.warnings.length ? 'warning' : 'ok'; }
