import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { attachMcpTransports } from '../../server/mcp-transports.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('attachMcpTransports', () => {
  let app: express.Express;

  before(async () => {
    app = express();
    app.use(express.json());
    await attachMcpTransports(app, () => new McpServer({ name: 'test', version: '1.0.0' }));
  });

  it('returns 400 for array-valued mcp-session-id header', async () => {
    const res = await request(app)
      .get('/mcp')
      .set({ 'mcp-session-id': ['a', 'b'] })
      .send();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid or missing session id');
  });

  it('accepts array-valued mcp-session-id header with a valid session id', async () => {
    const postRes = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
    const sessionId = postRes.headers['mcp-session-id'];
    assert.ok(sessionId, 'expected session id from POST /mcp');

    const getRes = await request(app)
      .get('/mcp')
      .set({ 'mcp-session-id': [sessionId as string] })
      .send();
    assert.notEqual(getRes.status, 400);
  });

  it('returns JSON 500 when POST /mcp throws', async () => {
    const localApp = express();
    localApp.use(express.json());
    await attachMcpTransports(localApp, () =>
      ({ connect: async () => { throw new Error('connect failed'); } } as unknown as McpServer)
    );

    const res = await request(localApp)
      .post('/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });

    assert.equal(res.status, 500);
    assert.ok(typeof res.body.error === 'string');
  });

  it('does not remove session until DELETE /mcp handleRequest resolves', async () => {
    const localApp = express();
    localApp.use(express.json());

    let capturedTransport: { handleRequest: (...args: unknown[]) => Promise<void> } | undefined;
    await attachMcpTransports(localApp, () => ({
      connect: async (transport: { handleRequest: (...args: unknown[]) => Promise<void> }) => {
        capturedTransport = transport;
        const realServer = new McpServer({ name: 'test', version: '1.0.0' });
        await realServer.connect(transport as any);
      },
    } as unknown as McpServer));

    const postRes = await request(localApp)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
    const sessionId = postRes.headers['mcp-session-id'];
    assert.ok(sessionId, 'expected session id from POST /mcp');

    let resolveDelete: (() => void) | undefined;
    const deletePromise = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });

    capturedTransport!.handleRequest = async (req: any, res: any) => {
      if (req.method === 'DELETE') {
        await deletePromise;
        res.status(200).end();
      } else {
        res.status(200).end();
      }
    };

    const deleteReq = request(localApp)
      .delete('/mcp')
      .set('mcp-session-id', sessionId as string)
      .send();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const getResDuring = await request(localApp)
      .get('/mcp')
      .set('mcp-session-id', sessionId as string)
      .send();
    assert.notEqual(getResDuring.status, 400, 'session should still exist while DELETE is pending');

    resolveDelete!();
    const deleteRes = await deleteReq;
    assert.equal(deleteRes.status, 200);

    const getResAfter = await request(localApp)
      .get('/mcp')
      .set('mcp-session-id', sessionId as string)
      .send();
    assert.equal(getResAfter.status, 400, 'session should be removed after DELETE resolves');
  });
});
