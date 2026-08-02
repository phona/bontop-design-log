import { z } from 'zod';
import { load } from 'js-yaml';

export const EnvironmentSchema = z.object({
  version: z.literal(1),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.number(),
  }),
  horizon: z.object({
    obstruction_deg: z.number().min(0).max(90),
  }),
  climate: z.object({
    zone: z.string(),
    huinan_window: z.object({ start: z.string(), end: z.string() }),
    prevailing_wind: z.object({ summer: z.string(), winter: z.string() }),
    rainfall_mm_annual: z.number(),
    monthly: z
      .array(
        z.object({
          month: z.number().int().min(1).max(12),
          temp_c: z.number(),
          rh_pct: z.number(),
        })
      )
      .length(12),
  }),
  humidity: z
    .object({
      rooms: z
        .record(
          z.string(),
          z.object({
            moisture: z.enum(['low', 'medium', 'high']),
            ventilation: z.enum(['cross', 'open', 'range_hood', 'mechanical', 'single_side']),
            cold_surface: z.string().optional(),
          })
        )
        .optional(),
      surfaces: z
        .array(
          z.object({
            id: z.string(),
            room: z.string(),
            kind: z.enum(['slab', 'ext_wall', 'corner']),
            risk: z.string().optional(),
            faces: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

export function parseEnvironment(raw: string): EnvironmentConfig {
  return EnvironmentSchema.parse(load(raw));
}
