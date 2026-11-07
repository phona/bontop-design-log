import express from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from './project-catalog.js';
import { DesignState } from './design-state.js';
import { createApiRouter } from './routes.js';
import { createFurnishingsRouter } from './routes-furnishings.js';
import { createElectricalRouter } from './routes-electrical.js';
import { createPlumbingRouter } from './routes-plumbing.js';
import { RuleEngine } from './rule-engine.js';
import { BudgetCalculator } from './budget-calculator.js';
import { ArchivedSchemesStore } from './archived-schemes.js';
import { ConfigLoader, ConfigRegistry } from './config-loader.js';
import { ProjectRenderFactsLoader } from './project-render-facts-loader.js';
import { buildProjectRenderFactsProjection } from '../shared/project-render-facts-projection.js';
import { parseOverlayFiles, OVERLAY_SOURCE_FILES, SKIRTING_DERIVATION_SOURCE_FILES } from './overlay-merge.js';
import type { OverlayConfig } from './overlay-merge.js';
import { buildMepBaySillCollisionVolumes, buildMepFurnitureCollisionVolumes, invalidateMepFurnitureCollisionVolumes } from './mep-lint-context.js';
import { parseEnvironment } from '../shared/environment-schema.js';
import type { EnvironmentConfig } from '../shared/environment-schema.js';
import { createAnalysisRouter } from './analysis-routes.js';
import { PresentationStateStore } from './presentation-state.js';
import { getElementState } from './element-state-service.js';
import { resolveLayout } from './layout-resolver.js';
import { resolveWriteToken, createWriteTokenGuard } from './write-token.js';
import { sweepAcceptanceStaging } from './acceptance-draft-store.js';
import { jsonErrorHandler } from './json-error-handler.js';
import type { MepLintLayoutContext } from '../shared/mep-hvac-lint.js';
import { suppressedWallIds } from '../shared/suppression.js';
import type { DesignRulesConfig, MaterialsYaml, CadLayoutYaml, HouseYaml, VertexLayoutYaml } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? 'localhost';
const DATA_DIR = process.env.DATA_DIR ?? './data';
const CONFIG_PATH = process.env.CONFIG_PATH ?? 'config/design-rules.yaml';

const registry = new ConfigRegistry();
const projectRenderFactsLoader = new ProjectRenderFactsLoader();
registry.register(projectRenderFactsLoader);

let catalog = ProjectCatalog.fromMaterials(
  { materials: [] },
  { categories: {} },
  { rooms: [] } as unknown as CadLayoutYaml
);
let ruleEngine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
let budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
let state: DesignState | undefined;

function rebuildDerived(): void {
  const materials = materialsLoader.getConfig() ?? { materials: [] };
  const budgetBase = budgetBaseLoader.getConfig() ?? { categories: {} };
  const layout = layoutLoader.getConfig() ?? ({ rooms: [] } as unknown as CadLayoutYaml);
  const houseMeta = houseMetaLoader.getConfig();
  catalog = ProjectCatalog.fromMaterials(materials, budgetBase, layout, houseMeta, 'model-geometry');
  const rulesConfig = designRulesLoader.getConfig() ?? { version: '1.0', risks: [], constraints: [] };
  ruleEngine = new RuleEngine(rulesConfig);
  budgetCalculator = new BudgetCalculator(catalog, ruleEngine.getConfig());
  state?.updateCatalog(catalog);
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
    invalidateMepFurnitureCollisionVolumes();
    rebuildDerived();
    console.log('[server] config/layout/model-geometry.yaml reloaded');
  }
);
registry.register(layoutLoader);

const houseMetaLoader = new ConfigLoader<HouseYaml>(
  'config/house.yaml',
  (raw) => load(raw) as HouseYaml,
  () => {
    invalidateMepFurnitureCollisionVolumes();
    rebuildDerived();
    console.log('[server] config/house.yaml reloaded');
  }
);
registry.register(houseMetaLoader);

designRulesLoader.load();
materialsLoader.load();
budgetBaseLoader.load();
layoutLoader.load();
const overlayLoader = new ConfigLoader<OverlayConfig>(
  // S5：skirting 由 model-geometry 墙特征 paint_bands 派生、湿区判定读 tile-comparison，
  // 这两个文件必须进监听，否则改漆面带/湿区表不刷新派生结果（理由见 overlay-merge.ts 的
  // SKIRTING_DERIVATION_SOURCE_FILES 注释）。
  [...Object.values(OVERLAY_SOURCE_FILES), ...SKIRTING_DERIVATION_SOURCE_FILES],
  () => parseOverlayFiles(),
  () => {
    invalidateMepFurnitureCollisionVolumes();
    console.log('[server] config/model/envelope/{openings,floor-zones,finish-defaults}.yaml + skirting 派生依赖 reloaded');
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
overlayLoader.load();
projectRenderFactsLoader.load();

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
  get state() {
    if (!state) throw new Error('design state is not ready');
    return state;
  },
  getRuleEngine: () => ruleEngine,
  getBudgetCalculator: () => budgetCalculator,
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
    const resolvedLayout = layout ? resolveLayout(layout as unknown as VertexLayoutYaml) : undefined;
    return {
      ...(resolvedLayout ? {
        layout: resolvedLayout,
        baySills: buildMepBaySillCollisionVolumes(resolvedLayout, overlay),
        furnitureVolumes: buildMepFurnitureCollisionVolumes(),
      } : {}),
      ...(facts ? { ceiling: facts.ceiling, referenceConstraints: facts.hvac.plans[0]?.diagram.reference_constraints } : {}),
      // suppress 改判（2026-11-07 issue #98 第三阶段 S3）：view-context 的 suppressedWallIds
      // 改读墙条目自身的 suppressed 属性（layout 经 resolveLayout 透传），权威实现
      // shared/suppression.ts；原 overlay.suppress 顶层清单已删。
      suppressedWallIds: suppressedWallIds(resolvedLayout?.walls ?? []),
    };
  },
  getResolvedLayout: () => {
    const layout = layoutLoader.getConfig();
    if (!layout || !('vertices' in layout)) throw new Error('current vertex layout is not ready');
    return resolveLayout(layout as unknown as VertexLayoutYaml);
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
  // 构件级工程状态投影：现算（conflicts 路径在服务内缓存），输入异常时抛错 → 路由 503。
  getElementState: (options: { withConflicts?: boolean; refresh?: boolean }) => getElementState(options),
};

const app = express();
// 写操作 token 认证（issue #64，2026-11-04 业主拍板）：一律认证、不豁免——
// 所有 POST/PUT/PATCH/DELETE 必须带 x-bontop-token（含跑卡点 / dry_run / 状态同步），
// GET 一律不校验；本机回环同样不免 token（`--host 0.0.0.0` 手机联调不再静默 403）。
// 守卫挂在 express.json() 之前：被拒的写不解析 body。
const writeToken = resolveWriteToken();
if (writeToken.source === 'generated') {
  console.log(`[server] write token 首次生成：${writeToken.token}（已写入 .bontop-write-token，重启复用；轮换 = 手动删除该文件）`);
} else {
  const origin = writeToken.source === 'env' ? 'BONTOP_WRITE_TOKEN 环境变量' : '.bontop-write-token 文件';
  console.log(`[server] write token（来源：${origin}）：${writeToken.token}`);
}
app.use(createWriteTokenGuard(writeToken.token));
// All API requests use small structured payloads.  Keep malformed or
// oversized JSON from consuming the server before route-level validation runs.
app.use(express.json({ limit: '1mb', strict: true }));
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
// JSON 错误出口（issue #70）：body-parser 超限（entity.too.large）转 413 JSON，替代
// express 默认 HTML 错误页（前端只剩「HTTP 413」无重试引导）。放在所有路由之后、
// listen 之前；其余错误原样 next。
app.use(jsonErrorHandler);

// 暂存区启动清扫（issue #84）：clearStaging 只在提交成功后调用，中途失败/放弃提交
// 会把暂存文件留在 tmp/（.gitignore，业主不可见）无声堆积。启动时按年龄清一次——
// 只删修改时间早于 7 天的条目，年轻的一律不碰（失败提交的暂存可能还要重试）。
// 函数自身不抛（读不到/删不掉只记日志），放在 listen 前：清扫失败不影响起服务。
sweepAcceptanceStaging();

const server = app.listen(PORT, HOST, () => {
  console.log(`Bontop design server listening on http://${HOST}:${PORT}`);
});

designRulesLoader.startWatching();
materialsLoader.startWatching();
budgetBaseLoader.startWatching();
layoutLoader.startWatching();
houseMetaLoader.startWatching();
overlayLoader.startWatching();
environmentLoader.startWatching();
projectRenderFactsLoader.startWatching();

const shutdown = async () => {
  await registry.stopAll();
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
