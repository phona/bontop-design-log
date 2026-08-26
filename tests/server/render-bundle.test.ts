import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectGlb } from '../../scripts/inspect-glb.js';
import { fileArtifact, RENDER_BUNDLE_SCHEMA_VERSION, assertCurtainNodesConsistent, git, sha256Bytes, type RenderBundleManifest } from '../../scripts/render-bundle-utils.js';
import { buildRenderBundle, parseBuildRenderBundleArgs, SOURCE_INPUTS } from '../../scripts/build-render-bundle.js';
import { parseVerifyRenderBundleArgs, verifyRenderBundle } from '../../scripts/verify-render-bundle.js';
import { buildProjectRenderFactsFromFiles, serializeProjectRenderFacts } from '../../scripts/project-render-facts-projection.js';
import { serializeRenderConfig } from '../../scripts/blender/gen-render-config.js';
import { curtainProjectionSnapshotSha256, expectedVisibleCurtainNodes, type CurtainKind } from '../../shared/curtain-projection.js';
import type { CurtainState } from '../../shared/types.js';
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

function glbWithCurtainNodes(names: string[]): Buffer {
  return makeGlb({
    asset: { version: '2.0' }, scenes: [{ nodes: [0, ...names.map((_, index) => index + 1)] }], scene: 0,
    nodes: [{ name: 'wall:one', mesh: 0 }, ...names.map((name) => ({ name, mesh: 0 }))],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [1, 1, 1] }],
  });
}

function manualGlbExport(inputBasename = 'manual-house.glb'): RenderBundleManifest['glbExport'] {
  return { method: 'manual_web_export', inputBasename };
}

function makeBundle(): { directory: string; manifest: RenderBundleManifest } {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-'));
  const glb = makeGlb();
  const emptyCurtains = { source: { default: 'open' as const, roomOverrides: {}, updatedAt: '2026-08-25T00:00:00.000Z' }, effectiveByRoom: {}, curtains: [] };
  const facts: ProjectRenderFactsProjection = { version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'unimplemented', planId: null }, materials: { floor: { default: null, roomOverrides: {} } }, presentation: { curtains: { ...emptyCurtains, snapshotSha256: curtainProjectionSnapshotSha256(emptyCurtains) } } };
  const config = { facts, lights: [], scenarios: [], cameras: [], sun: null };
  writeFileSync(join(directory, 'house.glb'), glb);
  writeFileSync(join(directory, 'project-render-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(directory, 'render-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const glbSummary = inspectGlb(join(directory, 'house.glb'));
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
    curtainPresentation: assertCurtainNodesConsistent(glbSummary, facts.presentation.curtains),
    summaries: { glb: glbSummary, projectRenderFacts: facts },
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
    for (const path of ['config/layout/overlay.yaml', 'config/layout/model-geometry.yaml', 'data/presentation-state.json']) {
      assert.ok(Object.hasOwn(manifest.sourceInputs, path), `sourceInputs must include ${path}`);
    }
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
  const facts = JSON.parse(readFileSync(factsPath, 'utf8')) as ProjectRenderFactsProjection;
  const glbSummary = inspectGlb(glbPath);
  return {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8', dirty: true, dirtyPorcelain: ' M sample', sourceInputs: {}, glbExport: manualGlbExport(),
    artifacts: { glb: fileArtifact(directory, 'house.glb'), renderConfig: fileArtifact(directory, 'render-config.json'), projectRenderFacts: fileArtifact(directory, 'project-render-facts.json') },
    curtainPresentation: assertCurtainNodesConsistent(glbSummary, facts.presentation.curtains),
    summaries: { glb: glbSummary, projectRenderFacts: facts },
  };
}

function curtainFacts(id: string, room: string, kind: CurtainKind, state: CurtainState): ProjectRenderFactsProjection {
  const curtains = {
    source: { default: state, roomOverrides: {}, updatedAt: '2026-08-25T00:00:00.000Z' },
    effectiveByRoom: { [room]: state },
    curtains: [{ id, roomId: room, kind, state, expectedVisibleNodes: expectedVisibleCurtainNodes(id, kind, state) }],
  };
  return {
    version: '2.0', lightingFixtures: [], plumbing: [], ceiling: [], hvac: { status: 'unimplemented', planId: null },
    materials: { floor: { default: null, roomOverrides: {} } },
    presentation: { curtains: { ...curtains, snapshotSha256: curtainProjectionSnapshotSha256(curtains) } },
  };
}

function makeCurtainBundle(facts: ProjectRenderFactsProjection, glbNodeNames: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'render-bundle-curtain-'));
  writeFileSync(join(directory, 'house.glb'), glbWithCurtainNodes(glbNodeNames));
  writeFileSync(join(directory, 'project-render-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  writeFileSync(join(directory, 'render-config.json'), `${JSON.stringify({ facts, lights: [], scenarios: [], cameras: [], sun: null }, null, 2)}\n`);
  const glbSummary = inspectGlb(join(directory, 'house.glb'));
  const knownCurtainIds = new Set(facts.presentation.curtains.curtains.map((curtain) => curtain.id));
  const manifest: RenderBundleManifest = {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision: 'd14d3b93e55143f7b0d0126a0da28d7ca49112d8', dirty: true, dirtyPorcelain: ' M sample', sourceInputs: {}, glbExport: manualGlbExport(),
    artifacts: { glb: fileArtifact(directory, 'house.glb'), renderConfig: fileArtifact(directory, 'render-config.json'), projectRenderFacts: fileArtifact(directory, 'project-render-facts.json') },
    // 故意不经 assertCurtainNodesConsistent：负例 bundle 模拟"导出不一致但仍被打包"的场景，由 verify 拒绝
    curtainPresentation: {
      snapshotSha256: facts.presentation.curtains.snapshotSha256,
      effectiveByRoom: { ...facts.presentation.curtains.effectiveByRoom },
      expectedNodeIds: facts.presentation.curtains.curtains.flatMap((curtain) => curtain.expectedVisibleNodes).sort(),
      actualNodeIds: glbSummary.nodeIds.filter((name) => knownCurtainIds.has(name.split(':')[0])).sort(),
    },
    summaries: { glb: glbSummary, projectRenderFacts: facts },
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

test('verifyRenderBundle accepts a GLB whose curtain nodes match the facts projection', () => {
  const facts = curtainFacts('curtain_living_south', 'living_dining', 'sheer_blackout', 'privacy');
  const directory = makeCurtainBundle(facts, facts.presentation.curtains.curtains[0].expectedVisibleNodes);
  try {
    const manifest = verifyRenderBundle(directory);
    assert.deepEqual(manifest.curtainPresentation.expectedNodeIds, [
      'curtain_living_south:blackout:gathered:left',
      'curtain_living_south:blackout:gathered:right',
      'curtain_living_south:sheer:deployed',
    ]);
    assert.deepEqual(manifest.curtainPresentation.actualNodeIds, manifest.curtainPresentation.expectedNodeIds);
    assert.equal(manifest.curtainPresentation.snapshotSha256, facts.presentation.curtains.snapshotSha256);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects privacy GLB nodes when the configuration is open', () => {
  const facts = curtainFacts('curtain_living_south', 'living_dining', 'sheer_blackout', 'open');
  const directory = makeCurtainBundle(facts, expectedVisibleCurtainNodes('curtain_living_south', 'sheer_blackout', 'privacy'));
  try {
    assert.throws(() => verifyRenderBundle(directory), /unexpected curtain nodes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects a GLB whose curtain state drifts from the configured room state', () => {
  const facts = curtainFacts('curtain_master_west', 'master_bedroom', 'sheer_blackout', 'blackout');
  const directory = makeCurtainBundle(facts, ['curtain_master_west:sheer:deployed']);
  try {
    assert.throws(() => verifyRenderBundle(directory), /missing expected curtain nodes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects duplicate and unknown curtain nodes', () => {
  const facts = curtainFacts('curtain_living_south', 'living_dining', 'sheer_blackout', 'blackout');
  const duplicate = makeCurtainBundle(facts, [...facts.presentation.curtains.curtains[0].expectedVisibleNodes, 'curtain_living_south:sheer:deployed']);
  try {
    assert.throws(() => verifyRenderBundle(duplicate), /duplicate curtain nodes/);
  } finally {
    rmSync(duplicate, { recursive: true, force: true });
  }

  const unknown = makeCurtainBundle(facts, [...facts.presentation.curtains.curtains[0].expectedVisibleNodes, 'asset:sheer:w_liv_south']);
  try {
    assert.throws(() => verifyRenderBundle(unknown), /unknown curtain nodes/);
  } finally {
    rmSync(unknown, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects manifests whose curtainPresentation drifts from facts and GLB', () => {
  const facts = curtainFacts('curtain_living_south', 'living_dining', 'sheer_blackout', 'blackout');
  const directory = makeCurtainBundle(facts, facts.presentation.curtains.curtains[0].expectedVisibleNodes);
  try {
    const manifestPath = join(directory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RenderBundleManifest;
    manifest.curtainPresentation.effectiveByRoom = { living_dining: 'privacy' };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyRenderBundle(directory), /curtainPresentation must match/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle rejects legacy schema manifests with an explicit error', () => {
  const { directory } = makeBundle();
  try {
    const manifestPath = join(directory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RenderBundleManifest;
    manifest.schemaVersion = '1.1' as RenderBundleManifest['schemaVersion'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(() => verifyRenderBundle(directory), /Legacy render bundle manifest schema 1\.1.*rebuild/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verifyRenderBundle fails a clean bundle when curtain source inputs change', () => {
  const root = mkdtempSync(join(tmpdir(), 'render-bundle-root-'));
  const bundleDirectory = mkdtempSync(join(tmpdir(), 'render-bundle-clean-'));
  try {
    for (const file of SOURCE_INPUTS) {
      mkdirSync(join(root, file.split('/').slice(0, -1).join('/')), { recursive: true });
      copyFileSync(file, join(root, file));
    }
    const projection = buildProjectRenderFactsFromFiles(root);
    writeFileSync(join(bundleDirectory, 'house.glb'), makeGlb());
    writeFileSync(join(bundleDirectory, 'project-render-facts.json'), serializeProjectRenderFacts(projection));
    writeFileSync(join(bundleDirectory, 'render-config.json'), serializeRenderConfig(projection));
    const glbSummary = inspectGlb(join(bundleDirectory, 'house.glb'));
    const manifest: RenderBundleManifest = {
      schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
      revision: git(['rev-parse', 'HEAD']),
      dirty: false,
      dirtyPorcelain: '',
      sourceInputs: Object.fromEntries(SOURCE_INPUTS.map((input) => [input, fileArtifact(root, input).sha256])),
      glbExport: manualGlbExport(),
      artifacts: {
        glb: fileArtifact(bundleDirectory, 'house.glb'),
        renderConfig: fileArtifact(bundleDirectory, 'render-config.json'),
        projectRenderFacts: fileArtifact(bundleDirectory, 'project-render-facts.json'),
      },
      curtainPresentation: assertCurtainNodesConsistent(glbSummary, projection.presentation.curtains),
      summaries: { glb: glbSummary, projectRenderFacts: projection },
    };
    writeFileSync(join(bundleDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    assert.deepEqual(verifyRenderBundle(bundleDirectory, root), manifest);

    const presentationPath = join(root, 'data/presentation-state.json');
    const presentation = JSON.parse(readFileSync(presentationPath, 'utf8')) as { default: string; updatedAt: string };
    presentation.default = 'privacy';
    presentation.updatedAt = '2026-08-25T09:00:00.000Z';
    writeFileSync(presentationPath, `${JSON.stringify(presentation, null, 2)}\n`);
    assert.throws(() => verifyRenderBundle(bundleDirectory, root), /source input drift: data\/presentation-state\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bundleDirectory, { recursive: true, force: true });
  }
});
