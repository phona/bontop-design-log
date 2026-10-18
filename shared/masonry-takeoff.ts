/**
 * 瓦工算量子系统（L1「量」层唯一实现；DEC-2026-10-13「预算计算架构根治」阶段 2 第一半）。
 *
 * 为什么需要它：同一个「墙砖面积」在仓区里有**五套值**——
 *   65.699㎡ `server/budget-calculator.ts` 的 `wetWallArea = (宽+深)×2×高×0.7` 拍系数（app 实际在用）
 *   30.640㎡ overlay 声明实算（审计口径，按弦长）
 *   28.780㎡ 30.640 − 1.86（客厅防水台，control.yaml 声称它「不进 3D 贴砖层」但 overlay 与测试都算）
 *   25.651㎡ control.yaml:1073 `estimated_need_note` 末值（停在 DEC-2026-10-08-C18）
 *   15.330㎡ control.yaml:1086 `quantity_basis`（陈账，停在 DEC-2026-10-07-R11）
 * 按项目铁律「贴砖范围已从推导改为 overlay.yaml 的 wall_region 声明」，**权威值是 overlay 实算**。
 * 本模块把那条唯一算法收进 `shared/`，server / scripts / tests 共用，禁止任何一处另立口径。
 *
 * 合并的两处现有实现（都只搬算法、不 import）：
 *   ① `tmp/verify-wall-tile.ts`（L1 声明层 + L2 几何交叉层）——`tileableOf` 独立推导可贴墙长、
 *      along 越界、同 (墙,房间) 二维不重叠、顶标高不超净高、声明贴合该房间侧脸。
 *      **关键差异**：tmp 脚本打印 MISMATCH 后继续跑，本模块改为**失败 throw**（fail-closed，
 *      与 `shared/paint-scope.ts:267-268` 的 along 越界 throw 同风格）。
 *   ② `scripts/verify/finish/verify-finish-scope.ts:34-67` 的 span 抽取——已经是
 *      `FinishScopeInput` 形状，这里取它的形状定义，但它是脚本不是 shared 层，故不 import。
 *
 * 三条铁律（与 shared/ceiling-takeoff.ts、shared/mep-takeoff.ts 同源）：
 *   - **禁止推断**：量只来自 overlay 声明（wall_region / sill_region / floor_region）与
 *     显式传入的房间分类（dryRoomIds / wetRoomIds）。缺声明 → 进 `unpriced` / `unresolved`
 *     并计数，绝不兜底成拍系数。
 *   - **不静默丢弃**：既不在干区也不在湿区的地面房间、被显式排除的 floor_region、
 *     没有计价归属的量，全部进显式清单。
 *   - **不四舍五入**：数量保留原始浮点（只有金额才 round），由调用方/测试用容差断言。
 *
 * 本模块**不 import three、不读文件系统**：CLI/verify 负责加载，server 与 app 共用同一份口径。
 */

const EPS = 1e-9;

// ─────────────────────────────────────────────────────────────────────────────
// 输入契约
// ─────────────────────────────────────────────────────────────────────────────

export interface MasonrySegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** 墙几何最小契约：model-geometry 墙 / catalog 墙 / resolved layout 墙都满足。 */
export interface MasonryWallInput {
  id: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 折线细分（resolver 对圆角墙产的弧段）；缺省 = 单段直线。沿墙长度按折线累计。 */
  segments?: MasonrySegment[];
  /** overlay.suppress 压制的墙（玻璃幕墙 / 实体已删除）。wall_region 引用即抛错。 */
  suppressed?: boolean;
  /** model-geometry 的 openings（门/窗洞），坐标为洞口**中心**绝对值。 */
  openings?: Array<{
    id: string;
    type: string;
    x: number;
    z: number;
    width: number;
    height: number;
    sill?: number;
    room?: string;
  }>;
}

/** 被 sill_region 引用的 bay_sill 构件（防水台 / 上飘窗）。 */
export interface MasonryBaySillInput {
  id: string;
  /** 该构件贴附的墙 id。 */
  wall: string;
  /** 竖面高度：face=front 的带高。 */
  height: number;
  /** 水平面进深：face=top / face=underside 的带高。 */
  depth: number;
  /** 台面标高（face=front 的带底）。缺省 0。 */
  sill?: number;
  /** 该构件所在墙的折线（弧墙）；缺省则回落到墙表的 segments / 单段弦线。 */
  segments?: MasonrySegment[];
}

/** sill_region 的面：竖面（front）/ 水平台面（top）/ 朝下底面（underside）。 */
export type MasonrySillFace = 'front' | 'top' | 'underside';

/** overlay 的 wall_region 声明（竖直墙面贴砖）。 */
export interface MasonryWallRegionInput {
  id: string;
  wall: string;
  room: string;
  /**
   * 沿墙区间，单位**米**，自墙 from 端累计。
   * 踩过的坑：`along: [0.5, 2.9]` 就是 0.5m–2.9m；当毫米除 1000 会得 0.02㎡。
   */
  along: [number, number];
  /** 带底标高，缺省 0。 */
  bottom?: number;
  /** 带【顶标高】（不是带高）。必须显式声明——不回落墙高，也不回落 2.65 魔法数。 */
  height: number;
  zone?: string;
}

/** overlay 的 sill_region 声明（防水台 / 上飘窗贴砖，挂在 bay_sill 构件上）。 */
export interface MasonrySillRegionInput {
  id: string;
  /** 引用的 bay_sill 构件 id。 */
  element: string;
  room: string;
  face: MasonrySillFace;
  /** 沿构件所在墙的区间（米）；缺省 = 整条 run。 */
  along?: [number, number];
  zone?: string;
}

/** 房间：地面面积 + boundary 折线（后者供 L2「声明贴合该房间侧脸」与 floor_region 归属判定）。 */
export interface MasonryRoomInput {
  id: string;
  /** 地面铺砖面积（resolved footprint）。缺省 = 该房不进地面算量，并进 unresolved。 */
  areaSqm?: number;
  /** boundary 折线（顺序顶点，自动闭合）。缺省 = 跳过脸侧校验，并进 unresolved。 */
  points?: Array<{ x: number; z: number }>;
  /**
   * 轴对齐矩形房间的包围盒（`resolveRoom` 的 x/z/width/depth 口径：x/z 是中心）。
   * `points` 缺省时用它判「floor_region 整块落在已计费房间内」——与
   * `server/budget-calculator.ts` 的 `boxInsideRoom` 回落分支同口径，且只对轴对齐矩形精确
   * （本案 11 间房里 6 间带 points，其余 5 间都是轴对齐矩形，两条分支在现行数据上都精确）。
   */
  rect?: { x: number; z: number; width: number; depth: number };
}

/** overlay 的 floor_region 声明（房间外补区，或 room + follow 声明的房间内材质区）。 */
export interface MasonryFloorRegionInput {
  id: string;
  /**
   * 该 region 的面积（㎡）。圆角闭式解暂由调用方给（`server/budget-calculator.ts` 的
   * `roundedPolygonArea`）——本阶段不把圆角算法搬进 shared，避免两套圆角几何；
   * 随「地面材料/人工共用出口」一并上移。
   */
  areaSqm: number;
  /** region 轮廓（顺序顶点）；给了才能判「整块落在已计费房间内」。 */
  points?: Array<{ x: number; z: number }>;
  /** 显式 `excluded: true`（开发商已铺 / 业主裁定不铺）——不计，但留档。 */
  excluded?: boolean;
  /** 手工覆盖「整块落在已计费房间内」的结论；不给则由本模块按几何判。 */
  insideCostedRoom?: boolean;
  /** 地材归属（follow）：指向湿区房的 extra 才进湿区，其余进干区。 */
  follow?: string;
  /**
   * 内部面层分区所属房间。与 follow 同时声明时，region 是该房间 footprint 内的独立材质区：
   * 从宿主房间材质量中扣除，再按 follow 房间的有效选材计量；单有 room 不足以声明材质分区。
   */
  room?: string;
}

/** 房间 footprint 内独立声明的地面材料区；几何及面积仍来自 overlay.floor_region。 */
export interface MasonryFloorMaterialRegion {
  id: string;
  roomId: string;
  follow: string;
  areaSqm: number;
}

export interface MasonryTakeoffInput {
  walls: MasonryWallInput[];
  wallRegions: MasonryWallRegionInput[];
  sillRegions: MasonrySillRegionInput[];
  baySills: MasonryBaySillInput[];
  rooms: MasonryRoomInput[];
  /** 干区主地面房间（`config/tile-comparison.yaml` 的 `dry_room_ids`）。必须显式给，不猜。 */
  dryRoomIds: string[];
  /** 湿区地面房间。必须显式给，不猜。 */
  wetRoomIds: string[];
  /** overlay 的 floor_region（非房间地面）。 */
  floorRegions?: MasonryFloorRegionInput[];
  /**
   * 贴砖带顶标高上限（厨卫铝扣板完成面 2.65）。**必填，不设默认值**——
   * `?? 2.65` / `?? 2.8` 这类兜底正是「漏写一条 height 就静默少算一截」的机制。
   */
  clearHeight: number;
  /** 逐房净高上限；缺房回落 `clearHeight`（仍是显式值，不是魔法数）。 */
  clearHeightByRoom?: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 产出
// ─────────────────────────────────────────────────────────────────────────────

/** 一条贴砖声明解析后的几何量。 */
export interface MasonryRegionResult {
  id: string;
  kind: 'wall' | 'sill';
  /** 声明贴附的墙（sill_region 取其 bay_sill 的墙）。 */
  wall: string;
  room: string;
  /** 沿墙区间（米）。 */
  from: number;
  to: number;
  /** 竖向带下沿 / 上沿。水平面（top / underside）是**水平面**，竖向厚度为 0，故 bottom = top = 该面标高。 */
  bottom: number;
  top: number;
  /**
   * 带高：竖向面 = top − bottom；水平面 = 该面的另一个维度（top / underside 的进深 depth）。
   * 面积恒等于 `spanM × band`。
   */
  band: number;
  /** sill_region 的面；wall_region 为 undefined。 */
  face?: MasonrySillFace;
  /** 竖向面还是水平面——二维不重叠校验按朝向分组（见 computeMasonryTakeoff）。 */
  orientation: 'vertical' | 'horizontal';
  /** 水平面标高（top 面 = sill+height；underside = sill）。 */
  planeY?: number;
  /** 墙/构件 run 自身长度（折线累计，米）。 */
  wallLength: number;
  /** 沿墙区间长度（米）。 */
  spanM: number;
  /** 面积 = spanM × band（㎡）。 */
  areaSqm: number;
  zone: string;
  /** 该声明贴附的墙是否被 suppress（sill_region 允许：防水台本就落在幕墙根）。 */
  suppressedWall: boolean;
  /** 声明区间起/中/止三点（沿墙折线取样）——脸侧校验的中间量，便于排查。 */
  spanPoints: Array<{ x: number; z: number }>;
}

/** 逐房拆分。 */
export interface MasonryRoomTakeoff {
  dryFloorSqm: number;
  wetFloorSqm: number;
  wallTileSqm: number;
  sillTileSqm: number;
  tileSqm: number;
  /** 该房贴砖声明的沿墙/沿台缘总长（米，逐面计）。 */
  declaredLinearM: number;
  /** 该房防水台等特殊工艺延长米（米，按构件去重）。 */
  extrasLinearM: number;
}

/** 有量但没有计价归属的条目：显形，禁止静默计入某个费率行。 */
export interface MasonryUnpricedItem {
  id: string;
  quantity: number | null;
  unit: string;
  reason: string;
}

/** 无法从声明派生的条目。`kind: 'pending'` = 已登记的项目决策仍在等确认。 */
export interface MasonryUnresolvedItem {
  id: string;
  reason: string;
  kind?: 'error' | 'pending';
}

export interface MasonryTakeoffResult {
  regions: MasonryRegionResult[];
  // ── 量 ──
  /**
   * 干区主地面铺砖面积（㎡）= dryRoomIds 房间 footprint + 内部材质转入量 + 外部干区floor_region extra
   * − 转入湿区的内部材质量。
   * 不含 extra 的纯房间口径见 `dryRoomFloorSqm`。
   */
  dryFloorSqm: number;
  /** 湿区地面铺砖面积（㎡）= wetRoomIds 房间 footprint + 内部材质转入量 + 外部湿区floor_region extra − 转入干区的内部材质量。 */
  wetFloorSqm: number;
  /** 仅 dryRoomIds 房间 footprint 之和（与 `config/tile-comparison.yaml` 的 netDryAreaSqm 同口径）。 */
  dryRoomFloorSqm: number;
  /** 仅 wetRoomIds 房间 footprint 之和。 */
  wetRoomFloorSqm: number;
  /** `wall_region` 声明实算（㎡）。 */
  wallTileSqm: number;
  /** `sill_region` 声明实算（㎡）。 */
  sillTileSqm: number;
  /**
   * 防水台/反边等特殊工艺延长米（米）：按 bay_sill 构件对声明 run 取**并集**，
   * 与 control.yaml COST-060-05「窗边台贴小砖条 20 元/米 × 6.20m」同口径（一条矮台只算一次台长）。
   */
  extrasLinearM: number;
  /** 逐面声明的 run 之和（米）：front/top/underside 各算各的，仅供审计对照。 */
  sillFaceLinearM: number;
  /** dry + wet 房间 footprint（不含任何 floor_region extra）。 */
  totalRoomFloorSqm: number;
  /** floor_region 里**要加进**算量的房间外面积（不在任何已计费房间内、也未 excluded）。 */
  floorRegionExtraSqm: number;
  /** 房间 footprint 内由内部面层分区转移出的面积；它不是额外面积，不改变全屋总量。 */
  floorRegionInternalSqm: number;
  /** 内部面层分区，budget/material comparison按region.follow解析选材。 */
  floorMaterialRegions: MasonryFloorMaterialRegion[];
  /** 显式 `excluded: true` 的面积合计（留档：有意不算，不是漏算）。 */
  floorRegionExcludedSqm: number;
  /** 整块落在已计费房间内而被跳过的面积合计（留档：再算即双计）。 */
  floorRegionSkippedInsideRoomSqm: number;
  /** 全部贴砖面积 = wallTileSqm + sillTileSqm。 */
  totalTileSqm: number;
  byRoom: Record<string, MasonryRoomTakeoff>;
  byZone: Record<string, number>;
  /** 独立推导的「可贴实体墙长」逐房（米）：房间 boundary 被未 suppress 实体墙覆盖的长度。 */
  tileableWallLengthM: Record<string, number>;
  /** 声明 union 墙长逐房（米）：同墙多段堆叠只算一次墙长。**只含 wall_region**——
   *  sill_region 挂在 suppress 的幕墙根，与「可贴实体墙长」不可比。 */
  declaredUnionLengthM: Record<string, number>;
  /** 投影出来的洞口沿墙区间总数（瓷砖不扣洞，只校验「不得盖住」）。 */
  openingsProjected: number;
  // ── 显形清单 ──
  /** 声明引用了不在传入房间表里的 room。 */
  unknownRoomZoneIds: string[];
  /** dryRoomIds / wetRoomIds 里不在传入房间表的 id。 */
  unknownDryRoomIds: string[];
  unknownWetRoomIds: string[];
  /** 有地面面积但既没进干区也没进湿区的房间（生活阳台即此列）。 */
  unresolvedRoomIds: string[];
  /** 有量但没有计价归属的条目。 */
  unpriced: MasonryUnpricedItem[];
  /** 无法从声明派生的条目。 */
  unresolved: MasonryUnresolvedItem[];
  /** 不阻断、但报价前必须看的告警。 */
  warnings: string[];
  /** 显式排除的 floor_region id。 */
  excludedFloorRegionIds: string[];
  /** 因「整块落在已计费房间内」被跳过的 floor_region id。 */
  skippedInsideRoomFloorRegionIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────────────────────

/** 墙的折线总长（segments 优先，否则单段弦线）。 */
export function masonryWallLength(wall: MasonryWallInput): number {
  return wallSegments(wall).reduce((sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
}

function wallSegments(wall: MasonryWallInput): MasonrySegment[] {
  return wall.segments?.length
    ? wall.segments
    : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
}

/** 沿墙折线走 `distance` 米处的世界坐标；越界返回 null。 */
export function masonryPointAt(wall: MasonryWallInput, distance: number): { x: number; z: number } | null {
  let remaining = distance;
  for (const segment of wallSegments(wall)) {
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

/**
 * 把墙上的 openings（世界坐标中心）投影成沿墙区间。
 * 与 `shared/paint-scope.ts` 的 `doorGapsOnWall` 同款投影：openings 的 x/z 是洞口**中心**绝对值，
 * 投影到墙 from→to 方向得到 along 区间（墙在当前模型里均为单段，保留折线通用性）。
 */
export function masonryOpeningSpans(wall: MasonryWallInput): Array<{
  id: string;
  kind: 'door' | 'window';
  from: number;
  to: number;
  bottom: number;
  top: number;
}> {
  const segments = wallSegments(wall);
  const total = masonryWallLength(wall);
  const out: Array<{ id: string; kind: 'door' | 'window'; from: number; to: number; bottom: number; top: number }> = [];
  for (const opening of wall.openings ?? []) {
    let remaining = total;
    let along = -1;
    for (const segment of segments) {
      const dx = segment.x2 - segment.x1;
      const dz = segment.z2 - segment.z1;
      const length = Math.hypot(dx, dz);
      if (length <= EPS) continue;
      const t = ((opening.x - segment.x1) * dx + (opening.z - segment.z1) * dz) / (length * length);
      if (t < -1e-6 || t > 1 + 1e-6) {
        remaining -= length;
        continue;
      }
      const clamped = Math.min(1, Math.max(0, t));
      along = total - remaining + length * clamped;
      break;
    }
    if (along < 0) continue;
    const half = opening.width / 2;
    const bottom = opening.sill ?? 0;
    out.push({
      id: opening.id,
      kind: opening.type === 'door' ? 'door' : 'window',
      from: along - half,
      to: along + half,
      bottom,
      top: bottom + opening.height,
    });
  }
  return out;
}

/** 点是否在多边形内或边上。边界算「内」：`corridor_floor` 的四角正压在邻房边上。 */
export function masonryPointInPolygonOrOnEdge(
  point: { x: number; z: number },
  polygon: Array<{ x: number; z: number }>,
  tolerance = 1e-6,
): boolean {
  if (polygon.length < 3) return false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length <= tolerance) continue;
    const t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length);
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    if (Math.hypot(point.x - cx, point.z - cz) <= tolerance) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if (a.z === b.z) continue;
    if ((a.z > point.z) !== (b.z > point.z)) {
      const x = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * L2 独立推导：房间 boundary 每条边被【未 suppress 的实体墙】覆盖的长度（米）。
 * 与 `tmp/verify-wall-tile.ts` 的 `tileableOf` 同款几何交叉——不读 overlay 声明，
 * 所以能真正独立验证「声明 union ⊆ 可贴墙长」。
 */
export function masonryTileableWallLength(
  roomPoints: Array<{ x: number; z: number }>,
  walls: MasonryWallInput[],
): number {
  let total = 0;
  for (let i = 0; i < roomPoints.length; i += 1) {
    const p = roomPoints[i];
    const q = roomPoints[(i + 1) % roomPoints.length];
    if (!p || !q) continue;
    const vertical = Math.abs(p.x - q.x) <= 1e-9;
    const horizontal = Math.abs(p.z - q.z) <= 1e-9;
    if (!vertical && !horizontal) continue;
    for (const wall of walls) {
      if (wall.suppressed) continue;
      for (const segment of wallSegments(wall)) {
        const segVertical = Math.abs(segment.x1 - segment.x2) <= 1e-9;
        const segHorizontal = Math.abs(segment.z1 - segment.z2) <= 1e-9;
        if (vertical && segVertical && Math.abs(segment.x1 - p.x) <= 1e-9) {
          total += intervalOverlap(
            [Math.min(p.z, q.z), Math.max(p.z, q.z)],
            [Math.min(segment.z1, segment.z2), Math.max(segment.z1, segment.z2)],
          );
        } else if (horizontal && segHorizontal && Math.abs(segment.z1 - p.z) <= 1e-9) {
          total += intervalOverlap(
            [Math.min(p.x, q.x), Math.max(p.x, q.x)],
            [Math.min(segment.x1, segment.x2), Math.max(segment.x1, segment.x2)],
          );
        }
      }
    }
  }
  return total;
}

function intervalOverlap(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/** 同一面墙上多段区间的 union 长度（米）：堆叠段只算一次墙长。 */
export function masonryUnionLength(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursorTo = -Infinity;
  for (const [from, to] of sorted) {
    const low = Math.max(from, cursorTo);
    if (to > low) total += to - low;
    cursorTo = Math.max(cursorTo, to);
  }
  return total;
}

/** face → 带高：front 用构件 height（竖面），top / underside 用 depth（水平面）。 */
export function masonrySillBand(bay: MasonryBaySillInput, face: MasonrySillFace): number {
  return face === 'front' ? bay.height : bay.depth;
}

// ─────────────────────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 按 overlay 声明实算瓦工工程量。
 *
 * fail-closed 的几类错误（都是抛错，不是 warning）：
 *   - wall_region 引用不存在的墙 / 被 suppress 的墙（玻璃幕墙不可贴砖）
 *   - along 越出墙长（含 sill_region 越出构件 run）
 *   - 同 (墙, 房间) 的竖向贴砖面二维重叠（along 与竖向同时重叠 = 双计）
 *   - 同一墙同一房间同一标高的水平贴砖面沿墙重叠
 *   - 贴砖带顶标高超净高（`clearHeight` 必填，不设默认值）
 *   - 瓷砖声明盖住门/窗洞（DEC-2026-10-09-P11 的 F07a：瓷砖不扣洞，盖住就是实打实多算）
 *   - dryRoomIds 与 wetRoomIds 交叠
 */
export function computeMasonryTakeoff(input: MasonryTakeoffInput): MasonryTakeoffResult {
  if (!Number.isFinite(input.clearHeight) || input.clearHeight <= 0) {
    throw new Error('computeMasonryTakeoff: clearHeight 必填且必须为正（厨卫铝扣板完成面，不设默认值）');
  }

  const wallById = new Map(input.walls.map((wall) => [wall.id, wall]));
  const bayById = new Map(input.baySills.map((bay) => [bay.id, bay]));
  const roomById = new Map(input.rooms.map((room) => [room.id, room]));

  const clearHeightFor = (roomId: string): number => input.clearHeightByRoom?.[roomId] ?? input.clearHeight;

  const result: MasonryTakeoffResult = {
    regions: [],
    dryFloorSqm: 0,
    wetFloorSqm: 0,
    dryRoomFloorSqm: 0,
    wetRoomFloorSqm: 0,
    wallTileSqm: 0,
    sillTileSqm: 0,
    extrasLinearM: 0,
    sillFaceLinearM: 0,
    totalRoomFloorSqm: 0,
    floorRegionExtraSqm: 0,
    floorRegionInternalSqm: 0,
    floorMaterialRegions: [],
    floorRegionExcludedSqm: 0,
    floorRegionSkippedInsideRoomSqm: 0,
    totalTileSqm: 0,
    byRoom: {},
    byZone: {},
    tileableWallLengthM: {},
    declaredUnionLengthM: {},
    openingsProjected: 0,
    unknownRoomZoneIds: [],
    unknownDryRoomIds: [],
    unknownWetRoomIds: [],
    unresolvedRoomIds: [],
    unpriced: [],
    unresolved: [],
    warnings: [],
    excludedFloorRegionIds: [],
    skippedInsideRoomFloorRegionIds: [],
  };

  // ── 1. wall_region：声明 → 几何量 ─────────────────────────────────────────
  for (const region of input.wallRegions) {
    const wall = wallById.get(region.wall);
    if (!wall) throw new Error(`wall_region ${region.id} references unknown wall ${region.wall}`);
    if (wall.suppressed) {
      throw new Error(`wall_region ${region.id} references suppressed wall ${region.wall}（玻璃幕墙/实体已删除，不可贴砖）`);
    }
    if (!Number.isFinite(region.height)) {
      throw new Error(`wall_region ${region.id} 缺 height（贴砖带顶标高）——不回落墙高、不回落 2.65 魔法数`);
    }
    const wallLength = masonryWallLength(wall);
    const from = Math.min(region.along[0], region.along[1]);
    const to = Math.max(region.along[0], region.along[1]);
    if (from < -EPS || to > wallLength + EPS || to - from <= EPS) {
      throw new Error(`wall_region ${region.id}: along [${from}, ${to}] is outside wall ${region.wall} (length ${wallLength})`);
    }
    const bottom = region.bottom ?? 0;
    const top = region.height;
    if (!(top > bottom)) throw new Error(`wall_region ${region.id}: height ${top} must exceed bottom ${bottom}`);
    if (top > clearHeightFor(region.room) + EPS) {
      throw new Error(`wall_region ${region.id}: 顶标高 ${top} 超净高 ${clearHeightFor(region.room)}`);
    }
    result.regions.push({
      id: region.id,
      kind: 'wall',
      wall: region.wall,
      room: region.room,
      from,
      to,
      bottom,
      top,
      band: top - bottom,
      orientation: 'vertical',
      wallLength,
      spanM: to - from,
      areaSqm: (to - from) * (top - bottom),
      zone: region.zone ?? 'visible',
      suppressedWall: false,
      spanPoints: [from, (from + to) / 2, to].flatMap((distance) => {
        const point = masonryPointAt(wall, distance);
        return point ? [point] : [];
      }),
    });
  }

  // ── 2. sill_region：挂 bay_sill 构件，面积 = along × face 对应尺寸 ──────────
  /** 构件 id → 该构件上各面声明的 run 区间（防水台延长米按构件取并集）。 */
  const runsByElement = new Map<string, Array<[number, number]>>();
  for (const region of input.sillRegions) {
    const bay = bayById.get(region.element);
    if (!bay) throw new Error(`sill_region ${region.id} references unknown bay_sill ${region.element}`);
    const wall = wallById.get(bay.wall);
    if (!wall) throw new Error(`sill_region ${region.id}: bay_sill ${region.element} references unknown wall ${bay.wall}`);
    // 防水台/上飘窗本就落在玻璃幕墙根部，故 sill_region **允许**引用被 suppress 的墙；
    // 但必须留名显形，不能静默放过（本案 8 条 sill_region 全部落在幕墙根）。
    if (wall.suppressed) {
      result.warnings.push(
        `${region.id} 贴附的墙 ${bay.wall} 被 suppress（玻璃幕墙）——sill_region 允许（防水台落在幕墙根），此处留名备核`,
      );
    }
    const segments = bay.segments?.length ? bay.segments : wallSegments(wall);
    const runLength = segments.reduce((sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
    if (!(runLength > 0)) throw new Error(`sill_region ${region.id}: bay_sill ${region.element} resolved to zero-length run`);
    const chord = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);
    if (region.along === undefined && Math.abs(runLength - chord) > 0.01) {
      // 弧墙：3D 端 SceneBuilder 缺 along 时默认取折线全长，而审计口径
      // （tmp/verify-wall-tile.ts / wall-tile-inspection.test.ts）取弦长。两种口径必然分叉，必须显形。
      result.warnings.push(
        `${region.id} 未声明 along，且 bay_sill ${region.element} 所在墙 ${bay.wall} 是弧墙（折线 ${runLength.toFixed(4)}m ≠ 弦长 ${chord.toFixed(4)}m）：本模块按折线全长算（与 3D 同源），弦长口径会少 ${((runLength - chord) * masonrySillBand(bay, region.face)).toFixed(4)}㎡；修法是给该声明补显式 along`,
      );
    }
    const from = region.along ? Math.min(region.along[0], region.along[1]) : 0;
    const to = region.along ? Math.max(region.along[0], region.along[1]) : runLength;
    if (from < -EPS || to > runLength + EPS || to - from <= EPS) {
      throw new Error(`sill_region ${region.id}: along [${from}, ${to}] is outside target run (length ${runLength})`);
    }
    const sill = bay.sill ?? 0;
    const band = masonrySillBand(bay, region.face);
    if (!(band > 0)) {
      throw new Error(`sill_region ${region.id}: face ${region.face} 的带高必须为正（height=${bay.height} depth=${bay.depth}）`);
    }
    // 竖面（front）：竖向带 sill → sill + height。
    // 水平面（top / underside）：本身是**水平面**、竖向厚度为 0，故 bottom = top = 该面标高
    //（top 面标高 = sill + height；underside 标高 = sill，与 SceneBuilder 的 position.y 同源）。
    const bottom = region.face === 'front' ? sill : region.face === 'top' ? sill + bay.height : sill;
    const top = region.face === 'front' ? sill + bay.height : bottom;
    const spanPoints: Array<{ x: number; z: number }> = [];
    let walked = 0;
    for (const segment of segments) {
      const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
      const segmentFrom = walked;
      walked += length;
      if (length <= EPS) continue;
      const low = Math.max(from, segmentFrom);
      const high = Math.min(to, walked);
      if (high - low <= EPS) continue;
      for (const distance of [low, (low + high) / 2, high]) {
        const t = (distance - segmentFrom) / length;
        spanPoints.push({
          x: segment.x1 + (segment.x2 - segment.x1) * t,
          z: segment.z1 + (segment.z2 - segment.z1) * t,
        });
      }
    }
    if (!spanPoints.length) throw new Error(`sill_region ${region.id}: 沿墙区间 [${from}, ${to}] 取不到几何点`);
    result.regions.push({
      id: region.id,
      kind: 'sill',
      wall: bay.wall,
      room: region.room,
      from,
      to,
      bottom,
      top,
      band,
      face: region.face,
      orientation: region.face === 'front' ? 'vertical' : 'horizontal',
      ...(region.face === 'front' ? {} : { planeY: bottom }),
      wallLength: runLength,
      spanM: to - from,
      areaSqm: (to - from) * band,
      zone: region.zone ?? 'visible',
      suppressedWall: Boolean(wall.suppressed),
      spanPoints,
    });
    result.sillFaceLinearM += to - from;
    (runsByElement.get(region.element) ?? runsByElement.set(region.element, []).get(region.element)!).push([from, to]);
  }

  // ── 3. L2 交叉层：引用房间存在 + 声明贴合该房间侧脸 ───────────────────────
  for (const region of result.regions) {
    const room = roomById.get(region.room);
    if (!room) {
      result.unknownRoomZoneIds.push(region.id);
      continue;
    }
    const roomPoints = room.points?.length ? room.points : rectCorners(room.rect);
    if (!roomPoints) {
      result.unresolved.push({
        id: region.id,
        reason: `房间 ${region.room} 未提供 boundary 折线/包围盒，跳过「声明贴合该房间侧脸」校验`,
        kind: 'pending',
      });
      continue;
    }
    const offRoom = region.spanPoints.filter((point) => !masonryPointInPolygonOrOnEdge(point, roomPoints, 1e-6));
    if (offRoom.length) {
      throw new Error(
        `${region.id}（${region.kind}，墙 ${region.wall}）声明区间 [${region.from}, ${region.to}] 的取样点 `
        + offRoom.map((point) => `(${point.x.toFixed(3)}, ${point.z.toFixed(3)})`).join(' ')
        + ` 不在房间 ${region.room} 的 boundary 上——贴错脸或区间越出该房范围`,
      );
    }
  }

  // ── 4. 不重叠校验 ────────────────────────────────────────────────────────
  // 竖向贴砖面（wall_region + sill front）：同 (墙, 房间) 二维不重叠。
  // 竖直接贴不算双计（R11：东墙 0.90m 杂砖带与 0.90→1.40m 灶台挡水条同墙堆叠合法）。
  const verticalByKey = new Map<string, MasonryRegionResult[]>();
  for (const region of result.regions) {
    if (region.orientation !== 'vertical') continue;
    const key = `${region.wall}|${region.room}`;
    (verticalByKey.get(key) ?? verticalByKey.set(key, []).get(key)!).push(region);
  }
  for (const [key, group] of verticalByKey) {
    const sorted = [...group].sort((a, b) => a.from - b.from || a.bottom - b.bottom);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (current.from < previous.to - EPS && current.bottom < previous.top - EPS) {
        throw new Error(`${key} 上 ${previous.id} 与 ${current.id} 二维重叠（双计风险）`);
      }
    }
  }
  // 水平贴砖面（sill top / underside）：同墙同房同标高才可能相压，只比沿墙区间。
  const horizontalByKey = new Map<string, MasonryRegionResult[]>();
  for (const region of result.regions) {
    if (region.orientation !== 'horizontal') continue;
    const key = `${region.wall}|${region.room}|${region.planeY?.toFixed(6)}`;
    (horizontalByKey.get(key) ?? horizontalByKey.set(key, []).get(key)!).push(region);
  }
  for (const [key, group] of horizontalByKey) {
    const sorted = [...group].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].from < sorted[i - 1].to - EPS) {
        throw new Error(`${key} 上 ${sorted[i - 1].id} 与 ${sorted[i].id} 水平贴砖面沿墙重叠（双计风险）`);
      }
    }
  }

  // ── 5. 洞口校验：瓷砖**不扣洞**（DEC-2026-10-09-P11），盖住即抛错 ───────────
  // 口径与 `shared/finish/rules.ts` 的 F07a `finish.tile_over_opening` 一致：只查**竖向**面层
  // （wall_region + sill 的 front 竖面）——`wall_region` 是单张 PlaneGeometry、不拆洞，
  // 盖住洞口就是实打实多算。水平台面（top / underside）不在 F07a 现行范围内。
  const openingsByWall = new Map<string, ReturnType<typeof masonryOpeningSpans>>();
  for (const wall of input.walls) {
    const spans = masonryOpeningSpans(wall);
    if (spans.length) {
      openingsByWall.set(wall.id, spans);
      result.openingsProjected += spans.length;
    }
  }
  if (openingsByWall.size === 0) {
    result.unresolved.push({
      id: 'openings',
      reason: '未提供任何墙洞口数据，F07a「瓷砖不得盖住门/窗洞」校验未执行（DEC-2026-10-09-P11）',
      kind: 'pending',
    });
  }
  for (const region of result.regions) {
    if (region.orientation !== 'vertical') continue;
    for (const opening of openingsByWall.get(region.wall) ?? []) {
      const from = Math.max(opening.from, region.from);
      const to = Math.min(opening.to, region.to);
      const bottom = Math.max(opening.bottom, region.bottom);
      const top = Math.min(opening.top, region.top);
      if (to - from <= EPS || top - bottom <= EPS) continue;
      throw new Error(
        `${region.id} 贴砖声明盖住${opening.kind === 'door' ? '门' : '窗'}洞 ${opening.id}`
        + `（沿墙 [${from.toFixed(3)}, ${to.toFixed(3)}] × 竖向 [${bottom.toFixed(3)}, ${top.toFixed(3)}]）`
        + '——瓷砖不扣洞，盖住即实打实多算（DEC-2026-10-09-P11 F07a）',
      );
    }
  }

  // ── 6. 地面：干区 / 湿区 / 房间内面层分区 / floor_region extra ─────────────
  const dryRoomIds = new Set(input.dryRoomIds);
  const wetRoomIds = new Set(input.wetRoomIds);
  const overlap = [...dryRoomIds].filter((id) => wetRoomIds.has(id));
  if (overlap.length) throw new Error(`dryRoomIds 与 wetRoomIds 交叠：${overlap.join(', ')}`);

  const costedRooms = input.rooms.filter((room) => room.id && (dryRoomIds.has(room.id) || wetRoomIds.has(room.id)));
  const internalRegions = (input.floorRegions ?? []).filter((region) =>
    region.excluded !== true && (region.room !== undefined || region.follow !== undefined),
  );
  const internalByRoom = new Map<string, MasonryFloorMaterialRegion[]>();
  let externalDryExtra = 0;
  let externalWetExtra = 0;

  for (const region of internalRegions) {
    if (!region.room) {
      // Existing exterior/transition floor regions may follow a material room without being inside it.
      continue;
    }
    if (!region.follow) {
      throw new Error(`floor_region ${region.id} declares room ${region.room} without follow; an internal material zone must specify both`);
    }
    const host = roomById.get(region.room);
    if (!host) throw new Error(`floor_region ${region.id} references unknown host room ${region.room}`);
    if (!dryRoomIds.has(host.id) && !wetRoomIds.has(host.id)) {
      throw new Error(`floor_region ${region.id} host room ${host.id} has no dry/wet floor classification`);
    }
    if (!roomById.has(region.follow)) throw new Error(`floor_region ${region.id} follows unknown material room ${region.follow}`);
    if (!dryRoomIds.has(region.follow) && !wetRoomIds.has(region.follow)) {
      throw new Error(`floor_region ${region.id} follows ${region.follow}, which has no dry/wet floor classification`);
    }
    if (!Number.isFinite(region.areaSqm) || region.areaSqm <= 0) {
      throw new Error(`floor_region ${region.id} internal material area must be a positive finite number`);
    }
    if (!region.points?.length || region.points.length < 3) {
      throw new Error(`floor_region ${region.id} declares host room ${host.id} but has no usable points`);
    }
    const insideHost = floorRegionInsideCostedRoom(region, [host]);
    if (!insideHost) {
      throw new Error(`floor_region ${region.id} is not wholly inside declared host room ${host.id}`);
    }
    const entry: MasonryFloorMaterialRegion = {
      id: region.id,
      roomId: host.id,
      follow: region.follow,
      areaSqm: region.areaSqm,
    };
    const existing = internalByRoom.get(host.id) ?? [];
    // Conservative overlap guard: disjoint interior finish zones must have disjoint bounding boxes.
    // This avoids double-subtraction without adding a second polygon-clipping implementation here.
    for (const other of existing) {
      const otherRegion = (input.floorRegions ?? []).find((candidate) => candidate.id === other.id)!;
      if (floorRegionBoundsOverlap(region, otherRegion)) {
        throw new Error(`internal floor material regions ${other.id} and ${region.id} have overlapping bounds in ${host.id}`);
      }
    }
    existing.push(entry);
    internalByRoom.set(host.id, existing);
    result.floorMaterialRegions.push(entry);
    result.floorRegionInternalSqm += region.areaSqm;
  }

  for (const [roomId, regions] of internalByRoom) {
    const host = roomById.get(roomId)!;
    const area = regions.reduce((sum, region) => sum + region.areaSqm, 0);
    if (host.areaSqm === undefined || area > host.areaSqm + 1e-6) {
      throw new Error(`internal floor material regions in ${roomId} total ${area}㎡, exceeding host room area ${host.areaSqm ?? 'unresolved'}㎡`);
    }
  }

  for (const room of input.rooms) {
    if (room.areaSqm === undefined) {
      result.unresolved.push({ id: room.id, reason: `房间 ${room.id} 未提供地面面积`, kind: 'pending' });
      continue;
    }
    const dry = dryRoomIds.has(room.id);
    const wet = wetRoomIds.has(room.id);
    if (dry) result.dryRoomFloorSqm += room.areaSqm;
    if (wet) result.wetRoomFloorSqm += room.areaSqm;
    if (!dry && !wet) {
      // 有面积但两个清单都没列 → 没有计价归属。生活阳台（湿区小砖、按间包干口径未裁）即此列。
      result.unresolvedRoomIds.push(room.id);
      result.unpriced.push({
        id: room.id,
        quantity: room.areaSqm,
        unit: '㎡',
        reason: `房间 ${room.id} 有 ${room.areaSqm}㎡ 地面，但既不在 dryRoomIds 也不在 wetRoomIds——没有计价归属，禁止静默计入某一档`,
      });
    }
  }
  for (const id of input.dryRoomIds) if (!roomById.has(id)) result.unknownDryRoomIds.push(id);
  for (const id of input.wetRoomIds) if (!roomById.has(id)) result.unknownWetRoomIds.push(id);

  for (const region of input.floorRegions ?? []) {
    if (region.excluded === true) {
      result.floorRegionExcludedSqm += region.areaSqm;
      result.excludedFloorRegionIds.push(region.id);
      continue;
    }
    if (region.room && region.follow) {
      // This region is not an extra floor area. Its area is transferred out of the host room
      // footprint into the material/labor bucket selected by follow.
      continue;
    }
    // 整块落在某个已计费房间内 → 这块地已经由房间 footprint 算过（DEC-2026-10-09-P16：默认计入，
    // 只有「落在已计费房间内」与「显式 excluded」两种例外退出）。
    const insideRoom = region.insideCostedRoom ?? (region.points?.length ? floorRegionInsideCostedRoom(region, costedRooms) : undefined);
    if (insideRoom === undefined) {
      result.unresolved.push({
        id: region.id,
        reason: 'floor_region 未给轮廓 points，也无法从配置判「是否整块落在已计费房间内」——不计也不排除，显形待裁',
        kind: 'pending',
      });
      continue;
    }
    if (insideRoom) {
      result.floorRegionSkippedInsideRoomSqm += region.areaSqm;
      result.skippedInsideRoomFloorRegionIds.push(region.id);
      continue;
    }
    result.floorRegionExtraSqm += region.areaSqm;
    if (region.follow && wetRoomIds.has(region.follow)) externalWetExtra += region.areaSqm;
    else externalDryExtra += region.areaSqm;
  }
  let transferWetToDry = 0;
  let transferDryToWet = 0;
  for (const region of result.floorMaterialRegions) {
    const hostIsWet = wetRoomIds.has(region.roomId);
    const targetIsWet = wetRoomIds.has(region.follow);
    if (hostIsWet && !targetIsWet) transferWetToDry += region.areaSqm;
    if (!hostIsWet && targetIsWet) transferDryToWet += region.areaSqm;
  }
  result.dryFloorSqm = result.dryRoomFloorSqm + externalDryExtra + transferWetToDry - transferDryToWet;
  result.wetFloorSqm = result.wetRoomFloorSqm + externalWetExtra + transferDryToWet - transferWetToDry;
  result.totalRoomFloorSqm = result.dryRoomFloorSqm + result.wetRoomFloorSqm;

  // ── 7. 汇总：逐房 + 总数 + 独立推导对账 ─────────────────────────────────
  for (const region of result.regions) {
    const bucket = (result.byRoom[region.room] ??= {
      dryFloorSqm: 0,
      wetFloorSqm: 0,
      wallTileSqm: 0,
      sillTileSqm: 0,
      tileSqm: 0,
      declaredLinearM: 0,
      extrasLinearM: 0,
    });
    if (region.kind === 'wall') bucket.wallTileSqm += region.areaSqm;
    else bucket.sillTileSqm += region.areaSqm;
    bucket.tileSqm += region.areaSqm;
    bucket.declaredLinearM += region.spanM;
    result.byZone[region.zone] = (result.byZone[region.zone] ?? 0) + region.areaSqm;
  }
  // 防水台延长米按**构件**去重后回填房间（front/top 同一条矮台只算一次台长）。
  const elementRoom = new Map<string, string>();
  for (const region of input.sillRegions) elementRoom.set(region.element, region.room);
  const extrasByRoom = new Map<string, number>();
  for (const [element, runs] of runsByElement) {
    const room = elementRoom.get(element);
    if (!room) continue;
    extrasByRoom.set(room, (extrasByRoom.get(room) ?? 0) + masonryUnionLength(runs));
  }
  result.extrasLinearM = [...extrasByRoom.values()].reduce((sum, value) => sum + value, 0);
  for (const room of input.rooms) {
    const bucket = (result.byRoom[room.id] ??= {
      dryFloorSqm: 0,
      wetFloorSqm: 0,
      wallTileSqm: 0,
      sillTileSqm: 0,
      tileSqm: 0,
      declaredLinearM: 0,
      extrasLinearM: 0,
    });
    let dryRoomArea = dryRoomIds.has(room.id) ? room.areaSqm ?? 0 : 0;
    let wetRoomArea = wetRoomIds.has(room.id) ? room.areaSqm ?? 0 : 0;
    for (const region of internalByRoom.get(room.id) ?? []) {
      if (dryRoomIds.has(room.id)) dryRoomArea -= region.areaSqm;
      if (wetRoomIds.has(room.id)) wetRoomArea -= region.areaSqm;
      if (wetRoomIds.has(region.follow)) wetRoomArea += region.areaSqm;
      else dryRoomArea += region.areaSqm;
    }
    bucket.dryFloorSqm += dryRoomArea;
    bucket.wetFloorSqm += wetRoomArea;
    bucket.extrasLinearM = extrasByRoom.get(room.id) ?? 0;
  }

  // 独立推导的可贴墙长（L2 对账用）：只对有 boundary / 包围盒的房间算。
  for (const room of input.rooms) {
    const roomPoints = room.points?.length ? room.points : rectCorners(room.rect);
    if (!roomPoints) continue;
    result.tileableWallLengthM[room.id] = masonryTileableWallLength(roomPoints, input.walls);
    // union 必须**逐墙**算再求和：同一房间的不同墙 along 都从 0 起，混在一起取并集会互相吞掉。
    // 只算 wall_region——sill_region 挂在 suppress 的玻璃幕墙根部，不在「可贴实体墙」推导范围内
    // （tmp/verify-wall-tile.ts 把 sill 也算进 union，于是厨房 7.6m > 可贴 4.8m 恒 MISMATCH）。
    const byWall = new Map<string, Array<[number, number]>>();
    for (const region of result.regions) {
      if (region.room !== room.id || region.kind !== 'wall') continue;
      (byWall.get(region.wall) ?? byWall.set(region.wall, []).get(region.wall)!).push([region.from, region.to]);
    }
    let union = 0;
    for (const intervals of byWall.values()) union += masonryUnionLength(intervals);
    result.declaredUnionLengthM[room.id] = union;
  }

  result.wallTileSqm = result.regions.filter((region) => region.kind === 'wall').reduce((sum, region) => sum + region.areaSqm, 0);
  result.sillTileSqm = result.regions.filter((region) => region.kind === 'sill').reduce((sum, region) => sum + region.areaSqm, 0);
  result.totalTileSqm = result.wallTileSqm + result.sillTileSqm;

  // 反边 / 开孔 / 壁龛等 extras 在 overlay 里**没有声明源**，无法派生延长米或个数——
  // 必须显形（control.yaml COST-060-05 锚点：反边 60 元/米、底盒开孔 20 元/个、壁龛 250/400 元/个）。
  result.unpriced.push({
    id: 'extras_uncovered',
    quantity: null,
    unit: '—',
    reason: '反边/海棠角/底盒开孔/壁龛/包管在 overlay 无声明源，本模块不派生其延长米与个数（COST-060-05 锚点待报价轮）',
  });

  result.regions.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

/** floor_region 轮廓四角是否全部落在某个已计费房间内（多边形包含优先，轴对齐矩形回落包围盒）。 */
function floorRegionInsideCostedRoom(
  region: MasonryFloorRegionInput,
  costedRooms: MasonryRoomInput[],
): boolean {
  const points = region.points ?? [];
  if (points.length < 3) return false;
  const candidates = region.room ? costedRooms.filter((room) => room.id === region.room) : costedRooms;
  return candidates.some((room) => {
    const roomPoints = room.points?.length ? room.points : rectCorners(room.rect);
    if (!roomPoints) return false;
    return points.every((point) => masonryPointInPolygonOrOnEdge(point, roomPoints, 1e-6));
  });
}

/** Conservative internal-zone overlap guard; shared bounding area means the zones need separate review. */
function floorRegionBoundsOverlap(a: MasonryFloorRegionInput, b: MasonryFloorRegionInput): boolean {
  const pointsA = a.points ?? [];
  const pointsB = b.points ?? [];
  if (pointsA.length < 3 || pointsB.length < 3) return true;
  const minAx = Math.min(...pointsA.map((point) => point.x));
  const maxAx = Math.max(...pointsA.map((point) => point.x));
  const minAz = Math.min(...pointsA.map((point) => point.z));
  const maxAz = Math.max(...pointsA.map((point) => point.z));
  const minBx = Math.min(...pointsB.map((point) => point.x));
  const maxBx = Math.max(...pointsB.map((point) => point.x));
  const minBz = Math.min(...pointsB.map((point) => point.z));
  const maxBz = Math.max(...pointsB.map((point) => point.z));
  return Math.min(maxAx, maxBx) - Math.max(minAx, minBx) > EPS
    && Math.min(maxAz, maxBz) - Math.max(minAz, minBz) > EPS;
}

/** `resolveRoom` 的 x/z/width/depth（中心 + 尺寸）→ 四角折线。 */
function rectCorners(rect: MasonryRoomInput['rect']): Array<{ x: number; z: number }> | null {
  if (!rect || !(rect.width > 0) || !(rect.depth > 0)) return null;
  const minX = rect.x - rect.width / 2;
  const maxX = rect.x + rect.width / 2;
  const minZ = rect.z - rect.depth / 2;
  const maxZ = rect.z + rect.depth / 2;
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
}
