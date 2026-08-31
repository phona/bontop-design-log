import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { CeilingZone, ElectricalPoint, HvacAnchor, HvacTerminal, PlumbingPoint, VrfOutdoorUnit } from './types.js';

export const MepLayerSchema = z.enum([
  'strong_power', 'weak_power', 'water_supply', 'drainage', 'refrigerant',
  'condensate', 'supply_air', 'return_air',
]);
export type MepLayer = z.infer<typeof MepLayerSchema>;
export const MepStatusSchema = z.enum(['confirmed', 'inferred', 'pending']);
export type MepStatus = z.infer<typeof MepStatusSchema>;
/** Evidence level for a proposal route. Legacy routes may omit it and default to preliminary. */
export const MepSourceStatusSchema = z.enum([
  'plan_supported', 'design_requirement', 'preliminary', 'proposed', 'inferred', 'pending',
]);
export type MepSourceStatus = z.infer<typeof MepSourceStatusSchema>;
const CoordinateSchema = z.object({
  x: z.number().finite(), z: z.number().finite(), y: z.number().finite().optional(),
  source_status: MepSourceStatusSchema.optional(), construction_status: MepStatusSchema.optional(),
}).strict();
const EndpointSchema = z.union([z.string().min(1), CoordinateSchema]);
const DimensionSchema = z.number().finite().positive();
export const MepRouteSchema = z.object({
  id: z.string().min(1), layer: MepLayerSchema, status: MepStatusSchema,
  source_status: MepSourceStatusSchema.default('preliminary'),
  construction_status: MepStatusSchema.default('pending'),
  method: z.string().min(1).optional(),
  route_kind: z.enum(['physical', 'requirement', 'candidate']).optional(),
  flow_direction: z.string().min(1).optional(), slope: z.number().finite().optional(), penetration: z.unknown().optional(),
  diameter: DimensionSchema.optional(), width: DimensionSchema.optional(), depth: DimensionSchema.optional(), height: DimensionSchema.optional(),
  from_height: z.number().finite().optional(), to_height: z.number().finite().optional(),
  from: EndpointSchema, to: EndpointSchema, via: z.array(CoordinateSchema).default([]),
  label: z.string().min(1).optional(), reason: z.string().min(1).optional(),
}).strict();
export const MepCoordinationSchema = z.object({
  version: z.string(), status: z.string(), note: z.string().optional(),
  layers: z.record(MepLayerSchema, z.object({ label: z.string(), color: z.string(), height: z.number().finite() }).strict()),
  routes: z.array(MepRouteSchema),
}).strict();
export type MepRoute = z.infer<typeof MepRouteSchema>;
export type MepCoordination = z.infer<typeof MepCoordinationSchema>;

export interface MepEndpointSources {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  ceiling: CeilingZone[];
  hvacAnchors: HvacAnchor[];
  hvacTerminals: HvacTerminal[];
  outdoor: VrfOutdoorUnit[];
}

export interface MepRouteSemanticMetadata {
  physicalRoute: boolean;
  routeKind?: 'physical' | 'requirement' | 'candidate';
  warning?: string;
  pendingReview?: boolean;
}

export interface ResolvedMepRoute {
  route: MepRoute;
  from?: { x: number; z: number; y?: number };
  to?: { x: number; z: number; y?: number };
  unresolved: Array<'from' | 'to'>;
  metadata: MepRouteSemanticMetadata;
}

export interface MepRouteResolutionReport {
  total: number;
  resolved: number;
  unresolved: number;
  routes: ResolvedMepRoute[];
}

export function parseMepCoordination(raw: string): MepCoordination {
  return MepCoordinationSchema.parse(parseYaml(raw));
}

function samePlanPoint(a?: { x: number; z: number }, b?: { x: number; z: number }): boolean {
  return Boolean(a && b && a.x === b.x && a.z === b.z);
}

export function mepRoutePoints(route: MepRoute, from?: { x: number; z: number; y?: number }, to?: { x: number; z: number; y?: number }): Array<{ x: number; y?: number; z: number }> {
  return [
    ...(from ? [{ ...from, y: route.from_height ?? from.y }] : []),
    ...route.via,
    ...(to ? [{ ...to, y: route.to_height ?? to.y }] : []),
  ];
}

export function isMepPhysicalRoute(route: MepRoute, points: Array<{ x: number; y?: number; z: number }>): boolean {
  if (route.route_kind === 'requirement' || route.route_kind === 'candidate') return false;
  if (route.source_status === 'design_requirement') return false;
  if (route.route_kind !== 'physical' && points.length >= 2 && samePlanPoint(points[0], points[points.length - 1])) return false;
  return points.some((point, index) => index > 0 && (point.x !== points[index - 1].x || point.z !== points[index - 1].z));
}

function routeMetadata(route: MepRoute, from?: { x: number; z: number }, to?: { x: number; z: number }): MepRouteSemanticMetadata {
  const points = mepRoutePoints(route, from, to);
  const isGravityDrain = (route.layer === 'condensate' || route.layer === 'drainage') && route.method?.includes('gravity');
  const warning = isGravityDrain
    ? (route.layer === 'condensate' ? '重力冷凝水候选路线：坡度、存水弯、立管接点和检修条件待确认；非施工依据。' : '重力排水候选路线：坡度、立管接点和检修条件待确认；非施工依据。')
    : undefined;
  const routeKind = route.route_kind ?? (route.source_status === 'design_requirement' ? 'requirement' : undefined);
  return {
    physicalRoute: isMepPhysicalRoute(route, points),
    routeKind,
    warning,
    pendingReview: isGravityDrain || route.construction_status === 'pending',
  };
}

export function resolveMepRoutes(config: MepCoordination, sources: MepEndpointSources): MepRouteResolutionReport {
  const routes = config.routes.map((route) => {
    const from = resolveMepEndpoint(route.from, sources);
    const to = resolveMepEndpoint(route.to, sources);
    return {
      route, from, to,
      unresolved: [from ? undefined : 'from', to ? undefined : 'to'].filter((value): value is 'from' | 'to' => value !== undefined),
      metadata: routeMetadata(route, from, to),
    };
  });
  return { total: routes.length, resolved: routes.filter((item) => item.unresolved.length === 0).length, unresolved: routes.filter((item) => item.unresolved.length > 0).length, routes };
}

export function validateMepCoordination(config: MepCoordination, sources: MepEndpointSources): void {
  const ids = new Set<string>();
  const plumbingIds = new Set(sources.plumbing.map((item) => item.id));
  for (const item of [...sources.electrical, ...sources.plumbing, ...sources.hvacAnchors, ...sources.hvacTerminals, ...sources.outdoor]) ids.add(item.id);
  const routeIds = new Set<string>();
  for (const route of config.routes) {
    if (routeIds.has(route.id)) throw new Error(`Duplicate MEP route id: ${route.id}`);
    routeIds.add(route.id);
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string' && !ids.has(endpoint)) throw new Error(`MEP route ${route.id} references unknown endpoint: ${endpoint}`);
      if (typeof endpoint === 'string' && !resolveMepEndpoint(endpoint, sources)) throw new Error(`MEP route ${route.id} endpoint is unresolved: ${endpoint} (missing position or resolvable ref)`);
    }
    const from = resolveMepEndpoint(route.from, sources);
    const to = resolveMepEndpoint(route.to, sources);
    if (from && to && samePlanPoint(from, to) && route.status === 'confirmed') {
      throw new Error(`MEP route ${route.id} is a degenerate self-connection and cannot be a confirmed physical route`);
    }
    for (const [name, value] of [['diameter', route.diameter], ['width', route.width], ['depth', route.depth], ['height', route.height]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`MEP route ${route.id} ${name} must be positive`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && route.construction_status !== 'pending') {
      throw new Error(`Plumbing route ${route.id} must remain construction_status: pending`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && !['plan_supported', 'design_requirement'].includes(route.source_status)) {
      throw new Error(`Plumbing route ${route.id} requires plan_supported or design_requirement evidence`);
    }
    if (route.source_status === 'design_requirement' && route.status === 'confirmed') {
      throw new Error(`Design requirement route ${route.id} cannot be confirmed`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && route.source_status === 'design_requirement') {
      for (const endpoint of [route.from, route.to]) {
        if (typeof endpoint === 'string' && plumbingIds.has(endpoint)) {
          throw new Error(`Design requirement plumbing route ${route.id} must not imply an authoritative plumbing endpoint: ${endpoint}`);
        }
      }
    }
  }
}

export function resolveMepEndpoint(endpoint: string | { x: number; z: number; y?: number }, sources: MepEndpointSources): { x: number; z: number; y?: number } | undefined {
  if (typeof endpoint !== 'string') return endpoint;
  const electrical = sources.electrical.find((item) => item.id === endpoint);
  if (electrical) return { x: electrical.x, z: electrical.z, y: electrical.height ?? electrical.mount_height };
  const plumbing = sources.plumbing.find((item) => item.id === endpoint);
  if (plumbing) return { x: plumbing.x, z: plumbing.z, y: plumbing.height };
  const anchor = sources.hvacAnchors.find((item) => item.id === endpoint);
  if (anchor) {
    if (anchor.position) return { x: anchor.position.x, z: anchor.position.z };
    if (anchor.ref) {
      const refSources = anchor.ref.source === 'ceiling'
        ? sources.ceiling
        : anchor.ref.source === 'electrical'
          ? sources.electrical
          : sources.outdoor;
      const source = refSources.find((item) => item.id === anchor.ref!.id);
      if (source && typeof source.x === 'number' && typeof source.z === 'number') return { x: source.x, z: source.z };
      return resolveMepEndpoint(anchor.ref.id, sources);
    }
  }
  const terminal = sources.hvacTerminals.find((item) => item.id === endpoint);
  if (terminal) return { x: terminal.position.x, z: terminal.position.z };
  const outdoor = sources.outdoor.find((item) => item.id === endpoint);
  if (outdoor) return { x: outdoor.x, z: outdoor.z };
  return undefined;
}

export function endpointSourcesFromFacts(facts: {
  electrical: ElectricalPoint[]; plumbing: PlumbingPoint[]; ceiling: CeilingZone[];
  hvac: { plans: Array<{ outdoor: VrfOutdoorUnit; diagram: { anchors: HvacAnchor[]; terminals: HvacTerminal[] } }> };
}): MepEndpointSources {
  const plan = facts.hvac.plans[0];
  return {
    electrical: facts.electrical,
    plumbing: facts.plumbing,
    ceiling: facts.ceiling,
    hvacAnchors: plan?.diagram.anchors ?? [],
    hvacTerminals: plan?.diagram.terminals ?? [],
    outdoor: plan ? [plan.outdoor] : [],
  };
}
