import type { ResolvedWall } from '../../shared/types.js';
import type { Aabb3, SpatialIssue } from '../spatial-validation.js';
import type { BoxEntry } from './scene.js';

/**
 * 家具不得压住门洞清宽。
 *
 * 判据是「两块实体争同一块空间」的平面特例：门洞是墙上的开口，家具 footprint 落在
 * 洞口清宽内即挡住通行。开口位置一律取 `resolveLayout` 已算出的绝对坐标
 * （`server/layout-resolver.ts` 的 resolveOpening），本模块不重新推导 offset。
 *
 * 只查门类开口（door / cased_opening / sliding_door）；窗洞不挡通行，不在本规则内。
 */

const DOOR_OPENING_TYPES = new Set(['door', 'cased_opening', 'sliding_door']);
/** 洞口清宽在墙厚方向的取值：用墙厚datum，足以覆盖门套塞口。 */
const OPENING_DEPTH = 0.12;
/** 低于 20mm 的物体视为踢脚线/压条，不挡门。 */
const MIN_BLOCKING_HEIGHT = 0.02;
/** 通行净高：整体高于此高度的物体（吊顶上的空调管/灯具）不挡门。 */
const PASSAGE_CLEAR_HEIGHT = 2.0;
const EPS = 1e-6;

interface OpeningRect {
  id: string;
  wallId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function openingRect(wall: ResolvedWall, opening: { id: string; x: number; z: number; width: number }): OpeningRect {
  const dx = wall.x2 - wall.x1;
  const dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length;
  const tz = dz / length;
  const nx = -tz;
  const nz = tx;
  const half = opening.width / 2;
  return {
    id: opening.id,
    wallId: wall.id,
    minX: Math.min(opening.x - tx * half - nx * OPENING_DEPTH, opening.x + tx * half + nx * OPENING_DEPTH),
    maxX: Math.max(opening.x - tx * half - nx * OPENING_DEPTH, opening.x + tx * half + nx * OPENING_DEPTH),
    minZ: Math.min(opening.z - tz * half - nz * OPENING_DEPTH, opening.z + tz * half + nz * OPENING_DEPTH),
    maxZ: Math.max(opening.z - tz * half - nz * OPENING_DEPTH, opening.z + tz * half + nz * OPENING_DEPTH),
  };
}

export interface FurnitureOpeningsInput {
  walls: ResolvedWall[];
  furniture: BoxEntry[];
  source: string;
}

export function validateFurnitureOpenings(input: FurnitureOpeningsInput): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const rects: OpeningRect[] = [];
  for (const wall of input.walls) {
    for (const opening of wall.openings ?? []) {
      if (!DOOR_OPENING_TYPES.has(opening.type)) continue;
      rects.push(openingRect(wall, opening));
    }
  }
  for (const entry of input.furniture) {
    const box: Aabb3 = entry.box;
    if (box.maxY <= MIN_BLOCKING_HEIGHT) continue;
    // 只挡「从地面到通行净高」这一段：吊顶上的冷凝管/灯具即使平面落在洞口中也不挡门。
    if (box.minY >= PASSAGE_CLEAR_HEIGHT) continue;
    for (const rect of rects) {
      const overlapX = Math.min(box.maxX, rect.maxX) - Math.max(box.minX, rect.minX);
      const overlapZ = Math.min(box.maxZ, rect.maxZ) - Math.max(box.minZ, rect.minZ);
      if (overlapX <= EPS || overlapZ <= EPS) continue;
      issues.push({
        level: 'error',
        code: 'pen.furniture.opening_blocked',
        entity: `${entry.entity}↔${rect.id}`,
        source: input.source,
        message: `furniture ${entry.type} blocks door opening ${rect.id} on ${rect.wallId}`,
        evidence: {
          furniture: entry.entity,
          furniture_type: entry.type,
          opening: rect.id,
          wall: rect.wallId,
          overlap_x_m: Number(overlapX.toFixed(4)),
          overlap_z_m: Number(overlapZ.toFixed(4)),
          furniture_box: box,
        },
      });
    }
  }
  return issues;
}
