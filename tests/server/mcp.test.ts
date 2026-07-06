import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { DesignState } from '../../server/design-state.js';
import { createApiRouter } from '../../server/routes.js';
import { createMcpServer } from '../../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const TEST_DATA_DIR = './tmp/test-data-mcp';

describe('MCP remote', () => {
  let server: ReturnType<typeof express.application.listen>;
  let client: Client;

  before(async () => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });

    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const mcp = createMcpServer(catalog, state);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await mcp.connect(transport);

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(catalog, state));

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
});
