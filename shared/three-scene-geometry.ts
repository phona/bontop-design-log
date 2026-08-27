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
  material: THREE.Material,
  options: LineMeshOptions = {},
): THREE.Mesh | null {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < (options.minimumLength ?? 0.001)) return null;
  const boxLength = options.clampLengthToThickness ? Math.max(length, thickness) : length;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(boxLength, height, thickness), material);
  mesh.position.set((a.x + b.x) / 2, height / 2, (a.z + b.z) / 2);
  if (length > thickness) mesh.rotation.y = Math.atan2(b.z - a.z, b.x - a.x);
  return mesh;
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
