import * as THREE from 'three';
import type {
  CeilingZone,
  ElectricalPoint,
  HvacAnchor,
  HvacDiagram,
  HvacReferenceConstraint,
  HvacStatus,
  HvacTerminal,
  Vec3,
  VrfOutdoorUnit,
} from '@shared/types';

export interface HvacDiagramSources {
  ceiling: CeilingZone[];
  electrical: ElectricalPoint[];
  outdoor: VrfOutdoorUnit[];
}

const STATUS_COLOR: Record<HvacStatus, number> = {
  confirmed: 0x38bdf8,
  inferred: 0xf59e0b,
  pending: 0x94a3b8,
};

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function material(status: HvacStatus, dashed = false): THREE.Material {
  const opacity = status === 'pending' ? 0.28 : status === 'inferred' ? 0.52 : 0.78;
  if (dashed) {
    return new THREE.LineDashedMaterial({
      color: STATUS_COLOR[status], transparent: true, opacity,
      dashSize: status === 'pending' ? 0.14 : 0.22, gapSize: 0.12,
    });
  }
  return new THREE.MeshStandardMaterial({ color: STATUS_COLOR[status], transparent: true, opacity, roughness: 0.55 });
}

export class HvacDiagramRenderer {
  readonly group = new THREE.Group();
  private readonly coordinationGroup = new THREE.Group();
  private coordinationParent?: THREE.Object3D;
  private rootsConfigured = false;
  private coordinationOpacity = 1;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'HVAC_DIAGRAM';
    this.coordinationGroup.name = 'HVAC_COORDINATION';
    this.group.add(this.coordinationGroup);
    this.attach();
  }

  /** Reattach persistent HVAC roots after a HouseScene rebuild. */
  attach(exportRoot?: THREE.Object3D, viewOnlyRoot?: THREE.Object3D): void {
    const coordinationParent = viewOnlyRoot ?? this.coordinationParent ?? this.group;
    this.coordinationParent = coordinationParent;
    if (viewOnlyRoot) {
      this.rootsConfigured = true;
      if (this.group.parent === this.scene) this.scene.remove(this.group);
      if (this.coordinationGroup.parent !== coordinationParent) {
        this.coordinationGroup.parent?.remove(this.coordinationGroup);
        coordinationParent.add(this.coordinationGroup);
      }
      return;
    }
    if (this.group.parent !== this.scene) this.scene.add(this.group);
  }

  render(planId: string, diagram: HvacDiagram, _sources: HvacDiagramSources): void {
    if (this.rootsConfigured) this.attach(undefined, this.coordinationParent);
    else this.attach();
    this.clear();
    for (const terminal of diagram.terminals) {
      if (terminal.kind !== 'condensate_drain_candidate') continue;
      this.addCandidate(planId, terminal);
    }
    for (const constraint of diagram.reference_constraints) this.addReferenceConstraint(planId, constraint);
  }

  setCoordinationVisible(visible: boolean): void {
    this.coordinationGroup.visible = visible;
  }

  isCoordinationVisible(): boolean {
    return this.coordinationGroup.visible;
  }

  setCoordinationOpacity(multiplier: number): void {
    this.coordinationOpacity = Math.max(0, Math.min(1, multiplier));
    this.coordinationGroup.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (!item) continue;
        const base = typeof item.userData?.hvacBaseOpacity === 'number' ? item.userData.hvacBaseOpacity : item.opacity;
        item.userData.hvacBaseOpacity = base;
        item.transparent = true;
        item.opacity = base * this.coordinationOpacity;
      }
    });
  }

  getCoordinationOpacity(): number { return this.coordinationOpacity; }

  clear(): void {
    while (this.coordinationGroup.children.length) {
      const child = this.coordinationGroup.remove(this.coordinationGroup.children[0]);
      disposeObject(child);
    }
  }

  dispose(): void {
    this.clear();
    this.group.parent?.remove(this.group);
  }

  private addCandidate(planId: string, terminal: HvacTerminal): void {
    const objectId = `hvac:${planId}:terminal:${terminal.id}`;
    const candidateGroup = new THREE.Group();
    candidateGroup.name = objectId;
    candidateGroup.userData = {
      type: 'hvac_condensate_candidate', objectId, name: terminal.id, reason: terminal.reason,
      status: terminal.status, system: terminal.system, notForConstruction: true,
      position: terminal.position, height: terminal.position.y,
    };
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.55, roughness: 0.65 }));
    marker.position.set(terminal.position.x, terminal.position.y, terminal.position.z);
    marker.userData = { ...candidateGroup.userData, objectId: `${objectId}:marker` };
    candidateGroup.add(marker);
    const guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(terminal.position.x, terminal.position.y, terminal.position.z),
        new THREE.Vector3(terminal.position.x, terminal.position.y + 0.45, terminal.position.z),
      ]),
      new THREE.LineDashedMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.6, dashSize: 0.08, gapSize: 0.06 }),
    );
    guide.computeLineDistances();
    guide.userData = { ...candidateGroup.userData, objectId: `${objectId}:guide` };
    candidateGroup.add(guide);
    this.coordinationGroup.add(candidateGroup);
  }

  private addReferenceConstraint(planId: string, constraint: HvacReferenceConstraint): void {
    const { x1, x2, z1, z2 } = constraint.range;
    const width = x2 - x1;
    const depth = z2 - z1;
    const height = 0.08;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.22, roughness: 0.5 }),
    );
    mesh.position.set((x1 + x2) / 2, constraint.reference_beam_bottom_y ?? 2.65, (z1 + z2) / 2);
    mesh.name = `hvac:${planId}:reference:${constraint.id}`;
    mesh.userData = {
      type: 'hvac_reference_constraint', objectId: mesh.name,
      name: constraint.id, reason: constraint.reason, source: constraint.source, uncertainty: '±150mm',
      not_for_construction: constraint.not_for_construction, status: constraint.status,
      risk: constraint.risk, surveyConfirmation: constraint.survey_confirmation,
      range: constraint.range, reference_beam_bottom_y: constraint.reference_beam_bottom_y,
    };
    this.coordinationGroup.add(mesh);
  }


}
