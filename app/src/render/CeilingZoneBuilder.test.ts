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
});
