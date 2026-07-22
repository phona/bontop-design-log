import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../server/layout-resolver.js';
import type { RoomLayout } from '../shared/types.js';

const geo = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as any;
const resolved = resolveLayout(geo);

const PLAYER_RADIUS = 0.3;
const WALL_THICKNESS = 0.12;

// RoomLayout collision (a8946ef version)
const aabbs: {orig:string, minX:number, maxX:number, minZ:number, maxZ:number}[] = [];
for (const r of resolved.rooms) {
  const halfW = r.width / 2;
  const halfD = r.depth / 2;
  // 4 walls per room
  aabbs.push({orig:r.id+'-N', minX: r.x-halfW, maxX: r.x+halfW, minZ: r.z-halfD-WALL_THICKNESS/2, maxZ: r.z-halfD+WALL_THICKNESS/2});
  aabbs.push({orig:r.id+'-S', minX: r.x-halfW, maxX: r.x+halfW, minZ: r.z+halfD-WALL_THICKNESS/2, maxZ: r.z+halfD+WALL_THICKNESS/2});
  aabbs.push({orig:r.id+'-W', minX: r.x-halfW-WALL_THICKNESS/2, maxX: r.x-halfW+WALL_THICKNESS/2, minZ: r.z-halfD, maxZ: r.z+halfD});
  aabbs.push({orig:r.id+'-E', minX: r.x+halfW-WALL_THICKNESS/2, maxX: r.x+halfW+WALL_THICKNESS/2, minZ: r.z-halfD, maxZ: r.z+halfD});
}

function collidesAt(x:number, z:number): string[] {
  const hits: string[] = [];
  for (const w of aabbs) {
    const closestX = Math.max(w.minX, Math.min(x, w.maxX));
    const closestZ = Math.max(w.minZ, Math.min(z, w.maxZ));
    const dx = x-closestX, dz = z-closestZ;
    if (dx*dx + dz*dz <= PLAYER_RADIUS*PLAYER_RADIUS) hits.push(w.orig);
  }
  return hits;
}

// 客厅 boundary: x=7.20→13.40, z=4.30→9.80
const LIVING = { x1: 7.20, x2: 13.40, z1: 4.30, z2: 9.80 };

console.log('=== RoomLayout 版本：客厅内 collision 检查 ===');
console.log('所有房间 AABB 入侵客厅的：');
for (const w of aabbs) {
  if (w.minX < LIVING.x2 && w.maxX > LIVING.x1 && w.minZ < LIVING.z2 && w.maxZ > LIVING.z1) {
    const ovMinX = Math.max(w.minX, LIVING.x1);
    const ovMaxX = Math.min(w.maxX, LIVING.x2);
    const ovMinZ = Math.max(w.minZ, LIVING.z1);
    const ovMaxZ = Math.min(w.maxZ, LIVING.z2);
    if (ovMaxX-ovMinX > 0.001 && ovMaxZ-ovMinZ > 0.001) {
      console.log(`  ${w.orig}: AABB x=[${w.minX.toFixed(2)},${w.maxX.toFixed(2)}] z=[${w.minZ.toFixed(2)},${w.maxZ.toFixed(2)}] 入侵客厅 (${((ovMaxX-ovMinX)*(ovMaxZ-ovMinZ)).toFixed(3)}m²)`);
    }
  }
}

console.log('\n=== 客厅内关键点 collision ===');
const tests: [number, number, string][] = [
  [10.30, 7.05, '客厅中央'],
  [10.30, 5.00, '客厅北部'],
  [10.30, 4.50, '客厅北缘'],
  [10.30, 4.30, '客厅北边界'],
  [12.30, 4.30, '过渡区→客厅'],
  [10.30, 9.50, '客厅南缘'],
  [10.30, 9.80, '客厅南边界'],
];
for (const [x, z, name] of tests) {
  const hits = collidesAt(x, z);
  console.log(`  (${x.toFixed(2)}, ${z.toFixed(2)}) ${name}: ${hits.length===0 ? '自由' : '被 '+hits.join(',')+' 挡'}`);
}

// 打印所有房间
console.log('\n=== 所有房间 RoomLayout ===');
for (const r of resolved.rooms) {
  console.log(`  ${r.id}: center=(${r.x.toFixed(2)},${r.z.toFixed(2)}) ${r.width.toFixed(2)}x${r.depth.toFixed(2)} → AABB x=[${(r.x-r.width/2).toFixed(2)},${(r.x+r.width/2).toFixed(2)}] z=[${(r.z-r.depth/2).toFixed(2)},${(r.z+r.depth/2).toFixed(2)}]`);
}
