/**
 * /api/project 投影构造异常隔离（issue #98，PR #122 Codex blocking 修复）。
 *
 * 病根：`server/routes.ts` 把 `deps.getProjectRenderFactsProjection()` **内联在响应对象
 * 字面量里**。投影构造链 `buildProjectRenderFactsProjection` → `buildRenderLightingFixtures`
 * 遇点位宿主断引用会 fail-closed 抛错 → 整个处理器抛 → GET /api/project 返回 **500** → 同一响应里
 * 刚加的 placementClosureDiagnostics 一个字都发不出去：页面既看不到问题，也预览不了
 * 其余交付内容。
 *
 * 口径（issue #98 原文）：「宽容读取、局部降级、统一诊断、严格输出：页面可显示问题并
 * 继续预览；正式 CAD/施工交付与相关模型验证必须因适用范围内的真实错误失败。」
 * 本文件两段各守一侧：
 *   - 页面入口（/api/project）：投影构造抛错 → **200**，投影键不下发，错误并入
 *     `placementClosureDiagnostics` 这条**既有**诊断通道（不另起第三套）；
 *   - 正式路径：同一断引用在投影构造器（shared/ 无 catch）与 DXF 装配（errors 通道，
 *     `npm run export:dxf` 与页面导出共用）两端仍必须失败——严格输出未放松。
 *
 * 除本单元测试外，PR 正文另有真实服务端取证：启动服务后在运行期删掉 house.yaml 的挂载
 * 宿主家具 → 修前 /api/project HTTP 500（Express 错误页）、修后 HTTP 200 + 诊断；
 * 同一形态下 `npm run export:dxf` 修前修后均 exit 1。
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
import { buildProjectRenderFactsProjection } from '../../shared/project-render-facts-projection.js';
import { buildProjectDxf } from '../../shared/dxf/project-dxf.js';
import type {
  PlacementClosureApiDiagnostics,
  ProjectApiResponse,
} from '../../shared/api-project.js';
import type {
  CurrentScheme,
  CurtainPresentationState,
  ElectricalPoint,
  ProjectRenderFacts,
  RenderLightingOverride,
} from '../../shared/types.js';

const TEST_DATA_DIR = './tmp/test-data-api-projection-isolate';

/** 断引用形态：mount 声明的宿主 `ld.ghost_cabinet` 不在任何宿主索引里（同真实故障形态）。 */
const BROKEN_MOUNT_POINT = {
  id: 'projection_broken_night_light',
  room: 'living_dining',
  type: 'night_light',
  height: 0.3,
  mount: { furniture_id: 'ld.ghost_cabinet', face: 'north', along: 0.5 },
} as unknown as ElectricalPoint;

/** 绝对坐标灯（无 mount）：投影构造这条路径上的「健康」输入。 */
const HEALTHY_CEILING_POINT = {
  id: 'projection_healthy_ceiling_light',
  room: 'living_dining',
  type: 'ceiling_light',
  x: 1,
  z: 1,
  height: 2.8,
} as unknown as ElectricalPoint;

function override(id: string): RenderLightingOverride {
  return {
    id,
    anchorY_offset: 0,
    basis: 'test',
    reason: 'test fixture',
    applies_to: ['web', 'blender'],
  };
}

const scheme = { updatedAt: '', selections: {} } as unknown as CurrentScheme;
const presentation: CurtainPresentationState = { default: 'open', roomOverrides: {}, updatedAt: '' };
/** 空宿主索引：`ld.ghost_cabinet` 必然解不出宿主脸 → buildRenderLightingFixtures fail-closed。 */
const emptyMountHosts = new Map() as unknown as ReadonlyMap<string, never>;

function factsFor(electrical: ElectricalPoint[]): ProjectRenderFacts {
  return { electrical, plumbing: [], ceiling: [], hvac: {} } as unknown as ProjectRenderFacts;
}

const brokenFacts = factsFor([BROKEN_MOUNT_POINT]);
const healthyFacts = factsFor([HEALTHY_CEILING_POINT]);

interface BuildAppOptions {
  /** 注入 /api/project 的 render-facts 投影产地；抛错形态即本次修复的对象。 */
  projectionFactory?: () => ReturnType<typeof buildProjectRenderFactsProjection>;
  facts?: ProjectRenderFacts;
}

/** 起一个带真实 config 的 /api 应用（同 tests/server/api-placement-closure.test.ts 的装配）。 */
function buildApp(options: BuildAppOptions = {}): express.Express {
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
    getProjectRenderFacts: () => options.facts ?? healthyFacts,
    // 投影「产地」与真实 server/index.ts 同构：调用同一个 shared 构造器，输入里带
    // 断引用的宿主引用。抛错不是桩，而是构造器自身的 fail-closed（见下方严格输出用例）。
    ...(options.projectionFactory ? { getProjectRenderFactsProjection: options.projectionFactory } : {}),
  }));
  return app;
}

describe('/api/project 投影构造异常隔离（issue #98 宽容读取：抛错 → 200 + 统一诊断）', () => {
  let brokenApp: express.Express;
  let healthyApp: express.Express;
  let noProjectionApp: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    // 断引用：投影构造器对空宿主索引解 mount 面 → 抛（与修前 500 的同一错误源）。
    brokenApp = buildApp({
      facts: brokenFacts,
      projectionFactory: () => buildProjectRenderFactsProjection(
        brokenFacts,
        [override(BROKEN_MOUNT_POINT.id)],
        scheme,
        { elements: [] },
        presentation,
        undefined,
        emptyMountHosts,
      ),
    });
    healthyApp = buildApp({
      facts: healthyFacts,
      projectionFactory: () => buildProjectRenderFactsProjection(
        healthyFacts,
        [override(HEALTHY_CEILING_POINT.id)],
        scheme,
        { elements: [] },
        presentation,
      ),
    });
    noProjectionApp = buildApp({ facts: healthyFacts });
  });

  after(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('投影构造抛错时 /api/project 仍 200，投影键不下发，错误并入 placementClosureDiagnostics（病根回归守护）', async () => {
    const res = await request(brokenApp).get('/api/project');
    assert.equal(
      res.status,
      200,
      `投影构造抛错不得把整个响应打掉（修前即 500，诊断发不出去）：实际 ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );

    const diagnostics = res.body.placementClosureDiagnostics as PlacementClosureApiDiagnostics | undefined;
    assert.ok(diagnostics, '响应缺 placementClosureDiagnostics：页面无从显形「投影为何不可得」');
    // 统一诊断通道：投影失败与点位闭合违例合并成同一份 count/violations/guidance。
    assert.equal(diagnostics.count, diagnostics.violations.length, 'count 必须等于 violations.length（统一计数）');
    assert.ok(diagnostics.count >= 2, `投影失败 + 点位的宿主断引用应各有一条诊断，实际 ${diagnostics.count}`);
    assert.match(diagnostics.violations[0], /render-facts 投影构造失败/, '第一条诊断必须点名投影构造失败');
    assert.match(diagnostics.violations[0], /projection_broken_night_light/, '投影失败诊断必须点名具体点位');
    assert.match(diagnostics.violations[0], /ld\.ghost_cabinet/, '投影失败诊断必须点名缺失的宿主');
    // 机器可读形态：消费方不必解析人读文案就知道「本次没有投影」。
    assert.equal(diagnostics.projectionError?.stage, 'render-facts-projection');
    assert.match(diagnostics.projectionError?.message ?? '', /mount 定位解析失败/);
    // 统一处理方向：投影是优化不是正确性前提，正式交付仍会失败。
    assert.match(diagnostics.guidance, /不是正确性前提/, 'guidance 必须说清投影只是优化');
    assert.match(diagnostics.guidance, /正式 DXF 导出与模型验证会因同一断引用失败/, 'guidance 必须说明严格输出未放松');
    // 同一条通道里仍保留点位闭合违例（不是被投影错误顶替掉）。
    assert.ok(
      diagnostics.violations.some((message) => /电气点位 projection_broken_night_light/.test(message)),
      '点位闭合违例从诊断通道里消失了：两类条目必须共存于同一通道',
    );

    // 失败隔离到投影一个字段：其余交付内容照常下发，页面继续预览。
    const body = res.body as ProjectApiResponse;
    assert.ok(!('renderFactsProjection' in res.body), '投影构造失败时不得下发半成品/空投影键');
    assert.ok(Array.isArray(body.house.rooms) && body.house.rooms.length > 0, '其余交付内容（房间）被拖垮了');
    assert.ok(
      body.house.electrical.some((point) => point.id === BROKEN_MOUNT_POINT.id),
      '断引用点位被从清单里剔除：页面连「哪个点位有问题」都看不到',
    );
    assert.ok(body.topics.length > 0, '其余交付内容（主题）被拖垮了');
  });

  it('投影构造成功时行为不变：下发投影，且不带任何诊断键', async () => {
    const res = await request(healthyApp).get('/api/project').expect(200);
    assert.ok(res.body.renderFactsProjection, '投影构造成功却未下发 renderFactsProjection');
    assert.equal(res.body.renderFactsProjection.lightingFixtures[0].id, HEALTHY_CEILING_POINT.id);
    assert.equal(res.body.placementClosureDiagnostics, undefined, '无降级时不得下发诊断键（页面据此区分正常/降级）');
  });

  it('投影产地未配置时行为不变：不下发投影键，也不下发诊断键', async () => {
    const res = await request(noProjectionApp).get('/api/project').expect(200);
    assert.ok(!('renderFactsProjection' in res.body));
    assert.equal(res.body.placementClosureDiagnostics, undefined);
  });
});

describe('严格输出未放松（同一断引用：投影构造器与 DXF 装配仍必须失败）', () => {
  it('shared/ 投影构造器对断引用仍 fail-closed 抛错（隔离只发生在路由，不在共享层）', () => {
    assert.throws(
      () => buildProjectRenderFactsProjection(
        brokenFacts,
        [override(BROKEN_MOUNT_POINT.id)],
        scheme,
        { elements: [] },
        presentation,
        undefined,
        emptyMountHosts,
      ),
      /mount 定位解析失败|ld\.ghost_cabinet/,
      '共享投影构造器被放松成降级返回：正式路径（export-dxf / 验证脚本）也会跟着静默放行',
    );
  });

  it('DXF 装配对同一断引用仍产出 errors（npm run export:dxf / 页面导出据此非零退出）', () => {
    // 同一断引用点位、同一形态宿主表（表在、缺该宿主）：页面入口 200+诊断（宽容读取），
    // 交付入口 errors 非空（严格输出）——分工明确，互不放松。
    const result = buildProjectDxf({
      house: {
        electrical: [BROKEN_MOUNT_POINT],
        furnishings: {
          living_dining: [{ id: 'ld.real_table', type: 'desk', x: 1, z: 1, width: 1.2, depth: 0.6, rotation: 0 }],
        },
        sceneElements: [],
      },
      notes: ['TEST: projection construction failure must not relax formal delivery'],
    });
    assert.ok(result.errors.length >= 1, 'DXF 装配对断引用点位 0 errors：严格输出被放松了');
    assert.match(result.errors.join('\n'), /projection_broken_night_light/, '交付错误必须点名点位');
    assert.match(result.errors.join('\n'), /ld\.ghost_cabinet/, '交付错误必须点名缺失的宿主');
  });
});
