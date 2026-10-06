import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildCeilingZone } from './CeilingZoneBuilder.js';

const dropZone = {
  id: 'ceiling_main_corridor',
  room: 'living_dining',
  type: 'drop',
  thickness: 0.30,
  area: [4.20, 4.30, 7.20, 5.55] as [number, number, number, number],
};

describe('buildCeilingZone', () => {
  it('drop: top slab at ceilingHeight - thickness + 0.002, centered, with 4 skirts', () => {
    const g = buildCeilingZone(dropZone)!;
    expect(g).not.toBeNull();
    const slabs = g.children.filter(
      (c) => (c as THREE.Mesh).userData.part === 'slab',
    ) as THREE.Mesh[];
    expect(slabs).toHaveLength(1);
    expect(slabs[0].position.y).toBeCloseTo(2.502, 5);
    expect(slabs[0].position.x).toBeCloseTo(5.70, 5);
    expect(slabs[0].position.z).toBeCloseTo(4.925, 5);
    const skirts = g.children.filter((c) => c.userData.part === 'skirt');
    expect(skirts).toHaveLength(4);
  });

  it('aluminum_buckle: metalness 0.3', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_kitchen', type: 'aluminum_buckle', thickness: 0.15 })!;
    const slab = g.children.find((c) => c.userData.part === 'slab') as THREE.Mesh;
    expect((slab.material as THREE.MeshStandardMaterial).metalness).toBeCloseTo(0.3);
    expect(slab.position.y).toBeCloseTo(2.652, 5);
  });

  it('rounded drop: uses the declared corner radius and omits square skirts', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_master_ac', area: [2.925, 4.55, 4.20, 5.60], thickness: 0.30, corner_radius: 0.10, inspection_layer: 'pipe-chase', inspection_opacity: 0.18 })!;
    expect(g.userData.cornerRadius).toBeCloseTo(0.10, 5);
    expect(g.children.filter((child) => child.userData.part === 'slab')).toHaveLength(1);
    expect(g.children.filter((child) => child.userData.part === 'rounded-perimeter')).toHaveLength(1);
    expect(g.children.filter((child) => child.userData.part === 'skirt')).toHaveLength(0);
    const slab = g.children.find((child) => child.userData.part === 'slab') as THREE.Mesh;
    expect(slab.position.y).toBeCloseTo(2.502, 5);
    expect(slab.userData.ceilingPersistent).toBe(true);
    expect(g.children.every((child) => child.userData.inspectionLayer === 'pipe-chase' && child.userData.inspectionOpacity === 0.18)).toBe(true);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.min.x).toBeCloseTo(2.925, 5);
    expect(box.max.x).toBeCloseTo(4.20, 5);
    expect(box.min.z).toBeCloseTo(4.55, 5);
    expect(box.max.z).toBeCloseTo(5.60, 5);
  });

  it('corner_radii: only the declared corners are rounded; butt/coplanar corners stay square', () => {
    // area 3.0×3.0 centred on (1.5,1.5) → local half extents ±1.5. The shape is built in
    // local XY and rotated -90° about X, so local (+1.5,-1.5) is the world SE corner and
    // local (-1.5,+1.5) the world NW corner.
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_dining_west_band', area: [0.0, 0.0, 3.0, 3.0], thickness: 0.30, corner_radii: { se: 0.10 } })!;
    expect(g.userData.cornerRadius).toBeUndefined();
    expect(g.userData.cornerRadii).toMatchObject({ nw: 0, ne: 0, se: 0.1, sw: 0 });
    const slab = g.children.find((child) => child.userData.part === 'slab') as THREE.Mesh;
    const outline = new Set<string>();
    const position = slab.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      outline.add(`${position.getX(i).toFixed(4)},${position.getY(i).toFixed(4)}`);
    }
    // rounded SE: the sharp corner vertex is gone, both tangent points exist
    expect(outline.has('1.5000,-1.5000')).toBe(false);
    expect(outline.has('1.4000,-1.5000')).toBe(true);
    expect(outline.has('1.5000,-1.4000')).toBe(true);
    // square NW / NE / SW corners keep their sharp vertex
    expect(outline.has('-1.5000,1.5000')).toBe(true);
    expect(outline.has('1.5000,1.5000')).toBe(true);
    expect(outline.has('-1.5000,-1.5000')).toBe(true);
    expect(g.children.filter((child) => child.userData.part === 'rounded-perimeter')).toHaveLength(1);
    expect(g.children.filter((child) => child.userData.part === 'skirt')).toHaveLength(0);
  });

  it('corner_radii entry overrides corner_radius (0 turns that corner back to square)', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'zone', area: [0.0, 0.0, 3.0, 3.0], thickness: 0.30, corner_radius: 0.10, corner_radii: { nw: 0 } })!;
    expect(g.userData.cornerRadii).toMatchObject({ nw: 0, ne: 0.1, se: 0.1, sw: 0.1 });
    expect(g.userData.cornerRadius).toBeUndefined();
  });

  it('returns null when a declared corner radius exceeds half of the smaller area side', () => {
    expect(buildCeilingZone({ ...dropZone, id: 'zone', area: [0.0, 0.0, 3.0, 0.4], thickness: 0.30, corner_radii: { se: 0.30 } })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, id: 'zone', area: [0.0, 0.0, 3.0, 0.4], thickness: 0.30, corner_radius: 0.30 })).toBeNull();
  });

  it('aluminum_buckle: buckle_panel adds module seams just below the slab face', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_kitchen', type: 'aluminum_buckle', thickness: 0.15, area: [7.20, 0.00, 10.80, 2.40], buckle_panel: { module: 0.30 } })!;
    const seams = g.children.filter((child) => child.userData.part === 'buckle-seam') as THREE.Mesh[];
    // 3.60/0.30 = 12 cells → 11 vertical seams; 2.40/0.30 = 8 cells → 7 horizontal seams
    expect(seams).toHaveLength(18);
    const slab = g.children.find((child) => child.userData.part === 'slab') as THREE.Mesh;
    expect(slab.position.y).toBeCloseTo(2.652, 5);
    for (const seam of seams) {
      // seams sit 1.5–3.5 mm below the slab face (visible from below, no z-fighting)
      expect(seam.position.y + 0.001).toBeLessThan(slab.position.y - 0.001);
      expect(seam.position.y - 0.001).toBeGreaterThan(slab.position.y - 0.004);
    }
    const vertical = seams.filter((seam) => {
      const geometry = seam.geometry as THREE.BoxGeometry;
      return geometry.parameters.width < geometry.parameters.depth;
    });
    const horizontal = seams.filter((seam) => {
      const geometry = seam.geometry as THREE.BoxGeometry;
      return geometry.parameters.depth < geometry.parameters.width;
    });
    expect(vertical).toHaveLength(11);
    expect(horizontal).toHaveLength(7);
    expect(vertical[0].position.x).toBeCloseTo(7.50, 5);
    expect(horizontal[0].position.z).toBeCloseTo(0.30, 5);
  });

  /** World-space outline points of a zone's slab (slab is rotated -90° about X). */
  const outlineOf = (g: THREE.Group): Set<string> => {
    g.updateMatrixWorld(true);
    const slab = g.children.find((child) => child.userData.part === 'slab') as THREE.Mesh;
    const position = slab.geometry.getAttribute('position');
    const points = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      points.add(`${(position.getX(i) + slab.position.x).toFixed(3)},${(slab.position.z - position.getY(i)).toFixed(3)}`);
    }
    return points;
  };

  it('concave_fillets: adds material past the reentrant corner and keeps convex rounds', () => {
    // 餐厅西带：NW 阳角 R150 + SE 阴角 R150（西带东 bulkhead 折向设备带北立面）
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_dining_west_band', area: [7.20, 2.40, 7.70, 4.30], thickness: 0.30, corner_radii: { nw: 0.15 }, concave_fillets: { se: 0.15 } })!;
    expect(g.userData.concaveRadii).toMatchObject({ se: 0.15 });
    expect(g.userData.cornerRadii).toMatchObject({ nw: 0.15 });
    const outline = outlineOf(g);
    // NW convex round: the sharp corner vertex is gone
    expect(outline.has('7.200,2.400')).toBe(false);
    // NE / SW stay square
    expect(outline.has('7.700,2.400')).toBe(true);
    expect(outline.has('7.200,4.300')).toBe(true);
    // SE concave fillet: tangent points lie R past the corner on both edges
    expect(outline.has('7.850,4.300')).toBe(true);
    expect(outline.has('7.700,4.150')).toBe(true);
    // and the arc bulges back toward the corner (samples between the tangent points)
    const arc = [...outline].filter((point) => point.startsWith('7.7') || point.startsWith('7.8')).filter((point) => !['7.700,2.400', '7.700,4.150', '7.850,4.300'].includes(point));
    expect(arc.length).toBeGreaterThan(4);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.x).toBeCloseTo(7.85, 5);
    expect(box.max.z).toBeCloseTo(4.30, 5);
    expect(g.children.filter((child) => child.userData.part === 'rounded-perimeter')).toHaveLength(1);
    expect(g.children.filter((child) => child.userData.part === 'skirt')).toHaveLength(0);
  });

  it('concave_fillets: north band elbow SW + convex SE stay orthogonal elsewhere', () => {
    const g = buildCeilingZone({ ...dropZone, id: 'ceiling_dining_north_band', area: [7.70, 2.40, 10.80, 3.00], thickness: 0.30, corner_radii: { se: 0.15 }, concave_fillets: { sw: 0.15 } })!;
    const outline = outlineOf(g);
    expect(outline.has('7.700,2.400')).toBe(true);   // NW square
    expect(outline.has('10.800,2.400')).toBe(true);  // NE square
    expect(outline.has('10.800,3.000')).toBe(false); // SE convex round
    expect(outline.has('7.700,3.150')).toBe(true);   // SW fillet tangent on the west edge
    expect(outline.has('7.850,3.000')).toBe(true);   // SW fillet tangent on the south edge
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.max.z).toBeCloseTo(3.15, 5);
  });

  it('concave_fillets: rejects oversized, edge-budget-breaking and double-declared corners', () => {
    const base = { ...dropZone, id: 'zone', area: [7.20, 2.40, 7.70, 4.30] as [number, number, number, number], thickness: 0.30 };
    expect(buildCeilingZone({ ...base, concave_fillets: { se: 0.40 } })).toBeNull();          // > half the smaller side
    expect(buildCeilingZone({ ...base, corner_radii: { se: 0.10 }, concave_fillets: { se: 0.15 } })).toBeNull(); // same corner twice
    // 两条带共边（南边 0.5m）各 0.3 → 超出边长
    expect(buildCeilingZone({ ...base, concave_fillets: { sw: 0.3, se: 0.3 } })).toBeNull();
    expect(buildCeilingZone({ ...base, concave_fillets: { se: -0.1 } })).toBeNull();
  });

  it('aluminum_buckle: seams only with buckle_panel on a square footprint', () => {
    const noPanel = buildCeilingZone({ ...dropZone, id: 'ceiling_kitchen', type: 'aluminum_buckle', thickness: 0.15, area: [7.20, 0.00, 10.80, 2.40] })!;
    expect(noPanel.children.filter((child) => child.userData.part === 'buckle-seam')).toHaveLength(0);
    const rounded = buildCeilingZone({ ...dropZone, id: 'zone', type: 'aluminum_buckle', thickness: 0.15, area: [7.20, 0.00, 10.80, 2.40], corner_radius: 0.10, buckle_panel: { module: 0.30 } })!;
    expect(rounded.children.filter((child) => child.userData.part === 'buckle-seam')).toHaveLength(0);
    const badModule = buildCeilingZone({ ...dropZone, id: 'zone', type: 'aluminum_buckle', thickness: 0.15, area: [7.20, 0.00, 10.80, 2.40], buckle_panel: { module: 0.01 } })!;
    expect(badModule.children.filter((child) => child.userData.part === 'buckle-seam')).toHaveLength(0);
  });

  it('userData on group carries ceiling_zone identity', () => {
    const g = buildCeilingZone(dropZone)!;
    expect(g.userData).toMatchObject({
      type: 'ceiling_zone',
      objectId: 'ceiling_main_corridor',
      roomId: 'living_dining',
    });
  });

  it('returns null for ac_indoor / none / missing area / missing thickness', () => {
    expect(buildCeilingZone({ ...dropZone, type: 'ac_indoor' })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, type: 'none' })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, area: undefined })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, thickness: undefined })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, type: 'future_unknown' })).toBeNull();
  });

  it('slab UV 标定为米制（w×d），将来贴铝扣板纹理不返工', () => {
    const g = buildCeilingZone(dropZone)!;
    const slab = g.children.find((c) => c.userData.part === 'slab') as THREE.Mesh;
    const uv = slab.geometry.getAttribute('uv');
    let maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU).toBeCloseTo(3.0, 5); // w = 7.20 - 4.20
    expect(maxV).toBeCloseTo(1.25, 5); // d = 5.55 - 4.30
  });

  it('skirt UV 标定为米制（len×skirtH）', () => {
    const g = buildCeilingZone(dropZone)!;
    const skirts = g.children.filter((c) => c.userData.part === 'skirt') as THREE.Mesh[];
    const longSkirt = skirts.find((s) => Math.abs(s.rotation.y) < 0.01)!;
    const uv = longSkirt.geometry.getAttribute('uv');
    let maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU).toBeCloseTo(3.0, 5); // len = w
    expect(maxV).toBeCloseTo(0.3, 5); // skirtH = thickness
  });

  it('skirts are inset inside the footprint to avoid z-fighting at shared edges', () => {
    const g = buildCeilingZone(dropZone)!;
    const skirts = g.children.filter(
      (c) => c.userData.part === 'skirt',
    ) as THREE.Mesh[];
    expect(skirts).toHaveLength(4);
    const zSkirts = skirts.filter((s) => Math.abs(s.rotation.y) < 1e-9);
    const xSkirts = skirts.filter((s) => Math.abs(s.rotation.y) > 1e-9);
    expect(zSkirts.map((s) => s.position.z).sort((a, b) => a - b)).toEqual([
      expect.closeTo(4.31, 6),
      expect.closeTo(5.54, 6),
    ]);
    expect(xSkirts.map((s) => s.position.x).sort((a, b) => a - b)).toEqual([
      expect.closeTo(4.21, 6),
      expect.closeTo(7.19, 6),
    ]);
  });

  it('returns null when thickness <= 0', () => {
    expect(buildCeilingZone({ ...dropZone, thickness: 0 })).toBeNull();
    expect(buildCeilingZone({ ...dropZone, thickness: -0.1 })).toBeNull();
  });
});
