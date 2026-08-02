import type { SceneElement, WallSegment } from './types.js';

export interface RoomCenter {
  id: string;
  x: number;
  z: number;
}

export interface WindowAperture {
  id: string;
  roomId: string | null;
  azimuthDeg: number;
  midpoint: { x: number; z: number };
}

function compassAzimuthDeg(vx: number, vz: number): number {
  return (Math.atan2(vx, -vz) * (180 / Math.PI) + 360) % 360;
}

function nearestRoom(
  mx: number,
  mz: number,
  inwardX: number,
  inwardZ: number,
  rooms: RoomCenter[]
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of rooms) {
    const dx = r.x - mx;
    const dz = r.z - mz;
    const inward = dx * inwardX + dz * inwardZ;
    const dist = Math.hypot(dx, dz);
    if (inward > 0 && dist < bestDist) {
      bestDist = dist;
      best = r.id;
    }
  }
  if (best !== null) return best;
  for (const r of rooms) {
    const dist = Math.hypot(r.x - mx, r.z - mz);
    if (dist < bestDist) {
      bestDist = dist;
      best = r.id;
    }
  }
  return best;
}

function makeAperture(
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  rooms: RoomCenter[]
): WindowAperture {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  let n1x = -dz / len;
  let n1z = dx / len;

  let nearest: RoomCenter | null = null;
  let nearestDist = Infinity;
  for (const r of rooms) {
    const d = Math.hypot(r.x - mx, r.z - mz);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = r;
    }
  }
  if (nearest && (nearest.x - mx) * n1x + (nearest.z - mz) * n1z > 0) {
    n1x = -n1x;
    n1z = -n1z;
  }

  return {
    id,
    roomId: nearestRoom(mx, mz, -n1x, -n1z, rooms),
    azimuthDeg: compassAzimuthDeg(n1x, n1z),
    midpoint: { x: mx, z: mz },
  };
}

export function extractApertures(
  elements: SceneElement[],
  rooms: RoomCenter[],
  walls: WallSegment[] = []
): WindowAperture[] {
  const apertures: WindowAperture[] = [];

  for (const el of elements) {
    if (el.type === 'curtain_run' || el.type === 'bay_sill') {
      const pts = el.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) continue;
        apertures.push(makeAperture(`${el.id}:seg${i}`, a.x, a.z, b.x, b.z, rooms));
      }
    } else if (el.type === 'glass_infill') {
      const wall = walls.find((w) => w.id === el.wall);
      if (!wall) continue;
      apertures.push(makeAperture(el.id, wall.x1, wall.z1, wall.x2, wall.z2, rooms));
    }
  }

  return apertures;
}
