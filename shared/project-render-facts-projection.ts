import type {
  CurrentScheme,
  CurtainPresentationState,
  ElectricalPoint,
  ProjectRenderFacts,
  ProjectRenderFactsProjection,
  RenderLightingOverride,
} from './types.js';
import { buildCurtainRenderProjection, type CurtainOverlayLike } from './curtain-projection.js';

const LIGHT_TYPES = new Set<ElectricalPoint['type']>([
  'ceiling_light',
  'pendant',
  'dome',
  'wall_lamp',
  'downlight',
  'led_strip',
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
  return {
    version: '2.0',
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
