import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');

interface OverlayElement {
  id: string;
  type: string;
  points?: Array<{ x: number; z: number }>;
  wall?: string;
  walls?: string[];
}

interface WallDef {
  id: string;
  from: string;
  to: string;
}

interface SuppressEntry {
  id: string;
  wall?: string;
  walls?: string[];
}

function main() {
  const overlayPath = path.join(ROOT, 'config/layout/overlay.yaml');
  const geomPath = path.join(ROOT, 'config/layout/model-geometry.yaml');

  const overlay = yaml.load(fs.readFileSync(overlayPath, 'utf8')) as {
    suppress?: SuppressEntry[];
    elements?: OverlayElement[];
  };
  const geom = yaml.load(fs.readFileSync(geomPath, 'utf8')) as {
    walls?: WallDef[];
  };

  const suppressedIds = new Set<string>();
  for (const s of overlay.suppress ?? []) {
    if (s.wall) suppressedIds.add(s.wall);
    if (s.walls) for (const w of s.walls) suppressedIds.add(w);
  }

  const errors: string[] = [];

  const solidWalls = (geom.walls ?? []).filter(w => !suppressedIds.has(w.id));
  console.log(`  solid walls (collision expected): ${solidWalls.length}`);

  const curtainRuns = (overlay.elements ?? []).filter(el => el.type === 'curtain_run');
  console.log(`  curtain_run elements (collision expected): ${curtainRuns.length}`);

  for (const cr of curtainRuns) {
    const hasPoints = cr.points && cr.points.length >= 2;
    const hasWallRef = cr.wall || cr.walls;
    if (!hasPoints && !hasWallRef) {
      errors.push(`curtain_run "${cr.id}" has neither points nor wall ref — cannot generate collision`);
    }
  }

  const railings = (overlay.elements ?? []).filter(el => el.type === 'railing_run');
  console.log(`  railing_run elements (no collision, by design): ${railings.length}`);

  const collidableTypes = new Set(['wall', 'curtain_run']);
  const nonCollidableTypes = new Set(['floor_region', 'bay_sill', 'railing_run', 'glass_infill', 'shower_screen', 'curtain']);
  const conditionalCollidableTypes = new Set(['sliding_door_run']);

  for (const el of overlay.elements ?? []) {
    if (!collidableTypes.has(el.type) && !nonCollidableTypes.has(el.type) && !conditionalCollidableTypes.has(el.type)) {
      errors.push(`unknown element type "${el.type}" (id: ${el.id}) — update collision-utils.ts and this script`);
    }
  }

  const slidingDoors = (overlay.elements ?? []).filter(el => el.type === 'sliding_door_run') as Array<OverlayElement & { open?: boolean }>;
  console.log(`  sliding_door_run elements (collision only when closed): ${slidingDoors.length}`);
  for (const sd of slidingDoors) {
    if (sd.open === false && !(sd.points && sd.points.length >= 2)) {
      errors.push(`sliding_door_run "${sd.id}" is closed but has no points — cannot generate collision`);
    }
  }

  if (errors.length > 0) {
    console.error('\nFAIL:');
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log('\nverify-collision-coverage: OK');
}

main();
