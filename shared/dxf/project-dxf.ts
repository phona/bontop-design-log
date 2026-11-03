/**
 * 项目数据 → 施工 DXF 图纸装配（唯一实现；web「导出 DXF」按钮与 scripts/render/dxf/export-dxf.ts 共用）。
 *
 * 口径（2026-11-03 业主拍板）：独立新图、1:1 毫米、北朝上、原点归零（不对齐开发商原图坐标）；
 * 单文件多图层。坐标映射唯一约定：dxf_x = local_x * 1000，dxf_y = -local_z * 1000，只许本文件的
 * toDxf() 一处换算。
 *
 * 复用既有单一实现：splitSegmentByOpenings（shared/wall-segments.ts，墙洞切分与 3D 渲染同口径）、
 * resolveFurniturePlacement（shared/furniture-placement.ts，摆位与 3D 渲染同口径）、
 * resolveMepRoutes / mepRoutePoints / resolveMepEndpoint（MEP 折线与 3D 渲染同口径）。
 */

import { FURNITURE_DIMS, type CeilingZone, type ElectricalPoint, type FurnishingsYaml, type PlumbingPoint, type RoomLayout, type SceneElement } from '../types.js';
import { type MepCoordination, type MepEndpointSources, mepRoutePoints, resolveMepEndpoint, resolveMepRoutes } from '../mep-hvac-coordination-schema.js';
import { centerlineSamples } from '../arc-polyline.js';
import { resolveFurniturePlacement } from '../furniture-placement.js';
import { pointAlongPolyline, polylineLength, splitSegmentByOpenings } from '../wall-segments.js';
import { DxfWriter } from './dxf-writer.js';

/** 图层清单（ASCII；CAD 侧按专业开关）。颜色为 ACI 色号。 */
export const DXF_LAYERS = {
  WALL: ['A-WALL', 7],
  OPENING: ['A-OPENING', 8],
  GLAZING: ['A-GLAZING', 4],
  DOOR: ['A-DOOR', 2],
  ROOM: ['A-ROOM', 8],
  FURN: ['A-FURN', 3],
  E_POWER: ['E-POWER', 1],
  E_SWITCH: ['E-SWITCH', 6],
  E_LIGHT: ['E-LIGHT', 2],
  P_POINTS: ['P-POINTS', 5],
  C_CEIL: ['C-CEIL', 4],
  F_FLOOR: ['F-FLOOR', 30],
  WFIN_TILE: ['A-WFIN-TILE', 31],
  WFIN_PAINT: ['A-WFIN-PAINT', 141],
  SKIRT: ['A-SKIRT', 253],
  M_HVAC: ['M-HVAC', 5],
  M_ROUTE: ['M-ROUTE', 1],
  /** 候选/需求示意管路（route_kind: candidate/requirement、非物理路线、待复核）——不是施工放线依据，独立隔离。 */
  M_CAND: ['M-CAND', 9],
} as const satisfies Record<string, readonly [string, number]>;

export interface ProjectDxfHouse {
  rooms: RoomLayout[];
  furnishings: FurnishingsYaml;
  electrical: ElectricalPoint[];
  ceilingZones: CeilingZone[];
  sceneElements: SceneElement[];
}

export interface ProjectDxfInput {
  house: ProjectDxfHouse;
  plumbing?: PlumbingPoint[];
  mep?: { coordination: MepCoordination; sources: MepEndpointSources };
  /** utf8（默认，中望/浩辰兼容）或 ascii（业主 CAD 乱码时的一行退路，只影响 TEXT 标注，不影响几何）。 */
  labels?: 'utf8' | 'ascii';
}

export interface ProjectDxfResult {
  dxf: string;
  layers: string[];
  stats: Record<string, number>;
  entityCount: number;
  warnings: string[];
}

/** 点位圈半径（mm）：1:100 出图下直径 2mm，可辨识。 */
const POINT_RADIUS_MM = 100;
/** 常规标注字高（mm）：1:100 出图下 1mm。 */
const TEXT_HEIGHT_MM = 100;
/** 房间名标注字高（mm）。 */
const ROOM_TEXT_HEIGHT_MM = 150;
/** 洞口封头线半长（mm）：按墙厚 120mm 取半。 */
const OPENING_CAP_MM = 60;

export function buildProjectDxf(input: ProjectDxfInput): ProjectDxfResult {
  const { house, plumbing, mep } = input;
  const labels = input.labels ?? 'utf8';
  const warnings: string[] = [];
  const writer = new DxfWriter();
  for (const [name, color] of Object.values(DXF_LAYERS)) writer.addLayer(name, color);

  const label = (text: string, fallback = ''): string => {
    if (labels === 'utf8') return text;
    const stripped = text.replace(/[^\x20-\x7E]/g, '').trim();
    return stripped || fallback;
  };

  // 墙体索引：id → 主线段（供洞口切分与 wall_region/furniture 墙锚插值共用）。
  const wallsById = new Map<string, Extract<SceneElement, { type: 'wall' }>>();
  for (const element of house.sceneElements) {
    if (element.type === 'wall') wallsById.set(element.id, element);
  }

  emitWalls(writer, house.sceneElements);
  emitGlazingAndDoors(writer, house.sceneElements, warnings);
  emitRooms(writer, house.rooms, label);
  emitFurniture(writer, house.furnishings, wallsById, warnings, label);
  emitElectrical(writer, house.electrical, label);
  if (plumbing === undefined) {
    warnings.push('plumbing: 无输入，P-POINTS 图层为空（水路点位未导出）');
  } else {
    for (const point of plumbing) {
      // 抽象服务点（codex 二审 blocking）：faucet/drain 的 H 是抽象服务高度，note 明确
      // 「不得按此直接开槽」、待 SKU 冻结；字段态（inferred/pending）同理。标注限制 + 告警，
      // 不删点位（几何是事实，标高不是施工依据）。
      const notForConstruction = point.construction_status === 'pending'
        || point.status === 'inferred' || point.status === 'pending'
        || /抽象服务点|不得.{0,6}开槽|不作为施工依据/.test(point.note ?? '');
      const [x, y] = toDxf(point.x, point.z);
      writer.addCircle(DXF_LAYERS.P_POINTS[0], x, y, POINT_RADIUS_MM);
      const heightText = point.height !== undefined ? ` H${point.height}` : '';
      writer.addText(DXF_LAYERS.P_POINTS[0], x + POINT_RADIUS_MM, y + POINT_RADIUS_MM, TEXT_HEIGHT_MM,
        label(notForConstruction
          ? `${point.id} ${point.type}${heightText} 抽象点-禁止开槽待SKU`
          : `${point.id} ${point.type}${heightText}`, point.id));
      if (notForConstruction) {
        warnings.push(`plumbing ${point.id}: 抽象服务点/待核（H${point.height ?? '?'} 非施工标高，禁止直接开槽，待 SKU 冻结与量房）`);
      }
    }
  }
  emitCeiling(writer, house.ceilingZones, warnings, label);
  emitFloorAndWallFinishes(writer, house.sceneElements, wallsById, warnings, label);
  if (mep === undefined) {
    warnings.push('mep: 无输入，M-HVAC/M-ROUTE 图层为空（MEP 协调未导出）');
  } else {
    emitMep(writer, mep.coordination, mep.sources, warnings, label);
  }

  const stats = writer.layerStats();
  return {
    dxf: writer.toString(),
    layers: Object.values(DXF_LAYERS).map(([name]) => name),
    stats,
    entityCount: Object.values(stats).reduce((sum, count) => sum + count, 0),
    warnings,
  };
}

/** local 米（Y-up，+z 南）→ DXF 毫米（北朝上）。全仓唯一换算点。 */
function toDxf(localX: number, localZ: number): [number, number] {
  return [localX * 1000, -localZ * 1000];
}

// --- 墙体 + 洞口 ---

function emitWalls(writer: DxfWriter, elements: SceneElement[]): void {
  for (const element of elements) {
    if (element.type === 'wall_run') {
      // 实体墙声明（如 vanity_screen_halfwall 半墙）：SceneBuilder 按实体墙建 mesh（开放折线，不闭合），
      // DXF 同进墙体图层，否则施工平面缺已设计墙体（codex 审 2026-11-03 blocking）。
      if (element.points.length < 2) continue;
      const pts = element.points.map((point) => toDxf(point.x, point.z));
      writer.addPolyline(DXF_LAYERS.WALL[0], pts, false);
      writer.addText(DXF_LAYERS.WALL[0], pts[0][0], pts[0][1] + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM,
        `${element.id} H${element.height.toFixed(2)}`);
      continue;
    }
    if (element.type !== 'wall') continue;
    // 与 3D 渲染同口径（SceneBuilder.addWallElement）：有 segments 细分时优先画细分段，否则主线。
    const sourceSegments = element.segments?.length ? element.segments : [{ x1: element.x1, z1: element.z1, x2: element.x2, z2: element.z2 }];
    for (const source of sourceSegments) {
      const pieces = element.openings?.length ? splitSegmentByOpenings(source, element.openings) : [source];
      for (const piece of pieces) {
        writer.addLine(DXF_LAYERS.WALL[0], ...toDxf(piece.x1, piece.z1), ...toDxf(piece.x2, piece.z2));
      }
    }
    for (const opening of element.openings ?? []) {
      const [cx, cy] = toDxf(opening.x, opening.z);
      const dx = element.x2 - element.x1;
      const dz = element.z2 - element.z1;
      const length = Math.hypot(dx, dz);
      if (length < 1e-9) continue;
      const ux = dx / length;
      const uz = dz / length;
      const halfM = opening.width / 2;
      const [ax, ay] = toDxf(opening.x - ux * halfM, opening.z - uz * halfM);
      const [bx, by] = toDxf(opening.x + ux * halfM, opening.z + uz * halfM);
      // 洞口封头：垂直于墙向的短线，CAD 上读作「墙在此断开」。
      const nx = -uz;
      const nz = ux;
      const capX = -nx * OPENING_CAP_MM;
      const capY = nz * OPENING_CAP_MM;
      writer.addLine(DXF_LAYERS.OPENING[0], ax, ay, ax + capX, ay + capY);
      writer.addLine(DXF_LAYERS.OPENING[0], ax, ay, ax - capX, ay - capY);
      writer.addLine(DXF_LAYERS.OPENING[0], bx, by, bx + capX, by + capY);
      writer.addLine(DXF_LAYERS.OPENING[0], bx, by, bx - capX, by - capY);
      writer.addText(DXF_LAYERS.OPENING[0], cx, cy + OPENING_CAP_MM * 2, TEXT_HEIGHT_MM,
        `${opening.id} ${opening.type} W${Math.round(opening.width * 1000)}`);
    }
  }
}

// --- 玻璃 / 门 ---

/**
 * 弧感知折线出图（codex 二审 blocking）：折线点带 radius/cx/cz 圆角声明时，经
 * centerlineSamples（shared/arc-polyline.ts，与 3D 窗帘/栏杆同一弧口径）展开为密采样段，
 * 不再把弧控制点当直线折点；圆角点补 R 标注。3D 侧 curtain_run 按 closed 声明、
 * railing_run/shower_screen/frosted_privacy 是 addLineMeshes 系开放折线——DXF 同口径。
 */
function emitArcAwarePolyline(writer: DxfWriter, layer: string, points: ReadonlyArray<{ x: number; z: number; radius?: number }>, closed: boolean): void {
  if (points.length < 2) return;
  const samples = centerlineSamples(points as never, closed);
  const dxfPts = samples.map((sample) => toDxf(sample.x, sample.z));
  writer.addPolyline(layer, dxfPts, false);
  for (const point of points) {
    if ((point.radius ?? 0) > 0) {
      const [x, y] = toDxf(point.x, point.z);
      writer.addText(layer, x, y + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM, `R${Math.round(point.radius! * 1000)}`);
    }
  }
}

function emitGlazingAndDoors(writer: DxfWriter, elements: SceneElement[], warnings: string[]): void {
  for (const element of elements) {
    if (element.type === 'curtain_run' || element.type === 'railing_run' || element.type === 'shower_screen' || element.type === 'frosted_privacy') {
      const closed = element.type === 'curtain_run' ? (element.closed ?? false) : false;
      emitArcAwarePolyline(writer, DXF_LAYERS.GLAZING[0], element.points, closed);
      const [x, y] = toDxf(element.points[0].x, element.points[0].z);
      writer.addText(DXF_LAYERS.GLAZING[0], x, y + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM, element.id);
    } else if (element.type === 'glass_infill') {
      warnings.push(`glass_infill ${element.id}: 嵌在墙体内，无独立平面几何，未导出`);
    } else if (element.type === 'sliding_door_run') {
      const pts = element.points.map((point) => toDxf(point.x, point.z));
      writer.addPolyline(DXF_LAYERS.DOOR[0], pts, true);
      writer.addText(DXF_LAYERS.DOOR[0], pts[0][0], pts[0][1] + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM,
        `${element.id}${element.panels ? ` x${element.panels}` : ''}`);
    } else if (element.type === 'hinged_glass_door') {
      const [start, end] = element.points;
      const hingeIsStart = (element.hinge ?? 'start') === 'start';
      const [hx, hy] = hingeIsStart ? toDxf(start.x, start.z) : toDxf(end.x, end.z);
      const [ox, oy] = hingeIsStart ? toDxf(end.x, end.z) : toDxf(start.x, end.z);
      writer.addLine(DXF_LAYERS.DOOR[0], hx, hy, ox, oy); // 关闭位门扇
      // 开启位：门扇绕铰链转 90°，方向取 swing 声明（north→-z 即 DXF +y）。
      const vx = ox - hx;
      const vy = oy - hy;
      let px = -vy;
      let py = vx;
      if (element.swing === 'north' ? py < 0 : py > 0) {
        px = -px;
        py = -py;
      }
      const openX = hx + px;
      const openY = hy + py;
      writer.addLine(DXF_LAYERS.DOOR[0], hx, hy, openX, openY);
      const radius = Math.hypot(vx, vy);
      const angleClosed = (Math.atan2(vy, vx) * 180) / Math.PI;
      const angleOpen = (Math.atan2(py, px) * 180) / Math.PI;
      // DXF ARC 只能逆时针：叉积判断从关闭位到开启位的转向，必要时交换起止角。
      const cross = vx * py - vy * px;
      const [startDeg, endDeg] = cross >= 0
        ? [angleClosed, angleOpen < angleClosed ? angleOpen + 360 : angleOpen]
        : [angleOpen, angleClosed < angleOpen ? angleClosed + 360 : angleClosed];
      writer.addArc(DXF_LAYERS.DOOR[0], hx, hy, radius, startDeg, endDeg);
      writer.addText(DXF_LAYERS.DOOR[0], hx, hy + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM,
        `${element.id} ${element.swing ?? ''}`.trim());
    }
  }
}

// --- 房间 ---

function emitRooms(writer: DxfWriter, rooms: RoomLayout[], label: (text: string, fallback?: string) => string): void {
  for (const room of rooms) {
    if (room.semantic_only) continue;
    // 非矩形房间优先声明轮廓（codex 二审 blocking）：layout-resolver 已为客餐厅/主卧/入户
    // 花园输出真实折线边界，外接矩形会跨过真实边界、与面积文字（真实多边形面积）不一致。
    if (room.points && room.points.length >= 3) {
      emitArcAwarePolyline(writer, DXF_LAYERS.ROOM[0], room.points, true);
    } else {
      const west = room.x - room.width / 2;
      const east = room.x + room.width / 2;
      const north = room.z - room.depth / 2;
      const south = room.z + room.depth / 2;
      const [x1, y1] = toDxf(west, north);
      const [x2, y2] = toDxf(east, south);
      writer.addPolyline(DXF_LAYERS.ROOM[0], [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true);
    }
    const area = room.area ?? room.width * room.depth;
    const [cx, cy] = toDxf(room.x, room.z);
    writer.addText(DXF_LAYERS.ROOM[0], cx - ROOM_TEXT_HEIGHT_MM * 2, cy, ROOM_TEXT_HEIGHT_MM,
      label(`${room.name} ${(area ?? 0).toFixed(1)}㎡`, `${room.id} ${(area ?? 0).toFixed(1)}sqm`));
  }
}

// --- 家具（摆位与 3D 同口径）---

function emitFurniture(
  writer: DxfWriter,
  furnishings: FurnishingsYaml,
  wallsById: Map<string, Extract<SceneElement, { type: 'wall' }>>,
  warnings: string[],
  label: (text: string, fallback?: string) => string,
): void {
  const wallSegments = new Map(wallsById.size > 0
    ? [...wallsById.entries()].map(([id, wall]) => [id, [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }]])
    : []);
  for (const [roomId, items] of Object.entries(furnishings)) {
    for (const item of items) {
      const placement = resolveFurniturePlacement(item, wallSegments);
      if (!placement) continue; // count-only 条目，无平面几何（口径见 AGENTS.md furnishings 条目）
      const dims = FURNITURE_DIMS[item.type];
      const width = item.width ?? dims?.width ?? item.length;
      const depth = item.depth ?? dims?.depth;
      if (width === undefined || depth === undefined) {
        warnings.push(`furniture ${roomId}:${item.type}: 无 width/depth/length 声明，未导出外框`);
        continue;
      }
      const theta = ((item.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const corners: Array<[number, number]> = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const lx = (sx * width) / 2;
        const lz = (sz * depth) / 2;
        const wx = placement.x + lx * cos + lz * sin;
        const wz = placement.z - lx * sin + lz * cos;
        corners.push(toDxf(wx, wz));
      }
      writer.addPolyline(DXF_LAYERS.FURN[0], corners, true);
      const [cx, cy] = toDxf(placement.x, placement.z);
      writer.addText(DXF_LAYERS.FURN[0], cx, cy, TEXT_HEIGHT_MM, label(item.type, item.type));
    }
  }
}

// --- 电气（按 type 分层）---

function electricalLayer(type: string): readonly [string, number] {
  if (type === 'switch' || type === 'switch_2way' || type === 'ac_controller') return DXF_LAYERS.E_SWITCH;
  if (type.endsWith('light') || type === 'pendant' || type === 'dome' || type === 'wall_lamp' || type === 'led_strip' || type === 'night_light') return DXF_LAYERS.E_LIGHT;
  return DXF_LAYERS.E_POWER;
}

function emitElectrical(writer: DxfWriter, points: ElectricalPoint[], label: (text: string, fallback?: string) => string): void {
  for (const point of points) {
    const [x, y] = toDxf(point.x, point.z);
    const layer = electricalLayer(point.type);
    writer.addCircle(layer[0], x, y, POINT_RADIUS_MM);
    writer.addText(layer[0], x + POINT_RADIUS_MM, y + POINT_RADIUS_MM, TEXT_HEIGHT_MM,
      label(`${point.id} ${point.type}${point.height !== undefined ? ` H${point.height}` : ''}${point.circuit ? ` ${point.circuit}` : ''}`, point.id));
  }
}

// --- 吊顶（area 四元组角点，米；fillet 圆角 v1 不画，只出矩形外包络）---

function emitCeiling(writer: DxfWriter, zones: CeilingZone[], warnings: string[], label: (text: string, fallback?: string) => string): void {
  for (const zone of zones) {
    if (!zone.area) {
      // 无 area 的分区（如 ac_indoor 内机预留位）无平面矩形可画，显形跳过。
      warnings.push(`ceiling ${zone.id} (${zone.type}): 无 area 四元组，未导出`);
      continue;
    }
    const [x1, z1, x2, z2] = zone.area;
    const [ax, ay] = toDxf(Math.min(x1, x2), Math.min(z1, z2));
    const [bx, by] = toDxf(Math.max(x1, x2), Math.max(z1, z2));
    writer.addPolyline(DXF_LAYERS.C_CEIL[0], [[ax, ay], [bx, ay], [bx, by], [ax, by]], true);
    writer.addText(DXF_LAYERS.C_CEIL[0], ax, by + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM,
      label(`${zone.id} ${zone.type}${zone.thickness !== undefined ? ` T${zone.thickness}` : ''}`, `${zone.id} ${zone.type}`));
  }
}

// --- 地面分区 + 墙面做法 ---

function emitFloorAndWallFinishes(
  writer: DxfWriter,
  elements: SceneElement[],
  wallsById: Map<string, Extract<SceneElement, { type: 'wall' }>>,
  warnings: string[],
  label: (text: string, fallback?: string) => string,
): void {
  for (const element of elements) {
    if (element.type === 'floor_region') {
      if (element.points.length < 3) continue;
      const pts = element.points.map((point) => toDxf(point.x, point.z));
      writer.addPolyline(DXF_LAYERS.F_FLOOR[0], pts, true);
      const centroid = pts.reduce<[number, number]>(([sx, sy], [x, y]) => [sx + x / pts.length, sy + y / pts.length], [0, 0]);
      writer.addText(DXF_LAYERS.F_FLOOR[0], centroid[0], centroid[1], TEXT_HEIGHT_MM, element.id);
    } else if (element.type === 'wall_region' || element.type === 'paint_region' || element.type === 'skirting_region') {
      const wall = wallsById.get(element.wall);
      if (!wall) {
        warnings.push(`${element.type} ${element.id}: 引用的墙 ${element.wall} 不在 sceneElements，未导出`);
        continue;
      }
      // along 沿折线链逐段累计（与 3D SceneBuilder.pointAt 同口径）：带 segments 细分的墙
      // 不能按主线直插，否则子线段错位。区间越界按 3D 同款显形跳过。
      const chain: Array<{ x1: number; z1: number; x2: number; z2: number }> = wall.segments?.length
        ? wall.segments
        : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
      const total = polylineLength(chain);
      const from = Math.min(element.along[0], element.along[1]);
      const to = Math.max(element.along[0], element.along[1]);
      if (!(total > 0) || from < -1e-9 || to > total + 1e-9 || to - from <= 1e-9) {
        warnings.push(`${element.type} ${element.id}: along [${from}, ${to}] 超出墙 ${element.wall} 长度 ${total.toFixed(3)}，未导出`);
        continue;
      }
      const startPoint = pointAlongPolyline(chain, from);
      const endPoint = pointAlongPolyline(chain, to);
      if (!startPoint || !endPoint) {
        warnings.push(`${element.type} ${element.id}: along 插值失败（墙 ${element.wall}），未导出`);
        continue;
      }
      const [ax, ay] = toDxf(startPoint.x, startPoint.z);
      const [bx, by] = toDxf(endPoint.x, endPoint.z);
      const layer = element.type === 'wall_region'
        ? DXF_LAYERS.WFIN_TILE
        : element.type === 'paint_region' ? DXF_LAYERS.WFIN_PAINT : DXF_LAYERS.SKIRT;
      writer.addLine(layer[0], ax, ay, bx, by);
      // height 是**顶标高**（SceneBuilder 按 height - bottom 建带高），不是带高——标注直接用声明顶标高。
      const bottom = element.bottom ?? 0;
      const topText = element.height !== undefined ? element.height.toFixed(2) : '?';
      writer.addText(layer[0], (ax + bx) / 2, (ay + by) / 2 + TEXT_HEIGHT_MM, TEXT_HEIGHT_MM,
        label(`${element.id} ${bottom.toFixed(2)}~${topText}m`, element.id));
    }
  }
}

// --- MEP（与 3D 渲染同口径：resolveMepRoutes → mepRoutePoints）---

/** 候选/需求示意/非物理/待复核路线不是施工放线依据（codex 审 2026-11-03 blocking）——隔离 M-CAND。 */
function isCandidateRoute(resolved: ReturnType<typeof resolveMepRoutes>['routes'][number]): boolean {
  return !resolved.metadata.physicalRoute
    || resolved.metadata.pendingReview === true
    || resolved.route.route_kind === 'candidate'
    || resolved.route.route_kind === 'requirement';
}

function emitMep(
  writer: DxfWriter,
  coordination: MepCoordination,
  sources: MepEndpointSources,
  warnings: string[],
  label: (text: string, fallback?: string) => string,
): void {
  const report = resolveMepRoutes(coordination, sources);
  for (const resolved of report.routes) {
    if (resolved.unresolved.length > 0) {
      warnings.push(`mep route ${resolved.route.id}: 端点未解析（${resolved.unresolved.join('/')}），未导出`);
      continue;
    }
    const points = mepRoutePoints(resolved.route, resolved.from, resolved.to);
    if (points.length < 2) continue;
    const candidate = isCandidateRoute(resolved);
    const layer = candidate ? DXF_LAYERS.M_CAND : DXF_LAYERS.M_ROUTE;
    if (candidate) {
      warnings.push(`mep route ${resolved.route.id}: ${resolved.route.route_kind ?? 'nonphysical'}${resolved.metadata.pendingReview ? '/待复核' : ''}，已隔离至 M-CAND（非放线依据）`);
    }
    const pts = points.map((point) => toDxf(point.x, point.z));
    writer.addPolyline(layer[0], pts);
    const first = pts[0];
    const name = resolved.route.label ?? resolved.route.id;
    writer.addText(layer[0], first[0] + POINT_RADIUS_MM, first[1] + POINT_RADIUS_MM, TEXT_HEIGHT_MM,
      label(candidate ? `${name} ${resolved.route.layer} 候选-非放线依据` : `${name} ${resolved.route.layer}`, resolved.route.id));
  }
  // junction 随关联路线隔离（codex 二审 major）：汇流节点的 inlet/outlet 路线任一是候选，
  // 节点就跟去 M-CAND——否则关掉候选层会留下看似可放线的孤立正式节点。
  const candidateRoutes = new Set(report.routes.filter(isCandidateRoute).map((resolved) => resolved.route.id));
  for (const junction of coordination.junctions) {
    const [x, y] = toDxf(junction.position.x, junction.position.z);
    const linkedCandidate = [...junction.inlet_routes, junction.outlet_route].some((routeId) => candidateRoutes.has(routeId));
    const layer = linkedCandidate ? DXF_LAYERS.M_CAND : DXF_LAYERS.M_ROUTE;
    if (linkedCandidate) {
      warnings.push(`mep junction ${junction.id}: 关联候选路线，已随迁 M-CAND（待现场核验）`);
    }
    writer.addCircle(layer[0], x, y, POINT_RADIUS_MM);
    writer.addText(layer[0], x + POINT_RADIUS_MM, y + POINT_RADIUS_MM, TEXT_HEIGHT_MM,
      label(linkedCandidate ? `${junction.id} 待核验` : junction.id, junction.id));
  }
  for (const anchor of sources.hvacAnchors) {
    // 内机普遍经 ref: {source: ceiling} 定位（无直接 position）——复用 resolveMepEndpoint 解析引用
    // （与管路端点同口径），解析不了显式告警，不再静默跳过（codex 审 2026-11-03 blocking）。
    const position = anchor.position
      ? { x: anchor.position.x, z: anchor.position.z }
      : resolveMepEndpoint(anchor.id, sources, coordination.junctions);
    if (!position) {
      warnings.push(`mep anchor ${anchor.id}: 无 position 且引用无法解析，未导出`);
      continue;
    }
    const [x, y] = toDxf(position.x, position.z);
    writer.addCircle(DXF_LAYERS.M_HVAC[0], x, y, POINT_RADIUS_MM * 2);
    writer.addText(DXF_LAYERS.M_HVAC[0], x + POINT_RADIUS_MM * 2, y + POINT_RADIUS_MM * 2, TEXT_HEIGHT_MM,
      label(anchor.status !== 'confirmed' ? `${anchor.id} ${anchor.status}` : anchor.id, anchor.id));
  }
  for (const terminal of sources.hvacTerminals) {
    const [x, y] = toDxf(terminal.position.x, terminal.position.z);
    writer.addCircle(DXF_LAYERS.M_HVAC[0], x, y, POINT_RADIUS_MM / 2);
  }
  for (const outdoor of sources.outdoor) {
    const [x, y] = toDxf(outdoor.x, outdoor.z);
    writer.addCircle(DXF_LAYERS.M_HVAC[0], x, y, POINT_RADIUS_MM * 3);
    writer.addText(DXF_LAYERS.M_HVAC[0], x + POINT_RADIUS_MM * 3, y + POINT_RADIUS_MM * 3, TEXT_HEIGHT_MM, label(outdoor.id, outdoor.id));
  }
}
