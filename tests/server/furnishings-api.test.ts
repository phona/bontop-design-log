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
    assert.deepEqual(res.body, {
      living_dining: [{ type: 'sofa_3seat', x: 11, z: 7 }],
    });
  });

  // 用原写入端点的真实路径/条目/有效载荷验证拒绝（codex PR 77 major）：
  // 若有人恢复 mutation 路由，这些请求必须不再是 404，从而测试立刻变红。
  it('PUT to the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).put('/api/furnishings/living_dining/0').send({ x: 99, z: 99, rotation: 0 });
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });

  it('DELETE on the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).delete('/api/furnishings/living_dining/0');
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });

  it('POST to the original endpoint is rejected and file untouched', async () => {
    const before = readFileSync(yamlPath(), 'utf8');
    const res = await request(app).post('/api/furnishings').send({ room: 'living_dining', type: 'sofa_3seat', x: 1, z: 1 });
    assert.equal(res.status, 404);
    assert.equal(readFileSync(yamlPath(), 'utf8'), before);
  });
});

import { createFurnishingsRouter } from '../../server/routes-furnishings.js';
