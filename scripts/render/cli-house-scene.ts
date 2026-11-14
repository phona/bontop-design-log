/**
 * Node/CLI 侧的完整户型场景装配：从 config/*.yaml 读布局、overlay、点位、暖通与吊顶，
 * 交给 shared/render/SceneBuilder 构建，供 Node 下的测试与脚本在无浏览器环境复现页面场景。
 * （2026-11-10 issue #168 下线 GLB 导出：本文件原名 scripts/render/glb/cli-glb-builder.ts，
 * 因不只服务 GLB 导出而迁出 glb/ 目录；构建逻辑未改。）
 */
import { load as parseYaml } from 'js-yaml';
import { readFileSync } from 'node:fs';
import type { FurnishingsYaml, VertexLayoutYaml } from '../../shared/types.js';
import { parseElectricalPoints, parsePlumbingPoints, parseProjectHvacFacts, parseProjectRenderFactsProjection } from '../../shared/project-render-facts-schema.js';
import { expectedCurtainNodeIds } from './bundle/render-bundle-utils.js';
import { buildScene, type SceneBuildResult } from '../../shared/render/SceneBuilder.js';
import type { CeilingZone } from '../../shared/types.js';
import { buildHvacBuilderSources } from '../../shared/render/HvacBuilder.js';
import { buildPlacementIndexes } from '../../shared/placement-indexes.js';
import { parseSceneInput } from '../../shared/render/scene-input.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlayFiles } from '../../server/overlay-merge.js';
import { deriveMepPenetrationAt } from '../../shared/condensate-chain.js';
import { endpointSourcesFromFacts, parseMepCoordination } from '../../shared/mep-hvac-coordination-schema.js';

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
  ceilingPath = 'config/model/envelope/ceiling.yaml',
  renderFactsPath?: string,
): SceneBuildResult {
  const resolved = resolveLayout(readYaml<VertexLayoutYaml>(layoutPath));
  const house = readYaml<HouseYamlSubset>(housePath);
  const ceilingZones = readYaml<CeilingZone[]>(ceilingPath);
  const electrical = parseElectricalPoints(readFileSync('config/electrical.yaml', 'utf8'));
  const plumbing = parsePlumbingPoints(readFileSync('config/plumbing.yaml', 'utf8'));
  const projection = renderFactsPath
    ? parseProjectRenderFactsProjection(JSON.parse(readFileSync(renderFactsPath, 'utf8')))
    : undefined;
  // 主卫冷凝链锚点（issue #98 PR-10；第五阶段 S3 改派生）：内机锚点/候选接入点来自
  // config/hvac.yaml diagram，穿墙点由 MEP condensate-master 路线几何派生（S3 起该 at 已删，
  // 与 lint/takeoff 同一算法、同一端点解算源）。有没有 renderFactsPath 都读——Node 侧有文件
  // 系统访问权，链条家具不该因为少传一个参数就从场景里静默消失。
  const hvacFacts = parseProjectHvacFacts(readFileSync('config/hvac.yaml', 'utf8'));
  const hvacDiagram = hvacFacts.plans[0]?.diagram;
  // 点位宿主墙索引（issue #98 S3）+ 家具宿主索引（issue #98 S2 / 第五阶段 S1）：
  // 暖通 ref → 电气点位的坐标走单一解算器，两份索引与 MEP/DXF/verify 同一构造。
  const cliSceneIndexes = buildPlacementIndexes({ geometry: { walls: resolved.walls }, furnishings: house.furnishings ?? {} });
  const hvacSources = buildHvacBuilderSources({
    projection,
    // 吊顶分区源（codex 5088dc1b 前一轮 blocking 的回归）：不带 renderFactsPath 时 projection
    // 为空，缺 ceilingZones 则 indoor_master → ceiling/ac_master 解不出，冷凝链三件家具带诊断
    // 跳过，调用方却照样拿到不完整的场景。与端点派生同源（下面 endpointSourcesFromFacts 的
    // ceiling 也是它）。
    ceiling: ceilingZones,
    electrical,
    hvac: hvacFacts,
    pointWalls: cliSceneIndexes.pointWalls,
    mountHosts: cliSceneIndexes.mountHosts,
  });
  const condensatePenetration = deriveMepPenetrationAt(
    parseMepCoordination(readFileSync('config/mep-hvac-coordination.yaml', 'utf8')).routes.find((route) => route.id === 'condensate-master'),
    'w_mbath_south',
    {
      sources: endpointSourcesFromFacts({ electrical, plumbing, ceiling: ceilingZones, hvac: hvacFacts }),
      walls: resolved.walls,
    },
  ).point;
  const rawWalls = resolved.walls;
  const elements = mergeSceneElements(rawWalls, parseOverlayFiles());
  const input = parseSceneInput({
    rooms: resolved.rooms,
    platform: resolved.platform,
    walls: rawWalls,
    elements,
    ceilingZones,
    furnishings: house.furnishings ?? {},
    electrical,
    plumbing,
  });
  const result = buildScene({
    ...input,
    ...(projection ? { lightingFixtures: projection.lightingFixtures } : {}),
    options: {
      hvac: { projection, diagram: hvacDiagram, sources: hvacSources },
      ...(condensatePenetration ? { condensatePenetration } : {}),
      ...(projection?.lighting ? { lighting: projection.lighting } : {}),
    },
  });
  if (projection) filterCliCurtains(result.exportRoot, new Set(expectedCurtainNodeIds(projection.presentation.curtains)));
  return result;
}
