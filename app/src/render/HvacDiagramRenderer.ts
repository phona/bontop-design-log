import * as THREE from 'three';
import type {
  CeilingZone,
  ElectricalPoint,
  HvacAnchor,
  HvacDiagram,
  HvacReferenceConstraint,
  HvacStatus,
  HvacSystem,
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
  private readonly equipmentGroup = new THREE.Group();
  private readonly coordinationGroup = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'HVAC_DIAGRAM';
    this.equipmentGroup.name = 'HVAC_CONFIRMED_ENTITIES';
    this.coordinationGroup.name = 'HVAC_COORDINATION';
    this.group.add(this.equipmentGroup, this.coordinationGroup);
    this.attach();
  }

  /** Reattach the persistent root after a HouseScene rebuild. */
  attach(): void {
    if (this.group.parent !== this.scene) this.scene.add(this.group);
  }

  render(planId: string, diagram: HvacDiagram, sources: HvacDiagramSources): void {
    this.attach();
    this.clear();
    const positions = new Map<string, Vec3>();
    for (const anchor of diagram.anchors) {
      const position = this.resolveAnchor(anchor, sources);
      if (!position) {
        console.warn(`[hvac] skipped unresolved anchor ${anchor.id}`);
        continue;
      }
      positions.set(anchor.id, position);
      if (anchor.ref?.source !== 'electrical') this.addAnchor(planId, anchor, position);
    }
    for (const terminal of diagram.terminals) {
      positions.set(terminal.id, terminal.position);
      this.addTerminal(planId, terminal, terminal.position);
    }
    for (const route of diagram.routes) {
      const routePositions = [route.from, ...(route.via ?? []), route.to]
        .map((id) => positions.get(id));
      if (routePositions.some((point) => !point)) {
        console.warn(`[hvac] skipped unresolved route ${route.id}`);
        continue;
      }
      this.addRoute(planId, route, routePositions as Vec3[]);
    }
    for (const constraint of diagram.reference_constraints) this.addReferenceConstraint(planId, constraint);
  }

  setCoordinationVisible(visible: boolean): void {
    this.coordinationGroup.visible = visible;
  }

  clear(): void {
    for (const group of [this.equipmentGroup, this.coordinationGroup]) {
      while (group.children.length) {
        const child = group.remove(group.children[0]);
        disposeObject(child);
      }
    }
  }

  dispose(): void {
    this.clear();
    this.group.parent?.remove(this.group);
  }

  private resolveAnchor(anchor: HvacAnchor, sources: HvacDiagramSources): Vec3 | undefined {
    if (anchor.position) return anchor.position;
    if (!anchor.ref) return undefined;
    if (anchor.ref.source === 'ceiling') {
      const item = sources.ceiling.find((zone) => zone.id === anchor.ref!.id);
      return item?.x === undefined || item.z === undefined ? undefined : { x: item.x, y: item.height ?? 2.85, z: item.z };
    }
    if (anchor.ref.source === 'electrical') {
      const item = sources.electrical.find((point) => point.id === anchor.ref!.id);
      return item ? { x: item.x, y: item.height ?? 0, z: item.z } : undefined;
    }
    const item = sources.outdoor.find((unit) => unit.id === anchor.ref!.id);
    return item ? { x: item.x, y: item.height / 2, z: item.z } : undefined;
  }

  private addAnchor(planId: string, anchor: HvacAnchor, position: Vec3): void {
    const isOutdoor = anchor.ref?.source === 'outdoor';
    const isIndoor = anchor.ref?.source === 'ceiling';
    const geometry = isOutdoor
      ? new THREE.BoxGeometry(0.9, 0.7, 0.335)
      : isIndoor
        ? new THREE.BoxGeometry(0.8, 0.12, 0.5)
        : new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mesh = new THREE.Mesh(geometry, material(anchor.status));
    mesh.position.set(position.x, position.y, position.z);
    mesh.name = `hvac:${planId}:anchor:${anchor.id}`;
    mesh.userData = {
      type: 'hvac_equipment', objectId: mesh.name, reason: anchor.reason,
      status: anchor.status, system: anchor.system, hvacKind: isOutdoor ? 'outdoor' : isIndoor ? 'indoor' : 'power',
    };
    mesh.castShadow = anchor.status === 'confirmed';
    this.equipmentGroup.add(mesh);
  }

  private addTerminal(planId: string, terminal: { id: string; status: HvacStatus; system: HvacSystem; reason?: string }, position: Vec3): void {
    const access = terminal.system === 'access';
    const geometry = access ? new THREE.BoxGeometry(0.45, 0.025, 0.45) : new THREE.BoxGeometry(0.65, 0.025, 0.16);
    const mesh = new THREE.Mesh(geometry, material(terminal.status));
    mesh.position.set(position.x, position.y, position.z);
    mesh.name = `hvac:${planId}:terminal:${terminal.id}`;
    mesh.userData = { type: 'hvac_terminal', objectId: mesh.name, reason: terminal.reason, status: terminal.status, system: terminal.system };
    this.equipmentGroup.add(mesh);
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
      reason: constraint.reason, source: constraint.source, uncertainty: '±150mm',
      not_for_construction: constraint.not_for_construction, status: constraint.status,
      risk: constraint.risk, surveyConfirmation: constraint.survey_confirmation,
    };
    this.coordinationGroup.add(mesh);
  }

  private addRoute(planId: string, route: { id: string; status: HvacStatus; system: HvacSystem; reason?: string }, positions: Vec3[]): void {
    const group = new THREE.Group();
    group.name = `hvac:${planId}:route:${route.id}`;
    group.userData = { type: 'hvac_diagram', objectId: group.name, reason: route.reason, status: route.status, system: route.system };
    for (let index = 0; index < positions.length - 1; index++) {
      const from = positions[index];
      const to = positions[index + 1];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z),
      ]), route.status === 'confirmed' ? new THREE.LineBasicMaterial({ color: STATUS_COLOR.confirmed, transparent: true, opacity: 0.7 }) : material(route.status, true));
      if (route.status !== 'confirmed') line.computeLineDistances();
      line.userData = { ...group.userData, objectId: `${group.name}:segment:${index}` };
      group.add(line);
    }
    if (route.status === 'pending') {
      for (const [index, point] of [positions[0], positions[positions.length - 1]].entries()) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), material(route.status));
        marker.position.set(point.x, point.y, point.z);
        marker.userData = { ...group.userData, objectId: `${group.name}:termination:${index}` };
        group.add(marker);
      }
    }
    this.coordinationGroup.add(group);
  }
}
