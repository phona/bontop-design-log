import express from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { ArchivedSchemesStore } from './archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from './config-loader.js';
import type { DesignRulesConfig, MaterialsYaml } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const registry = new ConfigRegistry();

let catalog = ProjectCatalog.fromMaterials(
  { materials: [] },
  { total_budget: 0, categories: {} }
);
let ruleEngine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());

function rebuildDerived(): void {
  const materials = materialsLoader.getConfig() ?? { materials: [] };
  const budgetBase = budgetBaseLoader.getConfig() ?? { total_budget: 0, categories: {} };
  catalog = ProjectCatalog.fromMaterials(materials, budgetBase);
  const rulesConfig = designRulesLoader.getConfig() ?? { version: '1.0', risks: [], constraints: [] };
  ruleEngine = new RuleEngine(rulesConfig);
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
}

const designRulesLoader = new ConfigLoader<DesignRulesConfig>(
  CONFIG_PATH,
  (raw) => load(raw) as DesignRulesConfig,
  () => {
    rebuildDerived();
    console.log('[server] design-rules.yaml reloaded');
  }
);
registry.register(designRulesLoader);

const materialsLoader = new ConfigLoader<MaterialsYaml>(
  'config/materials.yaml',
  (raw) => load(raw) as MaterialsYaml,
  () => {
    rebuildDerived();
    console.log('[server] materials.yaml reloaded');
  }
);
registry.register(materialsLoader);

const budgetBaseLoader = new ConfigLoader<{ total_budget: number; categories: Record<string, { budget: number; actual: number; status: string; notes: string }> }>(
  'config/budget/base.json',
  (raw) => JSON.parse(raw),
  () => {
    rebuildDerived();
    console.log('[server] config/budget/base.json reloaded');
  }
);
registry.register(budgetBaseLoader);

designRulesLoader.load();
materialsLoader.load();
budgetBaseLoader.load();

let state: DesignState;
try {
  state = DesignState.load(catalog, DATA_DIR);
} catch (err) {
  console.error('[server] Failed to load design state, starting fresh:', err);
  state = new DesignState(catalog, DATA_DIR);
}

const archiveStore = new ArchivedSchemesStore(DATA_DIR);

const apiDeps = {
  catalog,
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  archiveStore,
  getConfigRegistry: () => registry,
};

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(apiDeps));

attachMcpTransports(app, () => createMcpServer(apiDeps)).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Bontop design server listening on http://localhost:${PORT}`);
  });

  designRulesLoader.startWatching();
  materialsLoader.startWatching();
  budgetBaseLoader.startWatching();

  const shutdown = async () => {
    await registry.stopAll();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
