import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { ElectricalPoint, HvacAnchor, HvacTerminal, PlumbingPoint, VrfOutdoorUnit } from './types.js';

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
  diameter: DimensionSchema.optional(), width: DimensionSchema.optional(), depth: DimensionSchema.optional(),
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
  hvacAnchors: HvacAnchor[];
  hvacTerminals: HvacTerminal[];
  outdoor: VrfOutdoorUnit[];
}

export function parseMepCoordination(raw: string): MepCoordination {
  return MepCoordinationSchema.parse(parseYaml(raw));
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
    }
    for (const [name, value] of [['diameter', route.diameter], ['width', route.width], ['depth', route.depth]] as const) {
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

export function resolveMepEndpoint(endpoint: string | { x: number; z: number }, sources: MepEndpointSources): { x: number; z: number } | undefined {
  if (typeof endpoint !== 'string') return endpoint;
  const electrical = sources.electrical.find((item) => item.id === endpoint);
  if (electrical) return { x: electrical.x, z: electrical.z };
  const plumbing = sources.plumbing.find((item) => item.id === endpoint);
  if (plumbing) return { x: plumbing.x, z: plumbing.z };
  const anchor = sources.hvacAnchors.find((item) => item.id === endpoint);
  if (anchor?.position) return { x: anchor.position.x, z: anchor.position.z };
  const terminal = sources.hvacTerminals.find((item) => item.id === endpoint);
  if (terminal) return { x: terminal.position.x, z: terminal.position.z };
  const outdoor = sources.outdoor.find((item) => item.id === endpoint);
  if (outdoor) return { x: outdoor.x, z: outdoor.z };
  return undefined;
}

export function endpointSourcesFromFacts(facts: {
  electrical: ElectricalPoint[]; plumbing: PlumbingPoint[];
  hvac: { plans: Array<{ outdoor: VrfOutdoorUnit; diagram: { anchors: HvacAnchor[]; terminals: HvacTerminal[] } }> };
}): MepEndpointSources {
  const plan = facts.hvac.plans[0];
  return { electrical: facts.electrical, plumbing: facts.plumbing, hvacAnchors: plan?.diagram.anchors ?? [], hvacTerminals: plan?.diagram.terminals ?? [], outdoor: plan ? [plan.outdoor] : [] };
}
