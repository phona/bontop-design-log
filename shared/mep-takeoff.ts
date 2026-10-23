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

/** 折线点最小形状（mepRoutePoints 的产出 / route.via 的声明）。 */
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

function routeLength(route: MepRoute, from?: { x: number; z: number; y?: number }, to?: { x: number; z: number; y?: number }): number {
  const points = mepRoutePoints(route, from, to);
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
 */
function terminalDropSpan(
  route: MepRoute,
  points: Map<string, { height?: number }>,
  to: { x: number; z: number; y?: number } | undefined,
): { endY: number; pointHeight: number } | null {
  if (typeof route.to !== 'string') return null;
  const pointHeight = points.get(route.to)?.height;
  if (to === undefined || pointHeight === undefined) return null;
  // 竖向下引段的终点标高：路由自己声明的 to_height 优先，其次才是解析出的端点 y。
  // 两者都缺 → 旧代码取 0，于是 `Math.max(0, 0 − pointHeight)` 恒为 0，**整段下引管消失**
  // （已画线点位因此系统性少算约 2.2m/个）。标高不可默认：缺声明就抛错。
  // 注：routeLength 的 requirePointY 已经先对同一个表达式 fail-closed（它用的就是
  // `mepRoutePoints` 的 `to_height ?? to.y`），所以这个分支今天不可达——保留它是为了让
  // 本函数自身自洽，将来若有人在新路径上先调它，不会静默退回 0。
  let endY: number;
  if (route.to_height !== undefined) endY = route.to_height;
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
): number {
  const span = terminalDropSpan(route, points, to);
  return span ? span.endY - span.pointHeight : 0;
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

/**
 * 回路计价基数（DEC-2026-10-23-R01，修正 DEC-2026-10-07-M02 的 union 口径）：
 * **平面 union + 竖直段**。
 *
 * M02 定同回路 union 是为治星形布线的平面重复计量，平面去重保留；但 unionPlanLength
 * 只吃 {x,z}，竖直边（下引/立管）在平面投影是一个点，被整体归零——2026-10-22 审计
 * 实测现行强电路由约 89m 竖直行程不在计价内，导线总量因此低估约 36%。
 * 竖直段物理上每回路独占（各自的管、各自的线），不做跨回路去重；同一回路内多条
 * 路由共享同一根立管时（同 x,z 的纯竖直边），按 y 区间合并只计一次，与平面 union
 * 的去重哲学一致。带平面分量的斜边无法这样合并，其 |Δy| 按曼哈顿分量逐边计入。
 * 终端下引（路由终点标高 → 点位安装高度，config include_terminal_drop 开启时）由
 * computeMepTakeoff 以纯竖直 stub 路径并入本函数的入参，一并走区间合并计入。
 *
 * 2026-10-23 评审后修订（同 DEC 条目）：
 * - 纯竖直路径的**平面分量恒为 0**：整条路径同 (x,z) 时送 union 前剔除——
 *   unionPlanLength 的 5cm 网格会给退化路径也栅格化出一个 cell（0.05m），
 *   生产约 34 个竖直位置曾因此累计多计约 1.70m。unionPlanLength 本体不改，
 *   诊断口径（drawnRouteUnionM 等）保持原义。
 * - **缺失标高 fail-closed**：任一点 y 缺失/非有限数即抛错。旧实现用 ?? 0 兜底，
 *   缺标高的点被当成 y=0 静默出数。生产主路径的 y 由 mepRoutePoints 保证、
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
  let slantedDy = 0;
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
        slantedDy += dy;
      }
    }
  }
  let vertical = slantedDy;
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

export function computeMepTakeoff(input: MepTakeoffInput): MepTakeoff {
  const { electrical, plumbing, circuits, controls = [], routes, resolution, rules } = input;
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

  // ---------- 点位 → 回路 的三条声明通道（都不猜）----------
  // ① topology.member_point_ids：回路成员（79/100 个点位）
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
    const points3d = mepRoutePoints(route, resolved.from, resolved.to);
    const planPath = points3d.map((point) => ({ x: point.x, z: point.z }));
    drawnPlanPaths.push(planPath);
    if (route.layer === 'strong_power') strongPaths.push(planPath);
    const circuitId = typeof route.to === 'string' ? pointCircuit.get(route.to) : undefined;
    if (circuitId) {
      // 回路路径保留 3D 点：计价基数 pricedCircuitLength 需要 via/端点的 y 算竖直段。
      const list = circuitPaths.get(circuitId) ?? [];
      list.push(points3d);
      if (rules.include_terminal_drop) {
        // 终端下引进计价（DEC-2026-10-23-R01 评审后修订）：下引此前只进 drawn/layer
        // 诊断长度，circuitPaths 只有路由折线，报价卡从 strongPowerTotalM 取量时
        // 这段已声明的管线不在基数内（评审实测强电 0.95m）。把下引作为终端点
        // (x,z) 处的纯竖直 stub 两点路径并入本回路——pricedCircuitLength 的同
        // (x,z) y 区间合并会与路由自身竖直边去重，同一根立管只计一次。
        const span = terminalDropSpan(route, pointHeights, resolved.to);
        if (span && resolved.to) {
          list.push([
            { x: resolved.to.x, z: resolved.to.z, y: span.endY },
            { x: resolved.to.x, z: resolved.to.z, y: span.pointHeight },
          ]);
        }
      }
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
  let dualControlExtraM = 0;
  for (const [pointId, length] of switch2WayLength) {
    if (elecById.get(pointId)?.type !== 'switch_2way') continue;
    dualControlExtraM += length * dualControlExtraCores;
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
      length: routePointDistance(points, segment.fromIndex, segment.toIndex, `路由 ${route.id}`)
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
      return {
        circuitId: circuit.id,
        purpose: circuit.purpose ?? '未声明',
        wireSize: bucket?.wireSize ?? '未解析',
        conduitM: conduit,
        cores: bucket?.cores ?? 0,
        // 用同一个已校验的 wireLoss：旧代码这里直接乘 rules.units.loss.wire，
        // 缺失时整列 wireM 变 NaN（诊断表上一片 NaN，看不出是缺配置）。
        wireM: conduit * (bucket?.cores ?? 0) * wireLoss,
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
