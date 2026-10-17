import { buildBaySillGeometry } from '../shared/render/BaySillGeometry.js';
import { buildRuntimeScene, collectPenetrationObjects, loadSceneInputs } from '../shared/penetration/scene.js';
import type { MepBaySillCollisionVolume, MepFurnitureCollisionVolume } from '../shared/mep-hvac-lint.js';
import type { ResolvedLayout } from '../shared/types.js';
import { mergeSceneElements, type OverlayConfig } from './overlay-merge.js';

/** Prepare collision volumes from the same merged bay_sill geometry rendered
 * by SceneBuilder. Suppression affects wall behavior, never sill solidity. */
export function buildMepBaySillCollisionVolumes(
  layout: ResolvedLayout | undefined,
  overlay: OverlayConfig | undefined,
): MepBaySillCollisionVolume[] {
  if (!layout || !overlay) return [];
  const volumes: MepBaySillCollisionVolume[] = [];
  for (const element of mergeSceneElements(layout.walls, overlay)) {
    if (element.type !== 'bay_sill') continue;
    const outline = element.wallRefs?.length
      ? buildBaySillGeometry(element.wallRefs, layout.rooms, element.depth).outline
      : element.points;
    if (outline.length < 3) continue;
    volumes.push({ id: element.id, outline, sill: element.sill, height: element.height });
  }
  return volumes;
}

let cachedFurnitureVolumes: MepFurnitureCollisionVolume[] | undefined;
const MEP_ROUTE_OBSTACLE_APPLIANCES = new Set(['fridge', 'washer', 'dryer', 'dishwasher', 'water_heater']);

/** Use the same runtime meshes as penetration validation; do not rederive furniture dimensions here. */
export function buildMepFurnitureCollisionVolumes(): MepFurnitureCollisionVolume[] {
  if (cachedFurnitureVolumes) return cachedFurnitureVolumes;
  const inputs = loadSceneInputs();
  const scene = buildRuntimeScene(inputs);
  const collected = collectPenetrationObjects(scene, inputs.structuralPaths);
  const excludedTypes = new Set(inputs.config.mep_coordination_types ?? []);
  cachedFurnitureVolumes = collected.furnitureEntries
    .filter((entry) => !excludedTypes.has(entry.type)
      && (inputs.config.furniture_profiles?.[entry.type]?.profile === 'built_in_casework' || MEP_ROUTE_OBSTACLE_APPLIANCES.has(entry.type)))
    .map((entry) => ({
      id: entry.entity,
      type: entry.type,
      ...(entry.room ? { room: entry.room } : {}),
      bounds: { ...entry.box },
    }));
  return cachedFurnitureVolumes;
}

export function invalidateMepFurnitureCollisionVolumes(): void {
  cachedFurnitureVolumes = undefined;
}
