import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import type { FurnishingItem, FurnishingsYaml, PhaseId, PhaseScope } from '../shared/types.js';
import { loadPhaseControlAuthority } from './phase-control.js';

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
  // 现行执行限额一律经 server/phase-control.ts 读取，避免出现第二个 control.yaml 数字读者。
  const authority = loadPhaseControlAuthority(scope.budget_authority);
  return {
    ceilingCny: authority.ceilingCny,
    allocatedCny: authority.allocatedCny,
    unallocatedCny: authority.unallocatedCny,
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

/**
 * 按阶段过滤家具。规则在 schedule/phase-scope.yaml 的 furnishing_rules，按房间声明。
 *
 * 阶段归属按稳定 ID 指名（issue #98 方案 §四①，业主 2026-11-09 裁定）：placed 家具
 * 一律用 include_ids / exclude_ids 精确点到 house.yaml 的 `id:`。type 规则
 * （include_types / exclude_types）只作迁移期兼容，**新声明一律用 ID**，将逐步清退。
 *
 * 三条必须同时知道的语义：
 * ① 准入是「ID 点名 或 type 命中」的并集——所以纯 type 旧规则行为逐字不变；
 *    新家具没被 ID 点名就进不了该阶段，不会被同名 type 顺手带进来。
 * ② count-only 条目（无 x/z、无 id）指不到 ID，只能由 include_types 指名——
 *    这是 type 规则退潮后唯一保留的合法用途（窗帘/灯具/床垫/龙头等预算计数条目）。
 * ③ 排除只对通过准入的条目生效；exclude_ids 同样只排被点名的 id，
 *    将来同 type 的新柜子不会因为「排过一个同名柜」而被顺手排掉。
 */
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
      if (rule.include_ids || rule.include_types) {
        const admittedById = item.id !== undefined && (rule.include_ids?.includes(item.id) ?? false);
        const admittedByType = rule.include_types?.includes(item.type) ?? false;
        if (!admittedById && !admittedByType) return false;
      }
      const placed = item.x !== undefined && item.z !== undefined;
      if (rule.exclude_placed && placed) return false;
      if (item.id !== undefined && rule.exclude_ids?.includes(item.id)) return false;
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
