import type { Express, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function attachMcpTransports(app: Express, createMcpServer: () => McpServer): Promise<void> {
  const statelessServer = createMcpServer();
  const streamableTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await statelessServer.connect(streamableTransport);

  app.post('/mcp', (req: Request, res: Response) => {
    void streamableTransport.handleRequest(req, res, req.body);
  });
  app.get('/mcp', (req: Request, res: Response) => {
    void streamableTransport.handleRequest(req, res);
  });

  app.get('/sse', async (req: Request, res: Response) => {
    const sseServer = createMcpServer();
    const sseTransport = new SSEServerTransport('/messages', res);
    await sseServer.connect(sseTransport);
    await sseTransport.start();
  });

  app.post('/messages', async (_req: Request, res: Response) => {
    res.status(503).json({ error: 'SSE session routing not implemented in Spec 1' });
  });
}
