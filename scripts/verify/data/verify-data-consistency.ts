// verify-data-consistency.ts
// 数据漂移防线（单一权威源 = config/layout/model-geometry.yaml）：
//  A. house.yaml rooms 的 width/length/area 为镜像字段，须与模型 bbox/鞋带面积一致；
//  B. house.yaml gift_areas 的 expected_centroid 须与模型 room/platform bbox 中心一致；
//  C. electrical/plumbing 点位声明的 wall 段须包含其 x/z 坐标（容差 0.15m）。
// 量房修正时只改 model-geometry.yaml，再跑 verify:all，本脚本会列出需同步的镜像字段与点位。
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import {
  checkWallPointPlacements,
  formatPlacementIssue,
  placementIssueCounts,
  type PlacementItem,
  type PlacementWall,
} from '../placement/verify-point-placement.js';

type Pt = { x: number; z: number };

const load = (p: string): any => yaml.load(fs.readFileSync(p, 'utf8'));

const mg = load('config/layout/model-geometry.yaml');
const house = load('config/house.yaml');
const elec = (load('config/electrical.yaml') ?? []) as any[];
const plumb = (load('config/plumbing.yaml') ?? []) as any[];

let fails = 0;
let warns = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };
const warn = (m: string) => { warns++; console.log('WARN', m); };

function checkUniqueIds(items: unknown, label: string): void {
  if (!Array.isArray(items)) {
    fail(`${label} 必须是数组`);
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const id = item && typeof item === 'object' && 'id' in item ? (item as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || id.length === 0) {
      fail(`${label}[${index}] 缺少非空 id`);
      continue;
    }
    if (seen.has(id)) fail(`${label} 出现重复 id=${id}`);
    seen.add(id);
  }
}

// Map() would otherwise silently overwrite a duplicate and let all downstream
// mirror checks compare against whichever entry happened to appear last.
checkUniqueIds(mg.vertices, 'model-geometry.vertices');
checkUniqueIds(mg.rooms, 'model-geometry.rooms');
if (mg.platform) {
  checkUniqueIds([mg.platform], 'model-geometry.platform');
  if ((mg.rooms as any[]).some((room) => room?.id === mg.platform.id)) {
    fail(`model-geometry.platform 与 rooms 重复 id=${mg.platform.id}`);
  }
}
checkUniqueIds(mg.walls, 'model-geometry.walls');
checkUniqueIds(house.rooms, 'house.rooms');
checkUniqueIds(house.gift_areas, 'house.gift_areas');
checkUniqueIds(elec, 'electrical.yaml');
checkUniqueIds(plumb, 'plumbing.yaml');

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

/**
 * 房间镜像的例外必须逐项写明原因。
 *
 * model-geometry.rooms 是几何口径，house.rooms 是设计房间口径：入户花园
 * 由 house.gift_areas 承载，电梯井只作为几何分区。west_platform 是独立
 * platform 元素，south_balcony 是明确未建模的赠送面积；它们不能被无条件
 * 放宽为“任意 model-only / house-only 区域”。
 */
const ROOM_MIRROR_EXEMPTIONS = {
  modelOnly: new Map<string, string>([
    ['entry_garden', 'model room is represented by house.gift_areas, not house.rooms'],
    ['elevator_shaft', 'pure geometry/service shaft, intentionally excluded from design rooms'],
  ]),
  modelPlatform: new Map<string, string>([
    ['west_platform', 'model platform is represented by house.gift_areas, not house.rooms'],
  ]),
  houseGiftOnly: new Map<string, string>([
    ['south_balcony', 'gift area is explicitly not modelled as a room'],
  ]),
} as const;

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

const modelRoomIds = new Set<string>((mg.rooms as any[]).map((room) => room.id));
const houseRoomIds = new Set<string>((house.rooms ?? []).map((room: any) => room.id));
const giftAreaIds = new Set<string>((house.gift_areas ?? []).map((area: any) => area.id));
const modelPlatformId = mg.platform?.id as string | undefined;

function validateMirrorExemptions(): void {
  for (const [id, reason] of ROOM_MIRROR_EXEMPTIONS.modelOnly) {
    if (!modelRoomIds.has(id)) fail(`镜像例外 modelOnly.${id} 未对应 model-geometry.rooms（${reason}）`);
    if (houseRoomIds.has(id)) fail(`镜像例外 modelOnly.${id} 已出现在 house.rooms，需移除例外（${reason}）`);
    if (!giftAreaIds.has(id) && id !== 'elevator_shaft') {
      fail(`镜像例外 modelOnly.${id} 缺少对应 house.gift_areas 记录（${reason}）`);
    }
  }
  for (const [id, reason] of ROOM_MIRROR_EXEMPTIONS.modelPlatform) {
    if (modelPlatformId !== id) fail(`镜像例外 modelPlatform.${id} 未对应 model-geometry.platform（${reason}）`);
    if (houseRoomIds.has(id)) fail(`镜像例外 modelPlatform.${id} 已出现在 house.rooms，需移除例外（${reason}）`);
    if (!giftAreaIds.has(id)) fail(`镜像例外 modelPlatform.${id} 缺少对应 house.gift_areas 记录（${reason}）`);
  }
  for (const [id, reason] of ROOM_MIRROR_EXEMPTIONS.houseGiftOnly) {
    if (!giftAreaIds.has(id)) fail(`镜像例外 houseGiftOnly.${id} 未对应 house.gift_areas（${reason}）`);
    if (modelRoomIds.has(id) || modelPlatformId === id) fail(`镜像例外 houseGiftOnly.${id} 已被 model-geometry 建模，需移除例外（${reason}）`);
    if (houseRoomIds.has(id)) fail(`镜像例外 houseGiftOnly.${id} 已出现在 house.rooms，需移除例外（${reason}）`);
  }
}

validateMirrorExemptions();

// A. rooms 镜像字段
for (const r of (house.rooms ?? []) as any[]) {
  const m = modelRooms.get(r.id);
  if (!m) { fail(`house room ${r.id} 不存在于 model-geometry`); continue; }
  if (Math.abs(r.width - m.w) > 0.01 || Math.abs(r.length - m.d) > 0.01 || Math.abs(r.area - m.area) > 0.05) {
    fail(`room ${r.id} 镜像漂移: house ${r.width}/${r.length}/${r.area} vs model ${m.w.toFixed(2)}/${m.d.toFixed(2)}/${m.area.toFixed(2)}`);
  }
}

// A2. 反向门禁：每个 model-geometry room 都必须有 house.rooms 镜像，除非
// 上面逐项声明为 modelOnly。这样新增几何 room 不会静默脱离预算/设计口径。
for (const id of modelRoomIds) {
  if (houseRoomIds.has(id)) continue;
  if (ROOM_MIRROR_EXEMPTIONS.modelOnly.has(id)) continue;
  fail(`model room ${id} 缺少 house.rooms 镜像；若为纯几何/赠送区域，必须声明精确 modelOnly 例外`);
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

// C. 点位坐标、墙体 suppress、墙段端点及 resolved opening 专项检查
const resolved = resolveLayout(mg);
const placementWalls: PlacementWall[] = resolved.walls.map((w) => ({
  id: w.id,
  x1: w.x1,
  z1: w.z1,
  x2: w.x2,
  z2: w.z2,
  openings: w.openings,
}));
const suppressedWalls = new Set<string>();
for (const entry of (load('config/layout/overlay.yaml')?.suppress ?? []) as any[]) {
  if (typeof entry.wall === 'string') suppressedWalls.add(entry.wall);
  for (const wall of entry.walls ?? []) if (typeof wall === 'string') suppressedWalls.add(wall);
}
const placementItems = [...elec, ...plumb] as PlacementItem[];
const roomCentroids = new Map<string, Pt>(
  [...modelRooms.entries()].map(([id, m]) => [id, { x: m.cx, z: m.cz }]),
);
const placementIssues = checkWallPointPlacements(placementWalls, placementItems, suppressedWalls, 0.15, roomCentroids);
for (const issue of placementIssues) {
  if (issue.level === 'error') fail(`点位专项 ${formatPlacementIssue(issue)}`);
  else warn(`点位专项 ${formatPlacementIssue(issue)}`);
}
const placementCounts = placementIssueCounts(placementIssues);
console.log(`点位专项检查: ${placementCounts.errors} error(s), ${placementCounts.warnings} warning(s)`);

console.log(fails
  ? `verify-data-consistency: ${fails} fail(s), ${warns} warning(s)`
  : `verify-data-consistency: OK (${warns} warning(s))`);
process.exit(fails ? 1 : 0);
