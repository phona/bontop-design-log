import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectGlb } from './inspect-glb.js';
import {
  RENDER_BUNDLE_SCHEMA_VERSION,
  assertDeliverableGlb,
  fileArtifact,
  git,
  type RenderBundleManifest,
} from './render-bundle-utils.js';
import { parseProjectRenderFactsProjection } from '../shared/project-render-facts-schema.js';

interface Args {
  outputDir: string;
  cdpHost: string;
  cdpPort: number;
  appUrl: string;
  timeoutSeconds: number;
  allowDirty: boolean;
}

const SOURCE_INPUTS = [
  'config/electrical.yaml',
  'config/plumbing.yaml',
  'config/ceiling.yaml',
  'config/render/overrides.yaml',
  'data/current-scheme.json',
] as const;

function usage(): never {
  throw new Error('usage: tsx scripts/build-render-bundle.ts --output-dir <dir> [--cdp-host host] [--cdp-port port] [--app-url url] [--timeout-seconds seconds] [--allow-dirty]');
}

export function parseBuildRenderBundleArgs(argv: string[]): Args {
  const args: Partial<Args> = { cdpHost: 'localhost', cdpPort: 9222, appUrl: 'http://localhost:5173', timeoutSeconds: 120, allowDirty: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) usage();
      return next;
    };
    switch (argument) {
      case '--output-dir': args.outputDir = value(); break;
      case '--cdp-host': args.cdpHost = value(); break;
      case '--cdp-port': args.cdpPort = Number(value()); break;
      case '--app-url': args.appUrl = value(); break;
      case '--timeout-seconds': args.timeoutSeconds = Number(value()); break;
      case '--allow-dirty': args.allowDirty = true; break;
      default: usage();
    }
  }
  const { outputDir, cdpHost, cdpPort, appUrl, timeoutSeconds, allowDirty } = args;
  if (!outputDir || !cdpHost || !appUrl || !Number.isInteger(cdpPort) || cdpPort === undefined || cdpPort <= 0 || !Number.isFinite(timeoutSeconds) || timeoutSeconds === undefined || timeoutSeconds <= 0 || allowDirty === undefined) usage();
  return { outputDir, cdpHost, cdpPort, appUrl, timeoutSeconds, allowDirty };
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: 'inherit' });
}

export function buildRenderBundle(args: Args): RenderBundleManifest {
  const outputDir = resolve(args.outputDir);
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) throw new Error(`Refusing to overwrite non-empty bundle directory: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true });

  const revision = git(['rev-parse', 'HEAD']);
  const dirtyPorcelain = git(['status', '--porcelain=v1']);
  const dirty = dirtyPorcelain.length > 0;
  if (dirty && !args.allowDirty) throw new Error('Working tree is dirty; commit/stash changes or pass --allow-dirty to record git porcelain in the manifest');

  run('npm', ['run', 'generate:render-config']);
  run('npm', ['run', 'verify:project-render-facts']);
  const glbName = 'house.glb';
  run('python3', [
    'scripts/export-web-glb.py', '--output', resolve(outputDir, glbName),
    '--cdp-host', args.cdpHost, '--cdp-port', String(args.cdpPort), '--app-url', args.appUrl,
    '--timeout-seconds', String(args.timeoutSeconds),
  ]);

  const glbSummary = inspectGlb(resolve(outputDir, glbName));
  assertDeliverableGlb(glbSummary);

  const renderConfigName = 'render-config.json';
  const factsName = 'project-render-facts.json';
  cpSync('scripts/blender/render-config.json', resolve(outputDir, renderConfigName));
  cpSync('scripts/blender/project-render-facts.json', resolve(outputDir, factsName));

  const facts = parseProjectRenderFactsProjection(JSON.parse(readFileSync(resolve(outputDir, factsName), 'utf8')));
  const manifest: RenderBundleManifest = {
    schemaVersion: RENDER_BUNDLE_SCHEMA_VERSION,
    revision,
    dirty,
    dirtyPorcelain,
    sourceInputs: Object.fromEntries(SOURCE_INPUTS.map((path) => [path, fileArtifact('.', path).sha256])),
    artifacts: {
      glb: fileArtifact(outputDir, glbName),
      renderConfig: fileArtifact(outputDir, renderConfigName),
      projectRenderFacts: fileArtifact(outputDir, factsName),
    },
    summaries: { glb: glbSummary, projectRenderFacts: facts },
  };
  writeFileSync(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Render bundle created: ${outputDir}`);
  return manifest;
}

function main(): void {
  try {
    buildRenderBundle(parseBuildRenderBundleArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Build render bundle failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith('build-render-bundle.')) main();
