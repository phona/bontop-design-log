export interface SpawnRoom {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export function findRoomAt(
  point: { x: number; z: number },
  rooms: SpawnRoom[],
): SpawnRoom | null {
  for (const r of rooms) {
    const hw = r.width / 2;
    const hd = r.depth / 2;
    if (
      point.x >= r.x - hw && point.x <= r.x + hw &&
      point.z >= r.z - hd && point.z <= r.z + hd
    ) {
      return r;
    }
  }
  return null;
}

export interface HitLike {
  roomId?: string;
  type?: string;
}

export function pickRoomIdFromHits(hits: HitLike[]): string | null {
  for (const h of hits) {
    const id = h.roomId;
    const t = h.type;
    if (id && id !== 'elevator_shaft' && (t === 'floor' || t === 'floor_region')) {
      return id;
    }
  }
  return null;
}

export function resolveSpawnRoom(
  pointerRoomId: string | null | undefined,
  target: { x: number; z: number },
  rooms: SpawnRoom[],
  fallback: SpawnRoom | null,
): SpawnRoom | null {
  const pointerRoom = pointerRoomId ? rooms.find((r) => r.id === pointerRoomId) : undefined;
  const targetRoom = findRoomAt(target, rooms);
  return pointerRoom ?? targetRoom ?? fallback;
}
