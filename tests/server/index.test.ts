import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiRouter } from '../../server/routes.js';
import { attachMcpTransports } from '../../server/mcp-transports.js';
import { createMcpServer } from '../../server/mcp-server.js';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from '../../server/config-loader.js';
import type { CadLayoutYaml } from '../../shared/types.js';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('server startup resilience', () => {
  it('starts with missing design-rules.yaml and reports it via /api/config-status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bontop-startup-'));
    rmSync(dir, { recursive: true, force: true });
    mkdtempSync(dir);

    const registry = new ConfigRegistry();
    const designRulesLoader = new ConfigLoader(
      join(dir, 'config', 'design-rules.yaml'),
      (raw) => JSON.parse(raw),
      () => {}
    );
    designRulesLoader.load();
    registry.register(designRulesLoader);

    const emptyLayout: CadLayoutYaml = {
      version: '1.0',
      source: 'test.dxf',
      unit: 'm',
      scale: 0.001,
      origin: { x: 0, z: 0 },
      export_date: '2026-07-09',
      rooms: [],
    };
    const catalog = ProjectCatalog.fromMaterials({ materials: [] }, { total_budget: 0, categories: {} }, emptyLayout);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(dir);

    const deps = {
      catalog,
      state: new DesignState(catalog, dir),
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore,
      getConfigRegistry: () => registry,
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(deps));
    await attachMcpTransports(app, () => createMcpServer(deps));

    const response = await new Promise<any>((resolve, reject) => {
      const server = app.listen(0, async () => {
        const port = (server.address() as any).port;
        try {
          const res = await fetch(`http://localhost:${port}/api/config-status`);
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          server.close();
        }
      });
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.configs));
    assert.ok(body.configs.some((c: any) => c.path.includes('design-rules.yaml') && c.status === 'failed'));
  });
});
