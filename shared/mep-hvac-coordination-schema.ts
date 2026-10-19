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
const JunctionPositionSchema = z.object({ x: z.number().finite(), z: z.number().finite(), y: z.number().finite() }).strict();
export const MepJunctionSchema = z.object({
  id: z.string().min(1),
  layer: z.literal('condensate'),
  kind: z.literal('merge'),
  position: JunctionPositionSchema,
  inlet_routes: z.array(z.string().min(1)).min(2),
  outlet_route: z.string().min(1),
  fitting: z.literal('wye'),
  /** Maximum centerline distance from the node allowed inside the physical fitting envelope. */
  fitting_overlap_m: z.number().finite().positive().max(0.1),
  reason: z.string().min(1),
}).strict();
export const MepRouteSchema = z.object({
  id: z.string().min(1), layer: MepLayerSchema, status: MepStatusSchema,
  source_status: MepSourceStatusSchema.default('preliminary'),
  construction_status: MepStatusSchema.default('pending'),
  method: z.string().min(1).optional(),
  route_kind: z.enum(['physical', 'requirement', 'candidate']).optional(),
  // DEC-2026-10-17-R16 legacy 共槽声明：列出共享干管段 route id；重叠仍以 warning 显形。
  // condensate 合流必须使用下方 junctions 的节点、入口、出口与局部接头包络，不靠此 route-id 声明放行。
  shared_trunk_with: z.array(z.string().min(1)).optional(),
  // DEC-2026-10-17-R17 台体穿越声明：端点/目标位于 bay_sill 覆盖区内时，管线以套管形式
  // 穿越建模实心台体（模型无台体开洞概念）。列出穿越的 bay_sill id，lint 跳过该对碰撞。
  sill_crossings: z.array(z.string().min(1)).optional(),
  flow_direction: z.string().min(1).optional(), slope: z.number().finite().optional(), penetration: z.unknown().optional(),
  served_indoor: z.string().min(1).optional(),
  diameter: DimensionSchema.optional(), width: DimensionSchema.optional(), depth: DimensionSchema.optional(), height: DimensionSchema.optional(),
  insulation_thickness: z.number().finite().nonnegative().optional(),
  insulation_status: z.enum(['assumed', 'confirmed']).optional(),
  from_height: z.number().finite().optional(), to_height: z.number().finite().optional(),
  from: EndpointSchema, to: EndpointSchema, via: z.array(CoordinateSchema).default([]),
  label: z.string().min(1).optional(), reason: z.string().min(1).optional(),
}).strict();
export const MepCoordinationSchema = z.object({
  version: z.string(), status: z.string(), note: z.string().optional(),
  // Zod 4 enum-key records are exhaustive: every route layer needs render metadata,
  // so a missing layer fails at load time instead of crashing the renderer later.
  layers: z.record(MepLayerSchema, z.object({ label: z.string(), color: z.string(), height: z.number().finite() }).strict()),
  routes: z.array(MepRouteSchema),
  junctions: z.array(MepJunctionSchema).default([]),
}).strict();
export type MepRoute = z.infer<typeof MepRouteSchema>;
export type MepJunction = z.infer<typeof MepJunctionSchema>;
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
  const hasPlanMovement = points.some((point, index) => index > 0 && (point.x !== points[index - 1].x || point.z !== points[index - 1].z));
  if (hasPlanMovement) return true;
  // 纯竖直段（首末平面点重合，仅高度不同）：同墙不同安装高度的点位（如电视墙 0.30/1.70/2.00m）
  // 是真实管段。只有**显式声明 route_kind: physical** 才算物理路由——由声明者断言"这是真实管段"，
  // 不由算法猜；零长度（连高度都相同）仍不算。
  return route.route_kind === 'physical'
    && points.some((point, index) => index > 0 && (point.y ?? 0) !== (points[index - 1].y ?? 0));
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
    const from = resolveMepEndpoint(route.from, sources, config.junctions);
    const to = resolveMepEndpoint(route.to, sources, config.junctions);
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
  const sourceKinds = new Map<string, string>();
  const plumbingIds = new Set(sources.plumbing.map((item) => item.id));
  const indoorAnchorIds = new Set(sources.hvacAnchors.filter((item) => item.id.startsWith('indoor_')).map((item) => item.id));
  const registerSources = (kind: string, items: Array<{ id: string }>): void => {
    for (const item of items) {
      const previous = sourceKinds.get(item.id);
      if (previous) throw new Error(`Duplicate MEP endpoint id ${item.id} (${previous} and ${kind})`);
      sourceKinds.set(item.id, kind);
      ids.add(item.id);
    }
  };
  registerSources('electrical', sources.electrical);
  registerSources('plumbing', sources.plumbing);
  registerSources('hvac anchor', sources.hvacAnchors);
  registerSources('hvac terminal', sources.hvacTerminals);
  registerSources('VRF outdoor', sources.outdoor);
  const junctionIds = new Set(config.junctions.map((junction) => junction.id));
  if (junctionIds.size !== config.junctions.length) throw new Error('Duplicate MEP junction id');
  const routeIds = new Set<string>();
  for (const route of config.routes) {
    if (routeIds.has(route.id)) throw new Error(`Duplicate MEP route id: ${route.id}`);
    routeIds.add(route.id);
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string' && !ids.has(endpoint) && !junctionIds.has(endpoint)) throw new Error(`MEP route ${route.id} references unknown endpoint: ${endpoint}`);
      if (typeof endpoint === 'string' && !resolveMepEndpoint(endpoint, sources, config.junctions)) throw new Error(`MEP route ${route.id} endpoint is unresolved: ${endpoint} (missing position or resolvable ref)`);
    }
    const from = resolveMepEndpoint(route.from, sources, config.junctions);
    const to = resolveMepEndpoint(route.to, sources, config.junctions);
    const requirementRoute = route.route_kind === 'requirement' || route.source_status === 'design_requirement';
    const candidateRoute = route.route_kind === 'candidate';
    if (from && to && samePlanPoint(from, to) && route.status === 'confirmed') {
      throw new Error(`MEP route ${route.id} is a degenerate self-connection and cannot be a confirmed physical route`);
    }
    if ((requirementRoute || candidateRoute) && route.status === 'confirmed') {
      throw new Error(`MEP route ${route.id} is marked ${requirementRoute ? 'requirement' : 'candidate'} and cannot be confirmed`);
    }
    for (const [name, value] of [['diameter', route.diameter], ['width', route.width], ['depth', route.depth], ['height', route.height]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`MEP route ${route.id} ${name} must be positive`);
    }
    if (route.insulation_status !== undefined && route.insulation_thickness === undefined) {
      throw new Error(`MEP route ${route.id} insulation_status requires insulation_thickness`);
    }
    if (route.served_indoor !== undefined) {
      if (route.layer !== 'condensate') throw new Error(`MEP route ${route.id} served_indoor is only valid for condensate routes`);
      if (!indoorAnchorIds.has(route.served_indoor)) throw new Error(`MEP route ${route.id} references unknown indoor anchor: ${route.served_indoor}`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && route.construction_status !== 'pending') {
      throw new Error(`Plumbing route ${route.id} must remain construction_status: pending`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && !['plan_supported', 'design_requirement'].includes(route.source_status)) {
      throw new Error(`Plumbing route ${route.id} requires plan_supported or design_requirement evidence`);
    }
    if ((route.layer === 'water_supply' || route.layer === 'drainage') && requirementRoute) {
      for (const endpoint of [route.from, route.to]) {
        if (typeof endpoint === 'string' && plumbingIds.has(endpoint)) {
          throw new Error(`Requirement plumbing route ${route.id} must not imply an authoritative plumbing endpoint: ${endpoint}`);
        }
      }
    }
  }

  const routesById = new Map(config.routes.map((route) => [route.id, route]));
  for (const junction of config.junctions) {
    if (routeIds.has(junction.id)) throw new Error(`MEP junction id collides with route id: ${junction.id}`);
    const sourceKind = sourceKinds.get(junction.id);
    if (sourceKind && sourceKind !== 'hvac anchor') {
      throw new Error(`MEP junction ${junction.id} collides with ${sourceKind} endpoint`);
    }
    // The render-facts anchor is the cross-file 2D reference for diagrams and
    // operations; it must describe the same 3D node as the MEP topology.
    const anchorPosition = sourceKind === 'hvac anchor' ? resolveMepEndpoint(junction.id, sources) : undefined;
    if (anchorPosition && Math.hypot(
      anchorPosition.x - junction.position.x,
      anchorPosition.z - junction.position.z,
      (anchorPosition.y ?? junction.position.y) - junction.position.y,
    ) > 1e-6) {
      throw new Error(`MEP junction ${junction.id} position does not match its HVAC anchor`);
    }
    const inlets = junction.inlet_routes.map((id) => routesById.get(id));
    const outlet = routesById.get(junction.outlet_route);
    if (inlets.some((route) => !route) || !outlet) throw new Error(`MEP junction ${junction.id} references an unknown route`);
    if (new Set(junction.inlet_routes).size !== junction.inlet_routes.length || junction.inlet_routes.includes(junction.outlet_route)) {
      throw new Error(`MEP junction ${junction.id} has duplicate inlet/outlet route references`);
    }
    for (const route of inlets) {
      if (route!.layer !== junction.layer || route!.to !== junction.id) throw new Error(`MEP junction ${junction.id} inlet ${route!.id} must end at the junction on ${junction.layer}`);
      const endpoint = resolveMepEndpoint(route!.to, sources, config.junctions)!;
      const y = route!.to_height ?? endpoint.y;
      if (Math.hypot(endpoint.x - junction.position.x, endpoint.z - junction.position.z, (y ?? 0) - junction.position.y) > 1e-6) {
        throw new Error(`MEP junction ${junction.id} inlet ${route!.id} geometry does not meet the declared position`);
      }
    }
    if (outlet!.layer !== junction.layer || outlet!.from !== junction.id) throw new Error(`MEP junction ${junction.id} outlet ${outlet!.id} must start at the junction on ${junction.layer}`);
    const outletEndpoint = resolveMepEndpoint(outlet!.from, sources, config.junctions)!;
    const outletY = outlet!.from_height ?? outletEndpoint.y;
    if (Math.hypot(outletEndpoint.x - junction.position.x, outletEndpoint.z - junction.position.z, (outletY ?? 0) - junction.position.y) > 1e-6) {
      throw new Error(`MEP junction ${junction.id} outlet ${outlet!.id} geometry does not meet the declared position`);
    }
    const declaredConnections = new Set([...junction.inlet_routes, junction.outlet_route]);
    for (const route of config.routes) {
      if ((route.from === junction.id || route.to === junction.id) && !declaredConnections.has(route.id)) {
        throw new Error(`MEP route ${route.id} attaches to undeclared junction ${junction.id}`);
      }
    }
  }
}

export function resolveMepEndpoint(endpoint: string | { x: number; z: number; y?: number }, sources: MepEndpointSources, junctions: MepJunction[] = []): { x: number; z: number; y?: number } | undefined {
  if (typeof endpoint !== 'string') return endpoint;
  const junction = junctions.find((item) => item.id === endpoint);
  if (junction) return junction.position;
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
