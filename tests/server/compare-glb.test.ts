import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareGlb, inventoryFromSummary, normalizeSemanticId } from '../../scripts/render/glb/compare-glb.js';
import { inspectGlb } from '../../scripts/render/glb/inspect-glb.js';

function makeSummary(names: string[]) {
  return {
    schemaVersion: '1.0' as const,
    nodesTotal: names.length,
    meshNodesTotal: names.length,
    namedNodesTotal: names.length,
    unnamedNodeIndexes: [],
    nodeIds: names,
    duplicateNodeIds: [],
    prefixCounts: {},
    nodeBboxes: {},
    worldBbox: null,
  };
}

test('semantic normalization collapses implementation children and legacy furniture parts', () => {
  assert.deepEqual(normalizeSemanticId('ceiling:ceiling_child_ac:slab:0'), { category: 'ceiling', id: 'ceiling:ceiling_child_ac' });
  assert.deepEqual(normalizeSemanticId('d_elev:frame:left'), { category: 'door', id: 'd_elev' });
  assert.deepEqual(normalizeSemanticId('sliding_door:kitchen_dining_sliding_door:pane:0'), { category: 'sliding_door', id: 'sliding_door:kitchen_dining_sliding_door' });
  assert.deepEqual(normalizeSemanticId('curtain_box_living:0'), { category: 'curtain', id: 'curtain_living' });
  assert.deepEqual(normalizeSemanticId('curtain_living_south:sheer:deployed'), { category: 'curtain', id: 'curtain_living' });
  assert.deepEqual(normalizeSemanticId('hvac:A2:anchor:power_living'), { category: 'hvac', id: 'hvac:A2:anchor:branch_living' });
  const inventory = inventoryFromSummary(makeSummary([
    'furniture:master_bedroom:bed_180:0',
    'furniture:master_bedroom:bed_180:0:bed_180:part:0',
    'bed_180:part:0',
    'ceiling:zone:slab:0',
    'ceiling:zone:skirt:1',
    'd_elev', 'd_elev:frame:left',
  ]));
  assert.deepEqual(inventory.ids.furniture, ['furniture:master_bedroom:bed_180:0']);
  assert.deepEqual(inventory.ids.ceiling, ['ceiling:zone']);
  assert.deepEqual(inventory.ids.door, ['d_elev']);
  assert.ok(inventory.explainableDuplicates.some((entry) => entry.startsWith('furniture:furniture:master_bedroom:bed_180:0')));
});

test('real baseline and facts-enabled CLI candidate classify expected and error differences', () => {
  const baseline = 'tmp/baselines/house-20260826.glb';
  const candidate = 'tmp/compare-current-facts.glb';
  const facts = 'scripts/blender/project-render-facts.json';
  if (!existsSync(candidate)) return;
  const report = compareGlb(baseline, candidate, { factsPath: facts });
  assert.equal(report.baseline.semantic.counts.floor, 15);
  assert.equal(report.candidate.semantic.counts.floor, 16);
  assert.equal(report.candidate.semantic.counts.hvac, 21);
  assert.equal(report.missing.furniture.length, 0);
  assert.ok(report.expected.some((entry) => entry.includes('duplicate/internal')));
  assert.ok(report.expected.some((entry) => entry.includes('ceiling zone')));
  assert.equal(report.errors.some((entry) => entry.includes('missing HVAC entity required by facts')), false);
  assert.ok(report.errors.some((entry) => entry.includes('missing core hvac ID')));
  assert.ok(report.expectedGeometryChanges.length > 0);
  assert.equal(report.errors.some((entry) => entry.includes('bbox')), false);
});

test('facts-enabled comparison reports missing HVAC as an error', () => {
  const report = compareGlb('tmp/baselines/house-20260826.glb', 'tmp/cli-shared-render.glb', { factsPath: 'scripts/blender/project-render-facts.json' });
  assert.ok(report.errors.some((entry) => entry.includes('missing HVAC entity required by facts')));
  assert.equal(report.candidate.semantic.counts.hvac, 0);
});

test('strict mode fails on missing core semantic IDs and facts HVAC entities', () => {
  const directory = mkdtempSync(join(tmpdir(), 'compare-glb-'));
  const candidate = join(directory, 'candidate.glb');
  try {
    const baseline = 'tmp/baselines/house-20260826.glb';
    const source = inspectGlb(baseline);
    const reduced = makeSummary(source.nodeIds.filter((id) => !id.startsWith('hvac:') && !id.startsWith('floor:master_bedroom')));
    writeFileSync(candidate, Buffer.from('not-a-glb'));
    assert.throws(() => compareGlb(baseline, candidate, { strict: true, factsPath: 'scripts/blender/project-render-facts.json' }), /Invalid GLB/);
    assert.ok(reduced.nodeIds.length < source.nodeIds.length);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
