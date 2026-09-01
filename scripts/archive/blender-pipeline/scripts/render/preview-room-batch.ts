import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_CONFIG_PATH = 'scripts/blender/render-config.json';
export const DEFAULT_SCENARIO = 'material_review';
export const DEFAULT_RES = '50';
export const DEFAULT_SAMPLES = '64';

export type PreviewRoomBatchArgs = {
  configPath: string;
  rooms?: string[];
  scenario: string;
  res: string;
  samples: string;
  json: boolean;
  out?: string;
};

type RawCamera = { id?: unknown; room?: unknown };
type RawScenario = { id?: unknown };
type RenderConfig = { cameras?: unknown; scenarios?: unknown };

export type PreviewRoomPlan = {
  room: string;
  cameras: string[];
  command: string;
};

export type PreviewRoomBatchPlan = {
  configPath: string;
  scenario: string;
  res: string;
  samples: string;
  rooms: PreviewRoomPlan[];
};

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function valueAfter(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parseList(value: string, option: string): string[] {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${option} must contain at least one room`);
  return [...new Set(values)];
}

function positiveNumber(value: string, option: string): string {
  if (!/^\d+(?:\.\d+)?$/u.test(value) || Number(value) <= 0) throw new Error(`${option} must be a positive number`);
  return value;
}

export function parseArgs(argv: string[]): PreviewRoomBatchArgs {
  let configPath = DEFAULT_CONFIG_PATH;
  let rooms: string[] | undefined;
  let scenario = DEFAULT_SCENARIO;
  let res = DEFAULT_RES;
  let samples = DEFAULT_SAMPLES;
  let json = false;
  let out: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--rooms': rooms = parseList(valueAfter(argv, index++, argument), argument); break;
      case '--scenario': scenario = nonEmpty(valueAfter(argv, index++, argument), argument); break;
      case '--res': res = positiveNumber(valueAfter(argv, index++, argument), argument); break;
      case '--samples': samples = positiveNumber(valueAfter(argv, index++, argument), argument); break;
      case '--json': json = true; break;
      case '--out': out = nonEmpty(valueAfter(argv, index++, argument), argument); break;
      case '--config': configPath = nonEmpty(valueAfter(argv, index++, argument), argument); break;
      case '--help': throw new Error('usage: tsx scripts/render/preview-room-batch.ts [--config <render-config.json>] [--rooms <room,...>] [--scenario <id>] [--res <value>] [--samples <value>] [--json] [--out <path>]');
      default: throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { configPath, rooms, scenario, res, samples, json, out };
}

function configArray<T>(config: RenderConfig, key: 'cameras' | 'scenarios'): T[] {
  const values = config[key];
  if (!Array.isArray(values)) throw new Error(`render-config.json must contain a ${key} array`);
  return values as T[];
}

export function buildPreviewRoomBatchPlan(
  config: unknown,
  options: Pick<PreviewRoomBatchArgs, 'configPath' | 'rooms' | 'scenario' | 'res' | 'samples'>,
): PreviewRoomBatchPlan {
  if (!config || typeof config !== 'object') throw new Error('render-config.json must contain an object');
  const cameras = configArray<RawCamera>(config as RenderConfig, 'cameras');
  const scenarios = configArray<RawScenario>(config as RenderConfig, 'scenarios');
  const scenarioIds = new Set(scenarios.map((scenario) => nonEmpty(scenario.id, 'scenario id')));
  if (!scenarioIds.has(options.scenario)) throw new Error(`unknown scenario: ${options.scenario}`);

  const grouped = new Map<string, string[]>();
  for (const camera of cameras) {
    const id = nonEmpty(camera.id, 'camera id');
    const room = nonEmpty(camera.room, `camera ${id} room`);
    const ids = grouped.get(room) ?? [];
    ids.push(id);
    grouped.set(room, ids);
  }
  const selectedRooms = options.rooms ?? [...grouped.keys()];
  for (const room of selectedRooms) if (!grouped.has(room)) throw new Error(`unknown room: ${room}`);

  const rooms = selectedRooms.map((room) => {
    const cameraIds = grouped.get(room)!;
    const command = [
      'scripts/run-blender.sh',
      '--glb <house.glb>',
      `--config ${options.configPath}`,
      '--config-dir .',
      `--out-dir tmp/preview/${room}`,
      `--version preview-${room}`,
      '--mode preview',
      `--preview-room ${room}`,
      `--only ${cameraIds.join(',')}`,
      `--scenario ${options.scenario}`,
      `--res ${options.res}`,
      `--samples ${options.samples}`,
    ].join(' \\\n  ');
    return { room, cameras: cameraIds, command };
  });
  return { configPath: options.configPath, scenario: options.scenario, res: options.res, samples: options.samples, rooms };
}

export function readPreviewRoomBatchPlan(args: PreviewRoomBatchArgs, root = '.'): PreviewRoomBatchPlan {
  const path = resolve(root, args.configPath);
  let config: unknown;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`Unable to read ${args.configPath}: ${error instanceof Error ? error.message : String(error)}`); }
  return buildPreviewRoomBatchPlan(config, args);
}

export function formatPreviewRoomBatchPlan(plan: PreviewRoomBatchPlan, json: boolean): string {
  if (json) return `${JSON.stringify(plan, null, 2)}\n`;
  const lines = [
    `preview room batch: scenario=${plan.scenario} res=${plan.res} samples=${plan.samples}`,
    ...plan.rooms.flatMap(({ room, cameras, command }) => [`${room}: cameras=${cameras.join(',')}`, command]),
  ];
  return `${lines.join('\n')}\n`;
}

function main(argv: string[]): void {
  try {
    const args = parseArgs(argv);
    const output = formatPreviewRoomBatchPlan(readPreviewRoomBatchPlan(args), args.json);
    if (args.out) writeFileSync(resolve(args.out), output);
    else process.stdout.write(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && /preview-room-batch\.(ts|js)$/u.test(process.argv[1])) main(process.argv.slice(2));
