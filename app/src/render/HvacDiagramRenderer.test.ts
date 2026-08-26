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
    { id: 'supply', status: 'inferred', system: 'supply_air', position: { x: 4, y: 2.65, z: 2 }, mount_face: 'south', reason: '风量待定' },
    { id: 'return', status: 'confirmed', system: 'return_air', position: { x: 3, y: 2.5, z: 2 }, reason: '回风底装' },
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

  it('renders terminals as light grilles oriented by mount_face with status outline', () => {
    const { scene } = renderer();
    const supply = byId(scene, 'hvac:A2:terminal:supply')!;
    expect(supply.userData).toMatchObject({ type: 'hvac_terminal', mount_face: 'south', status: 'inferred' });
    expect(supply.rotation.y).toBe(0); // 侧装朝南，法线 +z
    expect(supply.rotation.x).toBe(0);
    // 主体浅色，不再整块半透明橙色
    const bodies: THREE.Mesh[] = [];
    supply.traverse((o) => { if ((o as THREE.Mesh).isMesh) bodies.push(o as THREE.Mesh); });
    expect(bodies.length).toBeGreaterThan(3); // 背板 + 百叶 + 边框
    for (const mesh of bodies) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.transparent).toBe(false);
    }
    // 状态描边存在
    let outline: THREE.LineSegments | undefined;
    supply.traverse((o) => { if ((o as THREE.LineSegments).isLineSegments) outline = o as THREE.LineSegments; });
    expect((outline!.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xf59e0b);

    const bottomReturn = byId(scene, 'hvac:A2:terminal:return')!;
    expect(bottomReturn.userData.mount_face).toBe('bottom'); // 缺省 supply/return 默认底装
    expect(bottomReturn.rotation.x).toBeCloseTo(Math.PI / 2);

    const access = byId(scene, 'hvac:A2:terminal:access')!;
    expect(access.rotation.x).toBeCloseTo(Math.PI / 2); // 检修口底装
  });

  it('honors terminal.length override (e.g. 客厅线形风口)', () => {
    const scene = new THREE.Scene();
    const value = new HvacDiagramRenderer(scene);
    value.render('A2', {
      anchors: [],
      terminals: [
        { id: 'linear_supply', status: 'inferred', system: 'supply_air', position: { x: 10.8, y: 2.49, z: 7 }, mount_face: 'bottom', length: 1.5, reason: '线形风口' },
      ],
      routes: [],
      reference_constraints: [],
    }, { outdoor: [], ceiling: [], electrical: [] });
    const terminal = byId(scene, 'hvac:A2:terminal:linear_supply')!;
    let maxWidth = 0;
    terminal.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const box = (mesh.geometry as THREE.BoxGeometry).parameters;
        if (box?.width) maxWidth = Math.max(maxWidth, box.width);
      }
    });
    expect(maxWidth).toBeCloseTo(1.5, 5);
    value.dispose();
  });

  it('clears old objects on render and disposes its root group', () => {
    const { scene, value } = renderer();
    value.render('A2', { anchors: [], terminals: [], routes: [], reference_constraints: [] }, { outdoor: [], ceiling: [], electrical: [] });
    expect(byId(scene, 'hvac:A2:anchor:indoor')).toBeUndefined();
    value.dispose();
    expect(scene.children).not.toContain(value.group);
  });
});
