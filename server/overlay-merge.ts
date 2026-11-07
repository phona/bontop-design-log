/**
 * 合并 CAD 几何与声明式覆盖配置。
 * 铁律：只执行 suppress 和 add 两条机械规则；禁止自动分类启发式。
 * 本文件禁止添加任何基于几何位置/边界/邻接关系的自动分类逻辑。
 *
 * suppress 改判（2026-11-07 issue #98 第三阶段 S3）：suppress 不再是 overlay 顶层清单，
 * 而是墙条目自身的 suppressed 属性（model-geometry.yaml）——这里只按属性过滤，
 * 语义权威实现与 replacement 校验都在 shared/suppression.ts。
 */
import { z } from 'zod';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { isWallSuppressed } from '../shared/suppression.js';
import { deriveSkirtingRegions } from '../shared/skirting-derivation.js';
import type { BaySillSegment, BaySillWallReference, SceneElement, WallSegment, CurtainPoint, WallPaintBand, WallTileBand } from '../shared/types.js';

const PointSchema = z.object({ x: z.number(), z: z.number() }).strict();

const CurtainPointSchema = z
  .object({
    x: z.number(),
    z: z.number(),
    radius: z.number().nonnegative().optional(),
    cx: z.number().optional(),
    cz: z.number().optional(),
  })
  .strict();

/**
 * 玻璃接缝语义（join）：同一围护对象相邻玻璃路径的交接方式——continuous=无缝延续、
 * butt=对接。2026-11-07 issue #98 第三阶段 S3 从 spatial-validation.yaml 的
 * overlay_replacements 镜像表上移为本对象声明（根级或 part 级），由
 * shared/suppression.ts 的 glassJoinSpecs 机械派生 join 规格，
 * shared/spatial-validation.ts 的 deriveRuntimeGlassJoins 消费（几何仍逐对实判）。
 */
const JoinSchema = z.enum(['continuous', 'butt', 'endpoint', 't', 'overlap']);

const CurtainRunPartSchema = z
  .object({
    id: z.string().min(1),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    join: JoinSchema.optional(),
  })
  .strict()
  .refine(d => d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify wall or walls',
  });

const CurtainRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain_run'),
    points: z.array(CurtainPointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    parts: z.array(CurtainRunPartSchema).min(1).optional(),
    height: z.number().positive().default(3.0),
    closed: z.boolean().optional(),
    join: JoinSchema.optional(),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const WallRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('wall_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(3.0),
  })
  .strict();

// 贴砖检视态叠加层（DEC-2026-10-07-R05/R06/R11）：inspection-only，引用已有墙 + along 区间 + 竖向范围。
// wall 必须在 model-geometry 的墙声明中存在且未被 suppress；along 自该墙 from 端累计。
// zone: covered=橱柜后遮蔽面（走杂砖）/ visible=可见面（正砖）。
// room（R11 补）：贴砖面归属房间。共墙两侧各贴各的脸，预算/审计按 (wall, room) 去重；
// height 为贴砖带顶标高（非带高），同一墙可上下堆叠多段、二维不重叠即可。
//
// 2026-11-07 issue #98 第三阶段 S4：wall_region / paint_region / sill_region /
// paint_sill_region / paint_ceiling_region 五个**面层配方**类型已从 overlay schema 删除——
// 它们没有独立身份/状态/生命周期（issue #98 判据），下沉为宿主对象特征：
//   wall_region(18)  → model-geometry.yaml 墙条目 finish.tile_bands[]
//   paint_region(31) → 同上 finish.paint_bands[]
//   sill_region(20)  → openings.yaml bay_sill 条目 finish.tile[]
//   paint_sill_region(8) → 同上 finish.paint[]
//   paint_ceiling_region(8) → model-geometry.yaml 房间条目 ceiling_finish
// schema 15 → 10 类；SceneElement 同步删这五个联合成员，mesh 产出方从 case 分支改为
// 对象属性驱动（检视态 userData.inspectionLayer 与开关原样保留）。schema 如下。
const WallTileBandSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    along: z.tuple([z.number().nonnegative(), z.number().positive()]),
    bottom: z.number().nonnegative().default(0),
    height: z.number().positive(),
    zone: z.enum(['visible', 'covered']).default('visible'),
    color: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const WallPaintBandSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    along: z.tuple([z.number().nonnegative(), z.number().positive()]),
    bottom: z.number().nonnegative().default(0),
    height: z.number().positive().optional(),
    color: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const WallFinishSchema = z
  .object({
    tile_bands: z.array(WallTileBandSchema).default([]),
    paint_bands: z.array(WallPaintBandSchema).default([]),
  })
  .strict();

const SillTileBandSchema = z
  .object({
    id: z.string().min(1),
    face: z.enum(['front', 'top', 'underside']),
    along: z.tuple([z.number().nonnegative(), z.number().positive()]).optional(),
    zone: z.enum(['visible', 'covered']).default('visible'),
    color: z.string().optional(),
    room: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const SillPaintBandSchema = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    faces: z.array(z.enum(['underside', 'front', 'start_end', 'end_end'])).min(1),
    finish: z.enum(['ordinary', 'anti_mold']),
    color: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

const BaySillFinishSchema = z
  .object({
    tile: z.array(SillTileBandSchema).default([]),
    paint: z.array(SillPaintBandSchema).default([]),
  })
  .strict();

// 踢脚线常显条带（DEC-2026-10-28-R02）：与墙特征面层的检视态不同，
// 本类型在正常视图里就可见。height 必填、代码与 schema 均不得给默认值——高度是可调数据。
// S5（2026-11-07）：24 段平级声明已删（finish-surfaces.yaml 随之退场），改由墙特征
// finish.paint_bands[] 派生（shared/skirting-derivation.ts），height/color 取
// config/model/envelope/finish-defaults.yaml 的 skirting 锚点；本 schema 留作**派生产物
// 的校验闸**（派生结果仍过它，height 缺失/非法即显形），SceneElement 联合成员与全部
// 消费方（SceneBuilder/DXF A-SKIRT/HouseScene 审计/碰撞豁免）零改动。
const SkirtingRegionSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('skirting_region'),
    wall: z.string().min(1),
    room: z.string().min(1),
    along: z.tuple([z.number().nonnegative(), z.number().positive()]),
    bottom: z.number().nonnegative().default(0),
    height: z.number().positive(),
    color: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

// 淋浴玻璃隔断（独立玻璃，points-only，无碰撞；2026-08-21）
const ShowerScreenSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('shower_screen'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(2.0),
    sill: z.number().min(0).default(0),
  })
  .strict();

const SlidingDoorRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('sliding_door_run'),
    points: z.array(PointSchema).min(2),
    height: z.number().positive().default(2.1),
    panels: z.number().int().min(2).default(3),
    open: z.boolean().default(true),
  })
  .strict();

const FrostedPrivacySchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('frosted_privacy'),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    points: z.array(CurtainPointSchema).min(2).optional(),
    height: z.number().positive().default(2.8),
    sill: z.number().min(0).default(0),
    // 相对幕墙法向的室内/玻璃侧偏移（米）；正值按墙体内侧解算
    offset: z.number().min(0).max(0.5).default(0.06),
    finish: z.literal('frosted_privacy').default('frosted_privacy'),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const FloorRegionSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('floor_region'),
    points: z.array(CurtainPointSchema).min(3),
    room: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    // DEC-041：过渡带跟随某房间的有效地面选材（无 follow 则跟随 floor default）
    follow: z.string().min(1).optional(),
    // DEC-2026-10-09-P16：**默认计入** floor 算量，标了才排除（opt-out）。
    // 取代 P12 的 costed opt-in——那个手工布尔量重复了几何已知的信息（这块地是不是已被某个
    // 已计费房间算过），同一事实存两处必致双计/漏计。现在「整块落在已计费房间内」由
    // shared/masonry-takeoff.ts 的 floorRegionInsideCostedRoom 按几何处理：普通过渡区跳过，
    // room + follow 内部材质区从宿主面积转入follow材质桶；server/budget-calculator.ts只装配输入。
    // excluded 只留给几何说不清的例外（开发商已铺 / 业主裁定不铺），配 reason 写清为什么。
    excluded: z.boolean().optional(),
  })
  .strict()
  .refine((region) => !region.room || Boolean(region.follow), {
    message: 'floor_region.room marks an internal material zone and must be paired with follow',
  });

const BaySillSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('bay_sill'),
    points: z.array(PointSchema).min(2).optional(),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    depth: z.number().positive(),
    sill: z.number().min(0),
    height: z.number().positive(),
    // 沿墙区间（自 from 端累计）。仅当飘窗/窗带落在**有涂装声明的实体墙**上时才必须写：
    // 涂装范围按实扣窗洞需要它定位；缺了会被 shared/paint-scope.ts 记 warning 而不是静默少扣。
    along: z.tuple([z.number().nonnegative(), z.number().positive()]).optional(),
    // 面层配方（S4 下沉）：sill_region(20)/paint_sill_region(8) 不再是平级元素，
    // 而是构件自己的 finish.tile[] / finish.paint[]——元素间引用 28 → 0。
    finish: BaySillFinishSchema.optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const RailingRunSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('railing_run'),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    height: z.number().positive().default(1.0),
    join: JoinSchema.optional(),
  })
  .strict()
  .refine(d => d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify wall or walls',
  });

// 窗帘（声明式 add，引用墙 id 保持 vertices 联动）：kind 由配置显式指定，非几何推断
const CurtainSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('curtain'),
    wall: z.string().min(1).optional(),
    walls: z.array(z.string().min(1)).min(1).optional(),
    points: z.array(CurtainPointSchema).min(2).optional(),
    room: z.string().min(1).optional(),
    kind: z.enum(['sheer_blackout', 'blinds']).default('sheer_blackout'),
    height: z.number().positive().default(2.8),
    // 室内侧偏移（米）：默认 0.12 布帘位；百叶贴框安装时显式给小值（SceneBuilder.addCurtain 消费）
    offset: z.number().min(0).max(0.5).optional(),
  })
  .strict()
  .refine(d => d.points || d.wall || (d.walls && d.walls.length > 0), {
    message: 'Must specify points, wall, or walls',
  });

const OverlaySchema = z
  .object({
    version: z.literal(1),
    elements: z
      .array(
        z.discriminatedUnion('type', [
          CurtainRunSchema,
          WallRunSchema,
          SkirtingRegionSchema,
          ShowerScreenSchema,
          SlidingDoorRunSchema,
          FrostedPrivacySchema,
          FloorRegionSchema,
          BaySillSchema,
          RailingRunSchema,
          CurtainSchema,
        ])
      )
      .default([]),
  })
  .strict();

export type OverlayConfig = z.infer<typeof OverlaySchema>;

export function parseOverlay(raw: string): OverlayConfig {
  return OverlaySchema.parse(load(raw) ?? {});
}

// ── S1 搬迁（issue #98 第三阶段）：overlay 声明拆为 envelope 文件后的唯一合并点 ──
// 原 config/layout/overlay.yaml 已删，声明现住：
//   openings.yaml       围护构件 40（curtain_run/railing_run 的 join 接缝语义也住这里；
//                       version 随迁此文件；bay_sill 的 finish.tile[]/paint[] 面层配方
//                       也住这里——S4 把 sill_region/paint_sill_region 下沉为构件特征）
//   floor-zones.yaml    floor_region 6（绝对 points 的唯一聚居地）
//   finish-defaults.yaml 面层派生默认值（S5：skirting 的 height/color 锚点；declaration 已无）
// S4 把 wall_region 18 / paint_region 31 / sill_region 20 / paint_sill_region 8 /
// paint_ceiling_region 8 下沉到 model-geometry 的墙/房间与 openings 的 bay_sill；
// S5 删除 finish-surfaces.yaml 最后的 skirting_region 24 段声明，改由墙特征
// finish.paint_bands[] 派生（shared/skirting-derivation.ts），该文件退场。
// suppress 自 2026-11-07 S3 起不住本处：改判为 config/layout/model-geometry.yaml 墙条目的
// suppressed:{reason,replacement} 属性（原 overlay 顶层 8 条 wall/walls/region 选择器 +
// spatial-validation.yaml 的 overlay_replacements 镜像表随之退场），语义唯一权威实现
// shared/suppression.ts。合并必须恢复原 overlay.yaml 的元素物理顺序：GLB/DXF 产物按 elements
// 顺序生成，实测乱序即字节变化（2026-11-07 实验把 floor 6 条移位重导出，GLB SHA 由
// eba3dbda… 变 47087a67…）。原序是「bay_sill 组(25) → floor 6 → curtain/shower 等围护(15)
// → 面层配方(109，其中 skirting 24 是唯一产可见网格的一类)」，S4/S5 后只剩派生的 skirting 24
// 还走元素表，接在原面层配方组的末尾位置（可见网格集合不变：24 段逐一对应原声明，
// tests/server/skirting.test.ts 冻结原声明逐字段断言），因此 floor 6 条仍插在 openings 内
// bay_sill 组末尾锚点之后；锚点找不到即抛错，不许静默串序。
export const OVERLAY_SOURCE_FILES = {
  openings: 'config/model/envelope/openings.yaml',
  floorZones: 'config/model/envelope/floor-zones.yaml',
  finishDefaults: 'config/model/envelope/finish-defaults.yaml',
} as const;

/** 墙特征（finish.paint_bands）的住入：skirting 的派生基数。 */
const SKIRTING_PAINT_BANDS_SOURCE = 'config/layout/model-geometry.yaml';
/** 湿区房间表的住入（房间干湿分类唯一源，design-rules.yaml:111 亦指向它）。 */
const WET_ROOM_IDS_SOURCE = 'config/tile-comparison.yaml';

/**
 * skirting 派生的额外依赖（S5）：踢脚带由 model-geometry.yaml 墙特征 finish.paint_bands[]
 * 派生，湿区判定读 config/tile-comparison.yaml 的 wet_room_ids。加载器必须把这两个文件
 * 纳入监听（server/index.ts 的 overlayLoader）——否则改漆面带/湿区表不会刷新派生结果，
 * 服务端继续吐旧踢脚线（config watch 静默失效的老问题，见 config-loader.ts 头注）。
 */
export const SKIRTING_DERIVATION_SOURCE_FILES = [SKIRTING_PAINT_BANDS_SOURCE, WET_ROOM_IDS_SOURCE] as const;

const OVERLAY_ROOT = path.resolve(import.meta.dirname, '..');
const FLOOR_ZONE_INSERT_AFTER = 'bedroom_se_south_waterproof_ledge';

/**
 * 装配 skirting 派生输入并派生（S5）。fail-closed：finish-defaults 的锚点、湿区房间表、
 * 墙特征任一读不动/不合法都抛错——不静默少生成踢脚线，也不 invent 默认高度。
 */
function loadDerivedSkirtingRegions(): unknown[] {
  const defaultsDoc = load(readFileSync(path.join(OVERLAY_ROOT, OVERLAY_SOURCE_FILES.finishDefaults), 'utf8')) as {
    skirting?: { height?: unknown; color?: unknown };
  } | null;
  const wetDoc = load(readFileSync(path.join(OVERLAY_ROOT, WET_ROOM_IDS_SOURCE), 'utf8')) as {
    wet_room_ids?: unknown;
  } | null;
  const geometryDoc = load(readFileSync(path.join(OVERLAY_ROOT, SKIRTING_PAINT_BANDS_SOURCE), 'utf8')) as {
    walls?: Array<{ id?: string; finish?: { paint_bands?: unknown[] } }>;
  } | null;

  const rawWet = wetDoc?.wet_room_ids;
  if (!Array.isArray(rawWet)) {
    throw new Error(
      'skirting 派生失败：config/tile-comparison.yaml 的 wet_room_ids 缺失或不是数组——'
      + '湿区判定取不到值（房间干湿分类唯一源），不按「全非湿区」放行',
    );
  }
  const wetRoomIds = new Set<string>(rawWet.filter((room): room is string => typeof room === 'string'));

  return deriveSkirtingRegions(
    // 原始 YAML 无类型：收窄由派生器自己的 fail-closed 检查 + 随后 SkirtingRegionSchema
    // 的校验闸共同保证（along 必须是两个有限数且成正区间，否则抛错）。
    (geometryDoc?.walls ?? []) as Parameters<typeof deriveSkirtingRegions>[0],
    {
      height: defaultsDoc?.skirting?.height as number,
      color: defaultsDoc?.skirting?.color as string,
    },
    wetRoomIds,
  );
}

export function loadOverlayDoc(): { version: unknown; elements: unknown[] } {
  const readDoc = (file: string) =>
    (load(readFileSync(path.join(OVERLAY_ROOT, file), 'utf8')) ?? {}) as {
      version?: unknown;
      elements?: unknown[];
    };
  const openings = readDoc(OVERLAY_SOURCE_FILES.openings);
  const floorZones = readDoc(OVERLAY_SOURCE_FILES.floorZones);
  const openingElements = openings.elements ?? [];
  const anchor = openingElements.findIndex(
    (element) => (element as { id?: string })?.id === FLOOR_ZONE_INSERT_AFTER,
  );
  if (anchor < 0) {
    throw new Error(
      `envelope/openings.yaml 找不到锚点元素 ${FLOOR_ZONE_INSERT_AFTER}：floor-zones 的插入位失效，` +
        '合并顺序无法恢复原 overlay.yaml 的元素序（GLB/DXF 产物会变）。请同步更新 FLOOR_ZONE_INSERT_AFTER。',
    );
  }
  return {
    version: openings.version,
    elements: [
      ...openingElements.slice(0, anchor + 1),
      ...(floorZones.elements ?? []),
      ...openingElements.slice(anchor + 1),
      // S5：skirting 24 段由 paint_bands 派生，接在原 finish-surfaces 面层配方组的末尾。
      ...loadDerivedSkirtingRegions(),
    ],
  };
}

export function parseOverlayFiles(): OverlayConfig {
  return OverlaySchema.parse(loadOverlayDoc());
}

/**
 * 砖漆互斥机器规则（2026-11-07 issue #98 第三阶段 S4）。
 *
 * 面层配方下沉前，同一墙脸的「漆面让出砖带」靠 7 处人工手抄 bottom（DEC-2026-10-09-P07：
 * 客卫 5 处 + 主卫 2 处，0.30/0.77/1.10 三档）。下沉后 tile_bands 与 paint_bands 同住一个
 * 墙对象，这条规则可以机器判：**同一 (墙, 房间) 脸上，贴砖带与涂装带沿墙区间相交时，
 * 竖向区间必须不相交**（允许贴面交接：paint.bottom === tile.top）。
 *
 * 为什么是「二维不重叠」而不是单句「paint.bottom ≥ tile 带顶」：客卫开放洗漱区东墙有
 * 「0.30 墙裙砖 / 0.30→0.77 漆 / 0.77→1.10 防溅砖 / 1.10→2.80 漆」四层交替，
 * 单向不等式会被上层砖带判违例——只有二维不重叠才是「一片面只属一种面层」的完整表述。
 *
 * 违反即抛错（fail-closed）：重叠意味着同一片墙既算砖又算漆，预算双计、3D 两层叠加。
 * 调用方是全部装配点（mergeSceneElements / 瓦工算量 / 涂装载入），不是某一处渲染细节。
 */
export function validateWallFinish(
  walls: Array<{ id?: string; finish?: { tile_bands?: WallTileBand[]; paint_bands?: WallPaintBand[] } }>,
): void {
  const EPS = 1e-9;
  for (const wall of walls) {
    const finish = wall.finish;
    if (!finish?.tile_bands?.length || !finish.paint_bands?.length) continue;
    const byFace = new Map<string, { tiles: WallTileBand[]; paints: WallPaintBand[] }>();
    const faceOf = (room: string) => {
      const existing = byFace.get(room);
      if (existing) return existing;
      const created = { tiles: [] as WallTileBand[], paints: [] as WallPaintBand[] };
      byFace.set(room, created);
      return created;
    };
    for (const band of finish.tile_bands) faceOf(band.room).tiles.push(band);
    for (const band of finish.paint_bands) faceOf(band.room).paints.push(band);
    for (const [room, { tiles, paints }] of byFace) {
      for (const tile of tiles) {
        const tileFrom = Math.min(tile.along[0], tile.along[1]);
        const tileTo = Math.max(tile.along[0], tile.along[1]);
        const tileBottom = tile.bottom ?? 0;
        for (const paint of paints) {
          const paintFrom = Math.min(paint.along[0], paint.along[1]);
          const paintTo = Math.max(paint.along[0], paint.along[1]);
          const hOverlap = Math.min(tileTo, paintTo) - Math.max(tileFrom, paintFrom);
          if (hOverlap <= EPS) continue;
          const paintBottom = paint.bottom ?? 0;
          const paintTop = paint.height ?? Number.POSITIVE_INFINITY;
          const paintAbove = paintBottom >= tile.height - EPS;
          const tileAbove = tileBottom >= paintTop - EPS;
          if (paintAbove || tileAbove) continue;
          throw new Error(
            `墙 ${wall.id} 房间 ${room}：贴砖带 ${tile.id}（along [${tileFrom}, ${tileTo}] × [${tileBottom}, ${tile.height}]）`
            + ` 与涂装带 ${paint.id}（along [${paintFrom}, ${paintTo}] × [${paintBottom}, ${paintTop}]）沿墙重叠 ${hOverlap.toFixed(3)}m 且竖向重叠`
            + ` → 同一片墙既贴砖又涂漆（双计）。DEC-2026-10-09-P07 起砖漆互斥改为机器校验：`
            + `让漆带 bottom ≥ 砖带顶，或把砖带移到漆带之上。`,
          );
        }
      }
    }
  }
}

export function mergeSceneElements(
  walls: WallSegment[],
  overlay: OverlayConfig | undefined
): SceneElement[] {
  // Work on copied elements/parts: resolving wall refs adds derived fields and
  // must not mutate the cached parsed overlay between API requests.
  const elements = (overlay?.elements ?? []).map((element) => ({
    ...element,
    ...(element.type === 'curtain_run' && element.parts
      ? { parts: element.parts.map((part) => ({ ...part })) }
      : {}),
  }));

  // 砖漆互斥机器规则（S4）：墙特征面层装载时即校验，违例抛错（见 validateWallFinish）。
  validateWallFinish(walls);

  // suppress 改判（issue #98 S3）：墙条目自带 suppressed 属性，实体盒不渲染；
  // 属性口径与 replacement 校验见 shared/suppression.ts（禁止在这里重写选择器逻辑）。
  const kept: SceneElement[] = [];
  walls.forEach((w, i) => {
    if (!isWallSuppressed(w)) {
      kept.push({ type: 'wall', id: w.id ?? `wall:seg:${i}`, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, ...(w.segments ? { segments: w.segments } : {}), ...(w.openings ? { openings: w.openings } : {}), ...(w.finish ? { finish: w.finish } : {}), ...(w.line_datum ? { line_datum: w.line_datum } : {}), ...(w.rooms?.length ? { rooms: w.rooms } : {}) });
    }
  });

  // Resolve wall refs in elements (only for types that use wall as id reference)
  const resolvedWalls = walls
    .filter((w): w is WallSegment & { id: string; bayRooms?: string[] } => w.id !== undefined)
    .map(w => ({ id: w.id, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, segments: w.segments, fromX: w.fromX, fromZ: w.fromZ, fromRadius: w.fromRadius, arcCenterX: w.arcCenterX, arcCenterZ: w.arcCenterZ, rooms: w.rooms, bayRooms: w.bayRooms }));

  for (const el of elements) {
    if (el.type === 'curtain_run' || el.type === 'bay_sill' || el.type === 'frosted_privacy' || el.type === 'railing_run' || el.type === 'curtain') {
      const elAny = el as Record<string, unknown>;
      const wallRef = elAny.wall ?? elAny.walls;
      if (wallRef) {
        const ids = wallRef as string | string[];
        elAny.points = resolveWallRef(ids, resolvedWalls);
        if (el.type === 'bay_sill') elAny.wallRefs = resolveBaySillWallRefs(ids, resolvedWalls);
      }
      if (el.type === 'curtain_run' && elAny.parts) {
        elAny.parts = (elAny.parts as Array<{ id: string; wall?: string; walls?: string[] }>).map((part) => {
          const partRef = part.wall ?? part.walls;
          const partIds = partRef as string | string[];
          return {
            id: part.id,
            points: resolveWallRef(partIds, resolvedWalls),
            wallRefs: Array.isArray(partIds) ? partIds : [partIds],
          };
        });
      }
    }
  }

  return [...kept, ...elements] as SceneElement[];
}

type WallRefSegment = { x1: number; z1: number; x2: number; z2: number; kind?: 'line' | 'arc'; arcOwner?: string; radius?: number; cx?: number; cz?: number; arcStart?: { x: number; z: number }; arcEnd?: { x: number; z: number } };
type WallRefInput = { id: string; x1: number; z1: number; x2: number; z2: number; segments?: WallRefSegment[]; fromX?: number; fromZ?: number; fromRadius?: number; arcCenterX?: number; arcCenterZ?: number; rooms?: string[]; bayRooms?: string[] };

function ownedSegments(wall: WallRefInput): WallRefSegment[] {
  const source = wall.segments !== undefined ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2, kind: 'line' as const }];
  return source.filter((segment) => Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1) > 1e-9).map((segment) => ({ ...segment }));
}

function resolveBaySillWallRefs(wallIds: string | string[], walls: WallRefInput[]): BaySillWallReference[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  return ids.map((id): BaySillWallReference => {
    const wall = walls.find(candidate => candidate.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    const source = ownedSegments(wall);
    // 弧段始终保留：圆角墙（如 w_mb_south 的 v_sw 弧）是飘窗随墙转弯的依据；
    // 早前对单墙飘窗丢弧导致环幕飘窗在圆角处断开（西南角缺口）。
    const segments = source.map((segment): BaySillSegment => ({ wallId: id, rooms: wall.bayRooms ?? wall.rooms, ...segment }));
    return { wallId: id, rooms: wall.bayRooms ?? wall.rooms, segments };
  });
}

export function resolveWallRef(
  wallIds: string | string[],
  walls: WallRefInput[],
  includeArcs = true,
): CurtainPoint[] {
  const ids = Array.isArray(wallIds) ? wallIds : [wallIds];
  const pts: CurtainPoint[] = [];
  for (const id of ids) {
    const wall = walls.find(w => w.id === id);
    if (!wall) throw new Error(`Unknown wall id: ${id}`);
    if (!includeArcs && wall.fromRadius && wall.fromX !== undefined && wall.fromZ !== undefined) {
      pts.push({ x: wall.fromX, z: wall.fromZ });
      pts.push({ x: wall.x2, z: wall.z2 });
    } else if (wall.fromRadius && wall.fromX !== undefined && wall.fromZ !== undefined && wall.segments?.some(seg => seg.kind === 'arc')) {
      pts.push({ x: wall.x1, z: wall.z1 });
      pts.push({ x: wall.fromX, z: wall.fromZ, radius: wall.fromRadius, cx: wall.arcCenterX, cz: wall.arcCenterZ });
      const arcSegments = wall.segments.filter(seg => seg.kind === 'arc');
      const arcEnd = arcSegments.at(-1)?.arcEnd;
      if (arcEnd) pts.push({ x: arcEnd.x, z: arcEnd.z });
      pts.push({ x: wall.x2, z: wall.z2 });
    } else if (wall.segments && wall.segments.length > 1) {
      for (const seg of wall.segments) {
        pts.push({ x: seg.x1, z: seg.z1 });
        pts.push({ x: seg.x2, z: seg.z2 });
      }
    } else {
      pts.push({ x: wall.x1, z: wall.z1 });
      pts.push({ x: wall.x2, z: wall.z2 });
    }
  }
  const merged: CurtainPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = pts[i];
    if (Math.abs(prev.x - curr.x) < 0.001 && Math.abs(prev.z - curr.z) < 0.001) {
      if (curr.radius !== undefined && prev.radius === undefined) {
        merged[merged.length - 1] = curr;
      }
      continue;
    }
    merged.push(curr);
  }

  return merged;
}
