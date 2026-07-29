import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { writeYaml } from './yaml-writer.js';

interface PlumbingPoint {
  id: string;
  room: string;
  type: string;
  x: number;
  z: number;
  height?: number;
  note?: string;
}

export function createPlumbingRouter(yamlPath: string): Router {
  const router = Router();

  function loadData(): PlumbingPoint[] {
    const raw = readFileSync(yamlPath, 'utf8');
    return parseYaml(raw) as PlumbingPoint[];
  }

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json(loadData());
    } catch {
      res.status(500).json({ error: 'Failed to load plumbing config' });
    }
  });

  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const data = loadData();
      const idx = data.findIndex((p) => p.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const { x, z, height, note } = req.body;
      if (x !== undefined) data[idx].x = x;
      if (z !== undefined) data[idx].z = z;
      if (height !== undefined) data[idx].height = height;
      if (note !== undefined) data[idx].note = note;
      await writeYaml(yamlPath, data);
      res.json({ item: data[idx] });
    } catch {
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { id, room, type, x, z, height, note } = req.body;
      if (!id || !room) { res.status(400).json({ error: 'id and room required' }); return; }
      const data = loadData();
      const point: PlumbingPoint = { id, room, type: type ?? 'faucet', x: x ?? 0, z: z ?? 0 };
      if (height !== undefined) point.height = height;
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
