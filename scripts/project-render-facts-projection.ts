import { readFileSync, writeFileSync } from 'node:fs';
import {
  parseCeilingZones,
  parseCurtainPresentationState,
  parseElectricalPoints,
  parsePlumbingPoints,
  parseProjectHvacFacts,
  parseRenderLightingOverrides,
  validateProjectHvacFacts,
} from '../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import { parseOverlay } from '../server/overlay-merge.js';
import type { CurrentScheme, ProjectRenderFactsProjection } from '../shared/types.js';

export function buildProjectRenderFactsFromFiles(rootDir = '.'): ProjectRenderFactsProjection {
  const path = (relative: string) => `${rootDir}/${relative}`;
  const facts = {
    electrical: parseElectricalPoints(readFileSync(path('config/electrical.yaml'), 'utf8')),
    plumbing: parsePlumbingPoints(readFileSync(path('config/plumbing.yaml'), 'utf8')),
    ceiling: parseCeilingZones(readFileSync(path('config/ceiling.yaml'), 'utf8')),
    hvac: parseProjectHvacFacts(readFileSync(path('config/hvac.yaml'), 'utf8')),
  };
  validateProjectHvacFacts(facts.hvac, facts);
  return buildProjectRenderFactsProjection(
    facts,
    parseRenderLightingOverrides(readFileSync(path('config/render/overrides.yaml'), 'utf8')),
    JSON.parse(readFileSync(path('data/current-scheme.json'), 'utf8')) as CurrentScheme,
    parseOverlay(readFileSync(path('config/layout/overlay.yaml'), 'utf8')),
    parseCurtainPresentationState(JSON.parse(readFileSync(path('data/presentation-state.json'), 'utf8'))),
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
  const outputPath = process.argv[2] ?? 'scripts/blender/project-render-facts.json';
  const projection = writeProjectRenderFacts(outputPath);
  console.log(`project-render-facts.json: ${projection.lightingFixtures.length} lighting fixtures -> ${outputPath}`);
}

if (process.argv[1] && /project-render-facts-projection\.(ts|js)$/u.test(process.argv[1])) main();
