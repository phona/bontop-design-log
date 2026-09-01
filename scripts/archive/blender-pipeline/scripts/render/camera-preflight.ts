import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

export const DEFAULT_CONFIG_PATH = 'scripts/blender/render-config.json';

export type Severity = 'error' | 'warning';
export type CameraPreflightIssue = {
  severity: Severity;
  code: string;
  message: string;
  cameraId?: string;
  room?: string;
};

export type CameraPreflightReport = {
  configPath: string;
  geometryPath?: string;
  cameras: number;
  scenarios: number;
  issues: CameraPreflightIssue[];
  ok: boolean;
};

export type CameraPreflightArgs = {
  configPath: string;
  geometryPath?: string;
  json: boolean;
};

type Vector = [number, number, number];
type RawCamera = { id?: unknown; room?: unknown; position?: unknown; target?: unknown; lens?: unknown; scenarios?: unknown };
type RawScenario = { id?: unknown };
type RenderConfig = { cameras?: unknown; scenarios?: unknown };
type Geometry = {
  vertices?: Array<{ id?: unknown; x?: unknown; z?: unknown }>;
  rooms?: Array<{ id?: unknown; boundary?: unknown }>;
};
type RoomPolygon = { id: string; points: Array<[number, number]>; minX: number; maxX: number; minZ: number; maxZ: number };

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function valueAfter(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv: string[]): CameraPreflightArgs {
  let configPath = DEFAULT_CONFIG_PATH;
  let geometryPath: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') configPath = nonEmpty(valueAfter(argv, index++, argument), argument);
    else if (argument === '--geometry') geometryPath = nonEmpty(valueAfter(argv, index++, argument), argument);
    else if (argument === '--json') json = true;
    else if (argument === '--help') throw new Error('usage: tsx scripts/render/camera-preflight.ts [--config <render-config.json>] [--geometry <model-geometry.yaml>] [--json]');
    else throw new Error(`unknown argument: ${argument}`);
  }
  return { configPath, geometryPath, json };
}

function configArray<T>(config: RenderConfig, key: 'cameras' | 'scenarios'): T[] {
  const values = config[key];
  if (!Array.isArray(values)) throw new Error(`render-config.json must contain a ${key} array`);
  return values as T[];
}

function vector(value: unknown, name: string): Vector | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) return undefined;
  return value as Vector;
}

function makePolygons(geometry: unknown): RoomPolygon[] {
  if (!geometry || typeof geometry !== 'object') throw new Error('model-geometry.yaml must contain an object');
  const source = geometry as Geometry;
  if (!Array.isArray(source.vertices) || !Array.isArray(source.rooms)) throw new Error('model-geometry.yaml must contain vertices and rooms arrays');
  const vertices = new Map<string, [number, number]>();
  for (const vertex of source.vertices) {
    const id = nonEmpty(vertex?.id, 'vertex id');
    if (typeof vertex.x !== 'number' || typeof vertex.z !== 'number' || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.z)) throw new Error(`vertex ${id} must have finite x/z`);
    vertices.set(id, [vertex.x, vertex.z]);
  }
  return source.rooms.map((room) => {
    const id = nonEmpty(room?.id, 'room id');
    if (!Array.isArray(room.boundary) || room.boundary.length < 3) throw new Error(`room ${id} must have a boundary`);
    const points = room.boundary.map((ref) => {
      const vertexId = nonEmpty(ref, `room ${id} boundary vertex`);
      const point = vertices.get(vertexId);
      if (!point) throw new Error(`room ${id} references unknown vertex ${vertexId}`);
      return point;
    });
    const xs = points.map(([x]) => x); const zs = points.map(([, z]) => z);
    return { id, points, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
}

function insidePolygon(x: number, z: number, polygon: RoomPolygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.points.length - 1; i < polygon.points.length; j = i++) {
    const [xi, zi] = polygon.points[i]; const [xj, zj] = polygon.points[j];
    const intersects = ((zi > z) !== (zj > z)) && x < (xj - xi) * (z - zi) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside || polygon.points.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.0001);
}

function issue(issues: CameraPreflightIssue[], severity: Severity, code: string, message: string, cameraId?: string, room?: string): void {
  issues.push({ severity, code, message, ...(cameraId ? { cameraId } : {}), ...(room ? { room } : {}) });
}

export function buildCameraPreflightReport(config: unknown, geometry?: unknown, configPath = DEFAULT_CONFIG_PATH, geometryPath?: string): CameraPreflightReport {
  if (!config || typeof config !== 'object') throw new Error('render-config.json must contain an object');
  const cameras = configArray<RawCamera>(config as RenderConfig, 'cameras');
  const scenarios = configArray<RawScenario>(config as RenderConfig, 'scenarios');
  const issues: CameraPreflightIssue[] = [];
  const scenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    const id = nonEmpty(scenario?.id, 'scenario id');
    if (scenarioIds.has(id)) issue(issues, 'error', 'duplicate-scenario-id', `duplicate scenario id: ${id}`);
    scenarioIds.add(id);
  }
  const cameraIds = new Set<string>();
  const polygons = geometry === undefined ? [] : makePolygons(geometry);
  const rooms = new Map(polygons.map((room) => [room.id, room]));
  for (const camera of cameras) {
    const id = nonEmpty(camera?.id, 'camera id');
    const room = nonEmpty(camera?.room, `camera ${id} room`);
    if (cameraIds.has(id)) issue(issues, 'error', 'duplicate-camera-id', `duplicate camera id: ${id}`, id, room);
    cameraIds.add(id);
    const position = vector(camera.position, `camera ${id} position`);
    const target = vector(camera.target, `camera ${id} target`);
    if (!position) issue(issues, 'error', 'invalid-position', `camera ${id} position must be a finite [x,y,z]`, id, room);
    if (!target) issue(issues, 'error', 'invalid-target', `camera ${id} target must be a finite [x,y,z]`, id, room);
    if (camera.lens !== undefined && (typeof camera.lens !== 'number' || !Number.isFinite(camera.lens) || camera.lens <= 0 || camera.lens > 200)) issue(issues, 'error', 'invalid-lens', `camera ${id} lens must be > 0 and <= 200 when provided`, id, room);
    if (!Array.isArray(camera.scenarios) || camera.scenarios.length === 0) issue(issues, 'error', 'invalid-scenarios', `camera ${id} scenarios must be a non-empty array`, id, room);
    else for (const scenario of camera.scenarios) if (typeof scenario !== 'string' || !scenarioIds.has(scenario)) issue(issues, 'error', 'unknown-scenario', `camera ${id} references unknown scenario: ${String(scenario)}`, id, room);
    if (position) {
      if (position[1] < 0.5 || position[1] > 3.2) issue(issues, 'warning', 'abnormal-height', `camera ${id} height ${position[1]}m is outside the usual 0.5–3.2m range`, id, room);
      if (geometry !== undefined && !rooms.has(room)) issue(issues, 'warning', 'unknown-room-geometry', `camera ${id} room ${room} is not present in geometry`, id, room);
    }
    if (position && target) {
      const distance = Math.hypot(target[0] - position[0], target[1] - position[1], target[2] - position[2]);
      if (distance < 0.4 || distance > 25) issue(issues, 'warning', 'abnormal-distance', `camera ${id} target distance ${distance.toFixed(2)}m is outside the usual 0.4–25m range`, id, room);
      const polygon = rooms.get(room);
      if (polygon && !insidePolygon(target[0], target[2], polygon)) issue(issues, 'warning', 'target-outside-room', `camera ${id} target [${target[0]}, ${target[2]}] is outside room ${room} bounds`, id, room);
      if (room === 'bedroom_se' && polygon) {
        // These tolerances catch the known study views that put the camera/aim
        // line effectively on the east wall or south glass edge without rendering.
        if (position[0] >= polygon.maxX - 0.5 || target[0] >= polygon.maxX - 0.5) issue(issues, 'warning', 'bedroom-se-east-wall-crossing', `camera ${id} is within 0.5m of the bedroom_se east wall`, id, room);
        if (position[2] >= polygon.maxZ - 1.3 || target[2] >= polygon.maxZ - 1.3) issue(issues, 'warning', 'bedroom-se-south-glass-crossing', `camera ${id} is within 1.3m of the bedroom_se south glass boundary`, id, room);
      }
    }
  }
  return { configPath, ...(geometryPath ? { geometryPath } : {}), cameras: cameras.length, scenarios: scenarios.length, issues, ok: !issues.some(({ severity }) => severity === 'error') };
}

export function readCameraPreflightReport(args: CameraPreflightArgs, root = '.'): CameraPreflightReport {
  let config: unknown;
  try { config = JSON.parse(readFileSync(resolve(root, args.configPath), 'utf8')); }
  catch (error) { throw new Error(`Unable to read ${args.configPath}: ${error instanceof Error ? error.message : String(error)}`); }
  let geometry: unknown;
  if (args.geometryPath) {
    try { geometry = load(readFileSync(resolve(root, args.geometryPath), 'utf8')); }
    catch (error) { throw new Error(`Unable to read ${args.geometryPath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return buildCameraPreflightReport(config, geometry, args.configPath, args.geometryPath);
}

export function formatCameraPreflightReport(report: CameraPreflightReport, json: boolean): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  const lines = [`camera preflight: ${report.cameras} cameras, ${report.scenarios} scenarios, status=${report.ok ? 'ok' : 'failed'}`];
  if (report.issues.length === 0) lines.push('no issues');
  else for (const item of report.issues) lines.push(`${item.severity.toUpperCase()} ${item.code}${item.cameraId ? ` [${item.cameraId}]` : ''}: ${item.message}`);
  return `${lines.join('\n')}\n`;
}

function main(argv: string[]): void {
  try {
    const args = parseArgs(argv);
    const report = readCameraPreflightReport(args);
    process.stdout.write(formatCameraPreflightReport(report, args.json));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

if (process.argv[1] && /camera-preflight\.(ts|js)$/u.test(process.argv[1])) main(process.argv.slice(2));
