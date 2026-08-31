import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { parseOverlay } from '../../../server/overlay-merge.js';
import { parseElectricalTopology } from '../../../shared/project-render-facts-schema.js';
import { lintElectricalTopology } from '../../../shared/electrical-lint.js';
import type { ElectricalPoint, VertexLayoutYaml } from '../../../shared/types.js';

export function runElectricalLint() {
  const points = yaml.load(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
  const topology = parseElectricalTopology(readFileSync('config/electrical-topology.yaml', 'utf8'), points);
  const geometry = yaml.load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
  const overlay = parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8'));
  return lintElectricalTopology(topology, points, {
    layout: resolveLayout(geometry),
    suppressedWallIds: overlay.suppress.flatMap((item) => item.wall ? [item.wall] : item.walls ?? []),
  });
}

const jsonOutput = process.argv.includes('--json');
const originalLog = console.log;
const originalWarn = console.warn;
if (jsonOutput) {
  console.log = () => undefined;
  console.warn = () => undefined;
}
let result: ReturnType<typeof runElectricalLint>;
try {
  result = runElectricalLint();
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
}
if (jsonOutput) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  process.stdout.write(`Electrical lint: ${result.counts.errors ? 'error' : result.counts.warnings ? 'warning' : 'ok'} (${result.counts.errors} errors, ${result.counts.warnings} warnings)\n`);
  for (const item of [...result.errors, ...result.warnings]) process.stdout.write(`${item.level.toUpperCase()} [${item.code}] ${item.message}\n`);
}
if (result.errors.length > 0) process.exitCode = 1;
