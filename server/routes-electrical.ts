// 只读路由（2026-11-04 页面只读化）：电气点位仅提供 GET。
// 模型配置唯一写手是 AI 会话——修改 config/electrical.yaml 须过 lint/verify（AGENTS.md「页面只取证与体验」）。
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

interface ElectricalPoint {
  id: string;
  room: string;
  type: string;
  x: number;
  z: number;
  wall?: string;
  wall_side?: 'east' | 'west' | 'north' | 'south';
  height?: number;
  circuit?: string;
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

  return router;
}
