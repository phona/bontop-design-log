import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import type { PhaseId, PhaseScope } from '../shared/types.js';

// server/phase-control.ts
// 现行执行上限的**唯一机器源读取入口**：`schedule/phase-1/control.yaml`。
//
// 为什么要有这个模块
// ───────────────────
// `config/budget/base.json` 的 `total_budget` / `project_ceiling` 是 2026-08 的四池口径
// 快照（total_budget 208,000 / project_ceiling 190,000），已被
// schedule/phase-1/control.yaml `budget_reconciliation.historical_baseline` 显式标为
// `historical_reference_only`，但它仍然被 server/budget-calculator.ts 直接 readFileSync，
// 并通过 budget API / MCP `overCeilingBy` 输出成 190,000——业主看到的一期上限长期是作废值。
//
// 现状（2026-10-04 重构后）：
//   * 现行执行上限 = control.yaml `control.phase_ceiling_cny`（206,000），本模块是它的唯一读取入口；
//   * 作废值只通过 control.yaml `budget_reconciliation.historical_baseline` 段露出
//     （该段自带 source / status 标注），base.json **不再作为任何计算与接口的输入源**；
//   * base.json 的 `categories` 仍是唯一的分科目预算明细，作为历史分科口径继续供 breakdown 使用。
//
// 单一事实源的路径由各 phase scope 的 `budget_authority` 字段自证
// （schedule/phase-scope.yaml → schedule/phase-1/control.yaml）。

export interface PhaseHistoricalBaseline {
  /** 留档来源（config/budget/base.json），只读不参与计算。 */
  source: string;
  totalBudgetCny: number;
  projectCeilingCny: number;
  /** control.yaml 声明的状态，例如 historical_reference_only。 */
  status: string;
}

export interface PhaseControlAuthority {
  /** 声明该上限的控制文件路径（自证单一事实源）。 */
  authority: string;
  /** 现行一期执行上限（元）。 */
  ceilingCny: number;
  /** 已分配执行额（元）。 */
  allocatedCny: number;
  /** 未分配额度（元）。 */
  unallocatedCny: number;
  /** 作废口径留档，仅供追溯展示，不参与任何计算。 */
  historicalBaseline: PhaseHistoricalBaseline;
}

export const DEFAULT_PHASE_CONTROL_PATH = 'schedule/phase-1/control.yaml';

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readControl(controlPath: string): any {
  let doc: any;
  try {
    doc = parseYaml(readFileSync(controlPath, 'utf8'));
  } catch (err) {
    throw new Error(`无法读取现行执行上限控制文件 ${controlPath}：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!doc || typeof doc !== 'object') throw new Error(`${controlPath} 不可解析`);
  return doc;
}

/**
 * 读取现行执行上限与作废口径留档。
 *
 * 读不到即抛错——**不得静默回落到 config/budget/base.json 的作废值**，
 * 那正是本轮要消灭的输出错误（budget API / MCP 报 190,000）。
 */
export function loadPhaseControlAuthority(controlPath: string = DEFAULT_PHASE_CONTROL_PATH): PhaseControlAuthority {
  const doc = readControl(controlPath);
  const control = doc.control ?? {};
  const ceilingCny = num(control.phase_ceiling_cny);
  if (ceilingCny === undefined) throw new Error(`${controlPath} control.phase_ceiling_cny 缺失`);
  const baseline = doc.budget_reconciliation?.historical_baseline ?? {};
  return {
    authority: controlPath,
    ceilingCny,
    allocatedCny: num(control.allocated_cny) ?? ceilingCny,
    unallocatedCny: num(control.unallocated_cny) ?? 0,
    historicalBaseline: {
      source: typeof baseline.source === 'string' ? baseline.source : 'config/budget/base.json',
      totalBudgetCny: num(baseline.total_budget_cny) ?? Number.NaN,
      projectCeilingCny: num(baseline.project_ceiling_cny) ?? Number.NaN,
      status: typeof baseline.status === 'string' ? baseline.status : 'historical_reference_only',
    },
  };
}

/** phase scope → 控制文件路径；未声明 budget_authority 时退回默认的一期控制文件。 */
export function controlPathForPhase(scope?: PhaseScope): string {
  return scope?.budget_authority ?? DEFAULT_PHASE_CONTROL_PATH;
}

/** 兼容 phase_1_basic_occupancy 之外的可能 phase 取值（当前只有 full 与 phase_1）。 */
export function controlPathForPhaseId(phase: PhaseId, scopes?: Record<PhaseId, PhaseScope>): string {
  return controlPathForPhase(scopes?.[phase]);
}
