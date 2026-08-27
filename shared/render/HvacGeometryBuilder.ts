import * as THREE from 'three';
import type { HvacAnchor, HvacTerminal, ProjectRenderFactsProjection, Vec3 } from '../types.js';
import { buildHvacEntityDescriptors, type HvacBuilderSources, type HvacEntityDescriptor } from './HvacBuilder.js';

const STATUS_COLOR: Record<HvacAnchor['status'], number> = {
  confirmed: 0x38bdf8,
  inferred: 0xf59e0b,
  pending: 0x94a3b8,
};

export interface HvacEntityIndex {
  equipment: Map<string, THREE.Object3D>;
  terminals: Map<string, THREE.Object3D>;
  all: Map<string, THREE.Object3D>;
}

export interface HvacGeometryBuildResult {
  index: HvacEntityIndex;
  descriptors: HvacEntityDescriptor[];
}

function metadata(object: THREE.Object3D, type: 'hvac_equipment' | 'hvac_terminal', descriptor: HvacEntityDescriptor, extra: Record<string, unknown> = {}): void {
  object.name = descriptor.objectId;
  object.userData = {
    ...object.userData,
    type,
    objectId: descriptor.objectId,
    reason: descriptor.source.reason,
    status: descriptor.status,
    system: descriptor.system,
    ...extra,
  };
}

function buildAnchorGeometry(anchor: HvacAnchor): THREE.Mesh {
  const isOutdoor = anchor.ref?.source === 'outdoor';
  const isIndoor = anchor.ref?.source === 'ceiling';
  const geometry = isOutdoor
    ? new THREE.BoxGeometry(0.9, 0.7, 0.335)
    : isIndoor
      ? new THREE.BoxGeometry(0.8, 0.12, 0.5)
      : new THREE.BoxGeometry(0.12, 0.12, 0.12);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: STATUS_COLOR[anchor.status], roughness: 0.55 }));
  mesh.castShadow = anchor.status === 'confirmed';
  return mesh;
}

function frameOutline(width: number, height: number, depth: number, material: THREE.Material): THREE.Group {
  const frame = new THREE.Group();
  const t = 0.02;
  const horizontal = new THREE.BoxGeometry(width, t, depth);
  const vertical = new THREE.BoxGeometry(t, Math.max(0, height - 2 * t), depth);
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

function statusFrame(width: number, height: number, material: THREE.Material): THREE.LineSegments {
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

function buildTerminalGeometry(terminal: HvacTerminal): THREE.Group {
  const mountFace = terminal.mount_face ?? 'bottom';
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xd4d4d4, roughness: 0.7 });
  const statusLine = new THREE.LineBasicMaterial({ color: STATUS_COLOR[terminal.status] });
  if (terminal.system === 'access') {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.015), body));
    group.add(frameOutline(0.45, 0.42, 0.02, frame));
    group.add(statusFrame(0.45, 0.42, statusLine));
  } else {
    const width = terminal.length ?? (terminal.system === 'return_air' ? 0.6 : 0.8);
    const height = terminal.system === 'return_air' ? 0.25 : 0.15;
    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.01), body);
    back.position.z = -0.008;
    group.add(back);
    const step = height / 5;
    for (let i = 1; i <= 4; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.012, 0.03), frame);
      slat.position.set(0, height / 2 - step * i, 0.004);
      slat.rotation.x = 0.45;
      group.add(slat);
    }
    group.add(frameOutline(width, height, 0.02, frame));
    group.add(statusFrame(width, height, statusLine));
  }
  if (mountFace === 'east') group.rotation.y = Math.PI / 2;
  else if (mountFace === 'west') group.rotation.y = -Math.PI / 2;
  else if (mountFace === 'north') group.rotation.y = Math.PI;
  else if (mountFace === 'bottom') group.rotation.x = Math.PI / 2;
  return group;
}

function addDescriptor(root: THREE.Group, descriptor: HvacEntityDescriptor, index: HvacEntityIndex): void {
  const object = descriptor.kind === 'anchor'
    ? buildAnchorGeometry(descriptor.source as HvacAnchor)
    : buildTerminalGeometry(descriptor.source as HvacTerminal);
  object.position.set(descriptor.position.x, descriptor.position.y, descriptor.position.z);
  const source = descriptor.source as HvacTerminal;
  const anchor = descriptor.source as HvacAnchor;
  metadata(object, descriptor.kind === 'anchor' ? 'hvac_equipment' : 'hvac_terminal', descriptor, descriptor.kind === 'terminal'
    ? { mount_face: source.mount_face ?? 'bottom' }
    : { hvacKind: anchor.ref?.source === 'outdoor' ? 'outdoor' : anchor.ref?.source === 'ceiling' ? 'indoor' : 'power' });
  let partIndex = 0;
  object.traverse((child) => {
    if (child === object) return;
    child.name = `${descriptor.objectId}:part:${partIndex++}`;
  });
  root.add(object);
  const target = descriptor.kind === 'anchor' ? index.equipment : index.terminals;
  target.set(descriptor.objectId, object);
  index.all.set(descriptor.objectId, object);
}

export function buildHvacGeometry(
  root: THREE.Group,
  projection: ProjectRenderFactsProjection | undefined,
  sources: HvacBuilderSources = { ceiling: [], electrical: [], outdoor: [] },
): HvacGeometryBuildResult {
  const index: HvacEntityIndex = { equipment: new Map(), terminals: new Map(), all: new Map() };
  if (projection?.hvac.status !== 'implemented') return { index, descriptors: [] };
  const descriptors = buildHvacEntityDescriptors(projection.hvac.planId, projection.hvac.diagram, sources);
  const entitiesRoot = new THREE.Group();
  entitiesRoot.name = 'HVAC_CONFIRMED_ENTITIES';
  root.add(entitiesRoot);
  for (const descriptor of descriptors) addDescriptor(entitiesRoot, descriptor, index);
  return { index, descriptors };
}

export function expectedHvacGeometryIds(projection: ProjectRenderFactsProjection | undefined, sources: HvacBuilderSources = {}): string[] {
  return buildHvacGeometry(new THREE.Group(), projection, sources).descriptors.map((descriptor) => descriptor.objectId);
}

export type HvacGeometryPosition = Vec3;
