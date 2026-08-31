import type {
  ElectricalLintIssue,
  ElectricalPoint,
  ElectricalTopology,
  ResolvedLayout,
} from './types.js';

const LIGHT_TYPES = new Set(['ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip', 'track_light']);
const PANEL_TYPES = new Set(['strong_panel', 'weak_panel']);
const ORDINARY_POWER_TYPES = new Set(['socket', 'usb', 'floor_socket']);
const POWERABLE_TYPES = new Set([...ORDINARY_POWER_TYPES, ...LIGHT_TYPES]);
const PANEL_KINDS = new Set(['strong', 'weak']);
const TOPOLOGY_STATUSES = new Set(['confirmed', 'proposed', 'pending']);

export interface ElectricalLintContext {
  layout?: ResolvedLayout;
  suppressedWallIds?: string[];
}

export function lintElectricalTopology(
  topology: ElectricalTopology,
  points: ElectricalPoint[],
  context: ElectricalLintContext = {},
): { errors: ElectricalLintIssue[]; warnings: ElectricalLintIssue[]; counts: { errors: number; warnings: number; circuits: number; controls: number; coveredPoints: number; uncoveredPoints: number } } {
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
    }
    if (circuit.purpose === 'dedicated_load' || circuit.dedicated_load) issue('warning', 'dedicated_parameters_pending', `Dedicated load candidate ${circuit.id} needs explicit load parameters and field confirmation`, circuit.id);
    if (!circuit.capacity || !circuit.wire_size || !circuit.breaker) issue('warning', 'electrical_parameters_pending', `Circuit ${circuit.id} has no declared capacity, wire size, or breaker`, circuit.id);
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
    if (point.wall && context.suppressedWallIds?.includes(point.wall)) issue(point.type.startsWith('switch') ? 'error' : 'warning', 'suppressed_wall_mount', `Point ${point.id} references suppressed/glass wall ${point.wall}`, point.id);
    if (point.wall && context.layout && !context.layout.walls.some((wall) => wall.id === point.wall)) issue('warning', 'unknown_wall', `Point ${point.id} references unknown wall ${point.wall}`, point.id);
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
  }
  for (const parameter of topology.pending_parameters) issue('warning', 'pending_parameter', `Pending electrical parameter: ${parameter}`);
  const uncoveredPoints = points.filter((point) => !covered.has(point.id) && !PANEL_TYPES.has(point.type)).length;
  return { errors, warnings, counts: { errors: errors.length, warnings: warnings.length, circuits: topology.circuits.length, controls: topology.controls.length, coveredPoints: covered.size, uncoveredPoints } };
}
