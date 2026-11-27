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
    assert.equal(payload.scope.wallRegionEntryCount, 33); // PR #270：净 +2
    assert.ok(Math.abs(payload.scope.grossWallAreaSqm - 174.248) <= 0.02, `毛墙面 ${payload.scope.grossWallAreaSqm}`); // PR #270 重算
    assert.equal(payload.scope.doorGapAreaSqm, 21.509, '门洞占位含主走廊三段墙脸的实际洞口（PR #270：d_bnw 0.90×2.10→0.98×2.445，2026-11-26 实测）');
    assert.equal(payload.scope.windowGapAreaSqm, 0, '窗洞当前为 0（窗全在玻璃幕墙上）');
    assert.ok(Math.abs(payload.scope.netWallAreaSqm - 152.743) <= 0.02, `净墙面 ${payload.scope.netWallAreaSqm}`);
    // 顶面仅由 paint_ceiling_region 选择；选中 footprint 127.291㎡ 减两间卫浴铝扣板 13.638㎡（PR #270 重算后；2026-11-16 D1 主卧圆角 −0.2146）。
    assert.ok(Math.abs(payload.scope.ceilingAreaSqm - 113.654) <= 0.02, `顶面 ${payload.scope.ceilingAreaSqm}`); // PR #270 重算；2026-11-16 D1 主卧圆角 −0.2146
    assert.ok(Math.abs(payload.scope.grossAreaSqm - 332.215) <= 0.02); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后主卧/书房上飘窗端面涂装面 +1.100，333.602→334.702；2026-11-12 吊顶下调 334.702→334.325；2026-11-16 D1 主卧圆角 −0.2146 → 334.11；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 333.945
    // 净面积 = 墙 + 顶 + 普通窗台 + 湿区窗台（全部涂装面，含单独计价的湿区）
    assert.ok(Math.abs(payload.scope.netAreaSqm - 310.71) <= 0.02, `净计费面积 ${payload.scope.netAreaSqm}`); // PR #270 重算；2026-11-12 吊顶下调 313.921→313.544；2026-11-16 D1 主卧圆角 −0.2146 → 313.329；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 313.164
    // 普通墙漆计价面积：湿区窗台单独计价，不按普通漆费率计费（旧 270.865 把湿区窗台也算进普通口径）
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm - 306.695) <= 0.02, `普通计费面积 ${payload.scope.ordinaryAreaSqm}`); // PR #270 重算；2026-11-12 吊顶下调 310.366→310.252；2026-11-16 D1 主卧圆角 −0.2146 → 310.037；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 309.872
    // 守恒：普通 + 湿区 = 全部涂装面
    assert.ok(Math.abs(payload.scope.ordinaryAreaSqm + payload.scope.antiMoldSqm - payload.scope.netAreaSqm) <= 0.01);
    assert.equal(payload.scope.ordinarySillAreaSqm, 40.298, '其余 7 处上飘窗按普通漆计价（厨房 P09 改贴砖）'); // PR #270：主卧 17.101→19.859、书房 5.58→5.531、东南客房 5.58→5.609、西北次卧 5.58→5.329；2026-11-12 吊顶下调 35.283→35.169；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 35.004
    // 2026-10-09 精度口径修复：内部全精度 + 汇总 round3，4.198 → 4.193㎡
    assert.equal(payload.scope.antiMoldSqm, 4.015, '主卫上飘窗外露面刷防霉漆，单独计价（已扣内部接缝端面）'); // PR #270：主卫西飘窗 2.522 + 前缘 1.492；2026-11-12 吊顶下调 3.555→3.292
    assert.equal(payload.scope.antiMoldStatus, 'pending_system_quote_and_site_validation');
    assert.deepEqual(payload.scope.sillAreaByRoom, { master_bath: 7.985, master_bedroom: 19.859, study: 5.531, bedroom_se: 5.609, bedroom_nw: 5.329 }, '厨房上飘窗 P09 改贴砖'); // PR #270：飘窗 sill/height 均按 2026-11-27 业主实测回填（主卧/书房/西北次卧 sill 2.07→2.149/2.163/2.156、高 0.76→0.75；主卫西飘窗北移且前缘 1.757→3.471m；主卫下飘窗贴砖面随实测墙长调整）；R04：bedroom_se 窗台面 5.04→5.58；DEC-2026-10-28-R05：主卧/书房窗帘盒移离上飘窗端面，master_bedroom 16.706→17.266、study 5.04→5.58；2026-11-12：主卫完成面 2.65→2.50，master_bath 4.832→4.455；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 17.101
    // 防霉漆只落在主卫（4.015），其余 8 处是普通漆
    assert.deepEqual(payload.scope.antiMoldSillAreaByRoom, { master_bath: 4.015 });
    assert.equal(payload.scope.ordinarySillAreaSqm, 40.298); // PR #270 重算；2026-11-23 通长假梁主卧飘窗窗台 −0.165
    assert.equal(payload.scope.sillSurfaces.length, 8, '8 条 paint_sill_region 声明（主卫防霉漆 + 其余 7 处普通漆；厨房 P09 改贴砖）');
    // 3D 高亮从「只高亮墙」扩展到「墙 + 已声明的窗台面」：窗台端面旧值源于
    // BaySillGeometry.reverse() 原地反转污染 wallPath，被配成横跨整条窗台的 1.803m 斜肢
    assert.equal(payload.scope.highlightedIn3d, 'walls_and_declared_sill_faces');
    // 3D 高亮与本接口必须是同一批声明：逐段都存在且能对上面积
    assert.equal(payload.scope.entries.length, 33); // PR #270：净 +2
    const byWallRoom = new Set(payload.scope.entries.map((entry: any) => `${entry.wall}|${entry.room}`));
    assert.equal(byWallRoom.size, 30, '同一面墙的双面涂漆必须是不同 (墙, 房间) 组合（PR #270：主卫东墙拆 4 段不增新组合、客卫东上段删不减组合，仍 30）');
    // DEC-2026-10-09-P07 砖漆互斥：9 段声明带 bottom（让出砖带），其中主卫东墙被防溅带
    // 切成四段（below top 0.77、mid top 1.10、above 自 1.10 起）；客卫东开放洗漱区上段已删，
    // 防溅带迁南墙后下段通高至 2.80。
    // 所以不变量是「top > bottom 且净面积为正」，不是「top 恒等于 2.80」。
    assert.ok(payload.scope.entries.every((entry: any) => entry.netAreaSqm > 0 && entry.top > entry.bottom))
    assert.equal(payload.scope.entries.filter((entry: any) => entry.bottom > 0).length, 9, '9 段声明让出防水/防溅砖带');
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
    assert.equal(deduct.areaSqm, 306.695); // PR #270 重算
    assert.equal(deduct.topcoatBuckets, 6);
    assert.equal(deduct.primerBuckets, 3);
    assert.equal(deduct.materialYuan, 5220);
    assert.equal(deduct.laborYuan, 7667.38); // PR #270：306.695×25；DEC-2026-10-28-R05 窗帘盒归位后计价面积 +1.100，人工 7731.65→7759.15；2026-11-12 吊顶下调计价面积 −0.114，人工 7759.15→7756.3；2026-11-16 D1 主卧圆角 −0.2146，人工 →7750.92；2026-11-23 通长假梁计价面积 −0.165，人工 →7746.80
    assert.equal(deduct.subtotalYuan, 12887.38); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal(deduct.vsPlannedDeltaYuan, 1387.38); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal(deduct.vsOwnerTargetDeltaYuan, 1887.38); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    // 对照：不扣洞 = 普通计费面积 + 门窗洞占位（306.695 + 21.509 = 328.204㎡）
    const gross = byId.get('topcoats2_no_deduct') as any;
    assert.equal(gross.areaSqm, 328.204); // PR #270 重算
    assert.equal(gross.topcoatBuckets, 7);
    assert.equal(gross.primerBuckets, 4);
    assert.equal(gross.materialYuan, 6380);
    assert.equal(gross.laborYuan, 8205.1); // PR #270：328.204×25；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 主卧圆角 −0.2146；2026-11-23 通长假梁计价面积 −0.165，人工 →8266.33
    assert.equal(gross.subtotalYuan, 14585.1); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal(gross.vsPlannedDeltaYuan, 3085.1); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal((byId.get('topcoats1_deduct') as any).areaSqm, 306.695); // PR #270 重算
    assert.equal((byId.get('topcoats1_deduct') as any).subtotalYuan, 11147.38); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal((byId.get('topcoats1_deduct') as any).vsOwnerTargetDeltaYuan, 147.38); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal((byId.get('topcoats1_no_deduct') as any).areaSqm, 328.204); // PR #270 重算
    assert.equal((byId.get('topcoats1_no_deduct') as any).subtotalYuan, 12845.1); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.equal((byId.get('topcoats1_no_deduct') as any).vsPlannedDeltaYuan, 1345.1); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
    assert.deepEqual(payload.reconciliation.modeledRangeCny, [11147.38, 14585.1]); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100㎡；2026-11-12 同上；2026-11-16 D1 同上；2026-11-23 通长假梁 −0.165㎡
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
    assert.ok(Math.abs(preview.scope.netAreaSqm - 310.71) <= 0.02); // PR #270 重算；DEC-2026-10-28-R05 窗帘盒归位后 +1.100；2026-11-12 吊顶下调 313.921→313.544；2026-11-16 D1 主卧圆角 −0.2146 → 313.329；2026-11-23 通长假梁主卧飘窗窗台 −0.165 → 313.164
    // 湿区窗台单独计价：预览里必须显形，不能悄悄并进普通墙漆面积
    assert.equal(preview.scope.antiMoldSqm, 4.015); // PR #270：主卫西飘窗 2.522 + 前缘 1.492；2026-11-12 吊顶下调 3.555→3.292
    assert.equal(preview.scope.antiMoldStatus, 'pending_system_quote_and_site_validation');
    assert.equal(preview.scope.doorGapAreaSqm, 21.509); // PR #270：d_bnw 0.90×2.10→0.98×2.445
    // 涂装科目自身按声明+拆洞实算，取「普通墙漆计价面积」306.236㎡
    // （= 净面积 267.337 − 湿区窗台 4.193；旧值 270.865 把湿区窗台也算进普通口径）
    const painting = body.categories.find((category: any) => category.key === 'painting');
    assert.ok(Math.abs(painting.autoActual - 1630.6) <= 1, `painting autoActual=${painting.autoActual}`); // PR #270：306.695/120×580×1.1 = 1630.595；DEC-2026-10-28-R05 +1.100㎡ → 候选材料款 1644→1650；2026-11-16 D1 主卧圆角 −0.2146㎡ → 材料款 1649.51→1648.36
    // 阶段 5 口径变更：actual 只计已取证款 + 人工。
    // painting 的材料款（1,566.912）是候选价 → 不进 actual；人工 7,369 进。
    assert.ok(Math.abs(painting.actual - 7667) <= 1, `painting actual=${painting.actual}`); // PR #270：306.695×25；DEC-2026-10-28-R05 +1.100；2026-11-12 吊顶下调 7759→7756；2026-11-16 D1 人工 −5 → 7751；2026-11-23 通长假梁人工 −4 → 7747
    assert.ok(Math.abs(painting.candidateActual! - 1630.6) <= 1, `painting candidateActual=${painting.candidateActual}`); // PR #270：306.695/120×580×1.1 = 1630.595；DEC-2026-10-28-R05 +1.100㎡；2026-11-16 D1 同上
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
