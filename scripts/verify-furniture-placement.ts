import { ProjectCatalog } from '../server/project-catalog.js';
import { FURNITURE_DIMS } from '../shared/types.js';

const EPS = 0.01;

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function rotatedDims(type: string, rotation: number): { width: number; depth: number } | null {
  const dims = FURNITURE_DIMS[type];
  if (!dims) return null;
  const quarterTurns = Math.round(rotation / 90) % 2 !== 0;
  return quarterTurns ? { width: dims.depth, depth: dims.width } : dims;
}

function itemAabb(type: string, x: number, z: number, rotation: number): Aabb | null {
  const dims = rotatedDims(type, rotation);
  if (!dims) return null;
  return {
    minX: x - dims.width / 2,
    maxX: x + dims.width / 2,
    minZ: z - dims.depth / 2,
    maxZ: z + dims.depth / 2,
  };
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

    const placedBoxes: Array<{ label: string; box: Aabb }> = [];

    items.forEach((item, index) => {
      if (item.x === undefined || item.z === undefined) return;
      const rotation = item.rotation ?? 0;
      const label = `${roomId}/${item.type}[${index}]`;

      const box = itemAabb(item.type, item.x, item.z, rotation);
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
        if (intersects(box, other.box)) {
          errors.push(`${label}: overlaps ${other.label}`);
        }
      }
      placedBoxes.push({ label, box });
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
