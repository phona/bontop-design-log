import * as THREE from 'three';
import { scaleBoxUvToMeters, scalePlaneUvToMeters } from './uv-utils.js';

/** Plan corners of a ceiling zone footprint, in the area `[x1, z1, x2, z2]` order. */
export type CeilingCorner = 'nw' | 'ne' | 'se' | 'sw';

/** 铝扣板分格缝声明：`module` 为单块边长（米），`seam_width` 缝宽，`seam_color` 缝色。 */
export interface BucklePanelSpec {
  module: number;
  seam_width?: number;
  seam_color?: string;
}

export interface CeilingZoneSpec {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  /** Optional plan rounding radius applied to all four corners, in metres. */
  corner_radius?: number;
  /**
   * Optional per-corner rounding radii (metres). Declared corners override
   * `corner_radius`; a corner absent from the map falls back to `corner_radius`
   * (or square when neither is declared). Use this to round only genuinely
   * exposed convex corners — butt joints, coplanar joints and wall junctions
   * must stay orthogonal (DEC-2026-10-05-R18 附则).
   */
  corner_radii?: Partial<Record<CeilingCorner, number>>;
  /**
   * Optional concave (reentrant) corner fillets in metres, keyed by plan corner.
   * A fillet ADDS material: the outline runs `radius` past the corner along both
   * adjacent edges and joins them with a tangent arc, so a sharp reentrant corner
   * of a drop band becomes a soft elbow. Use it where two exposed bulkhead faces
   * of the same ring meet (DEC-2026-10-07-R01: 餐厅吊顶环「一圈圆」).
   */
  concave_fillets?: Partial<Record<CeilingCorner, number>>;
  /** Optional aluminium panel module declaration for `aluminum_buckle` zones. */
  buckle_panel?: BucklePanelSpec;
  /** Optional inspection layer applied to every generated part of this zone. */
  inspection_layer?: string;
  /** Material opacity while the declared inspection layer is active. */
  inspection_opacity?: number;
  note?: string;
}

const SLAB_EPS = 0.002;
const SKIRT_THICKNESS = 0.02;
const SKIRT_INSET = SKIRT_THICKNESS / 2;
const SEAM_HEIGHT = 0.002;
const SEAM_GAP = 0.0015;
const COLOR_DROP = '#f5f5f5';
const COLOR_BUCKLE = '#eceff1';
const COLOR_SEAM = '#6b7a82';

const SOLID_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);
const CORNERS: readonly CeilingCorner[] = ['nw', 'ne', 'se', 'sw'];

function roundedRectangleShape(width: number, depth: number, radii: Record<CeilingCorner, number>): THREE.Shape {
  const halfW = width / 2;
  const halfD = depth / 2;
  const { nw, ne, se, sw } = radii;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + sw, -halfD);
  shape.lineTo(halfW - se, -halfD);
  shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + se);
  shape.lineTo(halfW, halfD - ne);
  shape.quadraticCurveTo(halfW, halfD, halfW - ne, halfD);
  shape.lineTo(-halfW + nw, halfD);
  shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - nw);
  shape.lineTo(-halfW, -halfD + sw);
  shape.quadraticCurveTo(-halfW, -halfD, -halfW + sw, -halfD);
  shape.closePath();
  return shape;
}

function roundedPerimeterShape(width: number, depth: number, radii: Record<CeilingCorner, number>, wallThickness: number): THREE.Shape {
  const outer = roundedRectangleShape(width, depth, radii);
  const innerWidth = Math.max(0.001, width - wallThickness * 2);
  const innerDepth = Math.max(0.001, depth - wallThickness * 2);
  const innerRadii = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    innerRadii[corner] = Math.max(0.001, Math.min(radii[corner] - wallThickness, innerWidth / 2, innerDepth / 2));
  }
  outer.holes.push(roundedRectangleShape(innerWidth, innerDepth, innerRadii));
  return outer;
}

/**
 * Resolve per-corner radii. Returns null when any declared radius is invalid
 * (non-finite, negative or larger than half of the smaller footprint side) —
 * the caller then skips the zone instead of emitting broken geometry.
 */
function resolveCornerRadii(zone: CeilingZoneSpec, width: number, depth: number): Record<CeilingCorner, number> | null {
  const max = Math.min(width, depth) / 2;
  const radii = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    const declared = zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0;
    if (!Number.isFinite(declared) || declared < 0 || declared > max) return null;
    radii[corner] = declared;
  }
  return radii;
}

function isUniform(radii: Record<CeilingCorner, number>): number | undefined {
  const first = radii.nw;
  return CORNERS.every((corner) => radii[corner] === first) ? first : undefined;
}

/**
 * Resolve concave fillet radii. Returns null when a fillet is invalid
 * (non-finite, negative, larger than half of the smaller footprint side, or
 * declared next to a convex round on the same corner).
 */
function resolveConcaveFillets(zone: CeilingZoneSpec, width: number, depth: number): Record<CeilingCorner, number> | null {
  const max = Math.min(width, depth) / 2;
  const fillets = { nw: 0, ne: 0, se: 0, sw: 0 } as Record<CeilingCorner, number>;
  for (const corner of CORNERS) {
    const declared = zone.concave_fillets?.[corner] ?? 0;
    if (declared === 0) continue;
    if (!Number.isFinite(declared) || declared < 0 || declared > max) return null;
    if ((zone.corner_radii?.[corner] ?? zone.corner_radius ?? 0) > 0) return null;
    fillets[corner] = declared;
  }
  return fillets;
}

/** Plan point in model coordinates (x east, z south). */
interface PlanPoint { x: number; z: number }

const dist2 = (a: PlanPoint, b: PlanPoint): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Sample one corner arc into chords so the outline stays a plain polygon. */
function arcSamples(center: PlanPoint, start: PlanPoint, end: PlanPoint): PlanPoint[] {
  const radius = dist2(center, start);
  const a0 = Math.atan2(start.z - center.z, start.x - center.x);
  const a1 = Math.atan2(end.z - center.z, end.x - center.x);
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 16)));
  const samples: PlanPoint[] = [];
  for (let step = 1; step < steps; step++) {
    const angle = a0 + (delta * step) / steps;
    samples.push({ x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius });
  }
  return samples;
}

/**
 * Outline of a rectangle whose corners carry mixed treatments:
 * - convex round  → stop `r` before the corner, arc with the corner as centre
 * - concave fillet → run `R` past the corner along both edges, arc around the
 *   centre `corner + R·(dirIn + dirOut)` (material added → soft elbow)
 *
 * Traversal starts at the SW corner's south-edge exit and walks
 * SW → SE → NE → NW, matching `roundedRectangleShape`. Returns null when the
 * two corners sharing an edge would consume more than that edge's length.
 */
export function buildMixedRectangleOutline(
  x1: number, z1: number, x2: number, z2: number,
  radii: Record<CeilingCorner, number>,
  fillets: Record<CeilingCorner, number>,
): PlanPoint[] | null {
  const width = Math.abs(x2 - x1);
  const depth = Math.abs(z2 - z1);
  const events: Array<{ key: CeilingCorner; point: PlanPoint; dirIn: PlanPoint; dirOut: PlanPoint }> = [
    { key: 'sw', point: { x: x1, z: z2 }, dirIn: { x: 0, z: 1 }, dirOut: { x: 1, z: 0 } },
    { key: 'se', point: { x: x2, z: z2 }, dirIn: { x: 1, z: 0 }, dirOut: { x: 0, z: -1 } },
    { key: 'ne', point: { x: x2, z: z1 }, dirIn: { x: 0, z: -1 }, dirOut: { x: -1, z: 0 } },
    { key: 'nw', point: { x: x1, z: z1 }, dirIn: { x: -1, z: 0 }, dirOut: { x: 0, z: 1 } },
  ];
  const edges: Array<[CeilingCorner, CeilingCorner, number]> = [
    ['sw', 'se', width],
    ['se', 'ne', depth],
    ['ne', 'nw', width],
    ['nw', 'sw', depth],
  ];
  const consumed = (key: CeilingCorner): number => (fillets[key] > 0 ? fillets[key] : radii[key]);
  for (const [a, b, length] of edges) {
    if (consumed(a) + consumed(b) > length + 1e-9) return null;
  }

  const outline: PlanPoint[] = [];
  for (const event of events) {
    const { point, dirIn, dirOut } = event;
    const fillet = fillets[event.key];
    const round = radii[event.key];
    let entry: PlanPoint;
    let exit: PlanPoint;
    let arc: { center: PlanPoint; start: PlanPoint; end: PlanPoint } | null = null;
    if (fillet > 0) {
      entry = { x: point.x + dirIn.x * fillet, z: point.z + dirIn.z * fillet };
      exit = { x: point.x + dirOut.x * fillet, z: point.z + dirOut.z * fillet };
      arc = {
        center: { x: point.x + (dirIn.x + dirOut.x) * fillet, z: point.z + (dirIn.z + dirOut.z) * fillet },
        start: entry,
        end: exit,
      };
    } else if (round > 0) {
      entry = { x: point.x - dirIn.x * round, z: point.z - dirIn.z * round };
      exit = { x: point.x + dirOut.x * round, z: point.z + dirOut.z * round };
      arc = { center: { x: point.x, z: point.z }, start: entry, end: exit };
    } else {
      entry = { x: point.x, z: point.z };
      exit = { x: point.x, z: point.z };
    }
    if (outline.length === 0 || dist2(outline[outline.length - 1], entry) > 1e-9) outline.push(entry);
    if (arc) outline.push(...arcSamples(arc.center, arc.start, arc.end));
    if (!arc || dist2(entry, exit) > 1e-9) outline.push(exit);
  }
  return outline.length >= 3 ? outline : null;
}

/** Plan outline → THREE.Shape in the builder's local frame (local y = −world z). */
function outlineShape(outline: PlanPoint[], cx: number, cz: number): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((point, index) => {
    const lx = point.x - cx;
    const ly = cz - point.z;
    if (index === 0) shape.moveTo(lx, ly);
    else shape.lineTo(lx, ly);
  });
  shape.closePath();
  return shape;
}

/**
 * 铝扣板分格缝：沿 `area` 最小角起按 `module` 排块，缝为略低于板面的暗色细条。
 * 只对无圆角的矩形 footprint 生效——带圆角/异形边直接用直缝会越出板面。
 */
function buildBuckleSeams(zone: CeilingZoneSpec, area: [number, number, number, number], topY: number): THREE.Mesh[] {
  const panel = zone.buckle_panel;
  if (!panel) return [];
  const module = panel.module;
  if (!Number.isFinite(module) || module < 0.1 || module > 1.2) return [];
  const seamWidth = panel.seam_width ?? 0.006;
  if (!Number.isFinite(seamWidth) || seamWidth <= 0 || seamWidth >= module) return [];
  const [x1, z1, x2, z2] = area;
  const w = x2 - x1;
  const d = z2 - z1;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const countX = Math.floor((w + 1e-9) / module);
  const countZ = Math.floor((d + 1e-9) / module);
  if (countX < 2 && countZ < 2) return [];
  const material = new THREE.MeshStandardMaterial({
    color: panel.seam_color ?? COLOR_SEAM,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const seamY = topY - SEAM_GAP - SEAM_HEIGHT / 2;
  const mkSeam = (sizeX: number, sizeZ: number, px: number, pz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, SEAM_HEIGHT, sizeZ), material);
    mesh.position.set(px, seamY, pz);
    mesh.userData = {
      part: 'buckle-seam',
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
    return mesh;
  };  const seams: THREE.Mesh[] = [];
  for (let i = 1; i < countX; i++) seams.push(mkSeam(seamWidth, d, x1 + i * module, cz));
  for (let i = 1; i < countZ; i++) seams.push(mkSeam(w, seamWidth, cx, z1 + i * module));
  return seams;
}

export function buildCeilingZone(zone: CeilingZoneSpec, ceilingHeight = 2.8): THREE.Group | null {
  if (!SOLID_TYPES.has(zone.type)) return null;
  if (!zone.area || zone.thickness === undefined) return null;
  if (zone.thickness <= 0) return null;

  const [x1, z1, x2, z2] = zone.area;
  const w = x2 - x1;
  const d = z2 - z1;
  if (w <= 0 || d <= 0) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const topY = ceilingHeight - zone.thickness + SLAB_EPS;
  const isBuckle = zone.type === 'aluminum_buckle';
  const radii = resolveCornerRadii(zone, w, d);
  if (!radii) return null;
  const fillets = resolveConcaveFillets(zone, w, d);
  if (!fillets) return null;
  const radius = Math.max(radii.nw, radii.ne, radii.se, radii.sw);
  const filletRadius = Math.max(fillets.nw, fillets.ne, fillets.se, fillets.sw);
  // Mixed outline (convex rounds and/or concave fillets) needs a sampled polygon
  // plus a solid prism for the sides; pure convex rounding keeps the Bézier path.
  const outline = filletRadius > 0
    ? buildMixedRectangleOutline(x1, z1, x2, z2, radii, fillets)
    : null;
  if (filletRadius > 0 && !outline) return null;

  const slabMat = new THREE.MeshStandardMaterial({
    color: isBuckle ? COLOR_BUCKLE : COLOR_DROP,
    roughness: isBuckle ? 0.6 : 0.9,
    metalness: isBuckle ? 0.3 : 0.02,
    side: THREE.DoubleSide,
  });
  let slabGeo: THREE.BufferGeometry;
  let perimeter: THREE.Mesh | undefined;
  if (outline) {
    slabGeo = new THREE.ShapeGeometry(outlineShape(outline, cx, cz));
    const perimeterGeo = new THREE.ExtrudeGeometry(outlineShape(outline, cx, cz), { depth: zone.thickness, bevelEnabled: false, steps: 1 });
    perimeterGeo.translate(0, 0, -zone.thickness);
    perimeter = new THREE.Mesh(perimeterGeo, slabMat);
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.set(cx, ceilingHeight + SLAB_EPS, cz);
    perimeter.userData = {
      part: 'rounded-perimeter',
      ceilingPersistent: true,
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
  } else if (radius > 0) {
    slabGeo = new THREE.ShapeGeometry(roundedRectangleShape(w, d, radii));
    const perimeterGeo = new THREE.ExtrudeGeometry(roundedPerimeterShape(w, d, radii, SKIRT_THICKNESS), { depth: zone.thickness, bevelEnabled: false, steps: 1 });
    perimeterGeo.translate(0, 0, -zone.thickness);
    perimeter = new THREE.Mesh(perimeterGeo, slabMat);
    perimeter.rotation.x = -Math.PI / 2;
    perimeter.position.set(cx, ceilingHeight + SLAB_EPS, cz);
    perimeter.userData = {
      part: 'rounded-perimeter',
      ceilingPersistent: true,
      ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
      ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
    };
  } else {
    const planeGeo = new THREE.PlaneGeometry(w, d);
    scalePlaneUvToMeters(planeGeo, w, d);
    slabGeo = planeGeo;
  }
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.rotation.x = -Math.PI / 2;
  // A rounded AC drop needs a real underside at the drop bottom. Keep this
  // inspection-layer plate persistent so orbit/dollhouse mode cannot hide the
  // white head-box; ordinary (non-rounded) ceiling slabs retain their usual
  // ceiling index and visibility semantics.
  slab.position.set(cx, topY, cz);
  slab.userData = {
    part: 'slab',
    ...(radius > 0 || filletRadius > 0 ? { ceilingPersistent: true } : {}),
    ...(zone.inspection_layer ? { inspectionLayer: zone.inspection_layer } : {}),
    ...(zone.inspection_opacity !== undefined ? { inspectionOpacity: zone.inspection_opacity } : {}),
  };

  const skirtMat = new THREE.MeshStandardMaterial({
    color: COLOR_DROP,
    roughness: 0.9,
    metalness: 0.02,
  });
  const skirtH = zone.thickness;
  const skirtY = ceilingHeight - skirtH / 2;
  const mkSkirt = (len: number, px: number, pz: number, rotY: number) => {
    const geo = new THREE.BoxGeometry(len, skirtH, SKIRT_THICKNESS);
    scaleBoxUvToMeters(geo, len, skirtH);
    const m = new THREE.Mesh(geo, skirtMat);
    m.position.set(px, skirtY, pz);
    m.rotation.y = rotY;
    m.userData = { part: 'skirt' };
    return m;
  };
  const skirts = radius > 0 || filletRadius > 0 ? [] : [
      mkSkirt(w, cx, z1 + SKIRT_INSET, 0),
      mkSkirt(w, cx, z2 - SKIRT_INSET, 0),
      mkSkirt(d, x1 + SKIRT_INSET, cz, Math.PI / 2),
      mkSkirt(d, x2 - SKIRT_INSET, cz, Math.PI / 2),
    ];

  const seams = isBuckle && radius === 0 && filletRadius === 0 ? buildBuckleSeams(zone, zone.area, topY) : [];

  const group = new THREE.Group();
  group.add(slab, ...(perimeter ? [perimeter] : skirts), ...seams);
  const uniform = isUniform(radii);
  group.userData = {
    type: 'ceiling_zone',
    objectId: zone.id,
    roomId: zone.room,
    cornerRadii: radii,
    concaveRadii: fillets,
    ...(uniform !== undefined ? { cornerRadius: uniform } : {}),
  };
  return group;
}
