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
