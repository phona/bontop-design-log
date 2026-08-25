export type Point = { x: number; z: number };

export type PlacementWall = {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  openings?: PlacementOpening[];
};

export type PlacementOpening = {
  id: string;
  type: string;
  x: number;
  z: number;
  width: number;
};

export type PlacementItem = {
  id: string;
  wall?: string;
  wall_side?: 'north' | 'south' | 'east' | 'west';
  x?: number;
  z?: number;
};

export type PlacementIssue = {
  level: 'error' | 'warning';
  id: string;
  wall?: string;
  opening?: string;
  distance?: number;
  message: string;
};

const EPS = 1e-9;
const WALL_SIDES = new Set(['north', 'south', 'east', 'west']);
const OPENING_TYPES = new Set(['door', 'cased_opening', 'sliding_door']);

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function checkWallPointPlacements(
  walls: PlacementWall[],
  items: PlacementItem[],
  suppressedWalls: Set<string>,
  tolerance = 0.15,
): PlacementIssue[] {
  const wallMap = new Map(walls.map(w => [w.id, w]));
  const issues: PlacementIssue[] = [];

  for (const item of items) {
    if (!item.wall || typeof item.x !== 'number' || typeof item.z !== 'number') continue;

    const wall = wallMap.get(item.wall);
    if (!wall) {
      issues.push({ level: 'error', id: item.id, wall: item.wall, message: `引用未知墙 ${item.wall}` });
      continue;
    }
    if (suppressedWalls.has(item.wall)) {
      issues.push({ level: 'error', id: item.id, wall: item.wall, message: `引用已 suppress 墙 ${item.wall}` });
    }
    if (item.wall_side && !WALL_SIDES.has(item.wall_side)) {
      issues.push({ level: 'error', id: item.id, wall: item.wall, message: `非法墙面侧别 ${item.wall_side}` });
    }

    const a = { x: wall.x1, z: wall.z1 };
    const b = { x: wall.x2, z: wall.z2 };
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const len = Math.sqrt(lenSq) || 1;
    const rawT = ((item.x - a.x) * dx + (item.z - a.z) * dz) / lenSq;
    const t = Math.max(0, Math.min(1, rawT));
    const projection = { x: a.x + t * dx, z: a.z + t * dz };
    const lineDistance = distance({ x: item.x, z: item.z }, projection);
    const outside = rawT < -EPS || rawT > 1 + EPS;

    if (outside || lineDistance > tolerance) {
      issues.push({
        level: 'warning',
        id: item.id,
        wall: item.wall,
        distance: lineDistance,
        message: outside
          ? `投影超出墙段（距墙线 ${lineDistance.toFixed(2)}m）`
          : `离墙线垂直距离 ${lineDistance.toFixed(2)}m`,
      });
      continue;
    }

    const sideOffset = (item.x - projection.x) * (-dz / len) + (item.z - projection.z) * (dx / len);
    if (!item.wall_side && Math.abs(sideOffset) <= EPS) {
      issues.push({ level: 'warning', id: item.id, wall: item.wall, distance: Math.abs(sideOffset), message: '缺少墙面侧别' });
    }

    const along = t * len;
    const endpointDistance = Math.min(along, len - along);
    if (endpointDistance < tolerance) {
      issues.push({
        level: 'warning',
        id: item.id,
        wall: item.wall,
        distance: endpointDistance,
        message: `距墙段端点 ${endpointDistance.toFixed(2)}m`,
      });
    }

    for (const opening of wall.openings ?? []) {
      const openingType = opening.type;
      if (!OPENING_TYPES.has(openingType)) continue;
      const openingCenterAlong = ((opening.x - a.x) * dx + (opening.z - a.z) * dz) / len;
      const openingHalfWidth = opening.width / 2;
      const itemAlong = ((item.x - a.x) * dx + (item.z - a.z) * dz) / len;
      const edgeDistance = Math.min(
        Math.abs(itemAlong - (openingCenterAlong - openingHalfWidth)),
        Math.abs(itemAlong - (openingCenterAlong + openingHalfWidth)),
      );
      const inside = itemAlong >= openingCenterAlong - openingHalfWidth - EPS &&
        itemAlong <= openingCenterAlong + openingHalfWidth + EPS;
      if (inside) {
        issues.push({
          level: 'error',
          id: item.id,
          wall: item.wall,
          opening: opening.id,
          distance: Math.max(0, edgeDistance),
          message: `落入 ${openingType} opening（距洞口边缘 ${Math.max(0, edgeDistance).toFixed(2)}m）`,
        });
      } else if (edgeDistance < tolerance - EPS) {
        issues.push({
          level: 'warning',
          id: item.id,
          wall: item.wall,
          opening: opening.id,
          distance: edgeDistance,
          message: `距 opening 边缘 ${edgeDistance.toFixed(2)}m`,
        });
      }
    }
  }
  return issues;
}

export function formatPlacementIssue(issue: PlacementIssue): string {
  const details = [
    `id=${issue.id}`,
    issue.wall ? `wall=${issue.wall}` : undefined,
    issue.opening ? `opening=${issue.opening}` : undefined,
    issue.distance !== undefined ? `distance=${issue.distance.toFixed(2)}m` : undefined,
  ].filter(Boolean).join(' ');
  return `${details} ${issue.message}`;
}

export function placementIssueCounts(issues: PlacementIssue[]): { errors: number; warnings: number } {
  return issues.reduce(
    (counts, issue) => {
      if (issue.level === 'error') counts.errors++;
      else counts.warnings++;
      return counts;
    },
    { errors: 0, warnings: 0 },
  );
}

export function pointDistance(a: Point, b: Point): number {
  return distance(a, b);
}

export function openingEdgeDistance(itemAlong: number, openingCenterAlong: number, width: number): number {
  return Math.min(
    Math.abs(itemAlong - (openingCenterAlong - width / 2)),
    Math.abs(itemAlong - (openingCenterAlong + width / 2)),
  );
}

