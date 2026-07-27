export interface SpawnRoom {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export function pickSpawnRoom(
  target: { x: number; z: number },
  rooms: SpawnRoom[],
  fallback: { x: number; z: number } | null,
): { x: number; z: number } {
  for (const r of rooms) {
    const hw = r.width / 2;
    const hd = r.depth / 2;
    if (
      target.x >= r.x - hw && target.x <= r.x + hw &&
      target.z >= r.z - hd && target.z <= r.z + hd
    ) {
      return { x: target.x, z: target.z };
    }
  }
  return fallback ?? { x: 0, z: 0 };
}
