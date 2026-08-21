import type { WallSegment, ResolvedOpening, Vec3 } from '@shared/types';

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

  constructor(walls: WallSegment[] = []) {
    this.walls = this.buildWallAABBs(walls);
  }

  setWalls(walls: WallSegment[]): void {
    this.walls = this.buildWallAABBs(walls);
  }

  private buildWallAABBs(walls: WallSegment[]): AABB[] {
    const result: AABB[] = [];

    for (const w of walls) {
      const dx = w.x2 - w.x1;
      const dz = w.z2 - w.z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.001) continue;

      const ux = dx / len;
      const uz = dz / len;
      const doors = (w.openings ?? []).filter(o => o.type === 'door' || o.type === 'cased_opening' || o.type === 'sliding_door');

      const isHorizontal = Math.abs(ux) > Math.abs(uz);
      const gaps = doors
        .map(o => {
          const t = (o.x - w.x1) * ux + (o.z - w.z1) * uz;
          return { min: t - o.width / 2, max: t + o.width / 2 };
        })
        .sort((a, b) => a.min - b.min);

      for (const seg of this.splitRange(0, len, gaps)) {
        const halfT = WALL_THICKNESS / 2;
        const atWallStart = seg.min < 1e-6;
        const atWallEnd = seg.max > len - 1e-6;
        const effMin = seg.min - (atWallStart ? halfT : 0);
        const effMax = seg.max + (atWallEnd ? halfT : 0);
        const sx1 = w.x1 + ux * effMin;
        const sz1 = w.z1 + uz * effMin;
        const sx2 = w.x1 + ux * effMax;
        const sz2 = w.z1 + uz * effMax;
        const cx = (sx1 + sx2) / 2;
        const cz = (sz1 + sz2) / 2;
        const segLen = Math.hypot(sx2 - sx1, sz2 - sz1);
        if (segLen < 0.01) continue;

        if (isHorizontal) {
          result.push({
            minX: Math.min(sx1, sx2),
            maxX: Math.max(sx1, sx2),
            minZ: cz - halfT,
            maxZ: cz + halfT,
          });
        } else {
          result.push({
            minX: cx - halfT,
            maxX: cx + halfT,
            minZ: Math.min(sz1, sz2),
            maxZ: Math.max(sz1, sz2),
          });
        }
      }
    }

    return result;
  }

  private splitRange(min: number, max: number, gaps: Array<{ min: number; max: number }>): Array<{ min: number; max: number }> {
    const segments: Array<{ min: number; max: number }> = [];
    let cursor = min;
    for (const gap of gaps) {
      const gapStart = Math.max(cursor, Math.min(gap.min, max));
      const gapEnd = Math.min(max, Math.max(gap.max, cursor));
      if (gapStart > cursor) {
        segments.push({ min: cursor, max: gapStart });
      }
      cursor = Math.max(cursor, gapEnd);
    }
    if (cursor < max) {
      segments.push({ min: cursor, max });
    }
    return segments;
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
