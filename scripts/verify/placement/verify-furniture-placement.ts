import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { FURNITURE_DIMS, MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE } from '../../../shared/types.js';

const EPS = 0.01;
const WALL_THICKNESS = 0.12;

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

const MB_VANITY_CASEWORK_TYPES = [
  'mb_vanity_base_cabinet',
  'mb_vanity_lower_board',
  'mb_vanity_main_board',
] as const;

const MB_CONDENSATE_TYPES = new Set([
  'mb_vanity_pvc_box',
  'mb_vanity_pvc_wardrobe_entry',
  'mb_vanity_pvc_service_chase',
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
    if (item.type === 'mb_vanity_pvc_box') {
      if (item.roomId !== 'master_bedroom' || item.wall !== 'w_mbath_east' || item.wall_side !== 'west' || item.rotation !== 270) {
        errors.push(`${label}: condensate wall run must use w_mbath_east west side at rotation 270`);
        return {};
      }
    } else if (MB_VANITY_TYPES.has(item.type)) {
      if (item.roomId !== 'master_bedroom' || item.wall !== 'w_mbath_east' || item.wall_side !== 'west' || item.rotation !== 270) {
        errors.push(`${label}: bathroom vanity anchor must use w_mbath_east west side at rotation 270`);
        return {};
      }
    }
    const dx = wall.x2 - wall.x1;
    const dz = wall.z2 - wall.z1;
    const wallLength = Math.hypot(dx, dz);
    const dims = item.width !== undefined && item.depth !== undefined ? { width: item.width, depth: item.depth } : FURNITURE_DIMS[item.type];
    const alongHalf = dims ? (item.type === 'mb_vanity_pvc_box' ? 0 : dims.width / 2) : Infinity;
    const isMasterBedroomCondensateWall = item.type === 'mb_vanity_pvc_box' && wall.id === 'w_mbath_east';
    let alongStart = wall.id === 'w_mbath_east' || wall.id === 'w_mb_east' ? Math.min(wall.z1, wall.z2) : 0;
    let alongEnd = wall.id === 'w_mbath_east' || wall.id === 'w_mb_east' ? Math.max(wall.z1, wall.z2) : wallLength;
    if (isMasterBedroomCondensateWall) alongStart = 3.10;
    const vanityEndpointTolerance = MB_VANITY_TYPES.has(item.type) && (wall.id === 'w_mbath_east' || wall.id === 'w_mb_east') ? 0.02 : 0;
    if (!dims || wallLength < EPS || item.along < alongStart + alongHalf - vanityEndpointTolerance || item.along > alongEnd - alongHalf + vanityEndpointTolerance) {
      errors.push(`${label}: wall anchor along=${item.along} places furniture outside wall length ${wallLength.toFixed(2)}m`);
      return {};
    }
    if ((wall.id === 'w_mbath_east' || wall.id === 'w_mb_east') && item.wall_side === 'west') {
      const wallFinishOffset = item.type === 'mb_vanity_base_cabinet' || item.type === 'mb_vanity_lower_board' || item.type === 'mb_vanity_main_board' || item.type === 'mb_vanity_pvc_box' ? WALL_THICKNESS / 2 : 0;
      return { x: wall.x1 - wallFinishOffset - dims.depth / 2, z: item.along };
    }
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
  ['master_wardrobe_top_pelmet', 'master_north_wall_wardrobe_950'], // 950衣柜顶部仅保留细收口，视觉同高但不承担 HVAC 责任
  ['bed_180', 'master_bedside_tray_south'], // 床架集成托盘位于床投影内，独立校验收起/使用态
  // 2026-09-03：旧重型器械（squat_rack/barbell_olympic/weight_plate_set/rubber_training_mat）退出书房，相关重叠豁免同步删除。
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

  // placed 实例索引（key = `${roomId}/${type}`），供房间级专项校验复用通用解析结果。
  const placedIndex = new Map<string, { label: string; item: PlacedItem; box: Aabb }>();

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
      const anchoredCondensate = MB_CONDENSATE_TYPES.has(item.type);
      if (!anchoredVanity && !anchoredCondensate && (box.minX < roomBounds.minX - EPS || box.maxX > roomBounds.maxX + EPS ||
          box.minZ < roomBounds.minZ - EPS || box.maxZ > roomBounds.maxZ + EPS)) {
        errors.push(`${label}: AABB (${box.minX.toFixed(2)},${box.minZ.toFixed(2)})→(${box.maxX.toFixed(2)},${box.maxZ.toFixed(2)}) outside room bounds (${roomBounds.minX.toFixed(2)},${roomBounds.minZ.toFixed(2)})→(${roomBounds.maxX.toFixed(2)},${roomBounds.maxZ.toFixed(2)})`);
      }

      for (const swing of doorSwings) {
        if (intersects(box, swing) && !anchoredCondensate) {
          errors.push(`${label}: intersects door swing zone (${swing.minX.toFixed(2)},${swing.minZ.toFixed(2)})→(${swing.maxX.toFixed(2)},${swing.maxZ.toFixed(2)})`);
        }
      }

      for (const other of placedBoxes) {
        const currentItem = { ...item, roomId };
        const otherItem = { ...other.item, roomId };
        if (intersects(box, other.box) && !anchoredCondensate && !MB_CONDENSATE_TYPES.has(other.item.type) && !isStackedPair(item.type, other.item.type) && !isMasterBedroomEastWallStackedPair(currentItem, otherItem)) {
          errors.push(`${label}: overlaps ${other.label}`);
        }
      }
      const entry = { label, item: { ...item, roomId, x: placed.x, z: placed.z, rotation }, box };
      placedBoxes.push(entry);
      placedIndex.set(`${roomId}/${item.type}`, entry);
    });
  }

  // ---- 2026-09-03 专项：主卧家具化前台 + 书房季节后台（迭代 master-flexible-frontstage-20260903，候选未冻结判据）----
  const GAP_EPS = 1e-9;

  // 主卫隔墙外柜组必须同时退出两道 120mm 墙体：东墙西完成面 x=2.54，
  // 主卫南墙卧室侧完成面 z=2.92；南端仍与衣柜侧 z=4.30 对齐。
  for (const type of MB_VANITY_CASEWORK_TYPES) {
    const entry = placedIndex.get(`master_bedroom/${type}`);
    if (!entry) {
      errors.push(`master_bedroom: missing placed ${type}`);
      continue;
    }
    const { box } = entry;
    if (box.minX < 1.975 - GAP_EPS || box.maxX > 2.54 + GAP_EPS || box.minZ < 2.92 - GAP_EPS || box.maxZ > 4.30 + GAP_EPS) {
      errors.push(`${entry.label}: 柜组包络 x[${box.minX.toFixed(3)},${box.maxX.toFixed(3)}] z[${box.minZ.toFixed(3)},${box.maxZ.toFixed(3)}] 越出双墙完成面目标 x[1.975,2.540] z[2.920,4.300]`);
    }
  }

  // d_mb runtime 门扇扫掠域：w_strip_east 门洞 z[4.65,5.55]，门扇向西开启。
  const MB_DOOR_SWEEP: Aabb = { minX: 3.30, maxX: 4.20, minZ: 4.65, maxZ: 5.55 };
  const MB_SOUTH_CURTAIN_BOX_NORTH_Z = MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.topBox.z[0]; // 仅记录顶部盒体，不作为家具地面硬下限
  const MB_SOUTH_CLOSED_CURTAIN_ENVELOPE: Aabb = {
    minX: 0,
    maxX: 4.2,
    minZ: MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.closedDrop.z[0],
    maxZ: MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE.closedDrop.z[1],
  };
  const MB_WEST_CURTAIN_BOX_MIN_X = 1.10;    // 主卧西窗帘线/盒西缘
  const MB_WEST_CURTAIN_BOX_MAX_X = 1.35;    // 主卧西窗帘盒内缘

  const mbBed = placedIndex.get('master_bedroom/bed_180');
  const mbWardrobe = placedIndex.get('master_bedroom/master_north_wall_wardrobe_950');
  const mbTable = placedIndex.get('master_bedroom/master_dressing_table');
  const mbStool = placedIndex.get('master_bedroom/dressing_stool');
  const mbNorthCabinet = placedIndex.get('master_bedroom/master_bedside_cabinet_350_north');
  const mbSouthCabinet = placedIndex.get('master_bedroom/master_bedside_cabinet_350_south');
  const mbConnectionStorage = placedIndex.get('master_bedroom/master_dressing_connection_storage');
  const mbPelmet = placedIndex.get('master_bedroom/master_wardrobe_top_pelmet');
  const electricalPoints = loadYaml(readFileSync('config/electrical.yaml', 'utf8')) as Array<{ id: string; x?: number; z?: number }>;
  const floorSocket = electricalPoints.find((point) => point.id === 'sock_master_projector');

  if (!mbWardrobe) {
    errors.push('master_bedroom: missing placed master_north_wall_wardrobe_950');
  } else {
    if (intersects(mbWardrobe.box, MB_DOOR_SWEEP)) {
      errors.push(`${mbWardrobe.label}: 衣柜与 d_mb 开启门扇硬冲突（wardrobe x[${mbWardrobe.box.minX.toFixed(2)},${mbWardrobe.box.maxX.toFixed(2)}] z[${mbWardrobe.box.minZ.toFixed(2)},${mbWardrobe.box.maxZ.toFixed(2)}], d_mb x[3.30,4.20] z[4.65,4.67]）`);
    }
  }

  if (!mbBed) {
    errors.push('master_bedroom: missing placed bed_180');
  } else {
    warnings.push(`master_bedroom: 南帘顶部盒体 z=${MB_SOUTH_CURTAIN_BOX_NORTH_Z.toFixed(2)} 仅作 ceiling-only 记录；闭帘候选软包络 z[${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.minZ.toFixed(2)},${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.maxZ.toFixed(2)}] inferred/site_pending，堆叠端 unknown/site_pending，不设地面硬下限`);
  }

  for (const cabinet of [mbNorthCabinet, mbSouthCabinet]) {
    if (!cabinet) {
      errors.push('master_bedroom: missing placed R7 380×350mm bedside cabinet');
      continue;
    }
    if (cabinet.box.maxX > 4.20 + GAP_EPS || cabinet.box.minX < 3.82 - GAP_EPS) errors.push(`${cabinet.label}: AABB crosses east wall or misses target x[3.82,4.20]`);
    if (intersects(cabinet.box, MB_DOOR_SWEEP)) errors.push(`${cabinet.label}: intersects d_mb door sweep zone`);
    if (mbBed && intersects(cabinet.box, mbBed.box)) errors.push(`${cabinet.label}: overlaps bed`);
    if (cabinet.item.type === 'master_bedside_cabinet_350_south' && mbBed && cabinet.box.minZ < mbBed.box.maxZ + 0.035 - GAP_EPS) {
      errors.push(`${cabinet.label}: south bedside minZ ${cabinet.box.minZ.toFixed(3)} < bed runtime maxZ + 0.035 (${(mbBed.box.maxZ + 0.035).toFixed(3)})`);
    }
    if (cabinet.item.type === 'master_bedside_cabinet_350_north' && mbBed && cabinet.box.maxZ > mbBed.box.minZ - 0.035 + GAP_EPS) {
      errors.push(`${cabinet.label}: north bedside maxZ ${cabinet.box.maxZ.toFixed(3)} > bed runtime minZ - 0.035 (${(mbBed.box.minZ - 0.035).toFixed(3)})`);
    }
    if (cabinet.item.type === 'master_bedside_cabinet_350_south' && intersects(cabinet.box, MB_SOUTH_CLOSED_CURTAIN_ENVELOPE)) {
      warnings.push(`${cabinet.label}: 与闭帘候选软包络 z[${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.minZ.toFixed(2)},${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.maxZ.toFixed(2)}] 相交；warning/BLOCKED，待现场核量，不升级为结构 error`);
    }
    if (mbWardrobe && intersects(cabinet.box, mbWardrobe.box)) errors.push(`${cabinet.label}: overlaps north-wall wardrobe`);
  }

  if (!mbPelmet) {
    errors.push('master_bedroom: missing placed master_wardrobe_top_pelmet');
  }


  if (!mbTable) {
    errors.push('master_bedroom: missing placed master_dressing_table');
  } else {
    if (mbBed && intersects(mbTable.box, mbBed.box)) {
      errors.push(`${mbTable.label}: AABB enters bed_180 footprint`);
    }
    if (!mbStool) {
      errors.push('master_bedroom: missing placed dressing_stool');
    } else if (
      mbStool.box.minX < mbTable.box.minX - GAP_EPS || mbStool.box.maxX > mbTable.box.maxX + GAP_EPS ||
      mbStool.box.minZ < mbTable.box.minZ - GAP_EPS || mbStool.box.maxZ > mbTable.box.maxZ + GAP_EPS
    ) {
      errors.push(`${mbStool.label}: 收纳态 AABB 未完整含于 master_dressing_table footprint`);
    }
  }

  // 西侧唯一地插：避开桌腿 0.10m、凳收纳包络、西窗帘盒与床侧主通道
  if (!floorSocket || floorSocket.x === undefined || floorSocket.z === undefined) {
    errors.push('master_bedroom: missing placed floor socket sock_master_projector');
  } else if (mbTable) {
    const px = floorSocket.x;
    const pz = floorSocket.z;
    // 桌腿世界落点：局部四腿相对桌面内缩（长边 0.06m、深边 0.065m，对齐 FixtureFactory master_dressing_table legs），奇数 quarter-turn 换轴
    const tableDims = FURNITURE_DIMS['master_dressing_table'];
    if (tableDims) {
      const legAlong = tableDims.width / 2 - 0.06;
      const legAcross = tableDims.depth / 2 - 0.065;
      const quarterTurn = Math.round((mbTable.item.rotation ?? 0) / 90) % 2 !== 0;
      const legDx = quarterTurn ? legAcross : legAlong;
      const legDz = quarterTurn ? legAlong : legAcross;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const dist = Math.hypot(px - (mbTable.item.x! + sx * legDx), pz - (mbTable.item.z! + sz * legDz));
          if (dist < 0.10 - GAP_EPS) {
            errors.push(`sock_master_projector: 距梳妆桌腿落点 ${dist.toFixed(3)}m < 0.10m`);
          }
        }
      }
    }
    if (mbStool && px > mbStool.box.minX + GAP_EPS && px < mbStool.box.maxX - GAP_EPS && pz > mbStool.box.minZ + GAP_EPS && pz < mbStool.box.maxZ - GAP_EPS) {
      errors.push('sock_master_projector: 位于 dressing_stool 收纳包络内');
    }
    // 2026-09-04 R1 桌贴窗后地插可行域移至桌 footprint 内（x[0.20,0.65]），禁入判据收窄为西窗帘线/盒带 x[1.10,1.35] 本身
    if (px >= MB_WEST_CURTAIN_BOX_MIN_X - GAP_EPS && px <= MB_WEST_CURTAIN_BOX_MAX_X + GAP_EPS) {
      errors.push(`sock_master_projector: x=${px.toFixed(2)} 落入西窗帘线/盒带 x[1.10,1.35]`);
    }
    const insideTable = px >= mbTable.box.minX - GAP_EPS && px <= mbTable.box.maxX + GAP_EPS &&
      pz >= mbTable.box.minZ - GAP_EPS && pz <= mbTable.box.maxZ + GAP_EPS;
    const distToTableEdge = Math.max(mbTable.box.minX - px, px - mbTable.box.maxX, mbTable.box.minZ - pz, pz - mbTable.box.maxZ, 0);
    const bedNorthZ = mbBed ? mbBed.box.minZ : 6.55;
    if (!insideTable && !(distToTableEdge <= 0.5 + GAP_EPS && pz < bedNorthZ)) {
      errors.push(`sock_master_projector @(${px.toFixed(2)},${pz.toFixed(2)}): 不在桌 footprint 内，且距桌缘 ${distToTableEdge.toFixed(3)}m>0.5m 或 z≥床北缘 ${bedNorthZ.toFixed(2)}（床侧主通道禁入）`);
    }
  }

  // 2026-09-04 R1：主卧南侧窗带轻中古矮柜专项（候选未冻结判据）
  const mbDresser = placedIndex.get('master_bedroom/master_hot_season_low_dresser');
  if (!mbDresser) {
    errors.push('master_bedroom: missing placed master_hot_season_low_dresser (南侧窗带轻中古矮柜)');
  } else {
    // 南侧窗带 z⊆[8.95,9.70]（南帘盒 z[8.70,8.95] 以南、幕墙 z=9.80 以北留余量；高度 0.85<2.07 由 recipe 保证）
    if (mbDresser.box.minZ < 8.95 - GAP_EPS || mbDresser.box.maxZ > 9.70 + GAP_EPS) {
      errors.push(`${mbDresser.label}: z 包络 [${mbDresser.box.minZ.toFixed(2)},${mbDresser.box.maxZ.toFixed(2)}] 越出南侧窗带 z[8.95,9.70]`);
    }
    if (mbBed && intersects(mbDresser.box, mbBed.box)) {
      errors.push(`${mbDresser.label}: AABB enters bed_180 footprint`);
    }
    if (intersects(mbDresser.box, MB_SOUTH_CLOSED_CURTAIN_ENVELOPE)) {
      warnings.push(`${mbDresser.label}: 与闭帘候选软包络 z[${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.minZ.toFixed(2)},${MB_SOUTH_CLOSED_CURTAIN_ENVELOPE.maxZ.toFixed(2)}] 相交；warning/BLOCKED，六抽柜保持原位，待现场核量`);
    }
    // 不侵东侧备用/窗帘插座点位 0.5m 内（可见可拔插、不被家具封死）
    for (const socketId of ['sock_master_bed_r', 'sock_master_curtain']) {
      const socket = electricalPoints.find((point) => point.id === socketId);
      if (!socket || socket.x === undefined || socket.z === undefined) continue;
      const dx = Math.max(mbDresser.box.minX - socket.x, socket.x - mbDresser.box.maxX, 0);
      const dz = Math.max(mbDresser.box.minZ - socket.z, socket.z - mbDresser.box.maxZ, 0);
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 - GAP_EPS) {
        errors.push(`${mbDresser.label}: 距 ${socketId} @(${socket.x},${socket.z}) 仅 ${dist.toFixed(3)}m < 0.5m`);
      }
    }
  }

  // 书房：季节后台柜边界与轻训练使用态
  const seWardrobe = placedIndex.get('bedroom_se/study_seasonal_wardrobe_wall');
  const seDesk = placedIndex.get('bedroom_se/desk');
  const seChair = placedIndex.get('bedroom_se/chair');
  const BESE_DOOR_SWEEP: Aabb = { minX: 13.40, maxX: 14.30, minZ: 5.65, maxZ: 6.55 }; // d_bese 北门扇扫掠域
  const STUDY_TRAINING_USE: Aabb = { minX: 14.30, maxX: 15.80, minZ: 5.65, maxZ: 7.45 }; // 轻训练三件套使用态 AABB

  if (!seWardrobe) {
    errors.push('bedroom_se: missing placed study_seasonal_wardrobe_wall (季节后台柜)');
  } else {
    if (seWardrobe.box.minZ < 5.90 - GAP_EPS) {
      errors.push(`${seWardrobe.label}: 北缘 z=${seWardrobe.box.minZ.toFixed(3)} < 5.90（侵入东北角吊段）`);
    }
    if (seWardrobe.box.maxZ > 7.60 + GAP_EPS) {
      errors.push(`${seWardrobe.label}: 南缘 z=${seWardrobe.box.maxZ.toFixed(3)} > 7.60（越过凸窗内缘）`);
    }
    if (seWardrobe.box.maxX > 16.35 + GAP_EPS) {
      errors.push(`${seWardrobe.label}: 东缘 x=${seWardrobe.box.maxX.toFixed(3)} > 16.35（须留完成面余量，不贴死 x=16.40）`);
    }
    if (intersects(seWardrobe.box, BESE_DOOR_SWEEP)) {
      errors.push(`${seWardrobe.label}: intersects d_bese door sweep zone (13.40,5.65)→(14.30,6.55)`);
    }
    for (const other of [seDesk, seChair]) {
      if (other && intersects(seWardrobe.box, other.box)) {
        errors.push(`${seWardrobe.label}: overlaps ${other.label}`);
      }
    }
  }

  for (const [name, obstacle] of [['desk', seDesk], ['chair', seChair], ['study_seasonal_wardrobe_wall', seWardrobe]] as const) {
    if (obstacle && intersects(STUDY_TRAINING_USE, obstacle.box)) {
      errors.push(`bedroom_se: 轻训练使用态 AABB (14.30,5.65)→(15.80,7.45) 与 ${name} 冲突`);
    }
  }
  if (intersects(STUDY_TRAINING_USE, BESE_DOOR_SWEEP)) {
    errors.push('bedroom_se: 轻训练使用态 AABB (14.30,5.65)→(15.80,7.45) 与 d_bese 门扫掠域冲突');
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
