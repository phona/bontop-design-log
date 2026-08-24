import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectGlb } from '../../scripts/inspect-glb.js';
import { fileArtifact, RENDER_BUNDLE_SCHEMA_VERSION, sha256Bytes, type RenderBundleManifest } from '../../scripts/render-bundle-utils.js';
import { buildRenderBundle, parseBuildRenderBundleArgs } from '../../scripts/build-render-bundle.js';
import { parseVerifyRenderBundleArgs, verifyRenderBundle } from '../../scripts/verify-render-bundle.js';
import type { ProjectRenderFactsProjection } from '../../shared/types.js';

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

function manualGlbExport(inputBasename = 'manual-house.glb'): RenderBundleManifest['glbExport'] {
  return { method: 'manual_web_export', inputBasename };
}

function makeBundle(): { directory: string; manifest: RenderBundleManifest } {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-'));
  const glb = makeGlb();
  const facts: ProjectRenderFactsProjection = { version: '1.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'unimplemented', planId: null }, materials: { floor: { default: null, roomOverrides: {} } } };
  const config = { facts, lights: [], scenarios: [], cameras: [], sun: null };
  writeFileSync(join(directory, 'house.glb'), glb);
  writeFileSync(join(directory, 'project-render-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(directory, 'render-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const manifest: RenderBundleManifest = {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8',
    dirty: true,
    dirtyPorcelain: ' M sample',
    sourceInputs: {
      'config/hvac.yaml': sha256Bytes(Buffer.from('hvac input')),
      'data/current-scheme.json': sha256Bytes(Buffer.from('input')),
    },
    glbExport: manualGlbExport(),
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

test('render bundle argument parsers require manual GLB and explicit paths', () => {
  assert.deepEqual(parseBuildRenderBundleArgs(['--glb', 'manual.glb', '--output-dir', 'out', '--allow-dirty']), {
    glb: 'manual.glb', outputDir: 'out', allowDirty: true,
  });
  assert.deepEqual(parseVerifyRenderBundleArgs(['--bundle', 'out']), { bundle: 'out' });
  assert.throws(() => parseBuildRenderBundleArgs([]), /usage/);
  assert.throws(() => parseBuildRenderBundleArgs(['--output-dir', 'out']), /usage/);
  assert.throws(() => parseBuildRenderBundleArgs(['--glb', 'manual.glb']), /usage/);
  assert.throws(() => parseBuildRenderBundleArgs(['--glb', 'manual.glb', '--output-dir', 'out', '--cdp-port', '9222']), /usage/);
  assert.throws(() => parseVerifyRenderBundleArgs([]), /usage/);
});

test('buildRenderBundle rejects missing or invalid input GLBs before creating a bundle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-input-'));
  try {
    const output = join(directory, 'output');
    assert.throws(() => buildRenderBundle({ glb: join(directory, 'missing.glb'), outputDir: output, allowDirty: true }), /existing file/);
    writeFileSync(join(directory, 'invalid.glb'), 'not a GLB');
    assert.throws(() => buildRenderBundle({ glb: join(directory, 'invalid.glb'), outputDir: output, allowDirty: true }), /shorter|GLB/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('buildRenderBundle copies a manual GLB without modifying its source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-build-'));
  try {
    const input = join(directory, 'desktop-export.glb');
    const output = join(directory, 'bundle');
    writeFileSync(input, makeGlb());
    const original = readFileSync(input);
    const manifest = buildRenderBundle({ glb: input, outputDir: output, allowDirty: true });
    assert.deepEqual(readFileSync(input), original);
    assert.deepEqual(readFileSync(join(output, 'house.glb')), original);
    assert.notEqual(join(output, 'house.glb'), input);
    assert.deepEqual(manifest.glbExport, manualGlbExport('desktop-export.glb'));
    assert.deepEqual(verifyRenderBundle(output), manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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

test('verifyRenderBundle rejects invalid manual metadata, unsafe paths, hashes, facts, and GLB summary drift', () => {
  const { directory } = makeBundle();
  const manifestPath = join(directory, 'manifest.json');
  try {
    const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8')) as RenderBundleManifest;
    const writeManifest = (manifest: RenderBundleManifest) => writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    let manifest = readManifest();
    manifest.glbExport.inputBasename = '/tmp/house.glb';
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /input basename/);

    manifest = makeBundleManifestReset(directory);
    manifest.glbExport.method = 'cdp_export' as 'manual_web_export';
    writeManifest(manifest);
    assert.throws(() => verifyRenderBundle(directory), /export method/);

    manifest = makeBundleManifestReset(directory);
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
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8', dirty: true, dirtyPorcelain: ' M sample', sourceInputs: {}, glbExport: manualGlbExport(),
    artifacts: { glb: fileArtifact(directory, 'house.glb'), renderConfig: fileArtifact(directory, 'render-config.json'), projectRenderFacts: fileArtifact(directory, 'project-render-facts.json') },
    summaries: { glb: inspectGlb(glbPath), projectRenderFacts: facts },
  };
}
