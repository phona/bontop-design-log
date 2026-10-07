/**
 * 水电子系统 · 算量与成本数据底座（L2 → L3 之间的唯一派生层）。
 *
 * 为什么需要它：PKG-040 的 9 个 COST 全是泛称（"给水管改造""电线线管底盒"），111 个点位 + 21 回路
 * 从来没有派生出「要买多少米线、多少米管、几个模数」，于是「15,000 够不够」无法对账，施工方
 * 报一口价也无从核验。本模块把已有的**声明**（点位坐标、回路成员、路由、管径/冷热字段）派生为**量**。
 *
 * 与吊顶算量（shared/ceiling-takeoff.ts）同源的铁律：
 * - **不建第二份坐标**：路由端点解析复用 shared/mep-hvac-coordination-schema.ts 的
 *   resolveMepRoutes（含 hvac anchors，如 bend_corridor），本模块不猜任何坐标。
 * - **禁止推断**：线径只读 topology.wire_size；点位→回路只读 member_point_ids 与 controls 的
 *   switch_point_ids/target_point_ids；管径/冷热只读 plumbing.water_temp/water_dn/drain_dn。
 *   缺声明 → 进 unresolved / deferred 并计数，绝不兜底。
 * - **不静默丢弃**：未画路由的点位、只声明要求没画线的路由、非水电包设施、未激活预留，全部显形。
 * - **不四舍五入**：数量保留原始浮点，只有金额才 round；金额由 server/mep-quotes.ts（报价卡）负责，本模块只管量。
 * - **物理路由 vs 要求路由**：用仓库已有的 isMepPhysicalRoute 判定。给排水的
 *   `route_kind: requirement`（如 water-kitchen-requirement）只是「已声明要求、未画线」，
 *   不计长度、只显形——否则会把「没画的总管」当成「算过的总管」。
 *
 * 本模块**不 import three、不读文件系统**：CLI（scripts/project/mep-takeoff.ts）负责加载，
 * app 与 server 共用同一份口径。
 */

import {
  mepRoutePoints,
  type MepRoute,
  type MepRouteResolutionReport,
} from './mep-hvac-coordination-schema.js';
import type { ElectricalPoint, PlumbingPoint } from './types.js';

type ResolvedMepRoute = MepRouteResolutionReport['routes'][number];

/** 回路的最小视图（只取本模块要用的字段，避免与 topology schema 强耦合）。 */
export interface TakeoffCircuit {
  id: string;
  purpose?: string;
  wire_size?: string;
  breaker?: string;
  member_point_ids?: string[];
}

export interface TakeoffControl {
  id?: string;
  switch_point_ids?: string[];
  target_point_ids?: string[];
}

export interface MepTakeoffRules {
  /** 唯一事实源路径清单（CLI/verify 按它读文件，配置与代码不双写路径）。 */
  sources: {
    electrical_points: string;
    plumbing_points: string;
    circuits: string;
    routes: string;
    hvac: string;
    ceiling: string;
  };
  covered_layers: string[];
  excluded_layers: Array<{ layer: string; reason: string }>;
  units: {
    cores_by_purpose: Record<string, number>;
    dual_control_extra_cores: number;
    /** 弱点位额外芯数（如 net_gateway 需 2 根 Cat6：WAN 上联 + LAN 回弱电箱）。 */
    weak_extra_cores?: Record<string, number>;
    loss: { wire: number; pipe: number };
  };
  trunk_wire_size: string | null;
  /** 是否把路由终点到点位安装高度的竖向下引段计入管长（纯算术：to_height − point.height）。 */
  include_terminal_drop: boolean;
  panel: { main_switch_poles: number; spd_modules: number; spare_ratio: number; round_up: boolean };
  declared_devices?: Record<string, { count: number; basis: string }>;
  non_mep_items?: Array<{ id: string; reason: string }>;
  /**
   * 给排水路由需要跨规格时，必须按 route point index 显式分段。
   * from_index/to_index 指 mepRoutePoints(route, resolved.from, resolved.to) 的下标，
   * 每一段覆盖 from_index 到 to_index 之间的折线边。未声明分段时只接受两端规格完全一致的路由。
   */
  pipe_route_segments?: Record<string, Array<{
    from_index: number;
    to_index: number;
    water_temp?: 'hot' | 'cold' | 'mixed';
    water_dn?: 20 | 25 | 32;
    drain_dn?: 50 | 75 | 110;
  }>>;
}

export interface MepTakeoffInput {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  circuits: TakeoffCircuit[];
  controls?: TakeoffControl[];
  routes: MepRoute[];
  resolution: MepRouteResolutionReport;
  rules: MepTakeoffRules;
}

export interface WireBucket {
  wireSize: string;
  conduitM: number;
  cores: number;
  wireM: number;
  circuits: string[];
}

export interface PipeBucket {
  key: string;
  meters: number;
}

export interface CoverageByType {
  total: number;
  routed: number;
  unrouted: number;
}

export interface MepTakeoff {
  /** estimated_from_routes = 路由仍 inferred；measured_after_survey = 量房后全部 confirmed。 */
  status: 'estimated_from_routes' | 'measured_after_survey';
  conduit: {
    strongPowerM: number;
    weakPowerM: number;
    waterSupplyM: number;
    drainageM: number;
    totalM: number;
    drawnM: number;

    /** 其中竖向下引段（to_height − 点位安装高度）的合计，纯算术派生。 */
    terminalDropM: number;
    /**
     * **可采购管长 = 只有画了 physical route 的部分**（未路由点位不进量，见 coverage.unroutedPoints）。
     * 电工管（φ20/φ25）必须用这两个数计价：只算 drawnM 会漏掉约六成管。
     */
    drawnRouteUnionM: number;
    /** **计价口径（唯一）**：同回路 union（只含已画线路由）。逻辑口径不得用于采购计价。 */
    strongPowerTotalM: number;
    /** 诊断：Σ各条长度（逻辑口径，含多回路并排与同回路星形重复）。 */
    strongPowerLogicalM: number;
    /** 诊断：强电全部画线路由跨回路去重后的理论下限。 */
    strongPowerUnionAllM: number;
    /** 计价组成：Σ_回路 union(该回路画线路由)。 */
    strongPowerUnionPerCircuitM: number;
    weakPowerTotalM: number;

  };
  /** 主干（端点不归属任何回路的 physical route 段）长度；线径未裁定前单独显形。 */
  trunkConduitM: number;
  /** 不归属任何回路的控制/信号管长（开关控制线走 controls 绑定后仍剩的，如空调线控器）。 */
  controlConduitM: number;
  wire: { bySize: WireBucket[]; totalWireM: number; dualControlExtraM: number; lossApplied: number };
  cable: { cat6M: number; extraCoresApplied: Record<string, number> };
  pipe: {
    water: PipeBucket[];
    drainage: PipeBucket[];
    totalWaterM: number;
    totalDrainageM: number;
    lossApplied: number;
  };
  devices: {
    boxes: number;
    panelModules: number;
    breakers: { total: number; withRcd: number; mcbOnly: number };
    penetrations: number;
    declared: Record<string, { count: number; basis: string }>;
  };
  coverage: {
    routedPointIds: string[];
    unroutedPointIds: string[];
    byType: Record<string, CoverageByType>;
    /** 按房间统计：点数 + 补齐管长 + 已画线路由归属到该房间的长度。 */
    byRoom: Record<string, { points: number; routed: number; unrouted: number; drawnRouteM: number }>;
    /** 未画线路由的点位清单：**不进采购量**，只显形（缺路径就不是可采购数量）。 */
    unroutedPoints: Array<{ id: string; room: string; type: string; circuit?: string }>;
    /** 已画线路由里端点不是电气点位的（主干/内联坐标），单独显形，不摊到任何房间。 */
    unassignedRouteM: number;
  };
  /** 按回路统计导线：哪条回路吃了多少管、多少线。 */
  byCircuit: Array<{ circuitId: string; purpose: string; wireSize: string; conduitM: number; cores: number; wireM: number }>;
  /** 已声明「要求」但没画线的路由：不计长度，只显形（如给水入户总管、热水支路）。 */
  requirementRoutes: Array<{ id: string; layer: string; routeKind: string; note?: string }>;
  /** 已知要发生但本期不激活/未裁定的事项（不是错误，但报价前必须看）。 */
  deferred: Array<{ id: string; reason: string }>;
  /**
   * Items which cannot be derived from the declarations.  `kind: pending`
   * means the omission is an explicit project decision still awaiting
   * confirmation (for example the incoming trunk cable size); all other
   * items are configuration/data errors and must fail the verification gate.
   */
  unresolved: Array<{ id: string; reason: string; kind?: 'error' | 'pending' }>;
  /** A compact, machine-readable view of all quote blockers. */
  blockers: Array<{ id: string; reason: string; kind: 'pending' | 'requirement' | 'deferred' | 'error' }>;
  excluded: Array<{ layer?: string; id?: string; reason: string; routes?: number }>;
  /** unresolved、未画要求路由和 deferred 均清零才允许进入报价；否则下游必须 comparable:false。 */
  feasibleForQuote: boolean;
}

const EPS = 1e-9;

/** 从 "1.5mm²(φ16)" / "4.0mm²(φ20)" 里取标称截面；解析不了返回 null（不猜）。 */
export function parseWireSizeMm2(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /(\d+(?:\.\d+)?)\s*mm²/.exec(raw);
  return match ? match[1] : null;
}

const SUPPLY_TYPES = new Set(['faucet', 'toilet', 'shower', 'washer', 'faucet_outdoor']);
const BOX_TYPES = new Set(['socket', 'floor_socket', 'switch', 'switch_2way', 'network', 'usb']);

type PipeSegmentSpec = {
  fromIndex: number;
  toIndex: number;
  waterTemp?: 'hot' | 'cold' | 'mixed';
  waterDn?: 20 | 25 | 32;
  drainDn?: 50 | 75 | 110;
};

function validFinite(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum;
}

function validateTakeoffRules(rules: MepTakeoffRules): Array<{ id: string; reason: string }> {
  const issues: Array<{ id: string; reason: string }> = [];
  const check = (id: string, value: unknown, minimum = 0): void => {
    if (!validFinite(value, minimum)) issues.push({ id, reason: `${id} 必须是有限数值且 >= ${minimum}，实际为 ${String(value)}` });
  };
  for (const [purpose, value] of Object.entries(rules.units?.cores_by_purpose ?? {})) {
    check(`rules.units.cores_by_purpose.${purpose}`, value, 1);
  }
  check('rules.units.dual_control_extra_cores', rules.units?.dual_control_extra_cores);
  for (const [id, value] of Object.entries(rules.units?.weak_extra_cores ?? {})) check(`rules.units.weak_extra_cores.${id}`, value);
  check('rules.units.loss.wire', rules.units?.loss?.wire, Number.EPSILON);
  check('rules.units.loss.pipe', rules.units?.loss?.pipe, Number.EPSILON);
  check('rules.panel.main_switch_poles', rules.panel?.main_switch_poles);
  check('rules.panel.spd_modules', rules.panel?.spd_modules);
  check('rules.panel.spare_ratio', rules.panel?.spare_ratio);
  return issues;
}

function isDeferredElectricalPoint(point: ElectricalPoint | undefined): boolean {
  return point?.position_status === 'pending' && point.status === 'pending';
}

function deferredElectricalPointReason(): string {
  return '点位 status 与 position_status 均为 pending：当前不进入可报价的回路、管线和底盒量；裁定并确认后再同步位置、墙体、路线及回路归属';
}

function pipeKeysForWater(temp: 'hot' | 'cold' | 'mixed', dn: 20 | 25 | 32): string[] {
  // mixed is two physical pipes. Keep the historical mixed key for the hot pipe
  // because the quote card and hot-pipe insulation derive from that key.
  return temp === 'mixed' ? [`mixed/${dn}`, `cold/${dn}`] : [`${temp}/${dn}`];
}

function routePointDistance(points: Array<{ x: number; z: number; y?: number }>, fromIndex: number, toIndex: number): number {
  let length = 0;
  for (let i = fromIndex + 1; i <= toIndex; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
  }
  return length;
}

function routeLength(route: MepRoute, from?: { x: number; z: number; y?: number }, to?: { x: number; z: number; y?: number }): number {
  const points = mepRoutePoints(route, from, to);
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i].x - points[i - 1].x, (points[i].y ?? 0) - (points[i - 1].y ?? 0), points[i].z - points[i - 1].z);
  }
  return length;
}

/**
 * 竖向下引段：路由终点标高是吊顶分层高（强电 2.55 / 给水 0.18），点位自己的安装高度是另一个数
 * （插座 0.3、台盆龙头 0.8）。这段"从顶到点位"的管长是**纯算术**（to_height − point.height），
 * 不猜：只对端点是有点位高度声明的电气/给排水点位计算，负值（灯在顶面上）取 0。
 * 不开这个开关 = 已画线点位系统性少算约 2.2m/个，比不画线点位的 allowance 口径不一致。
 */
function terminalDrop(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  to: { x: number; z: number; y?: number } | undefined,
): number {
  if (typeof route.to !== 'string') return 0;
  const point = points.get(route.to);
  const pointHeight = point?.height;
  if (to === undefined || pointHeight === undefined) return 0;
  const endY = route.to_height ?? to.y ?? 0;
  return Math.max(0, endY - pointHeight);
}


/**
 * 并排去重长度：多回路经常沿同一条天花轴线（走廊 z=4.6 / 边吊）并排走，
 * Σ各条长度会把同一段路径算 N 次。本函数按 5cm 网格求平面路径并集，
 * 得到"走线长度"——**人工/开槽必须按这个数计价**（同一条槽并排 3~4 根管只开一次），
 * 而**管材必须按各条长度之和计价**（每回路各有其管）。两个数用途不同，不可互换。
 */
export function unionPlanLength(paths: Array<Array<{ x: number; z: number }>>, cell = 0.05): number {
  const seen = new Set<string>();
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(d / cell));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = Math.round((a.x + (b.x - a.x) * t) / cell) * cell;
        const z = Math.round((a.z + (b.z - a.z) * t) / cell) * cell;
        seen.add(`${x.toFixed(2)},${z.toFixed(2)}`);
      }
    }
  }
  return seen.size * cell;
}

export function computeMepTakeoff(input: MepTakeoffInput): MepTakeoff {
  const { electrical, plumbing, circuits, controls = [], routes, resolution, rules } = input;
  const covered = new Set(rules.covered_layers);
  const unresolved: MepTakeoff['unresolved'] = validateTakeoffRules(rules).map((item) => ({ ...item, kind: 'error' }));
  const deferred: MepTakeoff['deferred'] = [];
  const excluded: MepTakeoff['excluded'] = rules.excluded_layers.map((item) => ({ layer: item.layer, reason: item.reason, routes: 0 }));
  const excludedIndex = new Map(rules.excluded_layers.map((item, index) => [item.layer, index]));
  for (const item of rules.non_mep_items ?? []) excluded.push({ id: item.id, reason: item.reason });
  const nonMepPointIds = new Set((rules.non_mep_items ?? []).map((item) => item.id));

  const elecById = new Map(electrical.map((point) => [point.id, point]));
  const plumbById = new Map(plumbing.map((point) => [point.id, point]));
  const circuitById = new Map(circuits.map((circuit) => [circuit.id, circuit]));
  // 点位安装高度（竖向下引段用）：只收显式声明了 height 的点
  const pointHeights = new Map<string, { height?: number }>();
  for (const point of [...electrical, ...plumbing]) if (point.height !== undefined) pointHeights.set(point.id, { height: point.height });

  // ---------- 点位 → 回路 的三条声明通道（都不猜）----------
  // ① topology.member_point_ids：回路成员（79/111 个点位）
  const pointCircuit = new Map<string, string>();
  for (const circuit of circuits) {
    for (const member of circuit.member_point_ids ?? []) {
      if (!pointCircuit.has(member)) pointCircuit.set(member, circuit.id);
    }
  }
  // ② controls.switch_point_ids → target_point_ids：开关受控灯具所属回路（双控/三控的开关本身不是成员）
  const pointByIdCircuit = new Map(electrical.map((point) => [point.id, point.circuit]));
  for (const control of controls) {
    const targets = (control.target_point_ids ?? []).map((id) => pointCircuit.get(id) ?? pointByIdCircuit.get(id)).filter((value): value is string => Boolean(value));
    for (const switchId of control.switch_point_ids ?? []) {
      if (targets.length > 0 && !pointCircuit.has(switchId)) pointCircuit.set(switchId, targets[0]);
    }
  }
  const resolvedById = new Map(resolution.routes.map((item) => [item.route.id, item]));
  const drawnPlanPaths: Array<Array<{ x: number; z: number }>> = [];
  /** 每条回路的画线路由平面路径（同回路 union：同一回路内共享段只铺一次管、只穿一次线）。 */
  const circuitPaths = new Map<string, Array<Array<{ x: number; z: number }>>>();
  const strongPaths: Array<Array<{ x: number; z: number }>> = [];
  const byRoom: Record<string, { points: number; routed: number; unrouted: number; drawnRouteM: number }> = {};
  const unroutedPoints: Array<{ id: string; room: string; type: string; circuit?: string }> = [];
  const roomOf = (id: string): string | undefined => elecById.get(id)?.room;
  const bumpRoom = (room: string, field: 'points' | 'routed' | 'unrouted' | 'drawnRouteM', value = 1): void => {
    byRoom[room] ??= { points: 0, routed: 0, unrouted: 0, drawnRouteM: 0 };
    (byRoom[room] as unknown as Record<string, number>)[field] += value;
  };
  let unassignedRouteM = 0;

  // 只有 position_status/status 都为 pending 才从正式算量中延期。
  // 仅 position_status pending 的设备仍可能已经进入正式回路，不能误删；
  // 两者同时 pending 则代表点位尚未具备可报价/施工的稳定归属（包括预留接口和待量房墙体归属）。
  for (const point of electrical) {
    if (isDeferredElectricalPoint(point)) {
      deferred.push({ id: point.id, reason: deferredElectricalPointReason() });
    }
  }

  // ---------- 1. 逐路由：物理路由计长 + 归属；要求路由只显形 ----------
  const layerLength: Record<string, number> = {};
  const circuitConduit = new Map<string, number>();
  const switch2WayLength = new Map<string, number>();
  let trunkConduitM = 0;
  let controlConduitM = 0;
  let drawnMWithoutDrop = 0;
  let cat6M = 0;
  const cat6Extra: Record<string, number> = {};
  let penetrations = 0;
  const requirementRoutes: MepTakeoff['requirementRoutes'] = [];
  const drawnPointIds = new Set<string>();

  /** 把一段 physical route 的长度记到某个回路上；weak 层记 Cat6。 */
  const attribute = (route: MepRoute, length: number, endpoints: Array<string | { x: number; z: number }>): void => {
    const ids = endpoints.filter((value): value is string => typeof value === 'string');
    if (route.layer === 'weak_power') {
      cat6M += length;
      for (const id of ids) {
        const extra = rules.units.weak_extra_cores?.[id];
        const point = elecById.get(id);
        if (validFinite(extra) && extra > 0 && point?.type === 'network') cat6Extra[id] = (cat6Extra[id] ?? 0) + length * extra;
      }
      return;
    }
    if (route.layer !== 'strong_power') return;
    for (const id of ids) {
      const point = elecById.get(id);
      if (point?.type === 'switch' || point?.type === 'switch_2way') switch2WayLength.set(id, (switch2WayLength.get(id) ?? 0) + length / Math.max(ids.length, 1));
    }
    const circuitId = ids.map((id) => pointCircuit.get(id)).find((value): value is string => Boolean(value));
    if (circuitId) {
      circuitConduit.set(circuitId, (circuitConduit.get(circuitId) ?? 0) + length);
      return;
    }
    const hasSignalOnly = ids.every((id) => elecById.get(id)?.type === 'ac_controller');
    if (hasSignalOnly && ids.length > 0) {
      controlConduitM += length;
      return;
    }
    trunkConduitM += length;
  };

  for (const route of routes) {
    const layer = route.layer;
    if (!covered.has(layer)) {
      const index = excludedIndex.get(layer);
      if (index !== undefined) excluded[index].routes = (excluded[index].routes ?? 0) + 1;
      continue;
    }
    const resolved = resolvedById.get(route.id);
    if (!resolved || resolved.unresolved.length > 0) {
      unresolved.push({ id: route.id, reason: `端点未解析：${resolved?.unresolved.join('/') ?? 'missing resolution'}`, kind: 'error' });
      continue;
    }
    if (!resolved.metadata.physicalRoute) {
      requirementRoutes.push({ id: route.id, layer, routeKind: resolved.metadata.routeKind ?? 'requirement', note: resolved.metadata.warning });
      continue;
    }
    const deferredEndpoint = [route.from, route.to].find((endpoint) => typeof endpoint === 'string' && isDeferredElectricalPoint(elecById.get(endpoint)));
    if (deferredEndpoint) {
      // A pending reserve must not become routed coverage or consume material.
      continue;
    }
    penetrations += Array.isArray(route.penetration) ? route.penetration.length : 0;
    const drawnLength = routeLength(route, resolved.from, resolved.to);
    drawnMWithoutDrop += drawnLength;
    const planPath = mepRoutePoints(route, resolved.from, resolved.to).map((point) => ({ x: point.x, z: point.z }));
    drawnPlanPaths.push(planPath);
    if (route.layer === 'strong_power') strongPaths.push(planPath);
    const circuitId = typeof route.to === 'string' ? pointCircuit.get(route.to) : undefined;
    if (circuitId) {
      const list = circuitPaths.get(circuitId) ?? [];
      list.push(planPath);
      circuitPaths.set(circuitId, list);
    }
    const endRoom = typeof route.to === 'string' ? roomOf(route.to) : undefined;
    if (endRoom) bumpRoom(endRoom, 'drawnRouteM', routeLength(route, resolved.from, resolved.to));
    else unassignedRouteM += routeLength(route, resolved.from, resolved.to);
    const length = drawnLength + (rules.include_terminal_drop ? terminalDrop(route, pointHeights, resolved.to) : 0);
    layerLength[layer] = (layerLength[layer] ?? 0) + length;
    for (const endpoint of [route.from, route.to]) {
      if (typeof endpoint === 'string') drawnPointIds.add(endpoint);
    }
    attribute(route, length, [route.from, route.to]);
  }

  // ---------- 2. 覆盖度：哪些点位没有 physical route ----------
  // 铁律（2026-10-07 业主裁定）：**没有路由的点位不进采购量**——只进 unroutedPoints 清单显形，
  // 等补齐路由（或量房）后再进量。禁止用"每点几米"的经验值把无路径点位凑进采购数量。
  const allowanceByType: Record<string, CoverageByType> = {};
  const routedPointIds: string[] = [];
  const unroutedPointIds: string[] = [];

  const considerPoint = (point: ElectricalPoint | PlumbingPoint, kind: 'electrical' | 'plumbing'): void => {
    if (nonMepPointIds.has(point.id)) return; // 燃气表/烟道：已在 excluded 显形，不进水电量
    if (kind === 'electrical' && isDeferredElectricalPoint(point as ElectricalPoint)) return;
    const type = point.type;
    allowanceByType[type] ??= { total: 0, routed: 0, unrouted: 0 };
    allowanceByType[type].total += 1;
    const room = ('room' in point && typeof point.room === 'string' ? point.room : undefined) ?? 'unknown';
    bumpRoom(room, 'points');
    if (drawnPointIds.has(point.id)) {
      allowanceByType[type].routed += 1;
      routedPointIds.push(point.id);
      bumpRoom(room, 'routed');
      return;
    }
    allowanceByType[type].unrouted += 1;
    unroutedPointIds.push(point.id);
    bumpRoom(room, 'unrouted');
    // 没有路由 = 没有可采购的长度。只登记，不估米数。
    unroutedPoints.push({
      id: point.id,
      room,
      type,
      ...(kind === 'electrical' && pointCircuit.get(point.id) ? { circuit: pointCircuit.get(point.id) } : {}),
    });
  };
  for (const point of electrical) considerPoint(point, 'electrical');
  for (const point of plumbing) considerPoint(point, 'plumbing');

  const drawnM = Object.values(layerLength).reduce((sum, value) => sum + value, 0);

  // 同回路 union：同一回路内多端点星形回线的共享段只铺一次管、只穿一次线
  const circuitUnion = new Map<string, number>();
  for (const [circuitId, paths] of circuitPaths) circuitUnion.set(circuitId, unionPlanLength(paths));
  const strongUnionPerCircuitM = [...circuitUnion.values()].reduce((sum, value) => sum + value, 0);
  // ---------- 3. 导线：按回路线径分桶 ----------
  const buckets = new Map<string, WireBucket>();
  for (const circuit of circuits) {
    // 导线 = 该回路物理布线树（同回路 union，共享段只穿一次线）× 芯数 × 损耗。
    // 不能用 Σ各条长度：同一回路多端点星形回线会把共享段穿 N 次线。
    const conduit = circuitUnion.get(circuit.id) ?? 0;
    if (conduit <= EPS) continue;
    const wireSize = parseWireSizeMm2(circuit.wire_size);
    if (!wireSize) {
      unresolved.push({ id: circuit.id, reason: `回路 ${circuit.id} 有 ${conduit.toFixed(2)}m 管长但 wire_size 无法解析（${circuit.wire_size ?? '未声明'}）`, kind: 'error' });
      continue;
    }
    const cores = rules.units.cores_by_purpose[circuit.purpose ?? ''] ?? null;
    if (cores === null || !validFinite(cores, 1)) {
      unresolved.push({ id: circuit.id, reason: `回路 ${circuit.id} purpose=${circuit.purpose ?? '未声明'} 在 units.cores_by_purpose 未声明芯数`, kind: 'error' });
      continue;
    }
    const bucket = buckets.get(wireSize) ?? { wireSize, conduitM: 0, cores, wireM: 0, circuits: [] };
    bucket.conduitM += conduit;
    bucket.wireM += conduit * cores;
    bucket.circuits.push(circuit.id);
    buckets.set(wireSize, bucket);
  }
  let dualControlExtraM = 0;
  for (const [pointId, length] of switch2WayLength) {
    if (elecById.get(pointId)?.type !== 'switch_2way') continue;
    const extraCores = validFinite(rules.units.dual_control_extra_cores) ? rules.units.dual_control_extra_cores : 0;
    dualControlExtraM += length * extraCores;
  }
  const wireLoss = validFinite(rules.units.loss.wire, Number.EPSILON) ? rules.units.loss.wire : 1;
  const pipeLoss = validFinite(rules.units.loss.pipe, Number.EPSILON) ? rules.units.loss.pipe : 1;
  for (const bucket of buckets.values()) bucket.wireM *= wireLoss;
  const totalWireM = [...buckets.values()].reduce((sum, bucket) => sum + bucket.wireM, 0) + dualControlExtraM * wireLoss;
  if (trunkConduitM > EPS && !rules.trunk_wire_size) {
    unresolved.push({
      id: 'trunk_strong_main',
      reason: rules.trunk_wire_size === null
        ? `主干 ${trunkConduitM.toFixed(1)}m 未归属任何回路，trunk_wire_size 未裁定（口径见 config/mep-takeoff.yaml trunk_note）`
        : `主干 ${trunkConduitM.toFixed(1)}m 缺少有效 trunk_wire_size 声明（必须显式填规格，或用 null 登记待裁定）`,
      kind: rules.trunk_wire_size === null ? 'pending' : 'error',
    });
  }
  if (controlConduitM > EPS) {
    deferred.push({ id: 'ac_controller_signal', reason: `空调线控器信号管 ${controlConduitM.toFixed(1)}m：归属空调商还是水电未声明，材料不进水电量` });
  }

  // ---------- 4. 管材：给水按冷热×口径，排水按口径 ----------
  const water = new Map<string, PipeBucket>();
  const drainage = new Map<string, PipeBucket>();
  const pipeIssues = new Set<string>();
  const pipeUnresolved = (id: string, reason: string): void => {
    if (pipeIssues.has(id)) return;
    pipeIssues.add(id);
    unresolved.push({ id, reason, kind: 'error' });
  };
  const addPipe = (buckets: Map<string, PipeBucket>, key: string, length: number): void => {
    const bucket = buckets.get(key) ?? { key, meters: 0 };
    bucket.meters += length;
    buckets.set(key, bucket);
  };
  const routeSegments = (route: MepRoute, resolved: ResolvedMepRoute): Array<{ length: number; spec: PipeSegmentSpec }> | null => {
    const points = mepRoutePoints(route, resolved.from, resolved.to);
    const declared = rules.pipe_route_segments?.[route.id];
    if (!declared) return null;
    const segments = declared.map((segment) => ({
      fromIndex: segment.from_index,
      toIndex: segment.to_index,
      waterTemp: segment.water_temp,
      waterDn: segment.water_dn,
      drainDn: segment.drain_dn,
    }));
    let expectedFrom = 0;
    for (const segment of segments) {
      if (!Number.isInteger(segment.fromIndex) || !Number.isInteger(segment.toIndex)
        || segment.fromIndex !== expectedFrom || segment.toIndex <= segment.fromIndex || segment.toIndex >= points.length) {
        pipeUnresolved(route.id, `路由已声明 pipe_route_segments，但分段下标不连续或越界；必须从 0 连续覆盖到 ${points.length - 1}`);
        return [];
      }
      if (route.layer === 'water_supply' && (segment.waterTemp === undefined || segment.waterDn === undefined || segment.drainDn !== undefined)) {
        pipeUnresolved(route.id, '给水 pipe_route_segments 必须逐段声明 water_temp + water_dn，且不得混入 drain_dn');
        return [];
      }
      if (route.layer === 'drainage' && (segment.drainDn === undefined || segment.waterTemp !== undefined || segment.waterDn !== undefined)) {
        pipeUnresolved(route.id, '排水 pipe_route_segments 必须逐段声明 drain_dn，且不得混入 water_temp/water_dn');
        return [];
      }
      expectedFrom = segment.toIndex;
    }
    if (expectedFrom !== points.length - 1) {
      pipeUnresolved(route.id, `路由已声明 pipe_route_segments，但未覆盖完整折线（应覆盖到 ${points.length - 1}）`);
      return [];
    }
    return segments.map((segment, index) => ({
      length: routePointDistance(points, segment.fromIndex, segment.toIndex)
        + (index === segments.length - 1 && rules.include_terminal_drop ? terminalDrop(route, pointHeights, resolved.to) : 0),
      spec: segment,
    }));
  };
  const attributePipe = (route: MepRoute, resolved: ResolvedMepRoute): void => {
    const explicit = routeSegments(route, resolved);
    if (explicit !== null) {
      for (const segment of explicit) {
        if (route.layer === 'water_supply') {
          for (const key of pipeKeysForWater(segment.spec.waterTemp!, segment.spec.waterDn!)) addPipe(water, key, segment.length);
        } else {
          addPipe(drainage, `de${segment.spec.drainDn!}`, segment.length);
        }
      }
      return;
    }

    const ids = [route.from, route.to].filter((value): value is string => typeof value === 'string');
    if (ids.length !== 2) {
      pipeUnresolved(route.id, `${route.layer === 'water_supply' ? '给水' : '排水'}路由含坐标端点，未声明端点规格；不能按单个点位猜整条管径/冷热，需补 pipe_route_segments`);
      return;
    }
    if (route.layer === 'water_supply') {
      const points = ids.map((id) => plumbById.get(id));
      if (points.some((point) => !point || !SUPPLY_TYPES.has(point.type))) {
        pipeUnresolved(route.id, '给水路由端点必须全部引用 faucet/toilet/shower/washer 等给水点位，坐标端点或非给水点位需显式 pipe_route_segments');
        return;
      }
      const specs = points.map((point) => ({ temp: point!.water_temp, dn: point!.water_dn }));
      if (specs.some((spec) => spec.temp === undefined || spec.dn === undefined)) {
        pipeUnresolved(route.id, '给水路由端点缺 water_temp/water_dn 声明，管材无法分桶');
        return;
      }
      if (specs[0]!.temp !== specs[1]!.temp || specs[0]!.dn !== specs[1]!.dn) {
        pipeUnresolved(route.id, `给水端点规格冲突（${ids[0]}=${specs[0]!.temp}/${specs[0]!.dn}，${ids[1]}=${specs[1]!.temp}/${specs[1]!.dn}）；禁止按首个端点扩散，需显式 pipe_route_segments`);
        return;
      }
      const length = routeLength(route, resolved.from, resolved.to)
        + (rules.include_terminal_drop ? terminalDrop(route, pointHeights, resolved.to) : 0);
      for (const key of pipeKeysForWater(specs[0]!.temp!, specs[0]!.dn!)) addPipe(water, key, length);
      return;
    }
    const points = ids.map((id) => plumbById.get(id));
    if (points.some((point) => !point || (point.type !== 'drain' && point.type !== 'drain_riser'))) {
      pipeUnresolved(route.id, '排水路由端点必须全部引用 drain/drain_riser 点位，坐标端点或其他点位需显式 pipe_route_segments');
      return;
    }
    const dns = points.map((point) => point!.drain_dn);
    if (dns.some((dn) => dn === undefined)) {
      pipeUnresolved(route.id, '排水路由端点缺 drain_dn 声明，管材无法分桶');
      return;
    }
    if (dns[0] !== dns[1]) {
      pipeUnresolved(route.id, `排水端点口径冲突（${ids[0]}=de${dns[0]}，${ids[1]}=de${dns[1]}）；禁止按首个端点扩散，需显式 pipe_route_segments`);
      return;
    }
    const length = routeLength(route, resolved.from, resolved.to)
      + (rules.include_terminal_drop ? terminalDrop(route, pointHeights, resolved.to) : 0);
    addPipe(drainage, `de${dns[0]}`, length);
  };
  for (const route of routes) {
    if (route.layer !== 'water_supply' && route.layer !== 'drainage') continue;
    const resolved = resolvedById.get(route.id);
    if (!resolved || resolved.unresolved.length > 0 || !resolved.metadata.physicalRoute) continue;
    attributePipe(route, resolved);
  }
  for (const bucket of water.values()) bucket.meters *= pipeLoss;
  for (const bucket of drainage.values()) bucket.meters *= pipeLoss;

  // ---------- 5. 设备量 ----------
  const boxes = electrical.filter((point) => BOX_TYPES.has(point.type) && !isDeferredElectricalPoint(point)).length;
  const withRcd = circuits.filter((circuit) => /漏保/.test(circuit.breaker ?? '')).length;
  const mainSwitchPoles = validFinite(rules.panel.main_switch_poles) ? rules.panel.main_switch_poles : 0;
  const spdModules = validFinite(rules.panel.spd_modules) ? rules.panel.spd_modules : 0;
  const spareRatio = validFinite(rules.panel.spare_ratio) ? rules.panel.spare_ratio : 0;
  const rawModules = circuits.length + mainSwitchPoles + spdModules;
  const panelModules = rules.panel.round_up
    ? Math.ceil(rawModules * (1 + spareRatio) - EPS)
    : rawModules * (1 + spareRatio);
  const anyPending = resolution.routes.some(
    (item) => covered.has(item.route.layer) && item.metadata.physicalRoute && item.route.construction_status !== 'confirmed',
  );

  const blockers: MepTakeoff['blockers'] = [
    ...unresolved.map((item) => ({ id: item.id, reason: item.reason, kind: item.kind === 'pending' ? 'pending' as const : 'error' as const })),
    ...requirementRoutes.map((item) => ({ id: item.id, reason: item.note ?? '已声明要求但尚未形成 physical route', kind: 'requirement' as const })),
    ...deferred.map((item) => ({ id: item.id, reason: item.reason, kind: 'deferred' as const })),
  ];

  return {
    status: anyPending ? 'estimated_from_routes' : 'measured_after_survey',
    conduit: {
      strongPowerM: layerLength.strong_power ?? 0,
      weakPowerM: layerLength.weak_power ?? 0,
      waterSupplyM: layerLength.water_supply ?? 0,
      drainageM: layerLength.drainage ?? 0,
      totalM: drawnM,
      drawnM,
      terminalDropM: drawnM - drawnMWithoutDrop,
      /** 已画线路由去重后的走线长度（并排只算一次）：人工/开槽按这个计价，管材按各条长度之和。 */
      drawnRouteUnionM: unionPlanLength(drawnPlanPaths),
      strongPowerTotalM: strongUnionPerCircuitM,
      strongPowerLogicalM: layerLength.strong_power ?? 0,
      strongPowerUnionAllM: unionPlanLength(strongPaths),
      strongPowerUnionPerCircuitM: strongUnionPerCircuitM,
      weakPowerTotalM: layerLength.weak_power ?? 0,
    },
    trunkConduitM,
    controlConduitM,
    wire: {
      bySize: [...buckets.values()].sort((a, b) => Number(a.wireSize) - Number(b.wireSize)),
      totalWireM,
      dualControlExtraM: dualControlExtraM * wireLoss,
      lossApplied: wireLoss,
    },
    cable: { cat6M: cat6M * wireLoss, extraCoresApplied: cat6Extra },
    pipe: {
      water: [...water.values()].sort((a, b) => a.key.localeCompare(b.key)),
      drainage: [...drainage.values()].sort((a, b) => a.key.localeCompare(b.key)),
      totalWaterM: [...water.values()].reduce((sum, bucket) => sum + bucket.meters, 0),
      totalDrainageM: [...drainage.values()].reduce((sum, bucket) => sum + bucket.meters, 0),
      lossApplied: pipeLoss,
    },
    devices: {
      boxes,
      panelModules,
      breakers: { total: circuits.length, withRcd, mcbOnly: circuits.length - withRcd },
      penetrations,
      declared: rules.declared_devices ?? {},
    },
    coverage: {
      routedPointIds: routedPointIds.sort(),
      unroutedPointIds: unroutedPointIds.sort(),
      byType: allowanceByType,
      byRoom,
      unassignedRouteM,
      unroutedPoints,
    },
    byCircuit: circuits.map((circuit) => {
      const bucket = [...buckets.values()].find((item) => item.circuits.includes(circuit.id));
      const conduit = circuitUnion.get(circuit.id) ?? 0;
      return {
        circuitId: circuit.id,
        purpose: circuit.purpose ?? '未声明',
        wireSize: bucket?.wireSize ?? '未解析',
        conduitM: conduit,
        cores: bucket?.cores ?? 0,
        wireM: conduit * (bucket?.cores ?? 0) * rules.units.loss.wire,
      };
    }).sort((a, b) => b.conduitM - a.conduitM),
    requirementRoutes,
    deferred,
    unresolved,
    blockers,
    excluded,
    // Keep the quote gate tied to the single blocker list so a newly surfaced
    // pending/deferred category cannot accidentally bypass the gate.
    feasibleForQuote: blockers.length === 0,
  };
}
