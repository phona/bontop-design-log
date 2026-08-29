import type {
  CurrentScheme,
  CurtainPresentationState,
  ElectricalPoint,
  ProjectRenderFacts,
  ProjectRenderFactsProjection,
  RenderLightingOverride,
  LightingRenderConfig,
} from './types.js';
import { buildCurtainRenderProjection, type CurtainOverlayLike } from './curtain-projection.js';
import { getTrackLightConfig, resolveTrackLightHeads } from './render/TrackLightLayout.js';

const LIGHT_TYPES = new Set<ElectricalPoint['type']>([
  'ceiling_light',
  'pendant',
  'dome',
  'wall_lamp',
  'downlight',
  'led_strip',
  'track_light',
]);

function renderCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

export function buildProjectRenderFactsProjection(
  facts: ProjectRenderFacts,
  overrides: RenderLightingOverride[],
  scheme: CurrentScheme,
  overlay: CurtainOverlayLike,
  presentation: CurtainPresentationState,
  lighting: LightingRenderConfig = { fixtures: [] },
): ProjectRenderFactsProjection {
  const fixtures = facts.electrical.filter((point) => LIGHT_TYPES.has(point.type));
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  const overrideById = new Map<string, RenderLightingOverride>();

  for (const override of overrides) {
    if (!fixtureIds.has(override.id)) {
      const point = facts.electrical.find((candidate) => candidate.id === override.id);
      throw new Error(point
        ? `Render override ${override.id} does not reference a lighting fixture`
        : `Render override ${override.id} references an unknown electrical id`);
    }
    if (overrideById.has(override.id)) {
      throw new Error(`Duplicate render override for lighting fixture ${override.id}`);
    }
    overrideById.set(override.id, override);
  }

  const lightingFixtures = fixtures.map((fixture) => {
    const override = overrideById.get(fixture.id);
    if (!override) throw new Error(`Missing render override for lighting fixture ${fixture.id}`);
    return {
      id: fixture.id,
      room: fixture.room,
      type: fixture.type,
      position: {
        x: renderCoordinate(fixture.x + (override.offsetX ?? 0)),
        y: renderCoordinate(override.anchorY),
        z: renderCoordinate(fixture.z + (override.offsetZ ?? 0)),
      },
      temperatureK: fixture.temp ?? 3000,
      enabled: true,
      ...(fixture.circuit !== undefined ? { circuit: fixture.circuit } : {}),
      ...(fixture.heads !== undefined ? { heads: fixture.heads } : {}),
      ...(fixture.recessed !== undefined ? { recessed: fixture.recessed } : {}),
    };
  });

  if (lightingFixtures.length !== fixtures.length) {
    throw new Error(`Render fixture count mismatch: expected ${fixtures.length}, got ${lightingFixtures.length}`);
  }

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
