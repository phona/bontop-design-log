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
