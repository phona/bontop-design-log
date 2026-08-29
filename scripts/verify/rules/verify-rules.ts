import { ProjectCatalog } from '../../../server/project-catalog.js';
import { VALID_CEILING_TYPES } from '../../../server/config-loader.js';
import { FURNITURE_DIMS } from '../../../shared/types.js';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

interface Rules {
  bounds: { apply_to: string[]; tolerance: number; severity: string };
  wall_ref: { apply_to: string[]; suppress_source: string; severity: string };
  existence: { apply_to: string[]; exempt_rooms: string[]; severity: string };
  proximity: Array<{
    id: string;
    a: { file: string; match: Record<string, string> };
    b: { file: string; match?: Record<string, string>; target?: string; same_room?: boolean };
    max_distance: number;
    severity: string;
  }>;
  clearance: { furniture_types: string[]; min_passage: number; severity: string };
  name_consistency: {
    source_a: string;
    source_b: string;
    match_by: string;
    check: string;
    exempt_ids: string[];
    severity: string;
  };
}

interface Positioned {
  id: string;
  room: string;
  wall?: string;
  x: number;
  z: number;
  note?: string;
  type?: string;
}

interface OverlaySuppress {
  id: string;
  wall?: string;
  walls?: string[];
}

function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function matchItem(item: Positioned, match: Record<string, string>): boolean {
  if (match.id && item.id !== match.id) return false;
  if (match.id_pattern && !new RegExp(match.id_pattern).test(item.id)) return false;
  if (match.type && item.type !== match.type) return false;
  if (match.note_contains && !(item.note ?? '').includes(match.note_contains)) return false;
  return true;
}

function main(): void {
  const rules = yaml.load(fs.readFileSync('config/verify-rules.yaml', 'utf-8')) as Rules;
  const catalog = ProjectCatalog.load('.');
  const rooms = catalog.getRooms();
  const walls = catalog.getWalls();

  const electrical = yaml.load(fs.readFileSync('config/electrical.yaml', 'utf-8')) as Positioned[];
  const plumbing = yaml.load(fs.readFileSync('config/plumbing.yaml', 'utf-8')) as Positioned[];
  const ceiling = yaml.load(fs.readFileSync('config/ceiling.yaml', 'utf-8')) as Array<{ id: string; room: string; type: string; x?: number; z?: number }>;
  const overlay = yaml.load(fs.readFileSync('config/layout/overlay.yaml', 'utf-8')) as { suppress: OverlaySuppress[] };
  const houseYaml = yaml.load(fs.readFileSync('config/house.yaml', 'utf-8')) as { rooms: Array<{ id: string; name: string }>; gift_areas: Array<{ id: string; name: string }> };
  const modelGeom = yaml.load(fs.readFileSync('config/layout/model-geometry.yaml', 'utf-8')) as { rooms: Array<{ id: string; name: string }> };

  const errors: string[] = [];
  const warnings: string[] = [];
  const report = (severity: string, msg: string) => {
    if (severity === 'error') errors.push(msg);
    else warnings.push(msg);
  };

  const suppressedWalls = new Set<string>();
  for (const s of overlay.suppress) {
    if (s.wall) suppressedWalls.add(s.wall);
    if (s.walls) for (const w of s.walls) suppressedWalls.add(w);
  }

  const wallIds = new Set(walls.map((w) => w.id).filter(Boolean) as string[]);
  const roomMap = new Map(rooms.map((r) => [r.id, r]));

  const allItems: Array<{ source: string; item: Positioned }> = [
    ...electrical.map((e) => ({ source: 'electrical', item: e })),
    ...plumbing.map((p) => ({ source: 'plumbing', item: p })),
  ];

  const furnishings = catalog.getFurnishings();
  const furnitureItems: Array<{ source: string; item: Positioned }> = [];
  for (const [roomId, items] of Object.entries(furnishings)) {
    for (const fi of items as Array<{ type: string; x?: number; z?: number }>) {
      if (fi.x !== undefined && fi.z !== undefined) {
        furnitureItems.push({
          source: 'furniture',
          item: { id: `${roomId}/${fi.type}`, room: roomId, x: fi.x, z: fi.z, type: fi.type },
        });
      }
    }
  }

  // === bounds check ===
  const boundsTargets = [...allItems, ...furnitureItems].filter((e) =>
    rules.bounds.apply_to.includes(e.source)
  );
  for (const { source, item } of boundsTargets) {
    const room = roomMap.get(item.room);
    if (!room) continue;
    const minX = room.x - room.width / 2 - rules.bounds.tolerance;
    const maxX = room.x + room.width / 2 + rules.bounds.tolerance;
    const minZ = room.z - room.depth / 2 - rules.bounds.tolerance;
    const maxZ = room.z + room.depth / 2 + rules.bounds.tolerance;
    if (item.x < minX || item.x > maxX || item.z < minZ || item.z > maxZ) {
      report(rules.bounds.severity, `[bounds] ${source}/${item.id}: (${item.x},${item.z}) 超出 ${item.room} 范围`);
    }
  }

  // === wall_ref check ===
  const wallRefTargets = allItems.filter((e) => rules.wall_ref.apply_to.includes(e.source));
  for (const { source, item } of wallRefTargets) {
    if (!item.wall) continue;
    if (!wallIds.has(item.wall)) {
      report(rules.wall_ref.severity, `[wall_ref] ${source}/${item.id}: 引用不存在的墙 "${item.wall}"`);
    } else if (suppressedWalls.has(item.wall)) {
      report(rules.wall_ref.severity, `[wall_ref] ${source}/${item.id}: 在被 suppress 的墙 "${item.wall}" 上（玻璃幕墙）`);
    }
  }

  // === existence check ===
  const existenceTargets = [...allItems, ...furnitureItems].filter((e) =>
    rules.existence.apply_to.includes(e.source)
  );
  for (const { source, item } of existenceTargets) {
    if (rules.existence.exempt_rooms.includes(item.room)) continue;
    if (!roomMap.has(item.room)) {
      report(rules.existence.severity, `[existence] ${source}/${item.id}: room "${item.room}" 不在 model-geometry 中`);
    }
  }
  for (const c of ceiling) {
    if (rules.existence.exempt_rooms.includes(c.room)) continue;
    if (!roomMap.has(c.room)) {
      report(rules.existence.severity, `[existence] ceiling/${c.id}: room "${c.room}" 不在 model-geometry 中`);
    }
    if (!VALID_CEILING_TYPES.includes(c.type as (typeof VALID_CEILING_TYPES)[number])) {
      report('error', `[ceiling_type] ceiling/${c.id}: 未知 type "${c.type}"`);
    }
  }

  // === ceiling area within unit bounds ===
  const unitMinX = Math.min(...rooms.map((r) => r.x - r.width / 2)) - 0.2;
  const unitMaxX = Math.max(...rooms.map((r) => r.x + r.width / 2)) + 0.2;
  const unitMinZ = Math.min(...rooms.map((r) => r.z - r.depth / 2)) - 0.2;
  const unitMaxZ = Math.max(...rooms.map((r) => r.z + r.depth / 2)) + 0.2;
  for (const c of ceiling) {
    const area = (c as { area?: [number, number, number, number] }).area;
    if (!area) continue;
    const [ax1, az1, ax2, az2] = area;
    if (ax1 < unitMinX || ax2 > unitMaxX || az1 < unitMinZ || az2 > unitMaxZ) {
      report('error', `[ceiling_area] ceiling/${c.id}: area 超出户型整体范围`);
    }
  }

  // === proximity check ===
  for (const rule of rules.proximity) {
    let aItems: Positioned[] = [];
    if (rule.a.file === 'electrical') aItems = electrical.filter((e) => matchItem(e, rule.a.match));
    else if (rule.a.file === 'plumbing') aItems = plumbing.filter((p) => matchItem(p, rule.a.match));

    for (const a of aItems) {
      let bItems: Positioned[] = [];
      if (rule.b.target === 'room_edge') {
        const room = roomMap.get(a.room);
        if (!room) continue;
        const minX = room.x - room.width / 2;
        const maxX = room.x + room.width / 2;
        const minZ = room.z - room.depth / 2;
        const maxZ = room.z + room.depth / 2;
        const dToEdge = Math.min(
          Math.abs(a.x - minX), Math.abs(a.x - maxX),
          Math.abs(a.z - minZ), Math.abs(a.z - maxZ)
        );
        if (dToEdge > rule.max_distance) {
          report(rule.severity, `[proximity] ${rule.id}: ${a.id} 距房间边缘 ${dToEdge.toFixed(2)}m (>${rule.max_distance}m)`);
        }
        continue;
      }

      if (rule.b.file === 'furniture') {
        bItems = furnitureItems
          .filter((f) => matchItem(f.item, rule.b.match!))
          .filter((f) => !rule.b.same_room || f.item.room === a.room)
          .map((f) => f.item);
      } else if (rule.b.file === 'ceiling') {
        bItems = ceiling
          .filter((c) => c.x !== undefined && c.z !== undefined && (!rule.b.match?.type || c.type === rule.b.match.type))
          .filter((c) => !rule.b.same_room || c.room === a.room)
          .map((c) => ({ id: c.id, room: c.room, x: c.x!, z: c.z! }));
      } else if (rule.b.file === 'electrical') {
        bItems = electrical.filter((e) => matchItem(e, rule.b.match!));
      }

      if (bItems.length === 0) continue;
      const nearest = bItems.reduce((best, b) => {
        const d = dist(a.x, a.z, b.x, b.z);
        return d < best.d ? { d, b } : best;
      }, { d: Infinity, b: bItems[0] });

      if (nearest.d > rule.max_distance) {
        report(rule.severity, `[proximity] ${rule.id}: ${a.id} ↔ ${nearest.b.id} 距离 ${nearest.d.toFixed(2)}m (>${rule.max_distance}m)`);
      }
    }
  }

  // === clearance check ===
  for (const [roomId, items] of Object.entries(furnishings)) {
    const room = roomMap.get(roomId);
    if (!room) continue;
    const roomMinX = room.x - room.width / 2;
    const roomMaxX = room.x + room.width / 2;
    const roomMinZ = room.z - room.depth / 2;
    const roomMaxZ = room.z + room.depth / 2;

    for (const fi of items as Array<{ type: string; x?: number; z?: number; rotation?: number }>) {
      if (fi.x === undefined || fi.z === undefined) continue;
      if (!rules.clearance.furniture_types.includes(fi.type)) continue;
      const dims = FURNITURE_DIMS[fi.type];
      if (!dims) continue;
      const rot = fi.rotation ?? 0;
      const quarter = Math.round(rot / 90) % 2 !== 0;
      const w = quarter ? dims.depth : dims.width;
      const d = quarter ? dims.width : dims.depth;
      const fMinX = fi.x - w / 2, fMaxX = fi.x + w / 2;
      const fMinZ = fi.z - d / 2, fMaxZ = fi.z + d / 2;

      const gapWest = fMinX - roomMinX;
      const gapEast = roomMaxX - fMaxX;
      const gapNorth = fMinZ - roomMinZ;
      const gapSouth = roomMaxZ - fMaxZ;

      const gaps = [
        { side: 'west', gap: gapWest, flush: gapWest < 0.05 },
        { side: 'east', gap: gapEast, flush: gapEast < 0.05 },
        { side: 'north', gap: gapNorth, flush: gapNorth < 0.05 },
        { side: 'south', gap: gapSouth, flush: gapSouth < 0.05 },
      ];
      const nonFlush = gaps.filter((g) => !g.flush);
      for (const g of nonFlush) {
        if (g.gap > 0.05 && g.gap < rules.clearance.min_passage) {
          report(rules.clearance.severity, `[clearance] ${roomId}/${fi.type}: ${g.side}侧通道 ${g.gap.toFixed(2)}m (<${rules.clearance.min_passage}m)`);
        }
      }
    }
  }

  // === name_consistency check ===
  const nc = rules.name_consistency;
  const geomNames = new Map(modelGeom.rooms.map((r) => [r.id, r.name]));
  const houseRooms = [...(houseYaml.rooms ?? []), ...(houseYaml.gift_areas ?? [])];
  for (const hr of houseRooms) {
    if (nc.exempt_ids.includes(hr.id)) continue;
    const geomName = geomNames.get(hr.id);
    if (geomName === undefined) continue;
    if (geomName !== hr.name) {
      report(nc.severity, `[name] room "${hr.id}": house.yaml="${hr.name}" vs model-geometry="${geomName}"`);
    }
  }

  // === output ===
  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);

  if (errors.length > 0) {
    console.error(`\nverify-rules: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`verify-rules: OK (${warnings.length} warning(s))`);
}

main();
