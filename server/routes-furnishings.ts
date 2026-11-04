// 只读路由（2026-11-04 页面只读化）：家具摆位仅提供 GET。
// 模型配置唯一写手是 AI 会话——修改 config/house.yaml 须过 lint/verify（AGENTS.md「页面只取证与体验」）。
import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

interface FurnishingsData {
  furnishings: Record<string, unknown[]>;
}

export function createFurnishingsRouter(yamlPath: string): Router {
  const router = Router();
  // 只读（2026-11-04 页面只读化）：家具路由仅保留 GET；模型配置唯一写手是 AI 会话（改配置跑 lint 过闸）。

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




  return router;
}
