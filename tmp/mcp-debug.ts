import express from 'express';
import { ProjectCatalog } from '../server/project-catalog.js';
import { DesignState } from '../server/design-state.js';
import { createMcpServer } from '../server/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function main() {
  const catalog = ProjectCatalog.load('.');
  const state = DesignState.load(catalog, './tmp/test-data-debug');
  const mcp = createMcpServer(catalog, state);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  const app = express();
  app.use(express.json());

  const handleMcp = async (req: express.Request, res: express.Response) => {
    try {
      console.log('MCP request:', req.method, req.headers['content-type'], JSON.stringify(req.body));
      await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
      console.log('MCP response sent, status:', res.statusCode);
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

  const server = app.listen(13001, () => {
    console.log('Listening on 13001');
  });

  await new Promise(r => setTimeout(r, 500));

  try {
    const resp = await fetch('http://localhost:13001/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0.1.0' } },
        id: 1
      }),
    });
    console.log('Response status:', resp.status);
    console.log('Response headers:', Object.fromEntries(resp.headers.entries()));
    const text = await resp.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
  server.close();
  process.exit(0);
}
main();
