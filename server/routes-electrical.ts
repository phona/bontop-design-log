import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { editYaml } from './yaml-writer.js';
import { resolveLayout } from './layout-resolver.js';
import type { VertexLayoutYaml } from '../shared/types.js';

interface ElectricalPoint {
  id: string;
  room: string;
  wall?: string;
  type: string;
  x: number;
  z: number;
  height?: number;
  wall_side?: 'east' | 'west' | 'north' | 'south';
  count?: number;
  note?: string;
}

interface LineSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

interface GeometryContext {
  walls: Set<string>;
  suppressedWalls: Set<string>;
  rooms: Set<string>;
  segments: Map<string, LineSegment[]>;
}

class InputValidationError extends Error {}

const ELECTRICAL_TYPES = new Set([
  'socket', 'switch', 'switch_2way', 'network', 'usb', 'floor_socket', 'strong_panel', 'weak_panel',
  'ac_controller', 'ceiling_light', 'pendant', 'dome', 'wall_lamp', 'downlight', 'led_strip',
  'track_light', 'night_light',
]);
const WALL_SIDES = new Set(['east', 'west', 'north', 'south']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InputValidationError(`${field} must be a finite number`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new InputValidationError(`${field} must be a non-empty string`);
  return value;
}

function loadGeometryContext(yamlPath: string): GeometryContext | undefined {
  const layoutPath = resolve(dirname(yamlPath), 'layout/model-geometry.yaml');
  if (!existsSync(layoutPath)) throw new InputValidationError('layout geometry context is missing');
  try {
    const layout = parseYaml(readFileSync(layoutPath, 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(layout.vertices) || !Array.isArray(layout.rooms) || !Array.isArray(layout.walls)) {
      throw new Error('layout must declare vertices, rooms, and walls arrays');
    }
    const vertices = new Map<string, { point: [number, number]; arc: boolean }>();
    for (const vertex of (Array.isArray(layout.vertices) ? layout.vertices : []) as Array<Record<string, unknown>>) {
      if (typeof vertex.id === 'string' && typeof vertex.x === 'number' && typeof vertex.z === 'number') vertices.set(vertex.id, { point: [vertex.x, vertex.z], arc: typeof vertex.radius === 'number' });
    }
    const walls = new Set<string>();
    const segments = new Map<string, LineSegment[]>();
    const resolved = resolveLayout(layout as unknown as VertexLayoutYaml);
    for (const wall of (Array.isArray(layout.walls) ? layout.walls : []) as Array<Record<string, unknown>>) {
      if (typeof wall.id !== 'string') continue;
      walls.add(wall.id);
      const from = typeof wall.from === 'string' ? vertices.get(wall.from) : undefined;
      const to = typeof wall.to === 'string' ? vertices.get(wall.to) : undefined;
      const resolvedWall = resolved?.walls.find((candidate) => candidate.id === wall.id);
      if (resolvedWall?.segments?.length) {
        segments.set(wall.id, resolvedWall.segments.map((segment) => ({ x1: segment.x1, z1: segment.z1, x2: segment.x2, z2: segment.z2 })));
      } else if (from && to && !from.arc && !to.arc) {
        segments.set(wall.id, [{ x1: from.point[0], z1: from.point[1], x2: to.point[0], z2: to.point[1] }]);
      }
    }
    const rooms = new Set<string>();
    for (const room of (Array.isArray(layout.rooms) ? layout.rooms : []) as Array<Record<string, unknown>>) {
      if (typeof room.id === 'string') rooms.add(room.id);
    }
    const platform = layout.platform as Record<string, unknown> | undefined;
    if (platform && typeof platform.id === 'string') rooms.add(platform.id);
    const overlayPath = resolve(dirname(yamlPath), 'layout/overlay.yaml');
    if (!existsSync(overlayPath)) throw new Error('layout overlay is missing');
    const overlay = parseYaml(readFileSync(overlayPath, 'utf8')) as Record<string, unknown>;
    const suppressedWalls = new Set<string>();
    for (const entry of (Array.isArray(overlay.suppress) ? overlay.suppress : []) as Array<Record<string, unknown>>) {
      if (typeof entry.wall === 'string') suppressedWalls.add(entry.wall);
      for (const wall of (Array.isArray(entry.walls) ? entry.walls : [])) if (typeof wall === 'string') suppressedWalls.add(wall);
    }
    return { walls, suppressedWalls, rooms, segments };
  } catch {
    // A present but malformed geometry file must fail closed.  Returning an
    // empty context here would let a write bypass room, wall, and glass checks.
    throw new InputValidationError('layout geometry context could not be loaded');
  }
}

function validatePoint(point: ElectricalPoint, context: GeometryContext | undefined): void {
  nonEmptyString(point.id, 'id');
  nonEmptyString(point.room, 'room');
  nonEmptyString(point.type, 'type');
  if (!ELECTRICAL_TYPES.has(point.type)) throw new InputValidationError(`unknown electrical type: ${point.type}`);
  finite(point.x, 'x');
  finite(point.z, 'z');
  if (point.height !== undefined) finite(point.height, 'height');
  if (point.count !== undefined && (!Number.isInteger(point.count) || point.count < 1)) throw new InputValidationError('count must be a positive integer');
  if (point.wall_side !== undefined && !WALL_SIDES.has(point.wall_side)) throw new InputValidationError('wall_side must be east, west, north, or south');
  if (context && !context.rooms.has(point.room)) throw new InputValidationError(`unknown room: ${point.room}`);
  if (!point.wall) {
    if (point.wall_side !== undefined) throw new InputValidationError('wall_side requires wall');
    return;
  }
  nonEmptyString(point.wall, 'wall');
  if (context) {
    if (!context.walls.has(point.wall)) throw new InputValidationError(`unknown wall: ${point.wall}`);
    if (context.suppressedWalls.has(point.wall)) throw new InputValidationError(`wall ${point.wall} is suppressed/glass and cannot host an electrical point`);
    if (!point.wall_side) throw new InputValidationError(`wall_side is required for wall-mounted point ${point.id}`);
    const segments = context.segments.get(point.wall);
    if (segments) {
      const onWall = segments.some(({ x1, z1, x2, z2 }) => {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const length2 = dx * dx + dz * dz;
        const t = length2 === 0 ? 0 : ((point.x - x1) * dx + (point.z - z1) * dz) / length2;
        const clamped = Math.max(0, Math.min(1, t));
        const distance = Math.hypot(point.x - (x1 + clamped * dx), point.z - (z1 + clamped * dz));
        return distance <= 0.25 && t >= -0.01 && t <= 1.01;
      });
      if (!onWall) throw new InputValidationError(`point ${point.id} is outside wall ${point.wall}`);
    }
  }
}

export function createElectricalRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): ElectricalPoint[] {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as ElectricalPoint[];
  }

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json(loadData());
    } catch {
      res.status(500).json({ error: 'Failed to load electrical config' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      if (!isRecord(req.body)) throw new InputValidationError('request body must be an object');
      const { x, z, height, wall, wall_side, count, note } = req.body;
      const item = await editYaml<ElectricalPoint[], ElectricalPoint | undefined>(yamlPath, (data) => {
        const geometry = loadGeometryContext(yamlPath);
        const idx = data.findIndex((p) => p.id === req.params.id);
        if (idx === -1) return undefined;
        const candidate = { ...data[idx] };
        if (x !== undefined) candidate.x = finite(x, 'x');
        if (z !== undefined) candidate.z = finite(z, 'z');
        if (height !== undefined) candidate.height = finite(height, 'height');
        if (wall !== undefined) candidate.wall = nonEmptyString(wall, 'wall');
        if (wall_side !== undefined) {
          if (!['east', 'west', 'north', 'south'].includes(String(wall_side))) throw new InputValidationError('wall_side must be east, west, north, or south');
          candidate.wall_side = wall_side as ElectricalPoint['wall_side'];
        }
        if (count !== undefined) {
          const numericCount = finite(count, 'count');
          if (!Number.isInteger(numericCount) || numericCount < 1) throw new InputValidationError('count must be a positive integer');
          candidate.count = numericCount;
        }
        if (note !== undefined) {
          if (typeof note !== 'string') throw new InputValidationError('note must be a string');
          candidate.note = note;
        }
        validatePoint(candidate, geometry);
        data[idx] = candidate;
        return candidate;
      }, { shouldWrite: (result) => result !== undefined });
      if (!item) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ item });
    } catch (err) {
      if (err instanceof InputValidationError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!isRecord(req.body)) throw new InputValidationError('request body must be an object');
      const { id, room, wall, type, x, z, height, count, note } = req.body;
      if (!id || !room) throw new InputValidationError('id and room required');
      const point: ElectricalPoint = { id: nonEmptyString(id, 'id'), room: nonEmptyString(room, 'room'), type: type === undefined ? 'socket' : nonEmptyString(type, 'type'), x: x === undefined ? 0 : finite(x, 'x'), z: z === undefined ? 0 : finite(z, 'z'), height: height === undefined ? 0.3 : finite(height, 'height') };
      if (wall !== undefined) point.wall = nonEmptyString(wall, 'wall');
      if (req.body.wall_side !== undefined) {
        if (!['east', 'west', 'north', 'south'].includes(String(req.body.wall_side))) throw new InputValidationError('wall_side must be east, west, north, or south');
        point.wall_side = req.body.wall_side as ElectricalPoint['wall_side'];
      }
      if (count !== undefined) {
        const numericCount = finite(count, 'count');
        if (!Number.isInteger(numericCount) || numericCount < 1) throw new InputValidationError('count must be a positive integer');
        point.count = numericCount;
      }
      if (note !== undefined) { if (typeof note !== 'string') throw new InputValidationError('note must be a string'); point.note = note; }
      await editYaml<ElectricalPoint[], void>(yamlPath, (data) => {
        const geometry = loadGeometryContext(yamlPath);
        if (data.some((existing) => existing.id === point.id)) throw new InputValidationError(`duplicate electrical point id: ${point.id}`);
        validatePoint(point, geometry);
        data.push(point);
      });
      res.status(201).json({ item: point });
    } catch (err) {
      if (err instanceof InputValidationError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Failed to add' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await editYaml<ElectricalPoint[], boolean>(yamlPath, (data) => {
        const idx = data.findIndex((p) => p.id === req.params.id);
        if (idx === -1) return false;
        data.splice(idx, 1);
        return true;
      });
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  return router;
}
