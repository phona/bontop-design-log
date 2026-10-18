import type {
  ElectricalLintIssue,
  ElectricalPoint,
  ElectricalTopology,
  FurnishingsYaml,
  ResolvedLayout,
} from './types.js';

const LIGHT_TYPES = new Set(['ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light', 'night_light']);
const PANEL_TYPES = new Set(['strong_panel', 'weak_panel']);
const ORDINARY_POWER_TYPES = new Set(['socket', 'usb', 'floor_socket']);
const POWERABLE_TYPES = new Set([...ORDINARY_POWER_TYPES, ...LIGHT_TYPES]);
const PANEL_KINDS = new Set(['strong', 'weak']);
const TOPOLOGY_STATUSES = new Set(['confirmed', 'proposed', 'pending']);

// ── 2026-10 电气规范 lint 的三个新规则（全部 warning 起步，不进入 error 门禁）──
// (a) GB 55038-2025 第 7.4.3-1：所有电源插座回路应装设额定剩余动作电流不超过 30mA 的 RCD。
//     breaker 字段是自由文本（"C16A+漏保"/"C32A+漏保（proposed，待厂家配电图）"），
//     因此用"是否出现 ≤30mA / 漏保 / RCBO / RCD 字样"做机器可核验的弱判据。
const SOCKET_TYPES = ORDINARY_POWER_TYPES;
const RCD_DECLARATION = /≤?\s*30\s*mA|漏保|RCBO|RCD/i;
// (b) GB 55038-2025 第 7.4.5：卫生间插座应加防溅（防水）措施；两个卫浴间按 room 字段识别。
const BATH_ROOMS = new Set(['master_bath', 'guest_bath']);
const SPLASH_BOX_DECLARATION = /防溅|防水盒/;
// (c) config/house.yaml 智能家居条目承诺"智能开关零线"，但电气 schema 长期无 neutral 字段、
//     点位 note 也不写零线 → 机器无法核验。开关点位必须显式声明 neutral 口径
//     （`neutral: true/false`，或 note 里写"零线/中性线/neutral"）。
const SWITCH_TYPES = new Set(['switch', 'switch_2way']);
const NEUTRAL_DECLARATION = /零线|中性线|neutral/i;
// (d) 2026-10-17 review 盲区加固：同坐标强电点位重叠（曾漏检 ac_panel_dining 与 switch_corridor
//     同落 (7.20,4.10) h1.3）。判据：同 room、平面距离 <0.05m、|height 差| <0.15m、双方均为强电类型。
//     豁免：① 弱电（network/weak_panel）与强电同位双联是既有设计口径（强电集合本就不含弱电，此处双保险）；
//     ② appearance.panel_group.id 相同 = 已声明的 86mm 双联面板（同组两位不是重叠错误）。
const STRONG_POWER_TYPES = new Set(['socket', 'switch', 'switch_2way', 'ac_controller', 'night_light', 'floor_socket']);
const WEAK_COLOCATION_TYPES = new Set(['network', 'weak_panel']);
const POINT_COLLISION_PLANAR_M = 0.05;
const POINT_COLLISION_HEIGHT_M = 0.15;
// (e) 2026-10-17 review 盲区加固："furnishings 有 ceiling_light 预算行、electrical.yaml 无该房间任何
//     照明点位"（生活阳台复发过一次）。count>0 的 ceiling_light 行（count 缺省=1，与
//     ProjectCatalog.getFurnishingCounts 的 `count ?? 1` 同口径）要求该房间至少一个照明类点位。
//     照明集合取五类常用顶面/低位照明；wall_lamp/led_strip/track_light 不满足本检查（按 review 规格收敛）。
const FURNISHING_LIGHT_POINT_TYPES = new Set(['dome', 'downlight', 'pendant', 'ceiling_light', 'night_light']);

function distanceToSegment(point: { x: number; z: number }, segment: { x1: number; z1: number; x2: number; z2: number }): number {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - segment.x1, point.z - segment.z1);
  const t = Math.max(0, Math.min(1, ((point.x - segment.x1) * dx + (point.z - segment.z1) * dz) / lengthSquared));
  return Math.hypot(point.x - (segment.x1 + t * dx), point.z - (segment.z1 + t * dz));
}

export interface ElectricalLintContext {
  layout?: ResolvedLayout;
  suppressedWallIds?: string[];
  furnishings?: FurnishingsYaml;
}

export function lintElectricalTopology(
  topology: ElectricalTopology,
  points: ElectricalPoint[],
  context: ElectricalLintContext = {},
): {
  errors: ElectricalLintIssue[];
  warnings: ElectricalLintIssue[];
  counts: {
    errors: number;
    warnings: number;
    circuits: number;
    controls: number;
    coveredPoints: number;
    uncoveredPoints: number;
    /** 附加字段（既有字段语义不变）：按 code 汇总的 issue 数，便于按规则统计命中量。 */
    byCode: Record<string, number>;
  };
} {
  const errors: ElectricalLintIssue[] = [];
  const warnings: ElectricalLintIssue[] = [];
  const pointMap = new Map(points.map((point) => [point.id, point]));
  const issue = (level: 'error' | 'warning', code: string, message: string, id?: string) => (level === 'error' ? errors : warnings).push({ level, code, message, ...(id ? { id } : {}) });
  const covered = new Set<string>();

  const panelIds = new Set<string>();
  for (const panel of topology.panels) {
    if (panelIds.has(panel.id)) issue('error', 'duplicate_panel', `Duplicate panel ${panel.id}`, panel.id);
    panelIds.add(panel.id);
    if (!PANEL_KINDS.has(panel.kind)) issue('error', 'invalid_panel_kind', `Panel ${panel.id} has invalid kind ${panel.kind}`, panel.id);
    if (!TOPOLOGY_STATUSES.has(panel.status)) issue('error', 'invalid_panel_status', `Panel ${panel.id} has invalid status ${panel.status}`, panel.id);
    const point = pointMap.get(panel.source_point_id);
    if (!point) issue('error', 'unknown_panel_point', `Panel ${panel.id} references unknown source point ${panel.source_point_id}`, panel.id);
    else if (!PANEL_TYPES.has(point.type) || point.type !== `${panel.kind}_panel`) issue('error', 'invalid_panel_kind', `Panel ${panel.id} source point ${panel.source_point_id} is not a ${panel.kind}_panel`, panel.id);
  }
  const circuitIds = new Set<string>();
  for (const circuit of topology.circuits) {
    if (circuitIds.has(circuit.id)) issue('error', 'duplicate_circuit', `Duplicate circuit ${circuit.id}`, circuit.id);
    circuitIds.add(circuit.id);
    if (!panelIds.has(circuit.panel_id)) issue('error', 'unknown_panel', `Circuit ${circuit.id} references unknown panel ${circuit.panel_id}`, circuit.id);
    const circuitMembers = new Set<string>();
    for (const id of circuit.member_point_ids) {
      if (circuitMembers.has(id)) issue('error', 'duplicate_member', `Point ${id} is listed more than once in circuit ${circuit.id}`, id);
      circuitMembers.add(id);
      if (!pointMap.has(id)) issue('error', 'unknown_point', `Circuit ${circuit.id} references unknown point ${id}`, id);
      if (covered.has(id)) issue('error', 'duplicate_member', `Point ${id} is a member of multiple circuits`, id);
      covered.add(id);
      const point = pointMap.get(id);
      if (point && !POWERABLE_TYPES.has(point.type)) issue('error', 'member_not_powerable', `Circuit ${circuit.id} member ${id} (${point.type}) is not a powerable load point`, id);
      if (circuit.purpose === 'lighting' && point && !LIGHT_TYPES.has(point.type)) issue('error', 'lighting_member_not_light', `Lighting circuit ${circuit.id} includes non-light point ${id}`, id);
      if (circuit.purpose === 'ordinary_power' && point && !ORDINARY_POWER_TYPES.has(point.type)) issue('error', 'ordinary_member_not_socket', `Ordinary power circuit ${circuit.id} includes non-socket point ${id} (${point.type})`, id);
      // (f) 2026-10-17 review 盲区加固：删除/停用点位与回路成员联动。悬空引用与 superseded 成员
      //     是 error（回路不能再挂已废弃点位）；blocked 是 warning——blocked 属"位置待改"口径
      //     （如 sock_balcony_washer），回路仍服务该电器，不该拦交底。
      if (!point) issue('error', 'circuit_member_dangling_or_superseded', `Circuit ${circuit.id} member ${id} does not exist in config/electrical.yaml (dangling member reference; remove it from member_point_ids or recreate the point)`, id);
      else if (point.serviceability_status === 'superseded') issue('error', 'circuit_member_dangling_or_superseded', `Circuit ${circuit.id} member ${id} is serviceability_status=superseded but still listed as a circuit member; rebind the circuit to the replacement point or drop the member`, id);
      else if (point.serviceability_status === 'blocked') issue('warning', 'circuit_member_dangling_or_superseded', `Circuit ${circuit.id} member ${id} is serviceability_status=blocked (position pending relocation); circuit still serves the appliance — carry into 交底 instead of silently dropping`, id);
    }
    if (circuit.purpose === 'dedicated_load' || circuit.dedicated_load) issue('warning', 'dedicated_parameters_pending', `Dedicated load candidate ${circuit.id} needs explicit load parameters and field confirmation`, circuit.id);
    if (!circuit.capacity || !circuit.wire_size || !circuit.breaker) issue('warning', 'electrical_parameters_pending', `Circuit ${circuit.id} has no declared capacity, wire size, or breaker`, circuit.id);
    // (a) GB 55038-2025 第 7.4.3-1：含 socket 类成员的回路，breaker 必须声明 ≤30mA RCD 保护。
    const socketMembers = circuit.member_point_ids.filter((id) => {
      const point = pointMap.get(id);
      return point ? SOCKET_TYPES.has(point.type) : false;
    });
    if (socketMembers.length > 0 && !RCD_DECLARATION.test(circuit.breaker ?? '')) {
      issue('warning', 'rcd_missing_on_socket_circuit', `Circuit ${circuit.id} feeds ${socketMembers.length} socket point(s) (${socketMembers.join(', ')}) but breaker "${circuit.breaker ?? '未声明'}" declares no ≤30mA RCD/漏保/RCBO/RCD (GB 55038-2025 7.4.3-1)`, circuit.id);
    }
  }
  const circuitsBySource = new Map<string, string>();
  for (const circuit of topology.circuits) {
    const sourceId = circuit.source_circuit_id ?? circuit.id;
    circuitsBySource.set(sourceId, circuit.id);
  }
  for (const point of points) {
    if (!point.circuit) continue;
    const topologyCircuitId = circuitsBySource.get(point.circuit);
    if (!topologyCircuitId) {
      issue('warning', 'declared_circuit_uncovered', `Point ${point.id} declares circuit ${point.circuit}, but no topology circuit covers it`, point.id);
    } else if (!topology.circuits.find((circuit) => circuit.id === topologyCircuitId)?.member_point_ids.includes(point.id)) {
      issue('error', 'circuit_fact_mismatch', `Point ${point.id} declares circuit ${point.circuit}, but is not a member of topology circuit ${topologyCircuitId}`, point.id);
    }
  }
  for (const point of points) {
    if (!covered.has(point.id) && !point.circuit && !PANEL_TYPES.has(point.type)) issue('warning', 'point_uncovered', `Electrical point ${point.id} is not covered by Phase 1 topology`, point.id);
    if (point.wall && context.suppressedWallIds?.includes(point.wall)) issue('error', 'suppressed_wall_mount', `Point ${point.id} references suppressed/glass wall ${point.wall}`, point.id);
    if (point.wall && context.layout && !context.layout.walls.some((wall) => wall.id === point.wall)) issue('warning', 'unknown_wall', `Point ${point.id} references unknown wall ${point.wall}`, point.id);
  }
  const tvSocket = pointMap.get('sock_living_tv');
  const tvCabinet = Object.values(context.furnishings ?? {})
    .flat()
    .find((item) => item.type === 'tv_wall_low' && typeof item.x === 'number' && typeof item.z === 'number');
  if (tvSocket && tvCabinet && typeof tvSocket.x === 'number' && typeof tvSocket.z === 'number') {
    const separation = Math.hypot(tvSocket.x - tvCabinet.x!, tvSocket.z - tvCabinet.z!);
    if (separation > 1.5) {
      issue('warning', 'tv_socket_near_tv_stand', `TV socket ${tvSocket.id} is ${separation.toFixed(2)}m from tv_wall_low; expected <= 1.50m`, tvSocket.id);
    }
  }
  // (e) 防生活阳台式复发：ceiling_light 预算行（count>0，缺省=1）所在房间必须有至少一个照明类点位。
  const roomsWithCeilingLightBudget = new Set<string>();
  for (const [roomId, items] of Object.entries(context.furnishings ?? {})) {
    if (items.some((item) => item.type === 'ceiling_light' && (item.count ?? 1) > 0)) roomsWithCeilingLightBudget.add(roomId);
  }
  for (const roomId of roomsWithCeilingLightBudget) {
    const hasLightingPoint = points.some((point) => point.room === roomId && FURNISHING_LIGHT_POINT_TYPES.has(point.type));
    if (!hasLightingPoint) {
      issue('error', 'furnishing_light_without_point', `Furnishings declare ceiling_light (count>0) for room ${roomId}, but config/electrical.yaml has no lighting point (dome/downlight/pendant/ceiling_light/night_light) in that room; the ceiling_light budget row will install a lamp with nowhere to wire`, roomId);
    }
  }
  const curtainWalls = (context.layout?.walls ?? []).filter((wall) => context.suppressedWallIds?.includes(wall.id));
  for (const point of points) {
    if (!/窗帘/.test(point.note ?? '') || typeof point.x !== 'number' || typeof point.z !== 'number') continue;
    if (curtainWalls.length === 0) {
      issue('warning', 'curtain_power_near_curtain_wall', `Curtain power point ${point.id} cannot be checked because suppressed wall geometry is unavailable`, point.id);
      continue;
    }
    const distance = Math.min(...curtainWalls.flatMap((wall) =>
      (wall.segments?.length ? wall.segments : [wall]).map((segment) => distanceToSegment(point, segment)),
    ));
    if (distance > 2.0) {
      issue('warning', 'curtain_power_near_curtain_wall', `Curtain power point ${point.id} is ${distance.toFixed(2)}m from the nearest curtain wall; expected <= 2.00m`, point.id);
    }
  }
  // (b)(c) 点位级规范声明检查：按 config/electrical.yaml 的 room / type / note / neutral 判定。
  for (const point of points) {
    if (BATH_ROOMS.has(point.room) && SOCKET_TYPES.has(point.type) && !SPLASH_BOX_DECLARATION.test(point.note ?? '')) {
      issue('warning', 'bath_socket_splash_box_undeclared', `Bathroom socket point ${point.id} (room ${point.room}, h=${point.height ?? 'n/a'}) declares no 防溅/防水盒 measure in its note (GB 55038-2025 7.4.5)`, point.id);
    }
    if (SWITCH_TYPES.has(point.type) && point.neutral === undefined && !NEUTRAL_DECLARATION.test(point.note ?? '')) {
      issue('warning', 'switch_neutral_policy_undeclared', `Switch point ${point.id} (${point.type}) declares no neutral policy (no explicit neutral field, note without 零线/中性线/neutral) while config/house.yaml smart_home promises 智能开关零线`, point.id);
    }
  }
  // (d) 同坐标强电重叠：两个强电点位同 room、平面 <0.05m、高差 <0.15m 即视为同一底盒被两处声明。
  //     只对双方都在 STRONG_POWER_TYPES 的组合报错；弱电同位与已声明的 panel_group 双联均豁免。
  const collisionCandidates = points.filter((point) => STRONG_POWER_TYPES.has(point.type) && typeof point.x === 'number' && typeof point.z === 'number');
  for (let i = 0; i < collisionCandidates.length; i++) {
    for (let j = i + 1; j < collisionCandidates.length; j++) {
      const a = collisionCandidates[i]!;
      const b = collisionCandidates[j]!;
      if (a.room !== b.room) continue;
      if (WEAK_COLOCATION_TYPES.has(a.type) || WEAK_COLOCATION_TYPES.has(b.type)) continue;
      const panelGroupA = a.appearance?.panel_group?.id;
      if (panelGroupA !== undefined && panelGroupA === b.appearance?.panel_group?.id) continue;
      const planar = Math.hypot(a.x - b.x, a.z - b.z);
      if (planar >= POINT_COLLISION_PLANAR_M) continue;
      const heightDiff = Math.abs((a.height ?? 0) - (b.height ?? 0));
      if (heightDiff >= POINT_COLLISION_HEIGHT_M) continue;
      issue('error', 'point_coordinate_collision', `Strong-power points ${a.id} (${a.type}) and ${b.id} (${b.type}) overlap in room ${a.room} at (${a.x.toFixed(2)}, ${a.z.toFixed(2)}): planar ${planar.toFixed(3)}m < ${POINT_COLLISION_PLANAR_M.toFixed(2)}m and |height diff| ${heightDiff.toFixed(2)}m < ${POINT_COLLISION_HEIGHT_M.toFixed(2)}m — one back box cannot host both declarations`, a.id);
    }
  }
  const controlIds = new Set<string>();
  for (const control of topology.controls) {
    if (controlIds.has(control.id)) issue('error', 'duplicate_control', `Duplicate control ${control.id}`, control.id);
    controlIds.add(control.id);
    for (const id of control.switch_point_ids) {
      const point = pointMap.get(id);
      if (!point) issue('error', 'unknown_point', `Control ${control.id} references unknown switch ${id}`, id);
      else if (point.type !== 'switch' && point.type !== 'switch_2way') issue('error', 'invalid_switch_point', `Control ${control.id} references non-switch point ${id}`, id);
    }
    if (control.target_point_ids.length === 0) issue('warning', 'control_target_missing', `Control ${control.id} has no target light point`, control.id);
    for (const id of control.target_point_ids) {
      const point = pointMap.get(id);
      if (!point) issue('error', 'unknown_point', `Control ${control.id} references unknown target ${id}`, id);
      else if (!LIGHT_TYPES.has(point.type)) issue(control.status === 'confirmed' ? 'error' : 'warning', 'control_target_not_light', `Control ${control.id} target ${id} is not a light`, id);
    }
    if (control.kind === 'switch_2way' && control.switch_point_ids.length !== 2) {
      issue(control.status === 'confirmed' ? 'error' : 'warning', 'two_way_switch_count', `Two-way control ${control.id} must have exactly two switches`, control.id);
    }
    if (control.kind === 'switch_multiway' && control.switch_point_ids.length < 3) {
      issue(control.status === 'confirmed' ? 'error' : 'warning', 'multiway_switch_count', `Multi-way control ${control.id} must have at least three switches`, control.id);
    }
  }
  for (const parameter of topology.pending_parameters) issue('warning', 'pending_parameter', `Pending electrical parameter: ${parameter}`);
  const uncoveredPoints = points.filter((point) => !covered.has(point.id) && !PANEL_TYPES.has(point.type)).length;
  const byCode: Record<string, number> = {};
  for (const item of [...errors, ...warnings]) byCode[item.code] = (byCode[item.code] ?? 0) + 1;
  return { errors, warnings, counts: { errors: errors.length, warnings: warnings.length, circuits: topology.circuits.length, controls: topology.controls.length, coveredPoints: covered.size, uncoveredPoints, byCode } };
}
