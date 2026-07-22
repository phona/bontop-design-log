import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, mkdirSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { RuleEngine } from '../../server/rule-engine.js';
import { BudgetCalculator } from '../../server/budget-calculator.js';
import { ArchivedSchemesStore } from '../../server/archived-schemes.js';
import { createApiRouter } from '../../server/routes.js';
import { createMcpServer } from '../../server/mcp-server.js';
import { ConfigRegistry } from '../../server/config-loader.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

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
    const deps = {
      catalog,
      state,
      getRuleEngine: () => engine,
      getBudgetCalculator: () => calc,
      archiveStore,
      getConfigRegistry: () => new ConfigRegistry(),
      getOverlay: () => undefined,
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

});
