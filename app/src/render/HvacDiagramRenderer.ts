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
    for (const anchor of diagram.anchors) {
      const position = this.resolveAnchor(anchor, sources);
      if (!position) {
        console.warn(`[hvac] skipped unresolved anchor ${anchor.id}`);
        continue;
      }
      if (anchor.ref?.source !== 'electrical') this.addAnchor(planId, anchor, position);
    }
    for (const terminal of diagram.terminals) this.addTerminal(planId, terminal, terminal.position);
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

  private addTerminal(planId: string, terminal: HvacTerminal, position: Vec3): void {
    const isCandidate = terminal.kind === 'condensate_drain_candidate';
    const objectId = `hvac:${planId}:terminal:${terminal.id}`;
    if (isCandidate) {
      const candidateGroup = new THREE.Group();
      candidateGroup.name = objectId;
      candidateGroup.userData = {
        type: 'hvac_condensate_candidate', objectId, reason: terminal.reason,
        status: terminal.status, system: terminal.system, notForConstruction: true,
      };
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.55, roughness: 0.65 }));
      marker.position.set(position.x, position.y, position.z);
      marker.userData = { ...candidateGroup.userData, objectId: `${objectId}:marker` };
      candidateGroup.add(marker);
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(position.x, position.y, position.z),
          new THREE.Vector3(position.x, position.y + 0.45, position.z),
        ]),
        new THREE.LineDashedMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.6, dashSize: 0.08, gapSize: 0.06 }),
      );
      guide.computeLineDistances();
      guide.userData = { ...candidateGroup.userData, objectId: `${objectId}:guide` };
      candidateGroup.add(guide);
      this.coordinationGroup.add(candidateGroup);
      return;
    }
    const mountFace = terminal.mount_face ?? 'bottom';
    const group = this.buildTerminalGrille(terminal, mountFace);
    group.position.set(position.x, position.y, position.z);
    group.name = objectId;
    group.userData = { type: 'hvac_terminal', objectId, reason: terminal.reason, status: terminal.status, system: terminal.system, mount_face: mountFace };
    this.equipmentGroup.add(group);
  }

  /** 风口真实造型：浅色格栅 + 状态描边。侧装贴边吊立面，底装平贴吊顶底面。 */
  private buildTerminalGrille(terminal: HvacTerminal, mountFace: string): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
    const frame = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.7 });
    const statusLine = new THREE.LineBasicMaterial({ color: STATUS_COLOR[terminal.status] });

    if (terminal.system === 'access') {
      // 检修口：0.45×0.45 带边框方形面板（底装）
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.015), body);
      group.add(panel);
      group.add(this.frameOutline(0.45, 0.42, 0.02, frame));
      group.add(this.statusFrame(0.45, 0.42, statusLine));
    } else {
      // 送风 0.8×0.15，回风 0.6×0.25（侧装/底装同尺寸，仅朝向不同）；length 可覆盖宽度（如客厅线形风口）
      const width = terminal.length ?? (terminal.system === 'return_air' ? 0.6 : 0.8);
      const height = terminal.system === 'return_air' ? 0.25 : 0.15;
      const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.01), body);
      back.position.z = -0.008;
      group.add(back);
      const slatCount = 4;
      const step = height / (slatCount + 1);
      for (let i = 1; i <= slatCount; i++) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.012, 0.03), frame);
        slat.position.set(0, height / 2 - step * i, 0.004);
        slat.rotation.x = 0.45; // 百叶微向下倾
        group.add(slat);
      }
      group.add(this.frameOutline(width, height, 0.02, frame));
      group.add(this.statusFrame(width, height, statusLine));
    }

    // 朝向：格栅局部法线为 +z；侧装按 mount_face 旋转，底装法线朝下
    if (mountFace === 'east') group.rotation.y = Math.PI / 2;
    else if (mountFace === 'west') group.rotation.y = -Math.PI / 2;
    else if (mountFace === 'north') group.rotation.y = Math.PI;
    else if (mountFace === 'bottom') group.rotation.x = Math.PI / 2;
    // south：法线 +z 即朝南，无需旋转
    return group;
  }

  private frameOutline(width: number, height: number, depth: number, material: THREE.Material): THREE.Group {
    const frame = new THREE.Group();
    const t = 0.02;
    const horizontal = new THREE.BoxGeometry(width, t, depth);
    const vertical = new THREE.BoxGeometry(t, height - 2 * t, depth);
    for (const [geo, x, y] of [
      [horizontal, 0, height / 2 - t / 2],
      [horizontal, 0, -height / 2 + t / 2],
      [vertical, width / 2 - t / 2, 0],
      [vertical, -width / 2 + t / 2, 0],
    ] as const) {
      const bar = new THREE.Mesh(geo, material);
      bar.position.set(x, y, 0);
      frame.add(bar);
    }
    return frame;
  }

  private statusFrame(width: number, height: number, material: THREE.Material): THREE.LineSegments {
    const w = width / 2 + 0.005;
    const h = height / 2 + 0.005;
    const corners = [
      new THREE.Vector3(-w, -h, 0.012), new THREE.Vector3(w, -h, 0.012),
      new THREE.Vector3(w, -h, 0.012), new THREE.Vector3(w, h, 0.012),
      new THREE.Vector3(w, h, 0.012), new THREE.Vector3(-w, h, 0.012),
      new THREE.Vector3(-w, h, 0.012), new THREE.Vector3(-w, -h, 0.012),
    ];
    return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners), material);
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


}
