import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ElectricalTopologyRenderer } from './ElectricalTopologyRenderer.js';
import type { ElectricalPoint, ElectricalTopology } from '@shared/types';

const points: ElectricalPoint[] = [
  { id: 'panel', room: 'entry', type: 'strong_panel', x: 0, z: 0, height: 1.5 },
  { id: 'light', room: 'living', type: 'ceiling_light', x: 2, z: 1, height: 2.6 },
  { id: 'ac', room: 'living', type: 'socket', x: 3, z: 1, height: 0.4 },
];

const topology: ElectricalTopology = {
  version: '1',
  panels: [{ id: 'strong', kind: 'strong', status: 'confirmed', source_point_id: 'panel' }],
  circuits: [
    { id: 'lighting', panel_id: 'strong', purpose: 'lighting', status: 'confirmed', member_point_ids: ['light'] },
    { id: 'hvac', panel_id: 'strong', purpose: 'hvac_power', status: 'pending', member_point_ids: ['ac'] },
    { id: 'ordinary', panel_id: 'strong', purpose: 'ordinary_power', status: 'proposed', member_point_ids: ['ac'] },
  ],
  controls: [{ id: 'light_control', kind: 'switch', status: 'pending', switch_point_ids: ['light'], target_point_ids: [], note: '待交底' }],
  pending_parameters: ['capacity pending'],
};

describe('ElectricalTopologyRenderer', () => {
  it('renders member markers at real point coordinates with logical metadata', () => {
    const viewOnly = new THREE.Group();
    const renderer = new ElectricalTopologyRenderer(viewOnly);
    renderer.render(topology, points);

    expect(viewOnly.children).toContain(renderer.group);
    expect(renderer.getSummary()).toEqual({ panels: 1, circuits: 3, edges: 3, skippedEdges: 0 });
    expect(renderer.group.name).toBe('ELECTRICAL_TOPOLOGY_LOGIC_VIEW_ONLY');
    expect(renderer.group.children[0].userData).toMatchObject({ representation: 'logical', logicalOnly: true, notForConstruction: true });
    expect(renderer.getCircuitObject('lighting')?.userData).toMatchObject({
      type: 'electrical_topology_circuit', purpose: 'lighting', representation: 'logical', notForConstruction: true,
      controlIds: ['light_control'], controlsIncomplete: true, controlsPending: true,
    });
    const marker = renderer.getCircuitObject('hvac')?.children.find((child) => child.userData.type === 'electrical_topology_edge') as THREE.Mesh;
    expect(marker.userData).toMatchObject({ circuitId: 'hvac', memberPointId: 'ac', status: 'pending', logicalOnly: true, notForConstruction: true, representation: 'logical_membership_marker', relation: 'circuit_membership' });
    expect(marker.position.toArray()).toEqual([3, 0.4, 1]);
    expect(marker.geometry).toBeInstanceOf(THREE.RingGeometry);
    expect(renderer.group.children.flatMap((child) => child.children).some((child) => (child as THREE.Mesh).geometry instanceof THREE.CylinderGeometry)).toBe(false);
    expect(renderer.group.children.flatMap((child) => child.children).every((child) => !('route' in child.userData) && !('path' in child.userData))).toBe(true);
    renderer.setPurposeVisible('hvac_power', false);
    expect(renderer.getCircuitObject('hvac')?.visible).toBe(false);
    expect(renderer.getCircuitObject('ordinary')?.userData).toMatchObject({ purpose: 'ordinary_power', status: 'proposed', representation: 'logical', logicalOnly: true, notForConstruction: true });
    renderer.setPurposeVisible('ordinary_power', false);
    expect(renderer.getCircuitObject('ordinary')?.visible).toBe(false);
    renderer.dispose();
  });

  it('skips unknown members without inventing coordinates', () => {
    const renderer = new ElectricalTopologyRenderer(new THREE.Group());
    renderer.render({ ...topology, circuits: [{ ...topology.circuits[0], member_point_ids: ['missing'] }] }, points);
    expect(renderer.getSummary()).toEqual({ panels: 1, circuits: 0, edges: 0, skippedEdges: 1 });
    renderer.dispose();
  });
});
