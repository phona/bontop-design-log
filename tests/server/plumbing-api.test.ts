// 只读断言（2026-11-04 页面只读化）：模型配置路由仅允许 GET；mutation 请求必须 404
// 且配置文件零改动（AGENTS.md「页面只读铁律」——模型配置唯一写手是 AI 会话）。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { before, after, describe, it } from 'node:test';

describe('plumbing routes are read-only', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'plumbing.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plumbing-readonly-test-'));
    writeFileSync(yamlPath(), '- { id: p1, room: living_dining, type: drain, x: 1, z: 1 }', 'utf8');
    app = express();
    app.use(express.json());
    app.use('/api/plumbing', createPlumbingRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET serves the config', async () => {
    const res = await request(app).get('/api/plumbing');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ id: 'p1', room: 'living_dining', type: 'drain', x: 1, z: 1 }]);
  });

  // 用原写入端点的真实路径/条目验证拒绝（codex PR 77 major）：恢复 mutation 路由会让这些请求非 404，测试立刻变红。
  it('PUT to the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).put('/api/plumbing/p1').send({ x: 99, z: 99 });
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });

  it('DELETE on the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).delete('/api/plumbing/p1');
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });

  it('POST to the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).post('/api/plumbing').send({ id: 'probe_new', room: 'living_dining', type: 'probe', x: 1, z: 1 });
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });
});

import { createPlumbingRouter } from '../../server/routes-plumbing.js';
