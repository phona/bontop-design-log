import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
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
const Vec3Schema = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }).strict();
const FurnitureFaceMountAnchorConfigSchema = z.object({
  kind: z.literal('furniture_face'),
  furniture_id: nonEmpty,
  face: WallSideSchema,
  surface_gap: finiteNumber.nonnegative().optional(),
}).strict();
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

export const ElectricalPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['socket', 'switch', 'switch_2way', 'network', 'usb', 'floor_socket', 'strong_panel', 'weak_panel', 'ac_controller', 'ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light', 'night_light']),
  x: finiteNumber, z: finiteNumber, wall: z.string().optional(), wall_side: WallSideSchema.optional(), mount_anchor: FurnitureFaceMountAnchorConfigSchema.optional(), temp: finiteNumber.optional(), circuit: z.string().optional(), count: finiteNumber.optional(), heads: z.number().int().positive().optional(), recessed: z.boolean().optional(), width: finiteNumber.optional(), depth: finiteNumber.optional(), mount_height: finiteNumber.optional(), body_height: finiteNumber.optional(), appearance: ElectricalFixtureAppearanceSchema.optional(), note: z.string().optional(), height: finiteNumber.optional(), status: z.enum(['measured', 'likely', 'inferred', 'pending']).optional(), position_status: z.enum(['measured', 'likely', 'inferred', 'pending']).optional(), neutral: z.boolean().optional(),
}).strict();
export const PlumbingPointSchema = z.object({
  id: z.string(), room: z.string(), type: z.enum(['faucet', 'toilet', 'shower', 'drain', 'washer', 'faucet_outdoor', 'leb', 'drain_riser', 'gas_meter', 'duct', 'water_supply', 'water_heater']),
  x: finiteNumber, z: finiteNumber, wall: z.string().optional(), wall_side: WallSideSchema.optional(), note: z.string().optional(), height: finiteNumber.optional(),
  status: z.enum(['measured', 'likely', 'inferred', 'pending']).optional(),
  construction_status: z.enum(['confirmed', 'inferred', 'pending']).optional(),
  uncertainty_m: finiteNumber.positive().optional(),
  not_for_construction: z.boolean().optional(),
  diameter: finiteNumber.positive().optional(),
  // 算量分桶字段（shared/mep-takeoff.ts 读取）。strict schema：错字/漏声明都在这里显形，
  // 不允许从 note 文字反推冷热与管径（AGENTS.md「禁止推断」）。
  water_temp: z.enum(['hot', 'cold', 'mixed']).optional(),
  water_dn: z.union([z.literal(20), z.literal(25), z.literal(32)]).optional(),
  drain_dn: z.union([z.literal(50), z.literal(75), z.literal(110)]).optional(),
}).strict();
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
}).strict();

export const VrfOutdoorUnitSchema = z.object({
  id: nonEmpty, platform: nonEmpty, x: finiteNumber, z: finiteNumber, direction: nonEmpty, width: finiteNumber, depth: finiteNumber, height: finiteNumber, model: nonEmpty, note: z.string().optional(),
}).strict();
const HvacStatusSchema = z.enum(['confirmed', 'inferred', 'pending']);
const HvacSystemSchema = z.enum(['refrigerant', 'power', 'condensate', 'supply_air', 'return_air', 'access', 'decorative']);
const reasonForUnconfirmed = <T extends z.ZodType<{ status: string; reason?: string }>>(schema: T) => schema.superRefine((value, ctx) => {
  if (value.status !== 'confirmed' && !value.reason?.trim()) ctx.addIssue({ code: 'custom', message: `${value.status} HVAC facts require reason`, path: ['reason'] });
});
export const HvacAnchorSchema = reasonForUnconfirmed(z.object({
  id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema,
  ref: z.object({ source: z.enum(['outdoor', 'ceiling', 'electrical']), id: nonEmpty }).strict().optional(),
  position: Vec3Schema.optional(), reason: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.ref) === Boolean(value.position)) ctx.addIssue({ code: 'custom', message: 'HVAC anchor requires exactly one of ref or position' });
}));
export const HvacTerminalSchema = z.object({
  id: nonEmpty,
  status: HvacStatusSchema,
  system: HvacSystemSchema,
  position: Vec3Schema,
  reason: z.string().optional(),
  kind: z.enum(['terminal', 'condensate_drain_candidate', 'decorative_louver']).optional(),
  confirmed: z.boolean().optional(),
  render_interior: z.boolean().optional(),
  render_coordination: z.boolean().optional(),
  mount_face: z.enum(['north', 'south', 'east', 'west', 'bottom']).optional(),
  length: z.number().positive().optional(),
  finish: z.enum(['matte_white', 'matte_black']).optional(),
  render_style: z.enum(['linear_slot', 'panel']).optional(),
  grille_height: z.number().positive().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status !== 'confirmed' && !value.reason?.trim()) {
    ctx.addIssue({ code: 'custom', message: `${value.status} HVAC facts require reason`, path: ['reason'] });
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
export const HvacRouteSchema = reasonForUnconfirmed(z.object({ id: nonEmpty, status: HvacStatusSchema, system: HvacSystemSchema, from: nonEmpty, to: nonEmpty, via: z.array(nonEmpty).optional(), constraint_refs: z.array(nonEmpty).optional(), reason: z.string().optional() }).strict());
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
  member_point_ids: z.array(nonEmpty), dedicated_load: z.boolean().optional(), source_circuit_id: nonEmpty.optional(),
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
  x: finiteNumber, z: finiteNumber, wall: z.string().optional(), note: z.string().optional(), height: finiteNumber.optional(),
  status: z.enum(['measured', 'likely', 'inferred', 'pending']).optional(),
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
  finish: z.literal('chrome_black_opal'),
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
  const hubBottom = value.hubLowerDiscCenterOffsetY - value.hubLowerDiscThickness / 2 - value.hubFinialDiameter / 2;
  if (hubTop >= 0) {
    ctx.addIssue({ code: 'custom', message: 'hub must hang below the ceiling anchor', path: ['hubUpperDiscCenterOffsetY'] });
  }
  if (hubBottom <= -value.totalThickness) {
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
    if (Math.abs(globeOffsetY) + value.globeDiameter / 2 > value.totalThickness) {
      ctx.addIssue({ code: 'custom', message: 'globe exceeds the total fixture drop', path: ['armTiers', arm.tierIndex, 'globeCenterOffsetY'] });
    }
    if (arm.tier.sweep === 'rise' && arm.tier.globeCenterOffsetY <= arm.tier.armStartOffsetY) {
      ctx.addIssue({ code: 'custom', message: 'rising tier globe must sit above its hub attachment', path: ['armTiers', arm.tierIndex, 'sweep'] });
    }
    if (arm.tier.sweep === 'droop' && arm.tier.globeCenterOffsetY >= arm.tier.armStartOffsetY) {
      ctx.addIssue({ code: 'custom', message: 'drooping tier globe must hang below its hub attachment', path: ['armTiers', arm.tierIndex, 'sweep'] });
    }
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
/** Dome render styles share electrical type 'dome'/'ceiling_light'; the style literal discriminates the geometry. */
export const DomeFixtureConfigSchema = z.discriminatedUnion('style', [SculpturalDomeConfigSchema, MultiGlobeChandelierConfigSchema, SemiFlushDomeConfigSchema]);
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
const HvacProjectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('implemented'), planId: z.literal('A2'), diagram: HvacDiagramSchema }).strict(),
  z.object({ status: z.literal('unimplemented'), planId: z.string().nullable() }).strict(),
]);
export const ProjectRenderFactsProjectionSchema = z.object({
  version: z.literal('2.0'), lighting: LightingRenderConfigSchema.optional(), lightingFixtures: z.array(z.object({ id: z.string(), room: z.string(), type: ElectricalPointSchema.shape.type, position: Vec3Schema, temperatureK: finiteNumber, enabled: z.boolean(), circuit: z.string().optional(), heads: z.number().int().positive().optional(), recessed: z.boolean().optional(), wallId: z.string().optional(), wallSide: WallSideSchema.optional(), mountAnchor: FurnitureFaceMountAnchorProjectionSchema.optional() }).strict()),
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
  }
  return hvac;
}
export function parseElectricalPoints(raw: string): ElectricalPoint[] {
  return ElectricalPointsSchema.parse(parseYaml(raw)).map(({ wall_side, mount_anchor, ...point }) => ({
    ...point,
    ...(wall_side ? { wallSide: wall_side } : {}),
    ...(mount_anchor ? { mountAnchor: {
      kind: mount_anchor.kind,
      furnitureId: mount_anchor.furniture_id,
      face: mount_anchor.face,
      ...(mount_anchor.surface_gap !== undefined ? { surfaceGap: mount_anchor.surface_gap } : {}),
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
