import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectRenderFactsLoader } from '../../server/project-render-facts-loader.js';

const electrical = `- id: socket_1
  room: living
  type: socket
  x: 1
  z: 2
- id: light_1
  room: living
  type: dome
  x: 1.5
  z: 2.5
`;
const plumbing = `- id: faucet_1
  room: kitchen
  type: faucet
  x: 3
  z: 4
`;
const ceiling = `- id: ceiling_1
  room: living
  type: drop
  thickness: 0.2
  area: [0, 0, 1, 1]
`;
const hvac = `plans:
  - id: A2
    kind: vrf_ducted
    outdoor: { id: outdoor_1, platform: platform, x: 1, z: 2, direction: south, width: 1, depth: 1, height: 1, model: VRF }
    diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] }
`;
const overrides = `- id: light_1
  anchorY: 2.8
  reason: render anchor
  applies_to: [web, blender]
`;

describe('ProjectRenderFactsLoader', () => {
  let dir: string;
  let paths: { electrical: string; plumbing: string; ceiling: string; hvac: string; overrides: string };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'render-facts-'));
    paths = {
      electrical: join(dir, 'electrical.yaml'),
      plumbing: join(dir, 'plumbing.yaml'),
      ceiling: join(dir, 'ceiling.yaml'),
      hvac: join(dir, 'hvac.yaml'),
      overrides: join(dir, 'overrides.yaml'),
    };
    writeFileSync(paths.electrical, electrical);
    writeFileSync(paths.plumbing, plumbing);
    writeFileSync(paths.ceiling, ceiling);
    writeFileSync(paths.hvac, hvac);
    writeFileSync(paths.overrides, overrides);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('publishes a strictly validated aggregate snapshot and individual statuses', () => {
    const loader = new ProjectRenderFactsLoader(paths);
    loader.load();

    assert.deepEqual(loader.getFacts(), {
      electrical: [
        { id: 'socket_1', room: 'living', type: 'socket', x: 1, z: 2 },
        { id: 'light_1', room: 'living', type: 'dome', x: 1.5, z: 2.5 },
      ],
      plumbing: [{ id: 'faucet_1', room: 'kitchen', type: 'faucet', x: 3, z: 4 }],
      ceiling: [{ id: 'ceiling_1', room: 'living', type: 'drop', thickness: 0.2, area: [0, 0, 1, 1] }],
      hvac: { plans: [{ id: 'A2', kind: 'vrf_ducted', outdoor: { id: 'outdoor_1', platform: 'platform', x: 1, z: 2, direction: 'south', width: 1, depth: 1, height: 1, model: 'VRF' }, diagram: { anchors: [], terminals: [], routes: [], reference_constraints: [] } }] },
    });
    assert.deepEqual(loader.getOverrides(), [{ id: 'light_1', anchorY: 2.8, reason: 'render anchor', applies_to: ['web', 'blender'] }]);
    assert.equal(loader.getStatuses().every((status) => status.status === 'ok'), true);
  });

  it('keeps the previous snapshot when one input becomes invalid', () => {
    const loader = new ProjectRenderFactsLoader(paths);
    loader.load();
    const previous = loader.getFacts();

    writeFileSync(paths.plumbing, `- id: invalid\n  room: kitchen\n  type: unknown\n  x: 3\n  z: 4\n`);
    loader.load();

    assert.equal(loader.getFacts(), previous);
    const plumbingStatus = loader.getStatuses().find((status) => status.path === paths.plumbing);
    assert.equal(plumbingStatus?.status, 'failed');
    assert.ok(plumbingStatus?.error);
    assert.equal(loader.getStatuses().find((status) => status.path === paths.electrical)?.status, 'ok');
  });
});
