import type {
  CurrentScheme,
  ElectricalPoint,
  ProjectRenderFacts,
  ProjectRenderFactsProjection,
  RenderLightingOverride,
} from './types.js';

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
  return {
    version: '1.0',
    lightingFixtures,
    plumbing: facts.plumbing,
    ceiling: facts.ceiling,
    materials: {
      floor: {
        default: floor.default,
        roomOverrides: { ...floor.roomOverrides },
      },
    },
  };
}
