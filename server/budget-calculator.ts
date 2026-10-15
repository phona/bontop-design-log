import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
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
import {
  computeMasonryTakeoff,
  type MasonryFloorRegionInput,
  type MasonryTakeoffInput,
  type MasonryTakeoffResult,
} from '../shared/masonry-takeoff.js';
import { loadCeilingConfig } from './config-loader.js';
import { parseOverlay } from './overlay-merge.js';
import { loadCeilingQuotes, baseJsonCeilingRatesFromBase, type CeilingQuotesFile } from './ceiling-quotes.js';
import { resolveActiveCeilingRates, compareCeilingQuotes, type CeilingQuoteRateKey } from './ceiling-quotes.js';
import {
  loadMasonryQuotes,
  masonryQuoteFallback,
  masonrySpecSelection,
  resolveActiveMasonryRates,
  MASONRY_LABOR_AREAS,
  type MasonryQuoteRateKey,
  type MasonryQuotesFile,
} from './masonry-quotes.js';
import type { ProjectCatalog } from './project-catalog.js';
import type { ResolvedLayout } from '../shared/types.js';
import type { ResolvedQuoteRate } from '../shared/quote-cards.js';
import { isBudgetTopicIncluded, loadPhaseScopes } from './phase-scope.js';
import { controlPathForPhase, loadPhaseControlAuthority } from './phase-control.js';
import { computePaintScopeForLayout, loadPaintScopeInputs } from './paint-cost-comparison.js';

/**
 * 计价字段取值：**缺失即抛错**（2026-10-14 阶段 4：清除会算错钱的静默兜底）。
 *
 * 三个字段过去全写成 `option.X ?? <兜底>`：
 *   - `price_per_unit ?? 0`     → 金额静默归零（已实际发生 2 次：entry_door_01 开发商已装、
 *                                 wardrobe_north_950_custom_01 定制衣柜——两者在 materials.yaml
 *                                 里显式写了 0，所以兜底没触发，但"缺字段"与"声明为 0"曾被混为一谈）
 *   - `coverage_per_unit ?? 1`  → 面积型材料按"片数×单价"计价，量级错 100 倍
 *   - `loss_rate ?? 1.0`        → 主公式损耗变 1.0，少算 8~15%
 * 注意 0 是**合法声明值**（开发商已装 / pending 未定价），所以价格只要求"是有限数"，
 * 不要求为正；覆盖率与损耗则必须为正（0 覆盖率会除零，0 损耗等于"施工不用余料"）。
 *
 * 与 server/tile-cost-comparison.ts / server/paint-cost-comparison.ts 的
 * `requiredPositiveNumber` 同一风格：fail-closed，错误信息指去哪补。
 */
function requiredPrice(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `${label} 缺 price_per_unit（或不是有限数）：不计 0 元——「没写价格」与「声明为 0」是两件事，前者是配置漏洞。请到 config/materials.yaml 补 price_per_unit（开发商已装 / 待核价可显式写 0）`,
    );
  }
  return value;
}

function requiredPositiveOption(value: unknown, label: string, field: 'coverage_per_unit' | 'loss_rate'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${label} 缺 ${field}（或不是正数）：不按 1 兜底——那会让面积型材料按"片数×单价"计价、或让损耗凭空消失。请到 config/materials.yaml 补 ${field}`,
    );
  }
  return value;
}

/** 一条计价行的三个字段一次取齐（缺任何一个都抛错，不会半套兜底半套真值）。 */
export function pricingOf(option: DesignOption, label: string): { pricePerUnit: number; coveragePerUnit: number; lossRate: number } {
  return {
    pricePerUnit: requiredPrice(option.price_per_unit, label),
    coveragePerUnit: requiredPositiveOption(option.coverage_per_unit, label, 'coverage_per_unit'),
    lossRate: requiredPositiveOption(option.loss_rate, label, 'loss_rate'),
  };
}

/**
 * 涂装**净**面积（净墙 + 顶 + 普通漆窗台）逐房间表：唯一来源是 overlay.yaml 的 paint_region 声明 +
 * catalog 的 resolved 房间面积，走 shared/paint-scope.ts 的同一套拆洞算法，
 * 与 3D「涂漆区」检视态、/api/paint/comparison、paintBudgetPreview 完全同源。
 * 无声明的房间不进表（= 不算量），不给默认值、不猜面积；算不出就抛错，
 * 由调用方降级——绝不退化成一个拍系数公式。
 */
/**
 * 干区 / 湿区**地面**房划分：瓦工算量把地面拆成「干区主地面」与「湿区主地面」两档计价
 * （费率不同：木纹砖 75 元/㎡ vs 600×600 卫生间砖 45 元/㎡，见 config/masonry-labor.yaml），
 * 所以这个划分是算量输入而不是展示信息。
 *
 * 唯一来源是 `config/tile-comparison.yaml` 的 `dry_room_ids` + `wet_room_ids`——
 * `dry_room_ids` 早已在该文件里声明（干区净铺面积 111.864㎡ 的权威源），湿区 counterpart
 * 放在同一处，避免「同一事实存两处」。两表必须非空且不交叠（模块自身也会复核交叠）。
 */
function loadFloorRoomSplit(): { dryRoomIds: string[]; wetRoomIds: string[] } {
  const config = load(readFileSync('config/tile-comparison.yaml', 'utf8')) as {
    dry_room_ids?: unknown;
    wet_room_ids?: unknown;
  };
  const asIdList = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== 'string')) {
      throw new Error(`config/tile-comparison.yaml 的 ${field} 必须是非空字符串数组（干/湿区地面房划分是算量输入，不猜）`);
    }
    return value as string[];
  };
  const dryRoomIds = asIdList(config.dry_room_ids, 'dry_room_ids');
  const wetRoomIds = asIdList(config.wet_room_ids, 'wet_room_ids');
  return { dryRoomIds, wetRoomIds };
}

/**
 * DEC-2026-10-13「预算计算架构根治」阶段 2 第二半：**瓦工算量（量层）唯一入口**。
 *
 * 为什么不再有 `loadExtraFloorRegionArea` / `wetWallArea` / `linearKitchen`：
 * 同一个量在仓区里有多套算法、互不对账，是 2026-10-13 扫描出的 55+ 项拍脑袋数据的共同根因。
 * 现在墙砖、防水台贴砖、地面（干/湿区 + 非房间 floor_region extra）全部由
 * `shared/masonry-takeoff.ts` 一个函数从 overlay.yaml 声明实算，server / scripts / tests 共用；
 * 本函数只负责「config → 模块输入」的装载，不写任何算法。
 *
 * 地面口径（DEC-2026-10-09-P16，模块内同款实现）：
 *   Σ(dryRoomIds ∪ wetRoomIds 房间 footprint)
 *   + Σ(floor_region 面积，且该 region **不整块落在任何已计费房间内**)
 *   − Σ(显式 excluded 的 region 面积)
 * 默认该算就算；只有例外才标 `excluded: true` 并带 reason。废掉 `costed` opt-in 的理由见
 * shared/types.ts 的 floor_region 注释：那个手工布尔量重复了几何已知的信息，改一处忘另一处
 * 就是双计/漏计，且从任何单处都看不出来。
 *
 * `elements` 是测试缝：缺省读 `config/layout/overlay.yaml`（生产唯一入口），
 * 显式传入则可对同一套分派规则做合成复算（改标志/加区域），避免为跑负例去改配置文件。
 */
export function loadMasonryTakeoff(
  catalog: ProjectCatalog,
  elements?: unknown[]
): MasonryTakeoffResult {
  const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  const overlayElements = (elements ?? overlay.elements ?? []) as Array<Record<string, any>>;

  // overlay.suppress 压制的墙（玻璃幕墙 / 实体已删除）：wall_region 引用即抛错，
  // sill_region 允许（防水台本就落在幕墙根）但要留名。
  // 三种声明形式都要认（与 server/overlay-merge.ts 的 mergeSceneElements 同口径）：
  // `wall` 单墙 / `walls` 多墙 / `region` 按墙段中心点的包围盒。漏认任何一种，
  // 被压制墙上的贴砖声明就不会被拦住。
  const suppressedWallIds = new Set<string>();
  for (const entry of overlay.suppress ?? []) {
    if (entry.wall) suppressedWallIds.add(String(entry.wall));
    for (const wallId of entry.walls ?? []) suppressedWallIds.add(String(wallId));
    if (entry.region) {
      const minX = Math.min(entry.region.x1, entry.region.x2);
      const maxX = Math.max(entry.region.x1, entry.region.x2);
      const minZ = Math.min(entry.region.z1, entry.region.z2);
      const maxZ = Math.max(entry.region.z1, entry.region.z2);
      for (const wall of catalog.getWalls()) {
        const mx = (wall.x1 + wall.x2) / 2;
        const mz = (wall.z1 + wall.z2) / 2;
        if (mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ && wall.id) {
          suppressedWallIds.add(wall.id);
        }
      }
    }
  }

  const walls: MasonryTakeoffInput['walls'] = catalog.getWalls().map((wall) => ({
    id: wall.id ?? '',
    x1: wall.x1,
    z1: wall.z1,
    x2: wall.x2,
    z2: wall.z2,
    ...(wall.segments?.length ? { segments: wall.segments } : {}),
    ...(wall.openings?.length ? { openings: wall.openings } : {}),
    suppressed: suppressedWallIds.has(wall.id ?? ''),
  }));
  const wallById = new Map(walls.map((wall) => [wall.id, wall]));

  const sillRegions = overlayElements
    .filter((element) => element.type === 'sill_region')
    .map((element) => ({
      id: String(element.id),
      element: String(element.element),
      room: String(element.room),
      face: element.face as MasonryTakeoffInput['sillRegions'][number]['face'],
      along: element.along as [number, number] | undefined,
      zone: element.zone as string | undefined,
    }));

  const baySills = overlayElements
    .filter((element) => element.type === 'bay_sill')
    .map((element) => {
      const wallIds: string[] = element.walls ?? (element.wall ? [element.wall] : []);
      if (wallIds.length === 0) {
        throw new Error(`bay_sill ${element.id} 既没有 wall 也没有 walls，构件无法定位到墙`);
      }
      const referencedBySill = sillRegions.some((region) => region.element === String(element.id));
      if (wallIds.length > 1 && referencedBySill) {
        // 模块契约是「一个构件一条 run」。跨墙构件若被 sill_region 引用，只取第一条墙会
        // 静默漏算其余墙上的贴砖面——fail-closed，逼着把声明拆成逐墙构件。
        throw new Error(
          `bay_sill ${element.id} 横跨 ${wallIds.length} 面墙（${wallIds.join(', ')}），却被 sill_region 引用；`
          + 'shared/masonry-takeoff.ts 只接受单墙构件，请把该构件拆成逐墙声明',
        );
      }
      const wall = wallById.get(wallIds[0]);
      return {
        id: String(element.id),
        wall: wallIds[0],
        height: Number(element.height),
        depth: Number(element.depth),
        sill: Number(element.sill ?? 0),
        ...(wall?.segments ? { segments: wall.segments } : {}),
      };
    });

  const rooms: MasonryTakeoffInput['rooms'] = catalog.getRooms().filter((room) => !room.semantic_only).map((room) => ({
    id: room.id,
    // 只认 resolved 多边形面积（2026-10-14 阶段 4）：异形房退回 bbox 会让墙砖/地面
    // 每间多算最多 0.6㎡，而这条路直接进 masonry 的材料与人工两侧金额。
    areaSqm: roomArea(room),
    // 异形房给 boundary 折线；轴对齐矩形房给包围盒（resolveRoom 的 x/z/width/depth 口径）。
    ...((room.points ?? []).length
      ? { points: room.points!.map((point) => ({ x: point.x, z: point.z })) }
      : { rect: { x: room.x, z: room.z, width: room.width, depth: room.depth } }),
  }));

  const floorRegions: MasonryFloorRegionInput[] = overlayElements
    .filter((element) => element.type === 'floor_region')
    .map((element) => {
      const points = (element.points ?? []) as CurtainPoint[];
      // schema 已挡 points min(3)；这里 fail-closed 而不是当 0 混进去——一条坏轮廓声明
      // 应该让预算算不出来，而不是悄悄少算一块地。
      if (points.length < 3) {
        throw new Error(`floor_region ${element.id} 的轮廓少于 3 点，算不出面积`);
      }
      return {
        id: String(element.id),
        // 面积为调用方责任（圆角闭式解见本文件 roundedPolygonArea）——模块不读文件系统。
        areaSqm: roundedPolygonArea(points),
        points: points.map((point) => ({ x: point.x, z: point.z })),
        excluded: element.excluded === true,
        follow: element.follow as string | undefined,
      };
    });

  const floorRoomSplit = loadFloorRoomSplit();

  return computeMasonryTakeoff({
    walls,
    wallRegions: overlayElements
      .filter((element) => element.type === 'wall_region')
      .map((element) => ({
        id: String(element.id),
        wall: String(element.wall),
        room: String(element.room),
        along: element.along as [number, number],
        bottom: Number(element.bottom ?? 0),
        height: Number(element.height),
        zone: element.zone as string | undefined,
      })),
    sillRegions,
    baySills,
    rooms,
    dryRoomIds: floorRoomSplit.dryRoomIds,
    wetRoomIds: floorRoomSplit.wetRoomIds,
    floorRegions,
    // 厨卫铝扣板完成面（config/ceiling.yaml 的 ceiling_kitchen / ceiling_master_bath /
    // ceiling_guest_bath，均「完成面 2.65m」）= 贴砖带顶标高上限。必填、不设默认值。
    clearHeight: 2.65,
  });
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

export function loadPaintScopeAreaByRoom(
  catalog: ProjectCatalog,
  inputs = loadPaintScopeInputs(),
): Map<string, number> {
  const areaByRoom = new Map<string, number>();
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
  const roomIds = new Set([
    ...Object.keys(scope.wallAreaByRoom),
    ...Object.keys(scope.ceilingAreaByRoom),
    ...Object.keys(scope.ordinarySillAreaByRoom),
  ]);
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

/**
 * base.json 的兜底吊顶费率。C12 新增的两行（边吊按米 / 满吊平顶按㎡）base.json 没有对应
 * labor 行 → 回落 null（待报价）：不进预算 actual，只在报价面板显形。
 *
 * 2026-10-14「三道对账」第二道：这张表原先在这里、`server/routes.ts`、
 * `server/mcp-server.ts` 各抄一份（三份逐字相同），已合并到
 * `server/ceiling-quotes.ts` 的 `baseJsonCeilingRatesFromBase`。本函数只保留
 * 「把已解析的 baseRaw 喂进去」这个薄封装——费率本身不再有第二份实现，
 * 由 `c.ceiling_rate_fallback_single_source`（config/facts.yaml）grep 全仓盯住。
 */
function fallbackCeilingRates(baseRaw: Record<string, BudgetCategoryRaw>): Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }> {
  return baseJsonCeilingRatesFromBase(baseRaw);
}

/**
 * 房间面积：**只认 resolved 多边形面积**（2026-10-14 阶段 4）。
 *
 * 旧代码 `room.area ?? room.width * room.depth` 在异形房上退回 bbox 面积——本案 11 房里
 * 6 房带 `points`（主卧 L 形、客房南向凹口…），bbox 与多边形面积最大差 0.6㎡/间，
 * 而 `RoomLayout.area` 是 optional 所以类型系统不拦。`resolveLayout` 恒给 `area`
 * （server/layout-resolver.ts 的 polygonArea），所以生产路径不会缺；缺了就是数据漏洞，
 * 必须抛错而不是悄悄换一个更大的数——那会让"少算/多算"看不出是口径问题。
 */
function roomArea(room: RoomLayout): number {
  if (typeof room.area !== 'number' || !Number.isFinite(room.area)) {
    throw new Error(
      `房间 ${room.id} 缺 resolved area（RoomLayout.area）：异形房不能用 width×depth 的 bbox 面积代替。请检查 model-geometry.yaml 的 boundary 与 server/layout-resolver.ts 的解算结果`,
    );
  }
  return room.area;
}

/**
 * 仍按房间公式取量的 quantityField（count 制与遗留别名）。
 *
 * DEC-2026-10-13 阶段 2 第二半起，**三个拍系数已全部删除**，它们的量改由
 * `shared/masonry-takeoff.ts` 从 overlay.yaml / house.yaml 声明实算：
 *   `wetWallArea`  (宽+深)×2×高×0.7 → `masonryTileArea`（wall_region + sill_region 声明）
 *   `linearKitchen` 深×0.8          → `cabinetProjectedArea` / `countertopRunLength`（house.yaml 柜体段）
 *   `floorArea`    房间面积         → `floorArea` 走声明表（干/湿区房 + floor_region extra）
 * 0.7 与 0.8 这两个系数全库无依据：0.7 算出 65.699㎡ 而 overlay 实算 30.81㎡（按
 * wall_tile_01 的 70 元/㎡ 多算约 ¥2,442）；0.8 算出 1.92 而 house.yaml 柜体段实计 4.36m。
 * 任何新量都不许再往这里加公式——要加就先有 `shared/*_takeoff.ts` 声明源。
 */
const QUANTITY_FORMULAS: Record<string, (room: RoomLayout) => number> = {
  // 已废弃：吊顶算量请用 shared/ceiling-takeoff.ts 的逐分区实算（见 computeLabor 的 ceiling_zones）。
  // 这个房间面积别名会把没有吊顶的平顶也计费，仅为兼容旧 lineItem 声明而保留。
  // 2026-10-14 阶段 4：面积缺失即抛错（不再退回 bbox），见 roomArea。
  ceilingArea: (room) => roomArea(room),
  doorCount: () => 1,
  fixtureCount: () => 1,
};

/**
 * 由声明源（`shared/masonry-takeoff.ts` / `config/house.yaml` 柜体段）供数的 quantityField
 * → 逐房数量表 + 不属于任何房间的余量。
 *
 * 四个字段，两个声明源：
 *   `masonryTileArea`       overlay wall_region + sill_region 实算（㎡）
 *   `floorArea`             overlay/房间干湿区地面实算（㎡）
 *   `cabinetProjectedArea`  house.yaml kitchen_cabinet_run 的 长×柜高（㎡，投影面积口径）
 *   `countertopRunLength`   house.yaml kitchen_cabinet_run + kitchen_countertop_bridge 的 长（延米）
 *
 * `floorArea` 的余量（`floor_region extra`，现行只有主走廊 3.75㎡）无法归属到某个房间，
 * 因此单列一行 `roomId: null` 显式计费——摊进任一房间就是伪造归属，静默丢掉就是漏计。
 */
const DECLARED_QUANTITY_FIELDS = [
  'masonryTileArea',
  'floorArea',
  'cabinetProjectedArea',
  'countertopRunLength',
] as const;
type DeclaredQuantityField = (typeof DECLARED_QUANTITY_FIELDS)[number];

function isDeclaredQuantityField(field: string | undefined): field is DeclaredQuantityField {
  return field !== undefined && (DECLARED_QUANTITY_FIELDS as readonly string[]).includes(field);
}

/**
 * 橱柜 / 台面算量：读 `config/house.yaml` 的**已放置**柜体段几何，取代 `room.depth * 0.8`。
 *
 * 两个量分开，因为 house.yaml 把两件事分开了：
 *   - `kitchen_cabinet_run` 生成柜体（北墙两段 1.28 + 1.68 留洗碗机位，东墙 1.40）→ 柜体 4.36m；
 *   - `kitchen_countertop_bridge` 注释写明「只是连续台面，不生成柜体」→ 只进台面，不进柜体。
 * 柜体按**投影面积**计价（长 × cabinetHeight 0.86），台面按**延米**计价。
 * 投影面积口径的来源：schedule/phase-1/control.yaml 记「柜体 800/㎡投影」，即 materials.yaml 的
 * `cabinet_board_01` 800 元/㎡ 本来就是投影面积价——旧代码把延米公式喂给 ㎡ 单价才是量纲错配，
 * 所以修法是给正确的面积，不是把单价改成延米（改延米就要发明一个全库没有的 元/延米 价）。
 */
function loadCabinetRunTakeoff(catalog: ProjectCatalog): Map<string, { projectedAreaSqm: number; runLengthM: number; countertopLengthM: number }> {
  const byRoom = new Map<string, { projectedAreaSqm: number; runLengthM: number; countertopLengthM: number }>();
  const bucketFor = (roomId: string) => {
    const existing = byRoom.get(roomId);
    if (existing) return existing;
    const created = { projectedAreaSqm: 0, runLengthM: 0, countertopLengthM: 0 };
    byRoom.set(roomId, created);
    return created;
  };
  for (const [roomId, items] of Object.entries(catalog.getFurnishings())) {
    for (const item of items) {
      if (item.x === undefined || item.z === undefined) continue; // count-only 条目不带几何
      if (item.type === 'kitchen_cabinet_run') {
        const length = item.length;
        const cabinetHeight = item.cabinetHeight;
        if (!(Number.isFinite(length) && (length as number) > 0)) {
          throw new Error(`house.yaml ${roomId} 的 kitchen_cabinet_run 缺 length（柜体算量的唯一几何源）`);
        }
        if (!(Number.isFinite(cabinetHeight) && (cabinetHeight as number) > 0)) {
          throw new Error(`house.yaml ${roomId} 的 kitchen_cabinet_run 缺 cabinetHeight（投影面积 = 长 × 柜高，不回落默认值）`);
        }
        const bucket = bucketFor(roomId);
        bucket.runLengthM += length as number;
        bucket.projectedAreaSqm += (length as number) * (cabinetHeight as number);
        bucket.countertopLengthM += length as number;
        continue;
      }
      if (item.type === 'kitchen_countertop_bridge') {
        const length = item.length;
        if (!(Number.isFinite(length) && (length as number) > 0)) {
          throw new Error(`house.yaml ${roomId} 的 kitchen_countertop_bridge 缺 length（台面算量的唯一几何源）`);
        }
        bucketFor(roomId).countertopLengthM += length as number;
      }
    }
  }
  return byRoom;
}

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
 *
 * 2026-10-13 阶段 3 起**为空**：唯一一个合成 topic `hvac` 已改成读 config/hvac.yaml 的
 * `commercial` 块（shared/hvac-plans.ts），`data.status` 由 commercial.status 透传
 * （现行 = contracted，DEC-2026-10-04-R1 已成交）→ 走上面的 status 分支，不再需要白名单兜。
 * 白名单保留为**显式登记处**：将来再加合成选项（不从 materials.yaml 来的 topic）必须先在这里
 * 表态，否则 `autoActualBucket()` 抛错——绝不静默掉进默认档，那会让「已取证」的口径被悄悄注水。
 */
const SYNTHETIC_UNVERIFIED_TOPICS: ReadonlySet<string> = new Set();

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
  private masonryTakeoffCache: MasonryTakeoffResult | null = null;
  private declaredQuantityCache: { byField: Map<DeclaredQuantityField, Map<string, number>>; remainder: Map<DeclaredQuantityField, number> } | null = null;

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
   * 瓦工算量（墙砖/防水台贴砖/地面干湿区）进程内缓存。
   * 与 paintScopeCache 同理由：同一次 `calculate()` 里**材料侧与人工侧必须读到同一份口径**——
   * 「±658 双轨」的病灶正是两边各算一遍（材料侧只走 applyRooms 房间，人工侧另加 floor_region extra）。
   */
  private masonryTakeoff(): MasonryTakeoffResult {
    if (!this.masonryTakeoffCache) {
      this.masonryTakeoffCache = loadMasonryTakeoff(this.catalog);
    }
    return this.masonryTakeoffCache;
  }

  /**
   * 声明驱动的逐房数量表 + 无归属余量，带**量对账**（self-check）。
   *
   * 对账不是装饰：逐房表是 `takeoff.byRoom` / `dryRoomIds`/`wetRoomIds` 的**投影**，
   * 一旦投影漏了房间（例如某房有声明却没进干/湿区清单），总数与逐房和就会分叉，
   * 而分叉的表现是「预算少算一间接一间」——正是本次要根治的静默漏计。所以这里直接 throw。
   */
  private declaredQuantities(): { byField: Map<DeclaredQuantityField, Map<string, number>>; remainder: Map<DeclaredQuantityField, number> } {
    if (this.declaredQuantityCache) return this.declaredQuantityCache;

    const takeoff = this.masonryTakeoff();
    const cabinetRuns = loadCabinetRunTakeoff(this.catalog);

    const tileByRoom = new Map<string, number>();
    for (const [roomId, room] of Object.entries(takeoff.byRoom)) {
      tileByRoom.set(roomId, room.tileSqm);
    }
    const tileSum = [...tileByRoom.values()].reduce((sum, value) => sum + value, 0);
    if (Math.abs(tileSum - takeoff.totalTileSqm) > 1e-6) {
      throw new Error(`[budget-calculator] 贴砖量对账失败：逐房和 ${tileSum} ≠ takeoff.totalTileSqm ${takeoff.totalTileSqm}`);
    }

    const floorByRoom = new Map<string, number>();
    const floorRoomSplit = loadFloorRoomSplit();
    for (const room of this.catalog.getRooms()) {
      if (floorRoomSplit.dryRoomIds.includes(room.id) || floorRoomSplit.wetRoomIds.includes(room.id)) {
        // 只认 resolved 多边形面积（2026-10-14 阶段 4）：异形房退回 bbox 会让地面面积
        // 每间多算最多 0.6㎡，而这条路径直接进 masonry 的材料与人工两侧金额。
        floorByRoom.set(room.id, roomArea(room));
      }
    }
    const floorRoomSum = [...floorByRoom.values()].reduce((sum, value) => sum + value, 0);
    if (Math.abs(floorRoomSum - takeoff.totalRoomFloorSqm) > 1e-6) {
      throw new Error(`[budget-calculator] 地面房间量对账失败：逐房和 ${floorRoomSum} ≠ takeoff.totalRoomFloorSqm ${takeoff.totalRoomFloorSqm}`);
    }

    const cabinetProjectedByRoom = new Map<string, number>();
    const countertopByRoom = new Map<string, number>();
    for (const [roomId, run] of cabinetRuns) {
      cabinetProjectedByRoom.set(roomId, run.projectedAreaSqm);
      countertopByRoom.set(roomId, run.countertopLengthM);
    }

    this.declaredQuantityCache = {
      byField: new Map([
        ['masonryTileArea', tileByRoom],
        ['floorArea', floorByRoom],
        ['cabinetProjectedArea', cabinetProjectedByRoom],
        ['countertopRunLength', countertopByRoom],
      ]),
      // 只有 floorArea 有余量：非房间 floor_region extra（现行 = 主走廊 3.75㎡）。
      remainder: new Map([
        ['masonryTileArea', 0],
        ['floorArea', takeoff.floorRegionExtraSqm],
        ['cabinetProjectedArea', 0],
        ['countertopRunLength', 0],
      ]),
    };
    return this.declaredQuantityCache;
  }

  /** 瓦工算量的显形清单（有量无计价归属 / 无法派生）：进 `BudgetCategory.pendingQuantity`。 */
  private masonryPendingQuantity(): MasonryTakeoffResult['unpriced'] {
    const takeoff = this.masonryTakeoff();
    return [
      ...takeoff.unpriced,
      ...takeoff.unresolved.map((item) => ({ id: item.id, quantity: null, unit: '—', reason: item.reason })),
    ];
  }

  /**
   * 一个人工费分类可以有多条计价行（DEC-2026-10-08-C02：窗帘盒从吊顶 40 元/㎡ 里拆出来，
   * 改按延长米单列——README「没有合并项报价」）。`raw.labor` 兼容两种写法：
   * 单对象（既有各分类）或数组（carpentry / 阶段 3 起的 masonry）。
   * rate 为 null = 待报价：**不计入 actual，但数量必须显形**（cat.pendingLabor），
   * 否则「拆分」会变成「悄悄少算一笔钱」。
   *
   * `quoteRates` 按 **labor area 名**索引的生效报价费率表，由调用方把各 trade 的报价卡展开进来
   * （DEC-2026-10-13 阶段 3：原先只对 ceiling_zones / curtain_box_linear 两个 area 特判读报价卡，
   * 其余全部走 base.json；现在吊顶与瓦工两张卡走同一条路，吊顶特判随之删除）。
   * 查不到的行照旧走 base.json 的 labor.rate——「没有这个 trade 的报价卡」与「这行没报价」
   * 是两件事，前者不是错误。
   */
  private computeLabor(
    categories: BudgetCategory[],
    baseRaw: Record<string, BudgetCategoryRaw>,
    rooms: RoomLayout[],
    phase: PhaseId,
    takeoff: CeilingTakeoff,
    quoteRates: Partial<Record<string, ResolvedQuoteRate>>
  ): void {
    for (const cat of categories) {
      const raw = baseRaw[cat.key];
      if (!raw?.labor) continue;
      const laborEntries = Array.isArray(raw.labor) ? raw.labor : [raw.labor];

      for (const labor of laborEntries) {
      const { area } = labor;
      // 生效报价优先（吊顶 + 瓦工），未声明则回落 base.json 的 labor.rate。
      const quoted = quoteRates[area];
      const rate = quoted ? quoted.per_unit : labor.rate;
      const unit = quoted ? quoted.unit : labor.unit;
      let quantity = 0;

      switch (area) {
        case 'floor':
          {
            // DEC-2026-10-13 阶段 2 第二半：与材料侧**同一个出口**（this.masonryTakeoff()）。
            // 旧口径材料侧只加 applyRooms 房间 footprint（121.510㎡）、人工侧另加
            // loadExtraFloorRegionArea()（125.260㎡），差 3.75㎡ 正是主走廊
            // main_corridor_floor——DEC-2026-10-09-P16 裁定「走廊需要铺砖」，结果
            // 人工收了钱、主材没收。现在两边都读 takeoff。
            // 阶段 3：`floor` 只算**干区**地面（湿区拆到 wet_floor_tile 独立计价），
            // 两档费率不同（木纹砖 vs 湿区小砖），混在一行里必然有一档被另一档的单价代表。
            const masonry = this.masonryTakeoff();
            quantity = masonry.dryFloorSqm;
          }
          break;
        // 湿区地面贴砖（阶段 3 新增行）：量同样来自 takeoff，与 `floor` 同一出口。
        // 命名必须是 wet_floor_tile 而不是 wet_floor——后者已被 base.json 的 waterproof
        // 分类占用（20 元/㎡ 防水工），同名会让瓦工费率盖到防水工头上。
        case 'wet_floor_tile':
          quantity = this.masonryTakeoff().wetFloorSqm;
          break;
        // 墙砖 + 防水台贴砖（阶段 3 新增行）：与材料侧 wall topic 的 masonryTileArea 同一出口。
        case 'wall_tile':
          quantity = this.masonryTakeoff().totalTileSqm;
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
        // 防水工（base.json 的 waterproof 分类）按 needs_waterproof 房间计。
        // 与瓦工的 `wet_floor_tile` 是两件事：防水 ≠ 贴砖，且口径不同（这里含厨房，
        // 而厨房地面走干区木纹砖档，见 config/tile-comparison.yaml 的 dry_room_ids）。
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

        const pricePerUnit = requiredPrice(option.price_per_unit, `topic ${li.topic} 的选项 ${optionId}`);
        allLineItems.push({
          topic: li.topic,
          roomId: null,
          optionId,
          quantity: 1,
          unitPrice: pricePerUnit,
          coveragePerUnit: 1,
          lossRate: 1,
          cost: pricePerUnit,
        });
        addAutoActual(categoryKey, li.topic, pricePerUnit, option);
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

          const cost = requiredPrice(option.price_per_unit, `topic ${li.topic} 的选项 ${optionId}（房间 ${roomId}）`) * qty;
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
        // 瓦工/橱柜量走 shared/masonry-takeoff.ts 与 house.yaml 柜体段的声明表（阶段 2 第二半）。
        const declaredField = isDeclaredQuantityField(li.quantityField) ? li.quantityField : null;
        const declared = declaredField ? this.declaredQuantities() : null;
        const quantityFn = li.quantityField ? QUANTITY_FORMULAS[li.quantityField] : null;
        if (!paintScope && !declared && !quantityFn) continue;

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
            : declared
              ? (declared.byField.get(declaredField!)!.get(room.id) ?? 0)
              : quantityFn!(room);
          // 三个计价字段一次取齐：缺任何一个都抛错，不会出现"价格兜底成 0、损耗用真值"
          // 这种半套兜底半套真值的中间态（那种状态下连对账都看不出少了什么）。
          const { pricePerUnit, coveragePerUnit, lossRate } = pricingOf(
            option,
            `topic ${li.topic} 的选项 ${optionId}（房间 ${room.id}）`,
          );
          const cost = pricePerUnit * quantity / coveragePerUnit * lossRate;

          allLineItems.push({
            topic: li.topic, roomId: room.id, optionId,
            quantity, unitPrice: pricePerUnit,
            coveragePerUnit, lossRate, cost,
          });

          addAutoActual(categoryKey, li.topic, cost, option);
        }

        // 不属于任何房间的量（现行只有 floor_region extra = 主走廊 3.75㎡）单列一行显式计费。
        // 摊进任一房间 = 伪造归属；直接丢掉 = 静默漏计（旧口径人工侧就是加了、材料侧就是没加）。
        if (declared) {
          const remainder = declared.remainder.get(declaredField!) ?? 0;
          const remainderOptionId = scheme.selections[li.topic]?.default;
          if (remainder > 0 && remainderOptionId) {
            const option = this.catalog.getOption(li.topic, remainderOptionId);
            if (option) {
              const { pricePerUnit, coveragePerUnit, lossRate } = pricingOf(
                option,
                `topic ${li.topic} 的选项 ${remainderOptionId}（非房间余量 ${remainder}）`,
              );
              const cost = pricePerUnit * remainder / coveragePerUnit * lossRate;
              allLineItems.push({
                topic: li.topic,
                roomId: null,
                optionId: remainderOptionId,
                quantity: remainder,
                unitPrice: pricePerUnit,
                coveragePerUnit,
                lossRate,
                cost,
              });
              addAutoActual(categoryKey, li.topic, cost, option);
            }
          }
        }
      } else {
        const optionId = scheme.selections[li.topic]?.default;
        if (!optionId) continue;

        const option = this.catalog.getOption(li.topic, optionId);
        if (!option) continue;

        const pricePerUnit = requiredPrice(option.price_per_unit, `topic ${li.topic} 的选项 ${optionId}`);
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

    const masonryPendingQuantity = this.masonryPendingQuantity();
    const categories: BudgetCategory[] = baseCategories.map((bc) => {
      const split = categoryAutoActual.get(bc.key);
      const verifiedActual = split?.verified ?? 0;
      const candidateActual = split?.candidate ?? 0;
      return {
        key: bc.key,
        budget: bc.budget,
        // 口径变更（2026-10-14，方案阶段 5）：actual 只计**已取证**的材料款 + 人工。
        // 旧口径把 candidateActual（到店未确认的候选价）也全额计进 actual，于是
        // totalActual ¥157,870 里有 ¥92,696 是"如果候选价全部属实"的假设值。
        // candidateActual 继续在快照里单独输出——不是删数据，是换口径：
        // 业主要同时看到"已取证花多少"和"若候选价属实还会多花多少"。
        // autoActual 保持 verified+candidate（材料全额概念，阶段 1 起的不变量）。
        actual: bc.actual + verifiedActual,
        manualActual: bc.actual,
        // autoActual 由两份相加得出，使 `verifiedActual + candidateActual === autoActual`
        // 成为结构性不变量（而非恰好凑上的巧合），下游可以无条件断言它。
        autoActual: verifiedActual + candidateActual,
        verifiedActual,
        candidateActual,
        // 瓦工有量但**没有计价归属**的条目（生活阳台地面、反边/开孔 extras）挂在 masonry 上：
        // 阶段 2 把 floor/wall 的量改成声明实算后，不在干/湿区清单里的房间不再被默认计费，
        // 但「不计费」必须看得见，否则就是静默归零（R1 那类病的镜像）。
        ...(bc.key === 'masonry' && masonryPendingQuantity.length
          ? { pendingQuantity: masonryPendingQuantity }
          : {}),
        status: bc.status as BudgetCategory['status'],
        notes: bc.notes,
      };
    });

    const takeoff = ceilingTakeoff(this.catalog);
    // 生效报价（DEC-2026-10-08-C03）：报价文件缺失/非法时按「无报价」处理，
    // 全部计价行回落 base.json 的 labor rate——预算不能被一个坏配置文件冻结。
    // 直接把 null 传给 resolveActiveCeilingRates，**不伪造报价卡**：旧实现在这里合成
    // `{ active: 'base.json', quotes: [] }`，resolver 的 find() 返回 undefined 即抛错，
    // 而 /api/budget 对 calculate() 没有 try/catch → 整个预算接口 500，兜底承诺是假的。
    let quotes: CeilingQuotesFile | null = null;
    try {
      quotes = loadCeilingQuotes();
    } catch (err) {
      // 回落必须看得见：这条日志 + 每行 source='base.json' 是「配置坏了」的唯一痕迹。
      console.error('[budget-calculator] ceiling-quotes.yaml 不可用，全部计价行回落 base.json 费率：', err instanceof Error ? err.message : String(err));
    }
    // 瓦工报价卡（阶段 3）：与吊顶同一条路——文件坏了按「无报价」处理，不冻结预算。
    let masonryQuotes: MasonryQuotesFile | null = null;
    try {
      masonryQuotes = loadMasonryQuotes();
    } catch (err) {
      console.error('[budget-calculator] masonry-labor.yaml 不可用，全部计价行回落 base.json 费率：', err instanceof Error ? err.message : String(err));
    }

    const ceilingRates = resolveActiveCeilingRates(quotes, fallbackCeilingRates(budgetRaw.categories));
    // 瓦工的解析多一步「按选型规格取行」：卡上按规格分行，项目按 data/current-scheme.json 的
    // 选型取行；规格表里没有的那一档（湿区 400×400 / 200×200）自然落到 fallback，
    // 而 fallback 也是 null → 待报价显形。
    const masonryRates = resolveActiveMasonryRates(
      masonryQuotes,
      masonryQuoteFallback(budgetRaw.categories),
      masonrySpecSelection(this.catalog, scheme, loadFloorRoomSplit()),
    );

    // computeLabor 的费率表按 **labor area 名**索引，由调用方把各 trade 的卡展开进来。
    // 吊顶的 key 本身就是 area 名；瓦工的 key 要经 MASONRY_LABOR_AREAS 转一道
    // （wet_floor → wet_floor_tile，避开 base.json 里 waterproof 分类已占用的 wet_floor）。
    const quoteRates: Partial<Record<string, ResolvedQuoteRate>> = { ...ceilingRates };
    for (const [key, rate] of Object.entries(masonryRates)) {
      quoteRates[MASONRY_LABOR_AREAS[key as MasonryQuoteRateKey]] = rate;
    }

    this.computeLabor(categories, budgetRaw.categories, this.catalog.getRooms(), phase, takeoff, quoteRates);

    // 报价对比进快照：active 那家就是 actual 的来源，其余候选只并排展示、不动金额。
    const ceilingQuotes = quotes
      ? {
          activeId: quotes.active,
          source: ceilingRates.ceiling_zones.source === 'quote' ? 'quote' as const : 'base.json' as const,
          comparison: compareCeilingQuotes(quotes, takeoff, fallbackCeilingRates(budgetRaw.categories)),
        }
      : undefined;

    // Status computed AFTER computeLabor: labor can push a category over budget.
    for (const cat of categories) {
      if (cat.status === 'reserved') continue;
      // 「没有计价来源」≠「不花钱」（2026-10-14 阶段 4）。
      //
      // 旧口径 `ratio = budget > 0 ? actual / budget : 0` → actual 为 0 时 ratio=0 → 'ok'。
      // 于是 `demolition`(¥5,000，拆改+清运) 与 `property_fees`(¥3,000，押金/垃圾清运/管理费)
      // 这两个既无 labor 行、又无 material 自动额、也无人工录入的科目，长期显示为健康状态，
      // 而它们的 actual 恒为 0——**系统性低估 ¥8,000，且仪表盘上一片绿灯**。
      // 这正是「总额看起来合理被当成口径正确的证据」的又一例：这两个科目从未有过任何报价，
      // 只是从来没人在预算里给它们一个"未定价"的位置。
      //
      // 判据必须是"有没有计价来源"，而不是"actual 是不是 0"：
      // 有 labor 行 / 有材料自动额 / 有人工录入 / 有待报价或待定量显形清单 → 有来源，
      // actual 为 0 只说明"该科目本期确实不花钱"；四样都没有 → 从未定价，标 'unpriced'。
      const raw = budgetRaw.categories[cat.key];
      const hasLaborRow = raw?.labor !== undefined;
      const hasCostBasis = hasLaborRow
        || cat.autoActual > 0
        || cat.manualActual > 0
        || (cat.pendingLabor?.length ?? 0) > 0
        || (cat.pendingQuantity?.length ?? 0) > 0;
      if (!hasCostBasis) {
        cat.status = 'unpriced';
        continue;
      }
      // 阶段 5 口径变更后的补判：actual 只计已取证款后，一个科目可能
      // 「有材料全额（autoActual>0）但已取证一分钱没有（actual=0、全在 candidateActual）」。
      // 此时 ratio=0 → 'ok'，而真相是"这个科目本期一个报价都没拿到"。
      // 判据：本期已取证款为 0 且全部金额都在候选档 → 'unpriced'（不是 ok）。
      // 有 labor 的科目（water_electric / masonry / painting）actual 含人工，不受影响。
      const allUnverified = cat.actual === 0 && (cat.candidateActual ?? 0) > 0 && (cat.verifiedActual ?? 0) === 0;
      if (allUnverified) {
        cat.status = 'unpriced';
        continue;
      }
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
