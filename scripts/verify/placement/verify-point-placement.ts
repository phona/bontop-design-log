/**
 * 点位墙侧/端点/洞口专项（verify:consistency 的点位段）。
 *
 * 2026-11-07 issue #98 第四阶段 S1（设计文档 §4.4）：点位改沿墙声明（wall + wall_side + along）
 * 后，本检查从「把声明 x/z 投影回墙段再判」改为 **along 直接对 openingsAlongWall 的 span 表
 * 判定**——不再靠投影反推。理由：x/z 是迁移期断言字段（解析结果与声明值差 >0.005m 由
 * tests/server/point-placement.test.ts 固化），投影反推等于把第二事实源又请回来；而沿墙
 * 合法性（越界/端点/洞口/渲染面）本来就只取决于 along 与 wall_side。
 *
 * 保留的语义：A4-b「几何坏了也不跳过后续语义检查」（2026-10-04）——越界/缺声明照记，
 * 侧别、渲染面、端点、洞口检查继续跑；唯一不刷屏的是「距墙段端点」：不钳位时它由 along
 * 直接给出，不是 clamp 的必然复读。
 */

import { openingsAlongWall, pointAlongPolyline, polylineLength, wallFaceOffset, type WallOpeningSpan } from '../../../shared/wall-segments.js';

export type Point = { x: number; z: number };

export type PlacementWall = {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  openings?: PlacementOpening[];
  /** 墙线基准（model-geometry line_datum 透传）：完成面偏移解算用，缺声明即抛错（口径 A）。 */
  line_datum?: 'centerline';
};

export type PlacementOpening = {
  id: string;
  type: string;
  x: number;
  z: number;
  width: number;
  height?: number;
  sill?: number;
};

export type PlacementItem = {
  id: string;
  room?: string;
  wall?: string;
  wall_side?: 'north' | 'south' | 'east' | 'west';
  along?: number;
  face_offset?: number;
  x?: number;
  z?: number;
  status?: 'measured' | 'likely' | 'inferred' | 'pending';
  position_status?: 'measured' | 'likely' | 'inferred' | 'pending';
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
/** 全高洞口（门/垭口/推拉门）：点位不得落入。窗（窗台高）不在此列——面盘高度低于窗台。 */
const OPENING_TYPES = new Set(['door', 'cased_opening', 'sliding_door']);
const SIDE_VECTORS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
} as const;

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function wallSideAxis(dx: number, dz: number): 'horizontal' | 'vertical' | undefined {
  if (Math.abs(dx) <= SIDE_AXIS_EPS && Math.abs(dz) > SIDE_AXIS_EPS) return 'vertical';
  if (Math.abs(dz) <= SIDE_AXIS_EPS && Math.abs(dx) > SIDE_AXIS_EPS) return 'horizontal';
  return undefined;
}

/** 该墙的洞口沿墙区间（复用 S2 唯一入口 openingsAlongWall；只取全高洞口，窗不挡面盘）。 */
function openingSpans(wall: PlacementWall): WallOpeningSpan[] {
  const openings = (wall.openings ?? [])
    .filter((opening) => OPENING_TYPES.has(opening.type))
    .map((opening) => ({
      id: opening.id,
      type: opening.type,
      x: opening.x,
      z: opening.z,
      width: opening.width,
      // 全高洞口自完成面起算（与 openingSill 的门洞默认值同口径），高度只影响 span 的 top 字段
      height: opening.height ?? 2.0,
      sill: opening.sill ?? 0,
    }));
  return openingsAlongWall({
    id: wall.id,
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    ...(wall.segments?.length ? { segments: wall.segments } : {}),
    openings,
  });
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
    if (!item.wall) continue;

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

    const segments = wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    const total = polylineLength(segments);
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const axis = wallSideAxis(dx, dz);

    // 沿墙合法性只由 along 与 wall_side 决定（设计文档 §4.4：along 直接对洞口 span 判定）。
    // 缺 along = 定位声明不完整（x/z 是断言字段，不是定位来源）；越界即报，不钳位。
    const pendingPosition = item.status === 'pending' || item.position_status === 'pending';
    if (typeof item.along !== 'number' || !Number.isFinite(item.along)) {
      issues.push({
        level: 'error',
        id: item.id,
        wall: item.wall,
        message: `${pendingPosition ? '待现场裁定点位' : '点位'}缺 along 声明（wall + wall_side + along 是唯一定位来源；x/z 只是迁移期断言字段）`,
      });
      continue;
    }
    if (item.along < -EPS || item.along > total + EPS) {
      issues.push({
        level: pendingPosition ? 'error' : 'warning',
        id: item.id,
        wall: item.wall,
        distance: Math.max(0, Math.max(-item.along, item.along - total)),
        message: `along=${item.along.toFixed(3)} 越出墙段（沿墙总长 ${total.toFixed(3)}m；不钳位，请修正声明或改挂宿主墙）`,
      });
    }

    const along = Math.min(Math.max(0, item.along), total);
    const datum = pointAlongPolyline(segments, along);
    if (item.wall_side === undefined && datum) {
      issues.push({ level: 'warning', id: item.id, wall: item.wall, distance: 0, message: '缺少墙面侧别' });
    }

    // 渲染面 vs 房间实际面：沿墙点位由 wall_side 定法线，与所属房间质心异侧即报错
    // （坐标压墙线 + 缺 wall_side 时会渲到背面）。
    const roomCentroid = item.room ? roomCentroids?.get(item.room) : undefined;
    if (roomCentroid && datum && axis) {
      const left = { x: -dz / Math.hypot(dx, dz), z: dx / Math.hypot(dx, dz) };
      let normalSign: number;
      if (item.wall_side) {
        const expected = SIDE_VECTORS[item.wall_side as keyof typeof SIDE_VECTORS];
        normalSign = Math.sign(expected.x * left.x + expected.z * left.z) || 1;
      } else {
        // 缺 wall_side：按 face_offset 的符号推侧别（完成面在墙线正侧，负偏移穿到另一侧）
        const offset = (wallFaceOffset(wall) + (item.face_offset ?? 0));
        normalSign = offset < -EPS ? -1 : 1;
      }
      const roomSign = Math.sign((roomCentroid.x - datum.x) * left.x + (roomCentroid.z - datum.z) * left.z);
      if (roomSign !== 0 && normalSign !== roomSign) {
        issues.push({
          level: 'error',
          id: item.id,
          wall: item.wall,
          message: `渲染面与所属房间 ${item.room} 异侧（应朝房间一侧，请检查/补声明 wall_side）`,
        });
      }
    }

    // 离墙线距离：完成面 + face_offset 是显式声明，异常值（如 0.15m）仍要显形——
    // 它不再是「x/z 与墙线的偏差」，而是点位离开完成面的意图量。
    try {
      const offset = wallFaceOffset(wall) + (item.face_offset ?? 0);
      // 边界含等于（sock_gbath_robot 的 0.15m 是真实异常值：点站在离完成面 82mm 处，
      // 迁机器人仓侧面后坐标待定）——显形比容差浮点更重要。
      if (Math.abs(offset) >= tolerance - EPS) {
        issues.push({
          level: 'warning',
          id: item.id,
          wall: item.wall,
          distance: Math.abs(offset),
          message: `点位离墙线垂直距离 ${Math.abs(offset).toFixed(2)}m（完成面 ${wallFaceOffset(wall).toFixed(3)}m + face_offset ${(item.face_offset ?? 0).toFixed(3)}m）`,
        });
      }
    } catch (error) {
      issues.push({
        level: 'error',
        id: item.id,
        wall: item.wall,
        message: `完成面偏移无法解算：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // 越界时不再报「距墙段端点」：那只是同一次失败的复读（2026-10-04 A4-b 的防刷屏口径），
    // 且本检查不钳位，端点距离对越界 along 没有独立信息量。
    const withinSpan = item.along >= -EPS && item.along <= total + EPS;
    const endpointDistance = Math.min(along, total - along);
    if (withinSpan && endpointDistance < tolerance - EPS) {
      issues.push({
        level: 'warning',
        id: item.id,
        wall: item.wall,
        distance: endpointDistance,
        message: `距墙段端点 ${endpointDistance.toFixed(2)}m`,
      });
    }

    for (const span of openingSpans(wall)) {
      const edgeDistance = Math.min(Math.abs(along - span.from), Math.abs(along - span.to));
      const inside = along >= span.from - EPS && along <= span.to + EPS;
      if (inside) {
        issues.push({
          level: 'error',
          id: item.id,
          wall: item.wall,
          opening: span.id,
          distance: Math.max(0, edgeDistance),
          message: `落入 ${span.kind} opening（距洞口边缘 ${Math.max(0, edgeDistance).toFixed(2)}m）`,
        });
      } else if (edgeDistance < tolerance - EPS) {
        issues.push({
          level: 'warning',
          id: item.id,
          wall: item.wall,
          opening: span.id,
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
