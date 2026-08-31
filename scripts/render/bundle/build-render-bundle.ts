import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectGlb } from '../glb/inspect-glb.js';
import { exportCliGlb } from '../glb/export-glb.js';
import {
  RENDER_BUNDLE_SCHEMA_VERSION,
  assertCurtainNodesConsistent,
  assertDeliverableGlb,
  fileArtifact,
  git,
  renderInputFingerprints,
  type BundleArtifact,
  type RenderBundleManifest,
} from './render-bundle-utils.js';
import { parseProjectRenderFactsProjection } from '../../../shared/project-render-facts-schema.js';

interface Args {
  glb?: string;
  outputDir: string;
  allowDirty: boolean;
  previewRoom?: string;
}

const ASSET_DECLARATION_PATH = 'data/render-bundle-assets.json' as const;

interface RenderBundleAssetDeclaration {
  schema: 'bontop.render-bundle-assets';
  version: number;
  rooms: Record<string, string[]>;
}

function readAssetDeclaration(root = '.'): RenderBundleAssetDeclaration {
  const path = resolve(root, ASSET_DECLARATION_PATH);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing render bundle asset declaration: ${ASSET_DECLARATION_PATH}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid render bundle asset declaration: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Render bundle asset declaration must be an object');
  const declaration = parsed as Partial<RenderBundleAssetDeclaration>;
  const version = declaration.version;
  if (declaration.schema !== 'bontop.render-bundle-assets' || !Number.isInteger(version) || typeof version !== 'number' || version < 1 || !declaration.rooms || typeof declaration.rooms !== 'object' || Array.isArray(declaration.rooms)) {
    throw new Error('Render bundle asset declaration has an invalid schema, version, or rooms map');
  }
  for (const [room, assets] of Object.entries(declaration.rooms)) {
    if (!room || !Array.isArray(assets) || assets.some((asset) => typeof asset !== 'string' || !asset.startsWith('assets/furniture/') || asset.endsWith('/') || asset.split('/').some((part) => part === '' || part === '.' || part === '..'))) {
      throw new Error(`Render bundle asset declaration has invalid assets for room: ${room}`);
    }
  }
  return {
    schema: 'bontop.render-bundle-assets',
    version,
    rooms: declaration.rooms as Record<string, string[]>,
  };
}

function assetDirectoryName(path: string): string {
  return path.slice('assets/furniture/'.length);
}

// Kept as a compatibility export; values are derived from the authoritative declaration.
export const PREVIEW_ROOM_ASSET_DIRECTORIES = Object.fromEntries(
  Object.entries(readAssetDeclaration().rooms).map(([room, assets]) => [room, assets.map(assetDirectoryName)]),
) as Record<string, string[]>;

export type PreviewRoom = string;

type ResourceScope =
  | { profile: 'formal' }
  | { profile: 'preview'; room: PreviewRoom; assetDeclaration: { path: typeof ASSET_DECLARATION_PATH; version: number; sha256: string } };

function isPreviewRoom(value: string, declaration = readAssetDeclaration()): value is PreviewRoom {
  return Object.prototype.hasOwnProperty.call(declaration.rooms, value);
}

export const SOURCE_INPUTS = [
  'config/house.yaml',
  'config/materials.yaml',
  'config/electrical.yaml',
  'config/plumbing.yaml',
  'config/ceiling.yaml',
  'config/hvac.yaml',
  'config/render/overrides.yaml',
  'config/layout/overlay.yaml',
  'config/layout/model-geometry.yaml',
  'shared/render/SceneBuilder.ts',
  'shared/render/FixtureFactory.ts',
  'shared/render/InfrastructureBuilder.ts',
  'shared/render/LightingFixtureBuilder.ts',
  'shared/render/export-gltf.ts',
  'scripts/render/glb/export-glb.ts',
  'scripts/blender/dress_scene.py',
  'scripts/blender/legacy_geometry.py',
  'scripts/blender/blender_assets.py',
  'scripts/blender/blender_render_only.py',
  'scripts/blender/blender_preview.py',
  'scripts/blender/scene_asset_registry.py',
  'data/scene-asset-registry.json',
  'data/blender-asset-registry.json',
  'scripts/blender/blender_lighting.py',
  'scripts/blender/blender_environment.py',
  'scripts/blender/gen-render-config.ts',
  'data/current-scheme.json',
  'data/presentation-state.json',
  'data/render-decision-boards.json',
  ASSET_DECLARATION_PATH,
] as const;

export const RESOURCE_FILES = [
  'config/materials.yaml',
  'data/current-scheme.json',
  'data/presentation-state.json',
  'data/render-decision-boards.json',
  ASSET_DECLARATION_PATH,
  'scripts/blender/dress_scene.py',
  'scripts/blender/legacy_geometry.py',
  'scripts/blender/blender_assets.py',
  'scripts/blender/blender_render_only.py',
  'scripts/blender/blender_preview.py',
  'scripts/blender/scene_asset_registry.py',
  'data/scene-asset-registry.json',
  'data/blender-asset-registry.json',
  'scripts/blender/blender_lighting.py',
  'scripts/blender/blender_environment.py',
  'scripts/blender/gen-render-config.ts',
  'scripts/blender/materials_from_yaml.py',
  'scripts/blender/wood_texture.py',
  'scripts/blender/blenderkit_packed_pbr.py',
  'scripts/blender/curtain_projection.py',
  'scripts/blender/dress_config.py',
] as const;

// Optional asset trees are copied when present; verifier only requires files actually referenced by the bundle.
export const RESOURCE_DIRECTORIES = ['assets/textures', 'assets/furniture', 'renders/blender/textures', 'hdri'] as const;
export const REQUIRED_RESOURCE_DIRECTORIES = ['hdri'] as const;

export const REQUIRED_RESOURCE_FILES = [
  'config/materials.yaml',
  'data/current-scheme.json',
  ASSET_DECLARATION_PATH,
  'scripts/blender/dress_scene.py',
  'scripts/blender/legacy_geometry.py',
  'scripts/blender/blender_assets.py',
  'scripts/blender/blender_render_only.py',
  'scripts/blender/blender_preview.py',
  'scripts/blender/scene_asset_registry.py',
  'data/scene-asset-registry.json',
  'data/blender-asset-registry.json',
  'scripts/blender/blender_lighting.py',
  'scripts/blender/blender_environment.py',
  'scripts/blender/gen-render-config.ts',
  'scripts/blender/dress_config.py',
  'scripts/blender/materials_from_yaml.py',
  'scripts/blender/wood_texture.py',
  'scripts/blender/curtain_projection.py',
  'scripts/blender/blenderkit_packed_pbr.py',
] as const;

function resourcePaths(root = '.', resourceScope: ResourceScope = { profile: 'formal' }): string[] {
  const paths: string[] = [...RESOURCE_FILES];
  const declaration = readAssetDeclaration(root);
  const directories = resourceScope.profile === 'formal'
    ? RESOURCE_DIRECTORIES
    : ['assets/textures', ...declaration.rooms[resourceScope.room], 'renders/blender/textures', 'hdri'];
  for (const directory of directories) {
    const absolute = resolve(root, directory);
    if (!existsSync(absolute)) {
      if (directory === 'hdri') throw new Error(`Missing required render bundle resource directory: ${directory}`);
      continue;
    }
    const visit = (current: string) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '__pycache__' || entry.name === 'node_modules' || (resourceScope.profile === 'preview' && entry.name === 'blenderkit_candidates')) continue;
        const absoluteEntry = resolve(current, entry.name);
        if (entry.isDirectory()) visit(absoluteEntry);
        else if (entry.isFile()) paths.push(relative(resolve(root), absoluteEntry).replaceAll('\\', '/'));
      }
    };
    visit(absolute);
  }
  const missing = REQUIRED_RESOURCE_FILES.filter((path) => !paths.includes(path));
  if (missing.length > 0) throw new Error(`Missing required render bundle resource: ${missing.join(', ')}`);
  return [...new Set(paths)];
}

export function copyBundleResources(outputDir: string, root = '.', resourceScope: ResourceScope = { profile: 'formal' }): BundleArtifact[] {
  const resources: BundleArtifact[] = [];
  for (const path of resourcePaths(root, resourceScope)) {
    const source = resolve(root, path);
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Missing required render bundle resource: ${path}`);
    const target = resolve(outputDir, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
    resources.push(fileArtifact(outputDir, path));
  }
  return resources;
}

function usage(): never {
  throw new Error('usage: tsx scripts/render/bundle/build-render-bundle.ts [--glb <path>] --output-dir <dir> [--allow-dirty] [--preview-room <room>]');
}

export function parseBuildRenderBundleArgs(argv: string[]): Args {
  const args: Partial<Args> = { allowDirty: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) usage();
      return next;
    };
    switch (argument) {
      case '--glb': args.glb = value(); break;
      case '--output-dir': args.outputDir = value(); break;
      case '--allow-dirty': args.allowDirty = true; break;
      case '--preview-room': args.previewRoom = value(); break;
      default: usage();
    }
  }
  const { glb, outputDir, allowDirty, previewRoom } = args;
  if (!outputDir || allowDirty === undefined || (previewRoom !== undefined && !isPreviewRoom(previewRoom))) usage();
  return glb === undefined ? { outputDir, allowDirty, ...(previewRoom ? { previewRoom } : {}) } : { glb, outputDir, allowDirty, ...(previewRoom ? { previewRoom } : {}) };
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' });
}

function assertInputGlb(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Input GLB must be an existing file: ${path}`);
}

export async function buildRenderBundle(args: Args): Promise<RenderBundleManifest> {
  const inputGlb = args.glb ? resolve(args.glb) : undefined;
  if (inputGlb) assertInputGlb(inputGlb);
  const assetDeclaration = readAssetDeclaration();
  if (args.previewRoom !== undefined && !isPreviewRoom(args.previewRoom, assetDeclaration)) {
    throw new Error(`Unknown preview room: ${args.previewRoom}`);
  }
  const resourceScope: ResourceScope = args.previewRoom
    ? {
      profile: 'preview',
      room: args.previewRoom,
      assetDeclaration: {
        path: ASSET_DECLARATION_PATH,
        version: assetDeclaration.version,
        sha256: fileArtifact('.', ASSET_DECLARATION_PATH).sha256,
      },
    }
    : { profile: 'formal' };
  const outputDir = resolve(args.outputDir);
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) throw new Error(`Refusing to overwrite non-empty bundle directory: ${outputDir}`);

  const revision = git(['rev-parse', 'HEAD']);
  const initialDirtyPorcelain = git(['status', '--porcelain=v1']);
  if (initialDirtyPorcelain.length > 0 && !args.allowDirty) throw new Error('Working tree is dirty; commit/stash changes or pass --allow-dirty to record git porcelain in the manifest');

  run('npm', ['run', 'generate:render-config']);
  run('npm', ['run', 'verify:project-render-facts']);

  mkdirSync(outputDir, { recursive: true });
  const glbName = 'house.glb';
  const renderConfigName = 'render-config.json';
  const factsName = 'project-render-facts.json';
  cpSync('scripts/blender/render-config.json', resolve(outputDir, renderConfigName));
  cpSync('scripts/blender/project-render-facts.json', resolve(outputDir, factsName));

  const factsPath = resolve(outputDir, factsName);
  const facts = parseProjectRenderFactsProjection(JSON.parse(readFileSync(factsPath, 'utf8')));
  const exportMethod = inputGlb ? 'manual_web_export' : 'cli_shared_builder';
  if (inputGlb) {
    cpSync(inputGlb, resolve(outputDir, glbName));
  } else {
    const exported = await exportCliGlb({ renderFacts: factsPath });
    writeFileSync(resolve(outputDir, glbName), exported.bytes);
  }
  const glbPath = resolve(outputDir, glbName);
  const glbSummary = inspectGlb(glbPath);
  assertDeliverableGlb(glbSummary);
  const curtainPresentation = assertCurtainNodesConsistent(glbSummary, facts.presentation.curtains);
  const resources = copyBundleResources(outputDir, '.', resourceScope);
  const sourceInputs = Object.fromEntries(SOURCE_INPUTS.map((path) => [path, fileArtifact('.', path).sha256]));
  const artifacts = {
    glb: fileArtifact(outputDir, glbName),
    renderConfig: fileArtifact(outputDir, renderConfigName),
    projectRenderFacts: fileArtifact(outputDir, factsName),
  };
  const finalDirtyPorcelain = git(['status', '--porcelain=v1']);
  const finalDirty = finalDirtyPorcelain.length > 0;
  const inputFingerprints = renderInputFingerprints(sourceInputs, resources, artifacts);
  const manifest = {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision,
    dirty: finalDirty,
    dirtyPorcelain: finalDirtyPorcelain,
    sourceInputs,
    resources,
    resourceScope,
    inputFingerprints,
    glbExport: { method: exportMethod, inputBasename: inputGlb ? basename(inputGlb) : glbName },
    artifacts,
    curtainPresentation,
    summaries: { glb: glbSummary, projectRenderFacts: facts },
  } as RenderBundleManifest & { resourceScope: ResourceScope };
  writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Render bundle created: ${outputDir}`);
  return manifest;
}

async function main(): Promise<void> {
  try {
    await buildRenderBundle(parseBuildRenderBundleArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Build render bundle failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith('build-render-bundle.')) main();
