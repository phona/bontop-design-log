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
    // C06：入户花园出范围；当前含开放主走廊三段墙面声明，门窗洞按实扣除。
    assert.equal(payload.scope.paintRoomCount, 8);
    assert.equal(payload.scope.wallRegionEntryCount, 31); // R01：净 −1
    assert.ok(Math.abs(payload.scope.grossWallAreaSqm - 187.143) <= 0.02, `毛墙面 ${payload.scope.grossWallAreaSqm}`);
    assert.equal(payload.scope.doorGapAreaSqm, 20.781, '门洞占位含主走廊三段墙脸的实际洞口（R01：入户门洞拓宽）');
    assert.equal(payload.scope.windowGapAreaSqm, 0, '窗洞当前为 0（窗全在玻璃幕墙上）');
    assert.ok(Math.abs(payload.scope.netWallAreaSqm - 166.362) <= 0.02, `净墙面 ${payload.scope.netWallAreaSqm}`);
    // 顶面仅由 paint_ceiling_region 选择；选中 footprint 115.318㎡ 减两间卫浴铝扣板 7.936㎡（R01 后）。
    assert.ok(Math.abs(payload.scope.ceilingAreaSqm - 107.382) <= 0.02, `顶面 ${payload.scope.ceilingAreaSqm}`);
    assert.ok(Math.abs(payload.scope.grossAreaSqm - 332.263) <= 0.02); // R01
    // 净面积 = 墙 + 顶 + 普通窗台 + 湿区窗台（全部涂装面，含单独计价的湿区）
    assert.ok(Math.abs(payload.scope.netAreaSqm - 311.482) <= 0.02, `净计费面积 ${payload.scope.netAreaSqm}`); // R01
    // 普通墙漆计价面积：湿区窗台单独计价，不按普通漆费率计费（旧 270.865 把湿区窗台也算进普通口径）
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm - 307.927) <= 0.02, `普通计费面积 ${payload.scope.ordinaryAreaSqm}`); // R01
    // 守恒：普通 + 湿区 = 全部涂装面
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm + payload.scope.antiMoldSqm - payload.scope.netAreaSqm) <= 0.01);
    assert.equal(payload.scope.ordinarySillAreaSqm, 34.183, '其余 7 处上飘窗按普通漆计价（厨房 P09 改贴砖）');
    // 2026-10-09 精度口径修复：内部全精度 + 汇总 round3，4.198 → 4.193㎡
    assert.equal(payload.scope.antiMoldSqm, 3.555, '主卫上飘窗外露面刷防霉漆，单独计价（已扣内部接缝端面）');
    assert.equal(payload.scope.antiMoldStatus, 'pending_system_quote_and_site_validation');
    assert.deepEqual(payload.scope.sillAreaByRoom, { master_bath: 4.832, master_bedroom: 16.706, study: 5.04, bedroom_se: 5.58, bedroom_nw: 5.58 }, '厨房上飘窗 P09 改贴砖'); // R04：bedroom_se 窗台面 5.04→5.58
    // 防霉漆只落在主卫（3.555），其余 8 处是普通漆
    assert.deepEqual(payload.scope.antiMoldSillAreaByRoom, { master_bath: 3.555 });
    assert.equal(payload.scope.ordinarySillAreaSqm, 34.183);
    assert.equal(payload.scope.sillSurfaces.length, 8, '8 条 paint_sill_region 声明（主卫防霉漆 + 其余 7 处普通漆；厨房 P09 改贴砖）');
    // 3D 高亮从「只高亮墙」扩展到「墙 + 已声明的窗台面」：窗台端面旧值源于
    // BaySillGeometry.reverse() 原地反转污染 wallPath，被配成横跨整条窗台的 1.803m 斜肢
    assert.equal(payload.scope.highlightedIn3d, 'walls_and_declared_sill_faces');
    // 3D 高亮与本接口必须是同一批声明：逐段都存在且能对上面积
    assert.equal(payload.scope.entries.length, 31); // R01：净 −1
    const byWallRoom = new Set(payload.scope.entries.map((entry: any) => `${entry.wall}|${entry.room}`));
    assert.equal(byWallRoom.size, 30, '同一面墙的双面涂漆必须是不同 (墙, 房间) 组合（R01：删两段、增一段）');
    // DEC-2026-10-09-P07 砖漆互斥：7 段声明带 bottom（让出砖带），其中客卫开放洗漱区东墙
    // 被两条砖带切成上下两段，下段的 top 是 0.77（防溅带下沿）而不是 2.80。
    // 所以不变量是「top > bottom 且净面积为正」，不是「top 恒等于 2.80」。
    assert.ok(payload.scope.entries.every((entry: any) => entry.netAreaSqm > 0 && entry.top > entry.bottom))
    assert.equal(payload.scope.entries.filter((entry: any) => entry.bottom > 0).length, 7, '7 段声明让出防水/防溅砖带');
    const split = payload.scope.entries.filter((entry: any) => entry.rects.length > 1);
    assert.equal(split.length, 11, '当前范围内11段声明被门洞拆开');
    const gapped = payload.scope.entries.filter((entry: any) => entry.gaps.length > 0);
    assert.equal(gapped.length, 11);
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
    // 默认口径：2 遍 + 扣门窗洞。计价面积 = ordinaryAreaSqm（防霉漆窗台单列，不按普通漆计价）
    const deduct = byId.get('topcoats2_deduct') as any;
    assert.equal(deduct.areaSqm, 307.927);
    assert.equal(deduct.topcoatBuckets, 6);
    assert.equal(deduct.primerBuckets, 3);
    assert.equal(deduct.materialYuan, 5220);
    assert.equal(deduct.laborYuan, 7698.18);
    assert.equal(deduct.subtotalYuan, 12918.18);
    assert.equal(deduct.vsPlannedDeltaYuan, 1418.18);
    assert.equal(deduct.vsOwnerTargetDeltaYuan, 1918.18);
    // 对照：不扣洞 = 普通计费面积 + 门窗洞占位（307.927 + 20.781 = 328.708㎡）
    const gross = byId.get('topcoats2_no_deduct') as any;
    assert.equal(gross.areaSqm, 328.708);
    assert.equal(gross.topcoatBuckets, 7);
    assert.equal(gross.primerBuckets, 4);
    assert.equal(gross.materialYuan, 6380);
    assert.equal(gross.laborYuan, 8217.7);
    assert.equal(gross.subtotalYuan, 14597.7);
    assert.equal(gross.vsPlannedDeltaYuan, 3097.7);
    assert.equal((byId.get('topcoats1_deduct') as any).areaSqm, 307.927);
    assert.equal((byId.get('topcoats1_deduct') as any).subtotalYuan, 11178.18);
    assert.equal((byId.get('topcoats1_deduct') as any).vsOwnerTargetDeltaYuan, 178.18);
    assert.equal((byId.get('topcoats1_no_deduct') as any).areaSqm, 328.708);
    assert.equal((byId.get('topcoats1_no_deduct') as any).subtotalYuan, 12857.7);
    assert.equal((byId.get('topcoats1_no_deduct') as any).vsPlannedDeltaYuan, 1357.7);
    assert.deepEqual(payload.reconciliation.modeledRangeCny, [11178.18, 14597.7]); // R01
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
    assert.ok(Math.abs(preview.scope.netAreaSqm - 311.482) <= 0.02); // R01
    // 湿区窗台单独计价：预览里必须显形，不能悄悄并进普通墙漆面积
    assert.equal(preview.scope.antiMoldSqm, 3.555);
    assert.equal(preview.scope.antiMoldStatus, 'pending_system_quote_and_site_validation');
    assert.equal(preview.scope.doorGapAreaSqm, 20.781); // R01
    // 涂装科目自身按声明+拆洞实算，取「普通墙漆计价面积」306.236㎡
    // （= 净面积 267.337 − 湿区窗台 4.193；旧值 270.865 把湿区窗台也算进普通口径）
    const painting = body.categories.find((category: any) => category.key === 'painting');
    assert.ok(Math.abs(painting.autoActual - 1637) <= 1, `painting autoActual=${painting.autoActual}`); // R01
    // 阶段 5 口径变更：actual 只计已取证款 + 人工。
    // painting 的材料款（1,566.912）是候选价 → 不进 actual；人工 7,369 进。
    assert.ok(Math.abs(painting.actual - 7698) <= 1, `painting actual=${painting.actual}`); // R01
    assert.ok(Math.abs(painting.candidateActual! - 1637) <= 1, `painting candidateActual=${painting.candidateActual}`); // R01
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
