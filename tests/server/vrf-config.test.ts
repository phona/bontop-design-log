import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  CeilingZonesSchema,
  ElectricalPointsSchema,
  ProjectHvacFactsSchema,
  validateProjectHvacFacts,
} from '../../shared/project-render-facts-schema.js';

const electrical = ElectricalPointsSchema.parse(parseYaml(readFileSync('config/electrical.yaml', 'utf8')));
const ceiling = CeilingZonesSchema.parse(parseYaml(readFileSync('config/ceiling.yaml', 'utf8')));
const hvac = ProjectHvacFactsSchema.parse(parseYaml(readFileSync('config/hvac.yaml', 'utf8')));

test('hvac.yaml declares the complete A2 diagram against existing MEP facts', () => {
  assert.deepEqual(hvac.plans.map((plan) => plan.id), ['A2']);
  validateProjectHvacFacts(hvac, { electrical, ceiling });
  const plan = hvac.plans[0];
  assert.equal(plan.outdoor.id, 'vrf_outdoor_a2');
  assert.equal(plan.diagram.anchors.filter((anchor) => anchor.ref?.source === 'ceiling').length, 5);
  assert.equal(plan.diagram.anchors.filter((anchor) => anchor.ref?.source === 'electrical').length, 5);
  const roomKeys = ['living', 'master', 'study', 'parent', 'child'];
  for (const room of roomKeys) {
    const indoor = `indoor_${room}`;
    assert.ok(plan.diagram.anchors.some((anchor) => anchor.id === `power_${room}` && anchor.ref?.source === 'electrical'));
    for (const system of ['power', 'refrigerant', 'condensate', 'supply_air', 'return_air', 'access']) {
      assert.equal(plan.diagram.routes.filter((route) => route.system === system && (route.from === indoor || route.to === indoor)).length, 1,
        `${room} should have exactly one ${system} route`);
    }
    for (const terminal of ['supply', 'return', 'access']) {
      assert.ok(plan.diagram.terminals.some((item) => item.id === `${terminal}_${room}`), `${room} missing ${terminal} terminal`);
    }
  }
  for (const route of plan.diagram.routes.filter((route) => route.status !== 'confirmed')) {
    assert.ok(route.reason?.trim(), `${route.id} requires a review reason`);
  }
  for (const route of plan.diagram.routes.filter((route) => route.system === 'condensate')) {
    const sink = plan.diagram.terminals.find((terminal) => terminal.id === route.to);
    assert.equal(sink?.status, 'pending');
    assert.match(sink?.id ?? '', /^condensate_/u);
  }
});

test('HVAC schema rejects invalid status, missing reasons, non-finite positions, and dangling routes', () => {
  const diagram = hvac.plans[0].diagram;
  const invalidStatus = structuredClone(hvac);
  invalidStatus.plans[0].diagram.anchors[0].status = 'draft' as never;
  assert.throws(() => ProjectHvacFactsSchema.parse(invalidStatus));

  const missingReason = structuredClone(hvac);
  delete missingReason.plans[0].diagram.anchors.find((anchor) => anchor.status === 'inferred')!.reason;
  assert.throws(() => ProjectHvacFactsSchema.parse(missingReason), /require reason/);

  const nonFinite = structuredClone(hvac);
  nonFinite.plans[0].diagram.terminals[0].position.x = Infinity;
  assert.throws(() => ProjectHvacFactsSchema.parse(nonFinite));

  const dangling = structuredClone(hvac);
  dangling.plans[0].diagram.routes[0].to = 'missing';
  assert.throws(() => validateProjectHvacFacts(dangling, { electrical, ceiling }), /unknown diagram id/);
});

test('HVAC semantic validation rejects duplicate ids and condensate sinks other than pending terminals', () => {
  const duplicate = structuredClone(hvac);
  duplicate.plans[0].diagram.terminals[0].id = duplicate.plans[0].diagram.anchors[0].id;
  assert.throws(() => validateProjectHvacFacts(duplicate, { electrical, ceiling }), /Duplicate HVAC diagram id/);

  const invalidSink = structuredClone(hvac);
  invalidSink.plans[0].diagram.routes.find((route) => route.system === 'condensate')!.to = 'indoor_living';
  assert.throws(() => validateProjectHvacFacts(invalidSink, { electrical, ceiling }), /must end at a pending terminal/);
});
