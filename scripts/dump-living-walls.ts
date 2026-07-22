import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../server/layout-resolver.js';
import { mergeSceneElements } from '../server/overlay-merge.js';

const geo = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as any;
const overlay = load(readFileSync('config/layout/overlay.yaml', 'utf8')) as any;
const resolved = resolveLayout(geo);
const sceneEls = mergeSceneElements(resolved.walls, overlay);
const walls = sceneEls.filter(e => e.type === 'wall') as any[];

const PLAYER_RADIUS = 0.3;
const WALL_THICKNESS = 0.12;

// 客厅+过渡区范围
const REGION = { x1: 7.0, x2: 14.0, z1: 2.5, z2: 10.5 };

// Replicate buildWallAABBs and check overlap with region
const aabbs: any[] = [];
for (const w of walls) {
  const dx = w.x2 - w.x1;
  const dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) continue;
  const ux = dx / len, uz = dz / len;
  const doors = (w.openings ?? []).filter((o:any)=>o.type === 'door');
  const isHorizontal = Math.abs(ux) > Math.abs(uz);
  const gaps = doors.map((o:any)=>{
    const t = (o.x - w.x1) * ux + (o.z - w.z1) * uz;
    return { min: t - o.width/2, max: t + o.width/2 };
  }).sort((a:any,b:any)=>a.min-b.min);
  // splitRange
  const segs2: any[] = [];
  let cursor = 0;
  for (const g of gaps) {
    if (g.min > cursor) segs2.push({min:cursor, max:g.min});
    cursor = Math.max(cursor, g.max);
  }
  if (cursor < len) segs2.push({min:cursor, max:len});
  for (const seg of segs2) {
    const sx1 = w.x1 + ux * seg.min;
    const sz1 = w.z1 + uz * seg.min;
    const sx2 = w.x1 + ux * seg.max;
    const sz2 = w.z1 + uz * seg.max;
    const cx = (sx1+sx2)/2, cz=(sz1+sz2)/2;
    const segLen = Math.hypot(sx2-sx1, sz2-sz1);
    if (segLen < 0.01) continue;
    let aabb;
    if (isHorizontal) {
      aabb = { minX: Math.min(sx1,sx2) - WALL_THICKNESS/2, maxX: Math.max(sx1,sx2) + WALL_THICKNESS/2, minZ: cz - WALL_THICKNESS/2, maxZ: cz + WALL_THICKNESS/2 };
    } else {
      aabb = { minX: cx - WALL_THICKNESS/2, maxX: cx + WALL_THICKNESS/2, minZ: Math.min(sz1,sz2) - WALL_THICKNESS/2, maxZ: Math.max(sz1,sz2) + WALL_THICKNESS/2 };
    }
    aabbs.push({orig: resolved.walls.find(rw => Math.abs(rw.x1-w.x1)<0.01 && Math.abs(rw.z1-w.z1)<0.01 && Math.abs(rw.x2-w.x2)<0.01 && Math.abs(rw.z2-w.z2)<0.01)?.id ?? w.id, ...aabb});
  }
}

// 测试客厅中央位置是否会被挡
function collidesAt(x:number, z:number) {
  for (const wall of aabbs) {
    const closestX = Math.max(wall.minX, Math.min(x, wall.maxX));
    const closestZ = Math.max(wall.minZ, Math.min(z, wall.maxZ));
    const dx = x - closestX, dz = z - closestZ;
    if (dx*dx + dz*dz <= PLAYER_RADIUS * PLAYER_RADIUS) return wall.orig;
  }
  return null;
}

const tests: [number, number, string][] = [
  [10.30, 7.05, '客厅中央'],
  [10.30, 5.00, '客厅北部中央'],
  [10.30, 4.50, '客厅北缘中央'],
  [10.30, 4.30, '客厅北边界'],
  [10.30, 4.00, '过渡区中央'],
  [12.30, 3.60, '过渡区入户门内'],
  [12.30, 4.30, '过渡区→客厅交界'],
  [10.80, 4.20, '过渡区西墙附近'],
  [11.00, 4.30, '过渡区→客厅西路径'],
  [13.00, 4.30, '过渡区→客厅东路径'],
];
for (const [x, z, name] of tests) {
  const hit = collidesAt(x, z);
  console.log(`(${x.toFixed(2)}, ${z.toFixed(2)}) ${name}: ${hit ? `被 ${hit} 挡住` : '自由'}`);
}
