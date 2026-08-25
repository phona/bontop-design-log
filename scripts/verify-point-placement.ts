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
  room?: string;
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
const SIDE_AXIS_EPS = 1e-6;
const WALL_SIDES = new Set(['north', 'south', 'east', 'west']);
const OPENING_TYPES = new Set(['door', 'cased_opening', 'sliding_door']);
const SIDE_VECTORS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
} as const;

function wallSideAxis(dx: number, dz: number): 'horizontal' | 'vertical' | undefined {
  if (Math.abs(dx) <= SIDE_AXIS_EPS && Math.abs(dz) > SIDE_AXIS_EPS) return 'vertical';
  if (Math.abs(dz) <= SIDE_AXIS_EPS && Math.abs(dx) > SIDE_AXIS_EPS) return 'horizontal';
  return undefined;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function checkWallPointPlacements(
  walls: PlacementWall[],
  items: PlacementItem[],
  suppressedWalls: Set<string>,
  tolerance = 0.15,
  roomCentroids?: Map<string, Point>,
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
    const axis = wallSideAxis(dx, dz);
    if (item.wall_side && axis) {
      const expected = SIDE_VECTORS[item.wall_side];
      const sideSign = Math.sign(sideOffset);
      const expectedSign = Math.sign(expected.x * (-dz / len) + expected.z * (dx / len));
      if (sideSign !== 0 && expectedSign !== 0 && sideSign !== expectedSign) {
        issues.push({ level: 'error', id: item.id, wall: item.wall, distance: Math.abs(sideOffset), message: `点位位于墙线错误侧别：声明 ${item.wall_side}` });
      }
    } else if (item.wall_side && !axis) {
      issues.push({ level: 'warning', id: item.id, wall: item.wall, distance: Math.abs(sideOffset), message: '斜墙无法唯一映射 wall_side，跳过侧别误报' });
    } else if (Math.abs(sideOffset) <= EPS) {
      issues.push({ level: 'warning', id: item.id, wall: item.wall, distance: Math.abs(sideOffset), message: '缺少墙面侧别' });
    }

    // 渲染面 vs 房间实际面：复刻 HouseScene.projectInfrastructurePoint 的侧别逻辑，
    // 渲染法线朝向与所属房间质心异侧即报错（坐标压墙线 + 缺 wall_side 时会渲到背面）。
    const roomCentroid = item.room ? roomCentroids?.get(item.room) : undefined;
    if (roomCentroid && axis) {
      const left = { x: -dz / len, z: dx / len };
      let normalSign: number;
      if (item.wall_side) {
        const expected = SIDE_VECTORS[item.wall_side as keyof typeof SIDE_VECTORS];
        normalSign = Math.sign(expected.x * left.x + expected.z * left.z) || 1;
      } else {
        normalSign = sideOffset < -EPS ? -1 : 1;
      }
      const roomSign = Math.sign((roomCentroid.x - projection.x) * left.x + (roomCentroid.z - projection.z) * left.z);
      if (roomSign !== 0 && normalSign !== roomSign) {
        issues.push({
          level: 'error',
          id: item.id,
          wall: item.wall,
          message: `渲染面与所属房间 ${item.room} 异侧（应朝房间一侧，请检查/补声明 wall_side）`,
        });
      }
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

