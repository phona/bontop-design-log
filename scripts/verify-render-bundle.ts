import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { inspectGlb } from './inspect-glb.js';
import {
  RENDER_BUNDLE_SCHEMA_VERSION,
  assertDeliverableGlb,
  deepEqualJson,
  fileArtifact,
  git,
  resolveBundlePath,
  type BundleArtifact,
  type RenderBundleManifest,
} from './render-bundle-utils.js';
import { parseProjectRenderFactsProjection } from '../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsFromFiles, serializeProjectRenderFacts } from './project-render-facts-projection.js';
import { serializeRenderConfig } from './blender/gen-render-config.js';

function usage(): never {
  throw new Error('usage: tsx scripts/verify-render-bundle.ts --bundle <dir>');
}

export function parseVerifyRenderBundleArgs(argv: string[]): { bundle: string } {
  if (argv.length !== 2 || argv[0] !== '--bundle' || !argv[1]) usage();
  return { bundle: argv[1] };
}

function parseManifest(raw: unknown): RenderBundleManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest must be an object');
  const manifest = raw as Partial<RenderBundleManifest>;
  if (manifest.schemaVersion !== RENDER_BUNDLE_SCHEMA_VERSION) throw new Error(`Unsupported render bundle manifest schema: ${String(manifest.schemaVersion)}`);
  if (typeof manifest.revision !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.revision)) throw new Error('manifest revision must be a full git SHA');
  if (typeof manifest.dirty !== 'boolean' || typeof manifest.dirtyPorcelain !== 'string') throw new Error('manifest dirty state is invalid');
  if (!manifest.sourceInputs || !manifest.artifacts || !manifest.summaries) throw new Error('manifest is missing sourceInputs, artifacts, or summaries');
  return manifest as RenderBundleManifest;
}

function verifyArtifact(bundle: string, artifact: BundleArtifact): string {
  const path = resolveBundlePath(bundle, artifact.path);
  if (!existsSync(path)) throw new Error(`Missing bundle artifact: ${artifact.path}`);
  const actual = fileArtifact(bundle, artifact.path);
  if (actual.bytes !== artifact.bytes) throw new Error(`Artifact byte size mismatch: ${artifact.path}`);
  if (actual.sha256 !== artifact.sha256) throw new Error(`Artifact SHA-256 mismatch: ${artifact.path}`);
  return path;
}

function assertArtifactPathsAreDistinct(manifest: RenderBundleManifest): void {
  const paths = Object.values(manifest.artifacts).map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) throw new Error('Bundle artifact paths must be distinct');
}

export function verifyRenderBundle(bundlePath: string, rootDir = '.'): RenderBundleManifest {
  const bundle = resolve(bundlePath);
  const manifestPath = resolve(bundle, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Missing bundle manifest: ${manifestPath}`);
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  assertArtifactPathsAreDistinct(manifest);

  const glbPath = verifyArtifact(bundle, manifest.artifacts.glb);
  const configPath = verifyArtifact(bundle, manifest.artifacts.renderConfig);
  const factsPath = verifyArtifact(bundle, manifest.artifacts.projectRenderFacts);
  const facts = parseProjectRenderFactsProjection(JSON.parse(readFileSync(factsPath, 'utf8')));
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { facts?: unknown };
  assert.deepEqual(config.facts, facts, 'render-config facts must deeply equal project-render-facts');
  assert.deepEqual(manifest.summaries.projectRenderFacts, facts, 'manifest facts summary must match facts artifact');

  const glbSummary = inspectGlb(glbPath);
  assert.deepEqual(glbSummary, manifest.summaries.glb, 'manifest GLB summary must match GLB artifact');
  assertDeliverableGlb(glbSummary);

  if (!manifest.dirty) {
    const currentRevision = git(['rev-parse', 'HEAD']);
    if (currentRevision !== manifest.revision) throw new Error(`Clean bundle revision mismatch: HEAD ${currentRevision}, manifest ${manifest.revision}`);
    const projection = buildProjectRenderFactsFromFiles(rootDir);
    const expectedFacts = serializeProjectRenderFacts(projection);
    const expectedConfig = serializeRenderConfig(projection);
    if (readFileSync(factsPath, 'utf8') !== expectedFacts) throw new Error('Clean bundle project-render-facts bytes do not match current generated projection');
    if (readFileSync(configPath, 'utf8') !== expectedConfig) throw new Error('Clean bundle render-config bytes do not match current generated config');
  }
  return manifest;
}

function main(): void {
  try {
    const { bundle } = parseVerifyRenderBundleArgs(process.argv.slice(2));
    const manifest = verifyRenderBundle(bundle);
    console.log(`Render bundle verified: ${resolve(bundle)} (${manifest.dirty ? 'dirty source recorded' : 'clean reproducible source'})`);
  } catch (error) {
    console.error(`Verify render bundle failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith('verify-render-bundle.')) main();
