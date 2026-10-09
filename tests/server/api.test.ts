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
import { PresentationStateStore } from '../../server/presentation-state.js';

const TEST_DATA_DIR = './tmp/test-data-api';

describe('REST API', () => {
  let app: express.Express;

  before(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
    const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
  - { id: bath, type: curtain, points: [{x: 0, z: 1}, {x: 2, z: 1}], room: master_bath, kind: blinds }
`);
    const presentationState = new PresentationStateStore(TEST_DATA_DIR, () => overlay);

    app = express();
    app.use(express.json());
    app.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
        presentationState,
        getConfigRegistry: () => new ConfigRegistry(),
        getOverlay: () => overlay,
      })
    );
  });

  after(() => {
  });

  it('GET /api/project returns rooms and platform separately', async () => {
    const res = await request(app).get('/api/project').expect(200);
    assert.ok(Array.isArray(res.body.topics));
    assert.ok(Array.isArray(res.body.house.rooms));
    assert.ok(res.body.house.rooms.some((r: { id: string }) => r.id === 'master_bedroom'));
    assert.ok(!res.body.house.rooms.some((r: { id: string }) => r.id === 'elevator'));
    // Platform is now the VRV equipment platform (VRV设备平台) for 701.
    if (res.body.house.platform) {
      assert.equal(res.body.house.platform?.id, 'west_platform');
      assert.equal(res.body.house.platform?.name, 'VRV设备平台');
    }
    assert.ok(Array.isArray(res.body.house.sceneElements));
  });

  it('GET /api/project phase=phase_1 filters deferred furnishings and curtains', async () => {
    const res = await request(app).get('/api/project?phase=phase_1_basic_occupancy').expect(200);
    assert.equal(res.body.phase, 'phase_1_basic_occupancy');
    assert.equal(res.body.phaseMeta.budget.ceilingCny, 210000); // DEC-2026-10-05-R4：GC5 微蒸烤 +4,000 抬池，20.6万→21万
    assert.equal(res.body.phaseMeta.budget.authority, 'schedule/phase-1/control.yaml');
    assert.ok(res.body.house.furnishings.master_bedroom.some((i: { type: string }) => i.type === 'bed_180'));
    assert.ok(!res.body.house.furnishings.master_bedroom.some((i: { type: string }) => i.type === 'master_north_wall_wardrobe_950'));
    assert.ok(!res.body.house.furnishings.living_dining.some((i: { type: string }) => i.type === 'tv_65'));
    const phaseJ6 = res.body.house.furnishings.guest_bath.find((i: { type: string }) => i.type === 'robot_dock_gbath');
    assert.ok(phaseJ6, 'J6 remains visible in the一期 scene payload');
    assert.equal(phaseJ6.sourceIndex, 8, 'phase filtering exposes the authored house.yaml source index');
    assert.deepEqual(
      res.body.house.furnishings.bedroom_nw.filter((i: { type: string }) => i.type === 'mattress_150'),
      [],
    );
    assert.ok(res.body.house.furnishings.bedroom_nw.some((i: { type: string }) => i.type === 'curtain_set'));
    assert.ok(res.body.house.furnishings.bedroom_nw.some((i: { type: string }) => i.type === 'ceiling_light'));
    assert.deepEqual(
      res.body.house.furnishings.bedroom_se.filter((i: { type: string }) => i.type === 'curtain_set'),
      [],
    );
    assert.deepEqual(
      res.body.house.furnishings.living_dining.filter((i: { type: string }) => i.type === 'curtain_set'),
      [],
    );
    assert.ok(res.body.house.sceneElements.some((i: { id: string }) => i.id === 'bath'));
    assert.ok(!res.body.house.sceneElements.some((i: { id: string }) => i.id === 'living'));
  });

  it('GET /api/project rejects unknown phase', async () => {
    const res = await request(app).get('/api/project?phase=phase_9').expect(400);
    assert.match(res.body.error, /unsupported phase/);
  });

  // 吊顶主材参考成本区间（DEC-2026-10-08-C09）：只读、无 POST，三态判定 + owner_provided 告警。
  it('GET /api/ceiling/material-cost returns range verdict without market judgement', async () => {
    const res = await request(app).get('/api/ceiling/material-cost').expect(200);
    assert.equal(res.body.areaBasis, 'gypsum_board');
    // C11：欧松板 27～29（verified）+ C7 同级旁证 26～30 + 龙骨按「米价 × 用量」折算 36～45
    assert.equal(res.body.materialPerSqm.min, 98);
    assert.equal(res.body.materialPerSqm.max, 120);
    // C12 起按施工方分形态口径（边吊 160/米 + 平顶 155/㎡）算额度 → 122.66 元/㎡
    // （DEC-2026-10-08-R05 镜像凹弧后 gypsum 基数 23.231㎡，钉盘随基数走；判定不变）
    assert.equal(res.body.contractor.basis, 'forms');
    assert.equal(res.body.contractor.allowancePerSqm, 122.66);
    assert.equal(res.body.contractor.formBreakdown.length, 2);
    assert.equal(res.body.verdict, 'above_range');
    assert.equal(res.body.slackVsMaxYuanPerSqm, 2.66);
    assert.deepEqual(res.body.ownerOnlyPerSqm, { min: 70, max: 115 });
    assert.ok(res.body.warnings.some((note: string) => note.includes('高于参考上限') || note.includes('低于参考下限')));
    assert.ok(res.body.warnings.some((note: string) => note.includes('两个口径') || note.includes('业主转述')));
    assert.ok(res.body.warnings.some((note: string) => note.includes('未经施工图确认')));
    assert.ok(res.body.warnings.some((note: string) => note.includes('全部分区周长上界')));
    assert.ok(res.body.warnings.some((note: string) => note.includes('不含施工方利润')));
    // 证据分级显形：只有欧松板是 verified，龙骨与 C7 都是 comparable（旁证）
    assert.deepEqual(res.body.evidenceMix.verified, ['千年舟 9mm 欧松板（OSB）']);
    assert.equal(res.body.evidenceMix.comparable.length, 2);
    // 张价按各观察自己的规格折算；工程 3000×1200 的 47.7/53.3 只登记不折算
    const osb = res.body.items.find((item: { id: string }) => item.id === 'osb_9mm_qiannianzhou_enf');
    assert.equal(osb.basisUsed, 'verified');
    assert.equal(osb.perSqm.min, 27);
    assert.ok(osb.derivation.includes('2.9768'));
    const gypsum = res.body.items.find((item: { id: string }) => item.id === 'gypsum_board_c7_knauf');
    assert.equal(gypsum.basisUsed, 'comparable');
    assert.equal(gypsum.offSpecEvidence.length, 2);
    assert.equal(gypsum.offSpecEvidence[0].sheet_size_m2, 3.6);
    // 龙骨：逐构件折算 + 边龙骨用量由 takeoff 周长实算（3.08 米每平米，是大平顶经验值 0.4 的 7.7 倍；R05 后基数）
    const frame = res.body.items.find((item: { id: string }) => item.id === 'lanzhen50_frame');
    assert.equal(frame.basis, 'per_metre_derived');
    assert.equal(frame.derivedComponents.length, 3);
    const edge = frame.derivedComponents.find((c: { component: string }) => c.component === '边龙骨');
    assert.deepEqual(edge.metresPerSqm, [3.08, 3.08]);
    assert.equal(edge.usageStatus, 'model_derived_upper_bound');
    assert.equal(frame.perSqm.min, 36);
    assert.equal(frame.perSqm.max, 45);
    // 上人型主龙骨 20.81 元/米只登记不折算
    assert.ok(frame.offSpecEvidence.some((obs: { rate?: number }) => obs.rate === 20.81));
  });

  // C12：施工方其实按「边吊 160 元/米 + 平顶 155 元/㎡」两队计，代码现在能分开算
  it('GET /api/ceiling/quotes 分形态计价：边吊按米、平顶按㎡，总额不再被口径卡住', async () => {
    const res = await request(app).get('/api/ceiling/quotes').expect(200);
    // 量：边吊长边 21.475m（按米计价）、满吊平顶 7.39㎡（按㎡计价），
    // 覆盖不变量用**面积**验：边吊面积 + 平顶面积 = 石膏板净面积（两种单位不许相加）
    assert.ok(Math.abs(res.body.quantities.gypsum_edge_drop_linear - 21.475) < 1e-9);
    assert.ok(Math.abs(res.body.quantities.gypsum_flat_sqm - 7.39) < 1e-9);
    assert.ok(Math.abs(res.body.takeoff.edgeDropNetAreaM2 + res.body.takeoff.flatNetAreaM2 - res.body.takeoff.gypsumNetAreaM2) < 1e-9);
    assert.deepEqual(res.body.takeoff.unclassifiedPricingFormIds, []);
    const card = res.body.comparison.find((entry: { id: string }) => entry.id === 'owner_turnkey_20261008')!;
    // 21.475×160 + 7.39×155 + 17.85×105
    assert.ok(Math.abs(card.total - (21.475 * 160 + 7.39 * 155 + 17.85 * 105)) < 1e-6);
    assert.ok(Math.abs(card.total - 6455.7) < 1e-6);
    assert.deepEqual(card.pendingRows, []);
    // 混合口径的板面行（含厨卫铝扣板）这家不报：超出范围，不算待报价
    assert.deepEqual(card.outOfScopeRows, ['ceiling_zones', 'aluminum_buckle_sqm']);
    assert.ok(card.comparability_notes.some((note: string) => note.includes('不在本家报价范围')));
    assert.ok(card.coveredScope.includes('石膏板边吊（延长米）'));
    const row = card.rows.find((r: { key: string }) => r.key === 'ceiling_zones');
    assert.equal(row.out_of_scope, true);
    assert.equal(row.subtotal, null);
    // 生效卡仍是基线口径，预算不被候选卡改写
    assert.equal(res.body.activeId, 'baseline_self_computed');
  });

  it('PATCH /api/scheme/current changes selection', async () => {
    const res = await request(app)
      .patch('/api/scheme/current')
      .send({ selections: [{ topic: 'hvac', optionId: 'A1' }], source: 'user' })
      .expect(200);
    assert.equal(res.body.scheme.selections.hvac.default, 'A1');
  });

  it('GET/PATCH presentation state persists room and whole-house curtain states', async () => {
    const initial = await request(app).get('/api/presentation-state').expect(200);
    assert.equal(initial.body.default, 'open');

    const room = await request(app)
      .patch('/api/presentation-state/curtains')
      .send({ roomId: 'master_bath', state: 'blackout', expectedUpdatedAt: initial.body.updatedAt })
      .expect(200);
    assert.equal(room.body.state.roomOverrides.master_bath, 'privacy');

    const all = await request(app)
      .patch('/api/presentation-state/curtains')
      .send({ state: 'blackout', expectedUpdatedAt: room.body.state.updatedAt })
      .expect(200);
    assert.equal(all.body.state.default, 'blackout');
    assert.deepEqual(all.body.state.roomOverrides, {});
  });

  it('rejects invalid curtain room/state and reports conflicts', async () => {
    await request(app).patch('/api/presentation-state/curtains').send({ roomId: 'kitchen', state: 'open' }).expect(400);
    await request(app).patch('/api/presentation-state/curtains').send({ state: 'invalid' }).expect(400);
    await request(app).patch('/api/presentation-state/curtains').send({ state: 'open', expectedUpdatedAt: 'stale' }).expect(409);
  });

  it('POST set_curtain_state persists before appending the command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_curtain_state', payload: { roomId: 'living_dining', state: 'privacy' } })
      .expect(201);
    assert.equal(res.body.type, 'set_curtain_state');
    assert.equal(res.body.presentationState.roomOverrides.living_dining, 'privacy');
  });

  it('POST /api/decisions records a decision', async () => {
    const res = await request(app)
      .post('/api/decisions')
      .send({ topic: 'hvac', optionId: 'A1', reason: 'test' })
      .expect(201);
    assert.equal(res.body.topic, 'hvac');
  });

  it('GET /api/project returns sceneElements merged from walls and overlay', async () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = new RuleEngine({ version: '1.0', risks: [], constraints: [] });
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
    const overlay = parseOverlay(`version: 1
elements:
  - id: "curtain:1"
    type: curtain_run
    points:
      - {x: 0, z: 0}
      - {x: 5, z: 0}
`);
    const localApp = express();
    localApp.use(express.json());
    localApp.use(
      '/api',
      createApiRouter({
        catalog,
        state,
        getRuleEngine: () => engine,
        getBudgetCalculator: () => calc,
        archiveStore,
        getConfigRegistry: () => new ConfigRegistry(),
        getOverlay: () => overlay,
      })
    );
    const res = await request(localApp).get('/api/project').expect(200);
    const els = res.body.house.sceneElements;
    assert.ok(Array.isArray(els));
    assert.ok(els.every((e: { type: string }) => typeof e.type === 'string'));
    assert.ok(els.some((e: { id: string }) => e.id === 'curtain:1'));
    assert.equal(res.body.house.walls, undefined);
  });

  it('POST /api/visual-commands creates a command', async () => {
    const res = await request(app)
      .post('/api/visual-commands')
      .send({ type: 'set_camera_target', payload: { targetId: 'room:master_bedroom' } })
      .expect(201);
    assert.equal(res.body.type, 'set_camera_target');
  });
});
