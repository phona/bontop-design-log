import { readFileSync } from 'node:fs';
import { parseElectricalPoints, parseLightingRenderConfig } from '../../../shared/project-render-facts-schema.js';

const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
const lighting = parseLightingRenderConfig(readFileSync('config/render/lighting.yaml', 'utf8'));
const electricalById = new Map(electrical.map((point) => [point.id, point]));
for (const fixture of lighting.fixtures) {
  const point = electricalById.get(fixture.id);
  if (!point) throw new Error(`Lighting config ${fixture.id} references unknown electrical id`);
  if (point.type !== fixture.type) throw new Error(`Lighting config ${fixture.id} type mismatch: ${point.type}`);
  if (fixture.heads.length !== point.heads && point.heads !== undefined) {
    throw new Error(`Lighting config ${fixture.id} head count ${fixture.heads.length} does not match electrical heads ${point.heads}`);
  }
}
for (const point of electrical.filter((item) => item.type === 'track_light')) {
  if (!lighting.fixtures.some((fixture) => fixture.id === point.id)) throw new Error(`Missing lighting config for track fixture ${point.id}`);
}
console.log(`Lighting config verified: ${lighting.fixtures.length} detailed fixtures`);
