/**
 * 墙段纯几何：按洞口切分墙段、开洞投影、沿墙插值。原实现自 three-scene-geometry.ts 抽出
 * （2026-11-03，DXF 导出需要同一口径但不引入 three.js），three-scene-geometry.ts 改为 re-export，
 * 全仓仍只有这一份实现。
 *
 * 2026-11-07（issue #98 第三阶段 S2）收编「开洞投影」：原先同一投影有四份实现——
 * `shared/paint-scope.ts` 的 `doorGapsOnWall`、`shared/masonry-takeoff.ts` 的
 * `masonryOpeningSpans`、`scripts/verify/finish/verify-finish-scope.ts` 的 inline 循环、
 * 以及本文件 `splitSegmentByOpenings` 内联的投影——外加 SceneBuilder sill 分支一份
 * inline `pointAt`（沿墙插值第五份，已改 import `pointAlongPolyline`）。
 * 现在洞口投影只剩 `openingsAlongWall` 一个入口，`splitSegmentByOpenings` 内部也走同一投影内核。
 *
 * **一处语义分歧的裁决（设计文档 §5.6 明令）**：涂装侧原 `openingSill`（door → 0、非门洞
 * 缺 sill 抛错）与瓦工侧原 `opening.sill ?? 0` 对**非门洞口缺 sill** 的缺省不同。统一后取
 * fail-closed 那条（抛错）：窗台高是算量输入，按 0 算会把整段墙当落地洞口扣掉，涂装/贴砖
 * 面积凭空变小。本案 model-geometry 的 9 条 openings 全部是 door 且全部不写 sill，
 * 该裁决对现行数据零行为变化，只对将来的窗/垭口声明生效。
 */

export interface SceneSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface SceneOpening {
  x: number;
  z: number;
  width: number;
  height: number;
}

/** 洞口声明的最小契约：model-geometry openings / resolved layout openings / catalog 墙都满足。 */
export interface WallOpeningInput {
  id: string;
  type: string;
  /** 洞口**中心**世界坐标（anchor + offset 解算后的绝对值）。 */
  x: number;
  z: number;
  width: number;
  height: number;
  /** 洞底标高。非门洞口必填（见 openingSill）。 */
  sill?: number;
  room?: string;
}

/** 墙几何 + 开洞列表的最小契约（PaintWallInput / MasonryWallInput / resolved wall 都满足）。 */
export interface OpeningsWallInput {
  /** 墙 id。本函数不用它，但真实墙对象都带 id——收进契约，调用方不必为了投影把 id 剥掉。 */
  id?: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** 折线细分（resolver 对圆角墙产的弧段）；缺省 = 单段直线。沿墙长度按折线累计。 */
  segments?: Array<{ x1: number; z1: number; x2: number; z2: number }>;
  /**
   * 该墙的 openings。**运行时缺省按「没有洞」处理**——「调用方忘了传」与「墙上真的没有洞」
   * 的区分由调用侧类型系统把守：`shared/paint-scope.ts` 的 `PaintWallInput.openings` 是必填，
   * 每个涂装调用方都必须显式表态（缺了它就等于墙上没有洞，涂装面积会静默多算）。
   */
  openings?: WallOpeningInput[];
}

/** 一个洞口投影到墙上的沿墙区间（米，自墙 from 端累计）。 */
export interface WallOpeningSpan {
  id: string;
  kind: 'door' | 'window';
  from: number;
  to: number;
  /** 洞底标高（门 = 完成面 0；非门缺声明即抛错，见 openingSill）。 */
  bottom: number;
  /** 洞顶标高 = bottom + height。 */
  top: number;
}

const EPS = 1e-9;

/**
 * 门洞的洞底标高 = 完成面（0m）。
 *
 * 这是**唯一被保留的默认值**，且它有物理依据而不是"猜一个数"：门从完成面起算，
 * model-geometry.yaml 的 9 条 openings 全部是 door 且全部不写 sill（写了反而冗余）。
 * 非门的洞口（窗/垭口）**不享受这个默认**——窗台高是算量输入，缺了就必须抛错，
 * 否则会按"落地窗"扣掉一整面墙的涂装面积。
 */
const DOOR_SILL_M = 0;

/** 洞口洞底标高：门取完成面，其余缺声明即抛错（不能按落地算，那会多扣面积）。 */
function openingSill(opening: { id: string; type: string; sill?: number }): number {
  if (opening.type === 'door') return DOOR_SILL_M;
  if (opening.sill === undefined) {
    throw new Error(
      `洞口 ${opening.id}（type=${opening.type}）缺 sill：非门洞口的洞底标高无法推断，按 0 算会把整段墙面当落地洞口扣掉（涂装面积凭空变小）`,
    );
  }
  return opening.sill;
}

/**
 * 洞口中心在单段墙直线上的投影。段退化（长度 ≤ EPS）时返回 null。
 *
 * 这是全仓唯一的「洞口中心（世界坐标）→ 沿墙位置」投影内核：`openingsAlongWall`
 * （门/窗洞沿墙区间）与 `splitSegmentByOpenings`（按洞切分墙段）共用它，但两者的
 * **越界策略不同**——前者投影点不在段内就整个洞口跳过，后者把区间裁剪到段内——
 * 所以 t 不在此处裁剪，由调用方各自执行自己的策略。
 *
 * 两个距离口径都给出，因为两个原消费方各写各的、数值上只差末位（统一不许改变任一方的
 * 逐位输出：DXF/GLB 产物零变化是验收口径）：
 *   - `along`：单位向量点积式 `(c−a)·u`——splitSegmentByOpenings 原口径；
 *   - `t`：归一化参数 `(c−a)·d/|d|²`——openingsAlongWall 折线累计原口径
 *     （`total − remaining + length·clamp(t)`）。
 */
function openingProjectionOnSegment(
  segment: SceneSegment,
  center: { x: number; z: number },
): { t: number; along: number; length: number } | null {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length <= EPS) return null;
  const dot = (center.x - segment.x1) * dx + (center.z - segment.z1) * dz;
  return {
    t: dot / (length * length),
    along: (center.x - segment.x1) * (dx / length) + (center.z - segment.z1) * (dz / length),
    length,
  };
}

/**
 * 把墙上的 openings（世界坐标中心）投影成沿墙区间——开洞投影的**唯一入口**。
 *
 * 与 layout-resolver 的解算一致：openings 的 x/z 是洞口**中心**绝对值，投影到墙
 * from→to 方向得到 along 区间（墙在当前模型里均为单段，保留折线通用性）。
 * 投影点不落在任一段内（容差 1e-6）的洞口整个跳过——它不属于这面墙。
 * 洞底标高走 `openingSill` 的 fail-closed 语义（门 → 0，非门缺 sill 抛错）。
 */
export function openingsAlongWall(wall: OpeningsWallInput): WallOpeningSpan[] {
  const segments = wall.segments?.length
    ? wall.segments
    : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
  const total = polylineLength(segments);
  const spans: WallOpeningSpan[] = [];
  for (const opening of wall.openings ?? []) {
    // 在折线上找到离洞口中心最近的投影点（墙在当前模型里均为单段，保留折线通用性）。
    let remaining = total;
    let along = -1;
    for (const segment of segments) {
      const projection = openingProjectionOnSegment(segment, opening);
      if (!projection) continue;
      if (projection.t < -1e-6 || projection.t > 1 + 1e-6) {
        remaining -= projection.length;
        continue;
      }
      const clamped = Math.min(1, Math.max(0, projection.t));
      along = total - remaining + projection.length * clamped;
      break;
    }
    if (along < 0) continue;
    const half = opening.width / 2;
    const bottom = openingSill(opening);
    spans.push({
      id: opening.id,
      kind: opening.type === 'door' ? 'door' : 'window',
      from: along - half,
      to: along + half,
      bottom,
      top: bottom + opening.height,
    });
  }
  return spans;
}

export function splitSegmentByOpenings(segment: SceneSegment, openings: SceneOpening[]): SceneSegment[] {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return [];
  const ux = dx / length;
  const uz = dz / length;
  const blocked = openings
    .filter((opening) => opening.height > 0 && opening.width > 0)
    .flatMap((opening) => {
      // 与 openingsAlongWall 同一投影内核；本函数的越界策略是把区间裁剪到段内
      // （洞口中心投在段外仍挡住它能伸进来的那一截），不是整个跳过。
      const projection = openingProjectionOnSegment(segment, opening);
      if (!projection) return [];
      const center = projection.along;
      return [[Math.max(0, center - opening.width / 2), Math.min(length, center + opening.width / 2)] as const];
    })
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const result: SceneSegment[] = [];
  let cursor = 0;
  for (const [start, end] of blocked) {
    if (start > cursor) {
      result.push({
        x1: segment.x1 + ux * cursor,
        z1: segment.z1 + uz * cursor,
        x2: segment.x1 + ux * start,
        z2: segment.z1 + uz * start,
      });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) {
    result.push({ x1: segment.x1 + ux * cursor, z1: segment.z1 + uz * cursor, x2: segment.x2, z2: segment.z2 });
  }
  return result;
}

/**
 * 沿折线链（墙的 segments 细分或单段主线）逐段累计取距离处的点——wall_region/paint_region/
 * skirting_region 的 along 语义（3D 侧 SceneBuilder.pointAt 同算法，DXF 导出共用本实现）。
 * 超出总长返回 null。
 */
export function pointAlongPolyline(segments: readonly SceneSegment[], distance: number): { x: number; z: number } | null {
  let remaining = distance;
  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= 1e-9) continue;
    if (remaining <= length + 1e-9) {
      const t = Math.min(1, Math.max(0, remaining / length));
      return { x: segment.x1 + (segment.x2 - segment.x1) * t, z: segment.z1 + (segment.z2 - segment.z1) * t };
    }
    remaining -= length;
  }
  return null;
}

/** 折线链总长（wall_region along 区间合法性校验用，与 SceneBuilder wall_region 分支同口径）。 */
export function polylineLength(segments: readonly SceneSegment[]): number {
  return segments.reduce((sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
}

/**
 * 沿折线链裁剪 [from, to] 区间，保留区间内的全部墙段（转角处逐段输出，不连弦）。
 * 原实现自 render/SceneBuilder.ts 抽出（2026-11-03，DXF 出图共用同一裁剪口径）。
 */
export function clipAlongSpan(
  segments: readonly SceneSegment[],
  from: number,
  to: number,
): Array<{ a: { x: number; z: number }; b: { x: number; z: number } }> {
  const clipped: Array<{ a: { x: number; z: number }; b: { x: number; z: number } }> = [];
  const total = polylineLength(segments);
  let cursor = 0;
  const lo = Math.max(0, from), hi = Math.min(total, to);
  for (const segment of segments) {
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= 1e-9) continue;
    const s0 = cursor, s1 = cursor + length;
    cursor = s1;
    const a = Math.max(lo, s0), b = Math.min(hi, s1);
    if (b - a <= 1e-9) continue;
    const t0 = (a - s0) / length, t1 = (b - s0) / length;
    clipped.push({
      a: { x: segment.x1 + (segment.x2 - segment.x1) * t0, z: segment.z1 + (segment.z2 - segment.z1) * t0 },
      b: { x: segment.x1 + (segment.x2 - segment.x1) * t1, z: segment.z1 + (segment.z2 - segment.z1) * t1 },
    });
  }
  return clipped;
}
