import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCameraCoverageReport, parseArgs, readCameraCoverageReport } from './camera-coverage-report.js';

test('reports room totals and category counts from the checked-in render config', () => {
  const report = readCameraCoverageReport();
  assert.equal(report.totalCameras, 37);
  assert.equal(report.rooms.living_dining?.cameras, 8);
  assert.equal(report.rooms.living_dining?.overview, 1);
  assert.equal(report.rooms.living_dining?.relationship, 4);
  assert.equal(report.rooms.living_dining?.detail, 3);
  assert.equal(report.rooms.living_dining?.auxiliary, 0);
  assert.equal(report.rooms.living_dining?.cameraDetails.length, 8);
  assert.deepEqual(report.rooms.living_dining?.cameraDetails[0], {
    id: 'living_sofa_glass',
    category: 'relationship',
    label: '客厅餐桌侧南望沙发+玻璃幕（全景）',
    archived: false,
  });
  assert.equal(report.rooms.kitchen?.overview, 1);
  assert.equal(report.rooms.master_bath?.auxiliary, 1);
  assert.equal(report.unarchivedCameras.length, 37);
});

test('lists camera details with explicit category and archive metadata', () => {
  const report = buildCameraCoverageReport({ cameras: [
    { id: 'one', room: 'room_a', label: 'One', category: 'relationship', archived: true },
    { id: 'two', room: 'room_a', category: 'detail', archiveStatus: 'archived' },
    { id: 'three', room: 'room_a', category: 'overview' },
  ] }, 'fixture.json');
  assert.deepEqual(report.rooms.room_a, {
    cameras: 3,
    overview: 1,
    relationship: 1,
    detail: 1,
    auxiliary: 0,
    cameraDetails: [
      { id: 'one', label: 'One', category: 'relationship', archived: true },
      { id: 'two', category: 'detail', archived: true },
      { id: 'three', category: 'overview', archived: false },
    ],
  });
  assert.deepEqual(report.unarchivedCameras, [{ id: 'three', room: 'room_a', category: 'overview' }]);
});

test('falls back to legacy id, label, and purpose category inference when category is missing', () => {
  const report = buildCameraCoverageReport({ cameras: [
    { id: 'room_relationship_view', room: 'room_b' },
    { id: 'room_closeup_view', room: 'room_b' },
    { id: 'room_overview_view', room: 'room_b' },
    { id: 'room_other_view', room: 'room_b', label: '全景补充' },
  ] }, 'fixture.json');
  assert.deepEqual(report.rooms.room_b.cameraDetails, [
    { id: 'room_relationship_view', category: 'relationship', archived: false },
    { id: 'room_closeup_view', category: 'detail', archived: false },
    { id: 'room_overview_view', category: 'overview', archived: false },
    { id: 'room_other_view', label: '全景补充', category: 'overview', archived: false },
  ]);
});

test('parses json, output, and optional config path arguments', () => {
  assert.deepEqual(parseArgs(['--json', '--out', 'tmp/report.json', 'fixture.json']), {
    json: true,
    out: 'tmp/report.json',
    configPath: 'fixture.json',
  });
});

test('rejects unknown and duplicate positional arguments', () => {
  assert.throws(() => parseArgs(['--wat']), /unknown argument/);
  assert.throws(() => parseArgs(['one.json', 'two.json']), /only one/);
});
