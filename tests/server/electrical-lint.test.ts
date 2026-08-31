import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { parseElectricalTopology } from '../../shared/project-render-facts-schema.js';
import { lintElectricalTopology } from '../../shared/electrical-lint.js';
import type { ElectricalPoint, ElectricalTopology } from '../../shared/types.js';

const points = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as ElectricalPoint[];
const raw = readFileSync('config/electrical-topology.yaml', 'utf8');

test('real electrical topology parses and lints', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  assert.equal(topology.circuits.length, 23);
  assert.equal(topology.controls.length, 3);
  assert.equal(topology.circuits.filter((circuit) => circuit.purpose === 'lighting').flatMap((circuit) => circuit.member_point_ids).length, 13);
  assert.equal(topology.circuits.filter((circuit) => circuit.purpose === 'ordinary_power').flatMap((circuit) => circuit.member_point_ids).length, 26);
  assert.equal(result.counts.coveredPoints, 51);
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.length > 0);
});

test('unknown point and duplicate member are rejected by parser', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [...topology.circuits, { ...topology.circuits[0], id: 'duplicate', member_point_ids: ['unknown'] }] }), points), /unknown point/);
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [...topology.circuits, { ...topology.circuits[0], id: 'duplicate', member_point_ids: [topology.circuits[0].member_point_ids[0]] }] }), points), /multiple circuits/);
});

test('two-way control without target is warning and dedicated pending is warning', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  assert.equal(result.errors.filter((i) => i.code === 'control_target_missing').length, 0);
  assert.equal(result.warnings.filter((i) => i.code === 'control_target_missing').length, 3);
  assert.ok(result.warnings.some((i) => i.code === 'dedicated_parameters_pending'));
  assert.equal(topology.controls.every((control) => control.target_point_ids.length === 0), true);
});

test('lint rejects non-load members and duplicate members', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const result = lintElectricalTopology({
    ...topology,
    circuits: [{ ...topology.circuits[0], member_point_ids: ['switch_living_entrance', 'switch_living_entrance'] }],
  }, points);
  assert.equal(result.errors.filter((i) => i.code === 'member_not_powerable').length, 2);
  assert.ok(result.errors.filter((i) => i.code === 'duplicate_member').length >= 1);
});

test('ordinary power accepts sockets and rejects lighting/network/switch points', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const ordinary = topology.circuits.find((circuit) => circuit.purpose === 'ordinary_power')!;
  const valid = lintElectricalTopology({ ...topology, circuits: [{ ...ordinary, member_point_ids: ['sock_living_tv', 'sock_living_sofa_l'] }] }, points);
  assert.equal(valid.errors.filter((i) => i.code === 'ordinary_member_not_socket').length, 0);
  const invalid = lintElectricalTopology({ ...topology, circuits: [{ ...ordinary, member_point_ids: ['light_master_wall_l', 'net_living', 'switch_living_entrance'] }] }, points);
  assert.equal(invalid.errors.filter((i) => i.code === 'ordinary_member_not_socket').length, 3);
});

test('unknown circuit purpose is rejected by schema', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  assert.throws(() => parseElectricalTopology(JSON.stringify({ ...topology, circuits: [{ ...topology.circuits[0], purpose: 'unknown_power' }] }), points), /Invalid option/);
});

test('lint keeps historical uncovered points as warnings and maps circuit facts', () => {
  const topology = parseElectricalTopology(raw, points);
  const result = lintElectricalTopology(topology, points);
  assert.equal(result.errors.filter((i) => i.code === 'circuit_fact_mismatch').length, 0);
  assert.equal(result.warnings.filter((i) => i.code === 'declared_circuit_uncovered').length, 0);
  assert.ok(result.warnings.some((i) => i.code === 'point_uncovered'));
  assert.equal(result.warnings.filter((i) => i.code === 'electrical_parameters_pending').length, 23);
  assert.equal(result.warnings.filter((i) => i.code === 'point_uncovered').length, 27);
  assert.ok(result.warnings.some((i) => i.code === 'point_uncovered' && i.id === 'light_master_wall_l'));
});

test('lint validates panel topology/source semantics and status at runtime', () => {
  const topology = parseElectricalTopology(raw, points) as ElectricalTopology;
  const result = lintElectricalTopology({
    ...topology,
    panels: [{ ...topology.panels[0], kind: 'weak' as any, status: 'invalid' as any }],
  }, points);
  assert.equal(result.errors.filter((i) => i.code === 'invalid_panel_kind').length, 1);
  assert.equal(result.errors.filter((i) => i.code === 'invalid_panel_status').length, 1);
});

test('electrical JSON CLI emits pure JSON', () => {
  const output = execFileSync('npx', ['tsx', 'scripts/verify/electrical/verify-electrical-lint.ts', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const result = JSON.parse(output) as { errors: unknown[]; warnings: unknown[]; counts: { circuits: number } };
  assert.equal(result.counts.circuits, 23);
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
});
