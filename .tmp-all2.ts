import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '/home/tao/projects/bontop-design-log/server/layout-resolver.js';
import { parseOverlay, mergeSceneElements } from '/home/tao/projects/bontop-design-log/server/overlay-merge.js';
import { buildBaySillGeometry } from '/home/tao/projects/bontop-design-log/shared/render/BaySillGeometry.js';
const MG = load(readFileSync('config/layout/model-geometry.yaml','utf8')) as any;
const layout = resolveLayout(MG);
const merged = mergeSceneElements(layout.walls as any, parseOverlay(readFileSync('config/layout/overlay.yaml','utf8')));
type P={x:number,z:number};
const bays = merged.filter((e:any)=>e.type==='bay_sill').map((e:any)=>{
  const g=buildBaySillGeometry(e.wallRefs, layout.rooms, e.depth);
  return {id:e.id, outline:g.outline as P[], sill:e.sill, h:e.height, n:g.outline.length};
});
// 点在多边形内（射线法）
const inside=(p:P, poly:P[])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];
  if(((a.z>p.z)!==(b.z>p.z)) && (p.x < (b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)) c=!c;}return c;};
// 网格采样求交面积（0.5mm 格，双边取中点点）
const interArea=(A:P[],B:P[],step=0.0005)=>{
  const bx=[...A.map(p=>p.x),...B.map(p=>p.x)], bz=[...A.map(p=>p.z),...B.map(p=>p.z)];
  const x0=Math.min(...bx),x1=Math.max(...bx),z0=Math.min(...bz),z1=Math.max(...bz);
  let n=0; const sx=Math.ceil((x1-x0)/step), sz=Math.ceil((z1-z0)/step);
  for(let i=0;i<sx;i++)for(let j=0;j<sz;j++){
    const p={x:x0+(i+0.5)*step, z:z0+(j+0.5)*step};
    if(inside(p,A)&&inside(p,B)) n++;
  }
  return n*step*step;
};
console.log('=== 网格采样（0.5mm）真实 polygon 相交:');
for(let i=0;i<bays.length;i++)for(let j=i+1;j<bays.length;j++){
  const A=bays[i],B=bays[j];
  const ra={minX:Math.min(...A.outline.map(p=>p.x)),maxX:Math.max(...A.outline.map(p=>p.x)),minZ:Math.min(...A.outline.map(p=>p.z)),maxZ:Math.max(...A.outline.map(p=>p.z))};
  const rb={minX:Math.min(...B.outline.map(p=>p.x)),maxX:Math.max(...B.outline.map(p=>p.x)),minZ:Math.min(...B.outline.map(p=>p.z)),maxZ:Math.max(...B.outline.map(p=>p.z))};
  const bb=(Math.min(ra.maxX,rb.maxX)-Math.max(ra.minX,rb.minX))*(Math.min(ra.maxZ,rb.maxZ)-Math.max(ra.minZ,rb.minZ));
  if(bb<=0) continue;
  const real=interArea(A.outline,B.outline);
  if(real<1e-6){ console.log(`  ○ 贴线/仅bbox  ${A.id} ↔ ${B.id}  bbox ${bb.toFixed(4)} → 真相交 0`); continue; }
  const same = A.sill===B.sill && A.h===B.h;
  console.log(`  ${same?'★同高度带真重叠':'△异高度带重叠'}  ${A.id} ↔ ${B.id}`);
  console.log(`      bbox ${bb.toFixed(4)}㎡ → 真相交 ${real.toFixed(6)}㎡   sill ${A.sill}/${B.sill} h ${A.h}/${B.h}  顶点 ${A.n}/${B.n}`);
}
