import { ProjectCatalog } from '../../../server/project-catalog.js';

type Pt = { x: number; z: number };
const EPS = 0.001;

function polygonArea(pts: Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area / 2;
}

function ensureCCW(pts: Pt[]): Pt[] {
  return polygonArea(pts) < 0 ? [...pts].reverse() : pts;
}

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  return Math.abs((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.z >= Math.min(a.z, b.z) - EPS && p.z <= Math.max(a.z, b.z) + EPS;
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = (p4.x - p3.x) * (p1.z - p3.z) - (p4.z - p3.z) * (p1.x - p3.x);
  const d2 = (p4.x - p3.x) * (p2.z - p3.z) - (p4.z - p3.z) * (p2.x - p3.x);
  const d3 = (p2.x - p1.x) * (p3.z - p1.z) - (p2.z - p1.z) * (p3.x - p1.x);
  const d4 = (p2.x - p1.x) * (p4.z - p1.z) - (p2.z - p1.z) * (p4.x - p1.x);

  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true;
  }
  return false;
}

function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) {
        return true;
      }
    }
  }
  return false;
}

function pointStrictlyInside(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].z, yj = poly[j].z;
    const xi = poly[i].x, xj = poly[j].x;
    if ((yi > p.z) !== (yj > p.z)) {
      const xIntersect = ((xj - xi) * (p.z - yi)) / (yj - yi) + xi;
      if (p.x < xIntersect - EPS) inside = !inside;
    }
  }
  return inside;
}

function getRoomPolygon(room: { x: number; z: number; width: number; depth: number; points?: Pt[] }): Pt[] {
  if (room.points && room.points.length >= 3) {
    return ensureCCW(room.points.map((p) => ({ x: p.x, z: p.z })));
  }
  const minX = room.x - room.width / 2;
  const maxX = room.x + room.width / 2;
  const minZ = room.z - room.depth / 2;
  const maxZ = room.z + room.depth / 2;
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ];
}

const cat = ProjectCatalog.load('.');
const rooms = cat.getRooms();
console.log('rooms:', rooms.length);
for (const r of rooms) {
  const xmin = r.x - r.width / 2, xmax = r.x + r.width / 2;
  const zmin = r.z - r.depth / 2, zmax = r.z + r.depth / 2;
  console.log(r.id, 'x:[', xmin.toFixed(2), xmax.toFixed(2), '] z:[', zmin.toFixed(2), zmax.toFixed(2), ']');
}

let overlap = false;
for (let i = 0; i < rooms.length; i++) {
  for (let j = i + 1; j < rooms.length; j++) {
    const polyA = getRoomPolygon(rooms[i] as any);
    const polyB = getRoomPolygon(rooms[j] as any);

    if (polygonsOverlap(polyA, polyB)) {
      console.log('OVERLAP (edge crossing)', rooms[i].id, rooms[j].id);
      overlap = true;
      continue;
    }

    const centerA = { x: rooms[i].x, z: rooms[i].z };
    const centerB = { x: rooms[j].x, z: rooms[j].z };
    if (pointStrictlyInside(centerA, polyB) || pointStrictlyInside(centerB, polyA)) {
      console.log('OVERLAP (containment)', rooms[i].id, rooms[j].id);
      overlap = true;
    }
  }
}
if (!overlap) console.log('No overlaps');
