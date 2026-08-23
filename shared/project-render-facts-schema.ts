import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import {
  VALID_CEILING_TYPES,
  type CeilingZone,
  type ElectricalPoint,
  type PlumbingPoint,
  type ProjectRenderFacts,
  type ProjectRenderFactsProjection,
  type RenderLightingOverride,
} from './types.js';

export const ElectricalPointSchema = z.object({
  id: z.string(),
  room: z.string(),
  type: z.enum([
    'socket',
    'switch',
    'switch_2way',
    'network',
    'usb',
    'floor_socket',
    'ceiling_light',
    'pendant',
    'dome',
    'wall_lamp',
    'downlight',
    'led_strip',
  ]),
  x: z.number(),
  z: z.number(),
  wall: z.string().optional(),
  temp: z.number().optional(),
  count: z.number().optional(),
  note: z.string().optional(),
  height: z.number().optional(),
}).strict();

export const PlumbingPointSchema = z.object({
  id: z.string(),
  room: z.string(),
  type: z.enum(['faucet', 'toilet', 'shower', 'drain', 'washer', 'faucet_outdoor']),
  x: z.number(),
  z: z.number(),
  wall: z.string().optional(),
  note: z.string().optional(),
  height: z.number().optional(),
}).strict();

export const CeilingZoneSchema = z.object({
  id: z.string(),
  room: z.string(),
  type: z.enum(VALID_CEILING_TYPES),
  thickness: z.number().optional(),
  area: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  x: z.number().optional(),
  z: z.number().optional(),
  height: z.number().optional(),
  model: z.string().optional(),
  note: z.string().optional(),
}).strict();

export const ElectricalPointsSchema = z.array(ElectricalPointSchema);
export const PlumbingPointsSchema = z.array(PlumbingPointSchema);
export const CeilingZonesSchema = z.array(CeilingZoneSchema);

export const ProjectRenderFactsSchema = z.object({
  electrical: ElectricalPointsSchema,
  plumbing: PlumbingPointsSchema,
  ceiling: CeilingZonesSchema,
}).strict();

export const RenderLightingOverrideSchema = z.object({
  id: z.string(),
  anchorY: z.number(),
  offsetX: z.number().optional(),
  offsetZ: z.number().optional(),
  reason: z.string().min(1),
  applies_to: z.tuple([z.literal('web'), z.literal('blender')]),
}).strict();

export const RenderLightingOverridesSchema = z.array(RenderLightingOverrideSchema);

export const ProjectRenderFactsProjectionSchema = z.object({
  version: z.string(),
  lightingFixtures: z.array(z.object({
    id: z.string(),
    room: z.string(),
    type: ElectricalPointSchema.shape.type,
    position: z.object({ x: z.number(), y: z.number(), z: z.number() }).strict(),
    temperatureK: z.number(),
    enabled: z.boolean(),
  }).strict()),
  plumbing: PlumbingPointsSchema,
  ceiling: CeilingZonesSchema,
  materials: z.object({
    floor: z.object({
      default: z.string().nullable(),
      roomOverrides: z.record(z.string(), z.string()),
    }).strict(),
  }).strict(),
}).strict();

export function parseElectricalPoints(raw: string): ElectricalPoint[] {
  return ElectricalPointsSchema.parse(parseYaml(raw));
}

export function parsePlumbingPoints(raw: string): PlumbingPoint[] {
  return PlumbingPointsSchema.parse(parseYaml(raw));
}

export function parseCeilingZones(raw: string): CeilingZone[] {
  return CeilingZonesSchema.parse(parseYaml(raw));
}

export function parseProjectRenderFacts(raw: unknown): ProjectRenderFacts {
  return ProjectRenderFactsSchema.parse(raw);
}

export function parseRenderLightingOverrides(raw: string): RenderLightingOverride[] {
  return RenderLightingOverridesSchema.parse(parseYaml(raw));
}

export function parseProjectRenderFactsProjection(raw: unknown): ProjectRenderFactsProjection {
  return ProjectRenderFactsProjectionSchema.parse(raw);
}
