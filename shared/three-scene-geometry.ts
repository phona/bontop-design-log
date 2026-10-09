import * as THREE from 'three';

export interface ScenePoint {
  x: number;
  z: number;
}

export interface SceneSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface SceneOpening {
  x: number;
  z: number;
  width: number;
  height: number;
}

export interface LineMeshOptions {
  /** Skip segments shorter than this value. Defaults to 0.001m. */
  minimumLength?: number;
  /** Preserve a box footprint for degenerate segments. */
  clampLengthToThickness?: boolean;
  /** Store wall-facing BoxGeometry UVs in meters for physical-size material repeats. */
  uvUnits?: 'meters';
}

export interface WallFaceRoomInput {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** 非矩形房间的边界多边形（resolveRoom 仅对非轴对齐矩形房间输出 points）。 */
  points?: Array<{ x: number; z: number }>;
}

export interface WallFaceSpan {
  /** 沿墙参数区间 [t0, t1]（0=段起点，1=段终点）。 */
  t0: number;
  t1: number;
  /** 行进方向左侧/右侧贴邻房间 id；外侧（无房间）为 null。 */
  left: string | null;
  right: string | null;
}

function pointInPolygon(px: number, pz: number, poly: Array<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function roomPolygon(room: WallFaceRoomInput): Array<{ x: number; z: number }> {
  if (room.points && room.points.length >= 3) return room.points;
  const hw = room.width / 2, hd = room.depth / 2;
  return [
    { x: room.x - hw, z: room.z - hd },
    { x: room.x + hw, z: room.z - hd },
    { x: room.x + hw, z: room.z + hd },
    { x: room.x - hw, z: room.z + hd },
  ];
}

function roomAtPoint(px: number, pz: number, rooms: ReadonlyArray<WallFaceRoomInput>): WallFaceRoomInput | null {
  let best: WallFaceRoomInput | null = null;
  let bestDist = Infinity;
  for (const room of rooms) {
    if (!pointInPolygon(px, pz, roomPolygon(room))) continue;
    const dist = (room.x - px) ** 2 + (room.z - pz) ** 2;
    if (dist < bestDist) { bestDist = dist; best = room; }
  }
  return best;
}

/**
 * 共墙按面给材质的几何判定（DEC-2026-10-07-R12）：对一段墙求左右两侧贴邻房间沿墙变化的区间。
 * 过渡点取所有房间多边形顶点在该墙线上的投影——房间交界只可能出现在墙线与房间顶点的交点处。
 * 每个子区间取中点沿法线偏移后的采样点做点在多边形内判定；偏移量须大于半墙厚。
 */
export function computeWallFaceSpans(
  segment: SceneSegment,
  rooms: ReadonlyArray<WallFaceRoomInput>,
  offset: number,
): WallFaceSpan[] {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6 || rooms.length === 0) return [{ t0: 0, t1: 1, left: null, right: null }];
  const ux = dx / len, uz = dz / len;
  const leftNx = -uz, leftNz = ux;

  const splits = new Set<number>();
  for (const room of rooms) {
    for (const v of roomPolygon(room)) {
      const t = ((v.x - segment.x1) * ux + (v.z - segment.z1) * uz) / len;
      if (t > 0.02 && t < 0.98) splits.add(Math.round(t * 1e4) / 1e4);
    }
  }
  const bounds = [0, ...[...splits].sort((a, b) => a - b), 1];

  const spans: WallFaceSpan[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const t0 = bounds[i], t1 = bounds[i + 1];
    if (t1 - t0 < 1e-4) continue;
    const tm = (t0 + t1) / 2;
    const mx = segment.x1 + ux * tm * len, mz = segment.z1 + uz * tm * len;
    const left = roomAtPoint(mx + leftNx * offset, mz + leftNz * offset, rooms);
    const right = roomAtPoint(mx - leftNx * offset, mz - leftNz * offset, rooms);
    const leftId = left?.id ?? null;
    const rightId = right?.id ?? null;
    const prev = spans[spans.length - 1];
    if (prev && prev.left === leftId && prev.right === rightId) {
      prev.t1 = t1;
    } else {
      spans.push({ t0, t1, left: leftId, right: rightId });
    }
  }
  return spans.length > 0 ? spans : [{ t0: 0, t1: 1, left: null, right: null }];
}

/**
 * BoxGeometry 材质槽位（0..5 = +X,−X,+Y,−Y,+Z,−Z）中，哪两个槽位是墙的两个大侧面。
 * createLineMesh 的 yaw=atan2(dz,dx) 下 local+Z 世界方向为 (dz, dx)/len；与行进方向左侧
 * 法线 (−dz, dx)/len 点积为正即左侧面。返回 {left, right} 两个槽位下标（∈{4,5}）。
 */
export function wallFaceSlots(dx: number, dz: number): { left: number; right: number } {
  const len = Math.hypot(dx, dz) || 1;
  const dot = (dz * -dz + dx * dx) / (len * len);
  return dot > 0 ? { left: 4, right: 5 } : { left: 5, right: 4 };
}

export function setSceneObjectMetadata(
  object: THREE.Object3D,
  type: string,
  objectId: string,
  exportName = objectId,
): void {
  object.userData = { ...object.userData, type, objectId, exportName };
  object.name = exportName;
}

export function createPolygonGeometry(points: ScenePoint[]): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const y = -point.z;
    if (index === 0) shape.moveTo(point.x, y);
    else shape.lineTo(point.x, y);
  });
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function createLineMesh(
  a: ScenePoint,
  b: ScenePoint,
  height: number,
  thickness: number,
  material: THREE.Material | THREE.Material[],
  options: LineMeshOptions = {},
): THREE.Mesh | null {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < (options.minimumLength ?? 0.001)) return null;
  const boxLength = options.clampLengthToThickness ? Math.max(length, thickness) : length;
  const geometry = new THREE.BoxGeometry(boxLength, height, thickness);
  if (options.uvUnits === 'meters') scaleBoxUvToMeters(geometry, boxLength, height, thickness);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((a.x + b.x) / 2, height / 2, (a.z + b.z) / 2);
  if (length > thickness) mesh.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
  return mesh;
}

function scaleBoxUvToMeters(geometry: THREE.BufferGeometry, width: number, height: number, depth: number): void {
  // Lightweight renderer mocks may provide a placeholder BoxGeometry without attributes.
  if (typeof geometry.getAttribute !== 'function') return;
  const uv = geometry.getAttribute('uv');
  const normal = geometry.getAttribute('normal');
  if (!uv || !normal) return;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const uSize = nx > 0.5 ? depth : width;
    const vSize = ny > 0.5 ? depth : height;
    uv.setXY(i, uv.getX(i) * uSize, uv.getY(i) * vSize);
  }
  uv.needsUpdate = true;
}

export function splitSegmentByOpenings(segment: SceneSegment, openings: SceneOpening[]): SceneSegment[] {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return [];
  const ux = dx / length;
  const uz = dz / length;
  const blocked = openings
    .filter((opening) => opening.height > 0 && opening.width > 0)
    .map((opening) => {
      const center = (opening.x - segment.x1) * ux + (opening.z - segment.z1) * uz;
      return [Math.max(0, center - opening.width / 2), Math.min(length, center + opening.width / 2)] as const;
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const result: SceneSegment[] = [];
  let cursor = 0;
  for (const [start, end] of blocked) {
    if (start > cursor) {
      result.push({
        x1: segment.x1 + ux * cursor,
        z1: segment.z1 + uz * cursor,
        x2: segment.x1 + ux * start,
        z2: segment.z1 + uz * start,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) {
    result.push({ x1: segment.x1 + ux * cursor, z1: segment.z1 + uz * cursor, x2: segment.x2, z2: segment.z2 });
  }
  return result;
}
