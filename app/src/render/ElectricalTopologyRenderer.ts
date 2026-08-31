import * as THREE from 'three';
import type {
  ElectricalPoint,
  ElectricalTopology,
  ElectricalTopologyCircuit,
  ElectricalTopologyStatus,
  ElectricalCircuitPurpose,
} from '@shared/types';

export interface ElectricalTopologyRenderSummary {
  panels: number;
  circuits: number;
  edges: number;
  skippedEdges: number;
}

export type ElectricalTopologyTargetKind = 'electrical_topology_panel' | 'electrical_topology_circuit' | 'electrical_topology_edge';

const PURPOSE_COLORS: Record<ElectricalCircuitPurpose, number> = {
  lighting: 0xfacc15,
  hvac_power: 0x38bdf8,
  dedicated_load: 0xf97316,
  ordinary_power: 0x4ade80,
};

const STATUS_OPACITY: Record<ElectricalTopologyStatus, number> = {
  confirmed: 0.86,
  proposed: 0.58,
  pending: 0.3,
};

function orientSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length <= 0) return;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function pointHeight(point: ElectricalPoint, fallback: number): number {
  return point.type === 'floor_socket' ? 0.08 : point.height ?? point.mount_height ?? fallback;
}

export class ElectricalTopologyRenderer {
  readonly group = new THREE.Group();
  private readonly circuitGroups = new Map<string, THREE.Group>();
  private readonly purposeVisibility = new Map<ElectricalCircuitPurpose, boolean>();
  private summary: ElectricalTopologyRenderSummary = { panels: 0, circuits: 0, edges: 0, skippedEdges: 0 };
  private opacityMultiplier = 1;

  constructor(private readonly viewOnlyRoot: THREE.Object3D) {
    this.group.name = 'ELECTRICAL_TOPOLOGY_LOGIC_VIEW_ONLY';
    viewOnlyRoot.add(this.group);
    (Object.keys(PURPOSE_COLORS) as ElectricalCircuitPurpose[]).forEach((purpose) => this.purposeVisibility.set(purpose, true));
  }

  render(topology: ElectricalTopology, points: ElectricalPoint[]): void {
    this.clear();
    const pointMap = new Map(points.map((point) => [point.id, point]));
    const panels = new Map(topology.panels.map((panel) => [panel.id, panel]));
    const controlsForCircuit = (circuit: ElectricalTopologyCircuit): ElectricalTopology['controls'] => topology.controls.filter((control) => {
      const memberIds = new Set(circuit.member_point_ids);
      return control.switch_point_ids.some((id) => memberIds.has(id))
        || control.target_point_ids.some((id) => memberIds.has(id));
    });
    const controlsForPanel = (panelId: string): ElectricalTopology['controls'] => topology.circuits
      .filter((circuit) => circuit.panel_id === panelId)
      .flatMap(controlsForCircuit)
      .filter((control, index, controls) => controls.findIndex((candidate) => candidate.id === control.id) === index);
    const controlMetadata = (controls: ElectricalTopology['controls']) => ({
      controlIds: controls.map((control) => control.id),
      controlsIncomplete: controls.some((control) => control.target_point_ids.length === 0),
      controlsPending: controls.some((control) => control.status !== 'confirmed'),
    });
    const panelPoints = new Map<string, ElectricalPoint>();
    for (const panel of topology.panels) {
      const point = pointMap.get(panel.source_point_id);
      if (!point) continue;
      panelPoints.set(panel.id, point);
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 12, 8),
        new THREE.MeshBasicMaterial({ color: panel.kind === 'strong' ? 0xef4444 : 0x8b5cf6, transparent: true, opacity: 0.9 }),
      );
      node.position.set(point.x, pointHeight(point, 1.5), point.z);
      node.userData = {
        objectId: `electrical-topology:panel:${panel.id}`,
        type: 'electrical_topology_panel' satisfies ElectricalTopologyTargetKind,
        panelId: panel.id,
        status: panel.status,
        sourcePointId: panel.source_point_id,
        circuitIds: topology.circuits.filter((circuit) => circuit.panel_id === panel.id).map((circuit) => circuit.id),
        ...controlMetadata(controlsForPanel(panel.id)),
        pendingParameters: topology.pending_parameters,
        notForConstruction: true,
        logicalOnly: true,
      };
      this.group.add(node);
      this.summary.panels += 1;
    }

    for (const circuit of topology.circuits) {
      const panel = panels.get(circuit.panel_id);
      const from = panelPoints.get(circuit.panel_id);
      if (!panel || !from) continue;
      const circuitGroup = new THREE.Group();
      circuitGroup.name = `electrical-topology:circuit:${circuit.id}`;
      circuitGroup.userData = this.circuitUserData(circuit, panel.id, topology.pending_parameters, controlsForCircuit(circuit));
      let edgeCount = 0;
      for (const memberId of circuit.member_point_ids) {
        const member = pointMap.get(memberId);
        if (!member) {
          this.summary.skippedEdges += 1;
          continue;
        }
        const start = new THREE.Vector3(from.x, pointHeight(from, 1.5), from.z);
        const end = new THREE.Vector3(member.x, pointHeight(member, 1.25), member.z);
        const length = start.distanceTo(end);
        if (length <= 0) {
          this.summary.skippedEdges += 1;
          continue;
        }
        const material = new THREE.MeshBasicMaterial({
          color: PURPOSE_COLORS[circuit.purpose],
          transparent: true,
          opacity: STATUS_OPACITY[circuit.status] * this.opacityMultiplier,
        });
        const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, length, 6), material);
        edge.userData = {
          objectId: `electrical-topology:edge:${circuit.id}:${memberId}`,
          type: 'electrical_topology_edge' satisfies ElectricalTopologyTargetKind,
          circuitId: circuit.id,
          panelId: panel.id,
          memberPointId: memberId,
          purpose: circuit.purpose,
          status: circuit.status,
          ...controlMetadata(controlsForCircuit(circuit)),
          notForConstruction: true,
          logicalOnly: true,
        };
        orientSegment(edge, start, end);
        circuitGroup.add(edge);
        if (circuit.status !== 'confirmed') {
          const dashed = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([start, end]),
            new THREE.LineDashedMaterial({
              color: PURPOSE_COLORS[circuit.purpose],
              transparent: true,
              opacity: STATUS_OPACITY[circuit.status] * this.opacityMultiplier,
              dashSize: circuit.status === 'pending' ? 0.12 : 0.2,
              gapSize: circuit.status === 'pending' ? 0.12 : 0.14,
              depthTest: false,
            }),
          );
          dashed.computeLineDistances();
          dashed.userData = { ...edge.userData, interactive: false };
          dashed.raycast = () => undefined;
          circuitGroup.add(dashed);
        }
        edgeCount += 1;
        this.summary.edges += 1;
      }
      if (edgeCount > 0) {
        this.group.add(circuitGroup);
        this.circuitGroups.set(circuit.id, circuitGroup);
        this.summary.circuits += 1;
      }
    }
    this.syncVisibility();
  }

  getSummary(): ElectricalTopologyRenderSummary { return { ...this.summary }; }
  getCircuitObject(circuitId: string): THREE.Object3D | undefined { return this.circuitGroups.get(circuitId); }
  setVisible(visible: boolean): void { this.group.visible = visible; }
  setPurposeVisible(purpose: ElectricalCircuitPurpose, visible: boolean): void { this.purposeVisibility.set(purpose, visible); this.syncVisibility(); }
  setOpacityMultiplier(multiplier: number): void {
    this.opacityMultiplier = Math.max(0, Math.min(1, multiplier));
    this.group.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (!item) continue;
        const base = item.userData?.topologyBaseOpacity ?? item.opacity;
        item.userData.topologyBaseOpacity = base;
        item.opacity = base * this.opacityMultiplier;
        item.needsUpdate = true;
      }
    });
  }
  highlightCircuit(circuitId: string, durationMs = 1400): void {
    const circuit = this.circuitGroups.get(circuitId);
    if (!circuit) return;
    const materials: THREE.Material[] = [];
    circuit.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : [material]) if (item) materials.push(item);
    });
    const originals = materials.map((material) => ({ material, color: (material as THREE.MeshBasicMaterial).color?.clone(), opacity: material.opacity }));
    for (const material of materials) {
      (material as THREE.MeshBasicMaterial).color?.set(0xffffff);
      material.opacity = Math.max(material.opacity, 0.9);
      material.needsUpdate = true;
    }
    setTimeout(() => originals.forEach(({ material, color, opacity }) => {
      if (color) (material as THREE.MeshBasicMaterial).color.copy(color);
      material.opacity = opacity;
      material.needsUpdate = true;
    }), durationMs);
  }
  clear(): void {
    while (this.group.children.length) {
      const child = this.group.remove(this.group.children[0]);
      child.traverse((object) => {
        const renderable = object as THREE.Mesh;
        renderable.geometry?.dispose();
        if (Array.isArray(renderable.material)) renderable.material.forEach((item) => item.dispose());
        else (renderable.material as THREE.Material | undefined)?.dispose();
      });
    }
    this.circuitGroups.clear();
    this.summary = { panels: 0, circuits: 0, edges: 0, skippedEdges: 0 };
  }
  dispose(): void { this.clear(); if (this.group.parent) this.group.parent.remove(this.group); }

  private circuitUserData(circuit: ElectricalTopologyCircuit, panelId: string, pendingParameters: string[], controls: ElectricalTopology['controls'] = []): Record<string, unknown> {
    return {
      objectId: `electrical-topology:circuit:${circuit.id}`,
      type: 'electrical_topology_circuit' satisfies ElectricalTopologyTargetKind,
      circuitId: circuit.id,
      panelId,
      purpose: circuit.purpose,
      status: circuit.status,
      memberPointIds: circuit.member_point_ids,
      ...{
        controlIds: controls.map((control) => control.id),
        controlsIncomplete: controls.some((control) => control.target_point_ids.length === 0),
        controlsPending: controls.some((control) => control.status !== 'confirmed'),
      },
      dedicatedLoad: circuit.dedicated_load,
      note: circuit.note,
      pendingParameters,
      notForConstruction: true,
      logicalOnly: true,
    };
  }

  private syncVisibility(): void {
    for (const circuit of this.circuitGroups.values()) circuit.visible = this.purposeVisibility.get(circuit.userData.purpose as ElectricalCircuitPurpose) ?? true;
  }
}

export { PURPOSE_COLORS, STATUS_OPACITY };
