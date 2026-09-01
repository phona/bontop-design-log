import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DEFAULT_CONFIG_PATH = 'scripts/blender/render-config.json';

export const CAMERA_CATEGORIES = ['overview', 'relationship', 'detail', 'auxiliary'] as const;
export type CameraCategory = (typeof CAMERA_CATEGORIES)[number];

type RawCamera = {
  id?: unknown;
  label?: unknown;
  room?: unknown;
  category?: unknown;
  type?: unknown;
  purpose?: unknown;
  archived?: unknown;
  archiveStatus?: unknown;
  archive?: unknown;
};

type RenderConfig = { cameras?: unknown };

export interface RoomCamera {
  id: string;
  category: CameraCategory;
  label?: string;
  archived: boolean;
}

export interface RoomCameraStats {
  cameras: number;
  overview: number;
  relationship: number;
  detail: number;
  auxiliary: number;
  cameraDetails: RoomCamera[];
}

export interface CameraCoverageReport {
  configPath: string;
  totalCameras: number;
  rooms: Record<string, RoomCameraStats>;
  unarchivedCameras: Array<{ id: string; room: string; category: CameraCategory; label?: string }>;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function roomFor(camera: RawCamera): string {
  if (text(camera.room)) return text(camera.room)!;
  const id = text(camera.id) ?? '';
  const prefixes: Array<[string, string]> = [
    ['living_', 'living_dining'], ['master_bed_', 'master_bedroom'], ['bedroom_nw_', 'bedroom_nw'],
    ['bedroom_se_', 'bedroom_se'], ['kitchen_', 'kitchen'], ['dining_', 'dining'], ['study_', 'study'],
    ['master_bath_', 'master_bath'], ['guest_bath_', 'guest_bath'], ['balcony_', 'balcony'], ['entry_', 'entry_garden'],
    ['corridor_', 'corridor'],
  ];
  return prefixes.find(([prefix]) => id.startsWith(prefix))?.[1] ?? 'unassigned';
}

function categoryFor(camera: RawCamera): CameraCategory {
  const explicit = text(camera.category)?.toLowerCase();
  if (CAMERA_CATEGORIES.includes(explicit as CameraCategory)) return explicit as CameraCategory;
  const id = (text(camera.id) ?? '').toLowerCase();
  if (/(relationship|关系|function|功能|entrance|entry|from_)/u.test(id)) return 'relationship';
  if (/(closeup|特写|detail|地板延展|mid)/u.test(id)) return 'detail';
  if (/(overview|全景)/u.test(id)) return 'overview';
  const source = `${text(camera.label) ?? ''} ${text(camera.purpose) ?? ''}`.toLowerCase();
  if (/(relationship|关系|function|功能|entrance|entry|from_)/u.test(source)) return 'relationship';
  if (/(closeup|特写|detail|地板延展|mid)/u.test(source)) return 'detail';
  if (/(overview|全景)/u.test(source)) return 'overview';
  return 'auxiliary';
}

function isArchived(camera: RawCamera): boolean {
  if (camera.archived === true) return true;
  if (text(camera.archiveStatus)?.toLowerCase() === 'archived') return true;
  return Boolean(camera.archive && typeof camera.archive === 'object');
}

export function buildCameraCoverageReport(config: unknown, configPath = DEFAULT_CONFIG_PATH): CameraCoverageReport {
  if (!config || typeof config !== 'object' || !Array.isArray((config as RenderConfig).cameras)) {
    throw new Error('render-config.json must contain a cameras array');
  }
  const rooms: Record<string, RoomCameraStats> = {};
  const unarchivedCameras: CameraCoverageReport['unarchivedCameras'] = [];
  const cameras = (config as RenderConfig).cameras as unknown[];
  for (const value of cameras) {
    if (!value || typeof value !== 'object' || !text((value as RawCamera).id)) throw new Error('Every camera must have a non-empty id');
    const camera = value as RawCamera;
    const id = text(camera.id)!;
    const room = roomFor(camera);
    const category = categoryFor(camera);
    const archived = isArchived(camera);
    const stats = rooms[room] ??= { cameras: 0, overview: 0, relationship: 0, detail: 0, auxiliary: 0, cameraDetails: [] };
    stats.cameras += 1;
    stats[category] += 1;
    stats.cameraDetails.push({ id, category, archived, ...(text(camera.label) ? { label: text(camera.label) } : {}) });
    if (!archived) unarchivedCameras.push({ id, room, category, ...(text(camera.label) ? { label: text(camera.label) } : {}) });
  }
  return { configPath, totalCameras: cameras.length, rooms, unarchivedCameras };
}

export function readCameraCoverageReport(configPath = DEFAULT_CONFIG_PATH, root = '.'): CameraCoverageReport {
  const relativePath = resolve(root, configPath);
  let config: unknown;
  try { config = JSON.parse(readFileSync(relativePath, 'utf8')); }
  catch (error) { throw new Error(`Unable to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`); }
  return buildCameraCoverageReport(config, configPath);
}

function humanReport(report: CameraCoverageReport): string {
  const lines = [`camera coverage: ${report.totalCameras} cameras`, 'rooms:'];
  for (const [room, stats] of Object.entries(report.rooms)) {
    lines.push(`  ${room}: cameras=${stats.cameras} overview=${stats.overview} relationship=${stats.relationship} detail=${stats.detail} auxiliary=${stats.auxiliary}`);
    for (const camera of stats.cameraDetails) {
      lines.push(`    ${camera.id}: category=${camera.category} label=${camera.label ?? '(none)'} archived=${camera.archived}`);
    }
  }
  lines.push(`unarchived cameras: ${report.unarchivedCameras.length}`);
  for (const camera of report.unarchivedCameras) lines.push(`  ${camera.id} (${camera.room}/${camera.category})`);
  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv: string[]): { json: boolean; out?: string; configPath: string } {
  let json = false;
  let out: string | undefined;
  let configPath = DEFAULT_CONFIG_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') json = true;
    else if (argument === '--out') out = argv[++index] ?? (() => { throw new Error('usage: tsx scripts/render/camera-coverage-report.ts [--json] [--out <path>] [<render-config.json>]'); })();
    else if (argument.startsWith('--')) throw new Error(`unknown argument: ${argument}`);
    else if (configPath === DEFAULT_CONFIG_PATH) configPath = argument;
    else throw new Error('only one render-config.json path may be provided');
  }
  return { json, out, configPath };
}

function main(argv: string[]): void {
  try {
    const args = parseArgs(argv);
    const report = readCameraCoverageReport(args.configPath);
    const output = args.json ? `${JSON.stringify(report, null, 2)}\n` : humanReport(report);
    if (args.out) writeFileSync(resolve(args.out), output);
    else process.stdout.write(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && /camera-coverage-report\.(ts|js)$/u.test(process.argv[1])) main(process.argv.slice(2));
