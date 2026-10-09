import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import type { resolveLayout } from '../../../server/layout-resolver.js';
import { parseOverlay } from '../../../server/overlay-merge.js';
import type { parseCeilingZones } from '../../../shared/project-render-facts-schema.js';
import { FURNITURE_DIMS, type FurnishingsYaml, type ElectricalPoint, type SceneElement, type ResolvedWall, type ResolvedRoom } from '../../../shared/types.js';
import {
  deriveRuntimeGlassJoins,
  makeSpatialReport,
  requiredClearance,
  validateGlassAgainstWalls,
  validateGlassSegments,
  validateOverlayJunctionSpecs,
  validateOverlayReplacements,
  validateRelationshipSpecs,
  validateRuntimeAuthority,
  validateWallLampMount,
  validateWallTopology,
  type Aabb3,
  type GlassPathSegment,
  type JunctionSpec,
  type OverlayElementRef,
  type OverlayReplacement,
  type OverlayWallJunctionSpec,
  type PlanSegment,
  type RuntimeGlassJoinSpec,
  type SpatialIssue,
} from '../../../shared/spatial-validation.js';
import {
  buildRuntimeScene,
  collectPenetrationObjects,
  loadSceneInputs,
  EPS,
  objectBox,
  objectHasMesh,
  overlayRefs,
  parseRenderFixtureHeights,
  pathSegmentsFromOverlay,
  suppressionWallIds,
  type SceneInputs,
  type SpatialConfig,
} from '../../../shared/penetration/scene.js';
import { declaredDims, profileFor } from '../../../shared/penetration/clearance.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const LIGHT_TYPES = new Set(['wall_lamp', 'ceiling_light', 'pendant', 'dome', 'downlight', 'track_light', 'led_strip', 'night_light']);

function resolvedWallSegments(layout: ReturnType<typeof resolveLayout>): PlanSegment[] {
  return layout.walls.flatMap((wall) => {
    const source = wall.segments?.length ? wall.segments : [{ x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2 }];
    return source
      .filter((segment) => Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1) > EPS)
      .map((segment, index) => ({ ...segment, id: `${wall.id}:${index}`, wallId: wall.id }));
  });
}

/** Runtime collision authority for curtain/glass/railing geometry. */
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

function validateFurnitureFaceMounts(electrical: ElectricalPoint[], furnishings: FurnishingsYaml): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const source = 'config/electrical.yaml + config/house.yaml';
  const placed = new Map<string, { room: string; item: FurnishingsYaml[string][number]; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }>();

  for (const [room, items] of Object.entries(furnishings)) {
    let runtimeIndex = 0;
    for (const item of items) {
      const isPlaced = item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined;
      if (!isPlaced) continue;
      const id = `furniture:${room}:${item.type}:${runtimeIndex}`;
      runtimeIndex++;
      if (item.x === undefined || item.z === undefined) continue;
      const dimensions = FURNITURE_DIMS[item.type];
      if (!dimensions) continue;
      const radians = (item.rotation ?? 0) * Math.PI / 180;
      const widthX = Math.abs(Math.cos(radians)) * dimensions.width + Math.abs(Math.sin(radians)) * dimensions.depth;
      const depthZ = Math.abs(Math.sin(radians)) * dimensions.width + Math.abs(Math.cos(radians)) * dimensions.depth;
      placed.set(id, { room, item, bounds: {
        minX: item.x - widthX / 2,
        maxX: item.x + widthX / 2,
        minZ: item.z - depthZ / 2,
        maxZ: item.z + depthZ / 2,
      } });
    }
  }

  for (const point of electrical) {
    const anchor = point.mountAnchor;
    if (!anchor) continue;
    if (point.type !== 'night_light') {
      issues.push({ level: 'error', code: 'furniture_face_mount_wrong_type', entity: point.id, source, message: `furniture-face mount anchor is only supported for night_light, got ${point.type}`, evidence: { anchor } });
      continue;
    }
    const host = placed.get(anchor.furnitureId);
    if (!host) {
      issues.push({ level: 'error', code: 'furniture_face_mount_host_missing', entity: point.id, source, message: `night light ${point.id} references missing placed furniture ${anchor.furnitureId}`, evidence: { furniture_id: anchor.furnitureId } });
      continue;
    }
    const { minX, maxX, minZ, maxZ } = host.bounds;
    const axisClearance = 0.055;
    const faceDistance = anchor.face === 'north' ? Math.abs(point.z - minZ)
      : anchor.face === 'south' ? Math.abs(point.z - maxZ)
        : anchor.face === 'west' ? Math.abs(point.x - minX)
          : Math.abs(point.x - maxX);
    const withinFace = anchor.face === 'north' || anchor.face === 'south'
      ? point.x >= minX + axisClearance && point.x <= maxX - axisClearance
      : point.z >= minZ + axisClearance && point.z <= maxZ - axisClearance;
    if (faceDistance > 0.01 || !withinFace) {
      issues.push({ level: 'error', code: 'furniture_face_mount_outside_face', entity: point.id, source, message: `night light ${point.id} does not fit on ${anchor.face} face of ${anchor.furnitureId}`, evidence: { point: { x: point.x, z: point.z }, host_bounds: host.bounds, face: anchor.face, face_distance: faceDistance, axis_clearance: axisClearance } });
    }
    if (anchor.surfaceGap !== undefined && (anchor.surfaceGap < 0 || anchor.surfaceGap > 0.02)) {
      issues.push({ level: 'error', code: 'furniture_face_mount_gap_invalid', entity: point.id, source, message: `night light ${point.id} surface_gap must be between 0 and 0.02m`, evidence: { surface_gap: anchor.surfaceGap, furniture_id: anchor.furnitureId } });
    }
    if (host.room !== point.room) {
      issues.push({ level: 'warning', code: 'furniture_face_mount_room_mismatch', entity: point.id, source, message: `night light ${point.id} is assigned to ${point.room} but its furniture host is in ${host.room}`, evidence: { furniture_id: anchor.furnitureId, point_room: point.room, host_room: host.room } });
    }
  }
  return issues;
}

function validateScene(inputs: SceneInputs, scene: ReturnType<typeof buildRuntimeScene>): SpatialIssue[] {
  const issues: SpatialIssue[] = [];
  const source = 'config/house.yaml + shared/render/SceneBuilder.ts + shared/render/FixtureFactory.ts';
  const { layout, config, house } = inputs;
  const structuralPaths = inputs.structuralPaths;
  const collected = collectPenetrationObjects(scene, structuralPaths);
  const furnitureById = new Map(collected.furnitureEntries.map((entry) => [entry.entity, entry]));
  issues.push(...validateRelationshipSpecs(config.relationships, collected.furniture.map((entry) => entry.id), 'config/spatial-validation.yaml'));

  // 运行时权威性（声明 ↔ runtime 是否一一对应）留在本层。
  issues.push(...validateRuntimeAuthority({
    furniture: collected.furniture,
    expectedFurnitureIds: placedFurnitureRuntimeIds(house.furnishings ?? {}),
    expectedGlassElementIds: [...new Set(structuralPaths.map((path) => path.elementId))],
    glass: collected.glass,
    source,
  }));

  for (const [roomId, items] of Object.entries(house.furnishings ?? {})) {
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
      const override = profileFor(type, config);
      if (!override) {
        // 配置注释声明的意图：未登记的 placed 类型 fail-closed。不猜测角色、不静默放过，
        // 也不因无法判定而跳过后续校验整条记录（该条记录作为一个真实问题上报）。
        // 该 code 的所有权在本 CLI（声明登记表体检）；穿透层因此不再重复判一遍。
        issues.push({ level: 'error', code: 'furniture_profile_unregistered', entity: entry.entity, source, message: `placed furniture type ${type} is not registered in furniture_profiles / mep_coordination_types`, evidence: { room: roomId, type } });
        continue;
      }
    }
  }

  if (scene.report.skippedFurniture.length > 0) for (const item of scene.report.skippedFurniture) issues.push({ level: 'error', code: 'furniture_runtime_skipped', entity: item, source, message: `SceneBuilder skipped a placed furniture fixture`, evidence: { item } });
  if (scene.report.unsupported.length > 0) for (const item of scene.report.unsupported) issues.push({ level: 'error', code: 'scene_runtime_unsupported', entity: item, source, message: `SceneBuilder reported unsupported runtime geometry`, evidence: { item } });
  return issues;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const inputs: SceneInputs = loadSceneInputs({ captureWarnings: args.has('--json') });
  const { layout, overlay, elements, config, house, suppressIds, structuralPaths, layoutWarnings } = inputs;
  const issues: SpatialIssue[] = [];
  if (overlay.suppress.some((entry) => entry.region && suppressionWallIds({ ...overlay, suppress: [entry] }, layout.walls).length === 0)) {
    issues.push({ level: 'error', code: 'overlay_suppress_region_unmatched', entity: 'overlay.suppress', source: 'config/layout/overlay.yaml', message: 'a suppress region matches no authoritative wall', evidence: {} });
  }

  issues.push(...validateWallTopology(resolvedWallSegments(layout), { junctions: config.junctions, allowedCollinearOverlaps: config.allowed_collinear_overlaps, source: 'config/layout/model-geometry.yaml' }));
  issues.push(...validateOverlayReplacements(suppressIds, elements.map(overlayRefs), config.overlay_replacements ?? [], 'config/layout/overlay.yaml', layout.walls.map((wall) => wall.id)));
  issues.push(...validateGlassSegments(structuralPaths));
  issues.push(...validateOverlayJunctionSpecs(config.allowed_overlay_wall_junctions ?? [], structuralPaths, resolvedWallSegments(layout)));
  issues.push(...validateGlassAgainstWalls(structuralPaths, resolvedWallSegments(layout), suppressIds, 'config/layout/model-geometry.yaml + config/layout/overlay.yaml', config.allowed_overlay_wall_junctions));

  let scene: ReturnType<typeof buildRuntimeScene>;
  try {
    scene = buildRuntimeScene(inputs);
    issues.push(...validateLighting(inputs.electrical, layout.walls, new Set(suppressIds), inputs.ceiling, layout.rooms, config.lighting_host_overrides, scene.index.lightingFixtures));
    issues.push(...validateFurnitureFaceMounts(inputs.electrical, house.furnishings ?? {}));
    issues.push(...validateScene(inputs, scene));
  } catch (error) {
    issues.push(...validateLighting(inputs.electrical, layout.walls, new Set(suppressIds), inputs.ceiling, layout.rooms, config.lighting_host_overrides));
    issues.push(...validateFurnitureFaceMounts(inputs.electrical, house.furnishings ?? {}));
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
