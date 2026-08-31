import express from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createFurnishingsRouter } from './routes-furnishings.js';
import { createElectricalRouter } from './routes-electrical.js';
import { createPlumbingRouter } from './routes-plumbing.js';
import { createMcpServer } from './mcp-server.js';
import { attachMcpTransports } from './mcp-transports.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { BudgetAdvisor } from './budget-advisor.js';
import { BudgetValueAnalyzer } from './budget-value-analyzer.js';
import { PitfallEngine } from './pitfall-engine.js';
import type { PitfallConfig } from './pitfall-engine.js';
import { LifecycleEngine } from './lifecycle-engine.js';
import { TradeoffEngine } from './tradeoff-engine.js';
import { AcceptanceEngine } from './acceptance-engine.js';
import { ArchivedSchemesStore } from './archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from './config-loader.js';
import { ProjectRenderFactsLoader } from './project-render-facts-loader.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import { parseOverlay } from './overlay-merge.js';
import type { OverlayConfig } from './overlay-merge.js';
import { parseEnvironment } from '../shared/environment-schema.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { createAnalysisRouter } from './analysis-routes.js';
import { PresentationStateStore } from './presentation-state.js';
import { resolveLayout } from './layout-resolver.js';
import type { MepLintLayoutContext } from '../shared/mep-hvac-lint.js';
import type { DesignRulesConfig, MaterialsYaml, CadLayoutYaml, HouseYaml, VertexLayoutYaml } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 4000);
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const registry = new ConfigRegistry();
const projectRenderFactsLoader = new ProjectRenderFactsLoader();
registry.register(projectRenderFactsLoader);

let catalog = ProjectCatalog.fromMaterials(
  { materials: [] },
  { total_budget: 0, categories: {} },
  { rooms: [] } as unknown as CadLayoutYaml
);
let ruleEngine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
let budgetAdvisor = new BudgetAdvisor(catalog, budgetCalculator, ruleEngine);
let budgetValueAnalyzer = new BudgetValueAnalyzer(catalog, budgetCalculator, ruleEngine.getConfig());
let pitfallEngine = new PitfallEngine({ version: '1.0', pitfalls: [], templates: [] });
const lifecycleEngine = new LifecycleEngine();
const tradeoffEngine = new TradeoffEngine();
const acceptanceEngine = new AcceptanceEngine();

function rebuildDerived(): void {
  const materials = materialsLoader.getConfig() ?? { materials: [] };
  const budgetBase = budgetBaseLoader.getConfig() ?? { total_budget: 0, categories: {} };
  const layout = layoutLoader.getConfig() ?? ({ rooms: [] } as unknown as CadLayoutYaml);
  const houseMeta = houseMetaLoader.getConfig();
  catalog = ProjectCatalog.fromMaterials(materials, budgetBase, layout, houseMeta, 'model-geometry');
  const rulesConfig = designRulesLoader.getConfig() ?? { version: '1.0', risks: [], constraints: [] };
    ruleEngine = new RuleEngine(rulesConfig);
    budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
    budgetAdvisor = new BudgetAdvisor(catalog, budgetCalculator, ruleEngine);
    budgetValueAnalyzer = new BudgetValueAnalyzer(catalog, budgetCalculator, ruleEngine.getConfig());
    const pitfallConfig = pitfallsLoader.getConfig() ?? { version: '1.0', pitfalls: [], templates: [] };
  pitfallEngine = new PitfallEngine(pitfallConfig);
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

const layoutLoader = new ConfigLoader<CadLayoutYaml>(
  'config/layout/model-geometry.yaml',
  (raw) => load(raw) as CadLayoutYaml,
  () => {
    rebuildDerived();
    console.log('[server] config/layout/model-geometry.yaml reloaded');
  }
);
registry.register(layoutLoader);

const houseMetaLoader = new ConfigLoader<HouseYaml>(
  'config/house.yaml',
  (raw) => load(raw) as HouseYaml,
  () => {
    rebuildDerived();
    console.log('[server] config/house.yaml reloaded');
  }
);
registry.register(houseMetaLoader);

const pitfallsLoader = new ConfigLoader<PitfallConfig>(
  'config/budget-pitfalls.yaml',
  (raw) => load(raw) as PitfallConfig,
  () => {
    rebuildDerived();
    console.log('[server] config/budget-pitfalls.yaml reloaded');
  }
);
registry.register(pitfallsLoader);

designRulesLoader.load();
materialsLoader.load();
budgetBaseLoader.load();
layoutLoader.load();
const overlayLoader = new ConfigLoader<OverlayConfig>(
  'config/layout/overlay.yaml',
  (raw) => parseOverlay(raw),
  () => {
    console.log('[server] config/layout/overlay.yaml reloaded');
  }
);
registry.register(overlayLoader);

const environmentLoader = new ConfigLoader<EnvironmentConfig>(
  'config/environment.yaml',
  (raw) => parseEnvironment(raw),
  () => {
    console.log('[server] config/environment.yaml reloaded');
  }
);
registry.register(environmentLoader);
environmentLoader.load();

houseMetaLoader.load();
pitfallsLoader.load();
overlayLoader.load();
projectRenderFactsLoader.load();

let state: DesignState;
try {
  state = DesignState.load(catalog, DATA_DIR);
} catch (err) {
  console.error('[server] Failed to load design state, starting fresh:', err);
  state = new DesignState(catalog, DATA_DIR);
}

const archiveStore = new ArchivedSchemesStore(DATA_DIR);
const presentationState = new PresentationStateStore(DATA_DIR, () => overlayLoader.getConfig());

const apiDeps = {
  get catalog() { return catalog; },
  state,
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
  getPitfallEngine: () => pitfallEngine,
  getLifecycleEngine: () => lifecycleEngine,
  getTradeoffEngine: () => tradeoffEngine,
  getAcceptanceEngine: () => acceptanceEngine,
  getBudgetAdvisor: () => budgetAdvisor,
  getBudgetValueAnalyzer: () => budgetValueAnalyzer,
  archiveStore,
  presentationState,
  getConfigRegistry: () => registry,
  getOverlay: () => overlayLoader.getConfig(),
  getEnvironment: () => environmentLoader.getConfig(),
  getProjectRenderFacts: () => projectRenderFactsLoader.getFacts(),
  getMepLintContext: (): MepLintLayoutContext => {
    const facts = projectRenderFactsLoader.getFacts();
    const overlay = overlayLoader.getConfig();
    const layout = layoutLoader.getConfig();
    return {
      ...(layout ? { layout: resolveLayout(layout as unknown as VertexLayoutYaml) } : {}),
      ...(facts ? { ceiling: facts.ceiling, referenceConstraints: facts.hvac.plans[0]?.diagram.reference_constraints } : {}),
      suppressedWallIds: (overlay?.suppress ?? []).flatMap((item) => item.walls ?? (item.wall ? [item.wall] : [])),
    };
  },
  getProjectRenderFactsProjection: () => {
    const facts = projectRenderFactsLoader.getFacts();
    const overrides = projectRenderFactsLoader.getOverrides();
    const overlay = overlayLoader.getConfig();
    if (!facts || !overrides || !overlay) return undefined;
    return buildProjectRenderFactsProjection(
      facts,
      overrides,
      state.getCurrentScheme(),
      overlay,
      presentationState.get(),
      projectRenderFactsLoader.getLighting(),
    );
  },
};

const app = express();
app.use(express.json());
// PBR 真扫描贴图（web 端 TextureFactory pbr_texture 分支经 vite 代理读取）
app.use('/assets/textures', express.static('assets/textures'));
app.use('/api', createApiRouter(apiDeps));
app.use(
  '/api/analysis',
  createAnalysisRouter({
    get catalog() { return catalog; },
    getEnvironment: () => environmentLoader.getConfig(),
    getOverlay: () => overlayLoader.getConfig(),
  })
);
app.use('/api/furnishings', createFurnishingsRouter('config/house.yaml'));
app.use('/api/electrical', createElectricalRouter('config/electrical.yaml'));
app.use('/api/plumbing', createPlumbingRouter('config/plumbing.yaml'));

attachMcpTransports(app, () => createMcpServer(apiDeps)).then(() => {
  const server = app.listen(PORT, () => {
    console.log(`Bontop design server listening on http://localhost:${PORT}`);
  });

  designRulesLoader.startWatching();
  materialsLoader.startWatching();
  budgetBaseLoader.startWatching();
  layoutLoader.startWatching();
  houseMetaLoader.startWatching();
  pitfallsLoader.startWatching();
  overlayLoader.startWatching();
  environmentLoader.startWatching();
  projectRenderFactsLoader.startWatching();

  const shutdown = async () => {
    await registry.stopAll();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
