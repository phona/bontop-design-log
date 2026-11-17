/**
 * 带圆角的多边形面积（㎡）——全仓唯一的圆角多边形闭式解。
 *
 * 圆角**不能**按外接矩形算：`north_platform_floor` 的 NW 角 r=1.0，直角外接算出 1.60㎡，
 * 真实 1.3854㎡（1.60 − [0.5 − π/4]）。做法与 shared/render 的圆角同一套几何——圆心 + 半径
 * 在两条邻边上定切点、锐角面积减圆弓面积；这里取闭式解（不采样折线），所以不存在
 * 「渲染端折线段数不同导致面积对不上」的第二套口径。切点落在邻边线段之外、圆心与半径
 * 不自洽、弧心与邻边不相切、扫角退化时直接抛错（fail-closed）：一条坏弧声明应该让预算
 * 算不出来，而不是悄悄少算 0.21㎡。
 *
 * 切点与弧心统一走 `shared/arc.ts` 的 `tangentArc`（原 `tangentPointOnEdge` 本地副本，
 * 2026-11-07 issue #98 第三阶段 S2 删除）：floor_region 圆角点带声明式 cx/cz，
 * 走 descriptor 的「垂足 = 切点」形态，其越界/不自洽/相切校验即本函数的 fail-closed 守卫。
 *
 * 2026-11-16 量价算法审计 D1：此前本函数只住在 `server/budget-calculator.ts`、
 * 只供 floor_region 用，而 `server/layout-resolver.ts` 的房间面积用尖角鞋带公式，
 * 三处 r=1.0 圆角（主卧 v_sw、主卫 v_bath_nw、平台 v_vrv_n）各多算 0.2146㎡，
 * 地面总量多算 0.4292㎡（约 ¥72.29）。现抽到 shared，两处同源。
 */

import { tangentArc } from './arc.js';
import type { CurtainPoint } from './types.js';

/** 几何容差：声明坐标只到 0.01m，边界贴合判定用 1e-6 足够，又不至于把隔壁区域吞进来。 */
const GEO_EPS = 1e-6;

export function roundedPolygonArea(points: CurtainPoint[]): number {
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
      throw new Error(`多边形圆角半径必须为正（第 ${i} 点 radius=${corner.radius}）`);
    }
    if (corner.cx === undefined || corner.cz === undefined) {
      throw new Error(`多边形圆角点缺 cx/cz（第 ${i} 点），弧心不可定位`);
    }
    const center = { x: corner.cx, z: corner.cz };
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    // 切点/弧心解算唯一入口（shared/arc.ts）。返回 null = 切点落在邻边线段之外、
    // 半径与弧心不自洽、弧心与邻边不相切或夹角退化——预算算不出来，不悄悄少算一块地。
    const arc = tangentArc(corner, prev, next, corner.radius, center);
    if (!arc) {
      throw new Error(
        `多边形圆角点（第 ${i} 点）无法由 tangentArc 解出切点：切点落在邻边线段之外、半径与弧心不自洽、弧心与邻边不相切或夹角退化`,
      );
    }
    const t1 = arc.start;
    const t2 = arc.end;
    // 被圆角替掉的锐角三角形面积
    const cornerArea = Math.abs(
      (t1.x - corner.x) * (t2.z - corner.z) - (t2.x - corner.x) * (t1.z - corner.z)
    ) / 2;
    const a = { x: t1.x - center.x, z: t1.z - center.z };
    const b = { x: t2.x - center.x, z: t2.z - center.z };
    const theta = Math.atan2(Math.abs(a.x * b.z - a.z * b.x), a.x * b.x + a.z * b.z);
    if (theta <= GEO_EPS || Math.PI - theta <= GEO_EPS) {
      throw new Error(`多边形圆角扫角退化（${theta.toFixed(6)} rad），弧声明与邻边不匹配`);
    }
    // 弦与弧之间的圆弓面积（凸角时被磨掉、凹角时被补回的那一块）
    const segment = corner.radius * corner.radius * (theta - Math.sin(theta)) / 2;
    const cut = cornerArea - segment;
    const turn = (corner.x - prev.x) * (next.z - corner.z) - (corner.z - prev.z) * (next.x - corner.x);
    // 凸角 ⟺ 转向与绕向同号（CCW 凸角左转、CW 凸角右转）；修正量作用在面积的
    // 幅值上，再乘绕向回到带符号面积。旧式 `area += orient * turn > 0 ? -cut : cut`
    // 把修正直接加在带符号面积上：CCW 是对的，CW 时凸角反而越加越大（2×2 矩形
    // 一角 R1：CCW 得 3.7854，同一轮廓反向得 4.2146——Codex blocking，PR #255
    // 复审第 3 轮）。layout-resolver 先归一化为 CCW 故生产房间面积不受影响；
    // 但 budget 的 floor_region 与镜像校验直接传原始绕向，CW 圆角房会被误判。
    const convex = orient * turn > 0;
    area += orient * (convex ? -cut : cut);
  }
  return Math.abs(area);
}

/**
 * 多边形交叠面积——全仓唯一的多边形交叠实现。
 *
 * 2026-11-16 量价算法审计 D10 起住在 `shared/facts-lint.ts`（overlap 契约用）；
 * PR #255 复审第 4 轮移至此处：masonry 的 floor_region 横跨判定在采样、顶点 +
 * 交叉、共线 + 中点三轮手写谓词后仍漏 realistic 构形（边经凹角顶点穿出缺口），
 * 判定须改为面积比较——交叠面积 0 / 部分 / 等于区域面积即房外 / 横跨 / 房内。
 * 两处同源，不再各写一套谓词/裁剪。facts-lint 的 overlap 契约与 masonry 的
 * 横跨判定都调 `overlapArea`，行为与搬家前逐字相同。
 */

/** 多边形顶点（x/z 平面）。与 `CurtainPoint` 同形（后者另带可选的圆角字段）。 */
export type PolygonPoint = { x: number; z: number };

/** 鞋带面积（绝对值）。点数不足 3 返回 0。 */
export function shoelace(pts: PolygonPoint[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(area / 2);
}

/** 带符号多边形面积（x/z 平面）：>0 逆时针，<0 顺时针。 */
export function signedPolygonArea(pts: PolygonPoint[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area / 2;
}

export function ensureCCW(pts: PolygonPoint[]): PolygonPoint[] {
  return signedPolygonArea(pts) < 0 ? [...pts].reverse() : pts;
}

/** 两组折线的边是否严格相交（proper crossing）。共线或端点相接返回 false。 */
export function edgesCross(a: PolygonPoint[], b: PolygonPoint[]): boolean {
  const orient = (p: PolygonPoint, q: PolygonPoint, r: PolygonPoint): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j], b2 = b[(j + 1) % b.length];
      const d1 = orient(a1, a2, b1);
      const d2 = orient(a1, a2, b2);
      const d3 = orient(b1, b2, a1);
      const d4 = orient(b1, b2, a2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** 分离轴 + Sutherland–Hodgman：多边形交叠面积。凸多边形必须作为裁剪多边形。 */
export function polygonConvex(pts: PolygonPoint[]): boolean {
  if (pts.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = pts[(i + 2) % pts.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    const s = cross > 1e-12 ? 1 : cross < -1e-12 ? -1 : 0;
    if (s !== 0) {
      if (sign !== 0 && s !== sign) return false;
      sign = s;
    }
  }
  return true;
}

export function clipPolygon(subject: PolygonPoint[], clip: PolygonPoint[]): PolygonPoint[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const side = (p: PolygonPoint) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const sc = side(current);
      const sp = side(previous);
      if (sc >= 0) {
        if (sp < 0) {
          const t = sp / (sp - sc);
          output.push({ x: previous.x + t * (current.x - previous.x), z: previous.z + t * (current.z - previous.z) });
        }
        output.push(current);
      } else if (sp >= 0) {
        const t = sp / (sp - sc);
        output.push({ x: previous.x + t * (current.x - previous.x), z: previous.z + t * (current.z - previous.z) });
      }
    }
  }
  return output;
}

export function overlapArea(a: PolygonPoint[], b: PolygonPoint[]): { area: number; exact: boolean } {
  // 量价算法审计 D10：Sutherland–Hodgman 的 clip 边必须逆时针（左手边为内侧）。
  // 数据集多边形不保证绕向（kitchen、entry_garden 的 boundary 是顺时针），
  // 顺时针 clip 边会把交集算成补集——整块落在顺时针房间里的无 follow 区域
  // 会被漏报（交集算成 0），或面积算错。clip 前一律归一化为逆时针。
  const aCCW = ensureCCW(a);
  const bCCW = ensureCCW(b);
  if (polygonConvex(bCCW)) return { area: shoelace(clipPolygon(aCCW, bCCW)), exact: true };
  if (polygonConvex(aCCW)) return { area: shoelace(clipPolygon(bCCW, aCCW)), exact: true };
  const inside = (p: PolygonPoint, poly: PolygonPoint[]) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
      if ((zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  // 两个非凸多边形：仅凭顶点在对方内会漏掉「边交叉、顶点全在外」的交叠。
  // 严格相交（proper crossing，不含共线/端点相接——贴边相邻的房间共用
  // 一条边，不得误报）同样算接触，面积记为不可精确计算。
  const touches = a.some((p) => inside(p, b)) || b.some((p) => inside(p, a)) || edgesCross(aCCW, bCCW);
  return { area: touches ? Number.NaN : 0, exact: false };
}
