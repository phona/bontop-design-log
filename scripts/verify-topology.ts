import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { resolveLayout } from '../server/layout-resolver.js';
import type { VertexLayoutYaml } from '../shared/types.js';

const raw = readFileSync('config/layout/model-geometry.yaml', 'utf-8');
const yaml = load(raw) as VertexLayoutYaml;

try {
  const result = resolveLayout(yaml);
  console.log('✓ Topology valid');
  console.log(`  ${result.rooms.length} rooms, ${result.walls.length} walls, ${result.vertices.length} vertices`);
  if (result.openEdges.length > 0) {
    console.log(`  ${result.openEdges.length} open edges (info):`);
    for (const e of result.openEdges) {
      console.log(`    ${e.room}: ${e.from} → ${e.to}`);
    }
  } else {
    console.log('  0 open edges');
  }
  // Check for rooms without any walls (all edges open)
  for (const room of result.rooms) {
    const roomOpenEdges = result.openEdges.filter(e => e.room === room.id);
    if (roomOpenEdges.length === room.boundary_count) {
      console.warn(`  ⚠ Room ${room.id} has ALL edges open (no walls at all)`);
    }
  }
} catch (e) {
  console.error('✗ Topology invalid:', (e as Error).message);
  process.exit(1);
}
