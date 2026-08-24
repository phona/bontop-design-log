import type {
  Vertex,
  WallDef,
  RoomDef,
  VertexLayoutYaml,
  ResolvedLayout,
  ResolvedRoom,
  ResolvedWall,
  CurtainPoint,
} from '../shared/types.js';

interface VMap {
  id: string;
  x: number;
  z: number;
  radius?: number;
}

function indexVertices(vertices: Vertex[]): Map<string, VMap> {
  const map = new Map<string, VMap>();
  for (const v of vertices) {
    if (map.has(v.id)) {
      throw new Error(`Duplicate vertex id: ${v.id}`);
    }
    if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) {
      throw new Error(`Vertex ${v.id} has non-finite coordinates`);
    }
    if (v.radius !== undefined && v.radius < 0) {
      throw new Error(`Vertex ${v.id} has negative radius`);
    }
    map.set(v.id, { id: v.id, x: v.x, z: v.z, radius: v.radius });
  }
  return map;
}

type Pt = { x: number; z: number };

function polygonArea(pts: Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return area / 2;
}

function ensureCCW<T extends Pt>(pts: T[]): T[] {
  if (polygonArea(pts) < 0) {
    return [...pts].reverse();
  }
  return pts;
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function segmentsIntersect(
  p1: Pt, p2: Pt, p3: Pt, p4: Pt
): boolean {
  const d1 = cross(p4.x - p3.x, p4.z - p3.z, p1.x - p3.x, p1.z - p3.z);
  const d2 = cross(p4.x - p3.x, p4.z - p3.z, p2.x - p3.x, p2.z - p3.z);
  const d3 = cross(p2.x - p1.x, p2.z - p1.z, p3.x - p1.x, p3.z - p1.z);
  const d4 = cross(p2.x - p1.x, p2.z - p1.z, p4.x - p1.x, p4.z - p1.z);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function hasSelfIntersection(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
        return true;
      }
    }
  }
  return false;
}

function bbox(pts: Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...pts.map(p => p.x)),
    maxX: Math.max(...pts.map(p => p.x)),
    minZ: Math.min(...pts.map(p => p.z)),
    maxZ: Math.max(...pts.map(p => p.z)),
  };
}

function isAxisAlignedRectangle(pts: Pt[]): boolean {
  if (pts.length !== 4) return false;
  const xs = [...new Set(pts.map(p => p.x))];
  const zs = [...new Set(pts.map(p => p.z))];
  return xs.length === 2 && zs.length === 2;
}

function resolveRoom(
  def: RoomDef | { id: string; name: string; boundary: string[]; height: number; type?: string },
  vmap: Map<string, VMap>,
  openEdges: ResolvedLayout['openEdges']
): ResolvedRoom {
  const pts: CurtainPoint[] = [];
  for (const vid of def.boundary) {
    const v = vmap.get(vid);
    if (!v) throw new Error(`Unknown vertex: ${vid} in room ${def.id}`);
    pts.push({ x: v.x, z: v.z, radius: v.radius });
  }

  if (pts.length < 3) {
    throw new Error(`Room ${def.id} boundary has < 3 vertices`);
  }

  const ccw = ensureCCW(pts);
  if (ccw !== pts) {
    console.warn(`Room ${def.id} boundary was CW, auto-reversed to CCW`);
  }

  if (hasSelfIntersection(ccw)) {
    throw new Error(`Self-intersecting boundary in room ${def.id}`);
  }

  const b = bbox(ccw);
  const width = b.maxX - b.minX;
  const depth = b.maxZ - b.minZ;
  const area = Math.abs(polygonArea(ccw));
  const isRect = isAxisAlignedRectangle(ccw) && !ccw.some(p => p.radius);

  const rawType = (def as RoomDef).type ?? 'public';
  if (rawType !== 'public' && rawType !== 'private' && rawType !== 'service') {
    throw new Error(`Room ${def.id} has invalid type: ${rawType}`);
  }

  return {
    id: def.id,
    name: def.name,
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    width,
    depth,
    height: def.height,
    type: rawType,
    points: isRect ? undefined : ccw,
    area,
    boundary_count: def.boundary.length,
  };
}

function normalize(v: Pt): Pt {
  const len = Math.hypot(v.x, v.z);
  return len > 0 ? { x: v.x / len, z: v.z / len } : { x: 0, z: 0 };
}

function tangentPoints(
  corner: VMap,
  prev: VMap,
  next: VMap
): { t1: Pt; t2: Pt; center: Pt } {
  const r = corner.radius!;
  const dPrev = normalize({ x: prev.x - corner.x, z: prev.z - corner.z });
  const dNext = normalize({ x: next.x - corner.x, z: next.z - corner.z });

  // Arc center: intersection of wall offset lines
  const signX = corner.x + dNext.x * r > corner.x ? 1 : -1;
  const signZ = corner.z + dPrev.z * r > corner.z ? 1 : -1;
  const center = { x: corner.x + signX * r, z: corner.z + signZ * r };

  // Tangent points: where the arc meets the walls (perpendicular from center)
  const t1 = { x: corner.x, z: center.z };
  const t2 = { x: center.x, z: corner.z };
  return { t1, t2, center };
}

function arcSegments(
  center: Pt, r: number,
  startAngle: number, endAngle: number, n: number
): Array<{ x1: number; z1: number; x2: number; z2: number }> {
  const segs: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
  for (let i = 0; i < n; i++) {
    const a1 = startAngle + (endAngle - startAngle) * (i / n);
    const a2 = startAngle + (endAngle - startAngle) * ((i + 1) / n);
    segs.push({
      x1: center.x + r * Math.cos(a1), z1: center.z + r * Math.sin(a1),
      x2: center.x + r * Math.cos(a2), z2: center.z + r * Math.sin(a2),
    });
  }
  return segs;
}

function resolveWall(
  def: WallDef,
  vmap: Map<string, VMap>,
  allWalls: WallDef[]
): ResolvedWall {
  const from = vmap.get(def.from);
  const to = vmap.get(def.to);
  if (!from) throw new Error(`Wall ${def.id} references unknown vertex: ${def.from}`);
  if (!to) throw new Error(`Wall ${def.id} references unknown vertex: ${def.to}`);

  let x1 = from.x, z1 = from.z, x2 = to.x, z2 = to.z;
  let segments: Array<{ x1: number; z1: number; x2: number; z2: number }> | undefined;
  let arcCenterX: number | undefined;
  let arcCenterZ: number | undefined;

  // If 'from' has radius, trim 'from' end to tangent + prepend arc
  // If 'to' has radius, trim 'to' end to tangent (arc owned by the next wall whose 'from' is 'to')
  if (from.radius) {
    // Find the wall that ends at 'from' (the previous wall in the corner)
    const prevWall = allWalls.find(w => w.to === def.from);
    if (prevWall) {
      const prevFrom = vmap.get(prevWall.from)!;
      // Skip arc if prev and current walls are collinear (dot ≈ ±1, same line)
      const dPrev = normalize({ x: prevFrom.x - from.x, z: prevFrom.z - from.z });
      const dCurr = normalize({ x: to.x - from.x, z: to.z - from.z });
      const dot = dPrev.x * dCurr.x + dPrev.z * dCurr.z;
      if (Math.abs(dot) > 0.99) {
        segments = [{ x1, z1, x2, z2 }];
      } else {
        const { t1, t2, center } = tangentPoints(from, prevFrom, to);
        arcCenterX = center.x; arcCenterZ = center.z;
        x1 = t1.x; z1 = t1.z;
        const startAngle = Math.atan2(t1.z - center.z, t1.x - center.x);
        const endAngle = Math.atan2(t2.z - center.z, t2.x - center.x);
        const arc = arcSegments(center, from.radius, startAngle, endAngle, 16);
        segments = [...arc, { x1: t2.x, z1: t2.z, x2: to.x, z2: to.z }];
      }
    } else {
      segments = [{ x1, z1, x2, z2 }];
    }
  } else if (to.radius) {
    // Trim 'to' to tangent point (arc owned by the next wall whose 'from' is 'to')
    const nextWall = allWalls.find(w => w.from === def.to);
    if (nextWall) {
      const nextTo = vmap.get(nextWall.to)!;
      const { t1 } = tangentPoints(to, from, nextTo);
      // Only trim if tangent is on the wall segment (within dot range + on the line)
      const dx = t1.x - x1, dz = t1.z - z1;
      const origDx = x2 - x1, origDz = z2 - z1;
      const lenSq = origDx * origDx + origDz * origDz;
      if (lenSq > 0.001) {
        const dot = (dx * origDx + dz * origDz) / lenSq;
        const perpDist = Math.abs(dx * origDz - dz * origDx) / Math.sqrt(lenSq);
        if (dot >= 0 && dot <= 1 && perpDist < 0.01) {
          x2 = t1.x; z2 = t1.z;
        }
      }
    }
    segments = [{ x1, z1, x2, z2 }];
  } else {
    segments = [{ x1, z1, x2, z2 }];
  }

  return { id: def.id, x1, z1, x2, z2, height: def.height, segments,
    ...(from.radius ? { fromX: from.x, fromZ: from.z, fromRadius: from.radius, arcCenterX, arcCenterZ } : {}) };
}

function resolveOpening(
  op: { id: string; type: string; wall: string; anchor: string; offset: number; width: number; height: number; sill?: number; room?: string; swing?: 'inward' | 'outward'; hinge?: 'start' | 'end' },
  wall: ResolvedWall,
  vmap: Map<string, VMap>
): NonNullable<ResolvedWall['openings']>[number] {
  const anchor = vmap.get(op.anchor);
  if (!anchor) throw new Error(`Opening ${op.id} references unknown vertex: ${op.anchor}`);

  // Wall direction: from anchor toward the other end
  const isAnchorFrom = (Math.abs(anchor.x - wall.x1) < 0.01 && Math.abs(anchor.z - wall.z1) < 0.01);
  const otherEnd = isAnchorFrom
    ? { x: wall.x2, z: wall.z2 }
    : { x: wall.x1, z: wall.z1 };
  const dx = otherEnd.x - anchor.x;
  const dz = otherEnd.z - anchor.z;
  const wallLen = Math.hypot(dx, dz);
  if (wallLen < 0.001) throw new Error(`Wall ${op.wall} has zero length`);

  // Opening center = anchor + offset * direction
  const ux = dx / wallLen;
  const uz = dz / wallLen;
  const cx = anchor.x + ux * op.offset;
  const cz = anchor.z + uz * op.offset;

  // Validate offset bounds
  if (op.offset - op.width / 2 < -0.01 || op.offset + op.width / 2 > wallLen + 0.01) {
    throw new Error(`Opening ${op.id} exceeds wall ${op.wall} (offset=${op.offset}, width=${op.width}, wallLen=${wallLen.toFixed(2)})`);
  }

  return {
    id: op.id,
    type: op.type,
    x: cx,
    z: cz,
    width: op.width,
    height: op.height,
    sill: op.sill,
    room: op.room,
    swing: op.swing,
    hinge: op.hinge,
  };
}

export function resolveLayout(raw: VertexLayoutYaml): ResolvedLayout {
  const vmap = indexVertices(raw.vertices);
  const openEdges: ResolvedLayout['openEdges'] = [];

  // Resolve rooms
  const rooms: ResolvedRoom[] = raw.rooms.map(r => resolveRoom(r, vmap, openEdges));

  // Resolve platform
  const platform = raw.platform ? resolveRoom(raw.platform, vmap, openEdges) : undefined;

  // Resolve walls
  const walls: ResolvedWall[] = raw.walls.map(w => resolveWall(w, vmap, raw.walls));

  // Resolve openings
  for (let i = 0; i < walls.length; i++) {
    const wdef = raw.walls[i];
    if (wdef.openings) {
      walls[i].openings = wdef.openings.map(op => resolveOpening(op, walls[i], vmap));
    }
  }

  // Auto-derive open edges: for each room boundary edge, check if a wall covers it
  for (let ri = 0; ri < raw.rooms.length; ri++) {
    const rdef = raw.rooms[ri];
    const boundary = rdef.boundary;
    for (let bi = 0; bi < boundary.length; bi++) {
      const fromId = boundary[bi];
      const toId = boundary[(bi + 1) % boundary.length];
      const hasWall = raw.walls.some(w =>
        (w.from === fromId && w.to === toId) || (w.from === toId && w.to === fromId)
      );
      if (!hasWall) {
        openEdges.push({ room: rdef.id, from: fromId, to: toId });
      }
    }
  }
  // Also check platform
  if (raw.platform) {
    const boundary = raw.platform.boundary;
    for (let bi = 0; bi < boundary.length; bi++) {
      const fromId = boundary[bi];
      const toId = boundary[(bi + 1) % boundary.length];
      const hasWall = raw.walls.some(w =>
        (w.from === fromId && w.to === toId) || (w.from === toId && w.to === fromId)
      );
      if (!hasWall) {
        openEdges.push({ room: raw.platform.id, from: fromId, to: toId });
      }
    }
  }

  return { rooms, platform, walls, vertices: raw.vertices, openEdges };
}
