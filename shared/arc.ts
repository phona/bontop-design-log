/**
 * 切线弧描述符（纯函数：无 THREE、无 IO、不读配置）——全仓唯一的「切点 + 弧心」解算器。
 *
 * 2026-11-07（issue #98 第三阶段 S2）建立。此前同一套公式住在三处通用解算器里：
 *   - `server/layout-resolver.ts` 的 `tangentPoints`（model-geometry 顶点 radius，墙圆角）；
 *   - `shared/arc-polyline.ts` 的 `arcDescriptor`（overlay 折线圆角点的 radius/cx/cz）；
 *   - `server/budget-calculator.ts` 的 `tangentPointOnEdge`（floor_region 闭合多边形的声明弧心）。
 * 三处写的都是同一个事实——**切点距角点 r/tan(θ/2)、弧心距角点 r/sin(θ/2)（内角平分线）**——
 * 却各推一遍；改一处忘两处，就是「3D 里的弧和预算里的弧不是同一段弧」。
 * 本模块只收**切点与弧心**这一个纯函数；各采样器输出形态各异，保留各自实现
 * （layout-resolver 的 16 段墙弧、`shared/arc-polyline.ts` 的 centerlineSamples、
 * `shared/render/CeilingZoneBuilder.ts` 的四角/阴角 shape、`shared/render/BaySillGeometry.ts`
 * 的弧归一化），但切点与弧心一律走本函数，不许再推第四套。
 *
 * 两种输入形态，同一个函数、**无模式参数**：
 *   ① 只给 `radius`：按切线公式解算（角点 + 两邻点 + 半径）；
 *   ② 另给 `center`（声明式弧心）：切点取「弧心在邻边上的垂足」（邻点本身在圆上时直接
 *      用邻点），并校验切点落在**邻边线段内**、到弧心距离等于 `radius`。
 *      overlay 的圆角折线点（`server/overlay-merge.ts` 的 resolveWallRef 产出 radius/cx/cz）
 *      与 floor_region 的闭合多边形圆角（`config/model/envelope/floor-zones.yaml` 的
 *      radius+cx/cz）都走 ②。
 *
 * **声明形态解不出即整体返回 null，不回落到切线公式**（2026-11-07 S2 对原
 * `shared/arc-polyline.ts` arcDescriptor 落回语义的裁决）：回落会用「不一致的声明弧心」
 * 配「切线公式切点」，产出一段端点不在自己圆上的弧；预算侧（原
 * `server/budget-calculator.ts` 的 tangentPointOnEdge）在这种数据上是**抛错**的，
 * 统一后不许把这条守卫抹成静默。现行数据全部走直接/垂足路径（resolver 的弧端点就在圆上、
 * floor_region 的邻边与声明圆相切），回落不可达；将来声明不自洽时，3D 侧退化成直折线、
 * 预算侧抛错，两边都显形。
 *
 * fail-closed：解不出（半径非正、夹角退化、切点超出邻边、垂足在线段外、半径与弧心不自洽）
 * 一律返回 null，由调用方决定抛错还是回落直线——本函数不猜、不兜底。
 *
 * 输出吸附 1e-12 浮点噪声（`1.1 + 1.0000000000000002` 这类误差会破坏下游的精确相等断言，
 * 如 layout-resolver 墙段/弧心的相等断言）；吸附精度远低于任何工程容差，不改变几何结论。
 */

export interface ArcPoint {
  x: number;
  z: number;
}

/** 一段切线弧的完整描述：切点、弧心与弧参数（极角起点 + 归一化扫角）。 */
export interface TangentArc {
  /** 弧心。 */
  center: ArcPoint;
  radius: number;
  /** prev 侧切点（弧起点）。 */
  start: ArcPoint;
  /** next 侧切点（弧终点）。 */
  end: ArcPoint;
  /** start 相对弧心的极角。 */
  startAngle: number;
  /** 扫角，归一化到 (-π, π]（正值 = 从 start 逆时针到 end）。 */
  delta: number;
}

/** 声明式弧心形态下「切点是否落在圆上」的容差（米）：resolver 产出的弧端点经 1e-12 吸附，1cm 足够。 */
const ON_CIRCLE_TOLERANCE = 0.01;
/** 声明式弧心形态下「垂足是否落在邻边线段内」的容差（米）：声明坐标只到 0.01m，1e-6 不吞邻段。 */
const ON_EDGE_TOLERANCE = 1e-6;
/** 输出吸附精度：1e-12 栅格，保下游精确相等断言，远低于工程容差。 */
const SNAP = 1e12;

/** 吸附浮点噪声（1.1 + 1.0000000000000002 → 1.1）。 */
function snap(value: number): number {
  return Math.round(value * SNAP) / SNAP;
}

function snapPoint(point: ArcPoint): ArcPoint {
  return { x: snap(point.x), z: snap(point.z) };
}

/**
 * 解算角点处的切线弧。
 *
 * @param corner 角点（圆角点）。
 * @param prev   沿入边方向的邻点（决定 start 切点）。
 * @param next   沿出边方向的邻点（决定 end 切点）。
 * @param radius 圆角半径；非正返回 null。
 * @param center 声明式弧心（可选）。**给了它就只按声明式解**：切点取「弧心在邻边上的
 *               垂足」（邻点本身在圆上时直接用邻点），校验切点在邻边线段内、到弧心距离
 *               等于 radius；任一条不满足返回 null（不回落到切线公式，见头注）。
 *               不给才按纯切线公式解（切点距角点 r/tan(θ/2)、弧心距角点 r/sin(θ/2)）。
 * @returns 描述符；解不出返回 null（调用方抛错或回落直线）。
 */
export function tangentArc(
  corner: ArcPoint,
  prev: ArcPoint,
  next: ArcPoint,
  radius: number,
  center?: ArcPoint,
): TangentArc | null {
  if (!(radius > 0)) return null;

  // ── 形态 ②：声明式弧心 ────────────────────────────────────────────────────
  // Resolved wall references carry the actual arc endpoints in `prev`/`next` and
  // the authoritative center on the rounded point. Do not treat the corner as a
  // plain corner again: doing so computes a second set of tangent points and can
  // collapse the intended arc or create a long cross-boundary arc.
  if (center) {
    // 弧心在「角点 → 邻点」这条边上的垂足（即切点）；邻点退化时无解。
    const footOnEdge = (edge: ArcPoint): { point: ArcPoint; distance: number; edgeLength: number } | null => {
      const dx = edge.x - corner.x;
      const dz = edge.z - corner.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-9) return null;
      const length = Math.sqrt(lengthSquared);
      const t = ((center.x - corner.x) * dx + (center.z - corner.z) * dz) / lengthSquared;
      return { point: { x: corner.x + t * dx, z: corner.z + t * dz }, distance: t * length, edgeLength: length };
    };
    const directPrev = { x: prev.x, z: prev.z };
    const directNext = { x: next.x, z: next.z };
    const startFoot = footOnEdge(prev);
    const endFoot = footOnEdge(next);
    // 邻点本身就在圆上（容差内）时它就是切点，直接采用；否则取垂足。
    const start = startFoot
      ? (Math.abs(Math.hypot(directPrev.x - center.x, directPrev.z - center.z) - radius) <= ON_CIRCLE_TOLERANCE
        ? directPrev
        : startFoot.point)
      : null;
    const end = endFoot
      ? (Math.abs(Math.hypot(directNext.x - center.x, directNext.z - center.z) - radius) <= ON_CIRCLE_TOLERANCE
        ? directNext
        : endFoot.point)
      : null;
    // fail-closed：切点必须落在邻边**线段**内（不是边的延长线），且到弧心距离等于 radius。
    // 前者接替 server/budget-calculator.ts 原 tangentPointOnEdge 的越界抛错——
    // 统一后不许把这条守卫抹掉。
    const onSegment = (foot: { distance: number; edgeLength: number } | null): boolean =>
      foot !== null && foot.distance >= -ON_EDGE_TOLERANCE && foot.distance <= foot.edgeLength + ON_EDGE_TOLERANCE;
    if (!(start && end
      && onSegment(startFoot) && onSegment(endFoot)
      && Math.abs(Math.hypot(start.x - center.x, start.z - center.z) - radius) <= ON_CIRCLE_TOLERANCE
      && Math.abs(Math.hypot(end.x - center.x, end.z - center.z) - radius) <= ON_CIRCLE_TOLERANCE)) {
      return null;
    }
    const startAngle = Math.atan2(start.z - center.z, start.x - center.x);
    let delta = Math.atan2(end.z - center.z, end.x - center.x) - startAngle;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    if (Math.abs(delta) <= 0.001) return null;
    return { center: snapPoint(center), radius, start: snapPoint(start), end: snapPoint(end), startAngle, delta };
  }

  // ── 形态 ①：纯切线公式 ────────────────────────────────────────────────────
  const toPrev = { x: prev.x - corner.x, z: prev.z - corner.z };
  const toNext = { x: next.x - corner.x, z: next.z - corner.z };
  const len1 = Math.hypot(toPrev.x, toPrev.z);
  const len2 = Math.hypot(toNext.x, toNext.z);
  if (len1 < 1e-9 || len2 < 1e-9) return null;
  const uPrev = { x: toPrev.x / len1, z: toPrev.z / len1 };
  const uNext = { x: toNext.x / len2, z: toNext.z / len2 };
  const theta = Math.acos(Math.max(-1, Math.min(1, uPrev.x * uNext.x + uPrev.z * uNext.z)));
  if (theta < 0.001 || Math.abs(theta - Math.PI) < 0.001) return null;
  const tangent = radius / Math.tan(theta / 2);
  // 切点必须落在两邻边线段内（弧要替换的是边的一段，不是延长线）
  if (tangent > len1 + 0.001 || tangent > len2 + 0.001) return null;
  const start = { x: corner.x + uPrev.x * tangent, z: corner.z + uPrev.z * tangent };
  const end = { x: corner.x + uNext.x * tangent, z: corner.z + uNext.z * tangent };
  const cross = uPrev.x * uNext.z - uPrev.z * uNext.x;
  const normal = { x: -uPrev.z, z: uPrev.x };
  // 弧心在角点内角平分线上、距角点 r/sin(θ/2)：用「切点 + 法向 × r」表达（sign(cross) 定内外侧），
  // 与 layout-resolver 原 tangentPoints 的平分线写法（dPrev+dNext 归一化 × r/sin(θ/2)）是同一点。
  // 走到这里时 center 必为 undefined（给了 center 的形态在上方已整体返回），无需再二选一。
  const arcCenter = { x: start.x + Math.sign(cross) * normal.x * radius, z: start.z + Math.sign(cross) * normal.z * radius };
  const startAngle = Math.atan2(start.z - arcCenter.z, start.x - arcCenter.x);
  let delta = Math.atan2(end.z - arcCenter.z, end.x - arcCenter.x) - startAngle;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  return { center: snapPoint(arcCenter), radius, start: snapPoint(start), end: snapPoint(end), startAngle, delta };
}
