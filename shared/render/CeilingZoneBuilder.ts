import * as THREE from 'three';
import { scaleBoxUvToMeters, scalePlaneUvToMeters } from './uv-utils.js';

export interface CeilingZoneSpec {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  /** Optional plan rounding radius for a soft drop-box footprint, in metres. */
  corner_radius?: number;
  /** Optional inspection layer applied to every generated part of this zone. */
  inspection_layer?: string;
  /** Material opacity while the declared inspection layer is active. */
  inspection_opacity?: number;
  note?: string;
}

const SLAB_EPS = 0.002;
const SKIRT_THICKNESS = 0.02;
const SKIRT_INSET = SKIRT_THICKNESS / 2;
const COLOR_DROP = '#f5f5f5';
const COLOR_BUCKLE = '#eceff1';

const SOLID_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);

function roundedRectangleShape(width: number, depth: number, radius: number): THREE.Shape {
  const halfW = width / 2;
  const halfD = depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW + radius, -halfD);
  shape.lineTo(halfW - radius, -halfD);
  shape.quadraticCurveTo(halfW, -halfD, halfW, -halfD + radius);
  shape.lineTo(halfW, halfD - radius);
  shape.quadraticCurveTo(halfW, halfD, halfW - radius, halfD);
  shape.lineTo(-halfW + radius, halfD);
  shape.quadraticCurveTo(-halfW, halfD, -halfW, halfD - radius);
  shape.lineTo(-halfW, -halfD + radius);
  shape.quadraticCurveTo(-halfW, -halfD, -halfW + radius, -halfD);
  shape.closePath();
  return shape;
}

function roundedPerimeterShape(width: number, depth: number, radius: number, wallThickness: number): THREE.Shape {
  const outer = roundedRectangleShape(width, depth, radius);
  const innerWidth = Math.max(0.001, width - wallThickness * 2);
  const innerDepth = Math.max(0.001, depth - wallThickness * 2);
  const innerRadius = Math.max(0.001, Math.min(radius - wallThickness, innerWidth / 2, innerDepth / 2));
  outer.holes.push(roundedRectangleShape(innerWidth, innerDepth, innerRadius));
  return outer;
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
  const radius = zone.corner_radius ?? 0;
  if (radius < 0 || radius > Math.min(w, d) / 2) return null;

  const slabMat = new THREE.MeshStandardMaterial({
    color: isBuckle ? COLOR_BUCKLE : COLOR_DROP,
    roughness: isBuckle ? 0.6 : 0.9,
    metalness: isBuckle ? 0.3 : 0.02,
    side: THREE.DoubleSide,
  });
  let slabGeo: THREE.BufferGeometry;
  let perimeter: THREE.Mesh | undefined;
  if (radius > 0) {
    slabGeo = new THREE.ShapeGeometry(roundedRectangleShape(w, d, radius));
    const perimeterGeo = new THREE.ExtrudeGeometry(roundedPerimeterShape(w, d, radius, SKIRT_THICKNESS), { depth: zone.thickness, bevelEnabled: false, steps: 1 });
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
    ...(radius > 0 ? { ceilingPersistent: true } : {}),
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
  const skirts = radius > 0 ? [] : [
      mkSkirt(w, cx, z1 + SKIRT_INSET, 0),
      mkSkirt(w, cx, z2 - SKIRT_INSET, 0),
      mkSkirt(d, x1 + SKIRT_INSET, cz, Math.PI / 2),
      mkSkirt(d, x2 - SKIRT_INSET, cz, Math.PI / 2),
    ];

  const group = new THREE.Group();
  group.add(slab, ...(perimeter ? [perimeter] : skirts));
  group.userData = { type: 'ceiling_zone', objectId: zone.id, roomId: zone.room, cornerRadius: radius };
  return group;
}
