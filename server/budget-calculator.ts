import { readFileSync } from 'node:fs';
import type {
  CurrentScheme,
  BudgetSnapshot,
  BudgetLineItem,
  BudgetCategory,
  BudgetAttribution,
  DesignRulesConfig,
  RoomLayout,
  BudgetCategoryRaw,
  PhaseId,
  CurtainPoint,
  DesignOption,
} from '../shared/types.js';
import { computeCeilingTakeoff, type CeilingTakeoff } from '../shared/ceiling-takeoff.js';
import { loadCeilingConfig } from './config-loader.js';
import { parseOverlay } from './overlay-merge.js';
import { loadCeilingQuotes, type CeilingQuotesFile } from './ceiling-quotes.js';
import { resolveActiveCeilingRates, compareCeilingQuotes, type CeilingQuoteRateKey, type ResolvedCeilingRates } from './ceiling-quotes.js';
import type { ProjectCatalog } from './project-catalog.js';
import type { ResolvedLayout } from '../shared/types.js';
import { isBudgetTopicIncluded, loadPhaseScopes } from './phase-scope.js';
import { controlPathForPhase, loadPhaseControlAuthority } from './phase-control.js';
import { computePaintScopeForLayout, loadPaintScopeInputs } from './paint-cost-comparison.js';

/**
 * 涂装**净**面积（净墙 + 顶 + 普通漆窗台）逐房间表：唯一来源是 overlay.yaml 的 paint_region 声明 +
 * catalog 的 resolved 房间面积，走 shared/paint-scope.ts 的同一套拆洞算法，
 * 与 3D「涂漆区」检视态、/api/paint/comparison、paintBudgetPreview 完全同源。
 * 无声明的房间不进表（= 不算量），不给默认值、不猜面积；算不出就抛错，
 * 由调用方降级——绝不退化成一个拍系数公式。
 */
/**
 * DEC-2026-10-09-P16：非房间地面的算量入口（几何驱动，取代 DEC-2026-10-09-P12 的 `costed` opt-in）。
 *
 * floor 算量口径：
 *   Σ(applyRooms 房间 footprint)
 *   + Σ(floor_region 面积，且该 region **不整块落在任何 applyRooms 房间内**)
 *   − Σ(显式 excluded 的 region 面积)
 * 默认该算就算；只有例外才标 `excluded: true` 并带 reason。
 *
 * 为什么废掉 `costed`：那个手工布尔量**重复了几何已知的信息**（这块地是不是已经被某个
 * applyRooms 房间算过）。同一个事实存两处，改一处忘另一处就是双计/漏计，而且从任何单处
 * 都看不出来——业主 2026-10-09 判「太反直觉」。现在「落在已计费房间内」由几何判定，
 * 双计路径从根上消失；`excluded` 只留给几何说不清的例外（开发商已铺、业主裁定不铺）。
 */
export interface FloorRegionTakeoff {
  /** 不在任何已计费房间内、也未声明 excluded 的 floor_region 面积合计——要加进 floor 算量。 */
  extraArea: number;
  /** 显式 `excluded: true` 的面积合计（留档：这部分是有意不算的，不是漏算）。 */
  excludedArea: number;
  /** 整块落在某个已计费房间内而被跳过的面积合计（留档：已被房间 footprint 算过，再算即双计）。 */
  skippedInsideRoomArea: number;
}

/** 几何容差：声明坐标只到 0.01m，边界贴合判定用 1e-6 足够，又不至于把隔壁区域吞进来。 */
const GEO_EPS = 1e-6;

/**
 * 带圆角的多边形面积（㎡）。
 *
 * 圆角**不能**按外接矩形算：`north_platform_floor` 的 NW 角 r=1.0，直角外接算出 1.60㎡，
 * 真实 1.3854㎡（1.60 − [0.5 − π/4]）。做法与 shared/render 的圆角同一套几何——圆心 + 半径
 * 在两条邻边上定切点、锐角面积减圆弓面积；这里取闭式解（不采样折线），所以不存在
 * 「渲染端折线段数不同导致面积对不上」的第二套口径。切点落在邻边线段之外、圆心与半径
 * 不自洽、扫角退化时直接抛错（fail-closed）：一条坏弧声明应该让预算算不出来，
 * 而不是悄悄少算 0.21㎡。
 */
function roundedPolygonArea(points: CurtainPoint[]): number {
  const signed = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.z - q.x * p.z;
  }, 0) / 2;
  const orient = Math.sign(signed) || 1;
  let area = signed;
  for (let i = 0; i < points.length; i++) {
    const corner = points[i];
    if (corner.radius === undefined) continue;
    if (!(corner.radius > 0)) {
      throw new Error(`floor_region 圆角半径必须为正（第 ${i} 点 radius=${corner.radius}）`);
    }
    if (corner.cx === undefined || corner.cz === undefined) {
      throw new Error(`floor_region 圆角点缺 cx/cz（第 ${i} 点），弧心不可定位`);
    }
    const center = { x: corner.cx, z: corner.cz };
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const t1 = tangentPointOnEdge(corner, prev, center, corner.radius);
    const t2 = tangentPointOnEdge(corner, next, center, corner.radius);
    // 被圆角替掉的锐角三角形面积
    const cornerArea = Math.abs(
      (t1.x - corner.x) * (t2.z - corner.z) - (t2.x - corner.x) * (t1.z - corner.z)
    ) / 2;
    const a = { x: t1.x - center.x, z: t1.z - center.z };
    const b = { x: t2.x - center.x, z: t2.z - center.z };
    const theta = Math.atan2(Math.abs(a.x * b.z - a.z * b.x), a.x * b.x + a.z * b.z);
    if (theta <= GEO_EPS || Math.PI - theta <= GEO_EPS) {
      throw new Error(`floor_region 圆角扫角退化（${theta.toFixed(6)} rad），弧声明与邻边不匹配`);
    }
    // 弦与弧之间的圆弓面积（凸角时被磨掉、凹角时被补回的那一块）
    const segment = corner.radius * corner.radius * (theta - Math.sin(theta)) / 2;
    const cut = cornerArea - segment;
    const turn = (corner.x - prev.x) * (next.z - corner.z) - (corner.z - prev.z) * (next.x - corner.x);
    area += orient * turn > 0 ? -cut : cut;
  }
  return Math.abs(area);
}

/** 圆心在「角点 → 邻点」这条边上的垂足（即圆角切点）；不在边线段内或半径不自洽即抛错。 */
function tangentPointOnEdge(
  corner: CurtainPoint,
  along: CurtainPoint,
  center: { x: number; z: number },
  radius: number
): { x: number; z: number } {
  const dx = along.x - corner.x;
  const dz = along.z - corner.z;
  const len = Math.hypot(dx, dz);
  if (len <= GEO_EPS) throw new Error('floor_region 圆角点的邻边长度为 0');
  const ux = dx / len;
  const uz = dz / len;
  const t = (center.x - corner.x) * ux + (center.z - corner.z) * uz;
  if (t < -GEO_EPS || t > len + GEO_EPS) {
    throw new Error(`floor_region 圆角切点落在邻边线段之外（t=${t.toFixed(4)}，边长=${len.toFixed(4)}）`);
  }
  const point = { x: corner.x + ux * t, z: corner.z + uz * t };
  if (Math.abs(Math.hypot(point.x - center.x, point.z - center.z) - radius) > 1e-3) {
    throw new Error('floor_region 圆角半径与弧心不自洽（切点到弧心距离 ≠ radius）');
  }
  return point;
}

/** 点是否在多边形内或边上。边界算「内」：`corridor_floor` 的四角正压在 study 的南/东/西边上。 */
function pointInPolygonOrOnEdge(point: { x: number; z: number }, polygon: Array<{ x: number; z: number }>): boolean {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len <= GEO_EPS) continue;
    const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
    if (Math.abs(cross) / len > GEO_EPS) continue;
    const dot = (point.x - a.x) * (b.x - a.x) + (point.z - a.z) * (b.z - a.z);
    if (dot >= -GEO_EPS && dot <= len * len + GEO_EPS) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    if ((a.z > point.z) !== (b.z > point.z)) {
      const x = a.x + ((point.z - a.z) / (b.z - a.z)) * (b.x - a.x);
      if (x > point.x) inside = !inside;
    }
  }
  return inside;
}

/**
 * 轴对齐包围盒是否整块落在某个房间内。
 *
 * 房间有 `points`（非矩形/带圆角的异形房）走**多边形包含**——四角全在多边形内或边上才算；
 * 否则回落到 `x/z/width/depth` 包围盒（`resolveRoom` 的 x/z 是 bbox 中心，见
 * server/layout-resolver.ts）。注意回落分支只对轴对齐矩形是精确的：当前 11 间房里
 * 6 间带 points（master_bedroom/living_dining/master_bath/guest_bath/kitchen/balcony），
 * 剩下 5 间都是轴对齐矩形，所以两条分支在现行数据上都精确。
 */
function boxInsideRoom(
  box: { minX: number; maxX: number; minZ: number; maxZ: number },
  room: RoomLayout
): boolean {
  const polygon = room.points;
  if (polygon && polygon.length >= 3) {
    const outline = polygon.map((p) => ({ x: p.x, z: p.z }));
    return (
      pointInPolygonOrOnEdge({ x: box.minX, z: box.minZ }, outline)
      && pointInPolygonOrOnEdge({ x: box.maxX, z: box.minZ }, outline)
      && pointInPolygonOrOnEdge({ x: box.minX, z: box.maxZ }, outline)
      && pointInPolygonOrOnEdge({ x: box.maxX, z: box.maxZ }, outline)
    );
  }
  const minX = room.x - room.width / 2;
  const maxX = room.x + room.width / 2;
  const minZ = room.z - room.depth / 2;
  const maxZ = room.z + room.depth / 2;
  return box.minX >= minX - GEO_EPS && box.maxX <= maxX + GEO_EPS
    && box.minZ >= minZ - GEO_EPS && box.maxZ <= maxZ + GEO_EPS;
}

/**
 * 非房间地面算量：overlay 的 floor_region 逐条按几何分派（默认计入，例外才排除）。
 * `rooms` 是 catalog 全量房间，`applyRoomIds` 是 floor lineItem 的 applyRooms——
 * 只有后者的 footprint 已经进了 `roomArea`，所以「整块落在其内」才等于双计。
 *
 * `elements` 是测试缝：缺省读 `config/layout/overlay.yaml`（生产唯一入口），
 * 显式传入则可对同一套分派规则做合成复算（改标志/加区域），避免为跑负例去改配置文件。
 */
export function loadExtraFloorRegionArea(
  rooms: RoomLayout[],
  applyRoomIds: Iterable<string>,
  elements?: unknown[]
): FloorRegionTakeoff {
  const overlay = elements ?? parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')).elements ?? [];
  const countedRoomIds = new Set(applyRoomIds);
  const countedRooms = rooms.filter((room) => countedRoomIds.has(room.id));
  let extraArea = 0;
  let excludedArea = 0;
  let skippedInsideRoomArea = 0;
  for (const element of overlay as Array<Record<string, any>>) {
    if (element?.type !== 'floor_region') continue;
    const points = (element.points ?? []) as CurtainPoint[];
    // schema 已挡（points min(3)），这里双保险：少于 3 点算不出面积，不当 0 混进去
    if (points.length < 3) continue;
    const area = roundedPolygonArea(points);
    if (element.excluded === true) {
      // 显式排除：只留给几何说不清的例外（开发商已铺 / 业主裁定不铺），reason 必须写为什么
      excludedArea += area;
      continue;
    }
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const box = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
    if (countedRooms.some((room) => boxInsideRoom(box, room))) {
      // 整块落在某个已计费房间内 → 这块地已经由房间 footprint 算过，再算就是双计
      skippedInsideRoomArea += area;
      continue;
    }
    extraArea += area;
  }
  return { extraArea, excludedArea, skippedInsideRoomArea };
}

function loadPaintScopeAreaByRoom(catalog: ProjectCatalog): Map<string, number> {
  const areaByRoom = new Map<string, number>();
  const inputs = loadPaintScopeInputs();
  if (!inputs.regions.length) return areaByRoom;
  const rooms = catalog.getRooms();
  // 墙几何（x/z/segments/openings）+ 房间 footprint 都取 catalog，与 /api/paint/comparison 的
  // resolved layout 版本是同一批数据的两个入口；算不出直接抛，由调用方处理。
  const scope = computePaintScopeForLayout(
    { rooms, walls: catalog.getWalls() } as unknown as ResolvedLayout,
    catalog,
    inputs,
  );
  // 普通漆计价面积 = 净墙 + 顶面 + **普通漆窗台**（主卫上飘窗走防霉漆、单独计价，不进本行）。
  // 2026-10-09 补：此前只加墙+顶，8 处新声明的上飘窗普通漆面积（43.097㎡）没进预算，
  // 与 /api/paint/comparison 的 ordinaryAreaSqm 对不上——预算侧少算即说谎。
  const roomIds = new Set([...Object.keys(scope.wallAreaByRoom), ...Object.keys(scope.ordinarySillAreaByRoom)]);
  for (const roomId of roomIds) {
    const wallArea = scope.wallAreaByRoom[roomId] ?? 0;
    areaByRoom.set(roomId, wallArea + (scope.ceilingAreaByRoom[roomId] ?? 0) + (scope.ordinarySillAreaByRoom[roomId] ?? 0));
  }
  return areaByRoom;
}

/**
 * 吊顶工程量：按 `config/ceiling.yaml` 的逐分区声明实算，不再按房间面积近似。
 * 工艺/计价类别（trade）拆分见 shared/ceiling-takeoff.ts；返回值为原始浮点，不取整。
 */
function ceilingTakeoff(catalog: ProjectCatalog): CeilingTakeoff {
  return computeCeilingTakeoff(loadCeilingConfig(), catalog.getRooms().map((room) => ({ id: room.id, height: room.height })));
}

/** base.json 的兜底费率：生效报价没声明的计价行回落到它（回落必须看得见）。 */
/**
 * base.json 的兜底吊顶费率。C12 新增的两行（边吊按米 / 满吊平顶按㎡）base.json 没有对应
 * labor 行 → 回落 null（待报价）：不进预算 actual，只在报价面板显形。
 */
function fallbackCeilingRates(baseRaw: Record<string, BudgetCategoryRaw>): Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }> {
  const carpentry = baseRaw.carpentry;
  const entries = carpentry?.labor ? (Array.isArray(carpentry.labor) ? carpentry.labor : [carpentry.labor]) : [];
  const byArea = new Map(entries.map((entry) => [entry.area, entry]));
  return {
    ceiling_zones: { per_unit: byArea.get('ceiling_zones')?.rate ?? null, unit: byArea.get('ceiling_zones')?.unit ?? '元/㎡' },
    curtain_box_linear: { per_unit: byArea.get('curtain_box_linear')?.rate ?? null, unit: byArea.get('curtain_box_linear')?.unit ?? '元/m' },
    gypsum_edge_drop_linear: { per_unit: null, unit: '元/m' },
    gypsum_flat_sqm: { per_unit: null, unit: '元/㎡' },
    // C13：厨卫铝扣板（归 QR-2026-10-03-08，不在木工 labor 行里）
    aluminum_buckle_sqm: { per_unit: null, unit: '元/㎡' },
  };
}

const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  floorArea: (room) => room.area ?? room.width * room.depth,
  wetWallArea: (room) => (room.width + room.depth) * 2 * room.height * 0.7,
  // 已废弃：吊顶算量请用 shared/ceiling-takeoff.ts 的逐分区实算（见 computeLabor 的 ceiling_zones）。
  // 这个房间面积别名会把没有吊顶的平顶也计费，仅为兼容旧 lineItem 声明而保留。
  ceilingArea: (room) => room.area ?? room.width * room.depth,
  linearKitchen: (room) => room.depth * 0.8,
  doorCount: () => 1,
  fixtureCount: () => 1,
};

/**
 * 候选价门控（2026-10-13 阶段 1：**纯加法，零行为变化**）。
 *
 * 背景：data/current-scheme.json 当前选中的 41 条材料里 39 条是 `candidate` /
 * `pending_verification`（到店未确认），它们全额进 `totalActual`，而快照里没有任何字段
 * 能让消费者看出这件事——`server/project-catalog.ts` 的 `getDataPrecision()` 早就统计
 * 得出这个数并经 MCP `get_data_confidence` 暴露，`/api/budget` 却按全款计。
 *
 * 做法：把 `categoryAutoActual`（材料侧金额）按**材料 status** 拆成两份挂在
 * `BudgetCategory.verifiedActual` / `.candidateActual` 上。`actual` / `autoActual` /
 * `totalActual` 的口径本阶段一律不动；口径变更（candidate 出 actual）是独立的阶段 5，
 * 须配 baseline 前后对照，否则 budget-calculator / budget-api / paint-comparison-api
 * 的 20+ 处金额锚点会同时红、且没人说得清是哪一条该动。
 *
 * 判据只取 `option.data.status`：`materialToOption()` 已把整条 MaterialItem 摊进 `data`
 * （server/project-catalog.ts:51-59），所以**不新增 `DesignOption.status` 顶层字段**——
 * 同一事实存两处必然漂移，违反项目铁律。
 */
const VERIFIED_MATERIAL_STATUSES: ReadonlySet<string> = new Set([
  'measured',
  'confirmed',
  'quoted_sheet',
  'contracted',
  'provided_by_developer',
  'user_budget_confirmed',
]);

/**
 * 合成选项白名单：这些 topic 的 option 不是 materials.yaml 条目，`data` 里**没有** status。
 * 当前只有 `hvac`——price 来自 project-catalog.ts 的硬编码构造 +
 * shared/houseData.ts 的七套 invented 报价表（阶段 2/3 换成 config/hvac.yaml）。
 *
 * 没有取证态字段 = 价格未取证 → 一律归「候选」。这里必须**显式留名**：新增合成选项得
 * 先在这里表态，否则 `autoActualBucket()` 抛错——绝不静默掉进默认档，那会让「已取证」
 * 的口径被悄悄注水。
 */
const SYNTHETIC_UNVERIFIED_TOPICS: ReadonlySet<string> = new Set(['hvac']);

/** 一条材料金额的门控归属：verified（已取证）/ candidate（候选、待核验或无 status）。 */
export function autoActualBucket(option: DesignOption | undefined, topicId: string): 'verified' | 'candidate' {
  const status = (option?.data as { status?: unknown } | undefined)?.status;
  if (typeof status === 'string') {
    return VERIFIED_MATERIAL_STATUSES.has(status) ? 'verified' : 'candidate';
  }
  if (SYNTHETIC_UNVERIFIED_TOPICS.has(topicId)) return 'candidate';
  throw new Error(
    `[budget-calculator] topic "${topicId}" 的选项 ${option?.id ?? '(缺失)'} 没有 data.status，无法判定候选价门控归属；合成选项须显式登记到 SYNTHETIC_UNVERIFIED_TOPICS`,
  );
}

export class BudgetCalculator {
  private paintScopeCache: Map<string, number> | null = null;

  constructor(
    private catalog: ProjectCatalog,
    private rulesConfig: DesignRulesConfig
  ) {}

  /** 涂装面积（墙+顶）逐房间表，进程内缓存：一次请求里材料与人工必须读到同一份口径。 */
  private paintScopeAreaByRoom(): Map<string, number> {
    if (!this.paintScopeCache) {
      this.paintScopeCache = loadPaintScopeAreaByRoom(this.catalog);
    }
    return this.paintScopeCache;
  }

  /**
   * 一个人工费分类可以有多条计价行（DEC-2026-10-08-C02：窗帘盒从吊顶 40 元/㎡ 里拆出来，
   * 改按延长米单列——README「没有合并项报价」）。`raw.labor` 兼容两种写法：
   * 单对象（既有各分类）或数组（carpentry）。
   * rate 为 null = 待报价：**不计入 actual，但数量必须显形**（cat.pendingLabor），
   * 否则「拆分」会变成「悄悄少算一笔钱」。
   */
  private computeLabor(
    categories: BudgetCategory[],
    baseRaw: Record<string, BudgetCategoryRaw>,
    rooms: RoomLayout[],
    phase: PhaseId,
    takeoff: CeilingTakeoff,
    quoteRates: ResolvedCeilingRates
  ): void {
    for (const cat of categories) {
      const raw = baseRaw[cat.key];
      if (!raw?.labor) continue;
      const laborEntries = Array.isArray(raw.labor) ? raw.labor : [raw.labor];

      for (const labor of laborEntries) {
      const { area } = labor;
      // 吊顶两条计价行的单价以生效报价为准（DEC-2026-10-08-C03）；未声明则回落 base.json。
      const quoted = area === 'ceiling_zones' || area === 'curtain_box_linear' ? quoteRates[area] : undefined;
      const rate = quoted ? quoted.per_unit : labor.rate;
      const unit = quoted ? quoted.unit : labor.unit;
      let quantity = 0;

      switch (area) {
        case 'floor':
          {
            const floorApplyRooms = this.rulesConfig.budget?.lineItems
              ?.find((item) => item.topic === 'floor' && item.quantityField === 'floorArea')
              ?.applyRooms ?? [];
            const allowedRoomIds = new Set(floorApplyRooms);
            const roomArea = rooms
              .filter((room) => allowedRoomIds.has(room.id))
              .reduce((sum, room) => sum + (room.area ?? room.width * room.depth), 0);
            // DEC-2026-10-09-P16：非房间地面**默认**进算量。只有两种例外退出——
            // ① 整块落在某个已计费房间内（几何判定，双计路径从根上消失）；
            // ② 显式 `excluded: true` 且带 reason（开发商已铺 / 业主裁定不铺）。
            // 取代 P12 的 `costed: true` opt-in：那个手工布尔量重复了几何已知的信息。
            const { extraArea } = loadExtraFloorRegionArea(rooms, allowedRoomIds);
            quantity = roomArea + extraArea;
          }
          break;
        // 已废弃：按房间面积近似吊顶人工量（把无吊顶平顶/电梯井/入户花园都计了费）。
        // 保留分支只为兜底，新口径一律用 ceiling_zones；删除前须确认没有分类再引用它。
        case 'ceiling':
          quantity = rooms.reduce((sum, r) => sum + r.width * r.depth, 0);
          break;
        // 吊顶板面人工（石膏板 + 铝扣板 + 隐藏晾衣架吊顶）按实算净面积计价；
        // 窗帘盒已按 DEC-2026-10-08-C02 拆到 curtain_box_linear，不重复计。
        // 分类小计/延长米/板块数见 takeoff.byClass，由 GET /api/ceiling/takeoff 与
        // MCP get_ceiling_takeoff 输出，报价时按 README「没有合并项报价」逐项列。
        case 'ceiling_zones':
          quantity = takeoff.totalNetAreaM2 - takeoff.curtainBoxM2;
          break;
        // 窗帘盒人工：按延长米（行业主口径，与算量子系统的 byClass.curtain_box.linearM 同源）。
        // rate 待报价时数量照样显形（见函数末尾 pendingLabor）。
        case 'curtain_box_linear':
          quantity = takeoff.curtainBoxLinearM;
          break;
        case 'paint_wall':
          // 与材料侧同源：overlay.yaml 的 paint_region 声明 + resolved 房间面积（墙+顶）。
          quantity = rooms.reduce((sum, r) => sum + (this.paintScopeAreaByRoom().get(r.id) ?? 0), 0);
          break;
        case 'wet_floor': {
          const wetRooms = rooms.filter((r) => r.needs_waterproof === true);
          quantity = wetRooms.reduce((sum, r) => sum + r.width * r.depth, 0);
          break;
        }
        case 'door_count': {
          let count = 0;
          for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
            const counts = this.catalog.getFurnishingCounts(roomId, phase);
            count += counts['interior_door'] ?? 0;
            count += counts['bathroom_door'] ?? 0;
            count += counts['entry_door'] ?? 0;
            count += counts['door'] ?? 0;
          }
          quantity = count;
          break;
        }
        case 'fixture_count': {
          let count = 0;
          for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
            const counts = this.catalog.getFurnishingCounts(roomId, phase);
            count += counts['toilet'] ?? 0;
            count += counts['shower_set'] ?? 0;
            count += counts['vanity'] ?? 0;
            count += counts['mb_washbasin_cabinet'] ?? 0;
            count += counts['faucet'] ?? 0;
          }
          quantity = count;
          break;
        }
        case 'fixed':
          if (rate === null || rate === undefined) break;
          cat.actual += rate;
          continue;
        default:
          continue;
      }
      if (rate === null || rate === undefined) {
        // 待报价：数量入 pendingLabor 显形，金额不编（README：没有无依据决策）
        cat.pendingLabor = [...(cat.pendingLabor ?? []), { area, quantity, unit, reason: 'rate 待报价' }];
        continue;
      }
      cat.actual += Math.round(rate * quantity);
      }
    }
  }

  calculate(scheme: CurrentScheme, phase: PhaseId = 'full'): BudgetSnapshot {
    const topicCategories = this.rulesConfig.budget?.topicCategories ?? {};
    const lineItems = this.rulesConfig.budget?.lineItems ?? [];
    const baseCategories = this.catalog.getBudgetCategories();

    const allLineItems: BudgetLineItem[] = [];
    /**
     * 材料侧金额的候选价门控累加器：两份之和恒等于原先那个单一 number 的值（见文件头部
     * VERIFIED_MATERIAL_STATUSES 的说明）。只拆材料、不碰人工——`computeLabor` 与
     * `manualActual` 都没有 status 可判，继续只进 `actual`。
     */
    const categoryAutoActual = new Map<string, { verified: number; candidate: number }>();

    /** 累加一条材料金额：同一笔 cost 按 status 分流，`autoActual` 由两份相加得出。 */
    const addAutoActual = (
      categoryKey: string,
      topicId: string,
      cost: number,
      option: DesignOption | undefined
    ): void => {
      const entry = categoryAutoActual.get(categoryKey) ?? { verified: 0, candidate: 0 };
      if (autoActualBucket(option, topicId) === 'verified') {
        entry.verified += cost;
      } else {
        entry.candidate += cost;
      }
      categoryAutoActual.set(categoryKey, entry);
    };

    for (const li of lineItems) {
      if (!isBudgetTopicIncluded(li.topic, phase)) continue;
      const topic = this.catalog.getTopic(li.topic);
      if (!topic) continue;

      const categoryKey = topicCategories[li.topic];
      if (!categoryKey) continue;

      const calcMode = li.calcMode ?? 'area';

      if (calcMode === 'fixed') {
        const optionId = scheme.selections[li.topic]?.default;
        if (!optionId) continue;
        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        allLineItems.push({
          topic: li.topic,
          roomId: null,
          optionId,
          quantity: 1,
          unitPrice: option.price_per_unit,
          coveragePerUnit: 1,
          lossRate: 1,
          cost: option.price_per_unit,
        });
        addAutoActual(categoryKey, li.topic, option.price_per_unit, option);
        continue;
      }

      if (calcMode === 'count') {
        const typeToTopic = this.rulesConfig.budget?.furnishingTypeToTopic ?? {};
        for (const roomId of Object.keys(this.catalog.getFurnishingsForPhase(phase))) {
          const counts = this.catalog.getFurnishingCounts(roomId, phase);
          let qty = 0;
          for (const [type, count] of Object.entries(counts)) {
            const resolvedTopic = type === li.topic ? li.topic : typeToTopic[type];
            if (resolvedTopic === li.topic) qty += count;
          }
          if (qty <= 0) continue;
          const optionId = scheme.selections[li.topic]?.roomOverrides?.[roomId]
                         ?? scheme.selections[li.topic]?.default;
          if (!optionId) continue;
          const option = this.catalog.getOption(li.topic, optionId);
          if (!option) continue;

          const cost = option.price_per_unit * qty;
          allLineItems.push({
            topic: li.topic, roomId, optionId,
            quantity: qty, unitPrice: option.price_per_unit,
            coveragePerUnit: 1, lossRate: 1, cost,
          });
          // 门控必须逐房判：roomOverrides 能让同一 topic 在不同房间用不同 option
          // （如 master_bedroom 的 wardrobe_north_950_custom_01，price 0 / candidate），
          // 拿到循环外按 default 判一次就会把覆盖房的取证态判错。
          addAutoActual(categoryKey, li.topic, cost, option);
        }
        continue;
      }

      if (topic.perRoom) {
        const rooms = this.catalog.getRooms();
        // 涂装面积单独走声明表：数量来源是 overlay.yaml 的 paint_region（并与 catalog 的
        // resolved 房间面积相加得到墙+顶），不再用 QUANTITY_FORMULAS 的拍系数公式。
        const paintScope = li.quantityField === 'paintScopeArea'
          ? this.paintScopeAreaByRoom()
          : null;
        const quantityFn = li.quantityField ? QUANTITY_FORMULAS[li.quantityField] : null;
        if (!paintScope && !quantityFn) continue;

        for (const room of rooms) {
          const overrideOptionId = scheme.selections[li.topic]?.roomOverrides?.[room.id];
          // applyRooms 只限制默认满铺；显式房间覆盖（用户 deliberate 选择）始终尊重
          if (li.applyRooms && !li.applyRooms.includes(room.id) && overrideOptionId === undefined) continue;
          const defaultOptionId = scheme.selections[li.topic]?.default;
          const optionId = overrideOptionId ?? defaultOptionId;
          if (!optionId) continue;

          const option = this.catalog.getOption(li.topic, optionId);
          if (!option) continue;

          const quantity = paintScope
            ? (paintScope.get(room.id) ?? 0)
            : quantityFn!(room);
          const pricePerUnit = option.price_per_unit ?? 0;
          const coveragePerUnit = option.coverage_per_unit ?? 1;
          const lossRate = option.loss_rate ?? 1.0;
          const cost = pricePerUnit * quantity / coveragePerUnit * lossRate;

          allLineItems.push({
            topic: li.topic, roomId: room.id, optionId,
            quantity, unitPrice: pricePerUnit,
            coveragePerUnit, lossRate, cost,
          });

          addAutoActual(categoryKey, li.topic, cost, option);
        }
      } else {
        const optionId = scheme.selections[li.topic]?.default;
        if (!optionId) continue;

        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        const pricePerUnit = option.price_per_unit ?? 0;
        const cost = pricePerUnit;

        allLineItems.push({
          topic: li.topic,
          roomId: null,
          optionId,
          quantity: 1,
          unitPrice: pricePerUnit,
          coveragePerUnit: 1,
          lossRate: 1,
          cost,
        });

        addAutoActual(categoryKey, li.topic, cost, option);
      }
    }

    const budgetRaw = JSON.parse(
      readFileSync('config/budget/base.json', 'utf8')
    ) as { categories: Record<string, BudgetCategoryRaw>; project_ceiling?: number; status?: string };

    const categories: BudgetCategory[] = baseCategories.map((bc) => {
      const split = categoryAutoActual.get(bc.key);
      const verifiedActual = split?.verified ?? 0;
      const candidateActual = split?.candidate ?? 0;
      return {
        key: bc.key,
        budget: bc.budget,
        actual: bc.actual + verifiedActual + candidateActual,
        manualActual: bc.actual,
        // autoActual 由两份相加得出，使 `verifiedActual + candidateActual === autoActual`
        // 成为结构性不变量（而非恰好凑上的巧合），下游可以无条件断言它。
        autoActual: verifiedActual + candidateActual,
        verifiedActual,
        candidateActual,
        status: bc.status as BudgetCategory['status'],
        notes: bc.notes,
      };
    });

    const takeoff = ceilingTakeoff(this.catalog);
    // 生效报价（DEC-2026-10-08-C03）：报价文件缺失/非法时按「无报价」处理，
    // 回落 base.json 的 labor rate——预算不能被一个坏配置文件冻结。
    let quotes: CeilingQuotesFile | null = null;
    try {
      quotes = loadCeilingQuotes();
    } catch (err) {
      console.error('[budget-calculator] ceiling-quotes.yaml 不可用，回落 base.json 费率：', err instanceof Error ? err.message : String(err));
    }
    const quoteRates = resolveActiveCeilingRates(
      quotes ?? { version: 1, active: 'base.json', quotes: [] },
      fallbackCeilingRates(budgetRaw.categories),
    );

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), phase, takeoff, quoteRates);

    // 报价对比进快照：active 那家就是 actual 的来源，其余候选只并排展示、不动金额。
    const ceilingQuotes = quotes
      ? {
          activeId: quotes.active,
          source: quoteRates.ceiling_zones.source === 'quote' ? 'quote' as const : 'base.json' as const,
          comparison: compareCeilingQuotes(quotes, takeoff, fallbackCeilingRates(budgetRaw.categories)),
        }
      : undefined;

    // Status computed AFTER computeLabor: labor can push a category over budget.
    for (const cat of categories) {
      if (cat.status === 'reserved') continue;
      const ratio = cat.budget > 0 ? cat.actual / cat.budget : 0;
      cat.status = ratio > 1.0 ? 'over' : ratio > 0.9 ? 'near' : 'ok';
    }

    const topicCategoriesMap = this.rulesConfig.budget?.topicCategories ?? {};
    const attribution: Record<string, BudgetAttribution> = {};
    for (const cat of categories) {
      if (cat.status === 'over' || cat.status === 'near') {
        const catLineItems = allLineItems
          .filter((li) => topicCategoriesMap[li.topic] === cat.key)
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 3);
        attribution[cat.key] = {
          topItems: catLineItems,
          overBy: cat.actual - cat.budget,
          ratio: cat.budget > 0 ? cat.actual / cat.budget : 0,
        };
      }
    }

    const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);
    const totalActual = categories.reduce((sum, c) => sum + c.actual, 0);
    // 现行执行上限取自 schedule/phase-1/control.yaml `control.phase_ceiling_cny`。
    // 2026-10-04 之前这里读的是 config/budget/base.json 的 `project_ceiling`（190,000），
    // 而该字段已被 control.yaml `budget_reconciliation.historical_baseline` 标为
    // `historical_reference_only` —— 业主通过 budget API / MCP 看到的一期上限长期是作废值。
    // base.json 只保留分科目明细与作废口径留档，不再作为任何计算与接口的输入源。
    const authority = loadPhaseControlAuthority(controlPathForPhase(loadPhaseScopes()[phase]));
    const projectCeiling = authority.ceilingCny;
    const overCeilingBy = totalActual - projectCeiling;

    return {
      totalBudget: authority.ceilingCny,
      totalActual,
      projectCeiling,
      overCeilingBy,
      historicalBaseline: authority.historicalBaseline,
      categories,
      lineItems: allLineItems,
      attribution,
      ...(ceilingQuotes ? { ceilingQuotes } : {}),
    };
  }
}
