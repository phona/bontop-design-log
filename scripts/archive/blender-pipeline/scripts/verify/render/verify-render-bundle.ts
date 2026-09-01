import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { inspectGlb } from '../../render/glb/inspect-glb.js';
import {
  RENDER_BUNDLE_SCHEMA_VERSION,
  assertCurtainNodesConsistent,
  assertDeliverableGlb,
  deepEqualJson,
  fileArtifact,
  git,
  renderInputFingerprints,
  resolveBundlePath,
  assertRenderOutputMetadata,
  type BundleArtifact,
  type RenderBundleManifest,
} from '../../render/bundle/render-bundle-utils.js';
import { parseProjectRenderFactsProjection } from '../../../shared/project-render-facts-schema.js';
import { buildProjectRenderFactsFromFiles, serializeProjectRenderFacts } from '../../project-render-facts-projection.js';
import { REQUIRED_RESOURCE_DIRECTORIES, REQUIRED_RESOURCE_FILES, SOURCE_INPUTS } from '../../render/bundle/build-render-bundle.js';
import { serializeRenderConfig } from '../../blender/gen-render-config.js';

function usage(): never {
  throw new Error('usage: tsx scripts/verify/render/verify-render-bundle.ts --bundle <dir>');
}

export function parseVerifyRenderBundleArgs(argv: string[]): { bundle: string } {
  if (argv.length !== 2 || argv[0] !== '--bundle' || !argv[1]) usage();
  return { bundle: argv[1] };
}

function parseManifest(raw: unknown): RenderBundleManifest {
  if (!raw || typeof raw !== 'object') throw new Error('manifest must be an object');
  const manifest = raw as Partial<RenderBundleManifest>;
  if (manifest.schemaVersion !== RENDER_BUNDLE_SCHEMA_VERSION) {
    const legacy = typeof manifest.schemaVersion === 'string' && /^1\.[0-9]+$/u.test(manifest.schemaVersion);
    if (legacy) {
      throw new Error(`Legacy render bundle manifest schema ${manifest.schemaVersion} is rejected for render verification; rebuild the bundle with schema ${RENDER_BUNDLE_SCHEMA_VERSION}`);
    }
    throw new Error(`Unsupported render bundle manifest schema: ${String(manifest.schemaVersion)}`);
  }
  if (typeof manifest.revision !== 'string' || !/^[0-9a-f]{40}$/u.test(manifest.revision)) throw new Error('manifest revision must be a full git SHA');
  if (typeof manifest.dirty !== 'boolean' || typeof manifest.dirtyPorcelain !== 'string') throw new Error('manifest dirty state is invalid');
  if (!manifest.sourceInputs || !manifest.glbExport || !manifest.artifacts || !manifest.summaries || !manifest.curtainPresentation || !Array.isArray(manifest.resources)) throw new Error('manifest is missing sourceInputs, resources, glbExport, artifacts, curtainPresentation, or summaries');
  const fingerprints = manifest.inputFingerprints;
  if (!fingerprints || typeof fingerprints !== 'object' || Object.keys(fingerprints).length !== 4 || !Object.values(fingerprints).every((value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value))) {
    throw new Error('manifest inputFingerprints are required and must contain four SHA-256 values');
  }
  if (manifest.glbExport.method !== 'manual_web_export' && manifest.glbExport.method !== 'cli_shared_builder') throw new Error('manifest GLB export method is invalid');
  if (typeof manifest.glbExport.inputBasename !== 'string' || !manifest.glbExport.inputBasename || basename(manifest.glbExport.inputBasename) !== manifest.glbExport.inputBasename || manifest.glbExport.inputBasename.includes('\\') || manifest.glbExport.inputBasename.includes('\0')) {
    throw new Error('manifest GLB input basename is invalid');
  }
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
  const paths = [...Object.values(manifest.artifacts).map((artifact) => artifact.path), ...manifest.resources.map((artifact) => artifact.path)];
  if (new Set(paths).size !== paths.length) throw new Error('Bundle artifact paths must be distinct');
}

function verifyResources(bundle: string, resources: BundleArtifact[]): void {
  for (const resource of resources) verifyArtifact(bundle, resource);
  const resourcePaths = new Set(resources.map((resource) => resource.path));
  const missingFiles = REQUIRED_RESOURCE_FILES.filter((path) => !resourcePaths.has(path));
  if (missingFiles.length > 0) throw new Error(`Bundle resources missing required file(s): ${missingFiles.join(', ')}`);
  for (const directory of REQUIRED_RESOURCE_DIRECTORIES) {
    if (!resources.some((resource) => resource.path.startsWith(`${directory}/`))) {
      throw new Error(`Bundle resources missing required directory: ${directory}`);
    }
  }
}

function relativeResourcePath(value: unknown, materialId: string, channel: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Material ${materialId} ${channel} resource path must be a non-empty string`);
  const path = value.replaceAll('\\\\', '/');
  if (path.startsWith('/') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Material ${materialId} ${channel} resource path is unsafe: ${value}`);
  }
  return path;
}

export function verifyMaterialResources(bundle: string, resources: BundleArtifact[]): void {
  const materialPath = resolveBundlePath(bundle, 'config/materials.yaml');
  const document = loadYaml(readFileSync(materialPath, 'utf8')) as { materials?: unknown };
  if (!document || !Array.isArray(document.materials)) throw new Error('materials.yaml materials must be an array');
  const resourcePaths = new Set(resources.map((resource) => resource.path));
  for (const material of document.materials) {
    if (!material || typeof material !== 'object') continue;
    const record = material as { id?: unknown; appearance?: unknown };
    const materialId = typeof record.id === 'string' && record.id ? record.id : '<unknown>';
    if (!record.appearance || typeof record.appearance !== 'object') continue;
    const appearance = record.appearance as { type?: unknown; texture_id?: unknown; resource_root?: unknown; resources?: unknown; base_color_mode?: unknown };
    if (appearance.type !== 'external_pbr' && appearance.type !== 'blenderkit_pbr' && appearance.type !== 'pbr_texture') continue;
    const explicit = appearance.resources && typeof appearance.resources === 'object' ? appearance.resources as Record<string, unknown> : {};
    const root = typeof appearance.resource_root === 'string' && appearance.resource_root
      ? appearance.resource_root
      : typeof appearance.texture_id === 'string' && appearance.texture_id
        ? `assets/textures/${appearance.texture_id}`
        : '';
    const paths: Record<string, string> = {};
    const aliases: Record<string, string[]> = { base_color: ['base_color', 'diffuse'], normal: ['normal'], roughness: ['roughness'] };
    for (const channel of Object.keys(aliases)) {
      const declared = aliases[channel].map((key) => explicit[key]).find((value) => value !== undefined);
      paths[channel] = declared === undefined ? (root ? `${root}/${channel === 'base_color' ? 'diff.jpg' : channel === 'roughness' ? 'rough.jpg' : 'normal.jpg'}` : '') : relativeResourcePath(declared, materialId, channel);
    }
    const required = appearance.type === 'pbr_texture' || appearance.base_color_mode !== 'preserve_color'
      ? ['base_color', 'normal', 'roughness']
      : ['normal', 'roughness'];
    for (const channel of required) {
      const path = paths[channel];
      if (!path) throw new Error(`Material ${materialId} missing required ${channel} resource`);
      if (!resourcePaths.has(path)) throw new Error(`Material ${materialId} required ${channel} resource is not bundled: ${path}`);
      verifyArtifact(bundle, resources.find((resource) => resource.path === path)!);
    }
  }
}

export function verifyRenderConfigResources(bundle: string, resources: BundleArtifact[], config: unknown): void {
  if (!config || typeof config !== 'object') throw new Error('render-config must be an object');
  const scenarios = (config as { scenarios?: unknown }).scenarios;
  if (scenarios === undefined) return;
  if (!Array.isArray(scenarios)) throw new Error('render-config scenarios must be an array');
  const resourcePaths = new Set(resources.map((resource) => resource.path));
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== 'object') continue;
    const hdri = (scenario as { world_hdri?: unknown }).world_hdri;
    if (hdri === undefined) continue;
    if (typeof hdri !== 'string' || !hdri) throw new Error('render-config world_hdri must be a non-empty relative path');
    const hdriPath = resolveBundlePath(bundle, hdri);
    if (!resourcePaths.has(hdri)) throw new Error(`render-config HDRI is not listed as a bundle resource: ${hdri}`);
    if (!existsSync(hdriPath)) throw new Error(`Missing bundle HDRI resource: ${hdri}`);
  }
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
  verifyResources(bundle, manifest.resources);
  verifyMaterialResources(bundle, manifest.resources);
  const facts = parseProjectRenderFactsProjection(JSON.parse(readFileSync(factsPath, 'utf8')));
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as { facts?: unknown; scenarios?: unknown };
  verifyRenderConfigResources(bundle, manifest.resources, config);
  const expected = renderInputFingerprints(manifest.sourceInputs, manifest.resources, manifest.artifacts);
  assert.deepEqual(manifest.inputFingerprints, expected, 'manifest inputFingerprints must match its inputs');
  assert.deepEqual(config.facts, facts, 'render-config facts must deeply equal project-render-facts');
  assert.deepEqual(manifest.summaries.projectRenderFacts, facts, 'manifest facts summary must match facts artifact');

  const glbSummary = inspectGlb(glbPath);
  assert.deepEqual(glbSummary, manifest.summaries.glb, 'manifest GLB summary must match GLB artifact');
  assertDeliverableGlb(glbSummary);
  const curtainPresentation = assertCurtainNodesConsistent(glbSummary, facts.presentation.curtains);
  assert.deepEqual(manifest.curtainPresentation, curtainPresentation, 'manifest curtainPresentation must match facts projection and GLB curtain nodes');

  if (!manifest.dirty) {
    const currentRevision = git(['rev-parse', 'HEAD']);
    if (currentRevision !== manifest.revision) throw new Error(`Clean bundle revision mismatch: HEAD ${currentRevision}, manifest ${manifest.revision}`);
    for (const input of SOURCE_INPUTS) {
      const recorded = manifest.sourceInputs[input];
      if (!recorded) throw new Error(`Clean bundle sourceInputs missing ${input}`);
      const current = fileArtifact(rootDir, input).sha256;
      if (current !== recorded) throw new Error(`Clean bundle source input drift: ${input}`);
    }
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
