import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exportObjectTreeToGlbData } from '../shared/render/export-gltf.js';
import { buildCliHouseScene } from './cli-glb-builder.js';
import { installNodeFileReader } from './node-gltf-runtime.js';

interface Options {
  output: string;
  layout?: string;
  house?: string;
  overlay?: string;
  ceiling?: string;
  renderFacts?: string;
}

export function assertOutputPathAvailable(output: string): void {
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing output file: ${output}`);
}

export function parseArgs(argv: string[]): Options {
  const options: Partial<Options> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') options.output = argv[++i];
    else if (arg === '--layout') options.layout = argv[++i];
    else if (arg === '--house') options.house = argv[++i];
    else if (arg === '--overlay') options.overlay = argv[++i];
    else if (arg === '--ceiling') options.ceiling = argv[++i];
    else if (arg === '--render-facts') options.renderFacts = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.output) throw new Error('usage: npm run export:glb -- --output <file.glb> [--layout <file>] [--house <file>] [--overlay <file>] [--ceiling <file>] [--render-facts <file.json>]');
  return options as Options;
}

async function main(): Promise<void> {
  installNodeFileReader();
  const options = parseArgs(process.argv.slice(2));
  const { exportRoot, report } = buildCliHouseScene(options.layout, options.house, options.overlay, options.ceiling, options.renderFacts);
  const bytes = await exportObjectTreeToGlbData(exportRoot);
  const output = resolve(options.output);
  assertOutputPathAvailable(output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  console.log(JSON.stringify({ output, bytes: bytes.byteLength, report }, null, 2));
}

if (process.argv[1] && /export-glb\.(ts|js)$/u.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
