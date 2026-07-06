import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
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
  let app: express.Express;
  let server: ReturnType<typeof express.application.listen>;

  before(async () => {
    const catalog = ProjectCatalog.load('.');
    const state = DesignState.load(catalog, TEST_DATA_DIR);
    const mcp = createMcpServer(catalog, state);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);

    app = express();
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
  });

  it('lists tools and calls set_selection', async () => {
    const client = new Client({ name: 'test', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:13000/mcp'));
    await client.connect(transport);

    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === 'set_selection'));

    const result = await client.callTool({
      name: 'set_selection',
      arguments: { topic: 'hvac', optionId: 'A1', reason: 'test' },
    });
    const text = (result.content as { text: string }[])[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.updated, true);

    await client.close();
    server.close();
  });
});
