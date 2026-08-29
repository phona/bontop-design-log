import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../../shared/types.js';
import { parseElectricalPoints, parsePlumbingPoints, parseProjectHvacFacts, parseProjectRenderFactsProjection } from '../../../shared/project-render-facts-schema.js';
import { expectedCurtainNodeIds } from '../bundle/render-bundle-utils.js';
import { buildScene, type SceneBuildResult } from '../../../shared/render/SceneBuilder.js';
import type { CeilingZone } from '../../../shared/types.js';
import { buildHvacBuilderSources } from '../../../shared/render/HvacBuilder.js';
import { parseSceneInput } from '../../../shared/render/scene-input.js';
import { resolveLayout } from '../../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlay } from '../../../server/overlay-merge.js';

interface HouseYamlSubset {
  furnishings?: FurnishingsYaml;
}

function readYaml<T>(path: string): T {
  return parseYaml(readFileSync(path, 'utf8')) as T;
}

function filterCliCurtains(exportRoot: SceneBuildResult['exportRoot'], expectedNodeIds: Set<string>): void {
  const curtainNodes: Array<{ node: import('three').Object3D; objectId: string }> = [];
  exportRoot.traverse((node) => {
    if (node.userData.type !== 'curtain') return;
    curtainNodes.push({ node, objectId: String(node.userData.objectId) });
  });
  for (const { node, objectId } of curtainNodes) {
    if (!expectedNodeIds.has(objectId)) node.parent?.remove(node);
  }
}

export function buildCliHouseScene(
  layoutPath = 'config/layout/model-geometry.yaml',
  housePath = 'config/house.yaml',
  overlayPath = 'config/layout/overlay.yaml',
  ceilingPath = 'config/ceiling.yaml',
  renderFactsPath?: string,
): SceneBuildResult {
  const resolved = resolveLayout(readYaml<VertexLayoutYaml>(layoutPath));
  const house = readYaml<HouseYamlSubset>(housePath);
  const ceilingZones = readYaml<CeilingZone[]>(ceilingPath);
  const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8'));
  const projection = renderFactsPath
    ? parseProjectRenderFactsProjection(JSON.parse(readFileSync(renderFactsPath, 'utf8')))
    : undefined;
  const hvacFacts = projection ? parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8')) : undefined;
  const hvacSources = projection ? buildHvacBuilderSources({
    projection,
    electrical: parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8')),
    hvac: hvacFacts,
  }) : undefined;
  const rawWalls = resolved.walls;
  const elements = mergeSceneElements(rawWalls, parseOverlay(readFileSync(overlayPath, 'utf8')));
  const input = parseSceneInput({
    rooms: resolved.rooms,
    platform: resolved.platform,
    walls: rawWalls,
    elements,
    ceilingZones,
    furnishings: house.furnishings ?? {},
    plumbing,
  });
  const result = buildScene({
    ...input,
    ...(projection ? { lightingFixtures: projection.lightingFixtures } : {}),
    options: projection ? { hvac: { projection, sources: hvacSources }, ...(projection.lighting ? { lighting: projection.lighting } : {}) } : undefined,
  });
  if (projection) filterCliCurtains(result.exportRoot, new Set(expectedCurtainNodeIds(projection.presentation.curtains)));
  return result;
}

export function exportResultToUint8Array(result: ArrayBuffer | object): Uint8Array {
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  return new TextEncoder().encode(JSON.stringify(result));
}

export function uint8ArrayToBlob(data: Uint8Array, type = 'model/gltf-binary'): Blob {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}
