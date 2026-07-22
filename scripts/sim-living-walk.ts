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

interface AABB { minX:number; maxX:number; minZ:number; maxZ:number; orig:string; }
const aabbs: AABB[] = [];
for (const w of walls) {
  const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) continue;
  const ux = dx/len, uz = dz/len;
  const doors = (w.openings ?? []).filter((o:any)=>o.type==='door');
  const isH = Math.abs(ux) > Math.abs(uz);
  const gaps = doors.map((o:any)=>{const t=(o.x-w.x1)*ux+(o.z-w.z1)*uz; return {min:t-o.width/2,max:t+o.width/2};}).sort((a:any,b:any)=>a.min-b.min);
  const segs2: any[] = [];
  let cursor = 0;
  for (const g of gaps) { if (g.min>cursor) segs2.push({min:cursor,max:g.min}); cursor=Math.max(cursor,g.max); }
  if (cursor<len) segs2.push({min:cursor,max:len});
  for (const seg of segs2) {
    const sx1=w.x1+ux*seg.min, sz1=w.z1+uz*seg.min, sx2=w.x1+ux*seg.max, sz2=w.z1+uz*seg.max;
    const cx=(sx1+sx2)/2, cz=(sz1+sz2)/2;
    const segLen = Math.hypot(sx2-sx1, sz2-sz1);
    if (segLen<0.01) continue;
    let aabb:AABB;
    const orig = resolved.walls.find(rw => Math.abs(rw.x1-w.x1)<0.01 && Math.abs(rw.z1-w.z1)<0.01 && Math.abs(rw.x2-w.x2)<0.01 && Math.abs(rw.z2-w.z2)<0.01)?.id ?? w.id;
    if (isH) {
      aabb = { orig, minX: Math.min(sx1,sx2)-WALL_THICKNESS/2, maxX: Math.max(sx1,sx2)+WALL_THICKNESS/2, minZ: cz-WALL_THICKNESS/2, maxZ: cz+WALL_THICKNESS/2 };
    } else {
      aabb = { orig, minX: cx-WALL_THICKNESS/2, maxX: cx+WALL_THICKNESS/2, minZ: Math.min(sz1,sz2)-WALL_THICKNESS/2, maxZ: Math.max(sz1,sz2)+WALL_THICKNESS/2 };
    }
    aabbs.push(aabb);
  }
}

function collidesAt(x:number, z:number): string[] {
  const hits: string[] = [];
  for (const wall of aabbs) {
    const closestX = Math.max(wall.minX, Math.min(x, wall.maxX));
    const closestZ = Math.max(wall.minZ, Math.min(z, wall.maxZ));
    const dx = x-closestX, dz = z-closestZ;
    if (dx*dx + dz*dz <= PLAYER_RADIUS*PLAYER_RADIUS) hits.push(wall.orig);
  }
  return hits;
}

// 模拟 tryMove
function tryMove(fromX:number, fromZ:number, dx:number, dz:number): {x:number,z:number,hit:string[]} {
  const desX = fromX+dx, desZ = fromZ+dz;
  let hit = collidesAt(desX, desZ);
  if (hit.length === 0) return {x:desX, z:desZ, hit:[]};
  hit = collidesAt(desX, fromZ);
  if (hit.length === 0) return {x:desX, z:fromZ, hit:hit};
  hit = collidesAt(fromX, desZ);
  if (hit.length === 0) return {x:fromX, z:desZ, hit:hit};
  return {x:fromX, z:fromZ, hit:hit};
}

// 模拟从入户花园走到客厅中央的路径
console.log('=== 模拟路径：入户花园 → 客厅 ===');
const path: [number, number, string][] = [
  [12.30, 1.45, '入户花园中央'],
  [12.30, 2.50, '入户花园近南门'],
  [12.30, 2.90, '入户花园南门 d_ent'],
  [12.30, 3.60, '过渡区中央'],
  [12.30, 4.20, '过渡区近客厅'],
  [12.30, 4.30, '过渡区→客厅边界'],
  [12.30, 4.50, '客厅北缘'],
  [12.30, 5.00, '客厅北部'],
  [12.30, 6.00, '客厅中北'],
  [12.30, 7.05, '客厅中央偏东'],
  [10.30, 7.05, '客厅中央'],
  [10.30, 5.00, '客厅北部中央'],
  [10.30, 4.50, '客厅北缘中央'],
  [10.30, 4.30, '客厅北边界中央'],
  [10.30, 4.00, '过渡区中央偏西'],
  [10.50, 4.00, '过渡区偏西'],
  [10.80, 4.00, '过渡区西墙附近'],
  [11.00, 4.00, '过渡区→客厅西路径'],
];
for (const [x, z, name] of path) {
  const hits = collidesAt(x, z);
  console.log(`  (${x.toFixed(2)}, ${z.toFixed(2)}) ${name}: ${hits.length===0 ? '自由' : '被 '+hits.join(',')+' 挡'}`);
}

console.log('\n=== 模拟 WASD 移动：从客厅中央 (10.30, 7.05) 朝北走 ===');
let x = 10.30, z = 7.05;
for (let i = 0; i < 20; i++) {
  const result = tryMove(x, z, 0, -0.2); // 朝北 (z 减小)
  if (result.x === x && result.z === z) {
    console.log(`  step ${i+1}: (${x.toFixed(2)}, ${z.toFixed(2)}) 卡住！被 ${result.hit.join(',')} 挡`);
    break;
  }
  x = result.x; z = result.z;
  if (i % 3 === 0 || result.hit.length > 0) {
    console.log(`  step ${i+1}: → (${x.toFixed(2)}, ${z.toFixed(2)}) ${result.hit.length>0?'slide '+result.hit.join(','):''}`);
  }
}
