/**
 * 踢脚线派生（issue #98 第三阶段 S5，2026-11-07）。
 *
 * 背景：skirting_region 曾是 overlay 的 24 段平级声明（约 170 行 YAML + 两个锚点）。
 * 取证（迁移设计 §6.1）：对全部 paint × skirting 按 (wall, room, along[0], along[1])
 * 四元组配对，24/24 命中；未配踢脚的 7 条漆面段正是 guest_bath 5 + master_bath 2——
 * 与 DEC-2026-10-28-R01「两卫墙脚贴砖到地/0.30m 砖带，不重复贴踢脚」一致。即踢脚带
 * **没有独立身份/状态/生命周期**，是漆面墙脚的派生几何：删声明，改由墙特征
 * finish.paint_bands[] 派生，height/color 取 config/model/envelope/finish-defaults.yaml
 * 的 skirting 锚点。派生结果与原 24 段声明逐字段相等（tests/server/skirting.test.ts
 * 把原声明冻结为基线断言，防规则漂移）。
 *
 * 规则（权威表述，迁移设计 §5.2-skirting 行）：
 *   非湿区房间的 paint_band → 生成一条踢脚带（height/color 取锚点）；
 *   湿区房间的 paint_band → 不生成（墙脚已被砖覆盖，不重复贴）。
 * 湿区判定读 config/tile-comparison.yaml 的 wet_room_ids（房间干湿分类唯一源，
 * design-rules.yaml:111 亦指向该表）——本模块不另列房间表，由调用方把表传进来。
 *
 * 纯函数、无 I/O：装配（读 defaults / wet 表 / 墙特征）在 server/overlay-merge.ts。
 */

import type { WallPaintBand } from './types.js';

/** 派生用的墙最小视图：只要 id 与涂漆带（面层配方下沉后它们住在 model-geometry.yaml）。 */
export interface SkirtingDerivationWall {
  id?: string;
  finish?: { paint_bands?: WallPaintBand[] };
}

/** 踢脚带默认值（config/model/envelope/finish-defaults.yaml 的 skirting 段）。 */
export interface SkirtingDefaults {
  /** 踢脚带高度（米）。必须显式给出：代码与 schema 均无默认值，取不到即抛错。 */
  height: number;
  /** 踢脚带颜色（十六进制串，如 '#e5e2db'）。 */
  color: string;
}

/** 派生产物：与原 skirting_region 声明同构（SceneElement 联合成员之一，消费方零改动）。 */
export interface DerivedSkirtingRegion {
  id: string;
  type: 'skirting_region';
  wall: string;
  room: string;
  along: [number, number];
  bottom: number;
  height: number;
  color: string;
  reason: string;
}

/**
 * 由墙特征涂漆带派生踢脚带。
 *
 * 顺序 = 传入墙序 × 各墙 paint_bands 序（model-geometry 声明序）——DXF/GLB 的
 * A-SKIRT 实体按此序出；集合与原 24 段声明一一对应（零丢零增），顺序随面层配方
 * 下沉改「按墙归组」（与 S4 起 A-WFIN-TILE/A-WFIN-PAINT 同口径）。
 *
 * fail-closed：默认值缺失/非法、沿墙区间非法、派生 id 撞车，一律抛错——不静默跳过、
 * 不 invent 默认高度（旧声明时代码同款：高度是可调数据，只能来自声明/锚点）。
 */
export function deriveSkirtingRegions(
  walls: SkirtingDerivationWall[],
  defaults: SkirtingDefaults,
  wetRoomIds: ReadonlySet<string>,
): DerivedSkirtingRegion[] {
  if (!(typeof defaults.height === 'number' && Number.isFinite(defaults.height) && defaults.height > 0)) {
    throw new Error(
      `skirting 派生失败：finish-defaults.yaml 的 skirting.height 缺失或非法（${String(defaults.height)}）——`
      + '高度是可调数据，代码无默认值，请补声明（现值口径 0.08m，DEC-2026-10-28-R01）',
    );
  }
  if (typeof defaults.color !== 'string' || defaults.color.length === 0) {
    throw new Error(
      `skirting 派生失败：finish-defaults.yaml 的 skirting.color 缺失或非法（${String(defaults.color)}）`,
    );
  }

  const derived: DerivedSkirtingRegion[] = [];
  const seen = new Set<string>();
  for (const wall of walls) {
    const bands = wall.finish?.paint_bands ?? [];
    if (bands.length === 0) continue;
    if (!wall.id) {
      throw new Error('skirting 派生失败：带 finish.paint_bands 的墙条目缺 id——派生 id 与墙引用都无处安放');
    }
    for (const band of bands) {
      // 湿区（两卫）：墙脚贴砖到地/0.30m 砖带，不重复贴踢脚（DEC-2026-10-28-R01）。
      if (wetRoomIds.has(band.room)) continue;
      const along = band.along;
      if (!Array.isArray(along) || along.length !== 2 || !along.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`skirting 派生失败：漆面带 ${band.id} 的 along 缺失或不是两个有限数（${JSON.stringify(along)}）`);
      }
      const id = skirtingIdFor(band.id);
      if (seen.has(id)) {
        throw new Error(`skirting 派生失败：派生 id ${id} 撞车（来自 ${band.id}）——漆面带 id 前缀映射不唯一`);
      }
      seen.add(id);
      const from = Math.min(along[0], along[1]);
      const to = Math.max(along[0], along[1]);
      if (!(to > from)) {
        throw new Error(`skirting 派生失败：漆面带 ${band.id} 的 along [${along}] 不是正区间`);
      }
      derived.push({
        id,
        type: 'skirting_region',
        wall: wall.id,
        room: band.room,
        along: [along[0], along[1]],
        bottom: 0,
        height: defaults.height,
        color: defaults.color,
        reason: `踢脚线常显条带，跟随 ${band.id} 的漆面墙脚（DEC-2026-10-28-R02）；height/color 取 finish-defaults.yaml 的 skirting 锚点，湿区不生成（S5 派生，原 24 段声明已删）`,
      });
    }
  }
  return derived;
}

/**
 * 漆面带 id → 踢脚带 id：`paint_<room>_<wall>` → `skirt_<room>_<wall>`（沿用原声明 id，
 * DXF 标注、HouseScene 审计面与 SCH-135-01 卡点都认它）。非 `paint_` 前缀的 id 加
 * `skirt_` 前缀兜底，保证不与漆面带 id 混用。
 */
export function skirtingIdFor(paintBandId: string): string {
  return paintBandId.startsWith('paint_') ? `skirt_${paintBandId.slice('paint_'.length)}` : `skirt_${paintBandId}`;
}
