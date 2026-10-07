import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { endpointSourcesFromFacts, parseMepCoordination, validateMepCoordination } from '../../../shared/mep-hvac-coordination-schema.js';
import { lintLevel, lintMepCoordination, MEP_LINT_CATEGORIES, type MepLintResult } from '../../../shared/mep-hvac-lint.js';
import type { ProjectRenderFacts } from '../../../shared/types.js';

function load<T>(path: string): T { return yaml.load(readFileSync(path, 'utf8')) as T; }

export function runMepLint(): MepLintResult {
  const electrical = load<ProjectRenderFacts['electrical']>('config/electrical.yaml');
  const plumbing = load<ProjectRenderFacts['plumbing']>('config/plumbing.yaml');
  const ceiling = load<ProjectRenderFacts['ceiling']>('config/ceiling.yaml');
  const hvac = load<ProjectRenderFacts['hvac']>('config/hvac.yaml');
  const config = parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8'));
  const geometry = load('config/layout/model-geometry.yaml');
  const overlay = load<{ suppress?: Array<{ wall?: string; walls?: string[] }> }>('config/layout/overlay.yaml');
  const plan = hvac.plans[0];
  const sources = endpointSourcesFromFacts({ electrical, plumbing, ceiling, hvac });
  // Keep the cross-file coordination contract on the same verify:mep gate as
  // geometry lint.  Lint is intentionally permissive for inferred/pending
  // routes, while this validator rejects broken references and contradictory
  // source/status declarations before any findings are emitted.
  validateMepCoordination(config, sources);
  const suppressedWallIds = (overlay.suppress ?? []).flatMap((item) => item.walls ?? (item.wall ? [item.wall] : []));
  return lintMepCoordination(config, sources, {
    layout: resolveLayout(geometry as Parameters<typeof resolveLayout>[0]),
    ceiling,
    suppressedWallIds,
    referenceConstraints: plan?.diagram.reference_constraints,
  });
}

const jsonOutput = process.argv.includes('--json');
/** (e) 分桶汇总行：按桶给 count + 类别明细，末尾输出（JSON 模式只走 result.categories 字段，保持 stdout 纯净）。 */
const CATEGORY_LABELS: Record<string, string> = {
  must_fix_before_briefing: '交底前必须清',
  survey_dependent: '量房后自然消/复判',
  envelope_approximation: '模型包络近似/非物理需求',
};
const originalLog = console.log;
const originalWarn = console.warn;
if (jsonOutput) {
  // Keep stdout reserved for the machine-readable result. Layout resolution may log warnings.
  console.log = () => undefined;
  console.warn = () => undefined;
}
let result: MepLintResult;
try {
  result = runMepLint();
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
}
if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`MEP lint: ${lintLevel(result)} (${result.counts.errors} errors, ${result.counts.warnings} warnings)\n`);
  for (const item of [...result.errors, ...result.warnings]) process.stdout.write(`${item.level.toUpperCase()} [${item.code}] ${item.message}\n`);
  process.stdout.write('warning 分桶（含 error，每桶 count = 该桶各类计数之和）：\n');
  for (const category of MEP_LINT_CATEGORIES) {
    const bucket = result.categories?.[category];
    if (!bucket) continue; // 调用方自建 result（未过分桶）时不输出汇总
    const detail = bucket.codes.map((entry) => `${entry.code} ×${entry.count}`).join('、');
    process.stdout.write(`  ${category}（${CATEGORY_LABELS[category] ?? category}）: ${bucket.count}${detail ? ` — ${detail}` : ''}\n`);
  }
}
if (result.errors.length > 0) process.exitCode = 1;
