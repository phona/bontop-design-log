import express from 'express';
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createMcpServer } from '../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function main() {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, './tmp/test-data-debug2');
  const mcp = createMcpServer(catalog, state);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const app = express();
  app.use(express.json());

  const handleMcp = async (req: express.Request, res: express.Response) => {
    try {
      console.log('---');
      console.log('MCP request:', req.method, req.headers['content-type'], req.headers['accept'], JSON.stringify(req.body));
      await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
      console.log('MCP response sent, status:', res.statusCode, 'headersSent:', res.headersSent);
    } catch (err) {
      console.error('MCP handler error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      }
    }
  };
  app.post('/mcp', handleMcp);
  app.get('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);

  const server = app.listen(13002, () => {
    console.log('Listening on 13002');
  });

  await new Promise(r => setTimeout(r, 500));

  // Step 1: initialize
  const resp1 = await fetch('http://localhost:13002/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
      id: 1
    }),
  });
  console.log('Init response status:', resp1.status);
  const text1 = await resp1.text();
  console.log('Init response body:', text1);

  // Step 2: notifications/initialized (no id, no response expected)
  console.log('\n--- Sending notification ---');
  const resp2 = await fetch('http://localhost:13002/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  console.log('Notification response status:', resp2.status);
  const text2 = await resp2.text();
  console.log('Notification response body:', text2);

  server.close();
  process.exit(0);
}
main();
