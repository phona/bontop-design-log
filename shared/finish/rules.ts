/**
 * 面层范围核查规则层：面层声明之间是否互相压、是否重复、是否挂错了房间。
 *
 * 与防穿模层的分工：penetration 查「两块实体占同一块空间」，本层查
 * 「两片面层声明圈同一块面」。前者是几何碰撞，后者是**计量口径冲突**——
 * 冲突不产生任何几何错误，只会让面积数字重复或遗漏。
 *
 * 实现约束：
 * - 只读已声明数据（overlay + resolved layout + ceiling config），不猜任何几何。
 * - 「同侧」判定用 room：同一面墙两侧各属一个房间，两侧都刷漆是合法的
 *   （双面涂漆），只有**同房间同侧**重复才是真重复。
 * - 房间归属用 boundary **多边形**，不用 x/z/width/depth 包围盒——本户型有
 *   两对房间包围盒相交而多边形不重叠（主卧×西北次卧、客餐厅×入户花园），
 *   用包围盒判归属会误判。
 * - `height` 字段的语义是**顶面标高**，不是「高度」：
 *   shared/paint-scope.ts `const top = region.height ?? wall.height ?? 2.8`；
 *   SceneBuilder wall_region 分支 `PlaneGeometry(span, element.height - bottom)`、
 *   `position.y = bottom + (element.height - bottom) / 2`。字段名有歧义但两侧一致，
 *   本层按同一口径取 top = height（曾按 bottom+height 算错，把竖向区间整体上移）。
 */

export interface FinishWallSpan {
  id: string;
  wall: string;
  room: string;
  along: [number, number];
  bottom: number;
  top: number;
  /** 面层种类：漆 / 砖。 */
  finish: 'paint' | 'tile';
  type: string;
}

export interface FinishSillClaim {
  id: string;
  element: string;
  room: string;
  /** 该声明圈定的面。 */
  faces: string[];
  finish: 'paint' | 'tile';
  type: string;
}

export interface FinishRoomPolygon {
  id: string;
  points: Array<{ x: number; z: number }>;
}

export interface FinishWallGeometry {
  id: string;
  /** 墙的折线（含弧段细分），用于把 along 换成世界坐标。 */
  polyline: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  length: number;
  suppressed?: boolean;
}

export interface FinishCeilingZone {
  id: string;
  room: string;
  type: string;
  /** [x1, z1, x2, z2] 世界矩形。 */
  area?: [number, number, number, number];
}

export interface FinishRoomRect {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

/** 墙上的门洞/窗洞（resolved layout 的 openings，已换算成沿墙区间）。 */
export interface FinishOpening {
  id: string;
  wall: string;
  kind: 'door' | 'window';
  /** 沿墙区间（米，自墙起点算）。 */
  from: number;
  to: number;
  bottom: number;
  top: number;
}

export interface FinishScopeInput {
  walls: FinishWallSpan[];
  sills: FinishSillClaim[];
  rooms: FinishRoomPolygon[];
  wallGeometry: Record<string, FinishWallGeometry>;
  /** 吊顶 zone（config/ceiling.yaml）。 */
  ceilings?: FinishCeilingZone[];
  /** 房间外接矩形（resolved layout），用于校验铝扣板 zone 是否越界。 */
  roomRects?: FinishRoomRect[];
  /** 墙上的门洞/窗洞。 */
  openings?: FinishOpening[];
  /** F08 用：buildScene 实际产出的 objectId 集合。面层声明必须在这里找到自己，否则飘空。 */
  sceneMeshIds?: Set<string>;
  /** F08 用：有 ceiling 网格的房间（objectId = ceiling:<room>）。 */
  sceneCeilingRooms?: Set<string>;
  /** 有 paint_ceiling_region 声明的房间（顶面已登记）。 */
  ceilingPaintRooms?: Set<string>;
  /** 有 paint_region 声明的房间（在涂装范围内）。 */
  wallPaintRooms?: Set<string>;
  tolerance?: number;
  source?: string;
}

export interface FinishIssue {
  level: 'error' | 'warning' | 'info';
  code: string;
  entity: string;
  message: string;
  evidence: Record<string, unknown>;
}

const EPS = 1e-6;

function pointAt(polyline: FinishWallGeometry['polyline'], distance: number): { x: number; z: number } | null {
  let remaining = distance;
  for (const segment of polyline) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= EPS) continue;
    if (remaining <= length + EPS) {
      const t = Math.min(1, Math.max(0, remaining / length));
      return { x: segment.x1 + (segment.x2 - segment.x1) * t, z: segment.z1 + (segment.z2 - segment.z1) * t };
    }
    remaining -= length;
  }
  return null;
}

function distancePointToSegment(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= EPS) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

function distanceToPolygonBoundary(p: { x: number; z: number }, polygon: FinishRoomPolygon['points']): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distancePointToSegment(p, polygon[j], polygon[i]));
  }
  return best;
}

function overlapLength(a: [number, number], b: [number, number]): number {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}

/**
 * F01 面层重叠：同一面墙、同一房间（= 同一侧）、水平与竖向区间都相交。
 * 漆盖砖、砖盖漆都算——谁盖谁不影响「这片面被计了两次」这个事实。
 */
export function checkWallFinishOverlap(input: FinishScopeInput): FinishIssue[] {
  const tol = input.tolerance ?? 0.01;
  const issues: FinishIssue[] = [];
  const byWall = new Map<string, FinishWallSpan[]>();
  for (const span of input.walls) {
    if (!byWall.has(span.wall)) byWall.set(span.wall, []);
    byWall.get(span.wall)!.push(span);
  }
  for (const [wall, spans] of byWall) {
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i], b = spans[j];
        // 同房间 = 同一侧；不同房间是双面涂漆，合法
        if (a.room !== b.room) continue;
        const hOver = overlapLength(a.along, b.along);
        const vOver = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
        if (hOver <= tol || vOver <= tol) continue;
        const area = hOver * vOver;
        issues.push({
          level: 'warning',
          code: 'finish.wall_finish_overlap',
          entity: `${a.id} x ${b.id}`,
          message: `墙 ${wall} 房间 ${a.room}：${a.finish} 段 [${a.along[0]},${a.along[1]}]x[${a.bottom},${a.top}] 与 ${b.finish} 段 [${b.along[0]},${b.along[1]}]x[${b.bottom},${b.top}] 水平重叠 ${hOver.toFixed(3)}m、竖向重叠 ${vOver.toFixed(3)}m → 同一面被计两次 ${area.toFixed(3)}㎡`,
          evidence: { wall, room: a.room, horizontalOverlapM: +hOver.toFixed(3), verticalOverlapM: +vOver.toFixed(3), overlapAreaSqm: +area.toFixed(3), declarations: [a.id, b.id], finishes: [a.finish, b.finish] },
        });
      }
    }
  }
  return issues;
}

/**
 * F02 同元素同面重复声明：一个 bay 元素的同一个面被两片面层声明圈定。
 * 漆（paint_sill_region）与砖（sill_region）指向同一 element+face 即双计。
 */
export function checkSillFinishDuplicate(input: FinishScopeInput): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const claims = new Map<string, FinishSillClaim[]>();
  for (const claim of input.sills) {
    for (const face of claim.faces) {
      const key = `${claim.element}::${face}`;
      if (!claims.has(key)) claims.set(key, []);
      claims.get(key)!.push(claim);
    }
  }
  for (const [key, list] of claims) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.finish === b.finish && a.type === b.type) continue;
        issues.push({
          level: 'warning',
          code: 'finish.sill_finish_duplicate',
          entity: `${a.id} x ${b.id}`,
          message: `飘窗/台 ${a.element} 的 ${key.split('::')[1]} 面同时被 ${a.type}(${a.id}) 与 ${b.type}(${b.id}) 声明 → 该面被计两次`,
          evidence: { element: a.element, face: key.split('::')[1], declarations: [a.id, b.id], types: [a.type, b.type], finishes: [a.finish, b.finish] },
        });
      }
    }
  }
  return issues;
}

/**
 * F03 同侧重复涂漆：同一面墙、同一房间、两段 paint_region 的 along 相交。
 * 与 F01 的区别：F01 抓漆vs砖，本条抓漆vs漆（同侧重复声明纯属计量重复）。
 */
export function checkPaintDuplicateSameSide(input: FinishScopeInput): FinishIssue[] {
  const tol = input.tolerance ?? 0.01;
  const issues: FinishIssue[] = [];
  const byKey = new Map<string, FinishWallSpan[]>();
  for (const span of input.walls) {
    if (span.finish !== 'paint') continue;
    const key = `${span.wall}::${span.room}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(span);
  }
  for (const [key, spans] of byKey) {
    if (spans.length < 2) continue;
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i], b = spans[j];
        const hOver = overlapLength(a.along, b.along);
        const vOver = Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);
        if (hOver <= tol || vOver <= tol) continue;
        issues.push({
          level: 'warning',
          code: 'finish.paint_duplicate_same_side',
          entity: `${a.id} x ${b.id}`,
          message: `墙 ${a.wall} 房间 ${a.room} 同侧两段涂漆声明 along 重叠 ${hOver.toFixed(3)}m（[${a.along[0]},${a.along[1]}] 与 [${b.along[0]},${b.along[1]}]）→ 同侧重复计 ${(hOver * vOver).toFixed(3)}㎡`,
          evidence: { wall: a.wall, room: a.room, overlapM: +hOver.toFixed(3), declarations: [a.id, b.id] },
        });
      }
    }
  }
  return issues;
}

/**
 * F04 声明挂错房间：paint_region 的 along 区间端点不在**声明房间的 boundary 多边形**上。
 * 这正是「漆面悬在过道上」的几何判据——过道区没有 room，漆若挂上去，端点离任何
 * 房间边界都远。用多边形不用包围盒（见文件头说明）。
 */
export function checkPaintOutsideRoom(input: FinishScopeInput): FinishIssue[] {
  const tol = input.tolerance ?? 0.05;
  const issues: FinishIssue[] = [];
  for (const span of input.walls) {
    if (span.finish !== 'paint') continue;
    const geometry = input.wallGeometry[span.wall];
    const room = input.rooms.find((candidate) => candidate.id === span.room);
    if (!geometry || !room) {
      issues.push({
        level: 'error',
        code: 'finish.paint_room_unresolvable',
        entity: span.id,
        message: `涂漆声明 ${span.id} 引用的墙 ${span.wall} 或房间 ${span.room} 无法解析`,
        evidence: { wall: span.wall, room: span.room },
      });
      continue;
    }
    if (geometry.suppressed) {
      issues.push({
        level: 'warning',
        code: 'finish.paint_on_suppressed_wall',
        entity: span.id,
        message: `涂漆声明 ${span.id} 挂在被 suppress 的墙 ${span.wall} 上（该墙不产生实体面）`,
        evidence: { wall: span.wall },
      });
      continue;
    }
    const from = pointAt(geometry.polyline, Math.min(...span.along));
    const to = pointAt(geometry.polyline, Math.max(...span.along));
    if (!from || !to) {
      issues.push({
        level: 'error',
        code: 'finish.paint_span_unresolvable',
        entity: span.id,
        message: `涂漆声明 ${span.id} 的 along [${span.along[0]},${span.along[1]}] 无法在墙 ${span.wall}（长 ${geometry.length.toFixed(3)}m）上定位`,
        evidence: { wall: span.wall, along: span.along, wallLength: +geometry.length.toFixed(3) },
      });
      continue;
    }
    const dFrom = distanceToPolygonBoundary(from, room.points);
    const dTo = distanceToPolygonBoundary(to, room.points);
    if (dFrom > tol || dTo > tol) {
      issues.push({
        level: 'warning',
        code: 'finish.paint_outside_room',
        entity: span.id,
        message: `涂漆声明 ${span.id}（房间 ${span.room}）的 along 端点距该房间 boundary 最远 ${Math.max(dFrom, dTo).toFixed(3)}m——墙面不构成声明房间的边界，漆面可能落在过道或其他房间`,
        evidence: { wall: span.wall, room: span.room, distanceFromM: +dFrom.toFixed(3), distanceToM: +dTo.toFixed(3), from: { x: +from.x.toFixed(3), z: +from.z.toFixed(3) }, to: { x: +to.x.toFixed(3), z: +to.z.toFixed(3) } },
      });
    }
  }
  return issues;
}

/**
 * F05 顶面面层归属未登记：房间**在涂装范围内**（有 paint_region）、吊顶里有**非铝扣板**
 * zone（= 石膏板，要刷漆），却没有 paint_ceiling_region 声明。
 *
 * 失败模式是**静默少算**：`computePaintScope` 的 ceilingAreaByRoom 只对有
 * paint_ceiling_region 的房间建项，漏声明的房间顶面一律按 0 计，不报错也不告警。
 *
 * 铝扣板整间的房间豁免（业主 2026-10-09 确认「铝扣板不用刷漆」）——那种房间顶面
 * 本来就不该有漆面，声明与否都记 0。完全不在涂装范围的房间也豁免。
 */
export function checkCeilingFinishUnaccounted(input: FinishScopeInput): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const ceilings = input.ceilings ?? [];
  const roomRects = new Map((input.roomRects ?? []).map((room) => [room.id, room]));
  const declared = input.ceilingPaintRooms ?? new Set<string>();
  const inPaintScope = input.wallPaintRooms ?? new Set<string>();
  const paintableByRoom = new Map<string, FinishCeilingZone[]>();
  for (const zone of ceilings) {
    if (zone.type === 'aluminum_buckle') continue;
    if (!paintableByRoom.has(zone.room)) paintableByRoom.set(zone.room, []);
    paintableByRoom.get(zone.room)!.push(zone);
  }
  for (const [roomId, zones] of paintableByRoom) {
    if (declared.has(roomId)) continue;
    if (!inPaintScope.has(roomId)) continue;   // 整间不在涂装范围（如入户花园开发商已做好）
    const room = roomRects.get(roomId);
    issues.push({
      level: 'error',
      code: 'finish.ceiling_finish_unaccounted',
      entity: roomId,
      message: `房间 ${roomId} 在涂装范围内（有 paint_region）且有 ${zones.length} 段非铝扣板吊顶（${[...new Set(zones.map((z) => z.type))].join('/')}），但没有 paint_ceiling_region——顶面漆面会按 0 静默少算`,
      evidence: { room: roomId, paintableZones: zones.map((z) => z.id), types: [...new Set(zones.map((z) => z.type))], footprintSqm: room ? +(room.width * room.depth).toFixed(3) : null },
    });
  }
  return issues;
}

/**
 * F06 铝扣板 zone 越界：aluminum_buckle 的矩形没有整块落在声明房间里。
 * `computePaintScope` 用「zone ∩ 房间矩形」扣减顶面漆面积，zone 越界时扣减口径
 * 就会错——多扣（扣到邻居头上）或少扣（房间内有铝扣板却没扣掉）。
 */
export function checkBuckleZoneOutsideRoom(input: FinishScopeInput): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const tol = input.tolerance ?? 0.01;
  for (const zone of (input.ceilings ?? []).filter((z) => z.type === 'aluminum_buckle' && z.area)) {
    const room = (input.roomRects ?? []).find((candidate) => candidate.id === zone.room);
    if (!room) {
      issues.push({
        level: 'error',
        code: 'finish.buckle_zone_room_unknown',
        entity: zone.id,
        message: `铝扣板 zone ${zone.id} 声明的房间 ${zone.room} 不存在`,
        evidence: { room: zone.room },
      });
      continue;
    }
    const [x1, z1, x2, z2] = zone.area!;
    const rx1 = room.x - room.width / 2, rx2 = room.x + room.width / 2;
    const rz1 = room.z - room.depth / 2, rz2 = room.z + room.depth / 2;
    const outside = Math.max(0, rx1 - x1) + Math.max(0, x2 - rx2) + Math.max(0, rz1 - z1) + Math.max(0, z2 - rz2);
    if (outside > tol) {
      issues.push({
        level: 'error',
        code: 'finish.buckle_zone_outside_room',
        entity: zone.id,
        message: `铝扣板 zone ${zone.id} 的矩形 [${x1},${z1},${x2},${z2}] 超出房间 ${zone.room} 边界共 ${outside.toFixed(3)}m——顶面扣减口径会错`,
        evidence: { room: zone.room, zone: [x1, z1, x2, z2], roomRect: [+rx1.toFixed(3), +rz1.toFixed(3), +rx2.toFixed(3), +rz2.toFixed(3)], outsideM: +outside.toFixed(3) },
      });
    }
  }
  return issues;
}

/**
 * F07 面层盖住洞口：声明圈定的沿墙×竖向区间覆盖了门洞或窗洞。
 * 拆成两条独立规则（砖 / 漆），因为二者扣减机制完全不同、级别也不同：
 * `finish.tile_over_opening`（error）与 `finish.paint_over_opening`（info）。
 *
 * 为什么漆和砖不同级别：
 * - **瓷砖 → error**。`shared/paint-scope.ts` 的 `splitRectByGaps` 只服务漆
 *   （`computePaintScope` 与 SceneBuilder 的 paint_region 分支都走它），
 *   `wall_region` 分支是**单张 PlaneGeometry、不拆洞**，瓷砖算量也按 `len × band` 不扣洞。
 *   所以砖声明一旦盖住洞口就是**实打实多算**，且物理上不能贴砖过门洞。
 * - **漆 → info**。跨越洞口正是漆的声明机制：声明整面墙，由 splitRectByGaps 拆成
 *   左条+右条+门楣条，面积与 3D 网眼都实扣。这里只登记「这段声明跨了洞、扣减正在发生」，
 *   供核对，不判错。
 *
 * 真实命中（2026-10-09 上线时）：3 条瓷砖声明盖住门洞共 1.05㎡——
 * `walltile_mbath_south_shower` 0.05×2.10、`walltile_mbath_south_dry` 0.75×0.30、
 * `walltile_kitchen_balc_east` 0.80×0.90（其 reason 原话「门洞 0.80m 占大半」却仍按整段 1.20m 声明）。
 */
export function checkFinishOverOpening(input: FinishScopeInput): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const tol = input.tolerance ?? 0.01;
  for (const span of input.walls) {
    for (const opening of input.openings ?? []) {
      if (opening.wall !== span.wall) continue;
      const hOver = Math.min(opening.to, span.along[1]) - Math.max(opening.from, span.along[0]);
      const vOver = Math.min(opening.top, span.top) - Math.max(opening.bottom, span.bottom);
      if (hOver <= tol || vOver <= tol) continue;
      const area = hOver * vOver;
      const isTile = span.finish === 'tile';
      const where = `墙 ${span.wall} 的 ${opening.kind === 'door' ? '门' : '窗'}洞 ${opening.id} [${opening.from},${opening.to}]×[${opening.bottom},${opening.top}]`;
      const declared = `[${span.along[0]},${span.along[1]}]×[${span.bottom},${span.top}]`;
      const overlap = `重叠 ${hOver.toFixed(3)}×${vOver.toFixed(3)}m = ${area.toFixed(3)}㎡`;
      const shared = { wall: span.wall, opening: opening.id, kind: opening.kind, horizontalOverlapM: +hOver.toFixed(3), verticalOverlapM: +vOver.toFixed(3), overlapAreaSqm: +area.toFixed(3), declared: span.id };
      if (isTile) {
        issues.push({
          level: 'error',
          code: 'finish.tile_over_opening',
          entity: span.id,
          message: `${span.type} ${span.id} 圈定的 ${declared} 盖住${where} → ${overlap}。瓷砖算量不扣洞（splitRectByGaps 只服务漆，wall_region 是单张 PlaneGeometry），这是实打实多算，且物理上不能贴砖过门洞`,
          evidence: { ...shared, finish: 'tile' },
        });
      } else {
        issues.push({
          level: 'info',
          code: 'finish.paint_over_opening',
          entity: span.id,
          message: `${span.type} ${span.id} 的声明区间 ${declared} 跨过${where} → ${overlap}。漆的面积与 3D 网眼由 splitRectByGaps 实扣，此处仅登记供核对`,
          evidence: { ...shared, finish: 'paint' },
        });
      }
    }
  }
  return issues;
}

/**
 * F08 面层声明必须附着在 3D 实体上：每个声明都要在 buildScene 的产出里找到自己。
 *
 * 这一条直接回答「漆面是不是飘在空中」：声明是一回事，**场景里有没有实体是另一回事**。
 * 落空的声明不会报错——computePaintScope 照样按声明算出面积进预算，而 3D 里那块什么都没有。
 * 预算算了钱、现场找不到活儿干。
 *
 * 与既有检查的分工：SceneBuilder 的 report.unsupported 只覆盖「引用不存在/区间越界」这类
 * 硬错误，且只有测试在断言它为空；本规则把「声明 -> 场景实体」的对应关系提升为门禁级，
 * 并覆盖 paint_ceiling_region（它本身不产网格，只能通过房间有无 ceiling 几何判断）。
 */
export function checkDeclarationAttached(input: FinishScopeInput): FinishIssue[] {
  const issues: FinishIssue[] = [];
  const meshIds = input.sceneMeshIds;
  if (!meshIds) return issues;
  for (const span of input.walls) {
    const direct = meshIds.has(span.id);
    const split = [...meshIds].some((id) => id.startsWith(span.id + ':s'));
    if (!direct && !split) {
      issues.push({
        level: 'error',
        code: 'finish.declaration_unattached',
        entity: span.id,
        message: span.type + ' ' + span.id + '（墙 ' + span.wall + '）在 3D 场景里产不出任何网格——声明落空：预算照算面积，现场找不到这活儿',
        evidence: { declaration: span.id, type: span.type, wall: span.wall },
      });
    }
  }
  for (const sill of input.sills) {
    if (!meshIds.has(sill.id)) {
      issues.push({
        level: 'error',
        code: 'finish.declaration_unattached',
        entity: sill.id,
        message: sill.type + ' ' + sill.id + '（构件 ' + sill.element + '）在 3D 场景里产不出任何网格——声明落空：预算照算面积，现场找不到这活儿',
        evidence: { declaration: sill.id, type: sill.type, element: sill.element },
      });
    }
  }
  const ceilingRooms = input.sceneCeilingRooms;
  if (ceilingRooms) {
    for (const roomId of input.ceilingPaintRooms ?? []) {
      if (!ceilingRooms.has(roomId)) {
        issues.push({
          level: 'error',
          code: 'finish.declaration_unattached',
          entity: 'paint_ceiling_' + roomId,
          message: '房间 ' + roomId + ' 声明了顶面漆但场景里没有 ceiling 网格——顶面漆无处附着（飘在 2.80m 高度上，那儿没有顶）',
          evidence: { room: roomId, type: 'paint_ceiling_region' },
        });
      }
    }
  }
  return issues;
}

export function validateFinishScope(input: FinishScopeInput): FinishIssue[] {
  return [
    ...checkWallFinishOverlap(input),
    ...checkSillFinishDuplicate(input),
    ...checkPaintDuplicateSameSide(input),
    ...checkPaintOutsideRoom(input),
    ...checkCeilingFinishUnaccounted(input),
    ...checkBuckleZoneOutsideRoom(input),
    ...checkFinishOverOpening(input),
    ...checkDeclarationAttached(input),
  ];
}
