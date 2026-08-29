import type { LightingRenderConfig, TrackLightConfig, TrackLightHeadConfig, TrackLightResolvedHead, Vec3 } from '../types.js';

const DEFAULT_LENGTH = 3.6;
const DEFAULT_HEADS: TrackLightHeadConfig[] = [
  { offset: { x: -1.8, z: 0 }, target: { x: -1.6, y: 0, z: 1.2 } },
  { offset: { x: -0.9, z: 0 }, target: { x: -0.7, y: 0, z: 0.1 } },
  { offset: { x: 0, z: 0 }, target: { x: 0, y: 0, z: 0.8 } },
  { offset: { x: 0.9, z: 0 }, target: { x: 0.8, y: 0, z: 1.4 } },
  { offset: { x: 1.8, z: 0 }, target: { x: 1.5, y: 0, z: 0.4 } },
];

export function getTrackLightConfig(config: LightingRenderConfig | undefined, id: string, legacyHeads?: number): TrackLightConfig {
  const configured = config?.fixtures.find((fixture) => fixture.id === id);
  if (legacyHeads !== undefined && (!configured || configured.heads.length !== legacyHeads)) {
    const heads = legacyHeads === 1 ? [DEFAULT_HEADS[2]] : Array.from({ length: legacyHeads }, (_, index) => ({
      offset: { x: -1.8 + index * (3.6 / (legacyHeads - 1)), z: 0 }, target: DEFAULT_HEADS[Math.min(index, DEFAULT_HEADS.length - 1)].target,
    }));
    return { id, type: 'track_light', length: DEFAULT_LENGTH, heads, target_y_mode: 'relative', direction: { x: 0, y: -1, z: 0 }, beam: 0.7, energy: 9, rotation: { x: 0, y: 0, z: 0 } };
  }
  return configured ?? {
    id, type: 'track_light', length: DEFAULT_LENGTH, heads: DEFAULT_HEADS, target_y_mode: 'relative',
    direction: { x: 0, y: -1, z: 0 }, beam: 0.7, energy: 9, rotation: { x: 0, y: 0, z: 0 },
  };
}

export function getTrackLightHeadPositions(config: LightingRenderConfig | undefined, id: string): TrackLightHeadConfig[] {
  return getTrackLightConfig(config, id).heads;
}

export function rotateTrackLocalPoint(point: { x: number; z: number }, rotationY: number): { x: number; z: number } {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { x: cos * point.x + sin * point.z, z: -sin * point.x + cos * point.z };
}

export interface TrackLightHeadAim {
  position: Vec3;
  target: Vec3;
  direction: Vec3;
}

/** Resolve the same world-space aim used by Web SpotLights and Blender lights. */
export function getTrackLightHeadAim(origin: Vec3, config: TrackLightConfig, head: TrackLightHeadConfig): TrackLightHeadAim {
  const offset = rotateTrackLocalPoint(head.offset, config.rotation.y);
  const target = rotateTrackLocalPoint(head.target, config.rotation.y);
  const position = { x: origin.x + offset.x, y: origin.y - 0.08, z: origin.z + offset.z };
  const targetY = config.target_y_mode === 'absolute' ? head.target.y : origin.y + head.target.y;
  const targetPosition = { x: origin.x + target.x, y: targetY, z: origin.z + target.z };
  const dx = targetPosition.x - position.x;
  const dy = targetPosition.y - position.y;
  const dz = targetPosition.z - position.z;
  const length = Math.hypot(dx, dy, dz);
  const direction = length > 1e-9 ? { x: dx / length, y: dy / length, z: dz / length } : { x: 0, y: -1, z: 0 };
  return { position, target: targetPosition, direction };
}

/** Materialize all positions consumed by Web/GLB and Blender from the YAML layout. */
export function resolveTrackLightHeads(origin: Vec3, config: TrackLightConfig): TrackLightResolvedHead[] {
  return config.heads.map((head) => {
    const aim = getTrackLightHeadAim(origin, config, head);
    const along = (distance: number): Vec3 => ({
      x: aim.position.x + aim.direction.x * distance,
      y: aim.position.y + aim.direction.y * distance,
      z: aim.position.z + aim.direction.z * distance,
    });
    return {
      ...aim,
      mountPosition: along(0.03),
      headPosition: along(0.12),
      lensPosition: along(0.192),
      ...(head.purpose !== undefined ? { purpose: head.purpose } : {}),
      ...(head.role !== undefined ? { role: head.role } : {}),
    };
  });
}

export function getResolvedTrackLightHeads(origin: Vec3, config: TrackLightConfig): TrackLightResolvedHead[] {
  return config.resolvedHeads ?? resolveTrackLightHeads(origin, config);
}

export function offsetPosition(origin: Vec3, offset: { x: number; z: number }, rotationY = 0): Vec3 {
  const rotated = rotateTrackLocalPoint(offset, rotationY);
  return { x: origin.x + rotated.x, y: origin.y, z: origin.z + rotated.z };
}
