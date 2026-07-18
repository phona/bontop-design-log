/**
 * 合并 CAD 几何与声明式覆盖配置。
 * 铁律：只执行 suppress 和 add 两条机械规则；禁止自动分类启发式。
 * 本文件禁止添加任何基于几何位置/边界/邻接关系的自动分类逻辑。
 */
import { z } from 'zod';
import { load } from 'js-yaml';
import type { SceneElement, WallSegment, CurtainPoint } from '../shared/types.js';

const PointSchema = z.object({ x: z.number(), z: z.number() }).strict();

const CurtainPointSchema = z
  .object({ x: z.number(), z: z.number(), radius: z.number().nonnegative().optional() })
  .strict();

const SuppressSchema = z
  .object({
    id: z.string().min(1),
    region: z
      .object({ x1: z.number(), z1: z.number(), x2: z.number(), z2: z.number() })
      .strict()
      .optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    reason: z.string().min(1),
  })
  .strict()
  .refine(d => d.region || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify region, wall, or walls',
  });

const CurtainRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain_run'),
    points: z.array(CurtainPointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    height: z.number().positive().default(3.0),
    closed: z.boolean().optional(),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

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
    wall: z.string().min(1),
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
    points: z.array(PointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    depth: z.number().positive(),
    sill: z.number().min(0),
    height: z.number().positive(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .refine(d => d.points || d.wall, { message: 'Must specify points or wall' });

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
    const suppressed = suppress.some(s => {
      if (s.wall) {
        return w.id === s.wall;
      }
      if (s.walls) {
        return s.walls.includes(w.id ?? '');
      }
      if (s.region) {
        const mx = (w.x1 + w.x2) / 2;
        const mz = (w.z1 + w.z2) / 2;
        const [minX, maxX] = [Math.min(s.region.x1, s.region.x2), Math.max(s.region.x1, s.region.x2)];
        const [minZ, maxZ] = [Math.min(s.region.z1, s.region.z2), Math.max(s.region.z1, s.region.z2)];
        return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
      }
      return false;
    });
    if (!suppressed) {
      kept.push({ type: 'wall', id: `wall:seg:${i}`, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, ...(w.segments ? { segments: w.segments } : {}) });
    }
  });

  // Resolve wall refs in elements (only for types that use wall as id reference)
  const resolvedWalls = walls
    .filter((w): w is WallSegment & { id: string } => w.id !== undefined)
    .map(w => ({ id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, segments: w.segments }));

  for (const el of elements) {
    if (el.type === 'curtain_run' || el.type === 'bay_sill' || el.type === 'glass_infill') {
      const elAny = el as Record<string, unknown>;
      const wallRef = elAny.wall ?? elAny.walls;
      if (wallRef) {
        (elAny as Record<string, unknown>).points = resolveWallRef(
          wallRef as string | string[],
          resolvedWalls
        );
      }
    }
  }

  return [...kept, ...elements] as SceneElement[];
}

export function resolveWallRef(
  wallIds: string | string[],
  walls: Array<{ id: string; x1: number; z1: number; x2: number; z2: number; segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>; fromX?: number; fromZ?: number; fromRadius?: number }>
): CurtainPoint[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  const pts: CurtainPoint[] = [];
  for (const id of ids) {
    const wall = walls.find(w => w.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    if (wall.fromRadius && wall.fromX !== undefined && wall.fromZ !== undefined && wall.segments && wall.segments.length >= 16) {
      pts.push({ x: wall.fromX!, z: wall.fromZ!, radius: wall.fromRadius });
      const arcEnd = wall.segments[15];
      pts.push({ x: arcEnd.x2, z: arcEnd.z2 });
      pts.push({ x: wall.x2, z: wall.z2 });
    } else if (wall.segments && wall.segments.length > 1) {
      for (const seg of wall.segments) {
        pts.push({ x: seg.x1, z: seg.z1 });
        pts.push({ x: seg.x2, z: seg.z2 });
      }
    } else {
      pts.push({ x: wall.x1, z: wall.z1 });
      pts.push({ x: wall.x2, z: wall.z2 });
    }
  }
  const merged: CurtainPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = pts[i];
    if (Math.abs(prev.x - curr.x) < 0.001 && Math.abs(prev.z - curr.z) < 0.001) {
      if (curr.radius !== undefined && prev.radius === undefined) {
        merged[merged.length - 1] = curr;
      }
      continue;
    }
    merged.push(curr);
  }

  return merged;
}
