import express from 'express';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { DesignRulesWatcher } from './design-rules-watcher.js';
import { ArchivedSchemesStore } from './archived-schemes.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const catalog = ProjectCatalog.load('.');
const state = DesignState.load(catalog, DATA_DIR);
const archiveStore = new ArchivedSchemesStore(DATA_DIR);

let ruleEngine = RuleEngine.load(CONFIG_PATH);
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());

const watcher = new DesignRulesWatcher(CONFIG_PATH, (newEngine) => {
  ruleEngine = newEngine;
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
  console.log('[server] design-rules.yaml reloaded');
});
watcher.start();

const apiDeps = {
  catalog,
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  archiveStore,
};

const app = express();
app.use(express.json());
app.use('/api', createApiRouter(apiDeps));

attachMcpTransports(app, () => createMcpServer(apiDeps)).then(() => {
  app.listen(PORT, () => {
    console.log(`Bontop design server listening on http://localhost:${PORT}`);
  });
});

process.on('SIGINT', () => {
  watcher.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  watcher.stop();
  process.exit(0);
});
