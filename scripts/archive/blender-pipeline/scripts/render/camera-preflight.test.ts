import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCameraPreflightReport,
  formatCameraPreflightReport,
  parseArgs,
} from './camera-preflight.js';

const geometry = {
  vertices: [
    { id: 'a', x: 0, z: 0 }, { id: 'b', x: 4, z: 0 },
    { id: 'c', x: 4, z: 4 }, { id: 'd', x: 0, z: 4 },
  ],
  rooms: [{ id: 'room_a', boundary: ['a', 'b', 'c', 'd'] }],
};

const valid = {
  scenarios: [{ id: 'daylight' }],
  cameras: [{ id: 'cam_a', room: 'room_a', position: [1, 1.6, 1], target: [2, 1, 2], lens: 24, scenarios: ['daylight'] }],
};

test('accepts a valid static camera configuration and room target', () => {
  const report = buildCameraPreflightReport(valid, geometry, 'config.json', 'geometry.yaml');
  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.geometryPath, 'geometry.yaml');
});

test('detects duplicate ids, malformed values, and unknown scenarios', () => {
  const report = buildCameraPreflightReport({
    scenarios: [{ id: 'daylight' }, { id: 'daylight' }],
    cameras: [
      { id: 'dup', room: 'room_a', position: [1, 1, 1], target: [2, 1, 2], lens: 24, scenarios: ['missing'] },
      { id: 'dup', room: 'room_a', position: ['bad'], target: [2, 1, 2], lens: 0, scenarios: [] },
    ],
  }, geometry);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((item) => item.code === 'duplicate-camera-id'));
  assert.ok(report.issues.some((item) => item.code === 'duplicate-scenario-id'));
  assert.ok(report.issues.some((item) => item.code === 'invalid-position'));
  assert.ok(report.issues.some((item) => item.code === 'invalid-lens'));
  assert.ok(report.issues.some((item) => item.code === 'unknown-scenario'));
});

test('flags abnormal height, distance, and target outside room bounds', () => {
  const report = buildCameraPreflightReport({
    scenarios: [{ id: 'daylight' }],
    cameras: [{ id: 'far', room: 'room_a', position: [1, 4, 1], target: [30, 1, 30], lens: 24, scenarios: ['daylight'] }],
  }, geometry);
  assert.ok(report.issues.some((item) => item.code === 'abnormal-height'));
  assert.ok(report.issues.some((item) => item.code === 'abnormal-distance'));
  assert.ok(report.issues.some((item) => item.code === 'target-outside-room'));
  assert.equal(report.ok, true, 'warnings do not fail the preflight');
});

test('flags known bedroom_se east and south boundary crossings', () => {
  const report = buildCameraPreflightReport({
    scenarios: [{ id: 'material_review' }],
    cameras: [{ id: 'bedroom_se_relationship_overview', room: 'bedroom_se', position: [16.05, 1.6, 5.85], target: [14.7, 1.05, 7.5], lens: 19, scenarios: ['material_review'] }],
  }, {
    vertices: [{ id: 'w', x: 13.4, z: 5.55 }, { id: 'e', x: 16.4, z: 5.55 }, { id: 'se', x: 16.4, z: 8.7 }, { id: 'sw', x: 13.4, z: 8.7 }],
    rooms: [{ id: 'bedroom_se', boundary: ['w', 'e', 'se', 'sw'] }],
  });
  assert.ok(report.issues.some((item) => item.code === 'bedroom-se-east-wall-crossing'));
  assert.ok(report.issues.some((item) => item.code === 'bedroom-se-south-glass-crossing'));
});

test('parses simple CLI options and formats JSON', () => {
  assert.deepEqual(parseArgs(['--config', 'a.json', '--geometry', 'g.yaml', '--json']), { configPath: 'a.json', geometryPath: 'g.yaml', json: true });
  assert.throws(() => parseArgs(['--geometry']), /requires a value/);
  const parsed = JSON.parse(formatCameraPreflightReport(buildCameraPreflightReport(valid), true));
  assert.equal(parsed.cameras, 1);
});
