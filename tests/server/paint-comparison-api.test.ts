import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { load } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { createApiRouter } from '../../server/routes.js';
import type { DesignRulesConfig, VertexLayoutYaml } from '../../shared/types.js';

// 涂漆成本核算子系统（墙顶面涂装 PKG-080）。与 GET /api/tiles/comparison 平级：
// 只读、无写方法、读两次字节一致，且 503 时不带崩预算快照。
const TEST_DATA_DIR = './tmp/test-data-paint-comparison-api';

describe('GET /api/paint/comparison', () => {
  let router: ReturnType<typeof createApiRouter>;
  let state: DesignState;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const geometry = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
    const resolvedLayout = resolveLayout(geometry);
    state = DesignState.load(catalog, TEST_DATA_DIR);
    // 必须用真实的 design-rules.yaml：预算行项目与 topicCategories 都在里面，空 rules 会让
    // painting 科目一个行项目都不生成（autoActual=0），测不出面积口径。
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const engine = new RuleEngine(rules);
    const calc = new BudgetCalculator(catalog, rules);
    router = createApiRouter({
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore: new ArchivedSchemesStore(TEST_DATA_DIR),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
      getResolvedLayout: () => resolvedLayout,
    });
  });

  function callRoute(method: 'get' | 'post', path: string): { statusCode: number; body?: unknown; exists: boolean } {
    const stack = (router as unknown as {
      stack: Array<{ route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      } }>;
    }).stack;
    const route = stack.map(layer => layer.route).find(item => item?.path === path);
    if (!route?.methods[method]) return { statusCode: 404, exists: false };
    let statusCode = 200;
    let body: unknown;
    const response = {
      status(code: number) { statusCode = code; return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as Response;
    route.stack[0].handle({} as Request, response);
    return { statusCode, body, exists: true };
  }

  it('returns the declared paint scope with per-room areas and deducted openings', () => {
    const { statusCode, body } = callRoute('get', '/paint/comparison');
    assert.equal(statusCode, 200);
    const payload = body as any;
    // C06：入户花园出范围（5 房 / 22 段），门窗洞按实扣除
    assert.equal(payload.scope.paintRoomCount, 7);
    assert.equal(payload.scope.wallRegionEntryCount, 28);
    assert.ok(Math.abs(payload.scope.grossWallAreaSqm - 174.720) <= 0.02, `毛墙面 ${payload.scope.grossWallAreaSqm}`);
    assert.equal(payload.scope.doorGapAreaSqm, 14.805, '门洞占位实算');
    assert.equal(payload.scope.windowGapAreaSqm, 0, '窗洞当前为 0（窗全在玻璃幕墙上）');
    assert.ok(Math.abs(payload.scope.netWallAreaSqm - 159.915) <= 0.02, `净墙面 ${payload.scope.netWallAreaSqm}`);
    // 顶面旧值 110.95㎡ 错在把客卫 3.15㎡ / 主卫 4.576㎡ 的整间铝扣板顶面当成普通乳胶漆顶面
    // 计费；集成吊顶不是涂装面，按投影扣除后 = 103.224㎡
    assert.ok(Math.abs(payload.scope.ceilingAreaSqm - 103.224) <= 0.02, `顶面 ${payload.scope.ceilingAreaSqm}`);
    assert.ok(Math.abs(payload.scope.grossAreaSqm - 282.137) <= 0.02);
    // 净面积 = 墙 + 顶 + 普通窗台 + 湿区窗台（全部涂装面，含单独计价的湿区）
    assert.ok(Math.abs(payload.scope.netAreaSqm - 267.337) <= 0.02, `净计费面积 ${payload.scope.netAreaSqm}`);
    // 普通墙漆计价面积：湿区窗台单独计价，不按普通漆费率计费（旧 270.865 把湿区窗台也算进普通口径）
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm - 263.139) <= 0.02, `普通计费面积 ${payload.scope.ordinaryAreaSqm}`);
    // 守恒：普通 + 湿区 = 全部涂装面
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm + payload.scope.wetAreaSqm - payload.scope.netAreaSqm) <= 0.01);
    assert.equal(payload.scope.ordinarySillAreaSqm, 0, '当前没有按普通漆计价的窗台');
    // 2026-10-09 精度口径修复：内部全精度 + 汇总 round3，4.198 → 4.193㎡
    assert.equal(payload.scope.wetAreaSqm, 4.193, '主卫上飘窗外露面是湿区，单独计价');
    assert.equal(payload.scope.wetAreaStatus, 'pending_system_quote_and_site_validation');
    assert.deepEqual(payload.scope.sillAreaByRoom, { master_bath: 4.193 });
    assert.equal(payload.scope.sillSurfaces.length, 1, '只有一条 paint_sill_region 声明');
    // 3D 高亮从「只高亮墙」扩展到「墙 + 已声明的窗台面」：窗台端面旧值源于
    // BaySillGeometry.reverse() 原地反转污染 wallPath，被配成横跨整条窗台的 1.803m 斜肢
    assert.equal(payload.scope.highlightedIn3d, 'walls_and_declared_sill_faces');
    // 3D 高亮与本接口必须是同一批声明：逐段都存在且能对上面积
    assert.equal(payload.scope.entries.length, 28);
    const byWallRoom = new Set(payload.scope.entries.map((entry: any) => `${entry.wall}|${entry.room}`));
    assert.equal(byWallRoom.size, 28, '同一面墙的双面涂漆必须是不同 (墙, 房间) 组合');
    assert.ok(payload.scope.entries.every((entry: any) => entry.netAreaSqm > 0 && entry.top === 2.8));
    const split = payload.scope.entries.filter((entry: any) => entry.rects.length > 1);
    assert.equal(split.length, 8, '7 房范围内 8 段声明被门洞拆开');
    const gapped = payload.scope.entries.filter((entry: any) => entry.gaps.length > 0);
    assert.equal(gapped.length, 8);
    assert.ok(gapped.every((entry: any) => entry.gaps.every((gap: any) => gap.kind === 'door')));
  });

  it('models material and labor per scenario and reconciles against PKG-080', () => {
    const { body } = callRoute('get', '/paint/comparison');
    const payload = body as any;
    assert.equal(payload.material.id, 'latex_paint_01');
    assert.equal(payload.material.brand, '多乐士');
    assert.equal(payload.material.pricePerUnit, 580);
    assert.equal(payload.material.coveragePerUnit, 120);
    assert.equal(payload.material.priceYuanPerSqmPerCoat, 4.83);
    assert.equal(payload.labor.rateYuanPerSqm, 25);
    assert.equal(payload.reconciliation.pkgId, 'PKG-080');
    assert.equal(payload.reconciliation.plannedCny, 11500);
    assert.equal(payload.reconciliation.ownerTargetCny, 11000);
    assert.equal(payload.reconciliation.selectedScenarioId, null);

    const byId = new Map(payload.scenarios.map((scenario: any) => [scenario.scenarioId, scenario]));
    // 默认口径：2 遍 + 扣门窗洞。计价面积 = ordinaryAreaSqm（湿区窗台单列，不按普通漆计价）
    const deduct = byId.get('topcoats2_deduct') as any;
    assert.equal(deduct.areaSqm, 263.139);
    assert.equal(deduct.topcoatBuckets, 5);
    assert.equal(deduct.primerBuckets, 3);
    assert.equal(deduct.materialYuan, 4640);
    assert.equal(deduct.laborYuan, 6578.48);
    assert.equal(deduct.subtotalYuan, 11218.48);
    assert.equal(deduct.vsPlannedDeltaYuan, -281.52);
    assert.equal(deduct.vsOwnerTargetDeltaYuan, 218.48);
    // 对照：不扣洞 = 普通计费面积 + 门窗洞占位（旧 285.67㎡ 已作废：顶面未扣铝扣板、
    // 且把湿区窗台算进普通墙漆口径）
    const gross = byId.get('topcoats2_no_deduct') as any;
    assert.equal(gross.areaSqm, 277.944);
    assert.equal(gross.topcoatBuckets, 6);
    assert.equal(gross.primerBuckets, 3);
    assert.equal(gross.materialYuan, 5220);
    assert.equal(gross.laborYuan, 6948.6);
    assert.equal(gross.subtotalYuan, 12168.6);
    assert.equal(gross.vsPlannedDeltaYuan, 668.6);
    assert.equal((byId.get('topcoats1_deduct') as any).areaSqm, 263.139);
    assert.equal((byId.get('topcoats1_deduct') as any).subtotalYuan, 10058.48);
    assert.equal((byId.get('topcoats1_deduct') as any).vsOwnerTargetDeltaYuan, -941.52);
    assert.equal((byId.get('topcoats1_no_deduct') as any).areaSqm, 277.944);
    assert.equal((byId.get('topcoats1_no_deduct') as any).subtotalYuan, 10428.6);
    assert.equal((byId.get('topcoats1_no_deduct') as any).vsPlannedDeltaYuan, -1071.4);
    assert.deepEqual(payload.reconciliation.modeledRangeCny, [10058.48, 12168.6]);
    assert.ok(payload.assumptions.some((a: any) => a.status === 'assumed_unconfirmed'));
    assert.equal(payload.interpretation.selectedScenarioId, null);
    assert.match(payload.interpretation.disclaimer, /COST-080-01\/02\/04/);
  });

  it('is read-only and byte-identical across reads', () => {
    const first = callRoute('get', '/paint/comparison');
    const second = callRoute('get', '/paint/comparison');
    assert.equal(JSON.stringify(first.body), JSON.stringify(second.body));
    assert.deepEqual(callRoute('post', '/paint/comparison'), { statusCode: 404, exists: false });
  });
});

describe('GET /api/budget paint preview overlay', () => {
  function callBudget(router: ReturnType<typeof createApiRouter>): any {
    const stack = (router as unknown as {
      stack: Array<{ route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => void }>;
      } }>;
    }).stack;
    const route = stack.map(layer => layer.route).find(item => item?.path === '/budget');
    assert.ok(route?.methods.get, '/budget must exist');
    let body: unknown;
    const response = {
      status() { return this; },
      json(value: unknown) { body = value; return this; },
    } as unknown as Response;
    route!.stack[0].handle({ query: {} } as unknown as Request, response);
    return body;
  }

  it('attaches paintBudgetPreview without touching budget totals', () => {
    const catalog = ProjectCatalog.load('.');
    const geometry = load(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as VertexLayoutYaml;
    const resolvedLayout = resolveLayout(geometry);
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const budgetState = DesignState.load(catalog, TEST_DATA_DIR);
    // 材料行项目需要方案里选中一个乳胶漆选项才计价（与地面/墙砖行项目同一规则）。
    budgetState.applySelections([{ topic: 'paint', optionId: 'latex_paint_01' }], 'test');
    const router = createApiRouter({
      catalog,
      state: budgetState,
      getRuleEngine: () => new RuleEngine(rules),
      getBudgetCalculator: () => new BudgetCalculator(catalog, rules),
      archiveStore: new ArchivedSchemesStore(TEST_DATA_DIR),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
      getResolvedLayout: () => resolvedLayout,
    });
    const body = callBudget(router);
    const preview = body.paintBudgetPreview;
    assert.ok(preview, 'budget snapshot must carry the paint overlay');
    assert.equal(preview.status, 'comparison_overlay_only');
    assert.equal(preview.includedInTotalActual, false);
    assert.equal(preview.includedInCategoryTotals, false);
    assert.equal(preview.scope.highlightedIn3d, 'walls_and_declared_sill_faces');
    assert.ok(Math.abs(preview.scope.netAreaSqm - 267.337) <= 0.02);
    // 湿区窗台单独计价：预览里必须显形，不能悄悄并进普通墙漆面积
    assert.equal(preview.scope.wetAreaSqm, 4.193);
    assert.equal(preview.scope.wetAreaStatus, 'pending_system_quote_and_site_validation');
    assert.equal(preview.scope.doorGapAreaSqm, 14.805);
    // 涂装科目自身按声明+拆洞实算，取「普通墙漆计价面积」263.139㎡
    // （= 净面积 267.337 − 湿区窗台 4.193；旧值 270.865 把湿区窗台也算进普通口径）
    const painting = body.categories.find((category: any) => category.key === 'painting');
    assert.ok(Math.abs(painting.autoActual - 1399.02235) <= 1, `painting autoActual=${painting.autoActual}`);
    assert.ok(Math.abs(painting.actual - 7977.02235) <= 1, `painting actual=${painting.actual}`);
    assert.equal(painting.status, 'ok');
  });

  it('omits the paint overlay when the resolved layout is unavailable', () => {
    const catalog = ProjectCatalog.load('.');
    const rules = RuleEngine.load('config/design-rules.yaml').getConfig();
    const router = createApiRouter({
      catalog,
      state: DesignState.load(catalog, TEST_DATA_DIR),
      getRuleEngine: () => new RuleEngine(rules),
      getBudgetCalculator: () => new BudgetCalculator(catalog, rules),
      archiveStore: new ArchivedSchemesStore(TEST_DATA_DIR),
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
      getResolvedLayout: () => undefined,
    });
    const body = callBudget(router);
    assert.equal('paintBudgetPreview' in body, false, 'layout 缺失时预算快照仍可用，只是不带涂漆叠加');
  });
});
