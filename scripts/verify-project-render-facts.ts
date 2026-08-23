import { readFileSync } from 'node:fs';
import {
  parseCeilingZones,
  parseElectricalPoints,
  parsePlumbingPoints,
  parseProjectRenderFactsProjection,
  parseRenderLightingOverrides,
} from '../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import type { CurrentScheme } from '../shared/types.js';

const projection = buildProjectRenderFactsProjection(
  {
    electrical: parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8')),
    plumbing: parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8')),
    ceiling: parseCeilingZones(readFileSync('config/ceiling.yaml', 'utf8')),
  },
  parseRenderLightingOverrides(readFileSync('config/render/overrides.yaml', 'utf8')),
  JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme,
);
const generated = parseProjectRenderFactsProjection(
  JSON.parse(readFileSync('scripts/blender/project-render-facts.json', 'utf8')),
);

if (JSON.stringify(generated) !== JSON.stringify(projection)) {
  throw new Error('scripts/blender/project-render-facts.json is stale; run npm run generate:project-render-facts');
}

console.log(`ProjectRenderFacts verified: electrical=${projection.lightingFixtures.length} lighting fixtures, plumbing=${projection.plumbing.length}, ceiling=${projection.ceiling.length}`);
