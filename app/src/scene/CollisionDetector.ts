import type { RoomLayout, Vec3 } from '@shared/types';

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const PLAYER_RADIUS = 0.3;
const WALL_THICKNESS = 0.12;

export class CollisionDetector {
  private walls: AABB[] = [];

  constructor(roomLayouts: RoomLayout[]) {
    this.walls = this.buildWallAABBs(roomLayouts);
  }

  private buildWallAABBs(roomLayouts: RoomLayout[]): AABB[] {
    const result: AABB[] = [];

    for (const r of roomLayouts) {
      const halfW = r.width / 2;
      const halfD = r.depth / 2;

      result.push({
        minX: r.x - halfW,
        maxX: r.x + halfW,
        minZ: r.z - halfD - WALL_THICKNESS / 2,
        maxZ: r.z - halfD + WALL_THICKNESS / 2,
      });
      result.push({
        minX: r.x - halfW,
        maxX: r.x + halfW,
        minZ: r.z + halfD - WALL_THICKNESS / 2,
        maxZ: r.z + halfD + WALL_THICKNESS / 2,
      });
      result.push({
        minX: r.x - halfW - WALL_THICKNESS / 2,
        maxX: r.x - halfW + WALL_THICKNESS / 2,
        minZ: r.z - halfD,
        maxZ: r.z + halfD,
      });
      result.push({
        minX: r.x + halfW - WALL_THICKNESS / 2,
        maxX: r.x + halfW + WALL_THICKNESS / 2,
        minZ: r.z - halfD,
        maxZ: r.z + halfD,
      });
    }

    return result;
  }

  tryMove(from: Vec3, desired: Vec3): Vec3 {
    if (!this.collidesAt(desired.x, desired.z)) {
      return { x: desired.x, y: desired.y, z: desired.z };
    }

    if (!this.collidesAt(desired.x, from.z)) {
      return { x: desired.x, y: desired.y, z: from.z };
    }

    if (!this.collidesAt(from.x, desired.z)) {
      return { x: from.x, y: desired.y, z: desired.z };
    }

    return { x: from.x, y: desired.y, z: from.z };
  }

  private collidesAt(x: number, z: number): boolean {
    for (const wall of this.walls) {
      if (this.capsuleOverlapsAABB(x, z, wall)) {
        return true;
      }
    }
    return false;
  }

  private capsuleOverlapsAABB(cx: number, cz: number, aabb: AABB): boolean {
    const closestX = Math.max(aabb.minX, Math.min(cx, aabb.maxX));
    const closestZ = Math.max(aabb.minZ, Math.min(cz, aabb.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return dx * dx + dz * dz <= PLAYER_RADIUS * PLAYER_RADIUS;
  }

  getWalls(): AABB[] {
    return [...this.walls];
  }
}
