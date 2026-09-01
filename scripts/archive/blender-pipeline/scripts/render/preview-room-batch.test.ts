import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreviewRoomBatchPlan, formatPreviewRoomBatchPlan, parseArgs } from './preview-room-batch.js';

const config = {
  scenarios: [{ id: 'daylight' }, { id: 'material_review' }],
  cameras: [
    { id: 'living_overview', room: 'living_dining' },
    { id: 'living_detail', room: 'living_dining' },
    { id: 'kitchen_overview', room: 'kitchen' },
  ],
};

test('builds one preview command per room with an explicit room scope', () => {
  const plan = buildPreviewRoomBatchPlan(config, {
    configPath: 'config/render-config.json',
    scenario: 'daylight',
    res: '50',
    samples: '64',
  });
  assert.deepEqual(plan.rooms.map(({ room, cameras }) => ({ room, cameras })), [
    { room: 'living_dining', cameras: ['living_overview', 'living_detail'] },
    { room: 'kitchen', cameras: ['kitchen_overview'] },
  ]);
  for (const roomPlan of plan.rooms) {
    assert.match(roomPlan.command, /--mode preview/);
    assert.match(roomPlan.command, new RegExp(`--preview-room ${roomPlan.room}`));
    assert.match(roomPlan.command, /--scenario daylight/);
    assert.match(roomPlan.command, /--res 50/);
    assert.match(roomPlan.command, /--samples 64/);
  }
  assert.match(plan.rooms[0].command, /--only living_overview,living_detail/);
  assert.match(plan.rooms[1].command, /--only kitchen_overview/);
});

test('filters requested rooms and emits JSON without executing commands', () => {
  const plan = buildPreviewRoomBatchPlan(config, {
    configPath: 'render-config.json',
    rooms: ['kitchen'],
    scenario: 'material_review',
    res: '25',
    samples: '16',
  });
  assert.deepEqual(plan.rooms.map(({ room }) => room), ['kitchen']);
  const parsed = JSON.parse(formatPreviewRoomBatchPlan(plan, true));
  assert.equal(parsed.rooms[0].room, 'kitchen');
  assert.match(parsed.rooms[0].command, /--preview-room kitchen/);
});

test('parses supported CLI options', () => {
  assert.deepEqual(parseArgs([
    '--config', 'render-config.json', '--rooms', 'kitchen,living_dining,kitchen',
    '--scenario', 'daylight', '--res', '50', '--samples', '64', '--json', '--out', 'tmp/plan.json',
  ]), {
    configPath: 'render-config.json',
    rooms: ['kitchen', 'living_dining'],
    scenario: 'daylight',
    res: '50',
    samples: '64',
    json: true,
    out: 'tmp/plan.json',
  });
});

test('rejects unknown rooms, scenarios, missing values, and invalid numeric options', () => {
  assert.throws(() => buildPreviewRoomBatchPlan(config, {
    configPath: 'render-config.json', rooms: ['unknown'], scenario: 'daylight', res: '50', samples: '64',
  }), /unknown room/);
  assert.throws(() => buildPreviewRoomBatchPlan(config, {
    configPath: 'render-config.json', scenario: 'night', res: '50', samples: '64',
  }), /unknown scenario/);
  assert.throws(() => parseArgs(['--rooms']), /requires a value/);
  assert.throws(() => parseArgs(['--samples', '0']), /positive number/);
  assert.throws(() => parseArgs(['--wat']), /unknown argument/);
});

test('rejects malformed camera and scenario entries', () => {
  assert.throws(() => buildPreviewRoomBatchPlan({ ...config, cameras: [{ id: 'missing-room' }] }, {
    configPath: 'render-config.json', scenario: 'daylight', res: '50', samples: '64',
  }), /room/);
  assert.throws(() => buildPreviewRoomBatchPlan({ ...config, scenarios: [{}] }, {
    configPath: 'render-config.json', scenario: 'daylight', res: '50', samples: '64',
  }), /scenario id/);
});

// This module only builds strings and writes optional output in its CLI entrypoint;
// tests intentionally never invoke a child process or remote command.
