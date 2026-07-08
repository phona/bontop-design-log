import { randomUUID } from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

function normalizeSessionId(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return value[0];
  return undefined;
}

export async function attachMcpTransports(app: Express, createMcpServer: () => McpServer): Promise<void> {
  const sessions = new Map<string, McpSession>();

  app.post('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      const newSessionId = randomUUID();
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      });

      transport.onclose = () => {
        sessions.delete(newSessionId);
      };

      await server.connect(transport);
      sessions.set(newSessionId, { server, transport });
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] POST /mcp error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'invalid or missing session id' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
    } catch (err) {
      console.error('[mcp] GET /mcp error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/mcp', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = normalizeSessionId(req.headers['mcp-session-id']);
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'invalid or missing session id' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
    } catch (err) {
      console.error('[mcp] DELETE /mcp error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/sse', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sseServer = createMcpServer();
      const sseTransport = new SSEServerTransport('/messages', res);
      await sseServer.connect(sseTransport);
      await sseTransport.start();
    } catch (err) {
      console.error('[mcp] GET /sse error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/messages', async (_req: Request, res: Response) => {
    res.status(503).json({ error: 'SSE session routing not implemented in Spec 1' });
  });
}
