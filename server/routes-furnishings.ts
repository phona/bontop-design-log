import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface FurnishingItem {
  type: string;
  count?: number;
  x?: number;
  z?: number;
  rotation?: number;
}

interface FurnishingsData {
  furnishings: Record<string, FurnishingItem[]>;
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
      const { x, z, rotation } = req.body;
      const data = loadData();
      const items = data.furnishings[room];
      if (!items || !items[Number(index)]) {
        res.status(404).json({ error: 'Furnishing not found' });
        return;
      }
      const item = items[Number(index)];
      if (x !== undefined) item.x = x;
      if (z !== undefined) item.z = z;
      if (rotation !== undefined) item.rotation = rotation;
      await writeYaml(yamlPath, data);
      res.json({ item });
    } catch {
      res.status(500).json({ error: 'Failed to update furnishing' });
    }
  });

  router.delete('/:room/:index', async (req: Request, res: Response) => {
    try {
      const { room, index } = req.params;
      const data = loadData();
      const items = data.furnishings[room];
      if (!items || !items[Number(index)]) {
        res.status(404).json({ error: 'Furnishing not found' });
        return;
      }
      data.furnishings[room] = items.filter((_, i) => i !== Number(index));
      await writeYaml(yamlPath, data);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete furnishing' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { room, type, x, z, rotation, count } = req.body;
      if (!room || !type) {
        res.status(400).json({ error: 'room and type required' });
        return;
      }
      const data = loadData();
      if (!data.furnishings[room]) data.furnishings[room] = [];
      const item: FurnishingItem = { type };
      if (x !== undefined) item.x = x;
      if (z !== undefined) item.z = z;
      if (rotation !== undefined) item.rotation = rotation;
      if (count !== undefined) item.count = count;
      data.furnishings[room].push(item);
      await writeYaml(yamlPath, data);
      res.status(201).json({ item });
    } catch {
      res.status(500).json({ error: 'Failed to add furnishing' });
    }
  });

  return router;
}
