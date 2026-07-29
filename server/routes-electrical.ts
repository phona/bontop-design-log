import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface ElectricalPoint {
  id: string;
  room: string;
  wall: string;
  type: string;
  x: number;
  z: number;
  height: number;
  count?: number;
  note?: string;
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
      const data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const { x, z, height, wall, note } = req.body;
      if (x !== undefined) data[idx].x = x;
      if (z !== undefined) data[idx].z = z;
      if (height !== undefined) data[idx].height = height;
      if (wall !== undefined) data[idx].wall = wall;
      if (note !== undefined) data[idx].note = note;
      await writeYaml(yamlPath, data);
      res.json({ item: data[idx] });
    } catch {
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { id, room, wall, type, x, z, height, count, note } = req.body;
      if (!id || !room) { res.status(400).json({ error: 'id and room required' }); return; }
      const data = loadData();
      const point: ElectricalPoint = { id, room, wall: wall ?? 'unknown', type: type ?? 'socket', x: x ?? 0, z: z ?? 0, height: height ?? 0.3 };
      if (count !== undefined) point.count = count;
      if (note !== undefined) point.note = note;
      data.push(point);
      await writeYaml(yamlPath, data);
      res.status(201).json({ item: point });
    } catch {
      res.status(500).json({ error: 'Failed to add' });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const filtered = data.filter((p) => p.id !== req.params.id);
      await writeYaml(yamlPath, filtered);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  return router;
}
