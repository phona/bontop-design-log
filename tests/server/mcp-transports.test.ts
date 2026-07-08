import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { attachMcpTransports } from '../../server/mcp-transports.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('attachMcpTransports', () => {
  let app: express.Express;

  before(async () => {
    app = express();
    app.use(express.json());
    await attachMcpTransports(app, () => ({ connect: async () => {}, close: async () => {} } as unknown as McpServer));
  });

  it('returns 400 for array-valued mcp-session-id header', async () => {
    const res = await request(app)
      .get('/mcp')
      .set({ 'mcp-session-id': ['a', 'b'] })
      .send();
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid or missing session id');
  });
});
