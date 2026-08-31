import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { endpointSourcesFromFacts, parseMepCoordination } from '../../../shared/mep-hvac-coordination-schema.js';
import { lintLevel, lintMepCoordination, type MepLintResult } from '../../../shared/mep-hvac-lint.js';
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
  const suppressedWallIds = (overlay.suppress ?? []).flatMap((item) => item.walls ?? (item.wall ? [item.wall] : []));
  return lintMepCoordination(config, sources, {
    layout: resolveLayout(geometry as Parameters<typeof resolveLayout>[0]),
    ceiling,
    suppressedWallIds,
    referenceConstraints: plan?.diagram.reference_constraints,
  });
}

const jsonOutput = process.argv.includes('--json');
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
}
if (result.errors.length > 0) process.exitCode = 1;
