import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Room {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

interface Wall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

function loadGeometry() {
  const file = readFileSync(join(process.cwd(), 'config/layout/model-geometry.yaml'), 'utf8');
  const data = load(file) as { rooms: Room[]; walls: Wall[] };
  return data;
}

function wallBounds(walls: Wall[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2);
    maxX = Math.max(maxX, w.x1, w.x2);
    minZ = Math.min(minZ, w.z1, w.z2);
    maxZ = Math.max(maxZ, w.z1, w.z2);
  }
  return { minX, maxX, minZ, maxZ };
}

function main() {
  const { rooms, walls } = loadGeometry();
  const { minX, maxX, minZ, maxZ } = wallBounds(walls);
  console.log('Wall bounding box:', { minX: minX.toFixed(2), maxX: maxX.toFixed(2), minZ: minZ.toFixed(2), maxZ: maxZ.toFixed(2) });

  let outsideCount = 0;
  for (const r of rooms) {
    const rx1 = r.x - r.width / 2;
    const rx2 = r.x + r.width / 2;
    const rz1 = r.z - r.depth / 2;
    const rz2 = r.z + r.depth / 2;

    const outside = rx1 < minX - 0.01 || rx2 > maxX + 0.01 || rz1 < minZ - 0.01 || rz2 > maxZ + 0.01;
    if (outside) {
      outsideCount++;
      console.log(`OUTSIDE WALLS: ${r.id} x=[${rx1.toFixed(2)},${rx2.toFixed(2)}] z=[${rz1.toFixed(2)},${rz2.toFixed(2)}]`);
    }
  }

  if (outsideCount === 0) {
    console.log('All rooms are inside the wall bounding box.');
  } else {
    console.log(`Found ${outsideCount} room(s) outside wall bounds.`);
    process.exit(1);
  }
}

main();
