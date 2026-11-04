// 只读断言（2026-11-04 页面只读化）：模型配置路由仅允许 GET；mutation 请求必须 404
// 且配置文件零改动（AGENTS.md「页面只读铁律」——模型配置唯一写手是 AI 会话）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { before, after, describe, it } from 'node:test';

describe('electrical routes are read-only', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'electrical.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'electrical-readonly-test-'));
    writeFileSync(yamlPath(), '- { id: e1, room: living_dining, type: socket, x: 1, z: 1 }', 'utf8');
    app = express();
    app.use(express.json());
    app.use('/api/electrical', createElectricalRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET serves the config', async () => {
    const res = await request(app).get('/api/electrical');
    assert.equal(res.status, 200);
  });

  for (const verb of ['put', 'post', 'delete'] as const) {
    it(`${verb.toUpperCase()} is not available (read-only)`, async () => {
      const before = readFileSync(yamlPath(), 'utf8');
      const req = request(app)[verb]('/api/electrical/anywhere');
      if (verb !== 'delete') req.send({ x: 1, z: 2 });
      const res = await req;
      assert.equal(res.status, 404);
      assert.equal(readFileSync(yamlPath(), 'utf8'), before, 'config file must be untouched');
    });
  }
});

import { createElectricalRouter } from '../../server/routes-electrical.js';
