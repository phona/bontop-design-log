import { ProjectCatalog } from '../../../server/project-catalog.js';
import { FURNITURE_DIMS } from '../../../shared/types.js';

const EPS = 0.01;

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type WallSide = 'north' | 'south' | 'east' | 'west';
type PlacedItem = { type: string; length?: number; depth?: number; width?: number; x?: number; z?: number; rotation?: number; roomId?: string; wall?: string; wall_side?: WallSide; along?: number };

const MB_VANITY_TYPES = new Set([
  'mb_vanity_base_cabinet',
  'mb_vanity_lower_board',
  'mb_vanity_main_board',
  'mb_vanity_pvc_box',
]);

function rotatedDims(item: PlacedItem, rotation: number): { width: number; depth: number } | null {
  const dims = (item.type === 'kitchen_cabinet_run' || item.type === 'bath_side_cabinet') && item.length !== undefined && item.depth !== undefined
    ? { width: item.length + (item.type === 'kitchen_cabinet_run' ? 0.04 : 0), depth: item.depth + (item.type === 'kitchen_cabinet_run' ? 0.04 : 0) }
    : item.width !== undefined && item.depth !== undefined
      ? { width: item.width, depth: item.depth }
      : FURNITURE_DIMS[item.type];
  if (!dims) return null;
  const quarterTurns = Math.round(rotation / 90) % 2 !== 0;
  return quarterTurns ? { width: dims.depth, depth: dims.width } : dims;
}

function resolvePlacement(item: PlacedItem, walls: Array<{ id?: string; x1: number; z1: number; x2: number; z2: number }>, label: string, errors: string[]): { x?: number; z?: number } {
  if (item.wall !== undefined || item.wall_side !== undefined || item.along !== undefined) {
    if (item.wall === undefined || item.wall_side === undefined || item.along === undefined) {
      errors.push(`${label}: wall anchor requires wall, wall_side, and along`);
      return {};
    }
    const wall = walls.find((candidate) => candidate.id === item.wall);
    if (!wall) {
      errors.push(`${label}: wall "${item.wall}" not found`);
      return {};
    }
    if (!['north', 'south', 'east', 'west'].includes(item.wall_side)) {
      errors.push(`${label}: invalid wall_side "${item.wall_side}"`);
      return {};
    }
    if (MB_VANITY_TYPES.has(item.type)) {
      if (item.roomId !== 'master_bedroom' || item.wall !== 'w_mbath_east' || item.wall_side !== 'west' || item.rotation !== 270) {
        errors.push(`${label}: master-bedroom vanity anchor must use w_mbath_east west side at rotation 270`);
        return {};
      }
    }
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const wallLength = Math.hypot(dx, dz);
    const dims = FURNITURE_DIMS[item.type];
    const alongHalf = dims ? dims.width / 2 : Infinity;
    const alongStart = wall.id === 'w_mbath_east' ? Math.min(wall.z1, wall.z2) : 0;
    const alongEnd = wall.id === 'w_mbath_east' ? Math.max(wall.z1, wall.z2) : wallLength;
    const vanityEndpointTolerance = MB_VANITY_TYPES.has(item.type) && wall.id === 'w_mbath_east' ? 0.02 : 0;
    if (!dims || wallLength < EPS || item.along < alongStart + alongHalf - vanityEndpointTolerance || item.along > alongEnd - alongHalf + vanityEndpointTolerance) {
      errors.push(`${label}: wall anchor along=${item.along} places furniture outside wall length ${wallLength.toFixed(2)}m`);
      return {};
    }
    if (wall.id === 'w_mbath_east' && item.wall_side === 'west') return { x: wall.x1 - dims.depth / 2, z: item.along };
    const ux = dx / wallLength;
    const uz = dz / wallLength;
    const normal = item.wall_side === 'west' ? { x: -1, z: 0 } : item.wall_side === 'east' ? { x: 1, z: 0 } : item.wall_side === 'north' ? { x: 0, z: -1 } : { x: 0, z: 1 };
    return { x: wall.x1 + ux * item.along + normal.x * dims.depth / 2, z: wall.z1 + uz * item.along + normal.z * dims.depth / 2 };
  }
  return { x: item.x, z: item.z };
}

function itemAabb(item: PlacedItem, x: number, z: number, rotation: number): Aabb | null {
  const dims = rotatedDims(item, rotation);
  if (!dims) return null;
  return {
    minX: x - dims.width / 2,
    maxX: x + dims.width / 2,
    minZ: z - dims.depth / 2,
    maxZ: z + dims.depth / 2,
  };
}

const STACKED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['range_hood', 'gas_stove'],
  ['tv_65', 'tv_stand'],
  ['tv_65', 'tv_wall_low'],
  ['washer', 'dryer'], // 2026-08-23 洗烘叠放同位（支架层叠）
  ['kitchen_cabinet_run', 'kitchen_cabinet_run'],
  ['kitchen_cabinet_run', 'sink'],
  ['kitchen_cabinet_run', 'gas_stove'],
  ['kitchen_cabinet_run', 'range_hood'],
  ['kitchen_cabinet_run', 'fridge'],
  ['kitchen_cabinet_run', 'dishwasher'], // 2026-08-23 洗碗机嵌柜段留位（run +0.04 容差与机位边缘相接）
  ['kitchen_countertop_bridge', 'kitchen_cabinet_run'], // bridge intentionally overlaps both run ends to make one continuous countertop
  ['kitchen_countertop_bridge', 'dishwasher'], // bridge is the declared countertop over the dishwasher reservation
  ['master_dressing_table', 'dressing_stool'], // 专用凳明确收进梳妆台台下，平面 footprint 可重叠但高度不冲突
  ['rubber_training_mat', 'squat_rack'],
  ['rubber_training_mat', 'bench_adjustable'],
  ['rubber_training_mat', 'barbell_olympic'],
  ['rubber_training_mat', 'weight_plate_set'],
  // 明确的卧推操作配对：凳子靠架北侧收纳，允许二者 footprint 真实重叠；其他碰撞仍照常报错。
  ['squat_rack', 'bench_adjustable'],
  ['squat_rack', 'barbell_olympic'],
  ['bench_adjustable', 'barbell_olympic'],
];

function isStackedPair(a: string, b: string): boolean {
  return STACKED_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function isMasterBedroomEastWallStackedPair(a: PlacedItem, b: PlacedItem): boolean {
  if (a.roomId !== 'master_bedroom' || b.roomId !== 'master_bedroom') return false;
  if (!MB_VANITY_TYPES.has(a.type) || !MB_VANITY_TYPES.has(b.type)) return false;
  if (a.rotation !== 270 || b.rotation !== 270) return false;
  // These are four explicitly layered objects on the solid east wall x=2.60;
  // their 2D footprints may overlap although their elevations do not.
  return [a, b].every((item) => item.wall === 'w_mbath_east' && item.wall_side === 'west' && item.along !== undefined);
}

function intersects(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

function main(): void {
  const catalog = ProjectCatalog.load('.');
  const furnishings = catalog.getFurnishings();
  const rooms = new Map(catalog.getRooms().map((r) => [r.id, r]));
  const walls = catalog.getWalls();

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [roomId, items] of Object.entries(furnishings)) {
    const room = rooms.get(roomId);
    if (!room) {
      warnings.push(`room "${roomId}" not found in model-geometry, skipped (${items.length} furnishing entries)`);
      continue;
    }

    const roomBounds: Aabb = {
      minX: room.x - room.width / 2,
      maxX: room.x + room.width / 2,
      minZ: room.z - room.depth / 2,
      maxZ: room.z + room.depth / 2,
    };

    const doorSwings: Aabb[] = walls
      .flatMap((w) => (w.openings ?? []).filter((o) => o.type === 'door' && o.room === roomId))
      .map((o) => {
        // Use the opening's resolved wall orientation. The room bbox is not
        // sufficient when a room includes an open extension beyond a door.
        const wall = walls.find((candidate) => (candidate.openings ?? []).includes(o));
        const horizontal = wall ? Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1) : true;
        const wallCenterX = wall ? (wall.x1 + wall.x2) / 2 : o.x!;
        const wallCenterZ = wall ? (wall.z1 + wall.z2) / 2 : o.z!;
        if (horizontal) {
          const inward = room.z > wallCenterZ ? 1 : -1;
          return { minX: o.x! - o.width / 2, maxX: o.x! + o.width / 2, minZ: inward > 0 ? o.z! : o.z! - o.width, maxZ: inward > 0 ? o.z! + o.width : o.z! };
        }
        const inward = room.x > wallCenterX ? 1 : -1;
        return { minX: inward > 0 ? o.x! : o.x! - o.width, maxX: inward > 0 ? o.x! + o.width : o.x!, minZ: o.z! - o.width / 2, maxZ: o.z! + o.width / 2 };
      });

    const placedBoxes: Array<{ label: string; item: PlacedItem; box: Aabb }> = [];

    items.forEach((item, index) => {
      const label = `${roomId}/${item.type}[${index}]`;
      const placed = resolvePlacement({ ...item, roomId }, walls, label, errors);
      if (placed.x === undefined || placed.z === undefined) return;
      const rotation = item.rotation ?? 0;

      const box = itemAabb(item, placed.x, placed.z, rotation);
      if (!box) {
        warnings.push(`${label}: no dims in FURNITURE_DIMS, bounds checks skipped`);
        return;
      }

      const anchoredVanity = MB_VANITY_TYPES.has(item.type) && item.wall === 'w_mbath_east' && item.wall_side === 'west';
      if (!anchoredVanity && (box.minX < roomBounds.minX - EPS || box.maxX > roomBounds.maxX + EPS ||
          box.minZ < roomBounds.minZ - EPS || box.maxZ > roomBounds.maxZ + EPS)) {
        errors.push(`${label}: AABB (${box.minX.toFixed(2)},${box.minZ.toFixed(2)})→(${box.maxX.toFixed(2)},${box.maxZ.toFixed(2)}) outside room bounds (${roomBounds.minX.toFixed(2)},${roomBounds.minZ.toFixed(2)})→(${roomBounds.maxX.toFixed(2)},${roomBounds.maxZ.toFixed(2)})`);
      }

      for (const swing of doorSwings) {
        if (intersects(box, swing)) {
          errors.push(`${label}: intersects door swing zone (${swing.minX.toFixed(2)},${swing.minZ.toFixed(2)})→(${swing.maxX.toFixed(2)},${swing.maxZ.toFixed(2)})`);
        }
      }

      for (const other of placedBoxes) {
        const currentItem = { ...item, roomId };
        const otherItem = { ...other.item, roomId };
        if (intersects(box, other.box) && !isStackedPair(item.type, other.item.type) && !isMasterBedroomEastWallStackedPair(currentItem, otherItem)) {
          errors.push(`${label}: overlaps ${other.label}`);
        }
      }
      placedBoxes.push({ label, item: { ...item, roomId, x: placed.x, z: placed.z, rotation }, box });
    });
  }

  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);

  if (errors.length > 0) {
    console.error(`\nfurniture placement: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`furniture placement: OK (${warnings.length} warning(s))`);
}

main();
