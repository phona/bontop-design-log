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

// Tolerance for treating two wall segments as collinear (same x or same z).
const POSITION_TOLERANCE = 0.05;
// Minimum overlap between a room edge and a supporting wall segment.
const OVERLAP_TOLERANCE = 0.10;
// Tolerance for the coarse wall-bounding-box check.
const BOUNDS_TOLERANCE = 0.01;

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

function isHorizontal(w: Wall) {
  return Math.abs(w.z1 - w.z2) < POSITION_TOLERANCE;
}

function isVertical(w: Wall) {
  return Math.abs(w.x1 - w.x2) < POSITION_TOLERANCE;
}

interface Interval {
  min: number;
  max: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.min - b.min);
  const merged: Interval[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.min <= last.max + POSITION_TOLERANCE) {
      last.max = Math.max(last.max, curr.max);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

function mergeWalls(walls: Wall[]): Wall[] {
  const merged: Wall[] = [];

  // Merge horizontal wall segments that share the same z within tolerance.
  const horizontal = walls.filter(isHorizontal);
  horizontal.sort((a, b) => (a.z1 + a.z2) / 2 - (b.z1 + b.z2) / 2);
  const hGroups: Wall[][] = [];
  for (const w of horizontal) {
    const z = (w.z1 + w.z2) / 2;
    if (hGroups.length === 0 || Math.abs(z - (hGroups[hGroups.length - 1][0].z1 + hGroups[hGroups.length - 1][0].z2) / 2) >= POSITION_TOLERANCE) {
      hGroups.push([w]);
    } else {
      hGroups[hGroups.length - 1].push(w);
    }
  }
  for (const group of hGroups) {
    const z = (group[0].z1 + group[0].z2) / 2;
    const intervals = group.map(w => ({ min: Math.min(w.x1, w.x2), max: Math.max(w.x1, w.x2) }));
    for (const iv of mergeIntervals(intervals)) {
      merged.push({ x1: iv.min, z1: z, x2: iv.max, z2: z });
    }
  }

  // Merge vertical wall segments that share the same x within tolerance.
  const vertical = walls.filter(isVertical);
  vertical.sort((a, b) => (a.x1 + a.x2) / 2 - (b.x1 + b.x2) / 2);
  const vGroups: Wall[][] = [];
  for (const w of vertical) {
    const x = (w.x1 + w.x2) / 2;
    if (vGroups.length === 0 || Math.abs(x - (vGroups[vGroups.length - 1][0].x1 + vGroups[vGroups.length - 1][0].x2) / 2) >= POSITION_TOLERANCE) {
      vGroups.push([w]);
    } else {
      vGroups[vGroups.length - 1].push(w);
    }
  }
  for (const group of vGroups) {
    const x = (group[0].x1 + group[0].x2) / 2;
    const intervals = group.map(w => ({ min: Math.min(w.z1, w.z2), max: Math.max(w.z1, w.z2) }));
    for (const iv of mergeIntervals(intervals)) {
      merged.push({ x1: x, z1: iv.min, x2: x, z2: iv.max });
    }
  }

  return merged;
}

interface Edge {
  roomId: string;
  side: 'north' | 'south' | 'west' | 'east';
  pos: number;
  min: number;
  max: number;
}

interface WallMatch {
  wall: Wall;
  distance: number;
  overlap: number;
  wallPos: number;
}

function getEdges(r: Room): Edge[] {
  const x1 = r.x - r.width / 2;
  const x2 = r.x + r.width / 2;
  const z1 = r.z - r.depth / 2;
  const z2 = r.z + r.depth / 2;
  return [
    { roomId: r.id, side: 'north', pos: z1, min: x1, max: x2 },
    { roomId: r.id, side: 'south', pos: z2, min: x1, max: x2 },
    { roomId: r.id, side: 'west', pos: x1, min: z1, max: z2 },
    { roomId: r.id, side: 'east', pos: x2, min: z1, max: z2 },
  ];
}

function axisLabel(side: Edge['side']) {
  return side === 'north' || side === 'south' ? 'z' : 'x';
}

function checkEdgeAlignment(edge: Edge, walls: Wall[]): { ok: boolean; nearest?: WallMatch } {
  let bestSupport: WallMatch | null = null;
  let nearest: WallMatch | null = null;

  for (const w of walls) {
    let match: WallMatch;
    if (edge.side === 'north' || edge.side === 'south') {
      if (!isHorizontal(w)) continue;
      const wallPos = (w.z1 + w.z2) / 2;
      const wallX1 = Math.min(w.x1, w.x2);
      const wallX2 = Math.max(w.x1, w.x2);
      const distance = Math.abs(wallPos - edge.pos);
      const overlap = Math.max(0, Math.min(wallX2, edge.max) - Math.max(wallX1, edge.min));
      match = { wall: w, distance, overlap, wallPos };
    } else {
      if (!isVertical(w)) continue;
      const wallPos = (w.x1 + w.x2) / 2;
      const wallZ1 = Math.min(w.z1, w.z2);
      const wallZ2 = Math.max(w.z1, w.z2);
      const distance = Math.abs(wallPos - edge.pos);
      const overlap = Math.max(0, Math.min(wallZ2, edge.max) - Math.max(wallZ1, edge.min));
      match = { wall: w, distance, overlap, wallPos };
    }

    if (!nearest || match.distance < nearest.distance || (match.distance === nearest.distance && match.overlap > nearest.overlap)) {
      nearest = match;
    }
    if (match.distance < POSITION_TOLERANCE && match.overlap >= OVERLAP_TOLERANCE) {
      if (!bestSupport || match.distance < bestSupport.distance || (match.distance === bestSupport.distance && match.overlap > bestSupport.overlap)) {
        bestSupport = match;
      }
    }
  }

  return { ok: bestSupport !== null, nearest: nearest || undefined };
}

function main() {
  const { rooms, walls } = loadGeometry();
  const { minX, maxX, minZ, maxZ } = wallBounds(walls);
  console.log('Wall bounding box:', { minX: minX.toFixed(2), maxX: maxX.toFixed(2), minZ: minZ.toFixed(2), maxZ: maxZ.toFixed(2) });

  const mergedWalls = mergeWalls(walls);

  let outsideCount = 0;
  let misalignedCount = 0;

  for (const r of rooms) {
    const rx1 = r.x - r.width / 2;
    const rx2 = r.x + r.width / 2;
    const rz1 = r.z - r.depth / 2;
    const rz2 = r.z + r.depth / 2;

    const outside = rx1 < minX - BOUNDS_TOLERANCE || rx2 > maxX + BOUNDS_TOLERANCE || rz1 < minZ - BOUNDS_TOLERANCE || rz2 > maxZ + BOUNDS_TOLERANCE;
    if (outside) {
      outsideCount++;
      console.log(`OUTSIDE WALLS: ${r.id} x=[${rx1.toFixed(2)},${rx2.toFixed(2)}] z=[${rz1.toFixed(2)},${rz2.toFixed(2)}]`);
      continue;
    }

    const edges = getEdges(r);
    for (const edge of edges) {
      const result = checkEdgeAlignment(edge, mergedWalls);
      if (!result.ok) {
        misalignedCount++;
        const n = result.nearest;
        const nearestInfo = n
          ? ` (nearest wall ${axisLabel(edge.side)}=${n.wallPos.toFixed(2)} overlap=${n.overlap.toFixed(2)} distance=${n.distance.toFixed(2)})`
          : '';
        console.log(`MISALIGNED: ${r.id} ${edge.side} edge at ${axisLabel(edge.side)}=${edge.pos.toFixed(2)} range=[${edge.min.toFixed(2)},${edge.max.toFixed(2)}]${nearestInfo}`);
      }
    }
  }

  if (outsideCount === 0 && misalignedCount === 0) {
    console.log('All rooms are inside the wall bounding box and aligned with wall edges.');
  } else {
    if (outsideCount > 0) {
      console.log(`Found ${outsideCount} room(s) outside wall bounds.`);
    }
    if (misalignedCount > 0) {
      console.log(`Found ${misalignedCount} misaligned room edge(s).`);
    }
    process.exit(1);
  }
}

main();
