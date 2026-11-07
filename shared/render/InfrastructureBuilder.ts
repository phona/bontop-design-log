import * as THREE from 'three';
import type { ElectricalPoint, PlumbingPoint, WallSide } from '../types.js';
import { buildFixture } from './FixtureFactory.js';
import {
  POINT_WALL_GAP,
  THIN_PLATE_FACE_OFFSET,
  type PointPlacement,
  type PointPlacementInput,
  type PointWall,
  resolvePointPlacementInWalls,
} from '../point-placement.js';
import { WALL_THICKNESS } from '../furniture-placement.js';

export interface InfrastructureInput {
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  /** 点位宿主墙索引（id → 折线段 + line_datum）：沿墙点位改调 shared/point-placement.ts 单一解算。 */
  pointWalls?: ReadonlyMap<string, PointWall>;
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
  ac_controller: 'ac_controller',
  faucet: 'faucet',
  faucet_outdoor: 'faucet_outdoor',
  water_supply: 'water_supply',
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

/**
 * 点位平面解算（issue #98 第四阶段 S1）：沿墙点位走 shared/point-placement.ts 单一解算器
 * （along 沿折线累计 + wallFaceOffset + 侧别法线），**不再本地写「最近段投影 + t clamp」**——
 * clamp 是 sock_weakbox 242mm 静默偏差的机制根源。解算失败（越界/断引用/缺 along）返回诊断，
 * 模型不进场景，由 SceneBuilder 的 placementDiagnostics 通道显形。
 */
function resolveInfrastructure(
  point: PointPlacementInput,
  pointWalls: ReadonlyMap<string, PointWall> | undefined,
): { placement: PointPlacement | null; diagnostic?: string } {
  const { placement, diagnostic } = resolvePointPlacementInWalls(point, pointWalls);
  if (!placement && diagnostic === undefined) {
    return { placement: null, diagnostic: `点位 ${point.id}: 定位解算未返回结果（无诊断）` };
  }
  return { placement, diagnostic };
}

/**
 * 落位并返回诊断（undefined = 已落位；字符串 = 点位解算失败，调用方应丢弃该模型）。
 *
 * 口径（2026-11-07 业主裁定「DXF 迁就 3D 投影」）：先解析出墙线上的 datum 与侧别法线，
 * **再按薄板惯例偏移**（THIN_PLATE_FACE_OFFSET = 半墙厚 + 墙缝 + 半件厚 = 0.075m）——
 * 与 DXF 出图共用同一解算与同一偏移，施工图与模型从此按构造同点。
 */
function placeModel(
  model: THREE.Group,
  point: PointPlacementInput,
  y: number,
  pointWalls: ReadonlyMap<string, PointWall> | undefined,
  frontProjection = 0,
  /** Recessed box (strong/weak panel): its body sits inside the wall and the door position is tuned by frontProjection, so the thin-panel convention stays. */
  recessed = false,
): string | undefined {
  const { placement, diagnostic } = resolveInfrastructure(point, pointWalls);
  if (diagnostic !== undefined || !placement) return diagnostic ?? `点位 ${point.id}: 定位解算失败`;
  if (placement.kind === 'absolute') {
    if (point.x === undefined || point.z === undefined) return `点位 ${point.id}: 绝对定位缺 x/z`;
    model.position.set(point.x, y, point.z);
    return undefined;
  }
  const rotation = Math.atan2(placement.normal.x, placement.normal.z);
  const nx = Math.sin(rotation);
  const nz = Math.cos(rotation);
  // A fixture thicker than the wall cannot hang off the wall face under the thin-panel
  // convention: its wall-facing extreme is pushed straight through into the room on the
  // other side (2026-10-26: the toilet marker's tank landed inside the children's room).
  // Anchor such a fixture by its wall-facing extreme, leaving only WALL_GAP to the wall face.
  const towardWall = recessed ? 0 : Math.max(0, -new THREE.Box3().setFromObject(model).min.z);
  const offset = towardWall > WALL_THICKNESS
    ? WALL_THICKNESS / 2 + POINT_WALL_GAP + towardWall - frontProjection
    : THIN_PLATE_FACE_OFFSET - frontProjection;
  model.position.set(placement.datum.x + nx * offset, y, placement.datum.z + nz * offset);
  model.rotation.y = rotation;
  return undefined;
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

function buildElectrical(point: ElectricalPoint, pointWalls: ReadonlyMap<string, PointWall> | undefined): { model: THREE.Group | null; diagnostic?: string } {
  const fixtureType = FIXTURE_TYPES[point.type];
  if (!fixtureType) return { model: null };
  const model = point.appearance?.style === 'warm_white_matte_modular'
    ? buildWarmWhiteModularElectrical(point)
    : buildFixture(fixtureType);
  if (!model) return { model: null };
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
  const diagnostic = placeModel(model, point, dimensions ? mountHeight! + panelHeight! / 2 : point.type === 'floor_socket' ? 0.05 : point.height!, pointWalls, dimensions?.frontProjection ?? 0, dimensions !== undefined);
  if (diagnostic !== undefined) return { model: null, diagnostic };
  model.userData = metadata(point, 'electrical', {
    label: point.type === 'strong_panel' ? '强电箱' : point.type === 'weak_panel' ? '弱电箱' : point.type === 'ac_controller' ? '线控器' : undefined,
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
  return { model };
}

function buildPlumbing(point: PlumbingPoint, pointWalls: ReadonlyMap<string, PointWall> | undefined): { model: THREE.Group | null; diagnostic?: string } {
  const fixtureType = FIXTURE_TYPES[point.type];
  if (!fixtureType) return { model: null };
  const model = buildFixture(fixtureType);
  if (!model) return { model: null };

  // Blender's shower anchor height is the finished-floor-to-head height. The
  // shared recipe is authored from y=0 to y=1.2, so scale that local recipe to
  // the declared top rather than placing its local origin at the top anchor.
  const placementHeight = point.height ?? (point.type === 'drain' ? 0 : 0.5);
  let diagnostic: string | undefined;
  if (point.type === 'shower') {
    const localBounds = new THREE.Box3().setFromObject(model);
    const localHeight = Math.max(localBounds.max.y - localBounds.min.y, 1e-9);
    const scaleY = Math.max(0, placementHeight) / localHeight;
    model.scale.y = scaleY;
    // Align the recipe's actual lowest point to finished floor, preserving the
    // declared point height as the actual top of the generated fixture.
    diagnostic = placeModel(model, point, -localBounds.min.y * scaleY, pointWalls);
  } else {
    diagnostic = placeModel(model, point, placementHeight, pointWalls);
  }
  if (diagnostic !== undefined) return { model: null, diagnostic };
  model.userData = metadata(point, 'plumbing', {
    placementHeight,
    heightMeaning: point.type === 'shower' ? 'finished_floor_to_shower_head' : 'fixture_origin_elevation',
  });
  model.name = String(model.userData.objectId);
  model.traverse((child) => {
    if (child === model) return;
    child.name = `${model.name}:${child.name || 'part'}`;
  });
  return { model };
}

export interface InfrastructureBuildResult {
  electrical: THREE.Group[];
  plumbing: THREE.Group[];
  objects: THREE.Group[];
  /**
   * 点位定位解算诊断（issue #98 S1）：沿墙点位 along 越界/断引用/缺声明时不进场景，
   * 逐条显形——替代原先「投影超段就悄悄钳到端点」的静默位移（sock_weakbox 242mm）。
   */
  placementDiagnostics: string[];
}

export function buildInfrastructure(input: InfrastructureInput): InfrastructureBuildResult {
  const placementDiagnostics: string[] = [];
  const electrical: THREE.Group[] = [];
  const plumbing: THREE.Group[] = [];
  for (const point of input.electrical) {
    const built = buildElectrical(point, input.pointWalls);
    if (built.diagnostic !== undefined) placementDiagnostics.push(built.diagnostic);
    if (built.model) electrical.push(built.model);
  }
  for (const point of input.plumbing) {
    const built = buildPlumbing(point, input.pointWalls);
    if (built.diagnostic !== undefined) placementDiagnostics.push(built.diagnostic);
    if (built.model) plumbing.push(built.model);
  }
  return { electrical, plumbing, objects: [...electrical, ...plumbing], placementDiagnostics };
}

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
