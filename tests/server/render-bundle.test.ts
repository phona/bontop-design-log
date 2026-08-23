import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectGlb } from '../../scripts/inspect-glb.js';
import { fileArtifact, RENDER_BUNDLE_SCHEMA_VERSION, sha256Bytes, type RenderBundleManifest } from '../../scripts/render-bundle-utils.js';
import { parseBuildRenderBundleArgs } from '../../scripts/build-render-bundle.js';
import { parseVerifyRenderBundleArgs, verifyRenderBundle } from '../../scripts/verify-render-bundle.js';

function makeGlb(document: unknown = {
  asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
  nodes: [{ name: 'wall:one', mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [0, 0, 0], max: [1, 1, 1] }],
}): Buffer {
  const json = Buffer.from(JSON.stringify(document), 'utf8');
  const padding = (4 - json.length % 4) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const buffer = Buffer.alloc(20 + jsonChunk.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(jsonChunk.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(buffer, 20);
  return buffer;
}

function makeBundle(): { directory: string; manifest: RenderBundleManifest } {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-'));
  const glb = makeGlb();
  const facts = { version: '1.0', lightingFixtures: [], plumbing: [], ceiling: [], materials: { floor: { default: null, roomOverrides: {} } } };
  const config = { facts, lights: [], scenarios: [], cameras: [], sun: null };
  writeFileSync(join(directory, 'house.glb'), glb);
  writeFileSync(join(directory, 'project-render-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(directory, 'render-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const manifest: RenderBundleManifest = {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8',
    dirty: true,
    dirtyPorcelain: ' M sample',
    sourceInputs: { 'data/current-scheme.json': sha256Bytes(Buffer.from('input')) },
    artifacts: {
      glb: fileArtifact(directory, 'house.glb'),
      renderConfig: fileArtifact(directory, 'render-config.json'),
      projectRenderFacts: fileArtifact(directory, 'project-render-facts.json'),
    },
    summaries: { glb: inspectGlb(join(directory, 'house.glb')), projectRenderFacts: facts },
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, manifest };
}

test('render bundle argument parsers require explicit paths', () => {
  assert.deepEqual(parseBuildRenderBundleArgs(['--output-dir', 'out', '--allow-dirty']), {
    outputDir: 'out', cdpHost: 'localhost', cdpPort: 9222, appUrl: 'http://localhost:5173', timeoutSeconds: 120, allowDirty: true,
  });
  assert.deepEqual(parseVerifyRenderBundleArgs(['--bundle', 'out']), { bundle: 'out' });
  assert.throws(() => parseBuildRenderBundleArgs([]), /usage/);
  assert.throws(() => parseVerifyRenderBundleArgs([]), /usage/);
});

test('verifyRenderBundle validates a self-contained dirty bundle without browser', () => {
  const { directory, manifest } = makeBundle();
  try {
    assert.deepEqual(verifyRenderBundle(directory), manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects empty or bbox-less GLBs even when their manifest summary matches', () => {
  const { directory } = makeBundle();
  try {
    writeFileSync(join(directory, 'house.glb'), makeGlb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'house' }],
    }));
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(makeBundleManifestReset(directory), null, 2)}\n`);
    assert.throws(() => verifyRenderBundle(directory), /at least one mesh node/);

    writeFileSync(join(directory, 'house.glb'), makeGlb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0,
      nodes: [{ name: 'wall:one', mesh: 0 }], meshes: [{ primitives: [{}] }],
    }));
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(makeBundleManifestReset(directory), null, 2)}\n`);
    assert.throws(() => verifyRenderBundle(directory), /world bbox/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects unsafe paths, hashes, facts, and GLB summary drift', () => {
  const { directory } = makeBundle();
  const manifestPath = join(directory, 'manifest.json');
  try {
    const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8')) as RenderBundleManifest;
    const writeManifest = (manifest: RenderBundleManifest) => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let manifest = readManifest();
    manifest.artifacts.glb.path = '../house.glb';
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /unsafe|escapes/);

    manifest = makeBundleManifestReset(directory);
    manifest.artifacts.glb.sha256 = '0'.repeat(64);
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /SHA-256 mismatch/);

    manifest = makeBundleManifestReset(directory);
    writeFileSync(join(directory, 'render-config.json'), JSON.stringify({ facts: { wrong: true } }));
    manifest.artifacts.renderConfig = fileArtifact(directory, 'render-config.json');
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /facts must deeply equal/);

    writeFileSync(join(directory, 'render-config.json'), `${JSON.stringify({ facts: JSON.parse(readFileSync(join(directory, 'project-render-facts.json'), 'utf8')), lights: [], scenarios: [], cameras: [], sun: null }, null, 2)}\n`);
    manifest = makeBundleManifestReset(directory);
    writeManifest(manifest);
    manifest.summaries.glb.nodesTotal = 99;
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /GLB summary/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeBundleManifestReset(directory: string): RenderBundleManifest {
  const glbPath = join(directory, 'house.glb');
  const factsPath = join(directory, 'project-render-facts.json');
  const configPath = join(directory, 'render-config.json');
  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  return {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8', dirty: true, dirtyPorcelain: ' M sample', sourceInputs: {},
    artifacts: { glb: fileArtifact(directory, 'house.glb'), renderConfig: fileArtifact(directory, 'render-config.json'), projectRenderFacts: fileArtifact(directory, 'project-render-facts.json') },
    summaries: { glb: inspectGlb(glbPath), projectRenderFacts: facts },
  };
}
