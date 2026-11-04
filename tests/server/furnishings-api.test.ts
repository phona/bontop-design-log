// 只读断言（2026-11-04 页面只读化）：模型配置路由仅允许 GET；mutation 请求必须 404
// 且配置文件零改动（AGENTS.md「页面只读铁律」——模型配置唯一写手是 AI 会话）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { before, after, describe, it } from 'node:test';

describe('furnishings routes are read-only', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'furnishings.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'furnishings-readonly-test-'));
    writeFileSync(yamlPath(), '{ furnishings: { living_dining: [{ type: \'sofa_3seat\', x: 11, z: 7 }] } }', 'utf8');
    app = express();
    app.use(express.json());
    app.use('/api/furnishings', createFurnishingsRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET serves the config', async () => {
    const res = await request(app).get('/api/furnishings');
    assert.equal(res.status, 200);
  });

  for (const verb of ['put', 'post', 'delete'] as const) {
    it(`${verb.toUpperCase()} is not available (read-only)`, async () => {
      const before = readFileSync(yamlPath(), 'utf8');
      const req = request(app)[verb]('/api/furnishings/anywhere');
      if (verb !== 'delete') req.send({ x: 1, z: 2 });
      const res = await req;
      assert.equal(res.status, 404);
      assert.equal(readFileSync(yamlPath(), 'utf8'), before, 'config file must be untouched');
    });
  }
});

import { createFurnishingsRouter } from '../../server/routes-furnishings.js';
