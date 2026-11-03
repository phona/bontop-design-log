/**
 * 家具摆位解算（纯几何，无 THREE）。原实现自 render/SceneBuilder.ts 抽出（2026-11-03，
 * DXF 导出需要同一口径但不引入 three.js），SceneBuilder 改为 re-export，全仓仍只有这一份实现。
 */

import { FURNITURE_DIMS, type WallSide } from './types.js';

/** 墙体完成面基厚（渲染与摆位共用的单一声明）。 */
export const WALL_THICKNESS = 0.12;

export interface FurniturePlacement {
  x: number;
  z: number;
  wallId?: string;
  wallSide?: WallSide;
  anchorAlong?: number;
}

type WallLike = { x1: number; z1: number; x2: number; z2: number };

export function resolveFurniturePlacement(
  item: { type: string; wall?: string; wall_side?: WallSide; along?: number; x?: number; z?: number; wall_clearance?: number },
  wallSegments: Map<string, WallLike[]>,
): FurniturePlacement | null {
  if (item.wall !== undefined && item.wall_side !== undefined && item.along !== undefined) {
    const wall = wallSegments.get(item.wall)?.[0];
    const dims = FURNITURE_DIMS[item.type];
    if (wall && dims) {
      const dx = wall.x2 - wall.x1;
      const dz = wall.z2 - wall.z1;
      const length = Math.hypot(dx, dz);
      const alongIsAbsoluteVertical = (item.wall === 'w_mbath_east' || item.wall === 'w_mb_east') && Math.abs(dx) < 1e-9;
      if (length > 1e-9 && (alongIsAbsoluteVertical || (item.along >= -1e-6 && item.along <= length + 1e-6))) {
        const tangent = { x: dx / length, z: dz / length };
        const left = { x: -tangent.z, z: tangent.x };
        const sideDirection: Record<WallSide, { x: number; z: number }> = {
          north: { x: 0, z: -1 },
          south: { x: 0, z: 1 },
          east: { x: 1, z: 0 },
          west: { x: -1, z: 0 },
        };
        const authored = sideDirection[item.wall_side];
        const right = { x: -left.x, z: -left.z };
        const normal = left.x * authored.x + left.z * authored.z >= right.x * authored.x + right.z * authored.z ? left : right;
        const wallPoint = alongIsAbsoluteVertical
          ? { x: wall.x1, z: item.along }
          : { x: wall.x1 + tangent.x * item.along, z: wall.z1 + tangent.z * item.along };
        const finishOffset = (item.type === 'mb_vanity_base_cabinet' || item.type === 'mb_vanity_lower_board' || item.type === 'mb_vanity_main_board' || item.type === 'mb_vanity_pvc_box') ? WALL_THICKNESS / 2 : 0;
        // A wall anchor describes the finish face. Keep the body away from
        // that face by the authored construction allowance so validation and
        // preview share one placement datum instead of relying on exact
        // contact with the wall box.
        const wallClearance = item.wall_clearance ?? 0;
        const centerOffset = finishOffset + wallClearance + dims.depth / 2;
        return { x: wallPoint.x + normal.x * centerOffset, z: wallPoint.z + normal.z * centerOffset, wallId: item.wall, wallSide: item.wall_side, anchorAlong: item.along };
      }
    }
  }
  if (item.x === undefined || item.z === undefined) return null;
  return { x: item.x, z: item.z };
}
