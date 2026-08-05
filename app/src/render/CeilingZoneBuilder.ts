import * as THREE from 'three';

export interface CeilingZoneSpec {
  id: string;
  room: string;
  type: string;
  thickness?: number;
  area?: [number, number, number, number];
  note?: string;
}

const SLAB_EPS = 0.002;
const SKIRT_THICKNESS = 0.02;
const COLOR_DROP = '#f5f5f5';
const COLOR_BUCKLE = '#eceff1';

const SOLID_TYPES = new Set(['drop', 'integrated', 'aluminum_buckle']);

export function buildCeilingZone(zone: CeilingZoneSpec, ceilingHeight = 2.8): THREE.Group | null {
  if (!SOLID_TYPES.has(zone.type)) return null;
  if (!zone.area || zone.thickness === undefined) return null;

  const [x1, z1, x2, z2] = zone.area;
  const w = x2 - x1;
  const d = z2 - z1;
  if (w <= 0 || d <= 0) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const topY = ceilingHeight - zone.thickness + SLAB_EPS;
  const isBuckle = zone.type === 'aluminum_buckle';

  const slabMat = new THREE.MeshStandardMaterial({
    color: isBuckle ? COLOR_BUCKLE : COLOR_DROP,
    roughness: isBuckle ? 0.6 : 0.9,
    metalness: isBuckle ? 0.3 : 0.02,
    side: THREE.DoubleSide,
  });
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, d), slabMat);
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(cx, topY, cz);
  slab.userData = { part: 'slab' };

  const skirtMat = new THREE.MeshStandardMaterial({
    color: COLOR_DROP,
    roughness: 0.9,
    metalness: 0.02,
  });
  const skirtH = zone.thickness;
  const skirtY = ceilingHeight - skirtH / 2;
  const mkSkirt = (len: number, px: number, pz: number, rotY: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, skirtH, SKIRT_THICKNESS), skirtMat);
    m.position.set(px, skirtY, pz);
    m.rotation.y = rotY;
    m.userData = { part: 'skirt' };
    return m;
  };
  const skirts = [
    mkSkirt(w, cx, z1, 0),
    mkSkirt(w, cx, z2, 0),
    mkSkirt(d, x1, cz, Math.PI / 2),
    mkSkirt(d, x2, cz, Math.PI / 2),
  ];

  const group = new THREE.Group();
  group.add(slab, ...skirts);
  group.userData = { type: 'ceiling_zone', objectId: zone.id, roomId: zone.room };
  return group;
}
