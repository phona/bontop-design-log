import type { SceneElement } from '../types.js';

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LayoutBoundsRect {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface LayoutBoundsInput {
  rooms: LayoutBoundsRect[];
  platform?: LayoutBoundsRect;
  elements?: SceneElement[];
  wallThickness?: number;
  glassThickness?: number;
  defaultBounds?: LayoutBounds;
}

export const DEFAULT_LAYOUT_BOUNDS: LayoutBounds = { minX: -1.6, maxX: 16.4, minZ: -2.9, maxZ: 12.0 };

export function computeLayoutBounds(input: LayoutBoundsInput): LayoutBounds {
  const rects = [...input.rooms];
  if (input.platform) rects.push(input.platform);
  const wallThickness = input.wallThickness ?? 0.12;
  const glassThickness = input.glassThickness ?? 0.024;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const include = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const rect of rects) {
    include(rect.x - rect.width / 2, rect.z - rect.depth / 2);
    include(rect.x + rect.width / 2, rect.z + rect.depth / 2);
  }
  const expandSegment = (x1: number, z1: number, x2: number, z2: number, halfThickness: number) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    if (length < 1e-9) return;
    const nx = (-dz / length) * halfThickness;
    const nz = (dx / length) * halfThickness;
    include(x1 + nx, z1 + nz); include(x1 - nx, z1 - nz);
    include(x2 + nx, z2 + nz); include(x2 - nx, z2 - nz);
  };
  const includePoints = (points: Array<{ x: number; z: number }>) => points.forEach((point) => include(point.x, point.z));
  for (const element of input.elements ?? []) {
    switch (element.type) {
      case 'wall':
        expandSegment(element.x1, element.z1, element.x2, element.z2, wallThickness / 2);
        break;
      case 'wall_run':
        for (let i = 0; i < element.points.length - 1; i++) expandSegment(element.points[i].x, element.points[i].z, element.points[i + 1].x, element.points[i + 1].z, wallThickness / 2);
        break;
      case 'curtain_run':
      case 'shower_screen':
        for (let i = 0; i < element.points.length - 1; i++) expandSegment(element.points[i].x, element.points[i].z, element.points[i + 1].x, element.points[i + 1].z, glassThickness / 2);
        break;
      case 'floor_region':
      case 'bay_sill':
      case 'railing_run':
      case 'curtain':
      case 'sliding_door_run':
      case 'hinged_glass_door':
        includePoints(element.points);
        break;
      case 'glass_infill':
        break;
      case 'frosted_privacy':
        includePoints(element.points);
        break;
      default: {
        const exhaustive: never = element;
        throw new Error(`Unknown scene element type in bounds: ${(exhaustive as { type: string }).type}`);
      }
    }
  }
  return minX === Infinity ? (input.defaultBounds ?? DEFAULT_LAYOUT_BOUNDS) : { minX, maxX, minZ, maxZ };
}
