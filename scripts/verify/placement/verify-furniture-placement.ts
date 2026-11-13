import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { loadCeilingConfig, loadElectricalConfig, loadPlumbingConfig } from '../../../server/config-loader.js';
import { FURNITURE_DIMS, CONDENSATE_CHAIN_FURNITURE_TYPES, MASTER_BEDROOM_R6_CURTAIN_SOFT_ENVELOPE, type FurnitureAnchor, type FurnitureMount, type VanityLayoutDecl } from '../../../shared/types.js';
import { declaredFurnitureDims, furnitureHostIndex, resolveFurniturePlacement, type PlacementAnchors } from '../../../shared/furniture-placement.js';
import { diffCondensateChainPlanAgainstMep, deriveMepPenetrationAt, resolveCondensatePlacementAnchors } from '../../../shared/condensate-chain.js';
import { endpointSourcesFromFacts, parseMepCoordination, resolveMepEndpoint } from '../../../shared/mep-hvac-coordination-schema.js';
import { parseProjectHvacFacts } from '../../../shared/project-render-facts-schema.js';
import { pointMountHostIndex, pointWallIndexFromElements, resolvePointPlacementInWalls, type PointWall } from '../../../shared/point-placement.js';
import { findDuplicateFurnitureIds } from '../../../shared/furniture-object-id.js';

const EPS = 0.01;

interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type WallSide = 'north' | 'south' | 'east' | 'west';
type PlacedItem = { type: string; length?: number; depth?: number; width?: number; x?: number; z?: number; rotation?: number; roomId?: string; wall?: string; wall_side?: WallSide; along?: number; wall_clearance?: number; vanity_layout?: VanityLayoutDecl; mount?: FurnitureMount; anchor?: FurnitureAnchor };

// 2026-11-13 issue #116：底柜 + 双悬浮板 + PVC 包管已删，由通顶定制柜 mb_full_height_cabinet
// 取代（同墙 w_mbath_east 西侧、朝西、rotation 270、沿墙锚点；包络目标 x[1.960,2.525] z[2.920,4.300] 不变）。
const MB_VANITY_TYPES = new Set([
  'mb_full_height_cabinet',
]);

const MB_VANITY_CASEWORK_TYPES = [
  'mb_full_height_cabinet',
] as const;

function rotatedDims(item: PlacedItem, rotation: number): { width: number; depth: number } | null {
  // 尺寸来源与 3D/DXF 共用 declaredFurnitureDims（vanity 走 house.yaml vanity_layout，
  // 行内宽深优先于 FURNITURE_DIMS 目录）；kitchen/bath run 另记台面外伸 0.04 的 AABB
  // 包络（本校验器口径，DXF 仍按 carcass 出，差异既原有意保持）。
  const dims = (item.type === 'kitchen_cabinet_run' || item.type === 'bath_side_cabinet') && item.length !== undefined && item.depth !== undefined
    ? { width: item.length + (item.type === 'kitchen_cabinet_run' ? 0.04 : 0), depth: item.depth + (item.type === 'kitchen_cabinet_run' ? 0.04 : 0) }
    : declaredFurnitureDims(item);
  if (dims.width === undefined || dims.depth === undefined) return null;
  const quarterTurns = Math.round(rotation / 90) % 2 !== 0;
  return quarterTurns ? { width: dims.depth, depth: dims.width } : { width: dims.width, depth: dims.depth };
}

function resolvePlacement(
  item: PlacedItem,
  wallSegments: Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>,
  hosts: ReadonlyMap<string, PlacedItem>,
  label: string,
  errors: string[],
  anchors?: PlacementAnchors,
): { x?: number; z?: number } {
  if (item.wall !== undefined || item.wall_side !== undefined || item.along !== undefined) {
    if (item.wall === undefined || item.wall_side === undefined || item.along === undefined) {
      errors.push(`${label}: wall anchor requires wall, wall_side, and along`);
      return {};
    }
    // 策略性锚点约定（非几何复算）：主卫东墙柜必须钉在 w_mbath_east 西侧、朝西、rotation 270。
    // 2026-11-13 issue #116：冷凝水管行（mb_vanity_pvc_box）已删，该分支同步删除。
    if (MB_VANITY_TYPES.has(item.type)) {
      if (item.roomId !== 'master_bedroom' || item.wall !== 'w_mbath_east' || item.wall_side !== 'west' || item.rotation !== 270) {
        errors.push(`${label}: east-wall cabinet anchor must use w_mbath_east west side at rotation 270`);
        return {};
      }
    }
  }
  // 几何解算一律走共享实现（shared/furniture-placement.ts）：完成面起算（2026-11-06 口径 A）、
  // along 合法域与半宽内缩、mount 挂载派生、vanity_layout 校验都在那一处。旧本地复算
  // （墙查找 / dims 优先级 / 绝对 z 特例 / 端部容差）已随 issue #98 PR-3 删除——它曾是共享
  // 函数的漂移副本，曾校验出一条比真实摆位东偏 15mm 的幻影包络；解不出来时返回诊断并落 error，
  // 不再静默跳过。
  const { placement, diagnostic } = resolveFurniturePlacement(item, wallSegments, hosts, anchors);
  if (diagnostic !== undefined) {
    errors.push(`${label}: ${diagnostic}`);
    return {};
  }
  if (!placement) return {}; // count-only 条目：无平面几何，预期跳过（AGENTS.md furnishings 口径）
  return { x: placement.x, z: placement.z };
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
  ['kitchen_cabinet_run', 'mijia_ro_purifier_1400g_under_sink_preview'], // Under-sink purifier body is intentionally contained by the sink-base run.
  ['waterbar_low_cabinet_800_preview', 'mijia_instant_dispenser_s1_preview'], // Countertop appliance rests on the dining waterbar top.
  ['waterbar_low_cabinet_800_preview', 'coffee_machine_em450'], // EM450 is moved to the dining waterbar top in this preview.
  ['kitchen_countertop_bridge', 'kitchen_cabinet_run'], // bridge intentionally overlaps both run ends to make one continuous countertop
  ['kitchen_countertop_bridge', 'dishwasher'], // bridge is the declared countertop over the dishwasher reservation
  ['master_dressing_table', 'dressing_stool'], // 专用凳明确收进梳妆台台下，平面 footprint 可重叠但高度不冲突
  // 2026-11-13 issue #116：950 衣柜 + 顶封已删，其层叠豁免同步删除。
  ['bed_180', 'master_bedside_tray_south'], // 床架集成托盘位于床投影内，独立校验收起/使用态
  ['vanity', 'mirror_cabinet_gbath'], // DEC-2026-09-09-R2 镜柜挂墙位于台盆正上方（y[1.10,2.00] vs 台盆 ≤0.79），高度不冲突，平面 footprint 投影重叠属预期
  ['vanity', 'robot_dock_gbath'], // DEC-2026-09-09-R6 基站泊入悬空台盆柜下（柜体底缘 y=0.30，基站顶 0.280，顶余 0.020；2026-11-02 本 PR 由 J6 改 JX YJCC034），竖向错层，平面投影重叠属预期
  ['mirror_cabinet_gbath', 'robot_dock_gbath'], // DEC-2026-09-09-R5 镜柜（y[1.10,2.00]）与台下基站（y≤0.280）同墙柱竖向叠放，平面投影重叠属预期
  // 2026-09-03：旧重型器械（squat_rack/barbell_olympic/weight_plate_set/rubber_training_mat）退出书房，相关重叠豁免同步删除。
];

function isStackedPair(a: string, b: string): boolean {
  return STACKED_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function isMasterBedroomEastWallStackedPair(a: PlacedItem, b: PlacedItem): boolean {
  if (a.roomId !== 'master_bedroom' || b.roomId !== 'master_bedroom') return false;
  if (!MB_VANITY_TYPES.has(a.type) || !MB_VANITY_TYPES.has(b.type)) return false;
  if (a.rotation !== 270 || b.rotation !== 270) return false;
  // 2026-11-13 issue #116：东墙柜组现为单一通顶柜（mb_full_height_cabinet），层叠豁免暂无
  // 第二件可配对；保留本函数守锚点约定（同墙同向同 along 的两件仍豁免重叠）。
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

  // 稳定对象 id（issue #98）全屋唯一：被 anti-penetration waivers 等跨文件按 id 引用，重复即绑错对象。
  for (const duplicate of findDuplicateFurnitureIds(furnishings)) {
    errors.push(`duplicate furniture id "${duplicate.id}": ${duplicate.entries.join(', ')}`);
  }

  // 墙线基准语义门禁（2026-11-06 业主口径 A）：挂墙家具的宿主墙必须在 model-geometry.yaml
  // 显式声明 line_datum，且当前唯一受支持口径是 centerline（渲染墙盒中心线、完成面=线±半墙厚，
  // shared/furniture-placement.ts 单一实现）。声明缺失=语义隐式漂移回类型清单时代；声明了
  // 未实现的其他值=声明与消费方脱节，都拦 error。与 SceneBuilder/InfrastructureBuilder 的
  // 同口径由 WALL_THICKNESS 单一声明保证。
  const wallSegments = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>(
    walls
      .filter((wall) => wall.id !== undefined)
      .map((wall) => [wall.id as string, wall.segments?.length
        ? wall.segments.map((segment) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 }))
        : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }]]),
  );
  const anchoredWallIds = new Set<string>();
  for (const items of Object.values(furnishings)) {
    for (const item of items) {
      if (item.wall !== undefined && item.wall_side !== undefined && item.along !== undefined) anchoredWallIds.add(item.wall);
    }
  }
  // mount 宿主索引（稳定 id → 条目）：挂载家具（如 gbath.robot_dock）的世界坐标由宿主摆位
  // 与宿主 vanity_layout 推出，与 3D/DXF 共用同一份解算与索引。
  const hosts = furnitureHostIndex(Object.values(furnishings).flat());
  // 主卫冷凝链锚点派生（issue #98 PR-10）：整条链一份解算（shared/condensate-chain.ts，
  // 与 SceneBuilder 同一函数），摆位与 3D/DXF 同口径。hvac 锚点（内机/候选接入点）读
  // config/hvac.yaml，穿墙点读 MEP condensate-master（只读引用，不改线）。解算失败 →
  // error：三件链条家具的定位声明解不出来，不出缺件校验。
  // 2026-11-13 issue #116：链已退役（950 衣柜 + 三件链条家具全删，全带泵后冷凝水改走客卫）；
  // resolveCondensateChain 在两宿主皆无时返回无链无诊断，调用方按 condensateChain 未定义跳过。
  const hvacFacts = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
  const hvacDiagram = hvacFacts.plans[0]?.diagram;
  const mepCoordination = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const mepRoute = mepCoordination.routes.find((route) => route.id === 'condensate-master');
  // S3（issue #98 第五阶段）：condensate-master@w_mbath_south 的 at 已删（可派生 45 条之一），
  // 冷凝链锚点由路线几何派生——与 lint/takeoff 同一算法、同一端点解算源。派生失败 → error
  // 显形（不回退手写值），链条家具随即可解出失败。
  const penetrationDerived = deriveMepPenetrationAt(mepRoute, 'w_mbath_south', {
    sources: endpointSourcesFromFacts({
      electrical: loadElectricalConfig(),
      plumbing: loadPlumbingConfig(),
      ceiling: loadCeilingConfig(),
      hvac: hvacFacts,
    }),
    walls,
  });
  if (penetrationDerived.diagnostic) errors.push(`condensate chain: ${penetrationDerived.diagnostic}`);
  const { anchors, diagnostics: chainDiagnostics } = resolveCondensatePlacementAnchors({
    hvacDiagram,
    hvacSources: { ceiling: loadCeilingConfig(), electrical: loadElectricalConfig() },
    penetration: penetrationDerived.point,
    wardrobe: hosts.get('mb.wardrobe_950'),
    wallRun: hosts.get('mb.vanity_pvc_box'),
    wallSegments,
    hosts,
  });
  const condensateChain = anchors.condensateChain;
  for (const diagnostic of chainDiagnostics) errors.push(`condensate chain: ${diagnostic}`);
  for (const wallId of anchoredWallIds) {
    const wall = walls.find((candidate) => candidate.id === wallId);
    if (!wall?.line_datum) {
      errors.push(`wall "${wallId}" hosts wall-anchored furniture but declares no line_datum (基准语义必须显式声明，2026-11-06 口径 A)`);
    } else if (wall.line_datum !== 'centerline') {
      errors.push(`wall "${wallId}" declares line_datum "${String(wall.line_datum)}" but no placement consumer supports it (当前仅支持 centerline)`);
    }
  }

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
      // 链解算失败时三件链条家具一并解不出来：根因已在链级诊断里逐条入列，这里不按件重复。
      if (condensateChain === undefined
        && (CONDENSATE_CHAIN_FURNITURE_TYPES as readonly string[]).includes(item.type)) return;
      const placed = resolvePlacement({ ...item, roomId }, wallSegments, hosts, label, errors, anchors);
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
      const entry = { label, item: { ...item, roomId, x: placed.x, z: placed.z, rotation }, box };
      placedBoxes.push(entry);
      placedIndex.set(`${roomId}/${item.type}`, entry);
    });
  }

  // ---- 2026-09-03 专项：主卧家具化前台 + 书房季节后台（迭代 master-flexible-frontstage-20260903，候选未冻结判据）----
  const GAP_EPS = 1e-9;

  // 主卫隔墙外柜组包络（2026-11-06 口径 A 校验共享化后按真实摆位钉死）：
  // 背面 = 东墙线 2.60 − 半墙厚 0.06 − wall_clearance 0.015 = 2.525（完成面 2.54 前退让 15mm），
  // 西缘 = 2.525 − 0.565 = 1.96；z[2.92,4.30] 不变（主卫南墙卧室侧完成面 / 衣柜侧对齐）。
  // 旧目标 x[1.975,2.540] 是本地复算忽略 wall_clearance 的幻影包络，随共享化删除。
  for (const type of MB_VANITY_CASEWORK_TYPES) {
    const entry = placedIndex.get(`master_bedroom/${type}`);
    if (!entry) {
      errors.push(`master_bedroom: missing placed ${type}`);
      continue;
    }
    const { box } = entry;
    if (box.minX < 1.96 - GAP_EPS || box.maxX > 2.525 + GAP_EPS || box.minZ < 2.92 - GAP_EPS || box.maxZ > 4.30 + GAP_EPS) {
      errors.push(`${entry.label}: 柜组包络 x[${box.minX.toFixed(3)},${box.maxX.toFixed(3)}] z[${box.minZ.toFixed(3)},${box.maxZ.toFixed(3)}] 越出真实摆位目标 x[1.960,2.525] z[2.920,4.300]`);
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
  const mbTable = placedIndex.get('master_bedroom/master_dressing_table');
  const mbStool = placedIndex.get('master_bedroom/dressing_stool');
  const mbNorthCabinet = placedIndex.get('master_bedroom/master_bedside_cabinet_350_north');
  const mbSouthCabinet = placedIndex.get('master_bedroom/master_bedside_cabinet_350_south');
  const mbConnectionStorage = placedIndex.get('master_bedroom/master_dressing_connection_storage');
  const electricalPoints = loadYaml(readFileSync('config/electrical.yaml', 'utf8')) as Array<{ id: string; x?: number; z?: number }>;
  const floorSocket = electricalPoints.find((point) => point.id === 'sock_master_projector');

  // 2026-11-13 issue #116：950 衣柜已删，其与 d_mb 门扇扫掠的冲突校验同步删除。
  // 通顶柜在 z[2.92,4.30]，与 d_mb 门洞（z[4.65,5.55]）无交集；柜门朝西，见 #116 批注。

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
  }

  // 2026-11-13 issue #116：950 衣柜顶封已删，其存在性校验同步删除（顶封现为通顶柜 2.50–2.80m 固定板的一部分）。

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
    // 2026-11-09 修 Codex major：原直接读 socket.x/z，两点的 x/z 声明已在第四阶段 S3 删光
    // （改 wall/along 定位），于是 `continue` 恒成立——这条「矮柜不侵插座 0.5m」的既有校验
    // 完全静默跳过，后续把点位移到柜旁也不会报。改为走共享点位解算器（与 3D/DXF/MEP/
    // 标注同一构造），解算失败显式报错而不是跳过。
    const pointWalls: ReadonlyMap<string, PointWall> = pointWallIndexFromElements(catalog.getWalls());
    for (const socketId of ['sock_master_bed_r', 'sock_master_curtain']) {
      const socket = electricalPoints.find((point) => point.id === socketId) as { id: string; wall?: string; along?: number; face_offset?: number; x?: number; z?: number } | undefined;
      if (!socket) continue;
      const { placement, diagnostic } = resolvePointPlacementInWalls(socket as never, pointWalls);
      if (!placement) {
        errors.push(`${mbDresser.label}: ${socketId} 平面位置解算失败（${diagnostic ?? '解算器未返回结果'}）——无法校验 0.5m 净距，按 fail-closed 报错`);
        continue;
      }
      const dx = Math.max(mbDresser.box.minX - placement.x, placement.x - mbDresser.box.maxX, 0);
      const dz = Math.max(mbDresser.box.minZ - placement.z, placement.z - mbDresser.box.maxZ, 0);
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 - GAP_EPS) {
        errors.push(`${mbDresser.label}: 距 ${socketId} @(${placement.x.toFixed(3)},${placement.z.toFixed(3)}) 仅 ${dist.toFixed(3)}m < 0.5m`);
      }
    }
  }

  // 2026-10-05 功能互换（iteration parent-room-study-swap-20261005）：bedroom_se 由书房改为客房，
  // study 由父母房改为书房。原「书房：季节后台柜 + 轻训练使用态」专项整体作废，替换为客房寝区判据。
  // 客房（bedroom_se）：wardrobe_180 北墙边吊下 + bed_150 床头靠东外墙；d_bese 门扇扫掠域禁入。
  const guestWardrobe = placedIndex.get('bedroom_se/wardrobe_180');
  const guestBed = placedIndex.get('bedroom_se/bed_150');
  const BESE_DOOR_SWEEP: Aabb = { minX: 13.40, maxX: 14.30, minZ: 5.65, maxZ: 6.55 }; // d_bese 西门洞扇扫掠域
  const BESE_BAY_INNER_Z = 7.60;  // 南向凸窗内缘：z>7.60 为凸窗带（2.07m 以上为窗带，床高 <2.07m 可进，柜体不得进）
  const BESE_SOUTH_GLASS_Z = 8.70; // 南玻璃栏板/房间南界，家具不得越过

  if (!guestWardrobe) {
    errors.push('bedroom_se: missing placed wardrobe_180 (客房衣柜，随功能自原父母房迁入)');
  } else {
    if (guestWardrobe.box.minX < 14.30 + GAP_EPS) {
      errors.push(`${guestWardrobe.label}: 西缘 x=${guestWardrobe.box.minX.toFixed(3)} < 14.30（侵入 d_bese 门扫掠域）`);
    }
    if (guestWardrobe.box.maxX > 16.35 + GAP_EPS) {
      errors.push(`${guestWardrobe.label}: 东缘 x=${guestWardrobe.box.maxX.toFixed(3)} > 16.35（须留完成面余量，不贴死 x=16.40）`);
    }
    if (guestWardrobe.box.minZ < 5.55 - GAP_EPS || guestWardrobe.box.maxZ > 6.15 + GAP_EPS) {
      errors.push(`${guestWardrobe.label}: z 包络 [${guestWardrobe.box.minZ.toFixed(3)},${guestWardrobe.box.maxZ.toFixed(3)}] 越出北墙边吊段 z[5.55,6.15]（柜体 2.40m+顶封板 0.10m 抵 2.50m 吊底）`);
    }
    if (guestBed && intersects(guestWardrobe.box, guestBed.box)) {
      errors.push(`${guestWardrobe.label}: overlaps ${guestBed.label}`);
    } else if (guestBed) {
      const channel = guestBed.box.minZ - guestWardrobe.box.maxZ;
      if (channel < 0.65 - GAP_EPS) {
        warnings.push(`${guestWardrobe.label}: 柜前通道 ${channel.toFixed(3)}m < 0.65m 项目惯例（推拉门可降为约 0.45m，属惯例突破须显式记录）`);
      }
    }
  }
  if (!guestBed) {
    errors.push('bedroom_se: missing placed bed_150 (客房床，随功能自原父母房迁入)');
  } else {
    if (intersects(guestBed.box, BESE_DOOR_SWEEP)) {
      errors.push(`${guestBed.label}: intersects d_bese door sweep zone (13.40,5.65)→(14.30,6.55)`);
    }
    if (guestBed.box.maxZ > BESE_SOUTH_GLASS_Z - 0.20 + GAP_EPS) {
      errors.push(`${guestBed.label}: 南缘 z=${guestBed.box.maxZ.toFixed(3)} ≥ ${(BESE_SOUTH_GLASS_Z - 0.20).toFixed(2)}（距南玻璃 8.70 需留 ≥0.20m，帘体与堆叠 site_pending）`);
    }
    // 床头靠东外墙（rotation=270 时床头在局部 -z → 世界 +x）：床头侧距东墙 ≤0.10m
    const headAtEast = Math.abs(guestBed.item.rotation ?? 0) === 270;
    if (!headAtEast) {
      warnings.push(`${guestBed.label}: rotation=${guestBed.item.rotation}，床头未靠东外墙（方案 A 要求床头同时远离电梯井与客厅电视墙）`);
    } else if (guestBed.box.maxX > 16.40 + GAP_EPS) {
      errors.push(`${guestBed.label}: 东缘 x=${guestBed.box.maxX.toFixed(3)} > 16.40（越出东外墙）`);
    }
  }

  // 书房（study）：季节后台柜由客房东墙平移至北墙边吊下；d_study 门扇扫掠域禁入。
  const studyCabinet = placedIndex.get('study/study_seasonal_wardrobe_wall');
  const STUDY_DOOR_SWEEP: Aabb = { minX: 6.15, maxX: 7.05, minZ: 5.55, maxZ: 6.45 }; // d_study 北门扇扫掠域
  // 2026-10-26 DEC-2026-10-26-R02 修正：删“南缘 ≤6.45”硬约束。原规则把“柜顶抵边吊底”（北段在边吊段 z[5.55,6.45] 内、底 2.50m 的设计意图）误作全柜硬约束；
  // 事实是边吊段以南 z>6.45 恢复 2.80m 原顶（config/model/envelope/ceiling.yaml ceiling_corridor 注记：“走廊地面 z[6.45,7.8] 段恢复 2.80m 原顶”），
  // 柜顶 2.50m（柜体 2.40m + 顶封板 0.10m）在原顶下留 0.30m 空隙，不撞吊底；南缘越出 6.45 本身不是碰撞，属非通顶柜正常形态。
  // 本校验器为 2D（Aabb 无 Y），无法按柜顶标高 vs 实际吊底做高度判定，故不以南缘坐标代行高度检查；高度判定留待 3D 校验（见 DEC R02 遗留）。
  if (!studyCabinet) {
    errors.push('study: missing placed study_seasonal_wardrobe_wall (书房北墙季节后台柜，由客房平移)');
  } else {
    if (intersects(studyCabinet.box, STUDY_DOOR_SWEEP)) {
      errors.push(`${studyCabinet.label}: intersects d_study door sweep zone (6.15,5.55)→(7.05,6.45)`);
    }
    if (studyCabinet.box.minZ < 5.55 - GAP_EPS) {
      errors.push(`${studyCabinet.label}: 北缘 z=${studyCabinet.box.minZ.toFixed(3)} < 5.55（越出房间北界）`);
    }
  }

  // ── 主卫冷凝链 ↔ MEP condensate-master 逐段对照（issue #98 PR-10）────────────
  // 家具链是遮蔽构造、MEP 是管：平面折线必须一一对应。不一致**不自动改线**（改线是设计
  // 决定）——这里拦 error 逼那个决定显式发生，处置口径沿用 condensate-living-dining-trunk
  // 与机器人仓冲突那条：带 owner 与触发条件登记后再裁。标高（y）不在本对照内：链条按
  // mep layers 表 condensate 层高 2.65 画示意，MEP 路线按 DEC-2026-10-06-R5 抬入降板空腔
  // （2.70–2.75），该差异已作为遗留登记在 condensate-master 的 reason 里。
  if (condensateChain && mepRoute) {
    const mepSources = {
      electrical: loadElectricalConfig(),
      plumbing: [],
      ceiling: loadCeilingConfig(),
      hvacAnchors: hvacDiagram?.anchors ?? [],
      hvacTerminals: hvacDiagram?.terminals ?? [],
      outdoor: [],
      // 点位宿主墙索引（issue #98 S1）：冷凝链 ↔ MEP 对照的端点与 DXF/3D 同一解算。
      pointWalls: pointWallIndexFromElements(walls),
      // mount 家具宿主索引（issue #98 S2 / 第五阶段 S1）：B 轨潜伏缺口——本装配点漏传
      // mountHosts 时，起夜灯等 mount 端点在 MEP 侧解不出（回落声明坐标，断言期相等故不显形）。
      mountHosts: pointMountHostIndex(Object.values(furnishings).flat() as never),
    };
    const from = resolveMepEndpoint(mepRoute.from, mepSources, mepCoordination.junctions);
    const to = resolveMepEndpoint(mepRoute.to, mepSources, mepCoordination.junctions);
    if (from && to) {
      const rawPlan = [from, ...mepRoute.via, to].map((point) => ({ x: point.x, z: point.z }));
      const mepPlan = rawPlan.filter((point, index) =>
        index === 0 || Math.hypot(point.x - rawPlan[index - 1].x, point.z - rawPlan[index - 1].z) > 1e-9);
      for (const finding of diffCondensateChainPlanAgainstMep(condensateChain.plan, mepPlan)) {
        errors.push(finding);
      }
    } else {
      errors.push('condensate chain: MEP condensate-master 端点解析失败（from/to 缺位置或 ref 断链），对照做不了');
    }
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
