/**
 * 合并 CAD 几何与声明式覆盖配置。
 * 铁律：只执行 suppress 和 add 两条机械规则；禁止自动分类启发式。
 * 本文件禁止添加任何基于几何位置/边界/邻接关系的自动分类逻辑。
 */
import { z } from 'zod';
import { load } from 'js-yaml';
import type { SceneElement, WallSegment } from '../shared/types.js';

const PointSchema = z.object({ x: z.number(), z: z.number() }).strict();

const CurtainPointSchema = z
  .object({ x: z.number(), z: z.number(), radius: z.number().nonnegative().optional() })
  .strict();

const SuppressSchema = z
  .object({
    id: z.string().min(1),
    region: z
      .object({ x1: z.number(), z1: z.number(), x2: z.number(), z2: z.number() })
      .strict(),
    reason: z.string().min(1),
  })
  .strict();

const CurtainRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain_run'),
    points: z.array(CurtainPointSchema).min(2),
    height: z.number().positive().default(3.0),
    closed: z.boolean().optional(),
  })
  .strict();

const WallRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('wall_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(3.0),
  })
  .strict();

const GlassInfillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('glass_infill'),
    room: z.string().min(1),
    wall: z.enum(['north', 'south', 'east', 'west']),
    center_offset: z.number().default(0),
    width: z.number().positive(),
    height: z.number().positive(),
    sill: z.number().min(0).default(0.9),
  })
  .strict();

const FloorRegionSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('floor_region'),
    points: z.array(CurtainPointSchema).min(3),
    room: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

const BaySillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('bay_sill'),
    points: z.array(PointSchema).min(2),
    depth: z.number().positive(),
    sill: z.number().min(0),
    height: z.number().positive(),
    reason: z.string().min(1).optional(),
  })
  .strict();

const OverlaySchema = z
  .object({
    version: z.literal(1),
    suppress: z.array(SuppressSchema).default([]),
    elements: z
      .array(
        z.discriminatedUnion('type', [
          CurtainRunSchema,
          WallRunSchema,
          GlassInfillSchema,
          FloorRegionSchema,
          BaySillSchema,
        ])
      )
      .default([]),
  })
  .strict();

export type OverlayConfig = z.infer<typeof OverlaySchema>;

export function parseOverlay(raw: string): OverlayConfig {
  return OverlaySchema.parse(load(raw) ?? {});
}

export function mergeSceneElements(
  walls: WallSegment[],
  overlay: OverlayConfig | undefined
): SceneElement[] {
  const suppress = overlay?.suppress ?? [];
  const elements = overlay?.elements ?? [];

  const kept: SceneElement[] = [];
  walls.forEach((w, i) => {
    const mx = (w.x1 + w.x2) / 2;
    const mz = (w.z1 + w.z2) / 2;
    const suppressed = suppress.some(({ region }) => {
      const [minX, maxX] = [Math.min(region.x1, region.x2), Math.max(region.x1, region.x2)];
      const [minZ, maxZ] = [Math.min(region.z1, region.z2), Math.max(region.z1, region.z2)];
      return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
    });
    if (!suppressed) {
      kept.push({ type: 'wall', id: `wall:seg:${i}`, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2 });
    }
  });

  return [...kept, ...elements];
}
