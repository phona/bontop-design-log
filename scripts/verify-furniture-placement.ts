import { ProjectCatalog } from '../server/project-catalog.js';
import { FURNITURE_DIMS } from '../shared/types.js';

const EPS = 0.01;

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type PlacedItem = { type: string; length?: number; depth?: number; width?: number };

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
        const inward = roomBounds.minZ >= o.z! - EPS ? 1 : roomBounds.maxZ <= o.z! + EPS ? -1 : 0;
        const inwardX = roomBounds.minX >= o.x! - EPS ? 1 : roomBounds.maxX <= o.x! + EPS ? -1 : 0;
        if (inward !== 0) {
          return { minX: o.x! - o.width / 2, maxX: o.x! + o.width / 2, minZ: inward > 0 ? o.z! : o.z! - o.width, maxZ: inward > 0 ? o.z! + o.width : o.z! };
        }
        return { minX: inwardX > 0 ? o.x! : o.x! - o.width, maxX: inwardX > 0 ? o.x! + o.width : o.x!, minZ: o.z! - o.width / 2, maxZ: o.z! + o.width / 2 };
      });

    const placedBoxes: Array<{ label: string; type: string; box: Aabb }> = [];

    items.forEach((item, index) => {
      if (item.x === undefined || item.z === undefined) return;
      const rotation = item.rotation ?? 0;
      const label = `${roomId}/${item.type}[${index}]`;

      const box = itemAabb(item, item.x, item.z, rotation);
      if (!box) {
        warnings.push(`${label}: no dims in FURNITURE_DIMS, bounds checks skipped`);
        return;
      }

      if (box.minX < roomBounds.minX - EPS || box.maxX > roomBounds.maxX + EPS ||
          box.minZ < roomBounds.minZ - EPS || box.maxZ > roomBounds.maxZ + EPS) {
        errors.push(`${label}: AABB (${box.minX.toFixed(2)},${box.minZ.toFixed(2)})→(${box.maxX.toFixed(2)},${box.maxZ.toFixed(2)}) outside room bounds (${roomBounds.minX.toFixed(2)},${roomBounds.minZ.toFixed(2)})→(${roomBounds.maxX.toFixed(2)},${roomBounds.maxZ.toFixed(2)})`);
      }

      for (const swing of doorSwings) {
        if (intersects(box, swing)) {
          errors.push(`${label}: intersects door swing zone (${swing.minX.toFixed(2)},${swing.minZ.toFixed(2)})→(${swing.maxX.toFixed(2)},${swing.maxZ.toFixed(2)})`);
        }
      }

      for (const other of placedBoxes) {
        if (intersects(box, other.box) && !isStackedPair(item.type, other.type)) {
          errors.push(`${label}: overlaps ${other.label}`);
        }
      }
      placedBoxes.push({ label, type: item.type, box });
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
