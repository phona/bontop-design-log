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
});
