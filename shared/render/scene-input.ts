import type {
  CeilingZone,
  ElectricalPoint,
  FurnishingsYaml,
  PlumbingPoint,
  ResolvedRoom,
  ResolvedWall,
  SceneElement,
  WallSegment,
} from '../types.js';

export interface SceneInputSource {
  rooms: ReadonlyArray<{
    id: string;
    name: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    type?: string;
    semantic_only?: boolean;
    boundary_count?: number;
    points?: ResolvedRoom['points'];
    wallOpenings?: ResolvedRoom['wallOpenings'];
  }>;
  platform?: SceneInputSource['rooms'][number];
  walls?: ReadonlyArray<ResolvedWall | (WallSegment & { height?: number })>;
  elements?: ReadonlyArray<SceneElement>;
  ceilingZones?: ReadonlyArray<CeilingZone>;
  furnishings?: FurnishingsYaml;
  /** 未按阶段过滤的全量家具：仅用于 mountHosts 定位宿主（阶段可见性与定位宿主是两个关注点）。 */
  furnishingsAll?: FurnishingsYaml;
  electrical?: ReadonlyArray<ElectricalPoint>;
  plumbing?: ReadonlyArray<PlumbingPoint>;
}

export interface SceneInput {
  rooms: ResolvedRoom[];
  platform?: ResolvedRoom;
  walls: Array<WallSegment & { height?: number }>;
  elements: SceneElement[];
  ceilingZones: CeilingZone[];
  furnishings?: FurnishingsYaml;
  /** 未按阶段过滤的全量家具：仅用于 mountHosts 定位宿主，绝不用于几何渲染。 */
  furnishingsAll?: FurnishingsYaml;
  electrical?: ElectricalPoint[];
  plumbing?: PlumbingPoint[];
}

function cloneElement(element: SceneElement): SceneElement {
  const clone = { ...element } as SceneElement & { points?: unknown[]; segments?: unknown[]; openings?: unknown[]; rooms?: string[] };
  if (Array.isArray(clone.points)) clone.points = clone.points.map((point) => ({ ...(point as Record<string, unknown>) }));
  if (Array.isArray(clone.segments)) clone.segments = clone.segments.map((segment) => ({ ...(segment as Record<string, unknown>) }));
  if (Array.isArray(clone.openings)) clone.openings = clone.openings.map((opening) => ({ ...(opening as Record<string, unknown>) }));
  if (Array.isArray(clone.rooms)) clone.rooms = [...clone.rooms];
  if (Array.isArray((clone as { wallRefs?: unknown[] }).wallRefs)) {
    (clone as { wallRefs: unknown[] }).wallRefs = (clone as { wallRefs: unknown[] }).wallRefs.map((ref) => ({
      ...(ref as Record<string, unknown>),
      ...(Array.isArray((ref as { rooms?: string[] }).rooms) ? { rooms: [...(ref as { rooms: string[] }).rooms] } : {}),
      segments: ((ref as { segments: unknown[] }).segments ?? []).map((segment) => ({ ...(segment as Record<string, unknown>) })),
    }));
  }
  return clone;
}

function cloneWall(wall: ResolvedWall | (WallSegment & { height?: number })): WallSegment & { height?: number } {
  const withRooms = wall as typeof wall & { rooms?: string[] };
  return {
    ...wall,
    ...(wall.segments ? { segments: wall.segments.map((segment) => ({ ...segment })) } : {}),
    ...(wall.openings ? { openings: wall.openings.map((opening) => ({ ...opening })) } : {}),
    ...(withRooms.rooms ? { rooms: [...withRooms.rooms] } : {}),
  };
}

function normalizeRoom(room: SceneInputSource['rooms'][number]): ResolvedRoom {
  return {
    ...room,
    type: room.type as ResolvedRoom['type'],
    boundary_count: room.boundary_count ?? 4,
    ...(room.points ? { points: room.points.map((point) => ({ ...point })) } : {}),
    ...(room.wallOpenings ? { wallOpenings: room.wallOpenings.map((opening) => ({ ...opening })) } : {}),
  };
}

function rectangleWalls(rooms: ReadonlyArray<ResolvedRoom>): Array<WallSegment & { height?: number }> {
  const walls: Array<WallSegment & { height?: number }> = [];
  for (const room of rooms) {
    const halfW = room.width / 2;
    const halfD = room.depth / 2;
    walls.push(
      { id: `wall:${room.id}:north`, x1: room.x - halfW, z1: room.z - halfD, x2: room.x + halfW, z2: room.z - halfD, height: room.height, rooms: [room.id] },
      { id: `wall:${room.id}:south`, x1: room.x + halfW, z1: room.z + halfD, x2: room.x - halfW, z2: room.z + halfD, height: room.height, rooms: [room.id] },
      { id: `wall:${room.id}:west`, x1: room.x - halfW, z1: room.z + halfD, x2: room.x - halfW, z2: room.z - halfD, height: room.height, rooms: [room.id] },
      { id: `wall:${room.id}:east`, x1: room.x + halfW, z1: room.z - halfD, x2: room.x + halfW, z2: room.z + halfD, height: room.height, rooms: [room.id] },
    );
  }
  return walls;
}

export function parseSceneInput(source: SceneInputSource): SceneInput {
  const rooms = source.rooms.map(normalizeRoom);
  const suppliedElements = (source.elements ?? []).map(cloneElement);
  let walls = (source.walls ?? []).map(cloneWall);

  if (walls.length === 0) {
    walls = suppliedElements
      .filter((element): element is Extract<SceneElement, { type: 'wall' }> => element.type === 'wall')
      .map((element) => ({
        id: element.id,
        x1: element.x1,
        z1: element.z1,
        x2: element.x2,
        z2: element.z2,
        height: rooms.find((room) => element.rooms?.includes(room.id))?.height ?? rooms[0]?.height ?? 3,
        ...(element.segments ? { segments: element.segments.map((segment) => ({ ...segment })) } : {}),
        ...(element.openings ? { openings: element.openings.map((opening) => ({ ...opening })) } : {}),
        ...(element.rooms ? { rooms: [...element.rooms] } : {}),
        // 墙线基准（口径 A）：场景元素 → 墙对象的映射不许丢 line_datum，否则点位解算的
        // 完成面偏移（shared/point-placement.ts → wallFaceOffset）会 fail-closed 抛错。
        ...(element.line_datum ? { line_datum: element.line_datum } : {}),
      }));
  }
  if (walls.length === 0 && suppliedElements.length === 0) {
    walls = rectangleWalls(rooms.filter((room) => !room.semantic_only));
  }

  const suppliedWallElements = suppliedElements.filter((element) => element.type === 'wall');
  const elementWallIds = new Set(suppliedWallElements.map((element) => element.id));
  const wallElements: SceneElement[] = walls
    .filter((wall) => suppliedWallElements.length === 0 && wall.id !== undefined && !elementWallIds.has(wall.id))
    .map((wall) => ({
      type: 'wall' as const,
      id: wall.id!,
      x1: wall.x1,
      z1: wall.z1,
      x2: wall.x2,
      z2: wall.z2,
      ...(wall.segments ? { segments: wall.segments.map((segment) => ({ ...segment })) } : {}),
      ...(wall.openings ? { openings: wall.openings.map((opening) => ({ ...opening })) } : {}),
      ...(wall.rooms ? { rooms: [...wall.rooms] } : {}),
    }));

  return {
    rooms,
    platform: source.platform ? normalizeRoom(source.platform) : undefined,
    walls,
    elements: [...suppliedElements, ...wallElements],
    ceilingZones: (source.ceilingZones ?? []).map((zone) => ({ ...zone, ...(zone.area ? { area: [...zone.area] as [number, number, number, number] } : {}) })),
    furnishings: source.furnishings,
    // 原样透传（不 clone，与 furnishings 同口径）：漏这一行会让 HouseScene 传进来的全量宿主
    // 在这里静默掉地，SceneBuilder 只能回退阶段过滤清单 → 挂载点位解不出宿主。
    furnishingsAll: source.furnishingsAll,
    electrical: source.electrical?.map((point) => ({ ...point })),
    plumbing: source.plumbing?.map((point) => ({ ...point })),
  };
}

