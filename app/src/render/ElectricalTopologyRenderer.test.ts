import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ElectricalTopologyRenderer } from './ElectricalTopologyRenderer.js';
import type { ElectricalPoint, ElectricalTopology } from '@shared/types';

const points: ElectricalPoint[] = [
  { id: 'panel', room: 'entry', type: 'strong_panel', x: 0, z: 0, height: 1.5 },
  { id: 'light', room: 'living', type: 'ceiling_light', x: 2, z: 1, height: 2.6 },
  { id: 'ac', room: 'living', type: 'socket', x: 3, z: 1, height: 0.4 },
];

/** 合成宿主墙（x=4 南北向，centerline）：沿墙点位不再声明 x/z，坐标由解算器出。 */
const pointWalls = new Map([['w_test', { segments: [{ x1: 4, z1: 0, x2: 4, z2: 10 }], line_datum: 'centerline' as const }]]);

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
    expect(renderer.getSummary()).toEqual({ panels: 1, circuits: 3, edges: 3, skippedEdges: 0, skippedPanels: 0 });
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
    expect(renderer.getSummary()).toEqual({ panels: 1, circuits: 0, edges: 0, skippedEdges: 1, skippedPanels: 0 });
    renderer.dispose();
  });

  // issue #98 S3：沿墙/挂载点位删 x/z 后，回路图若继续直读声明坐标会把 45/74 个成员 marker
  // 和两块面板节点静默跳没（S3 回归：panels 2→0 / circuits 20→14 / edges 74→29）。
  // 现在坐标走 shared/point-placement.ts 单一解算（与标注层/3D/DXF/MEP 同源）。
  it('resolves wall-mounted members through the single point-placement solver (S3)', () => {
    const wallPoints: ElectricalPoint[] = [
      { id: 'panel', room: 'entry', type: 'strong_panel', wall: 'w_test', wallSide: 'west', along: 1, height: 1.5 },
      { id: 'sock_wall', room: 'living', type: 'socket', wall: 'w_test', wallSide: 'west', along: 2, height: 0.3 },
    ];
    // 三条回路的成员全部改指沿墙点位（原 fixture 成员是绝对坐标的 light/ac）
    const wallTopology: ElectricalTopology = {
      ...topology,
      circuits: topology.circuits.map((circuit) => ({ ...circuit, member_point_ids: ['sock_wall'] })),
    };
    const renderer = new ElectricalTopologyRenderer(new THREE.Group());
    renderer.render(wallTopology, wallPoints, { pointWalls });
    // 面板源点位 + 沿墙成员都解出来了：完成面 = 墙线 x=4 − 半墙厚 0.06 = 3.94
    expect(renderer.getSummary()).toEqual({ panels: 1, circuits: 3, edges: 3, skippedEdges: 0, skippedPanels: 0 });
    expect(renderer.getDiagnostics()).toEqual([]);
    const marker = renderer.getCircuitObject('hvac')?.children.find((child) => child.userData.type === 'electrical_topology_edge') as THREE.Mesh;
    expect(marker.position.toArray()).toEqual([3.94, 0.3, 2]);
    renderer.dispose();
  });

  it('surfaces a diagnostic instead of silently dropping an unresolvable member (S3)', () => {
    const broken: ElectricalPoint[] = [
      { id: 'panel', room: 'entry', type: 'strong_panel', x: 0, z: 0, height: 1.5 },
      // 沿墙声明但调用方没给墙索引 → 解算失败：必须记诊断，不许静默 continue
      { id: 'sock_orphan', room: 'living', type: 'socket', wall: 'w_missing', wallSide: 'west', along: 1, height: 0.3 },
    ];
    const orphanTopology: ElectricalTopology = {
      ...topology,
      circuits: topology.circuits.map((circuit) => ({ ...circuit, member_point_ids: ['sock_orphan'] })),
    };
    const renderer = new ElectricalTopologyRenderer(new THREE.Group());
    renderer.render(orphanTopology, broken);
    const summary = renderer.getSummary();
    expect(summary.skippedEdges).toBe(3);
    expect(renderer.getDiagnostics().length).toBe(3);
    expect(renderer.getDiagnostics()[0]).toMatch(/sock_orphan: .*w_missing/);
    renderer.dispose();
  });
});
