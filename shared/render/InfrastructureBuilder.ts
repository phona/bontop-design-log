import * as THREE from 'three';
import type { ElectricalPoint, PlumbingPoint, WallSide } from '../types.js';
import { buildFixture } from './FixtureFactory.js';

export interface InfrastructureWallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface InfrastructureInput {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  wallSegments?: ReadonlyMap<string, InfrastructureWallSegment[]>;
}

export interface InfrastructureBuildResult {
  electrical: THREE.Group[];
  plumbing: THREE.Group[];
  objects: THREE.Group[];
}

const FIXTURE_TYPES: Record<string, string> = {
  socket: 'socket',
  switch: 'switch',
  switch_2way: 'switch_2way',
  network: 'network',
  usb: 'usb',
  floor_socket: 'floor_socket',
  strong_panel: 'strong_panel',
  weak_panel: 'weak_panel',
  faucet: 'faucet',
  faucet_outdoor: 'faucet_outdoor',
  toilet: 'toilet',
  shower: 'shower',
  drain: 'drain',
  washer: 'washer',
};

const PANEL_DIMENSIONS: Record<string, { width: number; depth: number; height: number; frontProjection: number }> = {
  // Recipe local z positions place the door slightly behind the nominal body front.
  strong_panel: { width: 0.60, depth: 0.16, height: 1.00, frontProjection: 0.08 },
  weak_panel: { width: 0.45, depth: 0.14, height: 0.75, frontProjection: 0.13 },
};

const WALL_THICKNESS = 0.12;
const WALL_GAP = 0.005;
const FIXTURE_HALF_THICKNESS = 0.01;

function styledPart(
  geometry: THREE.BufferGeometry,
  color: number,
  roughness: number,
  partName: string,
  materialRole: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness }));
  mesh.name = partName;
  mesh.userData = { part: partName, materialRole };
  return mesh;
}

function buildWarmWhiteModularElectrical(point: ElectricalPoint): THREE.Group {
  const appearance = point.appearance!;
  const group = new THREE.Group();
  const warmWhite = 0xf3f0e8;
  const warmWhiteInset = 0xe9e6df;
  const graphite = 0x30343a;
  const depth = appearance.projection;

  const backer = styledPart(
    new THREE.BoxGeometry(appearance.faceplate_width - 0.006, appearance.faceplate_height - 0.006, 0.012),
    0xd8d4ca,
    0.72,
    'panel-recessed-backer',
    'fixture_body',
  );
  backer.position.z = -0.006;
  const faceplate = styledPart(
    new THREE.BoxGeometry(appearance.faceplate_width, appearance.faceplate_height, depth),
    warmWhite,
    0.82,
    'warm-white-matte-faceplate',
    'faceplate',
  );
  group.add(backer, faceplate);

  const frontZ = depth / 2 + 0.0015;
  if (appearance.module === 'five_hole_replaceable_usb_c') {
    const socketField = styledPart(new THREE.BoxGeometry(0.066, 0.058, 0.002), warmWhiteInset, 0.86, 'socket-field', 'socket_module');
    socketField.position.set(0, -0.007, frontZ);
    group.add(socketField);
    const openings = [
      [-0.018, -0.001, 0.010, 0.004], [0.018, -0.001, 0.010, 0.004],
      [-0.013, -0.018, 0.005, 0.012], [0.013, -0.018, 0.005, 0.012], [0, -0.028, 0.005, 0.010],
    ] as const;
    for (const [x, y, width, height] of openings) {
      const opening = styledPart(new THREE.BoxGeometry(width, height, 0.002), graphite, 0.74, `receptacle-${group.children.length}`, 'receptacle');
      opening.position.set(x, y, frontZ + 0.002);
      group.add(opening);
    }
    const usbModule = styledPart(new THREE.BoxGeometry(0.032, 0.017, 0.003), 0xdedbd3, 0.84, 'replaceable-usb-c-module', 'replaceable_usb_c');
    usbModule.position.set(0, 0.026, frontZ + 0.001);
    const usbPort = styledPart(new THREE.BoxGeometry(0.014, 0.004, 0.002), graphite, 0.74, 'usb-c-port', 'usb_c');
    usbPort.position.set(0, 0.026, frontZ + 0.003);
    group.add(usbModule, usbPort);
  } else {
    const rocker = styledPart(new THREE.BoxGeometry(0.070, 0.070, 0.004), 0xeeece5, 0.84, 'warm-white-two-way-rocker', 'rocker');
    rocker.position.z = frontZ + 0.002;
    const lowerShadow = styledPart(new THREE.BoxGeometry(0.060, 0.002, 0.0015), 0xc9c5bc, 0.9, 'rocker-lower-shadow', 'rocker_edge');
    lowerShadow.position.set(0, -0.031, frontZ + 0.0045);
    group.add(rocker, lowerShadow);
  }
  return group;
}

function projectPoint(
  point: { x: number; z: number; wall?: string; wallSide?: WallSide },
  wallSegments: ReadonlyMap<string, InfrastructureWallSegment[]> | undefined,
): { x: number; z: number; rotation: number; wallSide?: WallSide } | null {
  if (!point.wall) return null;
  const segments = wallSegments?.get(point.wall);
  if (!segments?.length) return null;

  const worldDirections: Record<WallSide, { x: number; z: number }> = {
    north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
  };
  let best: { x: number; z: number; rotation: number; distance: number; wallSide?: WallSide } | undefined;
  for (const segment of segments) {
    const dx = segment.x2 - segment.x1;
    const dz = segment.z2 - segment.z1;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((point.x - segment.x1) * dx + (point.z - segment.z1) * dz) / lengthSquared));
    const x = segment.x1 + t * dx;
    const z = segment.z1 + t * dz;
    const distance = Math.hypot(point.x - x, point.z - z);
    const length = Math.sqrt(lengthSquared);
    const ux = dx / length;
    const uz = dz / length;
    const left = { x: -uz, z: ux };
    const right = { x: uz, z: -ux };
    const authoredSide = (point.x - x) * left.x + (point.z - z) * left.z;
    let normal = authoredSide < -1e-9 ? right : left;
    if (point.wallSide) {
      const direction = worldDirections[point.wallSide];
      normal = left.x * direction.x + left.z * direction.z >= right.x * direction.x + right.z * direction.z ? left : right;
    }
    const rotation = Math.atan2(normal.x, normal.z);
    if (!best || distance < best.distance) best = { x, z, rotation, distance, wallSide: point.wallSide };
  }
  return best ? { x: best.x, z: best.z, rotation: best.rotation, wallSide: best.wallSide } : null;
}

function placeModel(
  model: THREE.Group,
  point: { x: number; z: number; wall?: string; wallSide?: WallSide },
  y: number,
  wallSegments: ReadonlyMap<string, InfrastructureWallSegment[]> | undefined,
  frontProjection = 0,
): void {
  const projected = projectPoint(point, wallSegments);
  if (!projected) {
    model.position.set(point.x, y, point.z);
    return;
  }
  const nx = Math.sin(projected.rotation);
  const nz = Math.cos(projected.rotation);
  const offset = WALL_THICKNESS / 2 + WALL_GAP + FIXTURE_HALF_THICKNESS - frontProjection;
  model.position.set(projected.x + nx * offset, y, projected.z + nz * offset);
  model.rotation.y = projected.rotation;
}

function metadata(point: ElectricalPoint | PlumbingPoint, category: 'electrical' | 'plumbing', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objectId: `${category}:${point.id}`,
    hoverable: true,
    type: category,
    roomId: point.room,
    fixtureType: point.type,
    wallSide: point.wallSide,
    ...('appearance' in point && point.appearance ? {
      appearanceStyle: point.appearance.style,
      module: point.appearance.module,
      faceplate: {
        width: point.appearance.faceplate_width,
        height: point.appearance.faceplate_height,
        projection: point.appearance.projection,
      },
      ...(point.appearance.panel_group ? { panelGroup: point.appearance.panel_group } : {}),
    } : {}),
    ...extra,
  };
}

function buildElectrical(point: ElectricalPoint, wallSegments: ReadonlyMap<string, InfrastructureWallSegment[]> | undefined): THREE.Group | null {
  const fixtureType = FIXTURE_TYPES[point.type];
  if (!fixtureType) return null;
  const model = point.appearance?.style === 'warm_white_matte_modular'
    ? buildWarmWhiteModularElectrical(point)
    : buildFixture(fixtureType);
  if (!model) return null;
  const dimensions = PANEL_DIMENSIONS[point.type];
  const panelHeight = dimensions ? (point.body_height ?? point.height ?? dimensions.height) : undefined;
  const mountHeight = dimensions ? (point.mount_height ?? 0) : undefined;
  if (dimensions) {
    model.scale.set(
      (point.width ?? dimensions.width) / dimensions.width,
      panelHeight! / dimensions.height,
      (point.depth ?? dimensions.depth) / dimensions.depth,
    );
  }
  placeModel(model, point, dimensions ? mountHeight! + panelHeight! / 2 : point.type === 'floor_socket' ? 0.05 : point.height!, wallSegments, dimensions?.frontProjection ?? 0);
  model.userData = metadata(point, 'electrical', {
    label: point.type === 'strong_panel' ? '强电箱' : point.type === 'weak_panel' ? '弱电箱' : undefined,
    status: point.status,
    position_status: point.position_status,
    mount_height: dimensions ? mountHeight : undefined,
    body_height: dimensions ? panelHeight : undefined,
    recessed: dimensions ? true : undefined,
    developer_reserved: dimensions ? true : undefined,
    dimensions: dimensions ? { width: point.width ?? dimensions.width, depth: point.depth ?? dimensions.depth, height: panelHeight } : undefined,
  });
  model.name = String(model.userData.objectId);
  model.traverse((child) => {
    if (child === model) return;
    child.name = `${model.name}:${child.name || 'part'}`;
  });
  return model;
}

function buildPlumbing(point: PlumbingPoint, wallSegments: ReadonlyMap<string, InfrastructureWallSegment[]> | undefined): THREE.Group | null {
  const fixtureType = FIXTURE_TYPES[point.type];
  if (!fixtureType) return null;
  const model = buildFixture(fixtureType);
  if (!model) return null;

  // Blender's shower anchor height is the finished-floor-to-head height. The
  // shared recipe is authored from y=0 to y=1.2, so scale that local recipe to
  // the declared top rather than placing its local origin at the top anchor.
  const placementHeight = point.height ?? (point.type === 'drain' ? 0 : 0.5);
  if (point.type === 'shower') {
    const localBounds = new THREE.Box3().setFromObject(model);
    const localHeight = Math.max(localBounds.max.y - localBounds.min.y, 1e-9);
    const scaleY = Math.max(0, placementHeight) / localHeight;
    model.scale.y = scaleY;
    // Align the recipe's actual lowest point to finished floor, preserving the
    // declared point height as the actual top of the generated fixture.
    placeModel(model, point, -localBounds.min.y * scaleY, wallSegments);
  } else {
    placeModel(model, point, placementHeight, wallSegments);
  }
  model.userData = metadata(point, 'plumbing', {
    placementHeight,
    heightMeaning: point.type === 'shower' ? 'finished_floor_to_shower_head' : 'fixture_origin_elevation',
  });
  model.name = String(model.userData.objectId);
  model.traverse((child) => {
    if (child === model) return;
    child.name = `${model.name}:${child.name || 'part'}`;
  });
  return model;
}

export function buildInfrastructure(input: InfrastructureInput): InfrastructureBuildResult {
  const electrical = input.electrical.map((point) => buildElectrical(point, input.wallSegments)).filter((model): model is THREE.Group => model !== null);
  const plumbing = input.plumbing.map((point) => buildPlumbing(point, input.wallSegments)).filter((model): model is THREE.Group => model !== null);
  return { electrical, plumbing, objects: [...electrical, ...plumbing] };
}

export const projectInfrastructurePoint = projectPoint;

export interface OpeningMarkerSpec {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  kind: string;
}

export function buildOpeningMarker(spec: OpeningMarkerSpec): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: spec.kind.includes('door') ? 0x3b82f6 : 0x93c5fd,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), material);
  mesh.position.set(spec.x, spec.y, spec.z);
  if (Math.abs(spec.z) > Math.abs(spec.x)) mesh.rotation.y = Math.PI;
  return mesh;
}
