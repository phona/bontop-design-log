import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HvacDiagramRenderer } from './HvacDiagramRenderer.js';
import type { HvacDiagram } from '@shared/types';

const diagram: HvacDiagram = {
  anchors: [
    { id: 'outdoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'outdoor', id: 'outdoor_a2' } },
    { id: 'indoor', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_living' } },
    { id: 'power', status: 'confirmed', system: 'power', ref: { source: 'electrical', id: 'sock_living_ac' } },
    { id: 'bend', status: 'inferred', system: 'refrigerant', position: { x: 3, y: 2.5, z: 2 }, reason: '现场复核' },
  ],
  terminals: [
    { id: 'supply', status: 'inferred', system: 'supply_air', position: { x: 4, y: 2.5, z: 2 }, reason: '风量待定' },
    { id: 'access', status: 'pending', system: 'access', position: { x: 2, y: 2.5, z: 3 }, reason: '检修待定' },
    { id: 'condensate_candidate', kind: 'condensate_drain_candidate', status: 'pending', confirmed: false, render_interior: false, render_coordination: true, system: 'condensate', position: { x: 4, y: 0.1, z: 2 }, reason: '候选接入点待确认' },
  ],
  routes: [
    { id: 'trunk', status: 'inferred', system: 'refrigerant', from: 'outdoor', via: ['bend'], to: 'indoor', constraint_refs: ['south_band'], reason: '走向待定' },
    { id: 'access_route', status: 'pending', system: 'access', from: 'indoor', to: 'access', reason: '检修待定' },
    { id: 'condensate_candidate_route', status: 'pending', system: 'condensate', from: 'indoor', to: 'condensate_candidate', reason: '候选路线待确认' },
    { id: 'power', status: 'confirmed', system: 'power', from: 'power', to: 'indoor' },
  ],
  reference_constraints: [{
    id: 'south_band', status: 'inferred', source: 'survey/neighbor_ys01_original_structure_2025-06.png', uncertainty_m: 0.15, not_for_construction: true,
    range: { x1: 1, x2: 3, z1: 4, z2: 4.3 }, reference_bottom_drop_m: 0.1, reference_beam_bottom_y: 2.73,
    risk: '净空待确认', reason: '邻户参考', survey_confirmation: '量房复核自家梁底',
  }],
};

function renderer() {
  const scene = new THREE.Scene();
  const value = new HvacDiagramRenderer(scene);
  value.render('A2', diagram, {
    outdoor: [{ id: 'outdoor_a2', platform: 'west', x: 1, z: 2, direction: 'south', width: 0.9, depth: 0.335, height: 0.7, model: '6HP' }],
    ceiling: [{ id: 'ac_living', room: 'living', type: 'ac_indoor', x: 10.3, z: 7, height: 2.85 }],
    electrical: [{ id: 'sock_living_ac', room: 'living', type: 'socket', x: 10, z: 7, height: 2.5 }],
  });
  return { scene, value };
}

function byId(scene: THREE.Scene, objectId: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  scene.traverse((object) => { if (object.userData.objectId === objectId) found = object; });
  return found;
}

describe('HvacDiagramRenderer', () => {
  it('uses referenced facts coordinates and renders the indoor unit as a thin ceiling element', () => {
    const { scene } = renderer();
    const indoor = byId(scene, 'hvac:A2:anchor:indoor') as THREE.Mesh;
    const outdoor = byId(scene, 'hvac:A2:anchor:outdoor') as THREE.Mesh;
    expect(indoor.position.toArray()).toEqual([10.3, 2.85, 7]);
    expect((indoor.geometry as THREE.BoxGeometry).parameters.height).toBe(0.12);
    expect(outdoor.position.toArray()).toEqual([1, 0.35, 2]);
    expect(indoor.userData.type).toBe('hvac_equipment');
    expect(byId(scene, 'hvac:A2:anchor:power')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:power:segment:0')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:trunk:segment:0')).toBeUndefined();
  });

  it('creates stable equipment, condensate candidate and reference constraint objects without routes', () => {
    const { scene } = renderer();
    expect(byId(scene, 'hvac:A2:terminal:supply')?.userData.reason).toBe('风量待定');
    expect(byId(scene, 'hvac:A2:terminal:supply')?.parent?.name).toBe('HVAC_CONFIRMED_ENTITIES');
    expect(byId(scene, 'hvac:A2:terminal:condensate_candidate')?.userData.type).toBe('hvac_condensate_candidate');
    expect(byId(scene, 'hvac:A2:terminal:condensate_candidate')?.userData.notForConstruction).toBe(true);
    expect(byId(scene, 'hvac:A2:terminal:condensate_candidate')?.parent?.name).toBe('HVAC_COORDINATION');
    expect(byId(scene, 'hvac:A2:route:condensate_candidate_route:segment:0')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:trunk:segment:0')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:trunk:segment:1')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:access_route:termination:0')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:access_route:termination:1')).toBeUndefined();
    const reference = byId(scene, 'hvac:A2:reference:south_band') as THREE.Mesh;
    expect(reference.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(reference.userData).toMatchObject({ type: 'hvac_reference_constraint', source: 'survey/neighbor_ys01_original_structure_2025-06.png', uncertainty: '±150mm', not_for_construction: true, reason: '邻户参考' });
  });

  it('hides HVAC coordination constraints and candidates without affecting equipment', () => {
    const { scene, value } = renderer();
    expect(byId(scene, 'hvac:A2:route:trunk:segment:0')).toBeUndefined();
    expect(byId(scene, 'hvac:A2:route:access_route:segment:0')).toBeUndefined();
    value.setCoordinationVisible(false);
    expect(value.group.getObjectByName('HVAC_COORDINATION')?.visible).toBe(false);
    expect(byId(scene, 'hvac:A2:reference:south_band')?.parent?.visible).toBe(false);
    expect(byId(scene, 'hvac:A2:anchor:indoor')?.visible).toBe(true);
    expect(byId(scene, 'hvac:A2:terminal:condensate_candidate')?.parent?.visible).toBe(false);
    value.setCoordinationVisible(true);
    expect(byId(scene, 'hvac:A2:reference:south_band')?.parent?.visible).toBe(true);
    expect(byId(scene, 'hvac:A2:terminal:condensate_candidate')?.parent?.visible).toBe(true);
  });

  it('clears old objects on render and disposes its root group', () => {
    const { scene, value } = renderer();
    value.render('A2', { anchors: [], terminals: [], routes: [], reference_constraints: [] }, { outdoor: [], ceiling: [], electrical: [] });
    expect(byId(scene, 'hvac:A2:anchor:indoor')).toBeUndefined();
    value.dispose();
    expect(scene.children).not.toContain(value.group);
  });
});
