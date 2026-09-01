export interface WallSegment { x1: number; z1: number; x2: number; z2: number }
export interface RoomRect { id: string; x: number; z: number; width: number; depth: number }
export interface Interval { min: number; max: number }
export interface RoomEdge { roomId: string; side: 'north' | 'south' | 'east' | 'west'; pos: number; min: number; max: number }

const TOLERANCE = 0.05;

export function wallBounds(walls: WallSegment[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...walls.flatMap((wall) => [wall.x1, wall.x2])),
    maxX: Math.max(...walls.flatMap((wall) => [wall.x1, wall.x2])),
    minZ: Math.min(...walls.flatMap((wall) => [wall.z1, wall.z2])),
    maxZ: Math.max(...walls.flatMap((wall) => [wall.z1, wall.z2])),
  };
}

export function mergeIntervals(intervals: Interval[], tolerance = TOLERANCE): Interval[] {
  const sorted = intervals.map((interval) => ({ ...interval })).sort((a, b) => a.min - b.min || a.max - b.max);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.min <= previous.max + tolerance) previous.max = Math.max(previous.max, interval.max);
    else merged.push(interval);
  }
  return merged;
}

export function mergeCollinearWalls(walls: WallSegment[], tolerance = TOLERANCE): WallSegment[] {
  const horizontal = new Map<number, Interval[]>();
  const vertical = new Map<number, Interval[]>();
  const other: WallSegment[] = [];
  for (const wall of walls) {
    if (Math.abs(wall.z1 - wall.z2) <= tolerance) {
      const key = wall.z1;
      horizontal.set(key, [...(horizontal.get(key) ?? []), { min: Math.min(wall.x1, wall.x2), max: Math.max(wall.x1, wall.x2) }]);
    } else if (Math.abs(wall.x1 - wall.x2) <= tolerance) {
      const key = wall.x1;
      vertical.set(key, [...(vertical.get(key) ?? []), { min: Math.min(wall.z1, wall.z2), max: Math.max(wall.z1, wall.z2) }]);
    } else other.push(wall);
  }
  return [
    ...[...horizontal].flatMap(([z, intervals]) => mergeIntervals(intervals, tolerance).map(({ min, max }) => ({ x1: min, z1: z, x2: max, z2: z }))),
    ...[...vertical].flatMap(([x, intervals]) => mergeIntervals(intervals, tolerance).map(({ min, max }) => ({ x1: x, z1: min, x2: x, z2: max }))),
    ...other,
  ];
}

export function checkEdgeAlignment(edge: RoomEdge, walls: WallSegment[], tolerance = TOLERANCE): { ok: boolean; coverage: Interval[] } {
  const intervals = walls.flatMap((wall) => {
    const horizontal = edge.side === 'north' || edge.side === 'south';
    if (horizontal && Math.abs(wall.z1 - wall.z2) <= tolerance && Math.abs(wall.z1 - edge.pos) <= tolerance) {
      return [{ min: Math.min(wall.x1, wall.x2), max: Math.max(wall.x1, wall.x2) }];
    }
    if (!horizontal && Math.abs(wall.x1 - wall.x2) <= tolerance && Math.abs(wall.x1 - edge.pos) <= tolerance) {
      return [{ min: Math.min(wall.z1, wall.z2), max: Math.max(wall.z1, wall.z2) }];
    }
    return [];
  });
  const coverage = mergeIntervals(intervals, tolerance);
  return { ok: coverage.some((interval) => interval.min <= edge.min + tolerance && interval.max >= edge.max - tolerance), coverage };
}

export function validateRoomWallAlignment(rooms: RoomRect[], walls: WallSegment[], tolerance = TOLERANCE): { ok: boolean; messages: string[] } {
  const bounds = wallBounds(walls);
  const messages = [`Wall bounding box: x[${bounds.minX},${bounds.maxX}] z[${bounds.minZ},${bounds.maxZ}]`];
  let ok = true;
  for (const room of rooms) {
    const west = room.x - room.width / 2;
    const east = room.x + room.width / 2;
    const north = room.z - room.depth / 2;
    const south = room.z + room.depth / 2;
    if (west < bounds.minX - tolerance || east > bounds.maxX + tolerance || north < bounds.minZ - tolerance || south > bounds.maxZ + tolerance) {
      ok = false;
      messages.push(`${room.id}: OUTSIDE WALLS`);
      continue;
    }
    const edges: RoomEdge[] = [
      { roomId: room.id, side: 'north', pos: north, min: west, max: east },
      { roomId: room.id, side: 'south', pos: south, min: west, max: east },
      { roomId: room.id, side: 'west', pos: west, min: north, max: south },
      { roomId: room.id, side: 'east', pos: east, min: north, max: south },
    ];
    for (const edge of edges) {
      if (!checkEdgeAlignment(edge, walls, tolerance).ok) {
        ok = false;
        messages.push(`${room.id}/${edge.side}: MISALIGNED`);
      }
    }
  }
  if (rooms.every((room) => room.x - room.width / 2 >= bounds.minX - tolerance && room.x + room.width / 2 <= bounds.maxX + tolerance && room.z - room.depth / 2 >= bounds.minZ - tolerance && room.z + room.depth / 2 <= bounds.maxZ + tolerance)) {
    messages.push('All rooms are inside wall bounds');
  }
  return { ok, messages };
}
