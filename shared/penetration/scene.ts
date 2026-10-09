import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import * as THREE from 'three';
import { resolveLayout } from '../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlay } from '../../server/overlay-merge.js';
import { parseCeilingZones, parseElectricalPoints, parseLightingRenderConfig, parsePlumbingPoints, parseRenderLightingOverrides } from '../../shared/project-render-facts-schema.js';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { type FurnishingsYaml, type ElectricalPoint, type PlumbingPoint, type VertexLayoutYaml, type SceneElement, type ResolvedWall, type ResolvedRoom, type RenderLightingFixture } from '../../shared/types.js';import type { Aabb3, GlassPathSegment, OverlayElementRef, PlanSegment, RuntimeSpatialObject } from '../spatial-validation.js';

/**
 * 场景采集层：把「权威配置 → runtime 场景 → 可判定实体」这一路收敛成**唯一实现**。
 *
 * `verify:spatial` 与 `verify:penetration` 都经过这里取场景，因此并联期的 parity
 * 由构造成立——两边不可能各自收集到不同的物体。几何坐标一律来自
 * `buildScene()` 的 runtime mesh，本模块不推导、不复制任何坐标。
 *
 * 代码自 `scripts/verify/spatial/verify-spatial.ts` 机械搬迁而来，只改位置与
 * import，不改判定逻辑与容差。
 */

export const EPS = 0.001;

export interface SpatialConfig {
  version: number;
  tolerance_profiles?: Record<string, import('../spatial-validation.js').SpatialToleranceProfile>;
  furniture_profile_overrides?: Array<{
    types: string[];
    profile: string;
    wall?: string;
    wall_side?: string;
    required_wall_clearance?: number;
    required_endpoint_clearance?: number;
    site_trim?: boolean;
  }>;
  furniture_profiles?: Record<string, { profile: string; role?: string; site_trim?: boolean }>;
  mep_coordination_types?: string[];
  relationships?: Array<{ id: string; type: string; objects?: string[]; inner?: string; outer?: string }>;
  junctions?: import('../spatial-validation.js').JunctionSpec[];
  allowed_collinear_overlaps?: Array<{ walls: string[]; max_overlap: number; reason?: string }>;
  allowed_overlay_wall_junctions?: import('../spatial-validation.js').OverlayWallJunctionSpec[];
  overlay_replacements?: import('../spatial-validation.js').OverlayReplacement[];
  lighting_host_overrides?: Array<{ id: string; wall: string; wall_side: string }>;
}

export interface RawHouse {
  furnishings?: FurnishingsYaml;
}

export interface BoxEntry {
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

const ROOT = path.resolve(import.meta.dirname, '../..');

function readYaml<T>(file: string): T {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8')) as T;
}

function toAabb(box: THREE.Box3): Aabb3 {
  return { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
}

export function objectBox(object: THREE.Object3D): Aabb3 | null {
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(object);
  return box.isEmpty() ? null : toAabb(box);
}

export function objectHasMesh(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => { if ((child as THREE.Mesh).isMesh) found = true; });
  return found;
}

export function overlayRefs(element: SceneElement): OverlayElementRef {
  const value = element as SceneElement & { wall?: string; walls?: string[]; parts?: Array<{ id?: string; wall?: string; walls?: string[]; wallRefs?: string[] }> };
  return { id: value.id, type: value.type, wall: value.wall, walls: value.walls, parts: value.parts };
}

function elementWallRefs(element: SceneElement): string[] {
  const value = overlayRefs(element);
  const parts = value.parts ?? [];
  if (parts.length > 0) return parts.flatMap((part) => [...(part.wall ? [part.wall] : []), ...(part.walls ?? []), ...(part.wallRefs ?? [])]);
  return [...(value.wall ? [value.wall] : []), ...(value.walls ?? [])];
}

export function pathSegmentsFromOverlay(elements: SceneElement[], layout: ReturnType<typeof resolveLayout>): GlassPathSegment[] {
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

export function suppressionWallIds(overlay: ReturnType<typeof parseOverlay>, walls: ResolvedWall[] = []): string[] {
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

export function parseRenderFixtureHeights(): Map<string, number> {
  const overrides = parseRenderLightingOverrides(readFileSync(path.join(ROOT, 'config/render/overrides.yaml'), 'utf8'));
  const electrical = new Map<string, number>();
  for (const point of parseElectricalPoints(readFileSync(path.join(ROOT, 'config/electrical.yaml'), 'utf8'))) {
    if (point.height !== undefined) electrical.set(point.id, point.height);
  }
  // 渲染锚点 = electrical.height（施工安装完成面，唯一事实源）+ anchorY_offset。
  // overrides.yaml 只存相对偏移，因此这里必须回查电气源，与投影派生处保持同一算法。
  const heights = new Map<string, number>();
  for (const override of overrides) {
    const base = electrical.get(override.id);
    if (base === undefined) continue;
    heights.set(override.id, base + override.anchorY_offset);
  }
  return heights;
}

export function renderLightingFixtures(electrical: ElectricalPoint[]): RenderLightingFixture[] {
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
      // 宿主墙与侧向必须随点位一起进 runtime，口径与权威投影
      // shared/project-render-facts-projection.ts 逐字一致；漏传会让靠 wall/wall_side
      // 声明的起夜灯在 FixtureFactory 抛错，整场 buildScene 失败（scene_build_failed）。
      ...(point.wall !== undefined ? { wallId: point.wall } : {}),
      ...(point.wallSide !== undefined ? { wallSide: point.wallSide } : {}),
      ...(point.mountAnchor !== undefined ? { mountAnchor: point.mountAnchor } : {}),
    }));
}

const LIGHT_TYPES = new Set(['wall_lamp', 'ceiling_light', 'pendant', 'dome', 'downlight', 'track_light', 'led_strip', 'night_light']);

export interface SceneInputs {
  layout: ReturnType<typeof resolveLayout>;
  overlay: ReturnType<typeof parseOverlay>;
  elements: SceneElement[];
  config: SpatialConfig;
  house: RawHouse;
  ceiling: ReturnType<typeof parseCeilingZones>;
  electrical: ElectricalPoint[];
  plumbing: PlumbingPoint[];
  lighting: ReturnType<typeof parseLightingRenderConfig>;
  suppressIds: string[];
  structuralPaths: GlassPathSegment[];
  /** 房间绕向自动纠正等 layout 期 warning，原样透传给 CLI 报告。 */
  layoutWarnings: string[];
}

export interface LoadSceneOptions {
  /** 是否截获 layout 期 console.warn（房间绕向自动纠正等）进 layoutWarnings；默认 true。 */
  captureWarnings?: boolean;
}

/**
 * 读权威配置并解析布局。两个 CLI 共用，保证喂给规则的是同一份几何。
 * 这里不建 runtime 场景，也不吞异常：建场失败时由调用方决定出口
 * （verify:spatial 走降级分支继续跑声明层，verify:penetration fail-closed）。
 */
export function loadSceneInputs(options: LoadSceneOptions = {}): SceneInputs {
  const layoutRaw = readYaml<VertexLayoutYaml>('config/layout/model-geometry.yaml');
  const layoutWarnings: string[] = [];
  const warn = console.warn;
  if (options.captureWarnings !== false) console.warn = (...values: unknown[]) => layoutWarnings.push(values.map((value) => String(value)).join(' '));
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
  const structuralPaths = pathSegmentsFromOverlay(elements, layout);
  return { layout, overlay, elements, config, house, ceiling, electrical, plumbing, lighting, suppressIds, structuralPaths, layoutWarnings };
}

/** 构建 runtime 场景。抛错即调用方出口，这里不吞。 */
export function buildRuntimeScene(inputs: SceneInputs): ReturnType<typeof buildScene> {
  return buildScene({
    rooms: inputs.layout.rooms,
    platform: inputs.layout.platform,
    walls: inputs.layout.walls,
    elements: inputs.elements,
    ceilingZones: inputs.ceiling,
    furnishings: inputs.house.furnishings,
    electrical: inputs.electrical,
    plumbing: inputs.plumbing,
    lightingFixtures: renderLightingFixtures(inputs.electrical),
    options: { lighting: inputs.lighting },
  });
}

export interface PenetrationObjects {
  /** 含 mep 协调构件；规则层按 mepTypes 决定它们参与哪些对。 */
  furniture: RuntimeSpatialObject[];
  walls: RuntimeSpatialObject[];
  glass: RuntimeSpatialObject[];
  ceilings: RuntimeSpatialObject[];
  /** 带 segment/thickness 的墙条目，净距规则直接用。 */
  wallEntries: BoxEntry[];
  /** 家具 runtime 条目（含 object 引用，供 mesh 存在性检查）。 */
  furnitureEntries: BoxEntry[];
}

/** 把 runtime 场景翻译成规则层可判定的实体集合。 */
export function collectPenetrationObjects(result: ReturnType<typeof buildScene>, structuralPaths: GlassPathSegment[]): PenetrationObjects {
  const wallEntries = wallBoxes(result);
  const glassEntries = runtimeGlassBoxes(result, structuralPaths);
  const ceilingEntries = ceilingBoxes(result);
  const furniture = furnitureEntries(result);
  return {
    furniture: furniture.map((entry): RuntimeSpatialObject => ({
      id: entry.entity,
      type: entry.type,
      ...(entry.room ? { room: entry.room } : {}),
      box: entry.box,
      ...(entry.hostWallId ? { hostWallId: entry.hostWallId } : {}),
    })),
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
    wallEntries,
    furnitureEntries: furniture,
  };
}
