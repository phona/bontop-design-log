import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import {
  VALID_CEILING_TYPES,
  type CeilingZone,
  type ElectricalPoint,
  type PlumbingPoint,
  type ProjectHvacFacts,
  type ProjectRenderFacts,
  type ProjectRenderFactsProjection,
  type RenderLightingOverride,
} from './types.js';

const finiteNumber = z.number().refine(Number.isFinite, 'must be finite');
const nonEmpty = z.string().trim().min(1);
const Vec3Schema = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }).strict();

export const ElectricalPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['socket', 'switch', 'switch_2way', 'network', 'usb', 'floor_socket', 'ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip']),
  x: finiteNumber, z: finiteNumber, wall: z.string().optional(), temp: finiteNumber.optional(), count: finiteNumber.optional(), note: z.string().optional(), height: finiteNumber.optional(),
}).strict();
export const PlumbingPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['faucet', 'toilet', 'shower', 'drain', 'washer', 'faucet_outdoor']),
  x: finiteNumber, z: finiteNumber, wall: z.string().optional(), note: z.string().optional(), height: finiteNumber.optional(),
}).strict();
export const CeilingZoneSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(VALID_CEILING_TYPES), thickness: finiteNumber.optional(),
  area: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]).optional(), x: finiteNumber.optional(), z: finiteNumber.optional(), height: finiteNumber.optional(), model: z.string().optional(), power_point: z.string().optional(), note: z.string().optional(),
}).strict();

export const VrfOutdoorUnitSchema = z.object({
  id: nonEmpty, platform: nonEmpty, x: finiteNumber, z: finiteNumber, direction: nonEmpty, width: finiteNumber, depth: finiteNumber, height: finiteNumber, model: nonEmpty, note: z.string().optional(),
}).strict();
const HvacStatusSchema = z.enum(['confirmed', 'inferred', 'pending']);
const HvacSystemSchema = z.enum(['refrigerant', 'power', 'condensate', 'supply_air', 'return_air', 'access']);
const reasonForUnconfirmed = <T extends z.ZodType<{ status: string; reason?: string }>>(schema: T) => schema.superRefine((value, ctx) => {
  if (value.status !== 'confirmed' && !value.reason?.trim()) ctx.addIssue({ code: 'custom', message: `${value.status} HVAC facts require reason`, path: ['reason'] });
});
export const HvacAnchorSchema = reasonForUnconfirmed(z.object({
  id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema,
  ref: z.object({ source: z.enum(['outdoor', 'ceiling', 'electrical']), id: nonEmpty }).strict().optional(),
  position: Vec3Schema.optional(), reason: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.ref) === Boolean(value.position)) ctx.addIssue({ code: 'custom', message: 'HVAC anchor requires exactly one of ref or position' });
}));
export const HvacTerminalSchema = reasonForUnconfirmed(z.object({ id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema, position: Vec3Schema, reason: z.string().optional() }).strict());
export const HvacReferenceConstraintSchema = z.object({
  id: nonEmpty,
  status: z.enum(['inferred', 'pending']),
  source: z.literal('survey/neighbor_ys01_original_structure_2025-06.png'),
  uncertainty_m: z.literal(0.15),
  not_for_construction: z.literal(true),
  range: z.object({ x1: finiteNumber, x2: finiteNumber, z1: finiteNumber, z2: finiteNumber }).strict().superRefine((value, ctx) => {
    if (value.x1 >= value.x2) ctx.addIssue({ code: 'custom', message: 'reference constraint range x1 must be less than x2', path: ['x1'] });
    if (value.z1 >= value.z2) ctx.addIssue({ code: 'custom', message: 'reference constraint range z1 must be less than z2', path: ['z1'] });
  }),
  reference_bottom_drop_m: finiteNumber.nonnegative().optional(),
  reference_beam_bottom_y: finiteNumber.positive().optional(),
  risk: nonEmpty,
  reason: nonEmpty,
  survey_confirmation: nonEmpty,
}).strict().superRefine((value, ctx) => {
  if (value.reference_bottom_drop_m === undefined && value.reference_beam_bottom_y === undefined) {
    ctx.addIssue({ code: 'custom', message: 'reference constraint requires bottom drop or beam bottom reference' });
  }
});
export const HvacRouteSchema = reasonForUnconfirmed(z.object({ id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema, from: nonEmpty, to: nonEmpty, via: z.array(nonEmpty).optional(), constraint_refs: z.array(nonEmpty).optional(), reason: z.string().optional() }).strict());
export const HvacDiagramSchema = z.object({ anchors: z.array(HvacAnchorSchema), terminals: z.array(HvacTerminalSchema), routes: z.array(HvacRouteSchema), reference_constraints: z.array(HvacReferenceConstraintSchema) }).strict();
export const ProjectHvacFactsSchema = z.object({ plans: z.array(z.object({ id: nonEmpty, kind: z.literal('vrf_ducted'), outdoor: VrfOutdoorUnitSchema, diagram: HvacDiagramSchema }).strict()) }).strict();

export const ElectricalPointsSchema = z.array(ElectricalPointSchema);
export const PlumbingPointsSchema = z.array(PlumbingPointSchema);
export const CeilingZonesSchema = z.array(CeilingZoneSchema);
export const ProjectRenderFactsSchema = z.object({ electrical: ElectricalPointsSchema, plumbing: PlumbingPointsSchema, ceiling: CeilingZonesSchema, hvac: ProjectHvacFactsSchema }).strict();
export const RenderLightingOverrideSchema = z.object({ id: z.string(), anchorY: finiteNumber, offsetX: finiteNumber.optional(), offsetZ: finiteNumber.optional(), reason: nonEmpty, applies_to: z.tuple([z.literal('web'), z.literal('blender')]) }).strict();
export const RenderLightingOverridesSchema = z.array(RenderLightingOverrideSchema);
const HvacProjectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('implemented'), planId: z.literal('A2'), diagram: HvacDiagramSchema }).strict(),
  z.object({ status: z.literal('unimplemented'), planId: z.string().nullable() }).strict(),
]);
export const ProjectRenderFactsProjectionSchema = z.object({
  version: z.string(), lightingFixtures: z.array(z.object({ id: z.string(), room: z.string(), type: ElectricalPointSchema.shape.type, position: Vec3Schema, temperatureK: finiteNumber, enabled: z.boolean() }).strict()),
  plumbing: PlumbingPointsSchema, ceiling: CeilingZonesSchema, hvac: HvacProjectionSchema,
  materials: z.object({ floor: z.object({ default: z.string().nullable(), roomOverrides: z.record(z.string(), z.string()) }).strict() }).strict(),
}).strict();

export function validateProjectHvacFacts(hvac: ProjectHvacFacts, facts: Pick<ProjectRenderFacts, 'electrical' | 'ceiling'>): ProjectHvacFacts {
  const planIds = new Set<string>();
  for (const plan of hvac.plans) {
    if (planIds.has(plan.id)) throw new Error(`Duplicate HVAC plan id: ${plan.id}`);
    planIds.add(plan.id);
    const ids = new Set<string>();
    for (const item of [...plan.diagram.anchors, ...plan.diagram.terminals]) {
      if (ids.has(item.id)) throw new Error(`Duplicate HVAC diagram id: ${item.id}`);
      ids.add(item.id);
    }
    const constraintIds = new Set<string>();
    for (const constraint of plan.diagram.reference_constraints) {
      if (constraintIds.has(constraint.id) || ids.has(constraint.id)) throw new Error(`Duplicate HVAC diagram id: ${constraint.id}`);
      constraintIds.add(constraint.id);
    }
    const routeIds = new Set<string>();
    for (const route of plan.diagram.routes) {
      if (routeIds.has(route.id) || ids.has(route.id) || constraintIds.has(route.id)) throw new Error(`Duplicate HVAC diagram id: ${route.id}`);
      routeIds.add(route.id);
      for (const ref of [route.from, route.to, ...(route.via ?? [])]) if (!ids.has(ref)) throw new Error(`HVAC route ${route.id} references unknown diagram id: ${ref}`);
      if (route.constraint_refs?.length) {
        if (route.status === 'confirmed') throw new Error(`HVAC route ${route.id} references constraints and cannot be confirmed`);
        if (!route.reason?.trim()) throw new Error(`HVAC route ${route.id} references constraints and requires reason`);
        for (const ref of route.constraint_refs) if (!constraintIds.has(ref)) throw new Error(`HVAC route ${route.id} references unknown constraint: ${ref}`);
      }
      if (route.system === 'condensate') {
        const sink = plan.diagram.terminals.find((terminal) => terminal.id === route.to);
        if (!sink || sink.status !== 'pending') throw new Error(`HVAC condensate route ${route.id} must end at a pending terminal`);
      }
    }
    for (const anchor of plan.diagram.anchors) if (anchor.ref) {
      const target = anchor.ref.source === 'outdoor' ? plan.outdoor.id === anchor.ref.id : anchor.ref.source === 'ceiling' ? facts.ceiling.some((point) => point.id === anchor.ref!.id) : facts.electrical.some((point) => point.id === anchor.ref!.id);
      if (!target) throw new Error(`HVAC anchor ${anchor.id} references unknown ${anchor.ref.source} id: ${anchor.ref.id}`);
    }
  }
  return hvac;
}
export function parseElectricalPoints(raw: string): ElectricalPoint[] { return ElectricalPointsSchema.parse(parseYaml(raw)); }
export function parsePlumbingPoints(raw: string): PlumbingPoint[] { return PlumbingPointsSchema.parse(parseYaml(raw)); }
export function parseCeilingZones(raw: string): CeilingZone[] { return CeilingZonesSchema.parse(parseYaml(raw)); }
export function parseProjectHvacFacts(raw: string): ProjectHvacFacts { return ProjectHvacFactsSchema.parse(parseYaml(raw)); }
export function parseProjectRenderFacts(raw: unknown): ProjectRenderFacts { return ProjectRenderFactsSchema.parse(raw); }
export function parseRenderLightingOverrides(raw: string): RenderLightingOverride[] { return RenderLightingOverridesSchema.parse(parseYaml(raw)); }
export function parseProjectRenderFactsProjection(raw: unknown): ProjectRenderFactsProjection { return ProjectRenderFactsProjectionSchema.parse(raw); }
