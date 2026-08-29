import * as THREE from 'three';
import type { CurtainPoint, FurnishingsYaml, LightingRenderConfig, PlumbingPoint, ProjectRenderFactsProjection, RenderLightingFixture, ResolvedOpening, ResolvedRoom, SceneElement, WallSegment, RoomObject } from '../types.js';
import { buildInfrastructure } from './InfrastructureBuilder.js';
import { buildLightingFixtures } from './LightingFixtureBuilder.js';
import { type HvacBuilderSources } from './HvacBuilder.js';
import { buildHvacGeometry, type HvacEntityIndex } from './HvacGeometryBuilder.js';
import { buildCeilingZone, type CeilingZoneSpec } from './CeilingZoneBuilder.js';
import {
  buildBathSideCabinetRun,
  buildFixture,
  buildKitchenCabinetRun,
  buildKitchenCountertopBridge,
  buildWardrobe180,
  buildWardrobeSplit,
} from './FixtureFactory.js';
import { createLineMesh, createPolygonGeometry, setSceneObjectMetadata, splitSegmentByOpenings } from '../three-scene-geometry.js';
import { scalePlaneUvToMeters } from './uv-utils.js';
import { curtainRibbonShape, curtainShape, gatheredCurtainSegments, offsetCurtainPointsInterior, roundedShape } from './CurtainGeometry.js';
import { buildBaySillGeometry } from './BaySillGeometry.js';
import { buildRailingGeometry } from './RailingGeometryBuilder.js';

const WALL_THICKNESS = 0.12;
/** Room floors and declared floor regions intentionally share one elevation. */
export const FLOOR_Y = 0.005;
const DEFAULT_FLOOR = 0xe8e0d5;
const DEFAULT_CEILING = 0xf5f5f5;
const DEFAULT_PAINT = 0xf7f5ef;
const SHAFT_WALL = 0x555555;

export interface SceneBuildReport {
  rooms: number;
  walls: number;
  ceilings: number;
  ceilingZones: number;
  furniture: number;
  plumbing: number;
  lightingFixtures: number;
  hvacEquipment: number;
  hvacTerminals: number;
  hvacStatus: 'implemented' | 'unimplemented';
  skippedFurniture: string[];
  skippedPlumbing: string[];
  unsupported: string[];
}

export interface SceneMaterialProvider {
  wall?: (context: { element: Extract<SceneElement, { type: 'wall' }>; shaft: boolean }) => THREE.Material;
  door?: (context: { opening: ResolvedOpening; elevator: boolean }) => THREE.Material;
  doorFrame?: (context: { opening: ResolvedOpening; elevator: boolean }) => THREE.Material;
  lintel?: (context: { wall: Extract<SceneElement, { type: 'wall' }>; opening: ResolvedOpening }) => THREE.Material;
  curtain?: (context: { element: Extract<SceneElement, { type: 'curtain' }>; layer: 'sheer' | 'blackout' | 'blinds'; variant: 'deployed' | 'gathered' }) => THREE.Material;
  curtainRun?: (element: Extract<SceneElement, { type: 'curtain_run' }>) => THREE.Material;
  showerScreen?: (element: Extract<SceneElement, { type: 'shower_screen' }>) => THREE.Material;
  slidingDoorRail?: (element: Extract<SceneElement, { type: 'sliding_door_run' }>) => THREE.Material;
  slidingDoorFrame?: (element: Extract<SceneElement, { type: 'sliding_door_run' }>) => THREE.Material;
  slidingDoorGlass?: (context: { element: Extract<SceneElement, { type: 'sliding_door_run' }>; paneWidth: number }) => THREE.Material;
}

export interface SceneBuilderOptions {
  materialProvider?: SceneMaterialProvider;
  curtainRooms?: ResolvedRoom[];
  curtainOffset?: number;
  hvac?: { projection: ProjectRenderFactsProjection; sources?: HvacBuilderSources };
  lighting?: LightingRenderConfig;
}

export interface ScenePlatform {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  points?: CurtainPoint[];
}

export interface SceneBuilderInput {
  rooms: ResolvedRoom[];
  platform?: ScenePlatform;
  walls: Array<WallSegment & { height?: number }>;
  elements: SceneElement[];
  ceilingZones?: CeilingZoneSpec[];
  furnishings?: FurnishingsYaml;
  plumbing?: PlumbingPoint[];
  lightingFixtures?: RenderLightingFixture[];
  sceneName?: string;
  options?: SceneBuilderOptions;
}

export interface CurtainBuildVariants {
  sheer?: { deployed: THREE.Mesh; gathered: THREE.Mesh[] };
  blackout?: { deployed: THREE.Mesh; gathered: THREE.Mesh[] };
  blinds?: { deployed: THREE.Mesh; gathered: THREE.Mesh };
}

export interface CurtainBuildEntry {
  id: string;
  roomId?: string;
  kind: 'sheer_blackout' | 'blinds';
  variants: CurtainBuildVariants;
}

export interface SceneBuildIndex {
  rooms: Record<string, RoomObject>;
  floorMeshes: THREE.Mesh[];
  wallMeshes: THREE.Mesh[];
  ceilingMeshes: THREE.Mesh[];
  furnitureMeshes: THREE.Group[];
  countertopMeshes: THREE.Mesh[];
  glassMeshes: THREE.Mesh[];
  doorMeshes: THREE.Mesh[];
  curtainRuns: Map<string, THREE.Object3D[]>;
  curtains: Map<string, CurtainBuildEntry>;
  slidingDoorGroups: Map<string, THREE.Group>;
  plumbing: Map<string, THREE.Group>;
  lightingFixtures: Map<string, THREE.Group>;
  wallSegments: Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>;
  openingWallSegments: Map<string, THREE.Mesh[]>;
  lintels: Map<string, THREE.Mesh[]>;
  hvac: HvacEntityIndex;
}

export interface SceneBuildResult {
  /** Configuration-driven geometry eligible for GLB export. */
  exportRoot: THREE.Group;
  /** Configuration-driven geometry visible in the browser but excluded from GLB export. */
  viewOnlyRoot: THREE.Group;
  /** Compatibility scene containing both persistent roots. */
  scene: THREE.Scene;
  report: SceneBuildReport;
  index: SceneBuildIndex;
}

type Point = { x: number; z: number };
type WallElement = Extract<SceneElement, { type: 'wall' }>;
type CurtainElement = Extract<SceneElement, { type: 'curtain' }>;
type SlidingDoorElement = Extract<SceneElement, { type: 'sliding_door_run' }>;

function defaultMaterials(): Required<Pick<SceneMaterialProvider, 'wall' | 'door' | 'doorFrame' | 'lintel' | 'curtain' | 'curtainRun' | 'showerScreen' | 'slidingDoorRail' | 'slidingDoorFrame' | 'slidingDoorGlass'>> {
  return {
    wall: ({ shaft }) => new THREE.MeshStandardMaterial({ color: shaft ? SHAFT_WALL : DEFAULT_PAINT, roughness: 0.85 }),
    door: ({ elevator }) => new THREE.MeshStandardMaterial({ color: elevator ? 0x888899 : 0x8b4513, roughness: elevator ? 0.25 : 0.6, metalness: elevator ? 0.85 : 0 }),
    doorFrame: ({ elevator }) => new THREE.MeshStandardMaterial({ color: elevator ? 0x333336 : 0x555555, roughness: elevator ? 0.35 : 0.7, metalness: elevator ? 0.6 : 0 }),
    lintel: ({ wall }) => new THREE.MeshStandardMaterial({ color: wall.id.includes('elev') ? SHAFT_WALL : DEFAULT_PAINT, roughness: 0.85 }),
    curtain: ({ layer, variant }) => new THREE.MeshStandardMaterial({ color: layer === 'sheer' ? 0xf5f2ea : layer === 'blackout' ? 0xcfc8ba : 0xdfe3e6, transparent: layer !== 'blackout', opacity: layer === 'sheer' ? 0.35 : layer === 'blinds' ? 0.75 : 1, roughness: layer === 'sheer' ? 0.9 : layer === 'blinds' ? 0.6 : 0.95, side: THREE.DoubleSide, depthWrite: false }),
    curtainRun: () => glassMaterial(),
    showerScreen: () => glassMaterial(),
    slidingDoorRail: () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }),
    slidingDoorFrame: () => new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.5, roughness: 0.45 }),
    slidingDoorGlass: () => glassMaterial(),
  };
}

function addRoomGeometry(root: THREE.Group, room: ResolvedRoom, report: SceneBuildReport): void {
  // ResolvedRoom.points are world/layout coordinates. Room meshes use a group-local
  // contour, then the mesh is translated back to the room center. In particular,
  // rounded-vertex cx/cz are converted together with x/z; never mix absolute and
  // room-local points in the same Shape.
  const points = room.points ?? [];
  const localPoints = points.map((point) => ({
    ...point,
    x: point.x - room.x,
    z: point.z - room.z,
    ...(point.cx !== undefined ? { cx: point.cx - room.x } : {}),
    ...(point.cz !== undefined ? { cz: point.cz - room.z } : {}),
  }));
  const hasRoundedCorners = localPoints.some((point) => point.radius !== undefined || point.cx !== undefined || point.cz !== undefined);
  const makeGeometry = (): THREE.BufferGeometry => {
    if (localPoints.length < 3) {
      const geometry = new THREE.PlaneGeometry(room.width, room.depth);
      scalePlaneUvToMeters(geometry, room.width, room.depth);
      return geometry;
    }
    if (hasRoundedCorners) {
      const geometry = new THREE.ShapeGeometry(roundedShape(localPoints));
      const position = geometry.getAttribute('position');
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < position.count; i++) {
        uv.setXY(i, position.getX(i), -position.getY(i));
      }
      uv.needsUpdate = true;
      return geometry;
    }
    return createPolygonGeometry(localPoints);
  };
  const isShaft = room.id === 'elevator_shaft';
  // 电梯井不属于套内：HEAD 起就不生成地面/天花（俯视应留空，而不是铺地板）。
  if (!isShaft) {
    const floor = new THREE.Mesh(
      makeGeometry(),
      new THREE.MeshStandardMaterial({ color: DEFAULT_FLOOR, roughness: 0.75, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.x, FLOOR_Y, room.z);
    floor.receiveShadow = true;
    setSceneObjectMetadata(floor, 'floor', `floor:${room.id}`);
    floor.userData.roomId = room.id;
    root.add(floor);
    report.rooms++;

    const ceiling = new THREE.Mesh(
      makeGeometry(),
      new THREE.MeshStandardMaterial({ color: DEFAULT_CEILING, roughness: 0.9, side: THREE.DoubleSide }),
    );
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.set(room.x, room.height - 0.005, room.z);
    setSceneObjectMetadata(ceiling, 'ceiling', `ceiling:${room.id}`);
    root.add(ceiling);
    report.ceilings++;
  }
}

function addLineMeshes(root: THREE.Group, points: Point[], height: number, thickness: number, material: THREE.Material, type: string, id: string): void {
  for (let i = 0; i < points.length - 1; i++) {
    const mesh = createLineMesh(points[i], points[i + 1], height, thickness, material);
    if (!mesh) continue;
    setSceneObjectMetadata(mesh, type, `${id}:${i}`);
    root.add(mesh);
  }
}

function addWallElement(root: THREE.Group, wall: WallElement, height: number, report: SceneBuildReport, index: SceneBuildIndex, provider: SceneMaterialProvider): void {
  const sourceSegments = wall.segments?.length ? wall.segments : [wall];
  const materials = { ...defaultMaterials(), ...provider };
  const shaft = wall.id.includes('elev') || wall.id.includes('foyer_outer_east') || wall.id.includes('foyer_north_east');
  const material = materials.wall({ element: wall, shaft });
  const wallType = shaft ? 'structure' : 'interior';
  const exportName = wall.rooms?.length ? `${wall.id}:room=${wall.rooms.join('|')}` : undefined;
  const wallSegments: THREE.Mesh[] = [];
  const lintels: THREE.Mesh[] = [];
  let segmentIndex = 0;
  for (const source of sourceSegments) {
    const segments = wall.openings?.length ? splitSegmentByOpenings(source, wall.openings) : [source];
    for (const segment of segments) {
      const mesh = createLineMesh({ x: segment.x1, z: segment.z1 }, { x: segment.x2, z: segment.z2 }, height, WALL_THICKNESS, material);
      if (!mesh) continue;
      const objectId = sourceSegments.length === 1 && segments.length === 1 ? wall.id : `${wall.id}:${segmentIndex}`;
      const segmentExportName = exportName ? `${objectId}:room=${wall.rooms!.join('|')}` : objectId;
      setSceneObjectMetadata(mesh, 'wall', objectId, segmentExportName);
      mesh.userData.wallType = wallType;
      mesh.userData.roomId = wall.rooms?.[0];
      root.add(mesh); wallSegments.push(mesh); report.walls++; segmentIndex++;
    }
  }
  for (const opening of wall.openings ?? []) {
    const source = sourceSegments.find((candidate) => {
      const dx = candidate.x2 - candidate.x1; const dz = candidate.z2 - candidate.z1; const len = Math.hypot(dx, dz) || 1;
      return Math.abs((opening.x - candidate.x1) * dz - (opening.z - candidate.z1) * dx) < 0.01 * len;
    }) ?? sourceSegments[0];
    const dx = source.x2 - source.x1; const dz = source.z2 - source.z1; const len = Math.hypot(dx, dz); if (len < 0.001) continue;
    const ux = dx / len; const uz = dz / len; const t = (opening.x - source.x1) * ux + (opening.z - source.z1) * uz;
    const half = opening.width / 2; const elevator = opening.id === 'd_elev';
    const doorMat = materials.door({ opening, elevator }); const frameMat = materials.doorFrame({ opening, elevator });
    const sill = opening.sill ?? 0; const wallRotation = Math.atan2(uz, ux);
    const make = (mesh: THREE.Mesh, id: string) => { setSceneObjectMetadata(mesh, 'door', id); mesh.userData.wallType = wallType; mesh.castShadow = true; root.add(mesh); index.doorMeshes.push(mesh); };
    const center = { x: source.x1 + ux * t, z: source.z1 + uz * t };
    if (opening.type === 'door' && elevator) {
      const panelThick = 0.03; const seamGap = 0.015; const panelWidth = (opening.width - seamGap) / 2;
      for (const side of [-1, 1] as const) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(panelWidth, opening.height, panelThick), doorMat);
        const panelT = t + side * (panelWidth / 2 + seamGap / 2);
        panel.position.set(source.x1 + ux * panelT, sill + opening.height / 2, source.z1 + uz * panelT);
        panel.rotation.y = wallRotation; make(panel, `${opening.id}:panel:${side < 0 ? 'left' : 'right'}`);
      }
      const seam = new THREE.Mesh(new THREE.BoxGeometry(seamGap, opening.height, panelThick + 0.004), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5, metalness: 0.4 }));
      seam.position.set(center.x, sill + opening.height / 2, center.z); seam.rotation.y = wallRotation; make(seam, `${opening.id}:seam`);
      const frameWidth = 0.1; const frameDepth = 0.16;
      for (const side of [-1, 1] as const) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(frameWidth, opening.height + frameWidth, frameDepth), frameMat);
        const frameT = t + side * (half + frameWidth / 2);
        frame.position.set(source.x1 + ux * frameT, sill + (opening.height + frameWidth) / 2, source.z1 + uz * frameT);
        frame.rotation.y = wallRotation; make(frame, `${opening.id}:frame:${side < 0 ? 'left' : 'right'}`);
      }
      const topFrame = new THREE.Mesh(new THREE.BoxGeometry(opening.width + frameWidth * 2, frameWidth, frameDepth), frameMat);
      topFrame.position.set(center.x, sill + opening.height + frameWidth / 2, center.z); topFrame.rotation.y = wallRotation; make(topFrame, `${opening.id}:frame:top`);
    } else if (opening.type === 'door') {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(opening.width, opening.height, 0.04), doorMat);
      const wallNormal = { x: -uz, z: ux }; const inward = opening.swing === 'inward'; const hingeAtEnd = opening.hinge === 'end';
      const hingeOffset = inward || opening.swing === 'outward' ? (hingeAtEnd ? half : -half) : -half;
      const hinge = { x: source.x1 + ux * (t + hingeOffset), z: source.z1 + uz * (t + hingeOffset) };
      const panelDir = inward ? { x: -wallNormal.x, z: -wallNormal.z } : opening.swing === 'outward' ? wallNormal : { x: -uz, z: ux };
      panel.position.set(hinge.x + panelDir.x * half, sill + opening.height / 2, hinge.z + panelDir.z * half);
      panel.rotation.y = Math.atan2(-panelDir.z, panelDir.x); make(panel, opening.id);
      const frameThick = 0.05; const frameDepth = 0.15; const frameHeight = opening.height + frameThick * 2;
      for (const side of [-1, 1] as const) {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(frameThick, frameHeight, frameDepth), frameMat);
        const frameT = t + side * half;
        frame.position.set(source.x1 + ux * frameT, sill + frameHeight / 2, source.z1 + uz * frameT);
        frame.rotation.y = wallRotation; make(frame, `${opening.id}:frame:${side < 0 ? 'left' : 'right'}`);
      }
      const topFrame = new THREE.Mesh(new THREE.BoxGeometry(opening.width + frameThick * 2, frameThick, frameDepth), frameMat);
      topFrame.position.set(center.x, sill + opening.height + frameThick * 1.5, center.z); topFrame.rotation.y = wallRotation; make(topFrame, `${opening.id}:frame:top`);
    } else if (opening.type === 'sliding_door') {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(opening.width, opening.height, 0.04), doorMat);
      panel.position.set(center.x, sill + opening.height / 2, center.z); panel.rotation.y = wallRotation; make(panel, opening.id);
    }
    const top = sill + opening.height;
    if (top < height - 0.001) {
      const lintel = createLineMesh({ x: source.x1 + ux * (t - half), z: source.z1 + uz * (t - half) }, { x: source.x1 + ux * (t + half), z: source.z1 + uz * (t + half) }, height - top, WALL_THICKNESS, materials.lintel({ wall, opening }));
      if (lintel) { lintel.position.y = top + (height - top) / 2; setSceneObjectMetadata(lintel, 'lintel', `${opening.id}:lintel`); root.add(lintel); lintels.push(lintel); }
    }
  }
  index.openingWallSegments.set(wall.id, wallSegments); index.lintels.set(wall.id, lintels); if (wall.openings?.length) report.unsupported = report.unsupported.filter((entry) => !entry.startsWith(`${wall.id}:`));
}

function glassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xbfd8e8, transparent: true, opacity: 0.32, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false });
}

function addSlidingDoorRun(root: THREE.Group, element: SlidingDoorElement, provider: SceneMaterialProvider, existing?: THREE.Group): THREE.Group | null {
  if (element.points.length < 2) return null;
  if (existing) { while (existing.children.length) existing.remove(existing.children[0]); }
  const materials = { ...defaultMaterials(), ...provider };
  const [a, b] = [element.points[0], element.points[1]];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 1e-9) return null;
  const angle = Math.atan2(b.z - a.z, b.x - a.x);
  const nx = -(b.z - a.z) / length;
  const nz = (b.x - a.x) / length;
  const group = existing ?? new THREE.Group();
  setSceneObjectMetadata(group, 'sliding_door_run', element.id);
  group.name = `sliding_door:${element.id}`;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.16), materials.slidingDoorRail(element));
  rail.name = `sliding_door:${element.id}:rail`;
  rail.position.set((a.x + b.x) / 2, element.height + 0.03, (a.z + b.z) / 2);
  rail.rotation.y = angle;
  group.add(rail);
  const panels = element.panels ?? 3;
  const panelWidth = length / panels;
  const frame = 0.025;
  const depth = 0.04;
  const outerWidth = panelWidth - 0.06;
  const paneWidth = outerWidth - 2 * frame;
  const paneHeight = element.height - 2 * frame;
  const frameMaterial = materials.slidingDoorFrame(element);
  const glass = materials.slidingDoorGlass({ element, paneWidth });
  for (let i = 0; i < panels; i++) {
    const along = element.open === false ? (i + 0.5) * panelWidth : length - panelWidth / 2 - (panels - 1 - i) * 0.08;
    const track = i * 0.05 - 0.05;
    const panel = new THREE.Group();
    panel.name = `sliding_door:${element.id}:panel:${i}`;
    const metadata = { objectId: `sliding_door:${element.id}`, hoverable: true, type: 'sliding_door' };
    const pane = new THREE.Mesh(new THREE.BoxGeometry(paneWidth, paneHeight, 0.008), glass);
    pane.userData = metadata;
    pane.name = `sliding_door:${element.id}:pane:${i}`;
    panel.add(pane);
    for (const ySign of [1, -1] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(outerWidth, frame, depth), frameMaterial);
      bar.position.y = ySign * (element.height / 2 - frame / 2);
      bar.userData = metadata;
      bar.name = `sliding_door:${element.id}:bar:${i}:${ySign}`;
      panel.add(bar);
    }
    for (const xSign of [1, -1] as const) {
      const stile = new THREE.Mesh(new THREE.BoxGeometry(frame, paneHeight, depth), frameMaterial);
      stile.position.x = xSign * (outerWidth / 2 - frame / 2);
      stile.userData = metadata;
      stile.name = `sliding_door:${element.id}:stile:${i}:${xSign}`;
      panel.add(stile);
    }
    panel.position.set(a.x + (b.x - a.x) * (along / length) + nx * track, element.height / 2, a.z + (b.z - a.z) * (along / length) + nz * track);
    panel.rotation.y = angle;
    group.add(panel);
  }
  if (!existing) root.add(group);
  return group;
}

function addCurtain(root: THREE.Group, element: CurtainElement, rooms: ResolvedRoom[], provider: SceneMaterialProvider, index: SceneBuildIndex): void {
  if (element.points.length < 2) return;
  const materials = { ...defaultMaterials(), ...provider };
  const points = offsetCurtainPointsInterior(element.points, rooms, 0.12);
  const gathered = gatheredCurtainSegments(points);
  const height = element.height - 0.1;
  const create = (path: CurtainPoint[], layer: 'sheer' | 'blackout' | 'blinds', variant: 'deployed' | 'gathered', meshHeight = height, y = 0.05, segment: 'left' | 'right' | null = null) => {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(curtainShape(path, variant === 'gathered' ? 0.12 : 0.04), { depth: meshHeight, bevelEnabled: false, steps: 1 }), materials.curtain({ element, layer, variant }));
    mesh.rotation.x = -Math.PI / 2; mesh.scale.set(1, -1, 1); mesh.position.y = y;
    const objectId = `${element.id}:${layer}:${variant}${segment ? `:${segment}` : ''}`;
    setSceneObjectMetadata(mesh, 'curtain', objectId);
    mesh.userData = { ...mesh.userData, curtainId: element.id, roomId: element.room, layer, variant, segment, state: 'open' };
    root.add(mesh); return mesh;
  };
  const entry: CurtainBuildEntry = { id: element.id, roomId: element.room, kind: element.kind ?? 'sheer_blackout', variants: {} };
  if (entry.kind === 'sheer_blackout') entry.variants = { sheer: { deployed: create(points, 'sheer', 'deployed'), gathered: gathered.map((p, i) => create(p, 'sheer', 'gathered', height, 0.05, i === 0 ? 'left' : 'right')) }, blackout: { deployed: create(points, 'blackout', 'deployed'), gathered: gathered.map((p, i) => create(p, 'blackout', 'gathered', height, 0.05, i === 0 ? 'left' : 'right')) } };
  else { const gatheredHeight = Math.min(0.28, Math.max(0.16, height * 0.08)); entry.variants = { blinds: { deployed: create(points, 'blinds', 'deployed'), gathered: create(points, 'blinds', 'gathered', gatheredHeight, element.height - gatheredHeight) } }; }
  index.curtains.set(element.id, entry);
}

function addOverlayElement(root: THREE.Group, element: Exclude<SceneElement, { type: 'wall' }>, report: SceneBuildReport, rooms: ResolvedRoom[], provider: SceneMaterialProvider, index: SceneBuildIndex): void {
  const id = element.id;
  switch (element.type) {
    case 'floor_region': {
      if (element.points.length < 3) return;
      const material = new THREE.MeshStandardMaterial({
        color: DEFAULT_FLOOR,
        roughness: 0.75,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(element.points)), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = FLOOR_Y;
      mesh.receiveShadow = true;
      setSceneObjectMetadata(mesh, element.type, id);
      mesh.userData.roomId = element.room;
      mesh.userData.follow = element.follow;
      root.add(mesh);
      return;
    }
    case 'bay_sill': {
      if (element.points.length < 2) return;
      const geometry = element.wallRefs
        ? buildBaySillGeometry(element.wallRefs, rooms, element.depth)
        : { outline: element.points, segments: [] };
      const shape = new THREE.Shape();
      shape.moveTo(geometry.outline[0].x, geometry.outline[0].z);
      for (const point of geometry.outline.slice(1)) shape.lineTo(point.x, point.z);
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: element.height, bevelEnabled: false, steps: 1 }), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(1, -1, 1);
      mesh.position.y = element.sill;
      setSceneObjectMetadata(mesh, element.type, id);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      return;
    }
    case 'wall_run':
      addLineMeshes(root, element.points, element.height, WALL_THICKNESS, new THREE.MeshStandardMaterial({ color: DEFAULT_PAINT, roughness: 0.85 }), element.type, id);
      return;
    case 'curtain_run': {
      if (element.points.length < 2) return;
      const materials = { ...defaultMaterials(), ...provider };
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(curtainRibbonShape(element.points, element.closed ?? false), { depth: element.height, bevelEnabled: false, steps: 1 }), materials.curtainRun(element));
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(1, -1, 1);
      setSceneObjectMetadata(mesh, element.type, id);
      mesh.receiveShadow = true;
      root.add(mesh);
      return;
    }
    case 'shower_screen': {
      const materials = { ...defaultMaterials(), ...provider };
      addLineMeshes(root, element.points, element.height, 0.025, materials.showerScreen(element), element.type, id);
      return;
    }
    case 'railing_run': {
      const result = buildRailingGeometry(id, element.points, element.height);
      if (!result) return;
      root.add(result.group);
      return;
    }
    case 'sliding_door_run':
      addSlidingDoorRun(root, element, provider, undefined);
      return;
    case 'glass_infill': {
      const points = (element as Extract<SceneElement, { type: 'glass_infill' }> & { points?: Point[] }).points;
      if (!points || points.length < 2) {
        report.unsupported.push(`${id}: glass_infill has no resolved wall points`);
        return;
      }
      addLineMeshes(root, points, element.height, 0.025, glassMaterial(), element.type, id);
      return;
    }
    case 'curtain':
      addCurtain(root, element, rooms, provider, index);
      return;
    default: {
      const exhaustive: never = element;
      report.unsupported.push(`${id}: unsupported element ${(exhaustive as { type: string }).type}`);
    }
  }
}

function buildFurniture(item: FurnishingsYaml[string][number]): THREE.Group | null {
  if (item.type === 'kitchen_cabinet_run' && item.length !== undefined && item.depth !== undefined) {
    return buildKitchenCabinetRun({ length: item.length, depth: item.depth, cabinetHeight: item.cabinetHeight, countertopThickness: item.countertopThickness, cutouts: item.cutouts });
  }
  if (item.type === 'kitchen_countertop_bridge' && item.length !== undefined && item.depth !== undefined && item.countertopThickness !== undefined) {
    return buildKitchenCountertopBridge({ length: item.length, depth: item.depth, countertopThickness: item.countertopThickness });
  }
  if (item.type === 'bath_side_cabinet' && item.length !== undefined && item.depth !== undefined) {
    return buildBathSideCabinetRun({ length: item.length, depth: item.depth, cabinetHeight: item.cabinetHeight });
  }
  if (item.type === 'wardrobe_180') return buildWardrobe180(item.cabinetHeight);
  if (item.type === 'wardrobe_240_split') return buildWardrobeSplit();
  return buildFixture(item.type);
}

function addCeilingZones(root: THREE.Group, zones: CeilingZoneSpec[], rooms: ResolvedRoom[], report: SceneBuildReport): void {
  for (const zone of zones) {
    const group = buildCeilingZone(zone, rooms.find((room) => room.id === zone.room)?.height ?? 2.8);
    if (!group) continue;
    const objectId = `ceiling:${zone.id}`;
    setSceneObjectMetadata(group, 'ceiling_zone', objectId);
    let meshIndex = 0;
    group.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const part = typeof object.userData.part === 'string' ? object.userData.part : 'part';
      setSceneObjectMetadata(object, 'ceiling_zone_solid', objectId, `${objectId}:${part}:${meshIndex}`);
      object.userData.roomId = zone.room;
      meshIndex++;
    });
    root.add(group);
    report.ceilingZones++;
  }
}

function addPlatform(root: THREE.Group, platform: ScenePlatform): THREE.Mesh {
  const height = platform.height ?? 0.15;
  const points = platform.points ?? [];
  const hasRoundedCorners = points.some((point) => point.radius !== undefined);
  const geometry = hasRoundedCorners
    ? new THREE.ExtrudeGeometry(roundedShape(points), { depth: height, bevelEnabled: false })
    : new THREE.BoxGeometry(platform.width, height, platform.depth);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 }),
  );
  if (hasRoundedCorners) {
    mesh.rotation.x = -Math.PI / 2;
  } else {
    mesh.position.set(platform.x, height / 2, platform.z);
  }
  setSceneObjectMetadata(mesh, 'platform', 'platform_boundary');
  mesh.userData.roomId = platform.id;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function addHvacEntities(root: THREE.Group, projection: ProjectRenderFactsProjection | undefined, sources: HvacBuilderSources | undefined): HvacEntityIndex {
  return buildHvacGeometry(root, projection, sources).index;
}

function addFurniture(root: THREE.Group, furnishings: FurnishingsYaml, report: SceneBuildReport): void {
  for (const [roomId, items] of Object.entries(furnishings)) {
    let index = 0;
    for (const item of items) {
      if (item.x === undefined || item.z === undefined) continue;
      const model = buildFurniture(item);
      if (!model) {
        report.skippedFurniture.push(`${roomId}:${item.type}`);
        continue;
      }
      const objectId = `furniture:${roomId}:${item.type}:${index}`;
      model.position.set(item.x, 0, item.z);
      model.rotation.y = THREE.MathUtils.degToRad(item.rotation ?? 0);
      setSceneObjectMetadata(model, 'furniture', objectId);
      model.traverse((child) => {
        if (child === model) return;
        child.name = `${objectId}:${child.name || 'part'}`;
      });
      root.add(model);
      report.furniture++;
      index++;
    }
  }
}

export function buildScene(input: SceneBuilderInput): SceneBuildResult {
  const report: SceneBuildReport = { rooms: 0, walls: 0, ceilings: 0, ceilingZones: 0, furniture: 0, plumbing: 0, lightingFixtures: 0, hvacEquipment: 0, hvacTerminals: 0, hvacStatus: input.options?.hvac?.projection?.hvac.status ?? 'unimplemented', skippedFurniture: [], skippedPlumbing: [], unsupported: [] };
  const provider = input.options?.materialProvider ?? {};
  const index = {
    rooms: Object.fromEntries(input.rooms.map((room) => [room.id, { ...room }])),
    floorMeshes: [], wallMeshes: [], ceilingMeshes: [], furnitureMeshes: [],
    countertopMeshes: [], glassMeshes: [], doorMeshes: [], curtainRuns: new Map(), curtains: new Map(), slidingDoorGroups: new Map(), plumbing: new Map(), lightingFixtures: new Map(), wallSegments: new Map(), openingWallSegments: new Map(), lintels: new Map(), hvac: { equipment: new Map(), terminals: new Map(), all: new Map() },
  } as SceneBuildIndex;
  const exportRoot = new THREE.Group();
  exportRoot.name = 'HOUSE_EXPORT';
  const viewOnlyRoot = new THREE.Group();
  viewOnlyRoot.name = 'HOUSE_VIEW_ONLY';
  for (const room of input.rooms) addRoomGeometry(exportRoot, room, report);
  if (input.platform) {
    addPlatform(viewOnlyRoot, input.platform);
    index.rooms[input.platform.id] = { ...input.platform };
  }
  const wallHeights = new Map(input.walls.map((wall) => [wall.id, wall.height ?? 3.0]));
  for (const element of input.elements) {
    if (element.type === 'wall') addWallElement(exportRoot, element, wallHeights.get(element.id) ?? 3.0, report, index, provider);
    else addOverlayElement(exportRoot, element, report, input.options?.curtainRooms ?? input.rooms, provider, index);
  }
  for (const wall of input.walls) {
    if (!wall.id) continue;
    index.wallSegments.set(wall.id, wall.segments?.length ? wall.segments.map((segment) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 })) : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }]);
  }
  const furnishings = input.furnishings ?? {};
  const placedFurnitureKeys = new Set(
    Object.entries(furnishings).flatMap(([roomId, items]) => items
      .filter((item) => item.x !== undefined && item.z !== undefined)
      .map((item) => `${roomId}:${item.type}`)),
  );
  // Plumbing points remain in the index/report contract, but a placed furnishing
  // owns the visible appliance/fixture geometry when the types overlap in a room.
  const plumbing = (input.plumbing ?? []).filter((point) => {
    const duplicate = (point.type === 'toilet' || point.type === 'washer')
      && placedFurnitureKeys.has(`${point.room}:${point.type}`);
    if (duplicate) report.skippedPlumbing.push(`${point.id}:furnishing:${point.room}:${point.type}`);
    return !duplicate;
  });
  const infrastructure = buildInfrastructure({ electrical: [], plumbing, wallSegments: index.wallSegments });
  for (const model of infrastructure.plumbing) {
    exportRoot.add(model);
    index.plumbing.set(String(model.userData.objectId), model);
  }
  report.plumbing = infrastructure.plumbing.length;
  addCeilingZones(exportRoot, input.ceilingZones ?? [], input.rooms, report);
  addFurniture(exportRoot, furnishings, report);
  if (input.lightingFixtures?.length) {
    const lighting = buildLightingFixtures(input.lightingFixtures, input.options?.lighting);
    exportRoot.add(lighting.group);
    report.lightingFixtures = lighting.fixtures.size;
    index.lightingFixtures = lighting.fixtures;
  }
  index.hvac = addHvacEntities(exportRoot, input.options?.hvac?.projection, input.options?.hvac?.sources);
  report.hvacEquipment = index.hvac.equipment.size;
  report.hvacTerminals = index.hvac.terminals.size;

  exportRoot.traverse((object) => {
    const type = object.userData.type;
    if (type === 'floor' || type === 'floor_region') index.floorMeshes.push(object as THREE.Mesh);
    if (type === 'wall' || type === 'wall_run') index.wallMeshes.push(object as THREE.Mesh);
    if (type === 'ceiling' || type === 'ceiling_zone_solid') index.ceilingMeshes.push(object as THREE.Mesh);
    if (type === 'furniture') {
      index.furnitureMeshes.push(object as THREE.Group);
      object.traverse((child) => { if (child.userData.surface === 'countertop') index.countertopMeshes.push(child as THREE.Mesh); });
    }
    if (type === 'curtain_run' || type === 'glass_infill' || type === 'shower_screen') {
      index.glassMeshes.push(object as THREE.Mesh);
      if (type === 'curtain_run') {
        const id = String(object.userData.objectId);
        const meshes = index.curtainRuns.get(id) ?? [];
        meshes.push(object);
        index.curtainRuns.set(id, meshes);
      }
    }
    if (type === 'sliding_door_run') index.slidingDoorGroups.set(String(object.userData.objectId), object as THREE.Group);
    if (type === 'door') index.doorMeshes.push(object as THREE.Mesh);
  });

  const scene = new THREE.Scene();
  scene.name = input.sceneName ?? 'house-cli-phase-2';
  scene.add(exportRoot, viewOnlyRoot);
  return { exportRoot, viewOnlyRoot, scene, report, index };
}

export function refreshSlidingDoorGroup(root: THREE.Group, group: THREE.Group, element: SlidingDoorElement, provider: SceneMaterialProvider = {}): THREE.Group | null {
  if (!group.parent) root.add(group);
  return addSlidingDoorRun(root, element, provider, group);
}

export type CliBuildReport = SceneBuildReport;
