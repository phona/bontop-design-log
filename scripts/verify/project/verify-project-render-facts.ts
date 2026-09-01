import { readFileSync } from 'node:fs';
import { parseProjectRenderFactsProjection } from '../../../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsFromFiles } from '../../project/project-render-facts-projection.js';

const projection = buildProjectRenderFactsFromFiles();
const generated = parseProjectRenderFactsProjection(
  JSON.parse(readFileSync('data/project-render-facts.json', 'utf8')),
);

if (JSON.stringify(generated) !== JSON.stringify(projection)) {
  throw new Error('data/project-render-facts.json is stale; run npm run generate:project-render-facts');
}

console.log(`ProjectRenderFacts verified: electrical=${projection.lightingFixtures.length} lighting fixtures, plumbing=${projection.plumbing.length}, ceiling=${projection.ceiling.length}`);
