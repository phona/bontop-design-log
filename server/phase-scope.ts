import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { FurnishingItem, FurnishingsYaml, PhaseId, PhaseScope } from '../shared/types.js';

interface PhaseScopeFile {
  phases: Record<PhaseId, PhaseScope>;
}

export interface PhaseBudgetMeta {
  ceilingCny?: number;
  allocatedCny?: number;
  unallocatedCny?: number;
  authority?: string;
}

export function loadPhaseScopes(path = 'schedule/phase-scope.yaml'): Record<PhaseId, PhaseScope> {
  const parsed = load(readFileSync(path, 'utf8')) as PhaseScopeFile;
  if (!parsed?.phases?.full || !parsed.phases.phase_1_basic_occupancy) {
    throw new Error('phase-scope.yaml must define full and phase_1_basic_occupancy');
  }
  return parsed.phases;
}

export function loadPhaseBudgetMeta(scope: PhaseScope): PhaseBudgetMeta {
  if (!scope.budget_authority) return {};
  const control = load(readFileSync(scope.budget_authority, 'utf8')) as {
    control?: { phase_ceiling_cny?: number; allocated_cny?: number; unallocated_cny?: number };
  };
  return {
    ...(control.control?.phase_ceiling_cny !== undefined ? { ceilingCny: control.control.phase_ceiling_cny } : {}),
    ...(control.control?.allocated_cny !== undefined ? { allocatedCny: control.control.allocated_cny } : {}),
    ...(control.control?.unallocated_cny !== undefined ? { unallocatedCny: control.control.unallocated_cny } : {}),
    authority: scope.budget_authority,
  };
}

/**
 * Keep phase budget inclusion declarative.  In particular, fixed-price line
 * items do not disappear merely because their furnishing marker was filtered
 * from the scene, so the phase scope must explicitly exclude deferred topics.
 */
export function isBudgetTopicIncluded(
  topic: string,
  phase: PhaseId,
  scopes = loadPhaseScopes(),
): boolean {
  if (phase === 'full') return true;
  return !(scopes[phase].budget_exclude_topics ?? []).includes(topic);
}

export function parsePhaseId(value: unknown): PhaseId {
  if (value === undefined || value === '' || value === 'full') return 'full';
  if (value === 'phase_1_basic_occupancy') return value;
  throw new Error(`unsupported phase "${String(value)}"`);
}

export function filterFurnishings(
  furnishings: FurnishingsYaml,
  phase: PhaseId,
  scopes = loadPhaseScopes(),
): FurnishingsYaml {
  const scope = scopes[phase];
  const result: FurnishingsYaml = {};
  for (const [roomId, items] of Object.entries(furnishings)) {
    const rule = scope.furnishing_rules?.[roomId];
    result[roomId] = (items as FurnishingItem[]).map((item, sourceIndex) => ({
      ...item,
      // This is response metadata, not a second authored identity in
      // house.yaml.  It keeps PUT /api/furnishings tied to the source array
      // after phase filtering or count-only entries are removed.
      sourceIndex,
    })).filter((item) => {
      if (phase !== 'full' && !rule) return scope.default_furnishing_policy !== 'exclude';
      if (!rule) return true;
      if (rule.include_types && !rule.include_types.includes(item.type)) return false;
      const placed = item.x !== undefined && item.z !== undefined;
      if (rule.exclude_placed && placed) return false;
      if (rule.exclude_types?.includes(item.type)) return false;
      return true;
    });
  }
  return result;
}

export function filterCurtainElements<T extends { type?: string; room?: string }>(
  elements: T[],
  phase: PhaseId,
  scopes = loadPhaseScopes(),
): T[] {
  if (phase === 'full') return elements;
  const rooms = scopes[phase].curtain_rooms;
  return elements.filter((element) => element.type !== 'curtain' || (rooms !== 'all' && !!element.room && rooms.includes(element.room)));
}
