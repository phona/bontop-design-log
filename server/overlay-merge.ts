/**
 * 合并 CAD 几何与声明式覆盖配置。
 * 铁律：只执行 suppress 和 add 两条机械规则；禁止自动分类启发式。
 * 本文件禁止添加任何基于几何位置/边界/邻接关系的自动分类逻辑。
 */
import { z } from 'zod';
import { load } from 'js-yaml';
import type { BaySillSegment, BaySillWallReference, SceneElement, WallSegment, CurtainPoint } from '../shared/types.js';

const PointSchema = z.object({ x: z.number(), z: z.number() }).strict();

const CurtainPointSchema = z
  .object({
    x: z.number(),
    z: z.number(),
    radius: z.number().nonnegative().optional(),
    cx: z.number().optional(),
    cz: z.number().optional(),
  })
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

const CurtainRunPartSchema = z
  .object({
    id: z.string().min(1),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine(d => d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify wall or walls',
  });

const CurtainRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain_run'),
    points: z.array(CurtainPointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    parts: z.array(CurtainRunPartSchema).min(1).optional(),
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

// 淋浴玻璃隔断（独立玻璃，points-only，无碰撞；2026-08-21）
const ShowerScreenSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('shower_screen'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(2.0),
    sill: z.number().min(0).default(0),
  })
  .strict();

const SlidingDoorRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('sliding_door_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(2.1),
    panels: z.number().int().min(2).default(3),
    open: z.boolean().default(true),
  })
  .strict();

const HingedGlassDoorSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('hinged_glass_door'),
    points: z.array(PointSchema).length(2),
    height: z.number().positive().default(2.1),
    open: z.boolean().default(true),
    swing: z.enum(['north', 'south']).default('north'),
    hinge: z.enum(['start', 'end']).default('start'),
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
    // DEC-041：过渡带跟随某房间的有效地面选材（无 follow 则跟随 floor default）
    follow: z.string().min(1).optional(),
  })
  .strict();

const BaySillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('bay_sill'),
    points: z.array(PointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    depth: z.number().positive(),
    sill: z.number().min(0),
    height: z.number().positive(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const RailingRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('railing_run'),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    height: z.number().positive().default(1.0),
  })
  .strict()
  .refine(d => d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify wall or walls',
  });

// 窗帘（声明式 add，引用墙 id 保持 vertices 联动）：kind 由配置显式指定，非几何推断
const CurtainSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain'),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    points: z.array(CurtainPointSchema).min(2).optional(),
    room: z.string().min(1).optional(),
    kind: z.enum(['sheer_blackout', 'blinds']).default('sheer_blackout'),
    height: z.number().positive().default(2.8),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const OverlaySchema = z
  .object({
    version: z.literal(1),
    suppress: z.array(SuppressSchema).default([]),
    elements: z
      .array(
        z.discriminatedUnion('type', [
          CurtainRunSchema,
          WallRunSchema,
          ShowerScreenSchema,
          SlidingDoorRunSchema,
          HingedGlassDoorSchema,
          GlassInfillSchema,
          FloorRegionSchema,
          BaySillSchema,
          RailingRunSchema,
          CurtainSchema,
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
  // Work on copied elements/parts: resolving wall refs adds derived fields and
  // must not mutate the cached parsed overlay between API requests.
  const elements = (overlay?.elements ?? []).map((element) => ({
    ...element,
    ...(element.type === 'curtain_run' && element.parts
      ? { parts: element.parts.map((part) => ({ ...part })) }
      : {}),
  }));

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
      kept.push({ type: 'wall', id: w.id ?? `wall:seg:${i}`, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, ...(w.segments ? { segments: w.segments } : {}), ...(w.openings ? { openings: w.openings } : {}), ...(w.rooms?.length ? { rooms: w.rooms } : {}) });
    }
  });

  // Resolve wall refs in elements (only for types that use wall as id reference)
  const resolvedWalls = walls
    .filter((w): w is WallSegment & { id: string; bayRooms?: string[] } => w.id !== undefined)
    .map(w => ({ id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, segments: w.segments, fromX: w.fromX, fromZ: w.fromZ, fromRadius: w.fromRadius, arcCenterX: w.arcCenterX, arcCenterZ: w.arcCenterZ, rooms: w.rooms, bayRooms: w.bayRooms }));

  for (const el of elements) {
    if (el.type === 'curtain_run' || el.type === 'bay_sill' || el.type === 'glass_infill' || el.type === 'railing_run' || el.type === 'curtain') {
      const elAny = el as Record<string, unknown>;
      const wallRef = elAny.wall ?? elAny.walls;
      if (wallRef) {
        const ids = wallRef as string | string[];
        elAny.points = resolveWallRef(ids, resolvedWalls);
        if (el.type === 'bay_sill') elAny.wallRefs = resolveBaySillWallRefs(ids, resolvedWalls);
      }
      if (el.type === 'curtain_run' && elAny.parts) {
        elAny.parts = (elAny.parts as Array<{ id: string; wall?: string; walls?: string[] }>).map((part) => {
          const partRef = part.wall ?? part.walls;
          const partIds = partRef as string | string[];
          return {
            id: part.id,
            points: resolveWallRef(partIds, resolvedWalls),
            wallRefs: Array.isArray(partIds) ? partIds : [partIds],
          };
        });
      }
    }
  }

  return [...kept, ...elements] as SceneElement[];
}

type WallRefSegment = { x1: number; z1: number; x2: number; z2: number; kind?: 'line' | 'arc'; arcOwner?: string; radius?: number; cx?: number; cz?: number; arcStart?: { x: number; z: number }; arcEnd?: { x: number; z: number } };
type WallRefInput = { id: string; x1: number; z1: number; x2: number; z2: number; segments?: WallRefSegment[]; fromX?: number; fromZ?: number; fromRadius?: number; arcCenterX?: number; arcCenterZ?: number; rooms?: string[]; bayRooms?: string[] };

function ownedSegments(wall: WallRefInput): WallRefSegment[] {
  const source = wall.segments !== undefined ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2, kind: 'line' as const }];
  return source.filter((segment) => Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1) > 1e-9).map((segment) => ({ ...segment }));
}

function resolveBaySillWallRefs(wallIds: string | string[], walls: WallRefInput[]): BaySillWallReference[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  return ids.map((id): BaySillWallReference => {
    const wall = walls.find(candidate => candidate.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    const source = ownedSegments(wall);
    // 弧段始终保留：圆角墙（如 w_mb_south 的 v_sw 弧）是飘窗随墙转弯的依据；
    // 早前对单墙飘窗丢弧导致环幕飘窗在圆角处断开（西南角缺口）。
    const segments = source.map((segment): BaySillSegment => ({ wallId: id, rooms: wall.bayRooms ?? wall.rooms, ...segment }));
    return { wallId: id, rooms: wall.bayRooms ?? wall.rooms, segments };
  });
}

export function resolveWallRef(
  wallIds: string | string[],
  walls: WallRefInput[],
  includeArcs = true,
): CurtainPoint[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  const pts: CurtainPoint[] = [];
  for (const id of ids) {
    const wall = walls.find(w => w.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    if (!includeArcs && wall.fromRadius && wall.fromX !== undefined && wall.fromZ !== undefined) {
      pts.push({ x: wall.fromX, z: wall.fromZ });
      pts.push({ x: wall.x2, z: wall.z2 });
    } else if (wall.fromRadius && wall.fromX !== undefined && wall.fromZ !== undefined && wall.segments?.some(seg => seg.kind === 'arc')) {
      pts.push({ x: wall.x1, z: wall.z1 });
      pts.push({ x: wall.fromX, z: wall.fromZ, radius: wall.fromRadius, cx: wall.arcCenterX, cz: wall.arcCenterZ });
      const arcSegments = wall.segments.filter(seg => seg.kind === 'arc');
      const arcEnd = arcSegments.at(-1)?.arcEnd;
      if (arcEnd) pts.push({ x: arcEnd.x, z: arcEnd.z });
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
