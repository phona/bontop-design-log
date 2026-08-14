import type { CurtainPoint } from '@shared/types';

export interface RoomCenter {
  x: number;
  z: number;
}

/**
 * 窗帘中心线向室内侧平移（默认 12cm，双轨窗帘盒常规尺寸）。
 * 解决纱帘与玻璃幕共面导致的 z-fighting（Twinmotion 里"抽动"）；现实窗帘本就挂室内侧。
 * 室内侧判定与 HouseScene.detectInteriorFlip 同规则：取距中心线中点最近的房间质心，
 * 沿首末点方向的左法线/右法线中指向质心的一侧偏移。
 */
export function offsetCurtainPointsInterior(
  pts: CurtainPoint[],
  rooms: RoomCenter[],
  offset = 0.12,
): CurtainPoint[] {
  if (pts.length < 2 || rooms.length === 0 || offset === 0) return pts;
  const p0 = pts[0];
  const pn = pts[pts.length - 1];
  const dx = pn.x - p0.x;
  const dz = pn.z - p0.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return pts;

  let mx = 0, mz = 0;
  for (const p of pts) { mx += p.x; mz += p.z; }
  mx /= pts.length;
  mz /= pts.length;

  let best: RoomCenter | undefined;
  let bestDist = Infinity;
  for (const r of rooms) {
    const d = Math.hypot(r.x - mx, r.z - mz);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  if (!best) return pts;

  const cross = dx * (best.z - mz) - dz * (best.x - mx);
  // 左法线 nL=(-dz,dx)；cross>0 时质心在左法线侧
  const nx = ((-dz / len) * (cross > 0 ? 1 : -1)) * offset;
  const nz = ((dx / len) * (cross > 0 ? 1 : -1)) * offset;

  return pts.map((p) => ({ ...p, x: p.x + nx, z: p.z + nz }));
}
