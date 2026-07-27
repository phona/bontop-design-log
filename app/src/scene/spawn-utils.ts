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
