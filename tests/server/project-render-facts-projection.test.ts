import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectRenderFactsProjection } from '../../shared/project-render-facts-projection.js';
import { parseProjectHvacFacts, validateProjectHvacFacts } from '../../shared/project-render-facts-schema.js';
import type { CurrentScheme, ProjectRenderFacts, RenderLightingOverride } from '../../shared/types.js';

const facts: ProjectRenderFacts = {
  electrical: [
    { id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2, height: 2.8, temp: 4000 },
    { id: 'socket_1', room: 'living', type: 'socket', x: 3, z: 4 },
  ],
  plumbing: [{ id: 'faucet_1', room: 'kitchen', type: 'faucet', x: 3, z: 4 }],
  ceiling: [{ id: 'ceiling_1', room: 'living', type: 'drop' }],
  hvac: {
    plans: [{ id: 'A2', kind: 'vrf_ducted', outdoor: { id: 'outdoor_1', platform: 'platform', x: 1, z: 2, direction: 'south', width: 1, depth: 1, height: 1, model: 'VRF' }, diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] } }],
  },
};

const scheme: CurrentScheme = {
  updatedAt: '2026-08-23T00:00:00.000Z',
  selections: { floor: { default: 'floor_default', roomOverrides: { kitchen: 'floor_kitchen' } } },
};

function override(id = 'light_1'): RenderLightingOverride {
  return { id, anchorY: 2.55, offsetX: 0.15, reason: 'Audited render anchor.', applies_to: ['web', 'blender'] };
}

describe('buildProjectRenderFactsProjection', () => {
  it('projects only lighting fixtures without mutating construction facts', () => {
    const projection = buildProjectRenderFactsProjection(facts, [override()], scheme);

    assert.deepEqual(projection.lightingFixtures, [{
      id: 'light_1', room: 'living', type: 'dome',
      position: { x: 1.15, y: 2.55, z: 2 }, temperatureK: 4000, enabled: true,
    }]);
    assert.deepEqual(projection.plumbing, facts.plumbing);
    assert.deepEqual(projection.ceiling, facts.ceiling);
    assert.deepEqual(projection.hvac, { status: 'unimplemented', planId: null });
    assert.deepEqual(projection.materials.floor, scheme.selections.floor);
    assert.deepEqual(facts.electrical[0], { id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2, height: 2.8, temp: 4000 });
  });

  it('preserves concrete plumbing, ceiling, and three floor overrides in the render projection', () => {
    const concreteFacts: ProjectRenderFacts = {
      electrical: [{ id: 'light_1', room: 'living', type: 'dome', x: 1, z: 2 }],
      plumbing: [
        { id: 'faucet_mbath_vanity', room: 'master_bath', type: 'faucet', x: 2.6, z: 2.8 },
        { id: 'drain_kitchen_dishwasher', room: 'kitchen', type: 'drain', x: 9, z: 0.3 },
      ],
      ceiling: [
        { id: 'ceiling_kitchen', room: 'kitchen', type: 'aluminum_buckle', thickness: 0.15, area: [7.2, 0, 10.8, 4.3] },
      ],
      hvac: facts.hvac,
    };
    const concreteScheme: CurrentScheme = {
      updatedAt: '2026-08-23T00:00:00.000Z',
      selections: { floor: { default: 'floor_default', roomOverrides: {
        master_bath: 'floor_mb', guest_bath: 'floor_gb', balcony: 'floor_balcony',
      } } },
    };
    const projection = buildProjectRenderFactsProjection(concreteFacts, [override()], concreteScheme);
    assert.deepEqual(projection.plumbing, concreteFacts.plumbing);
    assert.deepEqual(projection.ceiling, concreteFacts.ceiling);
    assert.deepEqual(projection.materials.floor, concreteScheme.selections.floor);
  });

  it('projects A2 only and never leaks its diagram into historical options', () => {
    const a2 = buildProjectRenderFactsProjection(facts, [override()], { ...scheme, selections: { ...scheme.selections, hvac: { default: 'A2', roomOverrides: {} } } });
    assert.equal(a2.hvac.status, 'implemented');
    assert.equal(a2.hvac.status === 'implemented' && a2.hvac.planId, 'A2');
    const archived = buildProjectRenderFactsProjection(facts, [override()], { ...scheme, selections: { ...scheme.selections, hvac: { default: 'A1', roomOverrides: {} } } });
    assert.deepEqual(archived.hvac, { status: 'unimplemented', planId: 'A1' });
    assert.equal('diagram' in archived.hvac, false);
  });

  it('strictly validates neighbor reference constraints and constrained routes', () => {
    const yaml = `plans:
  - id: A2
    kind: vrf_ducted
    outdoor: { id: outdoor_1, platform: platform, x: 1, z: 2, direction: south, width: 1, depth: 1, height: 1, model: VRF }
    diagram:
      anchors: []
      terminals: []
      reference_constraints:
        - id: neighbor_beam
          status: inferred
          source: survey/neighbor_ys01_original_structure_2025-06.png
          uncertainty_m: 0.15
          not_for_construction: true
          range: { x1: 1, x2: 2, z1: 3, z2: 3.2 }
          reference_beam_bottom_y: 2.65
          risk: net height
          reason: neighbor reference
          survey_confirmation: measure own beam
      routes: []
`;
    const parsed = parseProjectHvacFacts(yaml);
    assert.equal(parsed.plans[0].diagram.reference_constraints[0].status, 'inferred');
    assert.throws(() => parseProjectHvacFacts(yaml.replace('status: inferred', 'status: confirmed')), /Invalid option/);
    assert.throws(() => parseProjectHvacFacts(yaml.replace('          survey_confirmation: measure own beam\n', '')), /survey_confirmation/);
    const constrained = structuredClone(parsed);
    constrained.plans[0].diagram.anchors.push({ id: 'a', status: 'inferred', system: 'refrigerant', position: { x: 1, y: 2, z: 3 }, reason: 'test' });
    constrained.plans[0].diagram.anchors.push({ id: 'b', status: 'inferred', system: 'refrigerant', position: { x: 2, y: 2, z: 3 }, reason: 'test' });
    constrained.plans[0].diagram.routes.push({ id: 'route', status: 'confirmed', system: 'refrigerant', from: 'a', to: 'b', constraint_refs: ['neighbor_beam'], reason: 'test' });
    assert.throws(() => validateProjectHvacFacts(constrained, facts), /cannot be confirmed/);
    constrained.plans[0].diagram.routes[0].status = 'inferred';
    constrained.plans[0].diagram.routes[0].constraint_refs = ['missing'];
    assert.throws(() => validateProjectHvacFacts(constrained, facts), /unknown constraint/);
  });

  it('rejects missing, unknown, non-lighting, and duplicate overrides', () => {
    assert.throws(() => buildProjectRenderFactsProjection(facts, [], scheme), /Missing render override/);
    assert.throws(() => buildProjectRenderFactsProjection(facts, [override('unknown')], scheme), /unknown electrical id/);
    assert.throws(() => buildProjectRenderFactsProjection(facts, [override('socket_1')], scheme), /does not reference a lighting fixture/);
    assert.throws(() => buildProjectRenderFactsProjection(facts, [override(), override()], scheme), /Duplicate render override/);
  });
});
