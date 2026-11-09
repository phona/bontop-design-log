/**
 * /api/project 宽容读取 + 正式交付严格输出（issue #98，PR #122 深审修复）。
 *
 * 病根（深审 high）：疗法①（PR #162）把交付闭合性断言接进 /api/project，宿主缺失即 503——
 * 页面既不能显示问题，也不能继续预览。修复口径（issue #98：「宽容读取、局部降级、统一诊断、
 * 严格输出：页面可显示问题并继续预览；正式 CAD/施工交付与相关模型验证必须因适用范围内的
 * 真实错误失败」）：
 *   - /api/project 是页面预览入口：闭合性失败 → **200 + placementClosureDiagnostics**
 *     （哪些点位缺哪个宿主、可能原因），不 503；
 *   - 正式交付路径（DXF 装配的 errors 通道，npm run export:dxf 与页面导出共用）遇到同样的
 *     断引用必须失败——不许为了修页面把严格输出一起放松。
 * 本文件两段各守一侧。此前闭合性断言零自动化测试（深审 medium）：删掉 routes.ts 里的调用
 * 现有测试全绿——这里补上行为级守护。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync } from 'node:fs';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { parseOverlay } from '../../server/overlay-merge.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import type { ProjectApiResponse, PlacementClosureApiDiagnostics } from '../../shared/api-project.js';
import type { ElectricalPoint, ProjectRenderFacts } from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-api-placement-closure';

/**
 * 声明 mount 宿主不在定位宿主表的点位（断引用形态：宿主表里没有 ld.ghost_cabinet）。
 * 闭合性检查只读 mount.furniture_id，其余定位字段按 ElectricalPoint 声明补齐示意值。
 */
const BROKEN_POINT = {
  id: 'closure_broken_night_light',
  room: 'living_dining',
  type: 'night_light',
  mount: { furniture_id: 'ld.ghost_cabinet', face: 'north', along: 0.5 },
} as unknown as ElectricalPoint;

/** 只含断引用点位的 render facts：/api/project 的闭合性检查与 house.electrical 都消费它。 */
const brokenFacts = {
  electrical: [BROKEN_POINT],
  plumbing: [],
  ceiling: [],
  // /api/project 不读 facts.hvac；补位仅为满足 ProjectRenderFacts 形状。
  hvac: {},
} as unknown as ProjectRenderFacts;

/** 起一个带真实 config 的 /api 应用（同 tests/server/api.test.ts 的装配）。 */
function buildApp(options: { withBrokenFacts?: boolean } = {}): express.Express {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, TEST_DATA_DIR);
  const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
  const calc = new BudgetCalculator(catalog, engine.getConfig());
  const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
  const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
`);
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter({
    catalog,
    state,
    getRuleEngine: () => engine,
    getBudgetCalculator: () => calc,
    archiveStore,
    getConfigRegistry: () => new ConfigRegistry(),
    getOverlay: () => overlay,
    // 断引用形态从这条注入：路由对 electrical/plumbing 的闭合性检查与下发消费同一份 facts。
    ...(options.withBrokenFacts ? { getProjectRenderFacts: () => brokenFacts } : {}),
  }));
  return app;
}

describe('/api/project 宽容读取（issue #98：闭合性失败 200 + 诊断，不再 503）', () => {
  let brokenApp: express.Express;
  let healthyApp: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    brokenApp = buildApp({ withBrokenFacts: true });
    healthyApp = buildApp();
  });

  after(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('宿主缺失时返回 200 + placementClosureDiagnostics（点名点位/宿主/可能原因），不 503', async () => {
    const res = await request(brokenApp).get('/api/project');
    assert.equal(res.status, 200, `闭合性失败必须 200 + 诊断（宽容读取），实际 ${res.status}：${JSON.stringify(res.body).slice(0, 300)}`);

    const diagnostics = res.body.placementClosureDiagnostics as PlacementClosureApiDiagnostics | undefined;
    assert.ok(diagnostics, '响应缺 placementClosureDiagnostics：页面无从显形问题');
    assert.equal(diagnostics.count, diagnostics.violations.length);
    assert.ok(diagnostics.count >= 1, '断引用点位未产生任何闭合性诊断');
    assert.match(diagnostics.violations[0], /电气点位 closure_broken_night_light/, '诊断必须点名点位');
    assert.match(diagnostics.violations[0], /ld\.ghost_cabinet/, '诊断必须点名缺失的宿主');
    assert.match(diagnostics.violations[0], /宿主被阶段过滤|断引用/, '诊断必须给可能原因');
    assert.match(diagnostics.guidance, /处理方向/, '诊断必须带统一处理方向（修配置而非放宽断言）');
    assert.match(diagnostics.guidance, /正式 DXF 导出与模型验证/, '处理方向必须说明正式交付仍会失败（严格输出）');
  });

  it('闭合失败不掐死交付物：断言消费的 electrical 与随响应下发的 house.electrical 是同一份，点位仍在场可预览', async () => {
    const res = await request(brokenApp).get('/api/project');
    assert.equal(res.status, 200);
    // 点位全量下发（宽容读取、局部降级）：页面能继续预览其余部分，缺宿主的点位由前端
    // 场景诊断显形，而不是整个响应 503。
    const deliveredElectrical = res.body.house.electrical as ElectricalPoint[];
    assert.ok(deliveredElectrical.some((p) => p.id === BROKEN_POINT.id), '断引用点位被从响应里剔除了：页面连「哪个点位有问题」都看不到');
    // 房间/家具/主题等其余交付内容照常下发（局部降级）。
    assert.ok(Array.isArray(res.body.house.rooms) && res.body.house.rooms.length > 0, '闭合失败不应拖垮其余交付内容');
    assert.ok(Object.keys(res.body.house.furnishingsAll ?? {}).length > 0, '闭合失败不应拖垮宿主表下发');
  });

  it('断言消费的正是下发给前端的那份 furnishingsAll：宿主不在下发表里 ⇔ 必须出现在诊断里（不存在第二张表）', async () => {
    const res = await request(brokenApp).get('/api/project');
    assert.equal(res.status, 200);
    const body = res.body as ProjectApiResponse;
    const deliveredHostIds = new Set(
      Object.values(body.house.furnishingsAll ?? {}).flat().map((item) => item.id).filter(Boolean) as string[],
    );
    assert.ok(!deliveredHostIds.has('ld.ghost_cabinet'), 'ghost 宿主不应出现在下发宿主表（构造该形态的前提）');
    const deliveredPoints = [...body.house.electrical, ...body.house.plumbing];
    const undiagnosed = deliveredPoints.filter((p) => {
      if (!p.mount) return false;
      const hostDelivered = deliveredHostIds.has(p.mount.furniture_id);
      const diagnosed = body.placementClosureDiagnostics?.violations.some((v) => v.includes(p.mount!.furniture_id)) ?? false;
      return !hostDelivered && !diagnosed;
    });
    assert.deepEqual(undiagnosed.map((p) => p.id), [],
      '存在「宿主不在下发 furnishingsAll、诊断也不点名」的点位：闭合性检查消费的不是下发的那份宿主表（第二张表回归）');
  });

  it('健康配置：响应不带 placementClosureDiagnostics 键（缺省 = 本次交付闭合）', async () => {
    const res = await request(healthyApp).get('/api/project').expect(200);
    assert.equal(res.body.placementClosureDiagnostics, undefined, '闭合通过时不得下发诊断键（页面据此区分正常/降级）');
  });
});

describe('正式交付路径保持失败（严格输出：同样断引用，DXF 装配 errors 非空）', () => {
  it('buildProjectDxf 对断引用点位产出 errors（npm run export:dxf 与页面导出据此非零退出/抛错）', () => {
    // 与 /api/project 同一个断引用点位、同一形态的宿主表（表在、缺该宿主）：
    // 页面入口 200+诊断（宽容读取），交付入口 errors 非空（严格输出）——分工明确，互不放松。
    const result = buildProjectDxf({
      house: {
        electrical: [BROKEN_POINT],
        furnishings: {
          living_dining: [{ id: 'ld.real_table', type: 'desk', x: 1, z: 1, width: 1.2, depth: 0.6, rotation: 0 }],
        },
        sceneElements: [],
      },
      notes: ['TEST: placement closure failure must fail formal delivery'],
    });
    assert.ok(result.errors.length >= 1, 'DXF 装配对断引用点位 0 errors：严格输出被放松了');
    assert.match(result.errors[0], /closure_broken_night_light/, '交付错误必须点名点位');
    assert.match(result.errors[0], /未解析定位/, '交付错误必须是定位失败（不是 warning 降级）');
    assert.match(result.errors.join('\n'), /ld\.ghost_cabinet/, '交付错误必须点名缺失的宿主');
  });
});
