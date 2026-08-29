import * as THREE from 'three';
import type { CurtainPoint } from '../types.js';
import { setSceneObjectMetadata } from '../three-scene-geometry.js';

const HANDRAIL_RADIUS = 0.03;
const BAR_RADIUS = 0.01;
const BAR_SPACING = 0.13;
const SAMPLE_SPACING = 0.08;
const MIN_SEGMENT = 0.001;

export interface RailingGeometryBuildResult {
  group: THREE.Group;
  geometryMode: 'linear' | 'arc';
  path: Array<{ x: number; z: number }>;
}

type Point = { x: number; z: number };

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function appendPoint(path: Point[], point: Point): void {
  if (path.length === 0 || distance(path[path.length - 1], point) >= MIN_SEGMENT) path.push(point);
}

function sampleLine(a: Point, b: Point, spacing: number): Point[] {
  const length = distance(a, b);
  const count = Math.max(1, Math.ceil(length / spacing));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  });
}

function sampleArc(start: Point, end: Point, marker: CurtainPoint): Point[] | null {
  if (marker.radius === undefined || marker.cx === undefined || marker.cz === undefined) return null;
  const radius = Math.hypot(start.x - marker.cx, start.z - marker.cz);
  const endRadius = Math.hypot(end.x - marker.cx, end.z - marker.cz);
  if (radius < MIN_SEGMENT || Math.abs(radius - endRadius) > 0.02) return null;
  let startAngle = Math.atan2(start.z - marker.cz, start.x - marker.cx);
  let endAngle = Math.atan2(end.z - marker.cz, end.x - marker.cx);
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const count = Math.max(2, Math.ceil(Math.abs(delta * radius) / SAMPLE_SPACING));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = startAngle + delta * index / count;
    return { x: marker.cx! + radius * Math.cos(angle), z: marker.cz! + radius * Math.sin(angle) };
  });
}

function samplePath(points: CurtainPoint[]): { path: Point[]; geometryMode: 'linear' | 'arc' } {
  const path: Point[] = [];
  let geometryMode: 'linear' | 'arc' = 'linear';
  let index = 0;
  while (index < points.length - 1) {
    const current = points[index];
    const next = points[index + 1];
    if (next.radius !== undefined && index + 2 < points.length) {
      const arc = sampleArc(current, points[index + 2], next);
      if (arc) {
        geometryMode = 'arc';
        arc.forEach((point) => appendPoint(path, point));
        index += 2;
        continue;
      }
    }
    sampleLine(current, next, SAMPLE_SPACING).forEach((point) => appendPoint(path, point));
    index++;
  }
  return { path, geometryMode };
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh | null {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = direction.length();
  if (length < MIN_SEGMENT) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function pointAtDistance(path: Point[], target: number): Point {
  if (target <= 0) return path[0];
  let travelled = 0;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = distance(path[index], path[index + 1]);
    if (travelled + segment >= target) {
      const t = segment > 0 ? (target - travelled) / segment : 0;
      return {
        x: path[index].x + (path[index + 1].x - path[index].x) * t,
        z: path[index].z + (path[index + 1].z - path[index].z) * t,
      };
    }
    travelled += segment;
  }
  return path[path.length - 1];
}

export function buildRailingGeometry(
  id: string,
  points: CurtainPoint[],
  height: number,
  material = new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.6, roughness: 0.3 }),
): RailingGeometryBuildResult | null {
  if (points.length < 2 || height <= 0) return null;
  const sampled = samplePath(points);
  if (sampled.path.length < 2) return null;

  const group = new THREE.Group();
  setSceneObjectMetadata(group, 'railing_run', id);
  group.userData.geometrySource = 'shared_railing';
  group.userData.geometryMode = sampled.geometryMode;
  group.userData.collision = false;

  const handrail = new THREE.Group();
  setSceneObjectMetadata(handrail, 'railing_run', `${id}:handrail`, `${id}:part=handrail:role=railing`);
  handrail.userData.part = 'handrail';
  handrail.userData.materialRole = 'railing';
  for (let index = 0; index < sampled.path.length - 1; index++) {
    const a = sampled.path[index];
    const b = sampled.path[index + 1];
    const mesh = cylinderBetween(new THREE.Vector3(a.x, height - HANDRAIL_RADIUS, a.z), new THREE.Vector3(b.x, height - HANDRAIL_RADIUS, b.z), HANDRAIL_RADIUS, material);
    if (mesh) {
      setSceneObjectMetadata(mesh, 'railing_run', `${id}:handrail:${index}`, `${id}:part=handrail:${index}:role=railing`);
      mesh.userData.part = `handrail:${index}`;
      mesh.userData.materialRole = 'railing';
      handrail.add(mesh);
    }
  }
  group.add(handrail);

  const totalLength = sampled.path.reduce((total, point, index) => index === 0 ? total : total + distance(sampled.path[index - 1], point), 0);
  const barCount = Math.max(2, Math.floor(totalLength / BAR_SPACING) + 1);
  const barHeight = Math.max(0, height - 2 * BAR_RADIUS);
  for (let index = 0; index < barCount; index++) {
    const point = pointAtDistance(sampled.path, totalLength * index / (barCount - 1));
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(BAR_RADIUS, BAR_RADIUS, barHeight, 8), material);
    bar.position.set(point.x, barHeight / 2, point.z);
    setSceneObjectMetadata(bar, 'railing_run', `${id}:bar:${index}`, `${id}:part=bar:${index}:role=railing`);
    bar.userData.part = `bar:${index}`;
    bar.userData.materialRole = 'railing';
    group.add(bar);
  }

  return { group, geometryMode: sampled.geometryMode, path: sampled.path };
}
