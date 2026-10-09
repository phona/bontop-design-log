import type {
  CurrentScheme,
  CurtainPresentationState,
  ProjectRenderFacts,
  ProjectRenderFactsProjection,
  RenderLightingOverride,
  LightingRenderConfig,
} from './types.js';
import { buildCurtainRenderProjection, type CurtainOverlayLike } from './curtain-projection.js';
import { getTrackLightConfig, resolveTrackLightHeads } from './render/TrackLightLayout.js';
import { buildRenderLightingFixtures, isLightingFixtureType } from './lighting-fixtures.js';


export function buildProjectRenderFactsProjection(
  facts: ProjectRenderFacts,
  overrides: RenderLightingOverride[],
  scheme: CurrentScheme,
  overlay: CurtainOverlayLike,
  presentation: CurtainPresentationState,
  lighting: LightingRenderConfig = { fixtures: [] },
): ProjectRenderFactsProjection {
  const fixtures = facts.electrical.filter((point) => isLightingFixtureType(point.type));
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  // 灯具派生（offset 平移 / anchorY_offset 锚点 / fail-closed / 宿主墙透传）只有一份实现，
  // 与 linter 的 runtime 场景共用 shared/lighting-fixtures.ts：渲染看到的灯与被校验的灯
  // 在定义上就是同一个点位。这里不再本地复制坐标或高度派生。
  const lightingFixtures = buildRenderLightingFixtures(facts.electrical, overrides);

  const floor = scheme.selections.floor ?? { default: null, roomOverrides: {} };
  const selectedHvacPlanId = scheme.selections.hvac?.default ?? null;
  const selectedHvacPlan = selectedHvacPlanId === 'A2'
    ? facts.hvac.plans.find((plan) => plan.id === 'A2')
    : undefined;
  const hvac = selectedHvacPlan
    ? { status: 'implemented' as const, planId: 'A2' as const, diagram: selectedHvacPlan.diagram }
    : { status: 'unimplemented' as const, planId: selectedHvacPlanId };
  const configuredIds = new Set(lighting.fixtures.map((fixture) => fixture.id));
  for (const fixture of lighting.fixtures) {
    if (!fixtureIds.has(fixture.id)) throw new Error(`Lighting config ${fixture.id} references unknown electrical id`);
    if (fixture.type !== facts.electrical.find((point) => point.id === fixture.id)?.type) throw new Error(`Lighting config ${fixture.id} type does not match electrical point`);
  }
  if (lighting.fixtures.length > 0) {
    for (const fixture of fixtures.filter((point) => point.type === 'track_light')) {
      if (!configuredIds.has(fixture.id)) throw new Error(`Missing detailed lighting config for track fixture ${fixture.id}`);
    }
  }
  const resolvedLighting = lighting.fixtures.map((config) => {
    if (config.type !== 'track_light') return config;
    const fixture = lightingFixtures.find((item) => item.id === config.id);
    if (!fixture) return config;
    return { ...config, resolvedHeads: resolveTrackLightHeads(fixture.position, getTrackLightConfig({ fixtures: [config] }, config.id)) };
  });
  const projectionLighting = resolvedLighting.length > 0 ? { fixtures: resolvedLighting } : undefined;
  return {
    version: '2.0',
    ...(projectionLighting ? { lighting: projectionLighting } : {}),
    lightingFixtures,
    plumbing: facts.plumbing,
    ceiling: facts.ceiling,
    hvac,
    materials: {
      floor: {
        default: floor.default,
        roomOverrides: { ...floor.roomOverrides },
      },
    },
    presentation: {
      curtains: buildCurtainRenderProjection(overlay, presentation),
    },
  };
}
