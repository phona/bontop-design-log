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

function statusHairline(width: number, height: number, material: THREE.Material): THREE.LineSegments {
  // DEC-2026-10-07-R03：linear_slot 功能段的状态提示从整框方框改为槽内贴边发丝线，
  // 保留 inferred/pending 的颜色语义，不再把风口读成孤立矩形。
  const w = width / 2 - 0.004;
  const h = height / 2 - 0.004;
  const corners = [
    new THREE.Vector3(-w, -h, 0.011), new THREE.Vector3(w, -h, 0.011),
    new THREE.Vector3(w, -h, 0.011), new THREE.Vector3(w, h, 0.011),
    new THREE.Vector3(w, h, 0.011), new THREE.Vector3(-w, h, 0.011),
    new THREE.Vector3(-w, h, 0.011), new THREE.Vector3(-w, -h, 0.011),
  ];
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners), material);
}

function terminalHeight(terminal: HvacTerminal): number {
  return terminal.grille_height ?? (terminal.system === 'return_air' ? 0.25 : 0.15);
}

function buildTerminalGeometry(terminal: HvacTerminal): THREE.Group {
  const mountFace = terminal.mount_face ?? 'bottom';
  const group = new THREE.Group();
  // DEC-2026-10-05-R16：通长隐藏式风槽黑色内衬定制（matte_black），默认仍为浅灰塑料百叶。
  const dark = terminal.finish === 'matte_black';
  const body = new THREE.MeshStandardMaterial({ color: dark ? 0x141414 : 0xf5f5f5, roughness: dark ? 0.85 : 0.9 });
  const frame = new THREE.MeshStandardMaterial({ color: dark ? 0x26262a : 0xd4d4d4, roughness: dark ? 0.75 : 0.7 });
  const statusLine = new THREE.LineBasicMaterial({ color: STATUS_COLOR[terminal.status] });
  const linearSlot = terminal.render_style === 'linear_slot';
  if (terminal.system === 'access') {
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.42, 0.015), body));
    group.add(frameOutline(0.45, 0.42, 0.02, frame));
    group.add(statusFrame(0.45, 0.42, statusLine));
  } else if (linearSlot) {
    // DEC-2026-10-07-R03：通长线性槽——满长连续叶片、无成品外框；功能段留槽内贴边状态发丝线，
    // 装饰段（kind=decorative_louver，背板封闭无风道）不画任何状态线。
    const width = terminal.length ?? 0.9;
    const height = terminalHeight(terminal);
    const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.01), body);
    back.position.z = -0.008;
    group.add(back);
    const slatCount = Math.max(3, Math.min(7, Math.round(height / 0.04)));
    const usable = height - 0.024;
    for (let i = 0; i < slatCount; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(width, 0.012, 0.03), frame);
      slat.position.set(0, usable / 2 - (usable / (slatCount - 1)) * i, 0.004);
      slat.rotation.x = 0.45;
      group.add(slat);
    }
    for (const endX of [-(width / 2), width / 2]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.016, height, 0.018), frame);
      cap.position.set(endX, 0, 0.002);
      group.add(cap);
    }
    if (terminal.kind !== 'decorative_louver') group.add(statusHairline(width, height, statusLine));
  } else {
    const width = terminal.length ?? (terminal.system === 'return_air' ? 0.6 : 0.8);
    const height = terminalHeight(terminal);
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
    ? { mount_face: source.mount_face ?? 'bottom', render_style: source.render_style ?? 'panel', decorative: source.kind === 'decorative_louver' }
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
