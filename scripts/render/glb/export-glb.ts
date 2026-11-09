import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { exportObjectTreeToGlbData } from '../../../shared/render/export-gltf.js';
import { buildCliHouseScene } from './cli-glb-builder.js';
import { installNodeFileReader } from './node-gltf-runtime.js';

export interface CliGlbOptions {
  layout?: string;
  house?: string;
  ceiling?: string;
  renderFacts?: string;
}

export interface CliGlbExport {
  bytes: Uint8Array;
  report: ReturnType<typeof buildCliHouseScene>['report'];
}

interface Options extends CliGlbOptions {
  output: string;
}

export function assertOutputPathAvailable(output: string): void {
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing output file: ${output}`);
}

const USAGE = 'usage: npm run export:glb -- --output <file.glb> [--layout <file>] [--house <file>] [--ceiling <file>] [--render-facts <file.json>]';

export function parseArgs(argv: string[]): Options {
  const options: Partial<Options> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') throw new Error(USAGE);
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--layout') options.layout = argv[++i];
    else if (arg === '--house') options.house = argv[++i];
    else if (arg === '--ceiling') options.ceiling = argv[++i];
    else if (arg === '--render-facts') options.renderFacts = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.output) throw new Error('usage: npm run export:glb -- --output <file.glb> [--layout <file>] [--house <file>] [--ceiling <file>] [--render-facts <file.json>]');
  return options as Options;
}

export async function exportCliGlb(options: CliGlbOptions = {}): Promise<CliGlbExport> {
  installNodeFileReader();
  const { exportRoot, report } = buildCliHouseScene(options.layout, options.house, options.ceiling, options.renderFacts);
  // 定位诊断 = 场景缺件（issue #98；与 shared/dxf/project-dxf.ts 的 errors 同一通道、同一
  // fail-closed 语义）：SceneBuilder 把定位声明解不出来的家具（断引用/along 越界/负净宽/mount
  // 宿主缺失）、暖通 anchor、冷凝链记进 report.placementDiagnostics 并跳过该件。非空即本次
  // 导出不成立——不序列化、不写文件、非零退出，禁止把页面宽容预览的局部降级写成成功交付物。
  // 只允许在此判失败，不得降级成 warning 后照常导出。
  if (report.placementDiagnostics.length > 0) {
    const diagnostics = report.placementDiagnostics;
    for (const diagnostic of diagnostics) console.error(`ERROR ${diagnostic}`);
    throw new Error(`GLB 导出失败：${diagnostics.length} 条定位诊断（家具摆位/暖通锚点/冷凝链），修复配置后重导：${diagnostics[0]}${diagnostics.length > 1 ? ' 等' : ''}`);
  }
  const result = await exportObjectTreeToGlbData(exportRoot);
  return { bytes: result instanceof ArrayBuffer ? new Uint8Array(result) : result, report };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--help')) {
    console.log(USAGE);
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const exported = await exportCliGlb(options);
  const output = resolve(options.output);
  assertOutputPathAvailable(output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, exported.bytes);
  console.log(JSON.stringify({ output, bytes: exported.bytes.byteLength, report: exported.report }, null, 2));
}

if (process.argv[1] && /export-glb\.(ts|js)$/u.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
