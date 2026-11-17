/**
 * 水电子系统 · 算量与成本数据底座（L2 → L3 之间的唯一派生层）。
 *
 * 为什么需要它：PKG-040 的 9 个 COST 全是泛称（"给水管改造""电线线管底盒"），100 个点位 + 20 回路
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
  type MepRoute,
  type MepRouteResolutionReport,
} from './mep-hvac-coordination-schema.js';
import { deriveMepPenetrationPoint, type PenetrationWallShape } from './mep-hvac-lint.js';
import { derivePointCircuits } from './point-circuits.js';
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
  /**
   * 唯一事实源路径清单（CLI/verify 按它读文件，配置与代码不双写路径）。
   *
   * 2026-11-07（issue #98 第三阶段 S6）：原 `ceiling` 键已删——吊顶声明文件的路径在
   * shared/envelope-sources.ts 的来源注册表（源名 ceiling），消费方用 `sourceFile('ceiling')`
   * 取。留在本表就是第六张各抄一份的「文件路径当身份」表（S1 搬迁后全都要改）。
   */
  sources: {
    electrical_points: string;
    plumbing_points: string;
    circuits: string;
    routes: string;
    hvac: string;
  };
  covered_layers: string[];
  excluded_layers: Array<{ layer: string; reason: string }>;
  units: {
    cores_by_purpose: Record<string, number>;
    dual_control_extra_cores: number;
    /** 弱点位额外芯数（如 net_gateway 需 2 根 Cat6：WAN 上联 + LAN 回弱电箱）。 */
    weak_extra_cores?: Record<string, number>;
    loss: { wire: number; pipe: number };
    /**
     * 管件系数（个/m）：管材按米计价、管件按个计价，两者之间只允许这一个换算系数。
     * 缺失即抛错——过去它硬编码在 server/mep-quotes.ts 里（0.35 / 0.27），
     * 依据只写在报价卡 scope_note 的散文里，代码与散文无法对账。
     */
    fitting_per_meter: { ppr: number; pvc: number };
  };
  trunk_wire_size: string | null;
  /** 是否把路由终点到点位安装高度的竖向下引段计入管长（纯算术：to_height − point.height）。 */
  include_terminal_drop: boolean;
  panel: { main_switch_poles: number; spd_modules: number; spare_ratio: number; round_up: boolean };
  declared_devices?: Record<string, { count: number; basis: string }>;
  non_mep_items?: Array<{ id: string; reason: string }>;
  /**
   * 给排水路由需要跨规格时，必须按 route point index 显式分段。
   * from_index/to_index 指统一出口 resolved.points 的下标，
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
  /**
   * 穿墙孔数的派生墙几何（issue #98 第五阶段 S3）：传入时孔数 = 每条穿墙声明按「路线折线 ∩
   * 墙段唯一交点」派生（shared/mep-hvac-lint.ts deriveMepPenetrationPoint，与 lint 同一算法），
   * 不可派生的条目（贴墙段/端点压墙线/意图点/多交点）必须保留手写 at，否则 fail-closed 进
   * unresolved(error) 且不计孔——不再「只数数组长度」。生产调用方（takeoff:mep /
   * verify:mep-takeoff / cost-summary）必须传；缺省只留给手搭输入的单元测试（旧口径：数组长度）。
   */
  penetrationWalls?: readonly PenetrationWallShape[];
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
    /**
     * 管件数量（个）：按 `units.fitting_per_meter` 从管长派生的**量**，报价层只读不读系数。
     * PPR 给水管件随给水管长、PVC 排水管件随排水管长。缺失系数时整个 takeoff 抛错，
     * 不会退化成"管件 0 个"或"管件按 1.0 个/m"——那分别是静默漏计与静默多计。
     */
    fittings: { ppr: number; pvc: number };
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

const SUPPLY_TYPES = new Set(['faucet', 'toilet', 'shower', 'washer', 'faucet_outdoor', 'water_supply', 'water_heater']);
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

/**
 * 算量规则取值：**缺失/非法即抛错**（2026-10-14 阶段 4：清除会算错钱的静默兜底）。
 *
 * 这些值过去都写成 `validFinite(x) ? x : <兜底>`（导线/管材损耗 1.0、双控附加 0 芯、
 * 主开关 0 极、SPD 0 模、余量 0）。`validateTakeoffRules` 会把缺项记进
 * `unresolved(kind: 'error')`，下游据此把 `feasibleForQuote` 置 false——但**数字照样按
 * 兜底值算出来**：任何忽略 feasibleForQuote 的消费方（报价卡、采购单、budget）都会拿到
 * 一份"结构完整、其实少了 5%~8% 损耗"的量。
 *
 * 「不可报价」与「数字是错的」必须同时成立，不能用前者代替后者。所以这里在动手算之前
 * 先 fail-closed：宁可整表不出，也不出一份错表。错误信息直接指去哪补。
 */
function requireRule(value: unknown, key: string, minimum = Number.EPSILON): number {
  if (!validFinite(value, minimum)) {
    throw new Error(
      `config/mep-takeoff.yaml 的 ${key} 必须是有限数值且 >= ${minimum}（实际 ${String(value)}）：算量规则缺失时不按兜底值继续算——那会让管长/导线/模数静默偏离声明，请补该字段`,
    );
  }
  return value as number;
}

/** 折线点最小形状（统一出口 resolved.points 的产出 / route.via 的声明）。 */
type RoutePoint = { x: number; z: number; y?: number };

/**
 * 折线点的标高：**缺 y 即抛错**（2026-10-14 阶段 4）。
 *
 * 旧代码 `(b.y ?? 0) - (a.y ?? 0)` 把「没声明标高」当成「标高 0」，于是吊顶内 2.55m 的
 * 一段水平管会被算成 2.55m 的竖直段——管长凭空多出一大截，而 `byCircuit` 诊断表上看不出
 * 任何异常（它只显示管长，不显示标高）。标高是算量输入，不是可以默认的观感参数。
 */
function requirePointY(point: RoutePoint, label: string): number {
  if (point.y === undefined) {
    throw new Error(
      `${label} 的折线点 (${point.x}, ${point.z}) 缺 y 标高：不能按 0 计算，否则吊顶内的水平段会被算成竖直段、管长凭空变长。请到 config/mep-hvac-coordination.yaml 补该点的 y（或该路由的 from_height/to_height）`,
    );
  }
  return point.y;
}

/** 折线边长（含竖向分量）；任一端点缺 y 即抛错（见 requirePointY）。 */
function routeSegmentLength(a: RoutePoint, b: RoutePoint, label: string): number {
  return Math.hypot(b.x - a.x, requirePointY(b, label) - requirePointY(a, label), b.z - a.z);
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

function routePointDistance(points: Array<{ x: number; z: number; y?: number }>, fromIndex: number, toIndex: number, label: string): number {
  let length = 0;
  for (let i = fromIndex + 1; i <= toIndex; i += 1) {
    length += routeSegmentLength(points[i - 1], points[i], label);
  }
  return length;
}

function routeLength(route: MepRoute, points: Array<{ x: number; z: number; y?: number }>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += routeSegmentLength(points[i - 1], points[i], `路由 ${route.id}`);
  }
  return length;
}

/**
 * 竖向下引段：路由终点标高是吊顶分层高（强电 2.55 / 给水 0.18），点位自己的安装高度是另一个数
 * （插座 0.3、台盆龙头 0.8）。这段"从顶到点位"的管长是**纯算术**（to_height − point.height），
 * 不猜：只对端点是有点位高度声明的电气/给排水点位计算，负值（灯在顶面上）取 0。
 * 不开这个开关 = 已画线点位系统性少算约 2.2m/个，比不画线点位的 allowance 口径不一致。
 */
/**
 * 竖向下引段的标高跨度：{ endY（路由终点标高）, pointHeight（点位安装高度） }。
 * 不适用（终点非点位引用 / 端点未解析 / 点位无高度声明 / 终点不高于点位）返回 null。
 * terminalDrop（诊断长度）与回路计价的下引 stub 共用同一判定，不许两处各算一套。
 * 终端标高统一来源（issue #243 step 4）：统一出口折线的末点 y（派生值）；折线为空时
 * 才回退到 route.to_height ?? 端点 y。旧口径（to_height ?? to.y）对删了 to_height 的
 * slope_run 路由会读到端点 y——派生终端与端点声明不一致时，下引段按 stale 的声明算，
 * 终端一动（立管/端点移位）下引不跟随、静默少算。末点缺 y 即抛错（不默认 0）；
 * 折线与声明都缺也抛错。
 * 终点不高于点位（endY <= pointHeight）仍返回 null、下引计 0：这是既有口径，不是
 * 几何不一致——灯具（路由 2.7m vs 灯 2.8m，灯在顶面上）、热水器进水（垫层 0.18m
 * vs 器具接管 1.2m，立管属器具自带尾段）等 13 条路由都按此口径不计下引；把负落差
 * 一律当错误会把既有设计误判（2026-11-15 实测：drain-guest-bath 派生 0.0165m
 * vs 点位 0.02m 差 0.0035m，v1 估算容差内，与灯具/热水器的负落差同口径）。
 */
function terminalDropSpan(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  to: { x: number; z: number; y?: number } | undefined,
  resolvedPoints?: Array<{ x: number; z: number; y?: number }>,
): { endY: number; pointHeight: number } | null {
  if (typeof route.to !== 'string') return null;
  const pointHeight = points.get(route.to)?.height;
  if (to === undefined || pointHeight === undefined) return null;
  // 竖向下引段的终点标高：统一出口折线末点 y 优先；折线为空才回退到声明。
  // 两者都缺 → 旧代码取 0，于是 `Math.max(0, 0 − pointHeight)` 恒为 0，**整段下引管消失**
  // （已画线点位因此系统性少算约 2.2m/个）。标高不可默认：缺声明就抛错。
  // 注：routeLength 的 requirePointY 已经先对折线点 fail-closed（末点缺 y 时本函数
  // 不可达——保留末点缺 y 的抛错是为了让本函数自身自洽，将来若有人在新路径上先调它，
  // 不会静默退回 0）。
  let endY: number;
  const last = resolvedPoints?.[resolvedPoints.length - 1];
  if (last !== undefined) {
    if (last.y === undefined) {
      throw new Error(
        `路由 ${route.id} 的终端标高无法确定（统一出口折线末点缺 y）：竖向下引段会整段消失，已画线点位将少算约 2.2m/个管。请到 config/mep-hvac-coordination.yaml 补该点的 y（或该路由的 from_height/to_height）`,
      );
    }
    endY = last.y;
  } else if (route.to_height !== undefined) endY = route.to_height;
  else if (to.y !== undefined) endY = to.y;
  else {
    throw new Error(
      `路由 ${route.id} 的终点标高无法确定（to_height 与端点 y 均未声明）：竖向下引段会整段消失，已画线点位将少算约 2.2m/个管。请到 config/mep-hvac-coordination.yaml 补 to_height`,
    );
  }
  if (endY <= pointHeight) return null;
  return { endY, pointHeight };
}

function terminalDrop(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  to: { x: number; z: number; y?: number } | undefined,
  resolvedPoints?: Array<{ x: number; z: number; y?: number }>,
): number {
  const span = terminalDropSpan(route, points, to, resolvedPoints);
  return span ? span.endY - span.pointHeight : 0;
}

/**
 * 起点竖直 stub（terminalDrop 的镜像）：折线起点标高高于起点位安装高度时，
 * 位点到折线起点之间那段竖直管/线此前只字未计——terminalDrop 只覆盖 to 端。
 * 实测 13 条路由共 0.2962m（排水 10 条 0.1462m + 强电 3 条 0.15m，
 * 如 strong-light-entry-night-corridor 自 light_corridor_1 2.5m 上行至
 * 折线起点 2.55m 的 0.05m），每条均 ≤0.05m、低于 ±0.15m 精度线，但无守卫时
 * 将来一条起点在 0.3m 插座、from_height 2.55m 的路由会静默少算 2.25m。
 * 负落差（起点标高 ≤ 位点高度）与 to 端同口径不计——器具自带尾段。
 */
function fromDropSpan(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  from: { x: number; z: number; y?: number } | undefined,
  resolvedPoints?: Array<{ x: number; z: number; y?: number }>,
): { startY: number; pointHeight: number } | null {
  if (typeof route.from !== 'string') return null;
  const pointHeight = points.get(route.from)?.height;
  if (from === undefined || pointHeight === undefined) return null;
  // 起点标高：统一出口折线首点 y 优先；折线为空才回退到声明。
  // 两者都缺 → 旧代码取 0，于是 `Math.max(0, 0 − pointHeight)` 恒为 0，整段起点
  // stub 消失。标高不可默认：缺声明就抛错（与 terminalDropSpan 同口径）。
  let startY: number;
  const first = resolvedPoints?.[0];
  if (first !== undefined) {
    if (first.y === undefined) {
      throw new Error(
        `路由 ${route.id} 的起点标高无法确定（统一出口折线首点缺 y）：竖直起点段会整段消失，已画线点位将少算管。请到 config/mep-hvac-coordination.yaml 补该点的 y（或该路由的 from_height/to_height）`,
      );
    }
    startY = first.y;
  } else if (route.from_height !== undefined) startY = route.from_height;
  else if (from.y !== undefined) startY = from.y;
  else {
    throw new Error(
      `路由 ${route.id} 的起点标高无法确定（from_height 与端点 y 均未声明）：竖直起点段会整段消失，已画线点位将少算管。请到 config/mep-hvac-coordination.yaml 补 from_height`,
    );
  }
  if (startY <= pointHeight) return null;
  return { startY, pointHeight };
}

function fromDrop(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  from: { x: number; z: number; y?: number } | undefined,
  resolvedPoints?: Array<{ x: number; z: number; y?: number }>,
): number {
  const span = fromDropSpan(route, points, from, resolvedPoints);
  return span ? span.startY - span.pointHeight : 0;
}


/**
 * 并排去重长度：多回路经常沿同一条天花轴线（走廊 z=4.6 / 边吊）并排走，
 * Σ各条长度会把同一段路径算 N 次。本函数按平面路径并集求精确长度，
 * 得到"走线长度"——**人工/开槽必须按这个数计价**（同一条槽并排 3~4 根管只开一次），
 * 而**管材必须按各条长度之和计价**（每回路各有其管）。两个数用途不同，不可互换。
 *
 * 精确分段并集（2026-11-17 量价算法审计 S1）：旧实现把路径栅格化到 5cm 网格
 * 再数 cell，系统性多算（每条不连通路径多一个栅格 0.05m，生产 +0.5431m）。
 * 现为精确并集：每条线段在它与其它线段的全部交点处切分（含共线重叠的端点），
 * 切分后的小段按端点去重后按欧氏长求和。零长段（纯竖直路径的平面投影）
 * 本身不贡献长度。`cell` 参数保留兼容旧调用签名，精确并集不再使用。
 */
export function unionPlanLength(paths: Array<Array<{ x: number; z: number }>>, cell = 0.05): number {
  void cell;
  type Seg = { ax: number; az: number; bx: number; bz: number };
  const segments: Seg[] = [];
  for (const points of paths) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a.x === b.x && a.z === b.z) continue;
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  }
  const EPS = 1e-9;
  const splits: number[][] = segments.map(() => [0, 1]);
  const cross = (ux: number, uz: number, vx: number, vz: number): number => ux * vz - uz * vx;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    const dx1 = s.bx - s.ax;
    const dz1 = s.bz - s.az;
    const lenSq1 = dx1 * dx1 + dz1 * dz1;
    for (let j = i + 1; j < segments.length; j += 1) {
      const t = segments[j];
      const dx2 = t.bx - t.ax;
      const dz2 = t.bz - t.az;
      const lenSq2 = dx2 * dx2 + dz2 * dz2;
      const denom = cross(dx1, dz1, dx2, dz2);
      if (Math.abs(denom) > EPS) {
        // 非平行：唯一交点，落在两段内才切分。
        const rx = t.ax - s.ax;
        const rz = t.az - s.az;
        const u = cross(rx, rz, dx2, dz2) / denom;
        const v = cross(rx, rz, dx1, dz1) / denom;
        if (u >= -EPS && u <= 1 + EPS && v >= -EPS && v <= 1 + EPS) {
          splits[i].push(Math.min(1, Math.max(0, u)));
          splits[j].push(Math.min(1, Math.max(0, v)));
        }
      } else if (Math.abs(cross(t.ax - s.ax, t.az - s.az, dx1, dz1)) <= EPS) {
        // 共线：重叠区间的端点处切分（重叠长度为 0 的端点相接不切分）。
        const proj = (px: number, pz: number): number => ((px - s.ax) * dx1 + (pz - s.az) * dz1) / lenSq1;
        const u0 = proj(t.ax, t.az);
        const u1 = proj(t.bx, t.bz);
        const lo = Math.max(0, Math.min(u0, u1));
        const hi = Math.min(1, Math.max(u0, u1));
        if (hi - lo > EPS) {
          splits[i].push(lo, hi);
          const projJ = (px: number, pz: number): number => ((px - t.ax) * dx2 + (pz - t.az) * dz2) / lenSq2;
          const v0 = projJ(s.ax, s.az);
          const v1 = projJ(s.bx, s.bz);
          splits[j].push(Math.max(0, Math.min(v0, v1)), Math.min(1, Math.max(v0, v1)));
        }
      }
    }
  }
  const seen = new Set<string>();
  let total = 0;
  // 端点键按 1µm 量化：同一交点经不同线段算出的坐标有双精度尾巴
  // （~1e-15）与切分参数合并误差（≤1e-9），1µm 内视为同一点；仓内
  // 最小特征为 1mm，不存在 1µm 级的真实不同端点。量化到整数微米后
  // 再归一化 -0：微小负残差（如 -1e-17）直接 toFixed(6) 会写成
  // "-0.000000"，与 "0.000000" 去重失败，同一几何因声明方向不同
  // 而多算（Codex blocking：[-0.01,0.02] 与 [0,1.02] 正向 1.05m、
  // 反向 1.03m，期望均为 1.03m）。
  const qi = (v: number): number => {
    const r = Math.round(v * 1e6);
    return r === 0 ? 0 : r;
  };
  const keyOf = (x1: number, z1: number, x2: number, z2: number): string => {
    const a = `${qi(x1)},${qi(z1)}`;
    const b = `${qi(x2)},${qi(z2)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    // 切分参数按 EPS 归并（不向网格取整：取整会把 1/3 这类参数的误差
    // 放大到端点、撞坏去重键）；归并误差 ≤ EPS × 段长，可忽略。
    const raw = splits[i].slice().sort((a, b) => a - b);
    const ts: number[] = [];
    for (const v of raw) {
      if (ts.length === 0 || v - ts[ts.length - 1] > EPS) ts.push(v);
    }
    for (let k = 1; k < ts.length; k += 1) {
      const t0 = ts[k - 1];
      const t1 = ts[k];
      if (t1 - t0 <= EPS) continue;
      const x1 = s.ax + (s.bx - s.ax) * t0;
      const z1 = s.az + (s.bz - s.az) * t0;
      const x2 = s.ax + (s.bx - s.ax) * t1;
      const z2 = s.az + (s.bz - s.az) * t1;
      const key = keyOf(x1, z1, x2, z2);
      if (seen.has(key)) continue;
      seen.add(key);
      total += Math.hypot(x2 - x1, z2 - z1);
    }
  }
  return total;
}

/**
 * 回路计价基数（DEC-2026-10-23-R01，修正 DEC-2026-10-07-M02 的 union 口径）：
 * **平面 union + 竖直段**。
 *
 * M02 定同回路 union 是为治星形布线的平面重复计量，平面去重保留；但 unionPlanLength
 * 只吃 {x,z}，竖直边（下引/立管）在平面投影是一个点，被整体归零——2026-10-22 审计
 * 实测现行强电路由约 89m 竖直行程不在计价内，导线总量因此低估约 36%。
 * 竖直段物理上每回路独占（各自的管、各自的线），不做跨回路去重；同一回路内多条
 * 路由共享同一根立管时（同 x,z 的纯竖直边），按 y 区间合并只计一次，与平面 union
 * 的去重哲学一致。带平面分量的斜边无法这样合并：其平面分量已在平面 union
 * 里计过一次，故只补超出平面的真长部分 hypot(平面, Δy) − 平面——
 * 2026-11-17 前按 |Δy| 全额计入（曼哈顿拆分），3-4-5 斜边计 7m 而非
 * 5m，生产计价基数 +0.9213m（量价算法审计 S2）。同一条斜边若在不同
 * 高度重走同一平面段，每条各补各的超出部分（不同高度是不同的管）；
 * 仅当两条斜边是同一条 3D 线的重复声明时才会多计——那是路由重复，
 * 由重叠 lint 拦截，不属本函数口径。
 * 终端下引（路由终点标高 → 点位安装高度，config include_terminal_drop 开启时）由
 * computeMepTakeoff 以纯竖直 stub 路径并入本函数的入参，一并走区间合并计入。
 *
 * 2026-10-23 评审后修订（同 DEC 条目）：
 * - 纯竖直路径的**平面分量恒为 0**：整条路径同 (x,z) 时送 union 前剔除——
 *   2026-11-17 前 unionPlanLength 的 5cm 网格曾给退化路径也栅格化出一个
 *   cell（0.05m），生产约 34 个竖直位置因此累计多计约 1.70m；S1 起精确
 *   并集本身即跳过零长平面段、退化路径天然为 0，本处剔除仅作守卫保留。
 *   诊断口径（drawnRouteUnionM 等）保持原义，只去掉网格误差。
 * - **缺失标高 fail-closed**：任一点 y 缺失/非有限数即抛错。旧实现用 ?? 0 兜底，
 *   缺标高的点被当成 y=0 静默出数。生产主路径的 y 由统一出口 resolved.points 保证、
 *   routeLength 已先 fail-closed；导出函数自身守同一口径，不许直接调用者绕过。
 */
export function pricedCircuitLength(paths: Array<Array<{ x: number; z: number; y?: number }>>): number {
  for (let pi = 0; pi < paths.length; pi += 1) {
    for (let i = 0; i < paths[pi].length; i += 1) {
      const y = paths[pi][i].y;
      if (y === undefined || !Number.isFinite(y)) {
        throw new Error(
          `pricedCircuitLength：第 ${pi} 条路径第 ${i} 个点缺失标高 y——计价基数不许默认标高（缺 y 曾被 ?? 0 静默当成 0 出数），请补 from/to_height 或 via 标高`,
        );
      }
    }
  }
  const checked = paths.map((points) => points.map((p) => ({ x: p.x, z: p.z, y: p.y as number })));
  // 平面分量：整条路径同 (x,z) 的退化路径（纯竖直/单点）贡献恒为 0，送 union 前剔除；
  // 其竖直分量由下方区间逻辑计。全部路径都退化时平面分量为 0。
  const planPaths = checked
    .map((points) => points.map((p) => ({ x: p.x, z: p.z })))
    .filter((points) => points.some((p) => Math.hypot(p.x - points[0].x, p.z - points[0].z) > 1e-9));
  const plan = planPaths.length > 0 ? unionPlanLength(planPaths) : 0;
  const intervals = new Map<string, Array<[number, number]>>();
  // 斜边超出平面的真长部分：平面分量已由 union 计过一次，只补
  // hypot(平面, Δy) − 平面（S2：旧实现按 |Δy| 全额计入，曼哈顿拆分）。
  let slantedExcess = 0;
  for (const points of checked) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dy = Math.abs(b.y - a.y);
      if (dy <= 1e-9) continue;
      const planD = Math.hypot(b.x - a.x, b.z - a.z);
      if (planD <= 1e-9) {
        const key = `${Math.round(a.x * 1000)},${Math.round(a.z * 1000)}`;
        const list = intervals.get(key) ?? [];
        list.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
        intervals.set(key, list);
      } else {
        slantedExcess += Math.hypot(planD, dy) - planD;
      }
    }
  }
  let vertical = slantedExcess;
  for (const list of intervals.values()) {
    list.sort((p, q) => p[0] - q[0]);
    let curLo = list[0][0];
    let curHi = list[0][1];
    for (let i = 1; i < list.length; i += 1) {
      if (list[i][0] <= curHi + 1e-9) {
        curHi = Math.max(curHi, list[i][1]);
      } else {
        vertical += curHi - curLo;
        curLo = list[i][0];
        curHi = list[i][1];
      }
    }
    vertical += curHi - curLo;
  }
  return plan + vertical;
}

/**
 * 一条路线的穿墙孔数（issue #98 第五阶段 S3：孔数从「数 penetration 数组长度」改为「数派生交点」）。
 *
 * 每条穿墙声明恰好记 1 孔，但必须**可定位**：
 *   - 路线折线 ∩ 墙段有唯一 strict/vertex 交点 → 派生点即孔位（at 可省，S3 已删 45 条）；
 *   - 无唯一交点（贴墙段穿越 / 端点压墙线 / 未触墙意图点 / 多交点）→ 必须保留手写 at；
 *   - 二者皆无，或墙在几何里查不到 → unresolved(error) 且不计孔（fail-closed：孔位不可知时
 *     不发明，下游 feasibleForQuote 随之为 false，而不是静默按数组长度出一个「看起来正常」的数）。
 * 未传墙几何（wallsById 缺省）时退回旧口径（数组长度）——仅供手搭输入的单元测试；生产调用方
 * 全部传 `penetrationWalls`。
 */
export function countRoutePenetrations(
  route: MepRoute,
  points: Array<{ x: number; y?: number; z: number }>,
  wallsById: ReadonlyMap<string, PenetrationWallShape> | undefined,
  unresolved: MepTakeoff['unresolved'],
): number {
  const raw = route.penetration;
  if (!Array.isArray(raw)) return 0;
  if (!wallsById) return raw.length;
  let count = 0;
  raw.forEach((entry: unknown, index) => {
    const declared = typeof entry === 'object' && entry !== null ? entry as { wall?: unknown; at?: unknown } : {};
    const wallId = typeof declared.wall === 'string' ? declared.wall : undefined;
    const label = `${route.id}.penetration[${index}]${wallId ? `@${wallId}` : ''}`;
    const wall = wallId ? wallsById.get(wallId) : undefined;
    if (!wall) {
      unresolved.push({ id: label, reason: `穿墙声明 ${label} 的墙 ${wallId ?? '(缺 wall)'} 不在墙几何里：孔位不可派生，不计孔`, kind: 'error' });
      return;
    }
    if ('point' in deriveMepPenetrationPoint(points, wall)) {
      count += 1;
      return;
    }
    const at = typeof declared.at === 'object' && declared.at !== null ? declared.at as { x?: unknown; z?: unknown } : undefined;
    if (at && typeof at.x === 'number' && typeof at.z === 'number') {
      count += 1;
      return;
    }
    unresolved.push({ id: label, reason: `穿墙声明 ${label} 无唯一交点可派生（贴墙段/端点压墙线/意图点/多交点）且未保留手写 at：孔位不可知，不计孔（fail-closed）`, kind: 'error' });
  });
  return count;
}

/**
 * 双控/多控附加控制线的走线图边（2026-11-16 量价算法审计）。
 *
 * 旧口径（已删）：按点位 type === 'switch_2way'，把每条触及该点的路由长度
 * 对半分给端点、再 × 附加芯数。它读的是点位类型而不是控制声明，且对半分
 * 没有任何走线依据——实测四处错：
 *   - switch_parent_door 的控制已于 2026-10-27 裁定为单控（control_parent_bed_door
 *     kind: switch），点位 type 仍是 switch_2way，旧口径多算 1.950m；
 *   - switch_guest_bed → night_guest_head 的起夜灯支路不是双控行程，旧口径多算 0.475m；
 *   - 主卧吸顶灯支路（light_master_dome ↔ switch_master_bed_north）不是行程，
 *     旧口径多算 3.369m；
 *   - 书房/儿童房双控是星形（两开关各接灯位、无开关直连线），行程应走灯位接线盒
 *     全程（7.350m / 6.889m），旧口径只算一半，少算 3.675m / 3.445m。
 * 新口径：控制声明（config/electrical-topology.yaml 的 controls，成员 ≥2 即多控）
 * 是唯一依据；行程 = 该控制各开关之间在已画强电路由图上的精确最小子树
 * （Dreyfus–Wagner；初版的度量闭包 MST 近似在星形图上多算，见
 * travelerSubtreeLength，Codex blocking③），边长取路由 3D 折线长（折线已含
 * 开关下引段），折线未下引到开关时，开关节点经一条独立的竖直 stub 边接入图
 * （安装点 → 折线端点，边长 = 端点标高 − 开关安装高度；Codex blocking，
 * PR #255 复审第 9/10 轮）。
 * 无路可通（如客厅双控开关未画线）计 0——未画线不进量，缺口由 coverage.unroutedPoints 显形。
 *
 * 竖直 stub 为什么必须是独立边（第 9/10 轮的教训）：旧模型把 stub 折进路由首/末
 * 边的权重、只在成员开关端计入——两处静默少算。① 坐标端点落在某开关顶部时，
 * 该坐标统一成开关 ID、其边不带 stub，最短路经此边离开开关节点、绕过竖直段
 * （复现：正确 4m，实际 3m）；② 折线首点重复时首边成同节点自环，Dijkstra
 * 不取它，所挂 stub 随之消失（复现：4.83m → 2.1m）。独立边之后，开关节点只
 * 经 stub 边接入图：任何离开开关的路都必须走它，绕过与自环都不再吃掉下引。
 * stub 边长为 0 时仍建边（开关安装点即折线端点，身份边不断开终端与图的连接）。
 */
export interface TravelerGraphEdge {
  routeId: string;
  a: string;
  b: string;
  length: number;
  circuit?: string;
}

/**
 * 路由端点 → 图节点。字符串端点是点位 id（同一 id 即同一物理点）；坐标端点
 * 必须带标高：同一 x/z 在不同高度是不同的物理点（吊顶接线盒 y=2.5 与地面点
 * y=0.5），丢掉 y 会把未画连接的两端合并、凭空造出连接（Codex blocking，
 * PR #255 复审第 4 轮：两条各 1m 的边本不连通，旧 2D 口径算出行程 2m）。
 * endY 取解算后折线的端点标高（requirePointY）；缺省时退回旧 2D 口径，仅供
 * 未带标高的调用方兼容——生产路径（computeMepTakeoff）一律传标高。
 */
export function travelerNodeKey(endpoint: string | { x: number; z: number }, endY?: number): string {
  if (typeof endpoint === 'string') return endpoint;
  return endY === undefined
    ? `coord:${Math.round(endpoint.x * 1000)},${Math.round(endpoint.z * 1000)}`
    : `coord:${Math.round(endpoint.x * 1000)},${Math.round(endpoint.z * 1000)},${Math.round(endY * 1000)}`;
}

/**
 * 点 p 是否落在 3D 线段 a→b 的内部（不含端点）：以变化最大的轴作参数轴求 t，
 * 其余两轴按插值核对；t ∈ (0,1) 才算内部。端点本身已是图节点，不切分。
 * 用于行程图切分（Codex blocking，PR #255 复审第 7 轮）：同回路另一条路由的
 * 端点/折线点落在某段内部时，该段须在此切分、统一节点，否则接入悬空——
 * 附加导线数量不能依赖冗余 via 点是否存在。
 */
export function travelerInteriorT(
  a: { x: number; z: number; y: number },
  b: { x: number; z: number; y: number },
  p: { x: number; z: number; y: number },
): number | null {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const adx = Math.abs(dx), ady = Math.abs(dy), adz = Math.abs(dz);
  let t: number;
  if (adx >= ady && adx >= adz) {
    if (adx < EPS) return null;
    t = (p.x - a.x) / dx;
    if (Math.abs(a.y + t * dy - p.y) > EPS || Math.abs(a.z + t * dz - p.z) > EPS) return null;
  } else if (ady >= adx && ady >= adz) {
    if (ady < EPS) return null;
    t = (p.y - a.y) / dy;
    if (Math.abs(a.x + t * dx - p.x) > EPS || Math.abs(a.z + t * dz - p.z) > EPS) return null;
  } else {
    if (adz < EPS) return null;
    t = (p.z - a.z) / dz;
    if (Math.abs(a.x + t * dx - p.x) > EPS || Math.abs(a.y + t * dy - p.y) > EPS) return null;
  }
  if (t <= EPS || t >= 1 - EPS) return null;
  return t;
}

type TravelerAdjacency = Map<string, Array<{ to: string; edge: number; weight: number }>>;

/**
 * 图邻接表：边权即边长。竖直 stub 是独立边（安装点 → 折线端点），不再折进
 * 路由首/末边的权重、也不再按“端点是本控制成员开关”有条件计入——非成员
 * 端点的 stub 边是悬在非终端上的叶边，Steiner 树永不取它；成员开关的 stub
 * 边是终端唯一的接入边，任何离开终端的路都必须走它（PR #255 复审第 9/10 轮）。
 */
function travelerAdjacency(edges: TravelerGraphEdge[]): TravelerAdjacency {
  const adjacency: TravelerAdjacency = new Map();
  const link = (from: string, to: string, edge: number, weight: number): void => {
    const list = adjacency.get(from) ?? [];
    list.push({ to, edge, weight });
    adjacency.set(from, list);
  };
  edges.forEach((item, index) => {
    link(item.a, item.b, index, item.length);
    link(item.b, item.a, index, item.length);
  });
  return adjacency;
}

/** 加权 Dijkstra：返回从 from 到各节点的最短路距离（不可达的节点不在表中）。 */
function travelerDistances(adjacency: TravelerAdjacency, from: string): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const [node, d] of dist) {
      if (!done.has(node) && d < best) { best = d; current = node; }
    }
    if (current === undefined) return dist;
    done.add(current);
    for (const step of adjacency.get(current) ?? []) {
      const nd = best + step.weight;
      if (nd < (dist.get(step.to) ?? Number.POSITIVE_INFINITY) - 1e-9) {
        dist.set(step.to, nd);
      }
    }
  }
}

/**
 * Dreyfus–Wagner 精确最小 Steiner 树：端点集 terminals 在最短路度量 d 下的
 * 最小子树长。dp[mask][v] = 以 v 为根、覆盖 mask 端点的最小子树；子集拆分 +
 * 度量闭包松弛各一遍即精确（d 满足三角不等式，松弛幂等）。复杂度 O(3^k · n)，
 * live 只有双控/三控（k ≤ 3），可忽略。真子集的数值恒小于 mask，掩码按数值
 * 递增枚举时拆分用的 dp 已是最终值。
 */
function travelerSteinerLength(terminals: string[], nodes: string[], d: (a: string, b: string) => number): number {
  const k = terminals.length;
  const full = (1 << k) - 1;
  const dp: Array<Map<string, number>> = [];
  for (let mask = 1; mask <= full; mask++) dp[mask] = new Map<string, number>();
  terminals.forEach((terminal, i) => {
    for (const v of nodes) dp[1 << i].set(v, d(terminal, v));
  });
  for (let mask = 1; mask <= full; mask++) {
    // 子集拆分：在根 v 处把 mask 拆成两棵子树相并（sub 与 other 各枚举一次）。
    for (let sub = (mask - 1) & mask; sub > 0; sub = (sub - 1) & mask) {
      const other = mask ^ sub;
      if (other === 0 || sub > other) continue;
      for (const v of nodes) {
        const sum = (dp[sub].get(v) ?? Infinity) + (dp[other].get(v) ?? Infinity);
        if (sum < (dp[mask].get(v) ?? Infinity)) dp[mask].set(v, sum);
      }
    }
    // 度量闭包松弛：根可沿最短路滑动，dp[mask][v] = min_u dp[mask][u] + d(u, v)。
    const relaxed = new Map<string, number>();
    for (const v of nodes) {
      let best = dp[mask].get(v) ?? Infinity;
      for (const u of nodes) {
        const cand = (dp[mask].get(u) ?? Infinity) + d(u, v);
        if (cand < best) best = cand;
      }
      relaxed.set(v, best);
    }
    dp[mask] = relaxed;
  }
  return Math.min(...nodes.map((v) => dp[full].get(v) ?? Infinity));
}

/**
 * 控制组各开关在行程图上的连通分量（只含已在图中的开关；未画线的开关不在图里，
 * 已由 coverage.unroutedPoints 显形，不在此重复报）。
 * travelerSubtreeLength 与连通性缺口诊断共用：分量划分只写一次
 * （Codex major，PR #255 跟进：分量不足 2 个端点时旧代码静默计 0、无任何诊断）。
 */
export function travelerSwitchComponents(edges: TravelerGraphEdge[], switches: string[]): string[][] {
  const members = [...new Set(switches)];
  if (members.length < 2 || edges.length === 0) return [];
  const adjacency = travelerAdjacency(edges);
  const nodeIndex = new Set(adjacency.keys());
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const start of members) {
    if (seen.has(start) || !nodeIndex.has(start)) continue;
    const component = new Set<string>();
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.add(current);
      for (const step of adjacency.get(current) ?? []) {
        if (!seen.has(step.to)) { seen.add(step.to); queue.push(step.to); }
      }
    }
    components.push(members.filter((m) => component.has(m)));
  }
  return components;
}

/**
 * 连接一组开关的最小行程网络长度（精确最小子树，Dreyfus–Wagner）。
 * 无路连接的开关不贡献（未画线不进量）；开关组不连通时按连通分量分别算后相加。
 * 分量划分见 travelerSwitchComponents（与缺口诊断共用）；单端点分量计 0，
 * 缺口由调用方按控制组登记进 unresolved（不估算未画线）。
 * 边权即边长；竖直 stub 是独立边（安装点 → 折线端点），成员开关只经该边接入图，
 * 非成员端点的 stub 边是叶边、永不入选——stub 不再按成员身份有条件计入
 * （PR #255 复审第 9/10 轮）。
 *
 * 旧口径（量价算法审计初版）：开关间两两最短路作边、取最小生成树、并集去重。
 * 度量闭包上的 MST 只是 Steiner 树的近似——星形图会多算：A/B/C 两两直连各
 * 2m、各自到接线盒 O 均为 1.1m 时，MST 取两条直连边得 4m，而经 O 的已画网络
 * 只需 3.3m（Codex blocking③，PR #255 复审）。本函数改求精确最小子树；计价
 * 口径不变（边权仍是折线长，stub 另作独立边），live 生产值不受影响。
 */
export function travelerSubtreeLength(edges: TravelerGraphEdge[], switches: string[]): number {
  const members = [...new Set(switches)];
  if (members.length < 2 || edges.length === 0) return 0;
  const adjacency = travelerAdjacency(edges);
  const nodes = [...adjacency.keys()];
  const nodeIndex = new Map(nodes.map((node, i) => [node, i]));
  // 全点对最短路距离（边权即边长；stub 已是独立边）。
  const dists = nodes.map((from) => travelerDistances(adjacency, from));
  const d = (a: string, b: string): number => {
    const ia = nodeIndex.get(a);
    const ib = nodeIndex.get(b);
    if (ia === undefined || ib === undefined) return Number.POSITIVE_INFINITY;
    return dists[ia].get(b) ?? Number.POSITIVE_INFINITY;
  };
  // 开关按连通性分组：不连通的开关不贡献，只在各自连通分量内算最小子树。
  let total = 0;
  for (const terminals of travelerSwitchComponents(edges, switches)) {
    if (terminals.length >= 2) total += travelerSteinerLength(terminals, nodes, d);
  }
  return total;
}

export function computeMepTakeoff(input: MepTakeoffInput): MepTakeoff {
  const { electrical, plumbing, circuits, controls = [], routes, resolution, rules, penetrationWalls } = input;
  const penetrationWallById = penetrationWalls
    ? new Map(penetrationWalls.filter((wall) => typeof wall.id === 'string').map((wall) => [wall.id as string, wall]))
    : undefined;
  const covered = new Set(rules.covered_layers);
  const unresolved: MepTakeoff['unresolved'] = validateTakeoffRules(rules).map((item) => ({ ...item, kind: 'error' }));
  // 2026-10-14 阶段 4：规则层的三个"参与乘法"的值在动手算之前先取值，缺了就抛错。
  // validateTakeoffRules（上面一行）已把它们记进 unresolved，但那只是"不可报价"的标记；
  // 少了这一行，数字仍会按 1.0 / 0 芯 / 0 模算出来并被下游当成有效量使用。
  // 三个都不可能是 0：零损耗等于"施工不用余料"，零附加芯等于"双控不用控制线"，
  // 零模数等于"配电箱不占位"——都是物理上不成立的口径。
  const wireLoss = requireRule(rules.units.loss?.wire, 'units.loss.wire');
  const pipeLoss = requireRule(rules.units.loss?.pipe, 'units.loss.pipe');
  const dualControlExtraCores = requireRule(rules.units.dual_control_extra_cores, 'units.dual_control_extra_cores', 0);
  // 管件系数：>0 才合理（0 个/m 的管件在物理上不成立）。缺失即抛错，不兜底成 1.0。
  const fittingPerMeterPpr = requireRule(rules.units.fitting_per_meter?.ppr, 'units.fitting_per_meter.ppr');
  const fittingPerMeterPvc = requireRule(rules.units.fitting_per_meter?.pvc, 'units.fitting_per_meter.pvc');
  const mainSwitchPoles = requireRule(rules.panel?.main_switch_poles, 'panel.main_switch_poles');
  const spdModules = requireRule(rules.panel?.spd_modules, 'panel.spd_modules');
  const spareRatio = requireRule(rules.panel?.spare_ratio, 'panel.spare_ratio', 0);
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

  // 终端下引是否计长（DEC-2026-10-23-R01）：只在此读一次 rules.include_terminal_drop。
  // 下引长度唯一入口 countedDropM 与回路计价基数的 span 门都用它；各处不许再写
  // `rules.include_terminal_drop ? … : 0`。第 13 轮的洞正是 stub 另写一套
  // （stubAt + zeroLength）与基础导线分叉，关掉开关后附加线多算 3.15m。
  const includeTerminalDrop = rules.include_terminal_drop;
  /**
   * 端点下引计长（结构性收尾）：一条端点的下引长度只在这里定——开关关掉时计 0，
   * 开时按“端点标高 − 安装高度”计（terminalDrop/fromDrop：标高不定即抛错，
   * 端点不高于安装点计 0）。基础导线层长、管材分桶、回路计价基数与行程图 stub
   * 都调它。
   */
  const countedDropM = (end: 'from' | 'to', route: MepRoute, resolved: ResolvedMepRoute): number => {
    if (!includeTerminalDrop) return 0;
    return end === 'to'
      ? terminalDrop(route, pointHeights, resolved.to, resolved.points)
      : fromDrop(route, pointHeights, resolved.from, resolved.points);
  };

  // ---------- 点位 → 回路 单一派生（issue #98 S3，shared/point-circuits.ts）----------
  // 原三条声明通道：① topology.member_point_ids、② controls 反推、③ point.circuit 字段。
  // ③ 已退役（成员关系只住回路侧），①② 收拢成 derivePointCircuits 一处实现——
  // lint（covered/point_uncovered）、DXF 标注、派生文档与这里同源，不各写一遍。
  const { pointCircuits: pointCircuit } = derivePointCircuits({ circuits, controls });
  const resolvedById = new Map(resolution.routes.map((item) => [item.route.id, item]));
  const drawnPlanPaths: Array<Array<{ x: number; z: number }>> = [];
  // ---------- 双控行程图规格（PR #255 结构性收尾，2026-11-17）----------
  // 第 6–14 轮 Codex 审出的洞全在这张图的构造里，且全是一个根因：同一规则写在
  // 两处、改了一处漏了另一处。本块是图的唯一规格；改构造先改这里，矩阵测试
  // tests/server/mep-takeoff-traveler-matrix.test.ts 按“接入点位置 × 路由有效性
  // × stub 高度 × 开关 × 回路归属”穷举已知维度。
  //  不变量一（进图集合）：一条路由进图当且仅当 isTravelerRoute 为真——强电层、
  //    在 covered_layers 内、已解析且 physical、端点无待激活。切分点收集与图边
  //    构造共用这一判断（两处各写一份是第 14 轮的洞：待激活路由的 via 点进了
  //    切分、却不进边，行程被静默抬高）。
  //  不变量二（节点身份）：每个物理点恰好一个节点。坐标端点以 travelerNodeKey
  //    （x,z,y）为 key；点位 ID 只经独立 stub 边接入图；坐标接入点与 stub 安装
  //    点端同位置时以零长身份边连通（第 12 轮），安装点端登记为切分点（第 13 轮）。
  //    不许再加第二套身份登记（第 8 轮的登记表已退役）。
  //  不变量三（长度口径）：每段在每个接入点切分（段内、端点、stub 中途、安装点
  //    端皆然）；下引长度只由 countedDropM 定——开关关掉时基础导线与 stub 都计 0，
  //    开时都按“端点标高 − 安装高度”计（第 13 轮的洞正是两处分叉）。
  /** 双控行程图边：已画强电物理路由（主循环内构造，见 travelerSubtreeLength）。 */
  const travelerEdges: TravelerGraphEdge[] = [];
  /** 行程图有效路由（结构性收尾）：切分点收集与图边构造共用这一判断。待激活
   * 端点不在图里（主循环的 deferredEndpoint 排除曾只写在图边构造一处，切分点
   * 收集漏了它——第 14 轮的洞：待激活路由的 via 点进了切分、却不进边，行程被
   * 静默抬高 2.1m）。 */
  const isTravelerRoute = (route: MepRoute): boolean => {
    if (route.layer !== 'strong_power') return false;
    if (!covered.has(route.layer)) return false;
    const resolved = resolvedById.get(route.id);
    if (!resolved || resolved.unresolved.length > 0 || !resolved.metadata.physicalRoute) return false;
    return ![route.from, route.to].some(
      (endpoint) => typeof endpoint === 'string' && isDeferredElectricalPoint(elecById.get(endpoint)),
    );
  };
  // 行程图切分点（Codex blocking，PR #255 复审第 7 轮）：同回路其他路由的折线点
  // 落在某段内部时，该段须在此切分——第 6 轮只把已有折线顶点建成节点，接入点
  // 落在线段内部仍悬空（删去冗余 via 点即复现：几何不变，行程 2.1m → 0）。
  // 按回路分桶，只认同回路的实际接入；非强电/非 physical 路由不进图，也不提供切分点。
  const travelerJunctionByCircuit = new Map<string, Array<{ x: number; z: number; y: number }>>();
  // （第 8 轮的端点身份登记表已随第 9/10 轮模型改动退役：路由段边一律用坐标
  // key 作节点，坐标切分点落在本回路某折线端点处时自然是同一坐标 key，不再
  // 需要把坐标统一成 ID；点位 ID 只经独立 stub 边接入图。）
  for (const route of routes) {
    if (!isTravelerRoute(route)) continue;
    // isTravelerRoute 已保证 resolved 存在且 physical；这里只取回它（TS 无法
    // 跨函数收窄，取不到即跳过，与旧行为一致）。
    const resolved = resolvedById.get(route.id);
    if (!resolved) continue;
    const circuit = typeof route.to === 'string'
      ? pointCircuit.get(route.to)
      : typeof route.from === 'string' ? pointCircuit.get(route.from) : undefined;
    if (circuit === undefined) continue;
    const list = travelerJunctionByCircuit.get(circuit) ?? [];
    for (const point of resolved.points) {
      list.push({ x: point.x, z: point.z, y: requirePointY(point, `路由 ${route.id}`) });
    }
    // （第 13 轮）安装点端也是切分点：独立 stub 的安装点端（点位 ID 接入）
    // 不在折线点里，支路恰好穿过另一开关的安装点时不在此切分、行程静默归零
    // （第 12 轮只修了接在自己 stub 端点上的情形）。安装点与折线端点同 x/z，
    // y 取点位声明高度；登记后 stub 自身的切分（第 12 轮身份边）把它与点位 ID
    // 连通，穿过的支路经此坐标节点接入。与已有折线点重合时不重复登记。
    const registerMountPoint = (endpoint: string | { x: number; z: number }, point: { x: number; z: number } | undefined): void => {
      if (typeof endpoint !== 'string' || point === undefined) return;
      const height = pointHeights.get(endpoint)?.height;
      if (height === undefined) return;
      const mount = { x: point.x, z: point.z, y: height };
      if (!list.some((item) => Math.abs(item.x - mount.x) <= EPS && Math.abs(item.z - mount.z) <= EPS && Math.abs(item.y - mount.y) <= EPS)) {
        list.push(mount);
      }
    };
    registerMountPoint(route.from, resolved.points[0]);
    registerMountPoint(route.to, resolved.points[resolved.points.length - 1]);
    travelerJunctionByCircuit.set(circuit, list);
  }
  /** 每条回路的画线路由平面路径（同回路 union：同一回路内共享段只铺一次管、只穿一次线）。 */
  const circuitPaths = new Map<string, Array<Array<{ x: number; z: number; y?: number }>>>();
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
    penetrations += countRoutePenetrations(route, resolved.points, penetrationWallById, unresolved);
    const drawnLength = routeLength(route, resolved.points);
    drawnMWithoutDrop += drawnLength;
    const points3d = resolved.points;
    // 与切分点收集共用 isTravelerRoute：到这里的路由本已通过主循环的层/解析/
    // physical/待激活四道 continue，故此判断恒真——写出来是为让两处过滤永远
    // 是同一函数，分叉即编译可见。
    if (route.layer === 'strong_power' && isTravelerRoute(route)) {
      // 双控行程图边（量价算法审计）：边长取 3D 折线长；折线端点未下引到开关时，
      // 开关节点经一条独立的竖直 stub 边接入图（安装点 → 折线端点，边长由
      // countedDropM 定，与基础导线同一口径；Codex blocking，PR #255 复审
      // 第 9/10 轮）。stubAt 已退役：它的长度与 countedDropM 是同一量
      // （端点标高 − 安装高度），两处各算一套是第 13 轮的洞。
      // 回路归属与 circuitPaths 同口径（to 端优先）。
      // 行程图按折线逐段建边（Codex blocking，PR #255 复审第 6 轮）：整条折线压成
      // 一条 from→to 边会丢掉中途接入点——另一条路由的端点落在某段中途时，两开
      // 关在图上不连通、行程计 0，coverage 也不报（两开关都有 physical route）。
      // 逐段建边后中途点成为图节点，接入即连通；最短路度量不变（分段不改端点
      // 间最短路）。零长重合段成自环，Dijkstra/Steiner 不取它，不影响度量，
      // 故不特殊跳过。
      // （第 7 轮补）同回路其他路由的点落在段内部时，在此切分：切分点按 t 排序
      // 去重。
      // （第 9/10 轮改）路由段边一律用坐标 key 作节点，点位 ID 不再作段边端点：
      // 段边端点若用 ID，坐标端点落在开关顶部时统一成该 ID、其边不带 stub，
      // 最短路绕过竖直段（第 9 轮）；stub 折进首边权重时，首点重复成自环会
      // 连 stub 一起丢掉（第 10 轮）。点位 ID 只经下面的独立 stub 边接入图。
      const circuit = typeof route.to === 'string'
        ? pointCircuit.get(route.to)
        : typeof route.from === 'string' ? pointCircuit.get(route.from) : undefined;
      const junctions = circuit === undefined ? [] : (travelerJunctionByCircuit.get(circuit) ?? []);
      const keyOf = (node: { x: number; z: number; y: number }): string => travelerNodeKey(node, node.y);
      // 一段 3D 线段按同回路接入点切分后逐小段建边（第 6/7 轮）：接入点落在
      // 段内部时在此成节点，否则接入悬空。折线段与 stub 竖直段走同一切分——
      // 支路接在 stub 中途时也须在接入点处成节点（第 11 轮 blocking：旧模型
      // stub 边不参与切分，接入点悬空、两开关不连通、行程静默归零）。
      // fromKey/toKey 是两端图节点：折线段两端用坐标 key，stub 段的安装点端
      // 用点位 ID。
      const pushCutEdges = (
        from3d: { x: number; z: number; y: number },
        to3d: { x: number; z: number; y: number },
        fromKey: string,
        toKey: string,
        // zeroLength 时各小段边长记 0、连接不断（第 13 轮引入）：终端 stub 的下引
        // 计长只由 countedDropM 定（结构性收尾），开关关掉时 stub 只作连接、不计长。
        zeroLength = false,
      ): void => {
        // （第 12 轮）接入点恰落在段端点时：travelerInteriorT 只认内部点（t=0/1
        // 排除），端点本身已是图节点——但 stub 段的安装点端用点位 ID 作 key，
        // 接入点的坐标 key 与之不同，两身份须以零长边连通，否则支路接在安装点
        // 处悬空、行程静默归零。折线段两端本就是坐标 key，与接入点同 key 时
        // 不建边（自环无意义）。
        const samePoint = (p: { x: number; z: number; y: number }, q: { x: number; z: number; y: number }): boolean =>
          Math.abs(p.x - q.x) <= EPS && Math.abs(p.z - q.z) <= EPS && Math.abs(p.y - q.y) <= EPS;
        for (const p of junctions) {
          if (samePoint(p, from3d) && fromKey !== keyOf(p)) {
            travelerEdges.push({ routeId: route.id, a: fromKey, b: keyOf(p), length: 0, circuit });
          }
          if (samePoint(p, to3d) && toKey !== keyOf(p)) {
            travelerEdges.push({ routeId: route.id, a: toKey, b: keyOf(p), length: 0, circuit });
          }
        }
        const cuts = junctions
          .map((p) => ({ p, t: travelerInteriorT(from3d, to3d, p) }))
          .filter((item): item is { p: { x: number; z: number; y: number }; t: number } => item.t !== null)
          .sort((m, n) => m.t - n.t)
          .filter((item, index, arr) => index === 0 || Math.abs(item.t - arr[index - 1].t) > EPS);
        const nodes: Array<{ x: number; z: number; y: number }> = [
          from3d,
          ...cuts.map((item) => item.p),
          to3d,
        ];
        const keys = [fromKey, ...cuts.map((item) => keyOf(item.p)), toKey];
        for (let k = 1; k < nodes.length; k += 1) {
          travelerEdges.push({
            routeId: route.id,
            a: keys[k - 1],
            b: keys[k],
            length: zeroLength ? 0 : routeSegmentLength(nodes[k - 1], nodes[k], `路由 ${route.id}`),
            circuit,
          });
        }
      };
      for (let i = 1; i < points3d.length; i += 1) {
        const fromPoint = points3d[i - 1];
        const toPoint = points3d[i];
        const fromY = requirePointY(fromPoint, `路由 ${route.id}`);
        const toY = requirePointY(toPoint, `路由 ${route.id}`);
        const from3d = { x: fromPoint.x, z: fromPoint.z, y: fromY };
        const to3d = { x: toPoint.x, z: toPoint.z, y: toY };
        pushCutEdges(from3d, to3d, keyOf(from3d), keyOf(to3d));
      }
      // 终端 stub 边（第 9/10 轮）：每个字符串端点各一条独立边，安装点 → 折线
      // 端点坐标 key，边长 = 端点标高 − 安装高度（折线已下引到安装点时为 0，
      // 仍建边不断开终端与图的连接）。同一开关是多条路由端点时各边平行，
      // 最短路只取最小的一条，下引只计一次、不重复计。
      // （第 11 轮）竖直段存在（端点标高高于安装高度）时按同一规则切分；
      // 无中途接入点时各小段长度之和仍等于原 stub 长，生产值不变。
      // 标高不高于安装高度时沿用旧口径——单条零长边不断开终端连接。
      const terminalStubEdge = (end: 'from' | 'to', endpoint: string | { x: number; z: number }, point: { x: number; z: number; y?: number }): void => {
        if (typeof endpoint !== 'string') return;
        const y = requirePointY(point, `路由 ${route.id}`);
        const height = pointHeights.get(endpoint)?.height;
        if (height !== undefined && y > height) {
          pushCutEdges(
            { x: point.x, z: point.z, y: height },
            { x: point.x, z: point.z, y },
            endpoint,
            travelerNodeKey({ x: point.x, z: point.z }, y),
            // 下引长度只由 countedDropM 定（结构性收尾）：开关关掉时 countedDropM
            // 为 0，stub 以零长边保留、开关仍经 stub 接入图——中途接入点仍在
            // stub 上成节点，与基础导线按同一开关补计下引。
            countedDropM(end, route, resolved) === 0,
          );
          return;
        }
        travelerEdges.push({
          routeId: route.id,
          a: endpoint,
          b: travelerNodeKey({ x: point.x, z: point.z }, y),
          length: countedDropM(end, route, resolved),
          circuit,
        });
      };
      terminalStubEdge('from', route.from, points3d[0]);
      terminalStubEdge('to', route.to, points3d[points3d.length - 1]);
    }
    const planPath = points3d.map((point) => ({ x: point.x, z: point.z }));
    drawnPlanPaths.push(planPath);
    if (route.layer === 'strong_power') strongPaths.push(planPath);
    const circuitId = typeof route.to === 'string' ? pointCircuit.get(route.to) : undefined;
    if (circuitId) {
      // 回路路径保留 3D 点：计价基数 pricedCircuitLength 需要 via/端点的 y 算竖直段。
      const list = circuitPaths.get(circuitId) ?? [];
      list.push(points3d);
      if (includeTerminalDrop) {
        // 终端下引进计价（DEC-2026-10-23-R01 评审后修订）：下引此前只进 drawn/layer
        // 诊断长度，circuitPaths 只有路由折线，报价卡从 strongPowerTotalM 取量时
        // 这段已声明的管线不在基数内（评审实测强电 0.95m）。把下引作为终端点
        // (x,z) 处的纯竖直 stub 两点路径并入本回路——pricedCircuitLength 的同
        // (x,z) y 区间合并会与路由自身竖直边去重，同一根立管只计一次。
        const span = terminalDropSpan(route, pointHeights, resolved.to, points3d);
        if (span && resolved.to) {
          list.push([
            { x: resolved.to.x, z: resolved.to.z, y: span.endY },
            { x: resolved.to.x, z: resolved.to.z, y: span.pointHeight },
          ]);
        }
        // 起点 stub 与终端下引同口径：折线起点高于起点位安装高度时，位点到
        // 折线起点那段竖直管/线并入本回路（量价算法审计 D3：此前只计 to 端，
        // from 端 13 条路由共 0.2962m 静默漏计）。
        const fromSpan = fromDropSpan(route, pointHeights, resolved.from, points3d);
        if (fromSpan && resolved.from) {
          list.push([
            { x: resolved.from.x, z: resolved.from.z, y: fromSpan.startY },
            { x: resolved.from.x, z: resolved.from.z, y: fromSpan.pointHeight },
          ]);
        }
      }
      circuitPaths.set(circuitId, list);
    }
    const endRoom = typeof route.to === 'string' ? roomOf(route.to) : undefined;
    if (endRoom) bumpRoom(endRoom, 'drawnRouteM', routeLength(route, resolved.points));
    else unassignedRouteM += routeLength(route, resolved.points);
    const length = drawnLength + countedDropM('to', route, resolved) + countedDropM('from', route, resolved);
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

  // 同回路 union：同一回路内多端点星形回线的共享段只铺一次管、只穿一次线。
  // circuitUnion 是纯平面 union（诊断口径，保持原义）；计价基数走 circuitPriced
  // = 平面 union + 竖直段（DEC-2026-10-23-R01，见 pricedCircuitLength 注释）。
  const circuitUnion = new Map<string, number>();
  const circuitPriced = new Map<string, number>();
  for (const [circuitId, paths] of circuitPaths) {
    circuitUnion.set(circuitId, unionPlanLength(paths));
    circuitPriced.set(circuitId, pricedCircuitLength(paths));
  }
  const strongUnionPerCircuitM = [...circuitUnion.values()].reduce((sum, value) => sum + value, 0);
  const strongPricedPerCircuitM = [...circuitPriced.values()].reduce((sum, value) => sum + value, 0);
  // ---------- 3. 导线：按回路线径分桶 ----------
  const buckets = new Map<string, WireBucket>();
  for (const circuit of circuits) {
    // 导线 = 该回路物理布线树（同回路计价基数：平面 union + 竖直段，共享段只穿一次线）
    // × 芯数 × 损耗。不能用 Σ各条长度：同一回路多端点星形回线会把共享段穿 N 次线；
    // 也不能只用平面 union：竖直段是真实管线，见 pricedCircuitLength（DEC-2026-10-23-R01）。
    const conduit = circuitPriced.get(circuit.id) ?? 0;
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
  // 双控/多控附加控制线（2026-11-16 量价算法审计）：按控制声明逐组算行程，不再按点位 type 分摊。
  // 成员 ≥2 即多控；行程 = 该控制各开关在已画强电路由图上的最小子树（见 travelerSubtreeLength），
  // 只在受控灯具所在回路的边上找路（跨回路串线不是行程）；无路可通计 0（未画线不进量）。
  // 连通性缺口（Codex major，PR #255 跟进）：开关分属多个连通分量时组内连线未画全——
  // 附加线只按各分量内计、缺口不估算，但缺口必须登记进 unresolved，否则报价会把未画全的
  // 双控网络显示为完整计价。未画线的开关不在图里，已由 coverage.unroutedPoints 显形，不在此重复报。
  // 跨回路缺口（Codex major，PR #255 跟进 #256）：成员在别的回路有物理路由时，
  // travelerSwitchComponents 静默跳过它（不在 usable 图里），components 只剩一个分量；
  // 而 unroutedPoints 按全局 drawnPointIds 建，该成员仍算已路由——“不在图里 ⇒ 覆盖度
  // 显形”的假设对跨回路开关不成立。故另查：成员已画路由（在 drawnPointIds 里）却不在
  // 目标回路图里，也登记同一缺口。未画线的成员不在 drawnPointIds 里，仍由覆盖度显形，
  // 不在此重复报；目标回路未定（usable 即全图）时无此格。
  let dualControlExtraM = 0;
  for (const control of controls) {
    const switches = [...new Set(control.switch_point_ids ?? [])];
    if (switches.length < 2) continue;
    const targetCircuit = (control.target_point_ids ?? [])
      .map((id) => pointCircuit.get(id))
      .find((value): value is string => Boolean(value));
    const usable = targetCircuit === undefined
      ? travelerEdges
      : travelerEdges.filter((edge) => edge.circuit === targetCircuit);
    dualControlExtraM += travelerSubtreeLength(usable, switches) * dualControlExtraCores;
    const components = travelerSwitchComponents(usable, switches);
    const inUsable = new Set(components.flat());
    const crossCircuit = targetCircuit === undefined
      ? []
      : switches.filter((member) => drawnPointIds.has(member) && !inUsable.has(member));
    if (components.length > 1 || crossCircuit.length > 0) {
      const gaps: string[] = [];
      if (components.length > 1) {
        gaps.push(`开关分属 ${components.length} 个不连通分量（${components.map((group) => group.join('+')).join(' / ')}）`);
      }
      if (crossCircuit.length > 0 && targetCircuit !== undefined) {
        gaps.push(`开关 ${crossCircuit.join('、')} 有物理路由却不在目标回路 ${targetCircuit} 的行程图里（跨回路串线不是行程）`);
      }
      unresolved.push({
        id: control.id ?? `control:${switches.join('+')}`,
        reason: `双控组 ${control.id ?? switches.join('、')}：${gaps.join('；')}，组内连线未画全，附加线只按已画部分计、缺口不估算`,
        kind: 'error',
      });
    }
  }
  // 损耗系数在上方 requireRule 已取值（缺失即抛错），此处直接乘。
  // 旧代码 `validFinite(...) ? ... : 1` 会让缺失损耗的导线按"零损耗"计价——少买 5%~8% 的线。
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
    const points = resolved.points;
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
      length: routePointDistance(points, segment.fromIndex, segment.toIndex, `路由 ${route.id}`)
        // 起点 stub 与终端下引同口径：折线起点高于起点位安装高度时，位点到折线
        // 起点那段竖直管进首段（审计 D3 只补了层长 conduit，管材分桶漏了它，
        // Codex blocking，PR #255 复审第 5 轮；单段路由首尾同一段，两项都加）。
        + (index === 0 ? countedDropM('from', route, resolved) : 0)
        + (index === segments.length - 1 ? countedDropM('to', route, resolved) : 0),
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
      const length = routeLength(route, resolved.points)
        + countedDropM('to', route, resolved) + countedDropM('from', route, resolved);
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
    const length = routeLength(route, resolved.points)
      + countedDropM('to', route, resolved) + countedDropM('from', route, resolved);
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
  // 漏保判定只认 breaker 声明。**缺 breaker 即抛错**（2026-10-14 阶段 4）：
  // 旧代码 `/漏保/.test(circuit.breaker ?? '')` 把「没声明保护电器」当成「没有漏保」，
  // 于是漏电断路器数量静默少算、GB 55038 7.4.3-1 的合规结论建立在漏数上。
  // 现在由 config/electrical-topology.yaml 的每条回路显式表态（本案 20 条回路全部已声明）。
  const withRcd = circuits.map((circuit) => {
    if (circuit.breaker === undefined) {
      throw new Error(
        `回路 ${circuit.id} 缺 breaker 声明：无法判定是否带漏电保护，漏保数量会静默少算（GB 55038 7.4.3-1 要求电源插座回路 ≤30mA RCBO）。请到 config/electrical-topology.yaml 补 breaker`,
      );
    }
    return /漏保/.test(circuit.breaker);
  }).filter(Boolean).length;
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
      // 计价口径的强电管总量（server/mep-quotes 的 conduit_20 行取此值）：
      // Σ 回路计价基数（平面 union + 竖直段，DEC-2026-10-23-R01）。
      // 纯平面 union 的诊断值见 strongPowerUnionPerCircuitM，两者不可混用。
      strongPowerTotalM: strongPricedPerCircuitM,
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
      fittings: {
        ppr: [...water.values()].reduce((sum, bucket) => sum + bucket.meters, 0) * fittingPerMeterPpr,
        pvc: [...drainage.values()].reduce((sum, bucket) => sum + bucket.meters, 0) * fittingPerMeterPvc,
      },
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
      // 与分桶计价同一基数（平面 union + 竖直段），诊断表不许再报纯平面值误导采购。
      const conduit = circuitPriced.get(circuit.id) ?? 0;
      // 芯数取本回路自己的 purpose 声明，不取分桶首条回路的 cores：同一线径分桶
      // 混装不同芯数时，旧口径会把首条回路的芯数套到全桶回路的诊断 wireM 上
      // （2026-11-16 量价算法审计；现行数据全为 3 芯未触发，属防御性修正）。
      const cores = rules.units.cores_by_purpose[circuit.purpose ?? ''] ?? 0;
      return {
        circuitId: circuit.id,
        purpose: circuit.purpose ?? '未声明',
        wireSize: bucket?.wireSize ?? '未解析',
        conduitM: conduit,
        cores,
        // 用同一个已校验的 wireLoss：旧代码这里直接乘 rules.units.loss.wire，
        // 缺失时整列 wireM 变 NaN（诊断表上一片 NaN，看不出是缺配置）。
        wireM: conduit * cores * wireLoss,
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
