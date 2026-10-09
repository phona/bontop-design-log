import * as THREE from 'three';

/**
 * OBB（有向包围盒）与 SAT 窄相位。
 *
 * 存在的理由：现行穿透判定用的是 runtime mesh 的 **AABB**。AABB 对旋转体是保守的
 * （旋转盒的 AABB 一定包住它），因此旋转家具 vs 墙/另一件家具会出现「AABB 说相交、
 * 实际并不相交」的假阳——而假阳是穿模 linter 的第一死因。OBB 恒包含于 AABB，
 * 所以 OBB 判相交 ⇒ AABB 必判相交：本层只会消假阳，不会漏真阳。
 *
 * 几何来源：runtime mesh 的 `matrixWorld` + `geometry.boundingBox`，不重新推导坐标。
 * 无 geometry 的对象（Group 等）退化为世界 AABB 的 OBB，与现行口径一致。
 */

export interface Obb {
  center: THREE.Vector3;
  /** 单位且正交的三个轴。 */
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  half: [number, number, number];
}

const BASIS: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

/** 从 runtime 对象推导 OBB；无几何或空盒返回 null。 */
export function obbFromObject(object: THREE.Object3D): Obb | null {
  object.updateWorldMatrix(true, false);
  const geometry = (object as THREE.Mesh).geometry;
  let localCenter: THREE.Vector3;
  let localHalf: THREE.Vector3;
  if (geometry) {
    geometry.computeBoundingBox();
    const local = geometry.boundingBox;
    if (!local) return null;
    localCenter = local.getCenter(new THREE.Vector3());
    localHalf = local.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  } else {
    // Group / 无 geometry：退化为世界 AABB（保守，与现行 AABB 判定等价）。
    const world = new THREE.Box3().setFromObject(object);
    if (world.isEmpty()) return null;
    return {
      center: world.getCenter(new THREE.Vector3()),
      axes: [BASIS[0].clone(), BASIS[1].clone(), BASIS[2].clone()],
      half: [((world.max.x - world.min.x) / 2), ((world.max.y - world.min.y) / 2), ((world.max.z - world.min.z) / 2)],
    };
  }

  const rotation = new THREE.Matrix3().setFromMatrix4(object.matrixWorld);
  const axes: THREE.Vector3[] = [];
  const scale: number[] = [];
  for (const basis of BASIS) {
    const axis = basis.clone().applyMatrix3(rotation);
    const length = axis.length();
    if (length <= 1e-12) return null;
    axes.push(axis.divideScalar(length));
    scale.push(length);
  }
  const center = localCenter.clone().applyMatrix4(object.matrixWorld);
  return {
    center,
    axes: [axes[0], axes[1], axes[2]],
    half: [localHalf.x * scale[0], localHalf.y * scale[1], localHalf.z * scale[2]],
  };
}

export interface SatOverlap {
  /** 穿透深度（米）。 */
  depth: number;
  /** 最小平移向量：把 a 沿此方向推出即可分离。 */
  mtv: THREE.Vector3;
}

/** SAT：15 轴（3+3+9 叉积）。分离返回 null，相交返回最小穿透轴。 */
export function satOverlap(a: Obb, b: Obb): SatOverlap | null {
  const axes: THREE.Vector3[] = [...a.axes, ...b.axes];
  for (const axisA of a.axes) {
    for (const axisB of b.axes) {
      const cross = new THREE.Vector3().crossVectors(axisA, axisB);
      if (cross.lengthSq() > 1e-12) axes.push(cross.normalize());
    }
  }

  const delta = b.center.clone().sub(a.center);
  let bestDepth = Number.POSITIVE_INFINITY;
  let bestAxis: THREE.Vector3 | null = null;

  for (const axis of axes) {
    const radiusA = Math.abs(a.axes[0].dot(axis)) * a.half[0]
      + Math.abs(a.axes[1].dot(axis)) * a.half[1]
      + Math.abs(a.axes[2].dot(axis)) * a.half[2];
    const radiusB = Math.abs(b.axes[0].dot(axis)) * b.half[0]
      + Math.abs(b.axes[1].dot(axis)) * b.half[1]
      + Math.abs(b.axes[2].dot(axis)) * b.half[2];
    const distance = Math.abs(delta.dot(axis));
    const overlap = radiusA + radiusB - distance;
    if (overlap <= 0) return null;
    if (overlap < bestDepth) {
      bestDepth = overlap;
      // MTV 方向：从 a 指向 b，保证「把 a 沿 -mtv 移动」能分离。
      bestAxis = delta.dot(axis) >= 0 ? axis.clone() : axis.clone().negate();
    }
  }

  if (!bestAxis) return null;
  return { depth: bestDepth, mtv: bestAxis.multiplyScalar(bestDepth) };
}

/** AABB 判定是否相交（用于 broad-phase 与 shadow 对照）。 */
export function aabbOverlaps(a: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, b: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }, epsilon = 1e-6): boolean {
  return a.minX <= b.maxX - epsilon && a.maxX >= b.minX + epsilon
    && a.minY <= b.maxY - epsilon && a.maxY >= b.minY + epsilon
    && a.minZ <= b.maxZ - epsilon && a.maxZ >= b.minZ + epsilon;
}
