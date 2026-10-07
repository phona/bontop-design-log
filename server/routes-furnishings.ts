import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { resolveLayout } from './layout-resolver.js';
import type { VertexLayoutYaml } from '../shared/types.js';
import { editYaml } from './yaml-writer.js';

interface FurnishingItem {
  type: string;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
  wall?: string;
  wall_side?: 'east' | 'west' | 'north' | 'south';
  along?: number;
}

interface FurnishingsData {
  furnishings: Record<string, FurnishingItem[]>;
}

interface GeometryContext {
  walls: Set<string>;
  suppressedWalls: Set<string>;
  curvedWalls: Set<string>;
  rooms: Set<string>;
  segments: Map<string, [[number, number], [number, number]]>;
}

class InputValidationError extends Error {}
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

function loadFurnitureTypeRegistry(): Set<string> {
  // Furniture roles are owned by the project spatial registry, rather than by
  // whichever house YAML happens to be mounted on this router.  This also
  // keeps isolated route fixtures subject to the same production registry.
  const registryPath = resolve('config/spatial-validation.yaml');
  if (!existsSync(registryPath)) throw new InputValidationError('furniture type registry is missing');
  try {
    const raw = parseYaml(readFileSync(registryPath, 'utf8')) as Record<string, unknown>;
    const types = new Set<string>();
    const profiles = raw.furniture_profiles;
    if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
      for (const type of Object.keys(profiles as Record<string, unknown>)) types.add(type);
    }
    for (const entry of (Array.isArray(raw.furniture_profile_overrides) ? raw.furniture_profile_overrides : []) as Array<Record<string, unknown>>) {
      for (const type of (Array.isArray(entry.types) ? entry.types : [])) if (typeof type === 'string') types.add(type);
    }
    for (const type of (Array.isArray(raw.mep_coordination_types) ? raw.mep_coordination_types : [])) if (typeof type === 'string') types.add(type);
    return types;
  } catch {
    throw new InputValidationError('furniture type registry could not be loaded');
  }
}

function loadGeometryContext(yamlPath: string): GeometryContext | undefined {
  const layoutPath = resolve(dirname(yamlPath), 'layout/model-geometry.yaml');
  if (!existsSync(layoutPath)) throw new InputValidationError('layout geometry context is missing');
  try {
    const layout = parseYaml(readFileSync(layoutPath, 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(layout.vertices) || !Array.isArray(layout.rooms) || !Array.isArray(layout.walls)) {
      throw new Error('layout must declare vertices, rooms, and walls arrays');
    }
    resolveLayout(layout as unknown as VertexLayoutYaml);
    const vertices = new Map<string, { point: [number, number]; curved: boolean }>();
    for (const vertex of (Array.isArray(layout.vertices) ? layout.vertices : []) as Array<Record<string, unknown>>) {
      if (typeof vertex.id === 'string' && typeof vertex.x === 'number' && typeof vertex.z === 'number') {
        vertices.set(vertex.id, { point: [vertex.x, vertex.z], curved: typeof vertex.radius === 'number' && vertex.radius > 0 });
      }
    }
    const walls = new Set<string>();
    const curvedWalls = new Set<string>();
    const segments = new Map<string, [[number, number], [number, number]]>();
    for (const wall of (Array.isArray(layout.walls) ? layout.walls : []) as Array<Record<string, unknown>>) {
      if (typeof wall.id !== 'string') continue;
      walls.add(wall.id);
      const from = typeof wall.from === 'string' ? vertices.get(wall.from) : undefined;
      const to = typeof wall.to === 'string' ? vertices.get(wall.to) : undefined;
      if (from && to) {
        if (from.curved || to.curved) curvedWalls.add(wall.id);
        else segments.set(wall.id, [from.point, to.point]);
      }
    }
    const rooms = new Set<string>();
    for (const room of (Array.isArray(layout.rooms) ? layout.rooms : []) as Array<Record<string, unknown>>) if (typeof room.id === 'string') rooms.add(room.id);
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
    return { walls, suppressedWalls, curvedWalls, rooms, segments };
  } catch {
    throw new InputValidationError('layout geometry context could not be loaded');
  }
}

function validateItem(item: FurnishingItem, room: string, context: GeometryContext | undefined, knownTypes?: Set<string>): void {
  nonEmptyString(room, 'room');
  nonEmptyString(item.type, 'type');
  if (!knownTypes || !knownTypes.has(item.type)) throw new InputValidationError(`furnishing type is not registered: ${item.type}`);
  const anchored = item.wall !== undefined || item.wall_side !== undefined || item.along !== undefined;
  if (anchored && (item.x !== undefined || item.z !== undefined)) {
    throw new InputValidationError('wall-anchored furnishing uses along; x and z must be omitted');
  }
  if (!anchored && (item.x === undefined) !== (item.z === undefined)) throw new InputValidationError('x and z must be supplied together for a placed furnishing');
  if (item.x !== undefined) finite(item.x, 'x');
  if (item.z !== undefined) finite(item.z, 'z');
  if (item.rotation !== undefined) finite(item.rotation, 'rotation');
  if (item.along !== undefined) finite(item.along, 'along');
  if (item.count !== undefined && (!Number.isInteger(item.count) || item.count < 1)) throw new InputValidationError('count must be a positive integer');
  if (item.wall_side !== undefined && !WALL_SIDES.has(item.wall_side)) throw new InputValidationError('wall_side must be east, west, north, or south');
  if (context && !context.rooms.has(room)) throw new InputValidationError(`unknown room: ${room}`);
  if (!item.wall) {
    if (item.wall_side !== undefined || item.along !== undefined) {
      throw new InputValidationError('wall_side and along require wall');
    }
    return;
  }
  nonEmptyString(item.wall, 'wall');
  if (item.wall_side === undefined || item.along === undefined) {
    throw new InputValidationError('wall anchor requires wall, wall_side, and along');
  }
  if (context) {
    if (!context.walls.has(item.wall)) throw new InputValidationError(`unknown wall: ${item.wall}`);
    if (context.suppressedWalls.has(item.wall)) throw new InputValidationError(`wall ${item.wall} is suppressed/glass and cannot host a furnishing`);
    if (context.curvedWalls.has(item.wall)) throw new InputValidationError(`wall ${item.wall} is curved; wall-anchored furnishing placement requires a validated arc-aware anchor`);
    const segment = context.segments.get(item.wall);
    if (segment && item.along !== undefined) {
      const [[x1, z1], [x2, z2]] = segment;
      const wallLength = Math.hypot(x2 - x1, z2 - z1);
      if (item.along < 0 || item.along > wallLength) throw new InputValidationError(`along must be within wall ${item.wall} length`);
    }
  }
}

export function createFurnishingsRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): FurnishingsData {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as FurnishingsData;
  }

  router.get('/', (_req: Request, res: Response) => {
    try {
      const data = loadData();
      res.json(data.furnishings ?? {});
    } catch {
      res.status(500).json({ error: 'Failed to load furnishings' });
    }
  });

  router.put('/:room/:index', async (req: Request, res: Response) => {
    try {
      const { room, index } = req.params;
      if (!isRecord(req.body)) throw new InputValidationError('request body must be an object');
      const { x, z, rotation, wall, wall_side, along } = req.body;
      if (!/^[0-9]+$/.test(index)) { res.status(400).json({ error: 'index must be a non-negative integer' }); return; }
      const item = await editYaml<FurnishingsData, FurnishingItem | undefined>(yamlPath, (data) => {
        const geometry = loadGeometryContext(yamlPath);
        const knownTypes = loadFurnitureTypeRegistry();
        const items = data.furnishings[room];
        if (!items || !items[Number(index)]) return undefined;
        const item = { ...items[Number(index)] };
        if (x !== undefined) item.x = finite(x, 'x');
        if (z !== undefined) item.z = finite(z, 'z');
        if (rotation !== undefined) item.rotation = finite(rotation, 'rotation');
        if (wall !== undefined) item.wall = nonEmptyString(wall, 'wall');
        if (wall_side !== undefined) {
          if (!['east', 'west', 'north', 'south'].includes(String(wall_side))) throw new InputValidationError('wall_side must be east, west, north, or south');
          item.wall_side = wall_side as FurnishingItem['wall_side'];
        }
        if (along !== undefined) item.along = finite(along, 'along');
        validateItem(item, room, geometry, knownTypes);
        items[Number(index)] = item;
        return item;
      }, { shouldWrite: (result) => result !== undefined });
      if (!item) { res.status(404).json({ error: 'Furnishing not found' }); return; }
      res.json({ item });
    } catch (err) {
      if (err instanceof InputValidationError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Failed to update furnishing' });
    }
  });

  router.delete('/:room/:index', async (req: Request, res: Response) => {
    try {
      const { room, index } = req.params;
      if (!/^[0-9]+$/.test(index)) { res.status(400).json({ error: 'index must be a non-negative integer' }); return; }
      const deleted = await editYaml<FurnishingsData, boolean>(yamlPath, (data) => {
        const items = data.furnishings[room];
        if (!items || !items[Number(index)]) return false;
        data.furnishings[room] = items.filter((_, i) => i !== Number(index));
        return true;
      });
      if (!deleted) { res.status(404).json({ error: 'Furnishing not found' }); return; }
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete furnishing' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      if (!isRecord(req.body)) throw new InputValidationError('request body must be an object');
      const { room, type, x, z, rotation, count, along } = req.body;
      if (!room || !type) throw new InputValidationError('room and type required');
      const roomId = nonEmptyString(room, 'room');
      const item: FurnishingItem = { type: nonEmptyString(type, 'type') };
      if (x !== undefined) item.x = finite(x, 'x');
      if (z !== undefined) item.z = finite(z, 'z');
      if (rotation !== undefined) item.rotation = finite(rotation, 'rotation');
      if (along !== undefined) item.along = finite(along, 'along');
      if (count !== undefined) {
        const numericCount = finite(count, 'count');
        if (!Number.isInteger(numericCount) || numericCount < 1) throw new InputValidationError('count must be a positive integer');
        item.count = numericCount;
      }
      if (req.body.wall !== undefined) item.wall = nonEmptyString(req.body.wall, 'wall');
      if (req.body.wall_side !== undefined) {
        if (!['east', 'west', 'north', 'south'].includes(String(req.body.wall_side))) throw new InputValidationError('wall_side must be east, west, north, or south');
        item.wall_side = req.body.wall_side as FurnishingItem['wall_side'];
      }
      await editYaml<FurnishingsData, void>(yamlPath, (data) => {
        const geometry = loadGeometryContext(yamlPath);
        const knownTypes = loadFurnitureTypeRegistry();
        if (!data.furnishings[roomId]) data.furnishings[roomId] = [];
        validateItem(item, roomId, geometry, knownTypes);
        data.furnishings[roomId].push(item);
      });
      res.status(201).json({ item });
    } catch (err) {
      if (err instanceof InputValidationError) { res.status(400).json({ error: err.message }); return; }
      res.status(500).json({ error: 'Failed to add furnishing' });
    }
  });

  return router;
}
