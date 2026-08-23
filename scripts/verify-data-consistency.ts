// verify-data-consistency.ts
// 数据漂移防线（单一权威源 = config/layout/model-geometry.yaml）：
//  A. house.yaml rooms 的 width/length/area 为镜像字段，须与模型 bbox/鞋带面积一致；
//  B. house.yaml gift_areas 的 expected_centroid 须与模型 room/platform bbox 中心一致；
//  C. electrical/plumbing 点位声明的 wall 段须包含其 x/z 坐标（容差 0.15m）。
// 量房修正时只改 model-geometry.yaml，再跑 verify:all，本脚本会列出需同步的镜像字段与点位。
import * as fs from 'fs';
import * as yaml from 'js-yaml';

type Pt = { x: number; z: number };

const load = (p: string): any => yaml.load(fs.readFileSync(p, 'utf8'));

const mg = load('config/layout/model-geometry.yaml');
const house = load('config/house.yaml');
const elec = (load('config/electrical.yaml') ?? []) as any[];
const plumb = (load('config/plumbing.yaml') ?? []) as any[];

const verts = new Map<string, Pt>(
  (mg.vertices as any[]).map((v) => [v.id, { x: v.x, z: v.z }]),
);

function polyOf(boundary: string[]): Pt[] {
  return boundary.map((id) => {
    const v = verts.get(id);
    if (!v) throw new Error(`unknown vertex ${id}`);
    return v;
  });
}

function shoelace(pts: Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(area / 2);
}

interface ModelRoom { w: number; d: number; area: number; cx: number; cz: number }

const modelRooms = new Map<string, ModelRoom>();
function register(id: string, boundary: string[]): void {
  const pts = polyOf(boundary);
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  modelRooms.set(id, {
    w: maxX - minX,
    d: maxZ - minZ,
    area: shoelace(pts),
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  });
}
for (const r of mg.rooms as any[]) register(r.id, r.boundary);
if (mg.platform) register(mg.platform.id, mg.platform.boundary);

let fails = 0;
let warns = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };
const warn = (m: string) => { warns++; console.log('WARN', m); };

// A. rooms 镜像字段
for (const r of (house.rooms ?? []) as any[]) {
  const m = modelRooms.get(r.id);
  if (!m) { fail(`house room ${r.id} 不存在于 model-geometry`); continue; }
  if (Math.abs(r.width - m.w) > 0.01 || Math.abs(r.length - m.d) > 0.01 || Math.abs(r.area - m.area) > 0.05) {
    fail(`room ${r.id} 镜像漂移: house ${r.width}/${r.length}/${r.area} vs model ${m.w.toFixed(2)}/${m.d.toFixed(2)}/${m.area.toFixed(2)}`);
  }
}

// B. gift_areas 质心
for (const g of (house.gift_areas ?? []) as any[]) {
  const m = modelRooms.get(g.id);
  if (!m) { console.log(`INFO gift ${g.id} 未建模，跳过质心检查`); continue; }
  if (!g.expected_centroid ||
      Math.abs(g.expected_centroid.x - m.cx) > 0.05 || Math.abs(g.expected_centroid.z - m.cz) > 0.05) {
    fail(`gift ${g.id} 质心漂移: house (${g.expected_centroid?.x},${g.expected_centroid?.z}) vs model (${m.cx.toFixed(2)},${m.cz.toFixed(2)})`);
  }
}

// C. 点位坐标须落在声明墙段上
const walls = new Map<string, [Pt, Pt]>(
  (mg.walls as any[]).map((w) => [w.id, [verts.get(w.from)!, verts.get(w.to)!]]),
);
const TOL = 0.15;
for (const item of [...elec, ...plumb]) {
  if (!item || typeof item.wall !== 'string' || typeof item.x !== 'number' || typeof item.z !== 'number') continue;
  const seg = walls.get(item.wall);
  if (!seg) { fail(`${item.id} 引用未知墙 ${item.wall}`); continue; }
  const [a, b] = seg;
  const withinX = item.x >= Math.min(a.x, b.x) - TOL && item.x <= Math.max(a.x, b.x) + TOL;
  const withinZ = item.z >= Math.min(a.z, b.z) - TOL && item.z <= Math.max(a.z, b.z) + TOL;
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dist = Math.abs((b.z - a.z) * (item.x - a.x) - (b.x - a.x) * (item.z - a.z)) / len;
  if (!withinX || !withinZ || dist > TOL) {
    const reason = dist > TOL
      ? `离线垂直距离 ${dist.toFixed(2)}m`
      : `超出墙段端点范围（墙 ${item.wall} 覆盖 x[${Math.min(a.x, b.x).toFixed(1)},${Math.max(a.x, b.x).toFixed(1)}] z[${Math.min(a.z, b.z).toFixed(1)},${Math.max(a.z, b.z).toFixed(1)}]）`;
    warn(`${item.id} (${item.x},${item.z}) 不在声明墙 ${item.wall} 上：${reason}`);
  }
}

console.log(fails
  ? `verify-data-consistency: ${fails} fail(s), ${warns} warning(s)`
  : `verify-data-consistency: OK (${warns} warning(s))`);
process.exit(fails ? 1 : 0);
