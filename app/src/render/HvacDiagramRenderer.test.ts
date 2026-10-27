import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HvacDiagramRenderer } from './HvacDiagramRenderer.js';
import type { HvacDiagram } from '@shared/types';

const diagram: HvacDiagram = {
  anchors: [
    { id: 'outdoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor_a2' } },
    { id: 'indoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_living' } },
  ],
  terminals: [
    { id: 'supply', status: 'inferred', system: 'supply_air', position: { x: 4, y: 2.65, z: 2 }, mount_face: 'south', reason: '风量待定' },
    { id: 'condensate_candidate', kind: 'condensate_drain_candidate', status: 'pending', confirmed: false, render_interior: false, render_coordination: true, system: 'condensate', position: { x: 4, y: 0.1, z: 2 }, reason: '候选接入点待确认' },
  ],
  routes: [],
  reference_constraints: [{
    id: 'south_band', status: 'inferred', source: 'survey/neighbor_ys01_original_structure_2025-06.png', uncertainty_m: 0.15, not_for_construction: true,
    range: { x1: 1, x2: 3, z1: 4, z2: 4.3 }, reference_beam_bottom_y: 2.73,
    risk: '净空待确认', reason: '邻户参考', survey_confirmation: '量房复核自家梁底',
  }],
};

function renderer() {
  const scene = new THREE.Scene();
  const value = new HvacDiagramRenderer(scene);
  value.render('A2', diagram, { outdoor: [], ceiling: [], electrical: [] });
  return { scene, value };
}

function byId(scene: THREE.Scene, objectId: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  scene.traverse((object) => { if (object.userData.objectId === objectId) found = object; });
  return found;
}

describe('HvacDiagramRenderer', () => {
  it('does not create confirmed export equipment or terminals', () => {
    const { scene } = renderer();
    expect(byId(scene, 'hvac:A2:anchor:indoor')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:anchor:outdoor')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:terminal:supply')).toBeUndefined();
    expect(scene.getObjectByName('HVAC_CONFIRMED_ENTITIES')).toBeUndefined();
  });

  it('creates only coordination candidate and reference objects under the view-only root', () => {
    const { scene, value } = renderer();
    const candidate = byId(scene, 'hvac:A2:terminal:condensate_candidate');
    const reference = byId(scene, 'hvac:A2:reference:south_band');
    expect(candidate?.userData).toMatchObject({ type: 'hvac_condensate_candidate', notForConstruction: true });
    expect(candidate?.parent?.name).toBe('HVAC_COORDINATION');
    expect(reference?.userData).toMatchObject({ type: 'hvac_reference_constraint', source: 'survey/neighbor_ys01_original_structure_2025-06.png', uncertainty: '±150mm' });
    expect(reference?.parent?.name).toBe('HVAC_COORDINATION');
    expect(value.group.parent).toBe(scene);
  });

  it('hides and shows coordination without affecting export ownership', () => {
    const { scene, value } = renderer();
    value.setCoordinationVisible(false);
    expect(value.group.getObjectByName('HVAC_COORDINATION')?.visible).toBe(false);
    expect(byId(scene, 'hvac:A2:reference:south_band')?.parent?.visible).toBe(false);
    value.setCoordinationVisible(true);
    expect(byId(scene, 'hvac:A2:reference:south_band')?.parent?.visible).toBe(true);
  });

  it('builds provisional indoor-unit envelopes from ac_indoor sources only', () => {
    // DEC-2026-10-27-R03：包络 0.90×0.25×0.50、腔内中心 y=2.65、inferred、服务侧恒 pending；非 ac_indoor 与无坐标项不出包络。
    const scene = new THREE.Scene();
    const value = new HvacDiagramRenderer(scene);
    value.render('A2', diagram, {
      outdoor: [], electrical: [],
      ceiling: [
        { id: 'ac_parent', room: 'study', type: 'ac_indoor', x: 5.5, z: 6.0, height: 2.85 },
        { id: 'drop_1', room: 'study', type: 'drop' },
        { id: 'ac_no_pos', room: 'study', type: 'ac_indoor' },
      ],
    });
    const envelope = byId(scene, 'hvac:A2:unit:ac_parent');
    expect(envelope?.userData).toMatchObject({ type: 'hvac_unit_envelope', unitId: 'ac_parent', status: 'inferred', service_side: 'pending' });
    expect(envelope?.parent?.name).toBe('HVAC_COORDINATION');
    expect(envelope?.position.toArray()).toEqual([5.5, 2.65, 6.0]);
    const box = new THREE.Box3().setFromObject(envelope!);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.9, 5);
    expect(size.y).toBeCloseTo(0.25, 5);
    expect(size.z).toBeCloseTo(0.5, 5);
    expect(byId(scene, 'hvac:A2:unit:drop_1')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:unit:ac_no_pos')).toBeUndefined();
    value.clear();
  });

  it('highlightUnit boosts the served envelope and returns false for unknown units', () => {
    const scene = new THREE.Scene();
    const value = new HvacDiagramRenderer(scene);
    value.render('A2', diagram, {
      outdoor: [], electrical: [],
      ceiling: [{ id: 'ac_parent', room: 'study', type: 'ac_indoor', x: 5.5, z: 6.0, height: 2.85 }],
    });
    expect(value.highlightUnit('ac_missing')).toBe(false);
    expect(value.highlightUnit('ac_parent')).toBe(true);
    const envelope = byId(scene, 'hvac:A2:unit:ac_parent')!;
    let fill: THREE.MeshStandardMaterial | undefined;
    envelope.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) fill = child.material;
    });
    expect(fill!.emissive.getHex()).toBe(0xf59e0b);
    expect(fill!.opacity).toBeCloseTo(0.67, 5);
    value.clear();
  });

  it('clears old coordination objects on render and disposes its root group', () => {
    const { scene, value } = renderer();
    value.render('A2', { anchors: [], terminals: [], routes: [], reference_constraints: [] }, { outdoor: [], ceiling: [], electrical: [] });
    expect(byId(scene, 'hvac:A2:reference:south_band')).toBeUndefined();
    value.dispose();
    expect(scene.children).not.toContain(value.group);
  });
});
