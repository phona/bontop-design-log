import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import * as THREE from 'three';
import { ProjectCatalog } from '../../../server/project-catalog.js';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlay } from '../../../server/overlay-merge.js';
import { parseCeilingZones, parseElectricalPoints, parseLightingRenderConfig, parsePlumbingPoints, parseRenderLightingOverrides } from '../../../shared/project-render-facts-schema.js';
import { buildScene } from '../../../shared/render/SceneBuilder.js';
import { FURNITURE_DIMS, type FurnishingsYaml, type ElectricalPoint, type PlumbingPoint, type VertexLayoutYaml, type SceneElement, type ResolvedWall, type ResolvedRoom, type RenderLightingFixture } from '../../../shared/types.js';
import {
  makeSpatialReport,
  requiredClearance,
  type Aabb3,
  type GlassPathSegment,
  type JunctionSpec,
  type OverlayElementRef,
  type OverlayReplacement,
  type PlanSegment,
  type SpatialIssue,
  type SpatialToleranceProfile,
  type OverlayWallJunctionSpec,
  type RuntimeSpatialObject,
  type RuntimeGlassJoinSpec,
  validateGlassAgainstWalls,
  validateGlassSegments,
  validateOverlayReplacements,
  validateOverlayJunctionSpecs,
  deriveRuntimeGlassJoins,
  validateRelationshipSpecs,
  validateRuntimeScene,
  validateWallTopology,
  validateWallLampMount,
} from '../../../shared/spatial-validation.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const EPS = 0.001;
const GLASS_THICKNESS = 0.024;
const MEPS = new Set(['mb_vanity_pvc_box', 'mb_vanity_pvc_wardrobe_entry', 'mb_vanity_pvc_service_chase', 'condensate_pipe_ac_outlet']);
const LIGHT_TYPES = new Set(['wall_lamp', 'ceiling_light', 'pendant', 'dome', 'downlight', 'track_light', 'led_strip']);

interface SpatialConfig {
  version: number;
  tolerance_profiles?: Record<string, SpatialToleranceProfile>;
  furniture_profile_overrides?: Array<{
    types: string[];
    profile: string;
    wall?: string;
    wall_side?: string;
    required_wall_clearance?: number;
    required_endpoint_clearance?: number;
    site_trim?: boolean;
  }>;
  furniture_profiles?: Record<string, { role?: string }>;
  mep_coordination_types?: string[];
  relationships?: Array<{ id: string; type: string; objects?: string[]; inner?: string; outer?: string }>;
  junctions?: JunctionSpec[];
  allowed_collinear_overlaps?: Array<{ walls: string[]; max_overlap: number; reason?: string }>;
  allowed_overlay_wall_junctions?: OverlayWallJunctionSpec[];
  overlay_replacements?: OverlayReplacement[];
  lighting_host_overrides?: Array<{ id: string; wall: string; wall_side: string }>;
}

interface RawHouse {
  furnishings?: FurnishingsYaml;
}

interface BoxEntry {
  entity: string;
  type: string;
  room?: string;
  box: Aabb3;
  segment?: PlanSegment;
  wallId?: string;
  thickness?: number;
  elementId?: string;
  pathSegments?: GlassPathSegment[];
  partId?: string;
  collisionRole?: 'structural' | 'internal';
  hostWallId?: string;
  object?: THREE.Object3D;
}

interface ProfileOverride {
  profile: string;
  wall?: string;
  wall_side?: string;
  required_wall_clearance?: number;
  required_endpoint_clearance?: number;
  site_trim?: boolean;
}

function readYaml<T>(file: string): T {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8')) as T;
}

function toAabb(box: THREE.Box3): Aabb3 {
  return { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
}

function objectBox(object: THREE.Object3D): Aabb3 | null {
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(object);
  return box.isEmpty() ? null : toAabb(box);
}

function objectHasMesh(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => { if ((child as THREE.Mesh).isMesh) found = true; });
  return found;
}

function resolvedWallSegments(layout: ReturnType<typeof resolveLayout>): PlanSegment[] {
  return layout.walls.flatMap((wall) => {
    const source = wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    return source
      .filter((segment) => Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1) > EPS)
      .map((segment, index) => ({ ...segment, id: `${wall.id}:${index}`, wallId: wall.id }));
  });
}

function overlayRefs(element: SceneElement): OverlayElementRef {
  const value = element as SceneElement & { wall?: string; walls?: string[]; parts?: Array<{ id?: string; wall?: string; walls?: string[]; wallRefs?: string[] }> };
  return { id: value.id, type: value.type, wall: value.wall, walls: value.walls, parts: value.parts };
}

function elementWallRefs(element: SceneElement): string[] {
  const value = overlayRefs(element);
  const parts = value.parts ?? [];
  if (parts.length > 0) return parts.flatMap((part) => [...(part.wall ? [part.wall] : []), ...(part.walls ?? []), ...(part.wallRefs ?? [])]);
  return [...(value.wall ? [value.wall] : []), ...(value.walls ?? [])];
}

function pathSegmentsFromOverlay(elements: SceneElement[], layout: ReturnType<typeof resolveLayout>): GlassPathSegment[] {
  const result: GlassPathSegment[] = [];
  const wallMap = new Map(layout.walls.map((wall) => [wall.id, wall]));
  for (const element of elements) {
    if (element.type !== 'curtain_run' && element.type !== 'glass_infill' && element.type !== 'railing_run') continue;
    const value = element as SceneElement & { wall?: string; walls?: string[]; parts?: Array<{ id: string; wall?: string; walls?: string[]; wallRefs?: string[] }> };
    const parts = value.parts ?? [];
    const refs = parts.length > 0
      ? parts.flatMap((part) => (part.wallRefs?.length ? part.wallRefs : [...(part.wall ? [part.wall] : []), ...(part.walls ?? [])]).map((wallId) => ({ wallId, partId: part.id })))
      : [...(value.wall ? [value.wall] : []), ...(value.walls ?? [])].map((wallId) => ({ wallId, partId: undefined }));
    for (const [refIndex, ref] of refs.entries()) {
      const wallId = ref.wallId;
      const wall = wallMap.get(wallId);
      if (!wall) continue;
      const segments = wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
      for (const [index, segment] of segments.entries()) {
        if (Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1) <= EPS) continue;
        result.push({ ...segment, id: `${element.id}:${ref.partId ?? 'root'}:${refIndex}:${wallId}:${index}`, wallId, elementId: element.id, partId: ref.partId ?? 'root', refIndex });
      }
    }
  }
  return result;
}

function suppressionWallIds(overlay: ReturnType<typeof parseOverlay>, walls: ResolvedWall[] = []): string[] {
  const ids = overlay.suppress.flatMap((entry) => {
    if (entry.wall) return [entry.wall];
    if (entry.walls) return entry.walls;
    if (entry.region) {
      const minX = Math.min(entry.region.x1, entry.region.x2);
      const maxX = Math.max(entry.region.x1, entry.region.x2);
      const minZ = Math.min(entry.region.z1, entry.region.z2);
      const maxZ = Math.max(entry.region.z1, entry.region.z2);
      return walls.filter((wall) => {
        const mx = (wall.x1 + wall.x2) / 2;
        const mz = (wall.z1 + wall.z2) / 2;
        return mx >= minX && mx <= maxX && mz >= minZ && mz <= maxZ;
      }).map((wall) => wall.id);
    }
    return [];
  });
  return ids;
}

function segmentFromRuntimeMesh(object: THREE.Object3D, entity: string): { segment: PlanSegment; thickness: number } | undefined {
  const mesh = object as THREE.Mesh;
  const geometry = mesh.geometry;
  if (!geometry) return undefined;
  geometry.computeBoundingBox();
  const local = geometry.boundingBox;
  if (!local) return undefined;
  const length = local.max.x - local.min.x;
  const thickness = local.max.z - local.min.z;
  if (length <= EPS || thickness <= EPS) return undefined;
  object.updateWorldMatrix(true, false);
  const center = new THREE.Vector3();
  object.getWorldPosition(center);
  const worldRotation = new THREE.Euler().setFromQuaternion(object.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  const angle = worldRotation.y;
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  return {
    segment: { id: entity, wallId: entity.split(':')[0], x1: center.x - ux * length / 2, z1: center.z - uz * length / 2, x2: center.x + ux * length / 2, z2: center.z + uz * length / 2 },
    thickness,
  };
}

function wallBoxes(result: ReturnType<typeof buildScene>): BoxEntry[] {
  const entries: BoxEntry[] = [];
  for (const mesh of result.index.wallMeshes) {
    const box = objectBox(mesh);
    if (!box) continue;
    const entity = String(mesh.userData.objectId ?? mesh.name);
    const geometry = segmentFromRuntimeMesh(mesh, entity);
    entries.push({ entity, type: 'wall', wallId: entity.split(':')[0], room: mesh.userData.roomId as string | undefined, box, ...(geometry ? { segment: geometry.segment, thickness: geometry.thickness } : {}), object: mesh });
  }
  for (const [wallId, meshes] of result.index.lintels.entries()) for (const mesh of meshes) {
    const box = objectBox(mesh);
    if (!box) continue;
    const entity = String(mesh.userData.objectId ?? mesh.name);
    const geometry = segmentFromRuntimeMesh(mesh, entity);
    entries.push({ entity, type: 'lintel', wallId, room: mesh.userData.roomId as string | undefined, box, ...(geometry ? { segment: { ...geometry.segment, wallId } } : {}), ...(geometry ? { thickness: geometry.thickness } : {}), object: mesh });
  }
  return entries;
}

function distanceToPlanSegment(x: number, z: number, segment: PlanSegment): number {
  const dx = segment.x2 - segment.x1;
  const dz = segment.z2 - segment.z1;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return Math.hypot(x - segment.x1, z - segment.z1);
  const t = Math.max(0, Math.min(1, ((x - segment.x1) * dx + (z - segment.z1) * dz) / lengthSquared));
  return Math.hypot(x - (segment.x1 + t * dx), z - (segment.z1 + t * dz));
}

/** Runtime collision authority for curtain/glass/railing geometry. */
function runtimeGlassBoxes(result: ReturnType<typeof buildScene>, structuralPaths: GlassPathSegment[]): BoxEntry[] {
  const entries: BoxEntry[] = [];
  result.exportRoot.traverse((object) => {
    const type = String(object.userData.type ?? '');
    if (!(object as THREE.Mesh).isMesh || (type !== 'curtain_run' && type !== 'glass_infill' && type !== 'railing_run')) return;
    const box = objectBox(object);
    if (!box) return;
    const rawObjectId = String(object.userData.objectId ?? object.name);
    const elementId = String(object.userData.curtainId ?? rawObjectId).split(':')[0];
    const wallRefs = Array.isArray(object.userData.wallRefs) ? object.userData.wallRefs.map(String) : undefined;
    const partId = typeof object.userData.partId === 'string'
      ? object.userData.partId
      : typeof object.userData.part === 'string'
        ? object.userData.part
      : 'root';
    const collisionRole = type === 'railing_run' && /^(handrail|bar)(:|$)/u.test(partId)
      ? 'internal' as const
      : 'structural' as const;
    let pathSegments = structuralPaths.filter((segment) => segment.elementId === elementId && (!wallRefs || wallRefs.includes(segment.wallId)));
    if (wallRefs && partId !== 'root') pathSegments = pathSegments.filter((segment) => (segment.partId ?? 'root') === partId);
    // RailingGeometryBuilder emits many handrail/bar meshes for one structural
    // path and does not copy wallRefs onto every child. Bind each child to its
    // nearest concrete path so sibling meshes on one path share identity,
    // while a real overlap between two distinct paths remains observable.
    if (!wallRefs && type === 'railing_run' && pathSegments.length > 1) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const nearest = Math.min(...pathSegments.map((segment) => distanceToPlanSegment(cx, cz, segment)));
      pathSegments = pathSegments.filter((segment) => distanceToPlanSegment(cx, cz, segment) <= nearest + 0.005);
    }
    entries.push({
      entity: object.name || rawObjectId,
      type,
      elementId,
      partId,
      collisionRole,
      box,
      pathSegments,
      object,
    });
  });
  return entries;
}

function ceilingBoxes(result: ReturnType<typeof buildScene>): BoxEntry[] {
  const boxes: BoxEntry[] = [];
  result.exportRoot.traverse((object) => {
    if (object.userData.type !== 'ceiling_zone_solid') return;
    const box = objectBox(object);
    if (box) boxes.push({ entity: String(object.userData.objectId ?? object.name), type: 'ceiling', room: object.userData.roomId as string | undefined, box, object });
  });
  return boxes;
}

function profileFor(type: string, config: SpatialConfig): ProfileOverride {
  const override = config.furniture_profile_overrides?.find((entry) => entry.types.includes(type));
  if (override) return override;
  if (MEPS.has(type) || config.mep_coordination_types?.includes(type)) return { profile: 'mep_coordination' };
  if (type.includes('wardrobe') || type.includes('cabinet') || type.includes('dresser') || type.includes('countertop') || type === 'vanity' || type === 'kitchen_cabinet_run') return { profile: 'built_in_casework' };
  return { profile: 'freestanding' };
}

function declaredDims(item: Record<string, unknown>, type: string): { width: number; depth: number } | undefined {
  const width = typeof item.width === 'number' ? item.width : typeof item.length === 'number' ? item.length : undefined;
  const depth = typeof item.depth === 'number' ? item.depth : undefined;
  if (width !== undefined && depth !== undefined) return { width, depth };
  return FURNITURE_DIMS[type];
}

function furnitureEntries(result: ReturnType<typeof buildScene>): BoxEntry[] {
  return result.index.furnitureMeshes.flatMap((object) => {
    const box = objectBox(object);
    if (!box) return [];
    const entity = String(object.userData.objectId ?? object.name);
    const parts = entity.split(':');
    const room = object.userData.roomId as string | undefined ?? (parts[0] === 'furniture' ? parts[1] : undefined);
    const type = String(object.userData.furnishingType ?? (parts[0] === 'furniture' ? parts[2] : ''));
    return [{ entity, type, room, box, hostWallId: object.userData.wallId as string | undefined, object }];
  });
}

function placedFurnitureRuntimeIds(furnishings: FurnishingsYaml): string[] {
  const ids: string[] = [];
  for (const [roomId, items] of Object.entries(furnishings)) {
    let runtimeIndex = 0;
    for (const item of items) {
      const raw = item as unknown as Record<string, unknown>;
      const placed = raw.x !== undefined || raw.z !== undefined || raw.wall !== undefined || raw.along !== undefined;
      if (!placed) continue;
      ids.push(`furniture:${roomId}:${item.type}:${runtimeIndex}`);
      runtimeIndex++;
    }
  }
  return ids;
}

function hostWallClearance(box: Aabb3, wallEntries: BoxEntry[], side: string): number | undefined {
  const direction: Record<string, { x: number; z: number }> = {
    north: { x: 0, z: -1 },
    south: { x: 0, z: 1 },
    west: { x: -1, z: 0 },
    east: { x: 1, z: 0 },
  };
  const outward = direction[side];
  if (!outward) return undefined;
  const corners = [
    [box.minX, box.minZ], [box.minX, box.maxZ], [box.maxX, box.minZ], [box.maxX, box.maxZ],
  ];
  let best: number | undefined;
  for (const entry of wallEntries) {
    if (!entry.segment || entry.thickness === undefined) continue;
    const segment = entry.segment;
    const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
    if (length <= EPS) continue;
    const tx = (segment.x2 - segment.x1) / length;
    const tz = (segment.z2 - segment.z1) / length;
    const nx = -tz;
    const nz = tx;
    const wallMid = { x: (segment.x1 + segment.x2) / 2, z: (segment.z1 + segment.z2) / 2 };
    const sideSign = nx * outward.x + nz * outward.z >= 0 ? 1 : -1;
    const normalX = nx * sideSign;
    const normalZ = nz * sideSign;
    const tangentValues = corners.map(([x, z]) => (x - segment.x1) * tx + (z - segment.z1) * tz);
    if (Math.max(...tangentValues) < -EPS || Math.min(...tangentValues) > length + EPS) continue;
    const surface = entry.thickness / 2;
    const distances = corners.map(([x, z]) => (x - wallMid.x) * normalX + (z - wallMid.z) * normalZ);
    const clearance = Math.min(...distances) - surface;
    best = best === undefined ? clearance : Math.min(best, clearance);
  }
  return best;
}

function parseRenderFixtureHeights(): Map<string, number> {
  const overrides = parseRenderLightingOverrides(readFileSync(path.join(ROOT, 'config/render/overrides.yaml'), 'utf8'));
  return new Map(overrides.map((override) => [override.id, override.anchorY]));
}

function renderLightingFixtures(electrical: ElectricalPoint[]): RenderLightingFixture[] {
  const heights = parseRenderFixtureHeights();
  return electrical
    .filter((point) => LIGHT_TYPES.has(point.type))
    .map((point) => ({
      id: point.id,
      room: point.room,
      type: point.type,
      position: { x: point.x, y: heights.get(point.id) ?? point.height ?? 2.8, z: point.z },
      temperatureK: point.temp ?? 3000,
      enabled: true,
      ...(point.circuit ? { circuit: point.circuit } : {}),
      ...(point.heads !== undefined ? { heads: point.heads } : {}),
      ...(point.recessed !== undefined ? { recessed: point.recessed } : {}),
    }));
}

function expectedWallSideForRoom(wall: ResolvedWall, room: ResolvedRoom | undefined): string | undefined {
  if (!room) return undefined;
  const midpoint = { x: (wall.x1 + wall.x2) / 2, z: (wall.z1 + wall.z2) / 2 };
  const dx = Math.abs(wall.x2 - wall.x1);
  const dz = Math.abs(wall.z2 - wall.z1);
  if (dx >= dz) return room.z < midpoint.z ? 'north' : 'south';
  return room.x < midpoint.x ? 'west' : 'east';
}

function validateLighting(
  electrical: ElectricalPoint[],
  walls: ResolvedWall[],
  suppressed: Set<string>,
  ceilingZones: ReturnType<typeof parseCeilingZones>,
  rooms: ResolvedRoom[],
  hostOverrides: SpatialConfig['lighting_host_overrides'] = [],
  runtimeFixtures?: Map<string, THREE.Group>,
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const source = 'config/electrical.yaml';
  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  const hostOverrideById = new Map((hostOverrides ?? []).map((override) => [override.id, override]));
  const heights = parseRenderFixtureHeights();
  for (const point of electrical.filter((item) => LIGHT_TYPES.has(item.type))) {
    const runtime = runtimeFixtures?.get(`electrical:${point.id}`);
    if (runtimeFixtures && (!runtime || !objectHasMesh(runtime))) {
      issues.push({ level: 'error', code: 'lighting_runtime_missing', entity: point.id, source, message: `lighting point ${point.id} did not produce a real runtime fixture`, evidence: { object_id: `electrical:${point.id}`, type: point.type } });
    }
    if (point.type === 'wall_lamp') {
      const hostOverride = hostOverrideById.get(point.id);
      const hostWall = point.wall ?? hostOverride?.wall;
      const hostSide = point.wallSide ?? hostOverride?.wall_side;
      if (!hostWall || !hostSide) {
        issues.push({ level: 'error', code: 'lighting_mount_host_missing', entity: point.id, source, message: `wall lamp ${point.id} must declare wall and wall_side`, evidence: { type: point.type, wall: hostWall, wall_side: hostSide } });
        continue;
      }
      const wall = wallMap.get(hostWall);
      if (!wall) {
        issues.push({ level: 'error', code: 'lighting_mount_host_unknown', entity: point.id, source, message: `wall lamp ${point.id} references unknown wall ${hostWall}`, evidence: { wall: hostWall } });
        continue;
      }
      const expectedSide = expectedWallSideForRoom(wall, rooms.find((room) => room.id === point.room));
      if (expectedSide && expectedSide !== hostSide) {
        issues.push({ level: 'error', code: 'lighting_mount_wall_side_mismatch', entity: point.id, source, message: `wall lamp ${point.id} declares ${hostSide} but room ${point.room} is on the ${expectedSide} side of ${hostWall}`, evidence: { wall: hostWall, declared_wall_side: hostSide, expected_wall_side: expectedSide, room: point.room } });
      }
      issues.push(...validateWallLampMount({
        id: point.id,
        x: point.x,
        z: point.z,
        wall: { wallId: wall.id, x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 },
        wallId: wall.id,
        wallSide: hostSide,
        suppressed: suppressed.has(wall.id) || wall.structure === 'curtain',
      }, source));
      const dx = wall.x2 - wall.x1; const dz = wall.z2 - wall.z1; const lenSq = dx * dx + dz * dz;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / lenSq)) : 0;
      for (const opening of wall.openings ?? []) {
        const ot = lenSq > 0 ? ((opening.x - wall.x1) * dx + (opening.z - wall.z1) * dz) / lenSq : -Infinity;
        const along = Math.sqrt(lenSq) * ot;
        if (Math.abs(along - Math.sqrt(lenSq) * t) <= opening.width / 2 + 0.05 && (point.height ?? point.mount_height ?? 1.35) < (opening.sill ?? 0) + opening.height) {
          issues.push({ level: 'error', code: 'lighting_mount_in_opening', entity: point.id, source, message: `wall lamp ${point.id} falls in opening ${opening.id}`, evidence: { wall: wall.id, opening: opening.id, mount_height: point.height ?? point.mount_height } });
        }
      }
    } else {
      const room = rooms.find((candidate) => candidate.id === point.room);
      if (!room) {
        issues.push({ level: 'error', code: 'lighting_room_unknown', entity: point.id, source, message: `lighting point ${point.id} references unknown room ${point.room}`, evidence: { room: point.room } });
        continue;
      }
      const zone = ceilingZones.find((candidate) => candidate.room === point.room && candidate.area && point.x >= candidate.area[0] && point.x <= candidate.area[2] && point.z >= candidate.area[1] && point.z <= candidate.area[3]);
      const anchorY = heights.get(point.id) ?? point.height ?? room.height;
      const hostBottom = zone?.thickness !== undefined ? room.height - zone.thickness : room.height;
      if (runtime) {
        const runtimeBox = objectBox(runtime);
        if (runtimeBox && (runtimeBox.minY < -0.02 || runtimeBox.maxY > room.height + 0.02)) {
          issues.push({ level: 'error', code: 'lighting_runtime_vertical_collision', entity: point.id, source, message: `runtime ceiling fixture ${point.id} lies outside room vertical envelope`, evidence: { runtime_box: runtimeBox, room_height: room.height, room: room.id } });
        }
      }
      if (anchorY > room.height + 0.02 || anchorY < 0) {
        issues.push({ level: 'error', code: 'lighting_ceiling_host_invalid', entity: point.id, source, message: `ceiling fixture ${point.id} anchorY=${anchorY.toFixed(3)} is outside room vertical range`, evidence: { room: room.id, anchor_y: anchorY, ceiling_height: room.height } });
      } else if (zone && anchorY > hostBottom + 0.10) {
        issues.push({ level: 'warning', code: 'lighting_ceiling_host_clearance', entity: point.id, source, message: `ceiling fixture ${point.id} is below the declared ceiling zone bottom by ${(anchorY - hostBottom).toFixed(3)}m`, evidence: { zone: zone.id, anchor_y: anchorY, zone_bottom: hostBottom } });
      }
    }
  }
  return issues;
}

function validateScene(
  result: ReturnType<typeof buildScene>,
  furnishings: FurnishingsYaml,
  rooms: ResolvedRoom[],
  walls: ResolvedWall[],
  elements: SceneElement[],
  layout: ReturnType<typeof resolveLayout>,
  ceilingConfig: SpatialConfig,
): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const source = 'config/house.yaml + shared/render/SceneBuilder.ts + shared/render/FixtureFactory.ts';
  const wallEntries = wallBoxes(result);
  const structuralPaths = pathSegmentsFromOverlay(elements, layout);
  const glassEntries = runtimeGlassBoxes(result, structuralPaths);
  const ceilingEntries = ceilingBoxes(result);
  const furniture = furnitureEntries(result);
  const furnitureById = new Map(furniture.map((entry) => [entry.entity, entry]));
  const wallMap = new Map(walls.map((wall) => [wall.id, wall]));
  const runtimeGlassJoins: RuntimeGlassJoinSpec[] = deriveRuntimeGlassJoins(structuralPaths, ceilingConfig.overlay_replacements ?? []);
  issues.push(...validateRelationshipSpecs(ceilingConfig.relationships, furniture.map((entry) => entry.entity), 'config/spatial-validation.yaml'));

  // Runtime collision/cardinality is delegated to the shared pure validator so
  // injected tests and this CLI cannot drift into separate tolerances or
  // relationship semantics.
  issues.push(...validateRuntimeScene({
    furniture: furniture.map((entry): RuntimeSpatialObject => ({
      id: entry.entity,
      type: entry.type,
      ...(entry.room ? { room: entry.room } : {}),
      box: entry.box,
      ...(entry.hostWallId ? { hostWallId: entry.hostWallId } : {}),
    })),
    expectedFurnitureIds: placedFurnitureRuntimeIds(furnishings),
    expectedGlassElementIds: [...new Set(structuralPaths.map((path) => path.elementId))],
    walls: wallEntries.map((entry): RuntimeSpatialObject => ({
      id: entry.entity,
      type: entry.type,
      box: entry.box,
      ...(entry.wallId ? { wallId: entry.wallId } : {}),
      wallContactPolicy: 'centerline',
      ...(entry.segment ? { segment: entry.segment } : {}),
      ...(entry.thickness !== undefined ? { thickness: entry.thickness } : {}),
    })),
    glass: glassEntries.map((entry): RuntimeSpatialObject => ({
      id: entry.entity,
      type: entry.type,
      box: entry.box,
      ...(entry.elementId ? { elementId: entry.elementId } : {}),
      ...(entry.partId ? { partId: entry.partId } : {}),
      ...(entry.collisionRole ? { collisionRole: entry.collisionRole } : {}),
      ...(entry.pathSegments ? { pathSegments: entry.pathSegments } : {}),
    })),
    ceilings: ceilingEntries.map((entry): RuntimeSpatialObject => ({ id: entry.entity, type: entry.type, box: entry.box })),
    relationships: ceilingConfig.relationships,
    glassJoins: runtimeGlassJoins,
    mepTypes: ceilingConfig.mep_coordination_types,
    collisionMargin: ceilingConfig.tolerance_profiles?.default?.collision_margin ?? 0.005,
    glassRequiredClearance: requiredClearance(ceilingConfig.tolerance_profiles?.curtain_wall ?? {}),
    source,
  }));

  for (const [roomId, items] of Object.entries(furnishings)) {
    let runtimeIndex = 0;
    for (const [index, raw] of items.entries()) {
      const item = raw as unknown as Record<string, unknown>;
      const isPlaced = item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined;
      if (!isPlaced) continue;
      const type = String(item.type ?? '');
      const runtimeId = `furniture:${roomId}:${type}:${runtimeIndex}`;
      runtimeIndex++;
      const dims = declaredDims(item, type);
      if (!dims || dims.width <= 0 || dims.depth <= 0) {
        issues.push({ level: 'error', code: 'furniture_dimensions_missing', entity: `${roomId}/${type}[${index}]`, source, message: `placed furniture ${type} has no positive declared dimensions`, evidence: { room: roomId, type, item } });
        continue;
      }
      const entry = furnitureById.get(runtimeId);
      if (!entry) {
        continue;
      }
      if (!entry.object || !objectHasMesh(entry.object)) {
        issues.push({ level: 'error', code: 'furniture_child_mesh_missing', entity: entry.entity, source, message: `placed furniture ${type} has no real child mesh`, evidence: { room: roomId, type } });
      }
      // Room rectangles are semantic envelopes and may include shared/open
      // edges. Boundary crossing is checked against the authoritative wall
      // and glass solids below; an axis-aligned room-box test would reject
      // legitimate furniture at rounded/shared corners.
      const override = profileFor(type, ceilingConfig);
      const profile = ceilingConfig.tolerance_profiles?.[override.profile] ?? ceilingConfig.tolerance_profiles?.default ?? {};
      if (override.wall && override.wall_side) {
        const wall = wallMap.get(override.wall);
        if (!wall) {
          issues.push({ level: 'error', code: 'furniture_host_unknown', entity: entry.entity, source, message: `furniture ${type} references unknown wall ${override.wall}`, evidence: { wall: override.wall } });
        } else {
          const hostEntries = wallEntries.filter((wallEntry) => wallEntry.wallId === override.wall && wallEntry.segment);
          const available = hostWallClearance(entry.box, hostEntries, override.wall_side);
          const required = override.required_wall_clearance ?? requiredClearance(profile);
          if (available === undefined) issues.push({ level: 'error', code: 'furniture_host_runtime_missing', entity: entry.entity, source, message: `furniture ${type} host wall ${wall.id} has no runtime wall segment to measure against`, evidence: { wall: wall.id, wall_side: override.wall_side, host_entries: hostEntries.map((item) => item.entity) } });
          else if (available < -EPS) issues.push({ level: 'error', code: 'furniture_wall_collision', entity: entry.entity, source, message: `furniture ${type} enters host wall ${wall.id} by ${(-available).toFixed(3)}m`, evidence: { wall: wall.id, wall_side: override.wall_side, available_clearance_m: available, required_clearance_m: required, box: entry.box } });
          else if (available < required - EPS) issues.push({ level: 'error', code: 'furniture_clearance_insufficient', entity: entry.entity, source, message: `furniture ${type} has ${available.toFixed(3)}m host clearance; ${required.toFixed(3)}m is required`, evidence: { wall: wall.id, wall_side: override.wall_side, available_clearance_m: available, required_clearance_m: required, site_trim: override.site_trim === true } });
        }
      }
      if (override.required_endpoint_clearance !== undefined && type.startsWith('mb_vanity')) {
        const boundary = 2.92;
        const available = entry.box.minZ - boundary;
        if (available < override.required_endpoint_clearance - EPS) issues.push({ level: 'error', code: 'furniture_endpoint_clearance_insufficient', entity: entry.entity, source, message: `furniture ${type} north end has ${available.toFixed(3)}m clearance; ${override.required_endpoint_clearance.toFixed(3)}m is required`, evidence: { boundary_z: boundary, available_clearance_m: available, required_clearance_m: override.required_endpoint_clearance, site_trim: override.site_trim === true } });
      }
    }
  }

  if (result.report.skippedFurniture.length > 0) for (const item of result.report.skippedFurniture) issues.push({ level: 'error', code: 'furniture_runtime_skipped', entity: item, source, message: `SceneBuilder skipped a placed furniture fixture`, evidence: { item } });
  if (result.report.unsupported.length > 0) for (const item of result.report.unsupported) issues.push({ level: 'error', code: 'scene_runtime_unsupported', entity: item, source, message: `SceneBuilder reported unsupported runtime geometry`, evidence: { item } });
  return issues;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const layoutRaw = readYaml<VertexLayoutYaml>('config/layout/model-geometry.yaml');
  const layoutWarnings: string[] = [];
  const warn = console.warn;
  if (args.has('--json')) console.warn = (...values: unknown[]) => layoutWarnings.push(values.map((value) => String(value)).join(' '));
  let layout: ReturnType<typeof resolveLayout>;
  try {
    layout = resolveLayout(layoutRaw);
  } finally {
    console.warn = warn;
  }
  const overlay = parseOverlay(readFileSync(path.join(ROOT, 'config/layout/overlay.yaml'), 'utf8'));
  const config = readYaml<SpatialConfig>('config/spatial-validation.yaml');
  const house = readYaml<RawHouse>('config/house.yaml');
  const ceiling = parseCeilingZones(readFileSync(path.join(ROOT, 'config/ceiling.yaml'), 'utf8'));
  const electrical = parseElectricalPoints(readFileSync(path.join(ROOT, 'config/electrical.yaml'), 'utf8'));
  const plumbing = parsePlumbingPoints(readFileSync(path.join(ROOT, 'config/plumbing.yaml'), 'utf8'));
  const lighting = parseLightingRenderConfig(readFileSync(path.join(ROOT, 'config/render/lighting.yaml'), 'utf8'));
  const elements = mergeSceneElements(layout.walls, overlay);
  const suppressIds = suppressionWallIds(overlay, layout.walls);
  const issues: SpatialIssue[] = [];
  if (overlay.suppress.some((entry) => entry.region && suppressionWallIds({ ...overlay, suppress: [entry] }, layout.walls).length === 0)) {
    issues.push({ level: 'error', code: 'overlay_suppress_region_unmatched', entity: 'overlay.suppress', source: 'config/layout/overlay.yaml', message: 'a suppress region matches no authoritative wall', evidence: {} });
  }

  issues.push(...validateWallTopology(resolvedWallSegments(layout), { junctions: config.junctions, allowedCollinearOverlaps: config.allowed_collinear_overlaps, source: 'config/layout/model-geometry.yaml' }));
  issues.push(...validateOverlayReplacements(suppressIds, elements.map(overlayRefs), config.overlay_replacements ?? [], 'config/layout/overlay.yaml', layout.walls.map((wall) => wall.id)));
  const structuralPaths = pathSegmentsFromOverlay(elements, layout);
  issues.push(...validateGlassSegments(structuralPaths));
  issues.push(...validateOverlayJunctionSpecs(config.allowed_overlay_wall_junctions ?? [], structuralPaths, resolvedWallSegments(layout)));
  issues.push(...validateGlassAgainstWalls(structuralPaths, resolvedWallSegments(layout), suppressIds, 'config/layout/model-geometry.yaml + config/layout/overlay.yaml', config.allowed_overlay_wall_junctions));

  let scene: ReturnType<typeof buildScene>;
  try {
    scene = buildScene({ rooms: layout.rooms, platform: layout.platform, walls: layout.walls, elements, ceilingZones: ceiling, furnishings: house.furnishings, electrical, plumbing, lightingFixtures: renderLightingFixtures(electrical), options: { lighting } });
    issues.push(...validateLighting(electrical, layout.walls, new Set(suppressIds), ceiling, layout.rooms, config.lighting_host_overrides, scene.index.lightingFixtures));
    issues.push(...validateScene(scene, house.furnishings ?? {}, layout.rooms, layout.walls, elements, layout, config));
  } catch (error) {
    issues.push(...validateLighting(electrical, layout.walls, new Set(suppressIds), ceiling, layout.rooms, config.lighting_host_overrides));
    issues.push({ level: 'error', code: 'scene_build_failed', entity: 'HOUSE_EXPORT', source: 'shared/render/SceneBuilder.ts', message: error instanceof Error ? error.message : String(error), evidence: {} });
  }

  const report = makeSpatialReport(issues.sort((a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message)));
  const output = JSON.stringify({ version: 1, report, inputs: { rooms: layout.rooms.length, walls: layout.walls.length, suppressedWalls: [...new Set(suppressIds)].length, placedFurniture: Object.values(house.furnishings ?? {}).flat().filter((item) => item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined).length }, ...(layoutWarnings.length > 0 ? { runtimeWarnings: layoutWarnings } : {}) }, null, 2);
  if (args.has('--json')) console.log(output);
  else {
    console.log(`Spatial validation: ${report.counts.errors} error(s), ${report.counts.warnings} warning(s), ${report.counts.info} info`);
    for (const issue of report.issues) console.log(`${issue.level === 'error' ? '✗' : issue.level === 'warning' ? '⚠' : '·'} [${issue.code}] ${issue.entity}: ${issue.message}`);
  }
  if (args.has('--out')) {
    const outIndex = process.argv.indexOf('--out');
    const target = process.argv[outIndex + 1];
    if (!target || target.startsWith('--')) {
      console.error('verify:spatial --out requires a file path');
      process.exitCode = 2;
    } else {
      writeFileSync(path.resolve(ROOT, target), `${output}\n`);
    }
  }
  if (report.errors.length > 0) process.exitCode = 1;
}

main();
