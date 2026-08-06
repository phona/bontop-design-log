import type { WallSegment } from '@shared/types';

interface SceneElementLike {
  type: string;
  id: string;
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  openings?: Array<{ id: string; type: string; x: number; z: number; width: number; height: number }>;
  points?: Array<{ x: number; z: number }>;
  open?: boolean;
}

export function extractCollisionWalls(sceneElements: SceneElementLike[] | undefined): WallSegment[] {
  if (!sceneElements) return [];
  const walls: WallSegment[] = [];

  for (const el of sceneElements) {
    if (el.type === 'wall') {
      walls.push({
        id: el.id,
        x1: el.x1!,
        z1: el.z1!,
        x2: el.x2!,
        z2: el.z2!,
        segments: el.segments,
        openings: el.openings,
      });
    } else if (el.type === 'curtain_run' && el.points && el.points.length >= 2) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i];
        const b = el.points[i + 1];
        walls.push({
          id: `${el.id}:col:${i}`,
          x1: a.x,
          z1: a.z,
          x2: b.x,
          z2: b.z,
        });
      }
    } else if (el.type === 'sliding_door_run' && el.open === false && el.points && el.points.length >= 2) {
      for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i];
        const b = el.points[i + 1];
        walls.push({
          id: `${el.id}:col:${i}`,
          x1: a.x,
          z1: a.z,
          x2: b.x,
          z2: b.z,
        });
      }
    }
  }
  return walls;
}
