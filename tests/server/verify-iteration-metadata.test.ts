import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { errorLocation } from '../../scripts/verify/iterations/verify-iteration-metadata.js';

test('reports JSON and YAML parser locations as line:column', () => {
  const json = '{\n  "valid": true,\n  "broken": }';
  let jsonMessage = '';
  try { JSON.parse(json); } catch (error) { jsonMessage = (error as Error).message; }
  assert.equal(errorLocation(jsonMessage, json, 'json'), '3:13');

  const yaml = 'ok: true\n  broken: value\n';
  let yamlMessage = '';
  try { load(yaml); } catch (error) { yamlMessage = (error as Error).message.split('\n')[0]; }
  assert.equal(errorLocation(yamlMessage, yaml, 'yaml'), '2:9');
});

test('decision brief exposes its dual-PASS delivery gate and retains review list', () => {
  const brief = load(readFileSync(
    'docs/design-iterations/hvac-dual-outlet-threeline-20261007/decision-brief.yaml', 'utf8',
  )) as {
    acceptance: {
      review_required: string[];
      delivery_gate: { all_required_reviews_must_pass: boolean; required_reviews: string[] };
    };
  };
  assert.deepEqual(brief.acceptance.review_required, ['aesthetic', 'functional']);
  assert.deepEqual(brief.acceptance.delivery_gate, {
    all_required_reviews_must_pass: true,
    required_reviews: ['aesthetic', 'functional'],
  });
});
