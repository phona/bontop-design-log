import { CEILING_SOURCE } from './envelope-sources.js';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { lintHvacAccessOffsets, HvacTerminalWithOffset, HvacAnchorWithSchematicOnly, HvacAnchorWithServesUnit } from './hvac-terminal-lint.js';
import {
  VALID_CEILING_TYPES,
  type CeilingZone,
  type ElectricalPoint,
  type ElectricalTopology,
  type PlumbingPoint,
  type ProjectHvacFacts,
  type ProjectRenderFacts,
  type ProjectRenderFactsProjection,
  type RenderLightingOverride,
  type LightingRenderConfig,
} from './types.js';
import { CEILING_PRICING_FORMS, CEILING_TRADE_CLASSES } from './ceiling-takeoff.js';

const finiteNumber = z.number().refine(Number.isFinite, 'must be finite');
const nonEmpty = z.string().trim().min(1);
const WallSideSchema = z.enum(['north', 'south', 'east', 'west']);

/**
 * 构件工程状态词（issue #98 S2-A「状态上对象」）：三类构件**只有一个**状态字段 `status`。
 * 词汇与 `config/state-model.yaml` 的 `status_vocabulary` 逐键对齐——在既有
 * measured/likely/inferred/pending 之上补 confirmed（有成交/裁定依据的确认）与
 * undeclared（显形申报未申报）。electrical 曾经的第二个状态字段 `position_status` 已退场
 * （仅保留给 mep-takeoff 的算量延期判定，见 ElectricalPointSchema 内注）。
 */
const ComponentStatusSchema = z.enum(['measured', 'likely', 'inferred', 'pending', 'confirmed', 'undeclared']);

/**
 * 构件自带的未决声明（blocker，issue #98 S2-A）：`status ∈ {pending, undeclared}` 时必填。
 *
 * 四个字段回答决策铁律第 2 条的三问（谁负责 / 什么事件解锁 / 为何卡 + 什么条件下反转）。
 * 完整性规则（pending/undeclared 必须带 blocker、blocker 四字段非空、kind/owner 落枚举）
 * 不住 schema 而住 `shared/element-blockers.ts` 的门禁与测试——schema 只管结构与枚举，
 * 跨对象的存在性断言要有配置全集才能判（与 HVAC serves_unit 校验同分层）。
 */
export const BlockerKindSchema = z.enum([
  'site_measurement',
  'pending_selection',
  'pending_vendor_drawing',
  'pending_adjudication',
  'unclosed_conflict',
]);
export const BlockerOwnerSchema = z.enum([
  '业主', '设计', '量房', '厂家', '商家', '电工', '柜商', '运营商', '物业', '燃气公司',
]);
export const ComponentBlockerSchema = z.object({
  kind: BlockerKindSchema,
  owner: z.array(BlockerOwnerSchema).min(1),
  trigger: nonEmpty,
  reverses_if: nonEmpty,
  rationale: nonEmpty,
}).strict();
const Vec3Schema = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }).strict();
const FurnitureFaceMountAnchorProjectionSchema = z.object({
  kind: z.literal('furniture_face'),
  furnitureId: nonEmpty,
  face: WallSideSchema,
  surfaceGap: finiteNumber.nonnegative().optional(),
}).strict();
const ElectricalFixtureAppearanceSchema = z.object({
  style: z.literal('warm_white_matte_modular'),
  module: z.enum(['five_hole_replaceable_usb_c', 'two_way_rocker']),
  faceplate_width: finiteNumber.positive(),
  faceplate_height: finiteNumber.positive(),
  projection: finiteNumber.positive(),
  panel_group: z.object({
    id: nonEmpty,
    role: z.enum(['north', 'south']),
    center_spacing: finiteNumber.positive(),
    union_width: finiteNumber.positive(),
  }).strict().optional(),
}).strict();

/**
 * 点位定位声明（issue #98 第四阶段 S1/S2/S3，设计文档 §4.3）：四种互斥定位来源之一——
 * `wall + along`（沿墙）/ `mount`（家具挂载，S2 起为真定位来源）/ `anchor`（锚点引用）/
 * `absolute`（绝对坐标）。x/z 从必填改为**条件必填**：S1/S2 迁移期它俩是断言字段
 * （解析结果与声明值差 >0.005m 即 fail，tests/server/point-placement.test.ts），
 * S3（2026-11-07）79 个沿墙点位 + 2 个柜面挂载点位的 x/z 已删——沿墙/挂载点位的平面
 * 位置只由 wall+along / mount 解算（shared/point-placement.ts），绝对点位（C/D/E/F 组：
 * 顶面灯位/建筑服务基准/地面排水/器具邻接点）保留声明 x/z。解算实现见
 * shared/point-placement.ts。
 *
 * S2 变更：mount_anchor（身份注记 + 手写 x/z 人工同步的旧机制）已废，由 mount
 * （furniture_id + face + along + surface_gap + face_offset）承担定位——宿主移动时点位
 * 自动跟随。原 mount_anchor 的 kind 字段（唯一合法值 furniture_face）由解析投影自动补上。
 *
 * S3 变更：点位侧 `circuit` 字段退役——回路成员关系只住 electrical-topology.yaml 的
 * member_point_ids，点位 → 回路的读一律走 shared/point-circuits.ts 的单一派生
 * （lint / mep-takeoff / DXF 标注 / 派生文档同源）。
 */
const PointWallAnchorSchema = z.object({
  wall: nonEmpty,
  wall_side: WallSideSchema,
  along: finiteNumber.nonnegative(),
  /** 离开完成面的附加量（米，带符号；默认 0 = 完成面，口径 A WALL_THICKNESS/2 解算）。 */
  face_offset: finiteNumber.optional(),
}).strict();
const PointMountSchema = z.object({
  furniture_id: nonEmpty,
  face: WallSideSchema,
  /** 沿宿主脸的位置（米）：东西脸自 minZ 向北累计、南北脸自 minX 向东累计。 */
  along: finiteNumber.nonnegative(),
  /** 离宿主脸平面的附加量（米，带符号；默认 0 = 贴脸）。灯体半厚 + surface_gap 由渲染管线追加。 */
  face_offset: finiteNumber.optional(),
  /** 安装缝（米）；缺声明取渲染管线同款默认 0.003。 */
  surface_gap: finiteNumber.nonnegative().optional(),
}).strict();
const PointAnchorSchema = z.object({
  source: nonEmpty,
  id: nonEmpty,
  /** 世界轴偏移（米）：相对宿主中心（issue #98 二阶段 S1，例：沙发相对电视 +3.58/−0.30）。 */
  offset: z.object({ x: finiteNumber, z: finiteNumber }).strict().optional(),
}).strict();

/**
 * 定位来源唯一性 + x/z 条件必填。沿墙点位必须 wall+wall_side+along 齐备（x/z 删除后
 * wall_side 无从从坐标反推）；绝对点位必须 x/z 齐备；mount 点位必须 along（沿脸位置）。
 * 违反即拒绝加载——定位声明不允许同时住两个事实源。
 *
 * issue #98 第五阶段 S1（E2）：wall / mount 来源**禁止同时声明 x/z**。 resolver 对这两个
 * 分支本就忽略 x/z（`resolvePointPlacement` 只读 wall+along / mount.along），带着 x/z 的
 * 沿墙点位是一颗哑弹：任何「直读声明坐标」的消费者（探针 P1：sock_child_ac 加过期
 * x/z=(5.0,4.3) 后 MEP 端点与解算器分叉）都会读到 stale 值，而 schema 与 resolver 都不报。
 * 现 config 0 条违规（B §② 实跑 locatedPointsWithXz=[]）；禁它是为了「禁止回填 x/z」
 * （设计文档 §4.2 电气/给排水点位行）有机器执法，而不是只靠人口头纪律。
 */function refinePointPlacement<T extends { id?: string; type?: string; x?: number; z?: number; wall?: string; wall_side?: unknown; along?: number; face_offset?: number; mount?: unknown; anchor?: { source?: string; id?: string; offset?: unknown } | unknown; absolute?: boolean }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  const sources = [
    // wall_side 单独出现不算定位来源（无宿主墙定不了位）：只有 wall / along 触发沿墙分支
    value.wall !== undefined || value.along !== undefined ? 'wall' : undefined,
    value.mount !== undefined ? 'mount' : undefined,
    value.anchor !== undefined ? 'anchor' : undefined,
    value.absolute === true ? 'absolute' : undefined,
  ].filter((source): source is string => source !== undefined);
  if (sources.length > 1) {
    ctx.addIssue({ code: 'custom', message: `点位定位来源必须唯一，不得同时声明：${sources.join(' + ')}（wall+along / mount / anchor / absolute 四者之一）` });
    return;
  }
  if (sources.length === 0) {
    ctx.addIssue({ code: 'custom', message: '点位必须声明定位来源之一：wall+along / mount / anchor / absolute（x/z 是迁移期断言字段，不是定位来源）' });
    return;
  }
  if (sources[0] === 'wall' && (value.wall === undefined || value.wall_side === undefined || value.along === undefined)) {
    ctx.addIssue({ code: 'custom', message: '沿墙定位要求 wall + wall_side + along 齐备' });
  }
  if (sources[0] === 'mount') {
    const mount = value.mount as { along?: number } | undefined;
    if (mount?.along === undefined) {
      ctx.addIssue({ code: 'custom', message: 'mount 定位要求 along（沿宿主脸的位置）' });
    }
  }
  if (sources[0] === 'absolute' && (value.x === undefined || value.z === undefined)) {
    ctx.addIssue({ code: 'custom', message: '绝对定位（absolute）要求 x 与 z 齐备' });
  }
  // wall / mount / anchor 来源禁带 x/z（issue #98 S1，E2；anchor 由二阶段 S1 补入）：
  // resolver 忽略它们，直读消费者会读到 stale 值（探针 P1 的失效模式）。x/z 只对
  // absolute 来源是定位字段，对 wall/mount/anchor 是哑弹。
  if ((sources[0] === 'wall' || sources[0] === 'mount' || sources[0] === 'anchor') && (value.x !== undefined || value.z !== undefined)) {
    ctx.addIssue({ code: 'custom', message: `${sources[0]} 定位来源禁止同时声明 x/z（解算器只读 wall+along / mount.along / anchor 宿主坐标；声明 x/z 会成为 stale 第二事实源，探针 P1）` });
  }
  // 夜灯 + furniture anchor 不支持（issue #98 二阶段 S1 收口）：anchor: {source: furniture}
  // 只表示相对位置，不提供安装朝向；夜灯渲染（NightLightGeometry）必需 wallSide 或
  // furniture_face mountAnchor。夜灯必须用 wall（沿墙）或 mount（家具面挂载）定位。
  if (value.type === 'night_light' && (value.anchor as { source?: string } | undefined)?.source === 'furniture') {
    ctx.addIssue({ code: 'custom', message: `夜灯 ${value.id ?? '(未命名)'} 不支持仅凭 furniture anchor 定位：anchor: {source: furniture} 只表示相对位置，不提供安装朝向；请改用 wall（沿墙）或 mount（家具面挂载）定位` });
  }
}

export const ElectricalPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['socket', 'switch', 'switch_2way', 'network', 'usb', 'floor_socket', 'strong_panel', 'weak_panel', 'ac_controller', 'ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light', 'night_light']),
  x: finiteNumber.optional(), z: finiteNumber.optional(), wall: z.string().optional(), wall_side: WallSideSchema.optional(),
  along: finiteNumber.nonnegative().optional(), face_offset: finiteNumber.optional(),
  mount: PointMountSchema.optional(), anchor: PointAnchorSchema.optional(), absolute: z.boolean().optional(),
  /** 宿主意图标注（F 组器具邻接点）：只作文档与校验输入，不参与解算。 */
  host_intent: nonEmpty.optional(),
  // 2026-11-07 issue #98 S3：点位侧 circuit 字段退役（成员关系只住 electrical-topology.yaml 的
  // member_point_ids，读一律走 shared/point-circuits.ts 单一派生）。
  temp: finiteNumber.optional(), count: finiteNumber.optional(), heads: z.number().int().positive().optional(), recessed: z.boolean().optional(), width: finiteNumber.optional(), depth: finiteNumber.optional(), mount_height: finiteNumber.optional(), body_height: finiteNumber.optional(), appearance: ElectricalFixtureAppearanceSchema.optional(), note: z.string().optional(), height: finiteNumber.optional(), status: ComponentStatusSchema.optional(),
  // 位置精度（2026-11-08 S2-A 起**不是**构件状态字段，构件状态唯一来源是上面的 `status`）。
  // 只剩一个消费者：shared/mep-takeoff.ts 的算量延期判定（status 与 position_status 均 pending
  // = 点位尚未具备可报价/施工的稳定归属）。当前仅 sock_child_ac / sock_kitchen_oven 两个预留
  // 占位点声明它；其余点位的「位置待核」已由 status: pending + blocker.kind: site_measurement 承载。
  position_status: z.enum(['measured', 'likely', 'inferred', 'pending']).optional(),
  blocker: ComponentBlockerSchema.optional(),
  serviceability_status: z.enum(['usable', 'blocked', 'superseded']).optional(), neutral: z.boolean().optional(),
}).strict().superRefine(refinePointPlacement);
export const PlumbingPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['faucet', 'toilet', 'shower', 'drain', 'washer', 'faucet_outdoor', 'leb', 'drain_riser', 'gas_meter', 'duct', 'water_supply', 'water_heater']),
  x: finiteNumber.optional(), z: finiteNumber.optional(), wall: z.string().optional(), wall_side: WallSideSchema.optional(),
  along: finiteNumber.nonnegative().optional(), face_offset: finiteNumber.optional(),
  mount: PointMountSchema.optional(), anchor: PointAnchorSchema.optional(), absolute: z.boolean().optional(),
  host_intent: nonEmpty.optional(),
  note: z.string().optional(), height: finiteNumber.optional(),
  // 构件状态唯一字段（issue #98 S2-A）：给排水从来没有第二个状态字段，词汇与电气对齐。
  status: ComponentStatusSchema.optional(),
  blocker: ComponentBlockerSchema.optional(),
  construction_status: z.enum(['confirmed', 'inferred', 'pending']).optional(),
  uncertainty_m: finiteNumber.positive().optional(),
  not_for_construction: z.boolean().optional(),
  diameter: finiteNumber.positive().optional(),
  // 算量分桶字段（shared/mep-takeoff.ts 读取）。strict schema：错字/漏声明都在这里显形，
  // 不允许从 note 文字反推冷热与管径（AGENTS.md「禁止推断」）。
  water_temp: z.enum(['hot', 'cold', 'mixed']).optional(),
  water_dn: z.union([z.literal(20), z.literal(25), z.literal(32)]).optional(),
  drain_dn: z.union([z.literal(50), z.literal(75), z.literal(110)]).optional(),
}).strict().superRefine(refinePointPlacement);
export const CeilingZoneSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(VALID_CEILING_TYPES), thickness: finiteNumber.optional(),
  area: z.tuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber]).optional(), corner_radius: finiteNumber.nonnegative().optional(),
  // Zod 4 records with enum keys are exhaustive and no longer expose `.partial()`.
  // Use a partial strict object to keep corner keys optional while rejecting typos.
  corner_radii: z.object({
    nw: finiteNumber.nonnegative().optional(),
    ne: finiteNumber.nonnegative().optional(),
    se: finiteNumber.nonnegative().optional(),
    sw: finiteNumber.nonnegative().optional(),
  }).strict().optional(),
  concave_fillets: z.object({
    nw: finiteNumber.positive().optional(),
    ne: finiteNumber.positive().optional(),
    se: finiteNumber.positive().optional(),
    sw: finiteNumber.positive().optional(),
  }).strict().optional(),
  // 镜像凹弧的开口象限（DEC-2026-10-08-R05）：键为角 nw/ne/se/sw，值为该凹弧填补的开口
  // 象限（必须等于镜像弧心象限 sw→nw/se→sw/ne→se/nw→ne）。用于跨分区拐肘——门头盒 SE 凹弧
  // 填西南开口、与门厅吊顶西缘相切；默认（不声明）方向会扎进邻区体量。
  concave_fillets_open: z.object({
    nw: z.enum(['nw', 'ne', 'se', 'sw']).optional(),
    ne: z.enum(['nw', 'ne', 'se', 'sw']).optional(),
    se: z.enum(['nw', 'ne', 'se', 'sw']).optional(),
    sw: z.enum(['nw', 'ne', 'se', 'sw']).optional(),
  }).strict().optional(),
  // 立面凹弧（米）：键为边 north/east/south/west，沿该边立面与房间平顶 2.80 的交线加
  // 四分之一圆弧过渡；半径即弧半径（DEC-2026-10-08-R01）。
  cove_fillets: z.object({
    north: finiteNumber.positive().optional(),
    east: finiteNumber.positive().optional(),
    south: finiteNumber.positive().optional(),
    west: finiteNumber.positive().optional(),
  }).strict().optional(),
  buckle_panel: z.object({ module: finiteNumber, seam_width: finiteNumber.optional(), seam_color: z.string().optional() }).strict().optional(),
  // 工艺/计价类别（算量与高亮口径）。strict schema：错字直接在这里报错，不进算量。
  trade: z.enum(CEILING_TRADE_CLASSES).optional(),
  pricing_form: z.enum(CEILING_PRICING_FORMS).optional(),
  inspection_layer: z.string().trim().min(1).optional(), inspection_opacity: finiteNumber.min(0).max(1).optional(), x: finiteNumber.optional(), z: finiteNumber.optional(), height: finiteNumber.optional(), model: z.string().optional(), power_point: z.string().optional(), note: z.string().optional(),
  // 分区显式工程状态（issue #98 S1-B 补录通道；S2-A 起词汇与电气/给排水同源 ComponentStatus，
  // 新增 confirmed / undeclared 两词）。与电气/给排水 status 同词汇表、同为可选。
  // 加法式——不写即未申报，既有分区零变化；被 hvac anchor 引用的分区（ac_*）不读本字段。
  status: ComponentStatusSchema.optional(),
  blocker: ComponentBlockerSchema.optional(),
}).strict();

export const VrfOutdoorUnitSchema = z.object({
  id: nonEmpty, platform: nonEmpty, x: finiteNumber, z: finiteNumber, direction: nonEmpty, width: finiteNumber, depth: finiteNumber, height: finiteNumber, model: nonEmpty, note: z.string().optional(),
}).strict();
const HvacStatusSchema = z.enum(['confirmed', 'inferred', 'pending']);
const HvacSystemSchema = z.enum(['refrigerant', 'power', 'condensate', 'supply_air', 'return_air', 'access', 'decorative']);
/**
 * HVAC 图节点的未决依据：`reason`（散文）与 `blocker`（结构化）**二选一**，不许并存——
 * 同一节点的「为什么卡」住两处就是第二份真相。S2-A 前只有 reason；blocker 是给需要
 * owner/trigger/反转条件的节点准备的结构化载体（kind/owner 枚举与三类构件同源）。
 *
 * 错误文案保持 `require reason`：存量测试（tests/server/vrf-config.test.ts）钉的是这条，
 * 且「两个都没有」确实是 reason 缺失——blocker 是替代载体，不是并列的第三个选项。
 */
const reasonForUnconfirmed = <T extends z.ZodType<{ status: string; reason?: string; blocker?: unknown }>>(schema: T) => schema.superRefine((value, ctx) => {
  if (value.status === 'confirmed') return;
  if (!value.reason?.trim() && !value.blocker) {
    ctx.addIssue({ code: 'custom', message: `${value.status} HVAC facts require reason`, path: ['reason'] });
  }
  if (value.reason?.trim() && value.blocker) {
    ctx.addIssue({ code: 'custom', message: `HVAC facts require exactly one of reason or blocker（${value.status} 节点不得同时声明两者）`, path: ['blocker'] });
  }
});
export const HvacAnchorSchema = reasonForUnconfirmed(z.object({
  id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema,
  // ref.source 的合法值 = 源名（issue #98 第三阶段 S6：不再手抄 'ceiling' 字面量——
  // S1 搬迁后 `config/ceiling.yaml` 这个路径从全仓消失，源名不变，单一真相在
  // shared/envelope-sources.ts 的来源注册表；outdoor/electrical 是非 envelope 源）。
  ref: z.object({ source: z.enum(['outdoor', CEILING_SOURCE, 'electrical']), id: nonEmpty }).strict().optional(),
  position: Vec3Schema.optional(), reason: z.string().optional(),
  // 未决的结构化声明（issue #98 S2-A，与 reason 二选一）：kind/owner/trigger/reverses_if/rationale。
  blocker: ComponentBlockerSchema.optional(),
  // 示意图层标注（issue #98 S2，业主裁定四 2026-11-08）：branch_master/study/parent/child 是
  // 与 MEP 冷媒折线并行表达的示意锚点（离 MEP 折线 0.000–0.364m，MEP 不引用它们，phase5-survey
  // §1.4-C2 按 A 轨细分）——true = 「示意、不参与几何/不放线」，消费方与读者不得把它们当
  // MEP 节点的真副本对账（§6.3-6 的完整定性未裁，位置一个不动）。branch_dining 不打此标
  // （它自称沿用 MEP 节点，走裁定三的对齐路径）。
  schematic_only: z.boolean().optional(),
  /**
   * 取电锚点服务的内机 ceiling id（如 ac_living）。issue #98 第五阶段 S3：取代
   * 「power_living ↔ ac_living」按 id 房间名的隐式映射（phase5-survey §3-2），成为
   * 「哪个插座供哪台内机」的显式声明腿。schema 层只管结构（仅限 system=power）；
   * 存在性校验（ceiling 里须有该 ac_indoor）住 validateProjectHvacFacts，三方配对断言
   * （ref ↔ serves_unit ↔ host_intent ↔ route 终点）住 shared/hvac-terminal-lint.ts 的
   * lintHvacPowerPairing（测试级，同 S2 E8 节奏）。与 terminal 侧 serves_unit（access
   * 检修口宿主）同名不同物：那是 terminal → ceiling 的宿主声明，这是 power anchor →
   * ceiling 的服务对象声明。
   */
  serves_unit: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.ref) === Boolean(value.position)) ctx.addIssue({ code: 'custom', message: 'HVAC anchor requires exactly one of ref or position' });
  if (value.schematic_only === true) {
    if (value.status !== 'inferred') ctx.addIssue({ code: 'custom', message: `schematic_only 锚点只能是 inferred 态（示意锚点不是已确认事实），${value.id} 是 ${value.status}`, path: ['status'] });
    if (!value.reason?.trim()) ctx.addIssue({ code: 'custom', message: `schematic_only 锚点必须带 reason（示意依据），${value.id}`, path: ['reason'] });
  }
  if (value.serves_unit !== undefined && value.system !== 'power') {
    ctx.addIssue({ code: 'custom', message: `serves_unit 仅限 system=power 的取电锚点使用，${value.id} 是 ${value.system}`, path: ['system'] });
  }
}));
export const HvacTerminalSchema = z.object({
  id: nonEmpty,
  status: HvacStatusSchema,
  system: HvacSystemSchema,
  position: Vec3Schema,
  reason: z.string().optional(),
  // 未决的结构化声明（issue #98 S2-A，与 reason 二选一）：kind/owner/trigger/reverses_if/rationale。
  blocker: ComponentBlockerSchema.optional(),
  kind: z.enum(['terminal', 'condensate_drain_candidate', 'decorative_louver']).optional(),
  confirmed: z.boolean().optional(),
  render_interior: z.boolean().optional(),
  render_coordination: z.boolean().optional(),
  mount_face: z.enum(['north', 'south', 'east', 'west', 'bottom']).optional(),
  length: z.number().positive().optional(),
  finish: z.enum(['matte_white', 'matte_black']).optional(),
  render_style: z.enum(['linear_slot', 'panel']).optional(),
  grille_height: z.number().positive().optional(),
  /** 检修口服务的内机 ceiling id（如 ac_dining）；仅 system=access 的终端使用，DEC-2026-10-27-R03。 */
  serves_unit: z.string().optional(),
  /**
   * 检修口相对宿主机位的结构化偏移（米，带符号；= position − serves_unit 宿主 x/z）。
   * issue #98 S2，业主裁定一（2026-11-08）：「宿主+偏移」关系从 reason 散文提为机器可校验
   * 声明，但**坐标真值仍只有 position 一份**（风口位 = 内机的事实不动）；恒等断言由
   * validateProjectHvacFacts + shared/hvac-terminal-lint.ts lintHvacAccessOffsets 执法
   * （容差 0.005m）。schema 层只管结构（offset ⟹ access 且与 serves_unit 成对）；
   * 「access 必须声明 offset」的完整性规则与 serves_unit 存在性校验同住 validate 层
   * （断言需要 ceiling 宿主坐标，schema 只有 id 字符串，两层各管半边）。
   */
  offset: z.object({ x: finiteNumber, z: finiteNumber }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status !== 'confirmed' && !value.reason?.trim()) {
    ctx.addIssue({ code: 'custom', message: `${value.status} HVAC facts require reason`, path: ['reason'] });
  }
  if (value.system === 'access' && value.serves_unit === undefined) {
    ctx.addIssue({ code: 'custom', message: `access 检修口 ${value.id} 必须声明 serves_unit（宿主内机 ceiling id）`, path: ['serves_unit'] });
  }
  if (value.offset !== undefined) {
    if (value.system !== 'access') ctx.addIssue({ code: 'custom', message: `offset 仅限 system=access 的检修口使用，${value.id} 是 ${value.system}`, path: ['system'] });
    if (value.serves_unit === undefined) ctx.addIssue({ code: 'custom', message: `offset 必须与 serves_unit（宿主内机 ceiling id）成对声明，${value.id}`, path: ['serves_unit'] });
  }
  if (value.kind === 'decorative_louver') {
    if (value.system !== 'decorative') ctx.addIssue({ code: 'custom', message: 'decorative louver must use decorative system', path: ['system'] });
    if (value.confirmed !== false) ctx.addIssue({ code: 'custom', message: 'decorative louver must set confirmed=false', path: ['confirmed'] });
    if (value.render_interior !== true) ctx.addIssue({ code: 'custom', message: 'decorative louver must set render_interior=true', path: ['render_interior'] });
    if (value.render_coordination !== false) ctx.addIssue({ code: 'custom', message: 'decorative louver must set render_coordination=false', path: ['render_coordination'] });
  }
  if (value.kind === 'condensate_drain_candidate') {
    if (value.system !== 'condensate') ctx.addIssue({ code: 'custom', message: 'condensate drain candidate must use condensate system', path: ['system'] });
    if (value.status !== 'pending') ctx.addIssue({ code: 'custom', message: 'condensate drain candidate must be pending', path: ['status'] });
    if (value.confirmed !== false) ctx.addIssue({ code: 'custom', message: 'condensate drain candidate must have confirmed=false', path: ['confirmed'] });
    if (value.render_interior !== false) ctx.addIssue({ code: 'custom', message: 'condensate drain candidate must have render_interior=false', path: ['render_interior'] });
    if (value.render_coordination !== true) ctx.addIssue({ code: 'custom', message: 'condensate drain candidate must have render_coordination=true', path: ['render_coordination'] });
    if (!value.reason?.trim()) ctx.addIssue({ code: 'custom', message: 'condensate drain candidate requires reason', path: ['reason'] });
  }
});
export const HvacReferenceConstraintSchema = z.object({
  id: nonEmpty,
  status: z.enum(['inferred', 'pending']),
  source: z.literal('survey/neighbor_ys01_original_structure_2025-06.png'),
  uncertainty_m: z.literal(0.15),
  not_for_construction: z.literal(true),
  range: z.object({ x1: finiteNumber, x2: finiteNumber, z1: finiteNumber, z2: finiteNumber }).strict().superRefine((value, ctx) => {
    if (value.x1 >= value.x2) ctx.addIssue({ code: 'custom', message: 'reference constraint range x1 must be less than x2', path: ['x1'] });
    if (value.z1 >= value.z2) ctx.addIssue({ code: 'custom', message: 'reference constraint range z1 must be less than z2', path: ['z1'] });
  }),
  reference_bottom_drop_m: finiteNumber.nonnegative().optional(),
  reference_beam_bottom_y: finiteNumber.positive().optional(),
  risk: nonEmpty,
  reason: nonEmpty,
  survey_confirmation: nonEmpty,
}).strict().superRefine((value, ctx) => {
  if (value.reference_bottom_drop_m === undefined && value.reference_beam_bottom_y === undefined) {
    ctx.addIssue({ code: 'custom', message: 'reference constraint requires bottom drop or beam bottom reference' });
  }
});
export const HvacRouteSchema = reasonForUnconfirmed(z.object({ id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema, from: nonEmpty, to: nonEmpty, via: z.array(nonEmpty).optional(), topology_role: z.enum(['equipment_outlet', 'branch', 'shared_trunk']).optional(), constraint_refs: z.array(nonEmpty).optional(), reason: z.string().optional() }).strict());
export const HvacDiagramSchema = z.object({ anchors: z.array(HvacAnchorSchema), terminals: z.array(HvacTerminalSchema), routes: z.array(HvacRouteSchema), reference_constraints: z.array(HvacReferenceConstraintSchema) }).strict();
export const HvacLoadDesignRoomSchema = z.object({
  room: nonEmpty, basis: nonEmpty, load_kw: finiteNumber, indoor: nonEmpty, note: z.string().optional(),
}).strict();
export const HvacLoadDesignSchema = z.object({
  status: z.enum(['proposed', 'confirmed']), basis: nonEmpty,
  indoor_nominal_kw_total: finiteNumber, outdoor_nominal_kw: finiteNumber,
  connection_ratio: nonEmpty, diversity_note: z.string().optional(), budget_impact: z.string().optional(),
  rooms: z.array(HvacLoadDesignRoomSchema),
}).strict();
/**
 * 商务口径块（2026-10-13 阶段 3 新增）：单价与取证态的唯一机器可读入口。
 *
 * 与 shared/hvac-plans.ts 的分工：那份 loader 面向**预算**，`commercial` 必填（没有价格的
 * 方案进预算就是静默归零）；本 schema 面向 3D/render-facts，所以是 optional——几何方案可以
 * 先于商务落定存在。两处都 strict：多写一个键就是配置错误，不许静默忽略。
 */
export const HvacCommercialSchema = z.object({
  status: z.enum(['contracted', 'quoted', 'candidate', 'rejected']),
  price_cny: finiteNumber.nonnegative(),
  currency: z.string().optional(),
  decided_at: z.string().optional(),
  decision_ref: z.string().optional(),
  vendor: z.string().optional(),
  price_basis: z.string().optional(),
  scope_note: z.string().optional(),
  source_refs: z.array(nonEmpty).optional(),
  // 2026-11-09 issue #98 S2：合同成交语义的机器可读落点（DEC 退役后 cost-summary 的
  // 已核实层守卫改读它，不再回 docs/decisions/ 的 DEC 章节）。形状与
  // shared/quote-cards.ts 的三级证据分级同口径，多写一个键就是配置错误（strict）。
  evidence: z.object({
    kind: z.enum(['photo', 'owner_reported', 'written_quote']),
    status: nonEmpty,
    source: z.string().optional(),
    observed_at: z.string().optional(),
    quote_status: z.string().optional(),
    currency: z.string().optional(),
    contract_total_cny: finiteNumber.nonnegative().optional(),
    contract_total_terms: z.string().optional(),
    transcript_grade_limit: z.string().optional(),
  }).strict().optional(),
}).strict();
export const ProjectHvacFactsSchema = z.object({
  plans: z.array(z.object({
    id: nonEmpty,
    kind: z.literal('vrf_ducted'),
    name: nonEmpty.optional(),
    summary: z.string().optional(),
    commercial: HvacCommercialSchema.optional(),
    outdoor: VrfOutdoorUnitSchema,
    load_design: HvacLoadDesignSchema.optional(),
    diagram: HvacDiagramSchema,
  }).strict()),
}).strict();

export const ElectricalPointsSchema = z.array(ElectricalPointSchema);
const ElectricalTopologyStatusSchema = z.enum(['confirmed', 'proposed', 'pending']);
export const ElectricalTopologyPanelSchema = z.object({
  id: nonEmpty, kind: z.enum(['strong', 'weak']), status: ElectricalTopologyStatusSchema, source_point_id: nonEmpty,
}).strict();
export const ElectricalTopologyCircuitSchema = z.object({
  id: nonEmpty, panel_id: nonEmpty, purpose: z.enum(['lighting', 'hvac_power', 'dedicated_load', 'ordinary_power']), status: ElectricalTopologyStatusSchema,
  // 2026-11-07 issue #98 S3：source_circuit_id（点位侧 circuit 词汇 → 回路 id 的间接层）随
  // 点位侧 circuit 字段一并废除——成员关系只住 member_point_ids，不再有两套词汇要对账。
  member_point_ids: z.array(nonEmpty), dedicated_load: z.boolean().optional(),
  capacity: nonEmpty.optional(), wire_size: nonEmpty.optional(), breaker: nonEmpty.optional(), note: z.string().optional(),
}).strict();
export const ElectricalTopologyControlSchema = z.object({
  id: nonEmpty, kind: z.enum(['switch', 'switch_2way', 'switch_multiway']), status: ElectricalTopologyStatusSchema,
  switch_point_ids: z.array(nonEmpty), target_point_ids: z.array(nonEmpty), note: z.string().optional(),
}).strict();
export const ElectricalTopologySchema = z.object({
  version: nonEmpty, panels: z.array(ElectricalTopologyPanelSchema), circuits: z.array(ElectricalTopologyCircuitSchema),
  controls: z.array(ElectricalTopologyControlSchema), pending_parameters: z.array(nonEmpty),
}).strict();
export function parseElectricalTopology(raw: string, points?: ElectricalPoint[]): ElectricalTopology {
  const topology = ElectricalTopologySchema.parse(parseYaml(raw));
  const pointMap = new Map((points ?? []).map((point) => [point.id, point]));
  const panelIds = new Set<string>();
  for (const panel of topology.panels) {
    if (panelIds.has(panel.id)) throw new Error(`Duplicate electrical topology panel id: ${panel.id}`);
    panelIds.add(panel.id);
    const source = pointMap.get(panel.source_point_id);
    if (points && (!source || source.type !== `${panel.kind}_panel`)) throw new Error(`Electrical topology panel ${panel.id} references invalid ${panel.kind} panel point: ${panel.source_point_id}`);
  }
  const circuitIds = new Set<string>();
  const memberIds = new Set<string>();
  for (const circuit of topology.circuits) {
    if (circuitIds.has(circuit.id)) throw new Error(`Duplicate electrical topology circuit id: ${circuit.id}`);
    circuitIds.add(circuit.id);
    if (!panelIds.has(circuit.panel_id)) throw new Error(`Electrical topology circuit ${circuit.id} references unknown panel: ${circuit.panel_id}`);
    for (const id of circuit.member_point_ids) {
      if (points && !pointMap.has(id)) throw new Error(`Electrical topology circuit ${circuit.id} references unknown point: ${id}`);
      if (memberIds.has(id)) throw new Error(`Electrical topology point belongs to multiple circuits: ${id}`);
      memberIds.add(id);
    }
  }
  const controlIds = new Set<string>();
  for (const control of topology.controls) {
    if (controlIds.has(control.id)) throw new Error(`Duplicate electrical topology control id: ${control.id}`);
    controlIds.add(control.id);
    for (const id of [...control.switch_point_ids, ...control.target_point_ids]) {
      if (points && !pointMap.has(id)) throw new Error(`Electrical topology control ${control.id} references unknown point: ${id}`);
    }
  }
  return topology;
}
export const PlumbingPointsSchema = z.array(PlumbingPointSchema);
// 投影内的 plumbing 来自 parsePlumbingPoints（wall_side 已映射为 wallSide），与 shared/types.ts 的 PlumbingPoint 对齐。
// 字段声明顺序必须与 parsePlumbingPoints 的产出顺序一致：wall_side 被解构后以 wallSide **追加在末尾**，
// 故 wallSide 在本 schema 里也必须声明在最后一位，否则 parse(JSON.stringify(projection)) 的键序与
// 产出键序不同，verify:project-render-facts 的字符串比对会误报 stale。
export const PlumbingPointProjectionSchema = z.object({
  id: z.string(), room: z.string(), type: PlumbingPointSchema.shape.type,
  // 2026-11-07 issue #98 S3：x/z 从必填改为可选——10 个沿墙给排水点位转 along 后不再声明
  // 绝对坐标（平面位置由 shared/point-placement.ts 解算）；C/D/E 组绝对点位仍带声明值。
  x: finiteNumber.optional(), z: finiteNumber.optional(), wall: z.string().optional(),
  // 定位声明（issue #98 S1）：浏览器标注层与 ProblemDetector 经 shared/point-placement.ts
  // 用同一解算器取解析后坐标，故投影必须带齐这四个字段（键序与 parsePlumbingPoints 产出一致）。
  along: finiteNumber.nonnegative().optional(), face_offset: finiteNumber.optional(),
  mount: PointMountSchema.optional(), anchor: PointAnchorSchema.optional(), absolute: z.boolean().optional(),
  host_intent: nonEmpty.optional(),
  note: z.string().optional(), height: finiteNumber.optional(),
  // 构件状态唯一字段（issue #98 S2-A）。声明位置必须与 parsePlumbingPoints 的产出键序一致。
  status: ComponentStatusSchema.optional(),
  blocker: ComponentBlockerSchema.optional(),
  construction_status: z.enum(['confirmed', 'inferred', 'pending']).optional(),
  uncertainty_m: finiteNumber.positive().optional(),
  not_for_construction: z.boolean().optional(),
  diameter: finiteNumber.positive().optional(),
  // 算量分桶字段。声明位置必须与 parsePlumbingPoints 的产出键序一致（PlumbingPointSchema 里
  // 这三个字段声明在 diameter 之后，故 zod parse 的产出也排在 diameter 之后、wallSide 之前）。
  water_temp: z.enum(['hot', 'cold', 'mixed']).optional(),
  water_dn: z.union([z.literal(20), z.literal(25), z.literal(32)]).optional(),
  drain_dn: z.union([z.literal(50), z.literal(75), z.literal(110)]).optional(),
  wallSide: WallSideSchema.optional(),
}).strict();
export const CeilingZonesSchema = z.array(CeilingZoneSchema);
export const ProjectRenderFactsSchema = z.object({ electrical: ElectricalPointsSchema, plumbing: PlumbingPointsSchema, ceiling: CeilingZonesSchema, hvac: ProjectHvacFactsSchema }).strict();
export const RenderLightingOverrideSchema = z.object({ id: z.string(), anchorY_offset: finiteNumber, offsetX: finiteNumber.optional(), offsetZ: finiteNumber.optional(), basis: nonEmpty, reason: nonEmpty, applies_to: z.tuple([z.literal('web'), z.literal('blender')]) }).strict();
export const RenderLightingOverridesSchema = z.array(RenderLightingOverrideSchema);
const TrackLightHeadPurposeSchema = z.enum(['coffee_table', 'sofa', 'living_seating', 'living_south_or_corner']);
const TrackLightHeadSchema = z.object({
  offset: z.object({ x: finiteNumber, z: finiteNumber }).strict(), target: Vec3Schema,
  purpose: TrackLightHeadPurposeSchema.optional(), role: nonEmpty.optional(),
}).strict();
const TrackLightResolvedHeadSchema = z.object({
  position: Vec3Schema, target: Vec3Schema, direction: Vec3Schema,
  mountPosition: Vec3Schema, headPosition: Vec3Schema, lensPosition: Vec3Schema,
  purpose: TrackLightHeadPurposeSchema.optional(), role: nonEmpty.optional(),
}).strict();
export const TrackLightConfigSchema = z.object({
  id: nonEmpty, type: z.literal('track_light'), length: finiteNumber.positive(),
  heads: z.array(TrackLightHeadSchema).min(1), target_y_mode: z.enum(['relative', 'absolute']).optional(), direction: Vec3Schema,
  beam: finiteNumber.positive(), energy: finiteNumber.nonnegative(), rotation: Vec3Schema,
  resolvedHeads: z.array(TrackLightResolvedHeadSchema).min(1).optional(),
}).strict();
export const WallLampConfigSchema = z.object({
  id: nonEmpty, type: z.literal('wall_lamp'), style: z.literal('adjustable_short_cylinder'), finish: z.literal('matte_black'),
  backplateDiameter: finiteNumber.positive(), headDiameter: finiteNumber.positive(), headLength: finiteNumber.positive(),
  armLength: finiteNumber.positive(), maxProjection: finiteNumber.positive(),
  control: z.object({ kind: z.literal('integral_push_button'), location: z.literal('backplate_bottom') }).strict(),
  adjustability: z.object({ yawDeg: z.tuple([finiteNumber, finiteNumber]), tiltDeg: z.tuple([finiteNumber, finiteNumber]) }).strict(),
}).strict().superRefine((value, ctx) => {
  const physicalProjection = 0.008 + value.armLength + value.headLength;
  if (physicalProjection > value.maxProjection) ctx.addIssue({ code: 'custom', message: 'wall lamp parts exceed maxProjection', path: ['maxProjection'] });
  if (value.adjustability.yawDeg[0] >= value.adjustability.yawDeg[1]) ctx.addIssue({ code: 'custom', message: 'yawDeg range must increase', path: ['adjustability', 'yawDeg'] });
  if (value.adjustability.tiltDeg[0] >= value.adjustability.tiltDeg[1]) ctx.addIssue({ code: 'custom', message: 'tiltDeg range must increase', path: ['adjustability', 'tiltDeg'] });
});
export const SculpturalDomeConfigSchema = z.object({
  id: nonEmpty,
  type: z.literal('dome'),
  style: z.literal('suspended_offset_side_arch_opal_lantern'),
  finish: z.literal('satin_warm_bronze'),
  outerWidth: finiteNumber.positive(),
  outerDepth: finiteNumber.positive(),
  totalThickness: finiteNumber.positive(),
  diffuserDrop: finiteNumber.positive(),
  diffuserDiameter: finiteNumber.positive(),
  diffuserBottomDiameter: finiteNumber.positive(),
  diffuserThickness: finiteNumber.positive(),
  housingBandHeight: finiteNumber.positive(),
  housingBandOffset: finiteNumber.nonnegative(),
  canopyDiameter: finiteNumber.positive(),
  canopyThickness: finiteNumber.positive(),
  suspensionRodRadius: finiteNumber.positive(),
  suspensionRods: z.array(z.object({
    ceiling: z.object({ x: finiteNumber, z: finiteNumber }).strict(),
    diffuser: z.object({ x: finiteNumber, z: finiteNumber, heightFromBottom: finiteNumber.nonnegative() }).strict(),
  }).strict()).min(3),
  arcSpan: finiteNumber.positive(),
  arcRise: finiteNumber.positive(),
  arcDepthExtension: finiteNumber.positive(),
  arcTubeRadius: finiteNumber.positive(),
  arcFootDiameter: finiteNumber.positive(),
  arcFootHeight: finiteNumber.positive(),
  arcOffset: z.object({ x: finiteNumber, z: finiteNumber }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.diffuserDiameter >= Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'diffuser must fit inside the outer fixture envelope', path: ['diffuserDiameter'] });
  }
  if (value.diffuserBottomDiameter >= value.diffuserDiameter) {
    ctx.addIssue({ code: 'custom', message: 'pendant lower diffuser face must taper inside the upper rim', path: ['diffuserBottomDiameter'] });
  }
  if (value.diffuserDrop > value.totalThickness) {
    ctx.addIssue({ code: 'custom', message: 'diffuser bottom exceeds the total fixture drop', path: ['diffuserDrop'] });
  }
  if (value.diffuserThickness >= value.diffuserDrop) {
    ctx.addIssue({ code: 'custom', message: 'diffuser top must remain below the ceiling plane', path: ['diffuserThickness'] });
  }
  if (value.housingBandHeight > value.diffuserThickness) {
    ctx.addIssue({ code: 'custom', message: 'housing band must fit within the diffuser body depth', path: ['housingBandHeight'] });
  }
  if (value.diffuserDiameter + value.housingBandOffset * 2 >= Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'side housing exceeds the outer fixture envelope', path: ['housingBandOffset'] });
  }
  if (value.canopyThickness >= value.totalThickness || value.canopyDiameter >= Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'ceiling canopy must fit inside the fixture envelope', path: ['canopyDiameter'] });
  }
  if (value.diffuserDrop <= value.diffuserThickness + value.canopyThickness) {
    ctx.addIssue({ code: 'custom', message: 'suspension rods need positive vertical clearance', path: ['suspensionRods'] });
  }
  if (value.arcSpan + Math.abs(value.arcOffset.x) * 2 + value.arcTubeRadius * 2 > value.outerWidth) {
    ctx.addIssue({ code: 'custom', message: 'arc span exceeds the outer width', path: ['arcSpan'] });
  }
  if (value.arcFootHeight / 2 + value.arcRise + value.arcTubeRadius >= value.diffuserThickness) {
    ctx.addIssue({ code: 'custom', message: 'side arch must remain within the declared diffuser side depth', path: ['arcRise'] });
  }
  if (value.arcOffset.z - value.arcTubeRadius < -value.outerDepth / 2
    || value.arcOffset.z + value.arcDepthExtension + value.arcTubeRadius > value.outerDepth / 2) {
    ctx.addIssue({ code: 'custom', message: 'three-dimensional arch depth exceeds the fixture envelope', path: ['arcDepthExtension'] });
  }
  const archFootRadius = value.arcFootDiameter / 2;
  const archEndpointRadius = Math.hypot(value.arcSpan / 2 + value.arcOffset.x, value.arcOffset.z);
  if (archEndpointRadius - archFootRadius > value.diffuserDiameter / 2) {
    ctx.addIssue({ code: 'custom', message: 'arch feet do not reach the diffuser perimeter', path: ['arcFootDiameter'] });
  }
  if (Math.abs(value.arcOffset.x) + value.arcSpan / 2 + Math.max(value.arcTubeRadius, archFootRadius) > value.outerWidth / 2
    || Math.abs(value.arcOffset.z) + archFootRadius > value.outerDepth / 2) {
    ctx.addIssue({ code: 'custom', message: 'arc offset exceeds the fixture envelope', path: ['arcOffset'] });
  }
  value.suspensionRods.forEach((rod, index) => {
    if (Math.hypot(rod.ceiling.x, rod.ceiling.z) + value.suspensionRodRadius > value.canopyDiameter / 2) {
      ctx.addIssue({ code: 'custom', message: 'suspension ceiling endpoint exceeds the canopy', path: ['suspensionRods', index, 'ceiling'] });
    }
    if (rod.diffuser.heightFromBottom > value.housingBandHeight) {
      ctx.addIssue({ code: 'custom', message: 'side-shell suspension endpoint exceeds the declared housing band', path: ['suspensionRods', index, 'diffuser', 'heightFromBottom'] });
    }
    const endpointRadius = Math.hypot(rod.diffuser.x, rod.diffuser.z);
    const sideRadiusAtMount = value.diffuserBottomDiameter / 2
      + (value.diffuserDiameter - value.diffuserBottomDiameter) / 2
        * (rod.diffuser.heightFromBottom / value.diffuserThickness);
    const sideHousingRadiusAtMount = sideRadiusAtMount + value.housingBandOffset;
    if (endpointRadius < sideHousingRadiusAtMount + value.suspensionRodRadius) {
      ctx.addIssue({ code: 'custom', message: 'side support endpoint must remain outside the tapered diffuser and housing', path: ['suspensionRods', index, 'diffuser'] });
    }
    if (endpointRadius + value.suspensionRodRadius > Math.min(value.outerWidth, value.outerDepth) / 2) {
      ctx.addIssue({ code: 'custom', message: 'side support exceeds the fixture envelope', path: ['suspensionRods', index, 'diffuser'] });
    }
    const elbowHeight = value.diffuserThickness + value.suspensionRodRadius * 2;
    const radialAtShellTop = value.diffuserDiameter / 2 + value.suspensionRodRadius * 2
      + (endpointRadius - (value.diffuserDiameter / 2 + value.suspensionRodRadius * 2))
        * ((elbowHeight - value.diffuserThickness) / (elbowHeight - rod.diffuser.heightFromBottom));
    if (radialAtShellTop < value.diffuserDiameter / 2 + value.suspensionRodRadius) {
      ctx.addIssue({ code: 'custom', message: 'bent side support intersects the diffuser near its upper rim', path: ['suspensionRods', index, 'diffuser'] });
    }
  });
});
export const MultiGlobeChandelierConfigSchema = z.object({
  id: nonEmpty,
  type: z.literal('dome'),
  style: z.literal('multi_globe_semi_flush_chandelier'),
  finish: z.enum(['chrome_black_opal', 'antique_wood_copper_opal']),
  outerWidth: finiteNumber.positive(),
  outerDepth: finiteNumber.positive(),
  totalThickness: finiteNumber.positive(),
  canopyDiameter: finiteNumber.positive(),
  canopyThickness: finiteNumber.positive(),
  stemRadius: finiteNumber.positive(),
  stemLength: finiteNumber.positive(),
  jointBallDiameter: finiteNumber.positive(),
  hubUpperDiscDiameter: finiteNumber.positive(),
  hubUpperDiscThickness: finiteNumber.positive(),
  hubUpperDiscCenterOffsetY: finiteNumber.negative(),
  hubDiscGap: finiteNumber.nonnegative(),
  hubLowerDiscDiameter: finiteNumber.positive(),
  hubLowerDiscThickness: finiteNumber.positive(),
  hubLowerDiscCenterOffsetY: finiteNumber.negative(),
  hubFinialDiameter: finiteNumber.positive(),
  armTubeRadius: finiteNumber.positive(),
  armBow: finiteNumber.nonnegative(),
  socketDiameter: finiteNumber.positive(),
  socketHeight: finiteNumber.positive(),
  globeDiameter: finiteNumber.positive(),
  globeHeight: finiteNumber.positive().optional(),
  armTiers: z.array(z.object({
    count: z.number().int().positive(),
    angularOffsetDeg: finiteNumber,
    globeRadius: finiteNumber.positive(),
    globeCenterOffsetY: finiteNumber.negative(),
    hubAttachment: z.enum(['upper_disc', 'lower_disc']),
    armStartRadius: finiteNumber.positive(),
    armStartOffsetY: finiteNumber.negative(),
    sweep: z.enum(['rise', 'droop']),
    /** Ring tilt about the east-west axis; positive droops the near (south) side. */
    tiltDeg: finiteNumber,
  }).strict()).min(1),
}).strict().superRefine((value, ctx) => {
  const envelope = Math.min(value.outerWidth, value.outerDepth) / 2;
  const globeHalfHeight = (value.globeHeight ?? value.globeDiameter) / 2;
  if (value.canopyDiameter >= Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'ceiling canopy must fit inside the fixture envelope', path: ['canopyDiameter'] });
  }
  if (value.canopyThickness >= value.totalThickness) {
    ctx.addIssue({ code: 'custom', message: 'canopy exceeds the total fixture drop', path: ['canopyThickness'] });
  }
  if (value.stemLength + value.jointBallDiameter / 2 >= value.totalThickness) {
    ctx.addIssue({ code: 'custom', message: 'stem and joint ball exceed the total fixture drop', path: ['stemLength'] });
  }
  if (value.hubLowerDiscDiameter >= value.hubUpperDiscDiameter) {
    ctx.addIssue({ code: 'custom', message: 'stacked hub discs must taper from the upper disc to the lower disc', path: ['hubLowerDiscDiameter'] });
  }
  if (value.hubFinialDiameter >= value.hubLowerDiscDiameter) {
    ctx.addIssue({ code: 'custom', message: 'hub finial must be smaller than the lower disc', path: ['hubFinialDiameter'] });
  }
  const hubTop = value.hubUpperDiscCenterOffsetY + value.hubUpperDiscThickness / 2;
  const hubUpperBottom = value.hubUpperDiscCenterOffsetY - value.hubUpperDiscThickness / 2;
  const hubLowerTop = value.hubLowerDiscCenterOffsetY + value.hubLowerDiscThickness / 2;
  const actualHubGap = hubUpperBottom - hubLowerTop;
  // The declared finial profile occupies hubFinialDiameter vertically and is
  // centered one radius below the lower disc's bottom face.
  const hubBottom = value.hubLowerDiscCenterOffsetY - value.hubLowerDiscThickness / 2 - value.hubFinialDiameter;
  if (Math.abs(actualHubGap - value.hubDiscGap) > 0.002) {
    ctx.addIssue({ code: 'custom', message: 'hubDiscGap does not match the declared upper/lower disc clearance', path: ['hubDiscGap'] });
  }
  if (hubTop >= 0) {
    ctx.addIssue({ code: 'custom', message: 'hub must hang below the ceiling anchor', path: ['hubUpperDiscCenterOffsetY'] });
  }
  if (hubBottom < -value.totalThickness - 1e-9) {
    ctx.addIssue({ code: 'custom', message: 'hub finial exceeds the total fixture drop', path: ['hubLowerDiscCenterOffsetY'] });
  }
  const arms = value.armTiers.flatMap((tier, tierIndex) =>
    Array.from({ length: tier.count }, (_, index) => ({
      tierIndex,
      angleDeg: tier.angularOffsetDeg + (360 / tier.count) * index,
      tier,
    })),
  );
  const positions = arms.map((arm) => {
    const radians = (arm.angleDeg * Math.PI) / 180;
    const tilt = (arm.tier.tiltDeg * Math.PI) / 180;
    return {
      ...arm,
      x: arm.tier.globeRadius * Math.sin(radians),
      z: arm.tier.globeRadius * Math.cos(radians) * Math.cos(tilt),
      y: arm.tier.globeCenterOffsetY - arm.tier.globeRadius * Math.cos(radians) * Math.sin(tilt),
    };
  });
  for (const arm of arms) {
    const hubDiscRadius = arm.tier.hubAttachment === 'upper_disc'
      ? value.hubUpperDiscDiameter / 2
      : value.hubLowerDiscDiameter / 2;
    if (arm.tier.armStartRadius > hubDiscRadius + 1e-9) {
      ctx.addIssue({ code: 'custom', message: 'arm start radius exceeds the attached hub disc', path: ['armTiers', arm.tierIndex, 'armStartRadius'] });
    }
    const discCenter = arm.tier.hubAttachment === 'upper_disc'
      ? value.hubUpperDiscCenterOffsetY
      : value.hubLowerDiscCenterOffsetY;
    const discThickness = arm.tier.hubAttachment === 'upper_disc'
      ? value.hubUpperDiscThickness
      : value.hubLowerDiscThickness;
    if (Math.abs(arm.tier.armStartOffsetY - discCenter) > discThickness / 2 + 1e-9) {
      ctx.addIssue({ code: 'custom', message: 'arm start height falls outside the attached hub disc', path: ['armTiers', arm.tierIndex, 'armStartOffsetY'] });
    }
    const radialInner = arm.tier.globeRadius - value.globeDiameter / 2;
    if (radialInner <= hubDiscRadius) {
      ctx.addIssue({ code: 'custom', message: 'globe intersects the hub stack', path: ['armTiers', arm.tierIndex, 'globeRadius'] });
    }
    if (arm.tier.globeRadius + value.globeDiameter / 2 > envelope) {
      ctx.addIssue({ code: 'custom', message: 'globe exceeds the fixture envelope', path: ['armTiers', arm.tierIndex, 'globeRadius'] });
    }
    // 倾斜后每球高度不同：按该臂实际方位算球心 offset，不能用 tier 基准值。
    const armRadians = (arm.angleDeg * Math.PI) / 180;
    const armTilt = (arm.tier.tiltDeg * Math.PI) / 180;
    const globeOffsetY = arm.tier.globeCenterOffsetY
      - arm.tier.globeRadius * Math.cos(armRadians) * Math.sin(armTilt);
    if (Math.abs(globeOffsetY) + globeHalfHeight > value.totalThickness) {
      ctx.addIssue({ code: 'custom', message: 'globe exceeds the total fixture drop', path: ['armTiers', arm.tierIndex, 'globeCenterOffsetY'] });
    }
    // `sweep` selects the signed Bézier bow relative to the straight chord from
    // hub attachment to socket base; the endpoint may be above or below the hub.
    // A high shared arm-root plane can arch upward, then descend to a common-height globe.
  }
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      const separation = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (separation < value.globeDiameter) {
        ctx.addIssue({
          code: 'custom',
          message: `globes ${i + 1} and ${j + 1} intersect (separation ${separation.toFixed(3)}m < globe diameter ${value.globeDiameter}m)`,
          path: ['armTiers'],
        });
      }
    }
  }
});
/** Both dome render styles share electrical type 'dome'; the style literal discriminates the geometry. */
export const SemiFlushDomeConfigSchema = z.object({
  id: nonEmpty,
  type: z.literal('ceiling_light'),
  style: z.literal('semi_flush_ceiling_light'),
  finish: z.literal('chrome_opal'),
  outerWidth: finiteNumber.positive(),
  outerDepth: finiteNumber.positive(),
  totalThickness: finiteNumber.positive(),
  canopyDiameter: finiteNumber.positive(),
  canopyThickness: finiteNumber.positive(),
  stemLength: finiteNumber.positive(),
  stemRadius: finiteNumber.positive(),
  diffuserTopDiameter: finiteNumber.positive(),
  diffuserBottomDiameter: finiteNumber.positive(),
  diffuserDepth: finiteNumber.positive(),
  rimTubeRadius: finiteNumber.positive(),
}).strict().superRefine((value, ctx) => {
  if (value.canopyDiameter >= Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'ceiling canopy must fit inside the fixture envelope', path: ['canopyDiameter'] });
  }
  if (value.diffuserTopDiameter > Math.min(value.outerWidth, value.outerDepth)) {
    ctx.addIssue({ code: 'custom', message: 'diffuser must fit inside the fixture envelope', path: ['diffuserTopDiameter'] });
  }
  if (value.diffuserBottomDiameter >= value.diffuserTopDiameter) {
    ctx.addIssue({ code: 'custom', message: 'shallow dome lower face must be narrower than the upper rim', path: ['diffuserBottomDiameter'] });
  }
  const totalDrop = value.canopyThickness + value.stemLength + value.diffuserDepth;
  if (totalDrop > value.totalThickness + 1e-9) {
    ctx.addIssue({ code: 'custom', message: 'canopy + stem + diffuser exceed the total fixture drop', path: ['totalThickness'] });
  }
  if (value.diffuserDepth >= value.totalThickness) {
    ctx.addIssue({ code: 'custom', message: 'diffuser depth exceeds the total fixture drop', path: ['diffuserDepth'] });
  }
  if (value.stemLength + value.canopyThickness >= value.totalThickness) {
    ctx.addIssue({ code: 'custom', message: 'stem needs positive vertical clearance', path: ['stemLength'] });
  }
  if (value.stemRadius >= value.canopyDiameter / 2) {
    ctx.addIssue({ code: 'custom', message: 'stem radius must be smaller than the canopy radius', path: ['stemRadius'] });
  }
  if (value.rimTubeRadius >= value.diffuserBottomDiameter / 2) {
    ctx.addIssue({ code: 'custom', message: 'rim tube radius must be smaller than the diffuser lower radius', path: ['rimTubeRadius'] });
  }
});
/** R8餐厅奶油云团灯；未标商品尺寸的吊线/球体明确是主图比例预演值。 */
export const CloudOrbCeilingLightConfigSchema = z.object({
  id: nonEmpty,
  type: z.literal('ceiling_light'),
  style: z.literal('antique_cloud_orb_ceiling_light'),
  finish: z.literal('walnut_pe_opal'),
  outerDiameter: finiteNumber.positive(),
  canopyThickness: finiteNumber.positive(),
  diffuserDepth: finiteNumber.positive(),
  cloudRingRadius: finiteNumber.positive(),
  lobeLayers: z.literal(2),
  lobesPerLayer: z.number().int().min(6).max(16),
  layerOffsetDeg: finiteNumber,
  lobeTangentialDiameter: finiteNumber.positive(),
  lobeRadialDiameter: finiteNumber.positive(),
  lobeHeight: finiteNumber.positive(),
  wireRadius: finiteNumber.positive(),
  hangingBalls: z.array(z.object({
    id: nonEmpty,
    xOffset: finiteNumber,
    zOffset: finiteNumber,
    cordLength: finiteNumber.positive(),
    diameter: finiteNumber.positive(),
  }).strict()).length(3),
}).strict().superRefine((value, ctx) => {
  if (value.cloudRingRadius + Math.max(value.lobeRadialDiameter, value.lobeTangentialDiameter) / 2 > value.outerDiameter / 2 + 1e-9) {
    ctx.addIssue({ code: 'custom', message: 'cloud lobes must stay inside the declared body diameter', path: ['cloudRingRadius'] });
  }
  if (value.canopyThickness + value.diffuserDepth <= 0) {
    ctx.addIssue({ code: 'custom', message: 'cloud body must have a positive drop', path: ['diffuserDepth'] });
  }
  const ids = new Set<string>();
  for (const [index, ball] of value.hangingBalls.entries()) {
    if (ids.has(ball.id)) ctx.addIssue({ code: 'custom', message: `duplicate hanging ball id: ${ball.id}`, path: ['hangingBalls', index, 'id'] });
    ids.add(ball.id);
    if (Math.hypot(ball.xOffset, ball.zOffset) + ball.diameter / 2 > value.outerDiameter / 2 + 1e-9) {
      ctx.addIssue({ code: 'custom', message: 'hanging ball must stay inside the declared body footprint', path: ['hangingBalls', index] });
    }
  }
});
/** Dome render styles share electrical type 'dome'/'ceiling_light'; the style literal discriminates the geometry. */
export const DomeFixtureConfigSchema = z.discriminatedUnion('style', [SculpturalDomeConfigSchema, MultiGlobeChandelierConfigSchema, SemiFlushDomeConfigSchema, CloudOrbCeilingLightConfigSchema]);
export const LightingRenderConfigSchema = z.object({
  fixtures: z.array(z.discriminatedUnion('type', [TrackLightConfigSchema, WallLampConfigSchema, DomeFixtureConfigSchema])),
}).strict();
export function parseLightingRenderConfig(raw: string): LightingRenderConfig {
  const config = LightingRenderConfigSchema.parse(parseYaml(raw));
  const ids = new Set<string>();
  for (const fixture of config.fixtures) {
    if (ids.has(fixture.id)) throw new Error(`Duplicate lighting config id: ${fixture.id}`);
    ids.add(fixture.id);
    if (fixture.type === 'track_light' && fixture.heads.length !== new Set(fixture.heads.map((head) => JSON.stringify(head.offset))).size) {
      throw new Error(`Duplicate track head offset for lighting config ${fixture.id}`);
    }
  }
  return config;
}
export const CurtainStateSchema = z.enum(['open', 'privacy', 'blackout']);
export const CurtainPresentationStateSchema = z.object({
  default: CurtainStateSchema,
  roomOverrides: z.record(z.string(), CurtainStateSchema),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export const CurtainRenderProjectionSchema = z.object({
  source: z.object({
    default: CurtainStateSchema,
    roomOverrides: z.record(z.string(), CurtainStateSchema),
    updatedAt: z.string(),
  }).strict(),
  effectiveByRoom: z.record(z.string(), CurtainStateSchema),
  curtains: z.array(z.object({
    id: z.string(),
    roomId: z.string(),
    kind: z.enum(['sheer_blackout', 'blinds']),
    state: CurtainStateSchema,
    expectedVisibleNodes: z.array(z.string()),
  }).strict()),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();
/**
 * implemented 投影必须带外机（PR #122 Codex blocking，2026-11-10）：`diagram.anchors` 里的
 * `confirmed` `outdoor_a2` 靠 `ref.source === 'outdoor'` 解算，而 `buildHvacBuilderSources`
 * 只从 `hvac` / `outdoor` 入参取外机——投影不带外机，任何「只有投影」的建场路径都必然
 * 解不出该 anchor（外机不画 + 诊断 + 页面 HVAC 判未就绪）。写成必填 = 这种不自洽投影在这一层
 * 就被拒（fail-closed），而不是等到建场时才显形。
 */
const HvacProjectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('implemented'), planId: z.literal('A2'), diagram: HvacDiagramSchema, outdoor: z.array(VrfOutdoorUnitSchema) }).strict(),
  z.object({ status: z.literal('unimplemented'), planId: z.string().nullable() }).strict(),
]);
export const ProjectRenderFactsProjectionSchema = z.object({
  version: z.literal('2.0'), lighting: LightingRenderConfigSchema.optional(), lightingFixtures: z.array(z.object({ id: z.string(), room: z.string(), type: ElectricalPointSchema.shape.type, position: Vec3Schema, temperatureK: finiteNumber, enabled: z.boolean(), heads: z.number().int().positive().optional(), recessed: z.boolean().optional(), wallId: z.string().optional(), wallSide: WallSideSchema.optional(), mountAnchor: FurnitureFaceMountAnchorProjectionSchema.optional() }).strict()),
  plumbing: z.array(PlumbingPointProjectionSchema), ceiling: CeilingZonesSchema, hvac: HvacProjectionSchema,
  materials: z.object({ floor: z.object({ default: z.string().nullable(), roomOverrides: z.record(z.string(), z.string()) }).strict() }).strict(),
  presentation: z.object({ curtains: CurtainRenderProjectionSchema }).strict(),
}).strict();

export function validateProjectHvacFacts(hvac: ProjectHvacFacts, facts: Pick<ProjectRenderFacts, 'electrical' | 'ceiling'>): ProjectHvacFacts {
  const planIds = new Set<string>();
  for (const plan of hvac.plans) {
    if (planIds.has(plan.id)) throw new Error(`Duplicate HVAC plan id: ${plan.id}`);
    planIds.add(plan.id);
    const ids = new Set<string>();
    for (const item of [...plan.diagram.anchors, ...plan.diagram.terminals]) {
      if (ids.has(item.id)) throw new Error(`Duplicate HVAC diagram id: ${item.id}`);
      ids.add(item.id);
    }
    const constraintIds = new Set<string>();
    for (const constraint of plan.diagram.reference_constraints) {
      if (constraintIds.has(constraint.id) || ids.has(constraint.id)) throw new Error(`Duplicate HVAC diagram id: ${constraint.id}`);
      constraintIds.add(constraint.id);
    }
    const routeIds = new Set<string>();
    for (const route of plan.diagram.routes) {
      if (routeIds.has(route.id) || ids.has(route.id) || constraintIds.has(route.id)) throw new Error(`Duplicate HVAC diagram id: ${route.id}`);
      routeIds.add(route.id);
      for (const ref of [route.from, route.to, ...(route.via ?? [])]) if (!ids.has(ref)) throw new Error(`HVAC route ${route.id} references unknown diagram id: ${ref}`);
      if (route.constraint_refs?.length) {
        if (route.status === 'confirmed') throw new Error(`HVAC route ${route.id} references constraints and cannot be confirmed`);
        if (!route.reason?.trim()) throw new Error(`HVAC route ${route.id} references constraints and requires reason`);
        for (const ref of route.constraint_refs) if (!constraintIds.has(ref)) throw new Error(`HVAC route ${route.id} references unknown constraint: ${ref}`);
      }
      if (route.system === 'condensate') {
        if (route.topology_role === 'equipment_outlet') {
          const source = plan.diagram.anchors.find((anchor) => anchor.id === route.from && anchor.id.startsWith('indoor_'));
          const outlet = plan.diagram.anchors.find((anchor) => anchor.id === route.to && anchor.system === 'condensate');
          if (!source || !outlet) throw new Error(`HVAC condensate equipment outlet ${route.id} must link an indoor anchor to a condensate outlet anchor`);
          continue;
        }
        if (route.topology_role === 'branch') {
          const junction = plan.diagram.anchors.find((anchor) => anchor.id === route.to && anchor.system === 'condensate');
          if (!junction) throw new Error(`HVAC condensate branch ${route.id} must end at a condensate junction anchor`);
          continue;
        }
        if (route.topology_role === 'shared_trunk') {
          const junction = plan.diagram.anchors.find((anchor) => anchor.id === route.from && anchor.system === 'condensate');
          if (!junction) throw new Error(`HVAC condensate shared trunk ${route.id} must start at a condensate junction anchor`);
        }
        const candidate = plan.diagram.terminals.find((terminal) => terminal.id === route.to);
        if (!candidate || candidate.status !== 'pending' || candidate.kind !== 'condensate_drain_candidate') {
          throw new Error(`HVAC condensate route ${route.id} must end at a pending condensate drain candidate`);
        }
      }
    }
    for (const anchor of plan.diagram.anchors) if (anchor.ref) {
      const target = anchor.ref.source === 'outdoor' ? plan.outdoor.id === anchor.ref.id : anchor.ref.source === 'ceiling' ? facts.ceiling.some((point) => point.id === anchor.ref!.id) : facts.electrical.some((point) => point.id === anchor.ref!.id);
      if (!target) throw new Error(`HVAC anchor ${anchor.id} references unknown ${anchor.ref.source} id: ${anchor.ref.id}`);
    }
    // serves_unit 存在性校验（issue #98 S1，E8）：检修口服务的内机 ceiling id 必须是真实存在的
    // ceiling 对象——原先写错 id 不抛，而消费方（HvacDiagramRenderer.highlightUnit）查不到即
    // 静默 return false，点检修口不高亮内机（A §3.3(5) 探针：serves_unit 写错 NO THROW）。
    for (const terminal of plan.diagram.terminals) {
      if (terminal.serves_unit === undefined) continue;
      if (!facts.ceiling.some((zone) => zone.id === terminal.serves_unit)) {
        throw new Error(`HVAC terminal ${terminal.id} serves unknown ceiling unit: ${terminal.serves_unit}`);
      }
    }
    // access offset 恒等断言（issue #98 S2，业主裁定一 2026-11-08）：offset == position −
    // serves_unit 宿主 position（容差 0.005m）。真值只有 position 一份，offset 是关系声明，
    // 两处漂移即加载期失败——单一实现住在 shared/hvac-terminal-lint.ts（test:server 的
    // 绿/红变异共用同一函数，不造第二套算法）。
    const offsetIssues = lintHvacAccessOffsets({
      terminals: plan.diagram.terminals as HvacTerminalWithOffset[],
      ceiling: facts.ceiling,
    });
    if (offsetIssues.length > 0) {
      throw new Error(`HVAC access offset 对账失败（${offsetIssues.length} 条）：${offsetIssues.map((entry) => entry.message).join('；')}`);
    }
    // power anchor serves_unit 存在性校验（issue #98 第五阶段 S3）：取电锚点服务的内机
    // ceiling id 必须是真实存在的 ac_indoor 对象——serves_unit 从「id 房间名的隐式映射」
    // 提为显式声明后，写错 id 加载期即抛（与上方 terminal serves_unit 校验同款 fail-closed）；
    // 「合法 id 的错配」（如 power_child serves ac_master）由 lintHvacPowerPairing 的
    // route/ref/host_intent 三腿对账抓，两层各管半边，分工同 access offset。
    for (const anchor of plan.diagram.anchors) {
      const servesUnit = (anchor as HvacAnchorWithServesUnit).serves_unit;
      if (servesUnit === undefined) continue;
      const unit = facts.ceiling.find((zone) => zone.id === servesUnit);
      if (!unit) throw new Error(`HVAC anchor ${anchor.id} serves unknown ceiling unit: ${servesUnit}`);
      if (unit.type !== 'ac_indoor') {
        throw new Error(`HVAC anchor ${anchor.id} 的 serves_unit ${servesUnit} 不是 ac_indoor 内机对象（type=${unit.type}）`);
      }
    }
    // schematic_only 锚点（裁定四）是示意图层，不得当 route 终点消费——route.to 指向示意锚点
    // 就是把它当真节点放线；via（拓扑经过示意）仍允许（refrigerant_*_branch 的既有形态）。
    const schematicIds = new Set(plan.diagram.anchors.filter((anchor) => (anchor as HvacAnchorWithSchematicOnly).schematic_only === true).map((anchor) => anchor.id));
    if (schematicIds.size > 0) {
      for (const route of plan.diagram.routes) {
        if (schematicIds.has(route.to)) {
          throw new Error(`HVAC route ${route.id} 的 to 指向 schematic_only 示意锚点 ${route.to}（示意锚点不参与几何/不放线，不能当 route 终点）`);
        }
      }
    }
  }
  return hvac;
}
export function parseElectricalPoints(raw: string): ElectricalPoint[] {
  // mount（S2 真挂载定位来源）保留在产出里（解算器输入），同时投影出 mountAnchor——
  // 渲染管线 NightLightGeometry / DXF 标注 / verify-spatial 的既有消费形态，kind 唯一
  // 合法值 furniture_face 由这里自动补上。wall_side 仍按旧约定解构后以 wallSide 追加末尾。
  return ElectricalPointsSchema.parse(parseYaml(raw)).map(({ wall_side, ...point }) => ({
    ...point,
    ...(wall_side ? { wallSide: wall_side } : {}),
    ...(point.mount ? { mountAnchor: {
      kind: 'furniture_face' as const,
      furnitureId: point.mount.furniture_id,
      face: point.mount.face,
      ...(point.mount.surface_gap !== undefined ? { surfaceGap: point.mount.surface_gap } : {}),
    } } : {}),
  }));
}
export function parsePlumbingPoints(raw: string): PlumbingPoint[] {
  return PlumbingPointsSchema.parse(parseYaml(raw)).map(({ wall_side, ...point }) => ({ ...point, ...(wall_side ? { wallSide: wall_side } : {}) }));
}
export function parseCeilingZones(raw: string): CeilingZone[] { return CeilingZonesSchema.parse(parseYaml(raw)); }
export function parseProjectHvacFacts(raw: string): ProjectHvacFacts { return ProjectHvacFactsSchema.parse(parseYaml(raw)); }
export function parseProjectRenderFacts(raw: unknown): ProjectRenderFacts { return ProjectRenderFactsSchema.parse(raw); }
export function parseCurtainPresentationState(raw: unknown) { return CurtainPresentationStateSchema.parse(raw); }
export function parseRenderLightingOverrides(raw: string): RenderLightingOverride[] { return RenderLightingOverridesSchema.parse(parseYaml(raw)); }
export function parseProjectRenderFactsProjection(raw: unknown): ProjectRenderFactsProjection { return ProjectRenderFactsProjectionSchema.parse(raw); }
