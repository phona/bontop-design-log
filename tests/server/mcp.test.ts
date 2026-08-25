import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { PitfallEngine } from '../../server/pitfall-engine.js';
import { LifecycleEngine } from '../../server/lifecycle-engine.js';
import { TradeoffEngine } from '../../server/tradeoff-engine.js';
import { AcceptanceEngine } from '../../server/acceptance-engine.js';
import { BudgetAdvisor } from '../../server/budget-advisor.js';
import { BudgetValueAnalyzer } from '../../server/budget-value-analyzer.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { createMcpServer } from '../../server/mcp-server.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { parseEnvironment } from '../../shared/environment-schema.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PresentationStateStore } from '../../server/presentation-state.js';
import { parseOverlay } from '../../server/overlay-merge.js';

const TEST_DATA_DIR = './tmp/test-data-mcp';

describe('MCP remote', () => {
  let server: ReturnType<typeof express.application.listen>;
  let client: Client;

  before(async () => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DATA_DIR, { recursive: true });

    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const engine = RuleEngine.load();
    const calc = new BudgetCalculator(catalog, engine.getConfig());
    const archiveStore = new ArchivedSchemesStore(TEST_DATA_DIR);
    const pitfallEngine = new PitfallEngine(
      load(readFileSync('config/budget-pitfalls.yaml', 'utf8')) as never
    );
    const lifecycleEngine = new LifecycleEngine();
    const tradeoffEngine = new TradeoffEngine();
    const acceptanceEngine = new AcceptanceEngine();
    const budgetAdvisor = new BudgetAdvisor(catalog, calc, engine);
    const budgetValueAnalyzer = new BudgetValueAnalyzer(catalog, calc, engine.getConfig());
    const overlay = parseOverlay(`
version: 1
elements:
  - { id: living, type: curtain, points: [{x: 0, z: 0}, {x: 2, z: 0}], room: living_dining, kind: sheer_blackout }
  - { id: bath, type: curtain, points: [{x: 0, z: 1}, {x: 2, z: 1}], room: master_bath, kind: blinds }
`);
    const presentationState = new PresentationStateStore(TEST_DATA_DIR, () => overlay);
    const deps = {
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      getPitfallEngine: () => pitfallEngine,
      getLifecycleEngine: () => lifecycleEngine,
      getTradeoffEngine: () => tradeoffEngine,
      getAcceptanceEngine: () => acceptanceEngine,
      getBudgetAdvisor: () => budgetAdvisor,
      getBudgetValueAnalyzer: () => budgetValueAnalyzer,
      archiveStore,
      presentationState,
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => overlay,
      getEnvironment: () => parseEnvironment(readFileSync('config/environment.yaml', 'utf8')),
    };

    const mcp = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await mcp.connect(transport);

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(deps));

    const handleMcp = async (req: express.Request, res: express.Response) => {
      await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
    };
    app.post('/mcp', handleMcp);
    app.get('/mcp', handleMcp);
    app.delete('/mcp', handleMcp);

    await new Promise<void>((resolve) => {
      server = app.listen(13000, resolve);
    });

    client = new Client({ name: 'test', version: '0.1.0' });
    const clientTransport = new StreamableHTTPClientTransport(new URL('http://localhost:13000/mcp'));
    await client.connect(clientTransport);
  });

  after(async () => {
    await client.close();
    server.close();
  });

  it('lists tools and calls set_selection', async () => {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === 'set_selection'));

    const result = await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'hvac', optionId: 'A2', reason: 'test' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.updated, true);
  });

  it('sets and gets persisted curtain states', async () => {
    const set = await client.callTool({
      name: 'set_curtain_state',
      arguments: { roomId: 'master_bath', state: 'blackout' },
    });
    const setParsed = JSON.parse((set.content as { text: string }[])[0].text);
    assert.equal(setParsed.state.roomOverrides.master_bath, 'privacy');
    assert.ok(setParsed.commandId);

    const get = await client.callTool({ name: 'get_curtain_states', arguments: {} });
    const getParsed = JSON.parse((get.content as { text: string }[])[0].text);
    assert.equal(getParsed.effectiveStates.master_bath, 'privacy');
  });

  it('get_data_confidence returns data maturity', async () => {
    const result = await client.callTool({ name: 'get_data_confidence', arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.geometry, 'inferred');
    assert.equal(parsed.surveyCompleted, false);
    assert.ok(parsed.materials.total > 0);
    assert.ok(parsed.overallMaturity);
  });

  it('list_options returns error for invalid topic', async () => {
    const result = await client.callTool({
      name: 'list_options',
      arguments: { topic: 'nonexistent_topic' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.error, 'topic not found');
  });

  it('get_option_details returns error for invalid optionId', async () => {
    const result = await client.callTool({
      name: 'get_option_details',
      arguments: { topic: 'hvac', optionId: 'ZZZZZ' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.error, 'option not found');
  });

  it('set_selection returns error for invalid topic', async () => {
    const result = await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'nonexistent_topic', optionId: 'A1' },
    });
    assert.ok(result.isError);
  });

  it('set_selection returns error for invalid optionId', async () => {
    const result = await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'hvac', optionId: 'ZZZZZ' },
    });
    assert.ok(result.isError);
  });

  it('set_selection returns budgetImpact with deltas', async () => {
    const result = await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'hvac', optionId: 'A1', reason: 'budget impact test' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.updated, true);
    assert.ok(parsed.budgetImpact, 'budgetImpact must be present');
    assert.equal(typeof parsed.budgetImpact.totalDelta, 'number');
    assert.equal(typeof parsed.budgetImpact.totalActual, 'number');
    assert.ok(Array.isArray(parsed.budgetImpact.categoryDeltas));
    assert.ok(Array.isArray(parsed.budgetImpact.overCategories));
    assert.ok(Array.isArray(parsed.budgetImpact.risks));
  });

  it('batch_set_selections returns budgetImpact', async () => {
    const result = await client.callTool({
      name: 'batch_set_selections',
      arguments: {
        selections: [{ topic: 'hvac', optionId: 'A2' }],
        reason: 'batch impact test',
      },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.updated, true);
    assert.ok(parsed.budgetImpact);
    assert.equal(typeof parsed.budgetImpact.totalDelta, 'number');
  });

  it('batch_set_selections works for valid selections', async () => {
    const result = await client.callTool({
      name: 'batch_set_selections',
      arguments: {
        selections: [
          { topic: 'hvac', optionId: 'A1', reason: 'batch test' },
        ],
        reason: 'batch test',
      },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.updated !== undefined);
    assert.ok(Array.isArray(parsed.entries));
  });

  it('batch_set_selections returns error for invalid topic', async () => {
    const result = await client.callTool({
      name: 'batch_set_selections',
      arguments: {
        selections: [
          { topic: 'nonexistent_topic', optionId: 'A1' },
        ],
      },
    });
    assert.ok(result.isError);
  });

  it('what_if simulates changes without persisting', async () => {
    const before = await client.callTool({ name: 'get_current_scheme', arguments: {} });
    const beforeScheme = JSON.parse((before.content as { text: string }[])[0].text);
    const beforeHvac = beforeScheme.selections.hvac.default;

    const result = await client.callTool({
      name: 'what_if',
      arguments: { changes: [{ topic: 'hvac', optionId: 'B1' }] },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.current);
    assert.ok(parsed.simulated);
    assert.ok(parsed.simulated.budget);
    assert.ok(parsed.delta);
    assert.equal(typeof parsed.delta.totalDelta, 'number');
    assert.ok(Array.isArray(parsed.delta.risksAdded));

    const after = await client.callTool({ name: 'get_current_scheme', arguments: {} });
    const afterScheme = JSON.parse((after.content as { text: string }[])[0].text);
    assert.equal(afterScheme.selections.hvac.default, beforeHvac, 'what_if must not persist');
  });

  it('what_if supports room override simulation', async () => {
    const result = await client.callTool({
      name: 'what_if',
      arguments: {
        changes: [{ topic: 'floor', optionId: 'floor_tile_02', roomId: 'master_bedroom' }],
      },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.simulated.budget);
    const floorItems = parsed.simulated.budget.lineItems.filter(
      (li: { topic: string; roomId: string | null }) => li.topic === 'floor' && li.roomId === 'master_bedroom'
    );
    assert.ok(floorItems.length > 0, 'simulated budget must contain master_bedroom floor line item');
  });

  it('what_if rejects invalid optionId', async () => {
    const result = await client.callTool({
      name: 'what_if',
      arguments: { changes: [{ topic: 'hvac', optionId: 'ZZZZZ' }] },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, 'what_if must return error for invalid optionId');
  });

  it('what_if rejects invalid topic', async () => {
    const result = await client.callTool({
      name: 'what_if',
      arguments: { changes: [{ topic: 'nonexistent', optionId: 'A1' }] },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, 'what_if must return error for invalid topic');
  });

  it('what_if rejects invalid roomId', async () => {
    const result = await client.callTool({
      name: 'what_if',
      arguments: { changes: [{ topic: 'floor', optionId: 'floor_tile_01', roomId: 'nonexistent_room' }] },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.error, 'what_if must return error for invalid roomId');
  });

  it('compare_schemes priceDelta reflects total-cost delta', async () => {
    // Ensure current scheme has a known floor selection
    await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'floor', optionId: 'floor_tile_02', reason: 'setup compare' },
    });
    const arch = await client.callTool({
      name: 'archive_scheme',
      arguments: { name: 'compare-test', reason: 'test' },
    });
    const archived = JSON.parse((arch.content as { text: string }[])[0].text);

    // Switch to a different floor option
    await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'floor', optionId: 'floor_tile_01', reason: 'compare target' },
    });

    const cmp = await client.callTool({
      name: 'compare_schemes',
      arguments: { archiveId: archived.id },
    });
    const parsed = JSON.parse((cmp.content as { text: string }[])[0].text);
    const floorDiff = parsed.diff.selections.find((s: { topic: string }) => s.topic === 'floor');
    assert.ok(floorDiff, 'floor must appear in selection diffs');
    // priceDelta must equal the line-item cost difference, not the unit-price difference
    const curCost = parsed.current.budget.lineItems
      .filter((li: { topic: string }) => li.topic === 'floor')
      .reduce((sum: number, li: { cost: number }) => sum + li.cost, 0);
    const cmpCost = parsed.compare.budget.lineItems
      .filter((li: { topic: string }) => li.topic === 'floor')
      .reduce((sum: number, li: { cost: number }) => sum + li.cost, 0);
    assert.equal(floorDiff.priceDelta, cmpCost - curCost);
  });

  it('get_pitfalls returns pitfalls filtered by category', async () => {
    const result = await client.callTool({
      name: 'get_pitfalls',
      arguments: { category: 'waterproof' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length >= 3);
    assert.ok(parsed.every((p: { category: string }) => p.category === 'waterproof'));
  });

  it('get_pitfalls returns acceptance checklists', async () => {
    const result = await client.callTool({
      name: 'get_pitfalls',
      arguments: { type: 'acceptance' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.length >= 5);
    assert.ok(parsed.every((p: { checklist?: string[] }) => Array.isArray(p.checklist)));
  });

  it('recommend_allocation returns pragmatic template', async () => {
    const result = await client.callTool({
      name: 'recommend_allocation',
      arguments: { tier: 'pragmatic' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.id, 'pragmatic');
    assert.equal(parsed.total, 110000);
    assert.ok(parsed.allocation.masonry);
  });

  it('get_room_layout returns master_bedroom detail', async () => {
    const result = await client.callTool({
      name: 'get_room_layout',
      arguments: { roomId: 'master_bedroom' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.room.id, 'master_bedroom');
    assert.ok(parsed.room.width > 0);
    assert.ok(parsed.walls.length > 0);
    assert.equal(parsed.furnishings.counts.bed_180, 1);
    const bed = parsed.furnishings.placed.find((p: { type: string }) => p.type === 'bed_180');
    assert.ok(bed, 'bed_180 must be a placed item');
    assert.equal(typeof bed.x, 'number');
    assert.ok(Array.isArray(parsed.adjacentRooms));
  });

  it('get_room_layout without roomId returns all rooms', async () => {
    const result = await client.callTool({ name: 'get_room_layout', arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length >= 10, 'expected at least 10 rooms');
  });

  it('get_room_layout returns error for unknown room', async () => {
    const result = await client.callTool({
      name: 'get_room_layout',
      arguments: { roomId: 'nonexistent' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.error, 'room not found: nonexistent');
  });

  it('get_furniture_inventory returns sofa with parsed dimensions', async () => {
    const result = await client.callTool({
      name: 'get_furniture_inventory',
      arguments: { roomId: 'living_dining' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    const items = parsed.living_dining;
    assert.ok(Array.isArray(items));
    const sofa = items.find((i: { type: string }) => i.type === 'sofa_3seat');
    assert.ok(sofa, 'sofa_3seat must be present in living_dining');
    assert.equal(sofa.count, 1);
    assert.ok(sofa.dimensions, 'sofa dimensions must be parsed');
    assert.equal(sofa.dimensions.width, 2.8);
    assert.equal(sofa.dimensions.height, 0.9);
    assert.equal(sofa.dimensions.depth, 0.75);
    assert.equal(sofa.materialId, 'sofa_3seat_01');
    assert.ok(Array.isArray(sofa.positions), 'placed sofa must expose positions');
    assert.equal(sofa.positions.length, 1);
    assert.equal(typeof sofa.positions[0].x, 'number');
    assert.equal(typeof sofa.positions[0].z, 'number');
    const chairs = items.find((i: { type: string }) => i.type === 'dining_chair');
    assert.ok(chairs);
    assert.equal(chairs.count, 4); // 2026-08-21 业主 app 内重排：横桌南北各2椅
    assert.equal(chairs.positions.length, 4, '4 placed dining chairs (餐桌横置西北角：南北各2椅)');
  });

  it('get_furniture_inventory omits dimensions for unparseable specs', async () => {
    const result = await client.callTool({
      name: 'get_furniture_inventory',
      arguments: { roomId: 'living_dining' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    const items = parsed.living_dining;
    const chair = items.find((i: { type: string }) => i.type === 'dining_chair');
    assert.ok(chair);
    assert.equal(chair.dimensions, undefined, 'dining_chair spec "标准" yields no dimensions');
  });

  it('get_procurement_status returns material stages', async () => {
    const result = await client.callTool({
      name: 'get_procurement_status',
      arguments: {},
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.materials));
    assert.ok(parsed.materials[0].id);
    assert.ok(parsed.materials[0].stage);
  });

  it('run_tradeoff returns options for a topic', async () => {
    const result = await client.callTool({
      name: 'run_tradeoff',
      arguments: { topic: 'tile_installation' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.tradeoffs.length > 0);
  });

  it('get_acceptance_list returns items for phase', async () => {
    const result = await client.callTool({
      name: 'get_acceptance_list',
      arguments: { phase: 'tile_installation' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.items.length > 0);
  });

  it('get_sunlight_analysis 返回各房间日照摘要', async () => {
    const result = await client.callTool({ name: 'get_sunlight_analysis', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.includes('living_dining'));
    assert.ok(content[0].text.includes('directHours'));
  });

  it('get_sunlight_analysis 接受 date 参数', async () => {
    const result = await client.callTool({ name: 'get_sunlight_analysis', arguments: { date: '06-22' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('06-22'));
  });

  it('get_humidity_risks 返回风险摘要与建议', async () => {
    const result = await client.callTool({ name: 'get_humidity_risks', arguments: { date: '03-15' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.includes('master_bath'));
    assert.ok(content[0].text.includes('回南天'));
  });

  it('get_humidity_risks 非法 date 返回错误文本', async () => {
    const result = await client.callTool({ name: 'get_humidity_risks', arguments: { date: '99-99' } });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('error'));
  });

});
