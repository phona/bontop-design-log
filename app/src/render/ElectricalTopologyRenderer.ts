import * as THREE from 'three';
import type {
  ElectricalPoint,
  ElectricalTopology,
  ElectricalTopologyCircuit,
  ElectricalTopologyStatus,
  ElectricalCircuitPurpose,
} from '@shared/types';
import { resolvePointPlacementInWalls, type PointMountHost, type PointWall } from '@shared/point-placement';

export interface ElectricalTopologyRenderSummary {
  panels: number;
  circuits: number;
  edges: number;
  skippedEdges: number;
  /** 源点位解析不出平面坐标而跳过的面板节点数（issue #98 S3）。 */
  skippedPanels: number;
}

/**
 * 点位定位上下文（issue #98 S3）：沿墙/挂载点位不再声明绝对 x/z，回路图节点与成员 marker
 * 的坐标一律走 shared/point-placement.ts 单一解算（与标注层 AnnotationRenderer.planOf、
 * 3D 基础设施、DXF、MEP 同一解算器）。调用方（HouseScene）注入墙段/家具宿主索引；
 * 缺索引而点位又是沿墙/挂载声明时解算失败 → 诊断显形，不静默 continue。
 */
export interface ElectricalTopologyPlacementContext {
  pointWalls?: ReadonlyMap<string, PointWall>;
  mountHosts?: ReadonlyMap<string, PointMountHost>;
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

function pointHeight(point: ElectricalPoint, fallback: number): number {
  return point.type === 'floor_socket' ? 0.08 : point.height ?? point.mount_height ?? fallback;
}

export class ElectricalTopologyRenderer {
  readonly group = new THREE.Group();
  private readonly circuitGroups = new Map<string, THREE.Group>();
  private readonly purposeVisibility = new Map<ElectricalCircuitPurpose, boolean>();
  private summary: ElectricalTopologyRenderSummary = { panels: 0, circuits: 0, edges: 0, skippedEdges: 0, skippedPanels: 0 };
  /** 跳过原因（诊断文本）：静默 continue 是这条路径此前的失效模式，现在每个跳过都带解释。 */
  private diagnostics: string[] = [];
  private opacityMultiplier = 1;

  constructor(private readonly viewOnlyRoot: THREE.Object3D) {
    this.group.name = 'ELECTRICAL_TOPOLOGY_LOGIC_VIEW_ONLY';
    viewOnlyRoot.add(this.group);
    (Object.keys(PURPOSE_COLORS) as ElectricalCircuitPurpose[]).forEach((purpose) => this.purposeVisibility.set(purpose, true));
  }

  render(topology: ElectricalTopology, points: ElectricalPoint[], placement: ElectricalTopologyPlacementContext = {}): void {
    this.clear();
    this.diagnostics = [];
    const pointMap = new Map(points.map((point) => [point.id, point]));
    // 平面坐标单一解算（issue #98 S1/S3）：沿墙点位 = 完成面基点（与 MEP 端点/标注层同源），
    // mount 挂载点位 = 宿主脸解果，绝对点位 = 声明值。解算失败记诊断并跳过——不拿 0/NaN 画节点。
    const planOf = (point: ElectricalPoint): { x: number; z: number } | undefined => {
      const { placement: resolved, diagnostic } = resolvePointPlacementInWalls(point, placement.pointWalls, placement.mountHosts);
      if (resolved) return { x: resolved.x, z: resolved.z };
      this.diagnostics.push(`electrical-topology: ${point.id}: ${diagnostic ?? '解算器未返回位置'}`);
      return undefined;
    };
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
      const panelPlan = planOf(point);
      if (!panelPlan) { this.summary.skippedPanels += 1; continue; }
      node.position.set(panelPlan.x, pointHeight(point, 1.5), panelPlan.z);
      node.userData = {
        objectId: `electrical-topology:panel:${panel.id}`,
        type: 'electrical_topology_panel' satisfies ElectricalTopologyTargetKind,
        panelId: panel.id,
        status: panel.status,
        sourcePointId: panel.source_point_id,
        circuitIds: topology.circuits.filter((circuit) => circuit.panel_id === panel.id).map((circuit) => circuit.id),
        ...controlMetadata(controlsForPanel(panel.id)),
        pendingParameters: topology.pending_parameters,
        representation: 'logical',
        notForConstruction: true,
        logicalOnly: true,
      };
      this.group.add(node);
      this.summary.panels += 1;
    }

    for (const circuit of topology.circuits) {
      const panel = panels.get(circuit.panel_id);
      if (!panel || !panelPoints.has(circuit.panel_id)) continue;
      const circuitGroup = new THREE.Group();
      circuitGroup.name = `electrical-topology:circuit:${circuit.id}`;
      circuitGroup.userData = this.circuitUserData(circuit, panel.id, topology.pending_parameters, controlsForCircuit(circuit));
      let edgeCount = 0;
      for (const memberId of circuit.member_point_ids) {
        const member = pointMap.get(memberId);
        if (!member) {
          this.summary.skippedEdges += 1;
          this.diagnostics.push(`electrical-topology: 回路 ${circuit.id} 的成员 ${memberId} 不在点位清单里（悬空成员引用），未画 marker`);
          continue;
        }
        const material = new THREE.MeshBasicMaterial({
          color: PURPOSE_COLORS[circuit.purpose],
          transparent: true,
          opacity: STATUS_OPACITY[circuit.status] * this.opacityMultiplier,
          depthTest: false,
        });
        const edge = new THREE.Mesh(new THREE.RingGeometry(0.10, 0.14, 16), material);
        edge.name = `electrical-topology:member-marker:${circuit.id}:${memberId}`;
        edge.rotation.x = -Math.PI / 2;
        const memberPlan = planOf(member);
        if (!memberPlan) { this.summary.skippedEdges++; continue; }
        edge.position.set(memberPlan.x, pointHeight(member, 1.25), memberPlan.z);
        edge.userData = {
          objectId: `electrical-topology:edge:${circuit.id}:${memberId}`,
          type: 'electrical_topology_edge' satisfies ElectricalTopologyTargetKind,
          circuitId: circuit.id,
          panelId: panel.id,
          memberPointId: memberId,
          purpose: circuit.purpose,
          status: circuit.status,
          ...controlMetadata(controlsForCircuit(circuit)),
          representation: 'logical_membership_marker',
          relation: 'circuit_membership',
          notForConstruction: true,
          logicalOnly: true,
        };
        circuitGroup.add(edge);
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
  /** 本次 render 的跳过原因（诊断文本）。调用方必须显形——静默降级是这条路径被 review 抓到的失效模式。 */
  getDiagnostics(): readonly string[] { return [...this.diagnostics]; }
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
    this.summary = { panels: 0, circuits: 0, edges: 0, skippedEdges: 0, skippedPanels: 0 };
    this.diagnostics = [];
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
      representation: 'logical',
      notForConstruction: true,
      logicalOnly: true,
    };
  }

  private syncVisibility(): void {
    for (const circuit of this.circuitGroups.values()) circuit.visible = this.purposeVisibility.get(circuit.userData.purpose as ElectricalCircuitPurpose) ?? true;
  }
}

export { PURPOSE_COLORS, STATUS_OPACITY };
