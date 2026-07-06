import express from 'express';
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createMcpServer } from '../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function main() {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, './tmp/test-data-debug3');
  const mcp = createMcpServer(catalog, state);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  
  transport.onerror = (err) => console.error('Transport onerror:', err);
  transport.onclose = () => console.log('Transport onclose');
  
  await mcp.connect(transport);

  const app = express();
  app.use(express.json());

  const handleMcp = async (req: express.Request, res: express.Response) => {
    try {
      console.log('---');
      console.log('MCP request:', req.method, JSON.stringify(req.body));
      console.log('res before handleRequest - statusCode:', res.statusCode, 'headersSent:', res.headersSent);
      await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
      console.log('res after handleRequest - statusCode:', res.statusCode, 'headersSent:', res.headersSent);
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

  const server = app.listen(13003, () => {
    console.log('Listening on 13003');
  });

  await new Promise(r => setTimeout(r, 500));

  // Step 1: initialize
  const resp1 = await fetch('http://localhost:13003/mcp', {
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
  console.log('Init response headers:', Object.fromEntries(resp1.headers.entries()));

  // Step 2: notifications/initialized
  console.log('\n--- Sending notification ---');
  const resp2 = await fetch('http://localhost:13003/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  console.log('Notification response status:', resp2.status);
  console.log('Notification response headers:', Object.fromEntries(resp2.headers.entries()));
  const text2 = await resp2.text();
  console.log('Notification response body:', text2);

  server.close();
  process.exit(0);
}
main();
