import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectGlb } from '../../scripts/render/glb/inspect-glb.js';

function glb(json: unknown, options: { magic?: number; version?: number; declaredLength?: number; chunkLength?: number; chunkType?: number } = {}): Buffer {
  const rawJson = Buffer.from(JSON.stringify(json), 'utf8');
  const padding = (4 - (rawJson.length % 4)) % 4;
  const jsonBytes = Buffer.concat([rawJson, Buffer.alloc(padding, 0x20)]);
  const output = Buffer.alloc(20 + jsonBytes.length);
  output.writeUInt32LE(options.magic ?? 0x46546c67, 0);
  output.writeUInt32LE(options.version ?? 2, 4);
  output.writeUInt32LE(options.declaredLength ?? output.length, 8);
  output.writeUInt32LE(options.chunkLength ?? jsonBytes.length, 12);
  output.writeUInt32LE(options.chunkType ?? 0x4e4f534a, 16);
  jsonBytes.copy(output, 20);
  return output;
}

function withGlb(buffer: Buffer, callback: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'inspect-glb-'));
  const path = join(directory, 'scene.glb');
  try {
    writeFileSync(path, buffer);
    callback(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const valid = {
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [
    { name: 'wall:west', mesh: 0, translation: [10, 0, 0], children: [1] },
    { name: 'wall:west' },
    { mesh: 0 },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [-1, -2, -3], max: [1, 2, 3] }],
};

test('inspectGlb returns sorted strict summary and transformed bbox', () => {
  withGlb(glb(valid), (path) => {
    const summary = inspectGlb(path);
    assert.deepEqual(summary, {
      schemaVersion: '1.0',
      nodesTotal: 3,
      meshNodesTotal: 1,
      namedNodesTotal: 2,
      unnamedNodeIndexes: [],
      nodeIds: ['wall:west', 'wall:west'],
      duplicateNodeIds: ['wall:west'],
      prefixCounts: { wall: 2 },
      fixtureRoles: [],
      unknownFixtureRoleTags: [],
      duplicateFixtureRoleTags: [],
      nodeBboxes: { 'wall:west': { min: [9, -2, -3], max: [11, 2, 3], size: [2, 4, 6] } },
      worldBbox: { min: [9, -2, -3], max: [11, 2, 3], size: [2, 4, 6] },
    });
  });
});

test('inspectGlb parses sorted fixture roles and records malformed or duplicate tags', () => {
  const document = { ...valid, nodes: [
    { name: 'fixture:z:part=seat:role=fabric', mesh: 0 },
    { name: 'fixture:a:part=frame:role=wood', mesh: 0 },
    { name: 'fixture:z:part=seat:role=fabric', mesh: 0 },
    { name: 'fixture:bad:part=missing-role', mesh: 0 },
  ], scenes: [{ nodes: [0, 1, 2, 3] }] };
  withGlb(glb(document), (path) => {
    const summary = inspectGlb(path);
    assert.deepEqual(summary.fixtureRoles, [
      { nodeName: 'fixture:a:part=frame:role=wood', part: 'frame', role: 'wood', prefix: 'fixture' },
      { nodeName: 'fixture:z:part=seat:role=fabric', part: 'seat', role: 'fabric', prefix: 'fixture' },
      { nodeName: 'fixture:z:part=seat:role=fabric', part: 'seat', role: 'fabric', prefix: 'fixture' },
    ]);
    assert.deepEqual(summary.unknownFixtureRoleTags, ['fixture:bad:part=missing-role']);
    assert.deepEqual(summary.duplicateFixtureRoleTags, ['fixture:z:part=seat:role=fabric']);
  });
});

test('inspectGlb only visits active-scene reachable nodes and supports absent bbox', () => {
  const document = { ...valid, nodes: [...valid.nodes, { name: 'orphan:node' }], meshes: [{ primitives: [{}] }], accessors: [] };
  withGlb(glb(document), (path) => {
    const summary = inspectGlb(path);
    assert.equal(summary.nodesTotal, 4);
    assert.deepEqual(summary.nodeIds, ['wall:west', 'wall:west']);
    assert.equal(summary.worldBbox, null);
  });
});

test('inspectGlb rejects malformed binary headers and chunk boundaries', () => {
  const cases: Array<[Buffer, RegExp]> = [
    [Buffer.alloc(3), /shorter/],
    [glb(valid, { magic: 0 }), /bad magic/],
    [glb(valid, { version: 1 }), /unsupported version/],
    [glb(valid, { declaredLength: 999 }), /declared length/],
    [glb(valid, { chunkType: 0 }), /first chunk is not JSON/],
    [glb(valid, { chunkLength: 99999 }), /exceeds file boundary/],
  ];
  for (const [buffer, expected] of cases) {
    withGlb(buffer, (path) => assert.throws(() => inspectGlb(path), expected));
  }
});

test('inspectGlb rejects invalid scenes, nodes, meshes, and accessor references', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ asset: { version: '2.0' }, scenes: [], nodes: [] }, /scenes must be a non-empty/],
    [{ ...valid, scene: 4 }, /scene references invalid index/],
    [{ ...valid, scenes: [{ nodes: [4] }] }, /scenes\[0\]\.nodes references invalid/],
    [{ ...valid, nodes: [{ children: [4] }] }, /nodes\[0\]\.children references invalid/],
    [{ ...valid, nodes: [{ mesh: 4 }] }, /nodes\[0\]\.mesh references invalid/],
    [{ ...valid, meshes: [{ primitives: [{ attributes: { POSITION: 2 } }] }] }, /attributes\.POSITION references invalid/],
  ];
  for (const [document, expected] of cases) {
    withGlb(glb(document), (path) => assert.throws(() => inspectGlb(path), expected));
  }
});

test('inspectGlb rejects invalid JSON and non-finite transform or bbox values', () => {
  const malformed = Buffer.alloc(24);
  malformed.writeUInt32LE(0x46546c67, 0);
  malformed.writeUInt32LE(2, 4);
  malformed.writeUInt32LE(24, 8);
  malformed.writeUInt32LE(4, 12);
  malformed.writeUInt32LE(0x4e4f534a, 16);
  malformed.write('nope', 20);
  withGlb(malformed, (path) => assert.throws(() => inspectGlb(path), /JSON parse failed/));

  const nonFiniteTransform = structuredClone(valid);
  nonFiniteTransform.nodes[0].translation = [Infinity, 0, 0];
  withGlb(glb(nonFiniteTransform), (path) => assert.throws(() => inspectGlb(path), /finite number/));
});
