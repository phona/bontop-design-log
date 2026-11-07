import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  parseCeilingZones,
  parseCurtainPresentationState,
  parseElectricalPoints,
  parsePlumbingPoints,
  parseProjectHvacFacts,
  parseRenderLightingOverrides,
  parseLightingRenderConfig,
  validateProjectHvacFacts,
} from '../../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsProjection } from '../../shared/project-render-facts-projection.js';
import { pointMountHostIndex } from '../../shared/point-placement.js';
import { load as parseYaml } from 'js-yaml';
import { parseOverlayFiles } from '../../server/overlay-merge.js';
import type { CurrentScheme, ProjectRenderFactsProjection } from '../../shared/types.js';

export function buildProjectRenderFactsFromFiles(rootDir = '.'): ProjectRenderFactsProjection {
  const path = (relative: string) => `${rootDir}/${relative}`;
  const facts = {
    electrical: parseElectricalPoints(readFileSync(path('config/electrical.yaml'), 'utf8')),
    plumbing: parsePlumbingPoints(readFileSync(path('config/plumbing.yaml'), 'utf8')),
    ceiling: parseCeilingZones(readFileSync(path('config/model/envelope/ceiling.yaml'), 'utf8')),
    hvac: parseProjectHvacFacts(readFileSync(path('config/hvac.yaml'), 'utf8')),
  };
  validateProjectHvacFacts(facts.hvac, facts);
  return buildProjectRenderFactsProjection(
    facts,
    parseRenderLightingOverrides(readFileSync(path('config/render/overrides.yaml'), 'utf8')),
    JSON.parse(readFileSync(path('data/current-scheme.json'), 'utf8')) as CurrentScheme,
    // overlay 固定走仓库根的唯一合并点（envelope 三文件，issue #98 S1），不随 rootDir 参数走
    parseOverlayFiles(),
    parseCurtainPresentationState(JSON.parse(readFileSync(path('data/presentation-state.json'), 'utf8'))),
    existsSync(path('config/render/lighting.yaml'))
      ? parseLightingRenderConfig(readFileSync(path('config/render/lighting.yaml'), 'utf8'))
      : { fixtures: [] },
    // mount 挂载灯（issue #98 S2 起夜灯）的宿主索引：house.yaml 第五份输入。
    pointMountHostIndex(Object.values((parseYaml(readFileSync(path('config/house.yaml'), 'utf8')) as { furnishings?: Record<string, Array<Record<string, unknown>>> }).furnishings ?? {}).flat() as never),
  );
}

export function serializeProjectRenderFacts(projection: ProjectRenderFactsProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

export function writeProjectRenderFacts(outputPath: string, rootDir = '.'): ProjectRenderFactsProjection {
  const projection = buildProjectRenderFactsFromFiles(rootDir);
  writeFileSync(outputPath, serializeProjectRenderFacts(projection));
  return projection;
}

function main(): void {
  const outputPath = process.argv[2] ?? 'data/project-render-facts.json';
  const projection = writeProjectRenderFacts(outputPath);
  console.log(`project-render-facts.json: ${projection.lightingFixtures.length} lighting fixtures -> ${outputPath}`);
}

if (process.argv[1] && /project-render-facts-projection\.(ts|js)$/u.test(process.argv[1])) main();
