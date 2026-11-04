import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWriteToken, createWriteTokenGuard } from '../../server/write-token.js';

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

describe('write-token guard（issue #64）', () => {
  const TOKEN = 'test-write-token-0123456789abcdef';
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.BONTOP_WRITE_TOKEN;
    delete process.env.BONTOP_WRITE_TOKEN;
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.BONTOP_WRITE_TOKEN;
    else process.env.BONTOP_WRITE_TOKEN = savedEnv;
  });

  function buildApp(): express.Express {
    const guard = createWriteTokenGuard(TOKEN);
    const app = express();
    app.use(guard);
    app.use(express.json());
    app.all('/api/write', (_req, res) => { res.json({ ok: true }); });
    return app;
  }

  it('无 token 的写请求 → 401，且 detail 指向服务端日志 / .bontop-write-token', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/write').send({ any: 'body' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'write token required');
    assert.match(res.body.detail, /\.bontop-write-token/);
  });

  it('错 token 的写请求 → 401', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/write')
      .set('x-bontop-token', 'wrong-token')
      .send({ any: 'body' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'write token required');
  });

  it('对 token 放行（POST/PUT/PATCH/DELETE 全方法）', async () => {
    const app = buildApp();
    // supertest 的删除动词是 .del（不是 .delete）
    const send: Record<string, (url: string) => request.Test> = {
      POST: (url) => request(app).post(url),
      PUT: (url) => request(app).put(url),
      PATCH: (url) => request(app).patch(url),
      DELETE: (url) => request(app).del(url),
    };
    for (const method of WRITE_METHODS) {
      const res = await send[method]('/api/write').set('x-bontop-token', TOKEN);
      assert.equal(res.status, 200, `${method} should pass with the correct token`);
      assert.deepEqual(res.body, { ok: true });
    }
  });

  it('GET 等方法不校验 token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/write');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  it('守卫挂在 json 解析之前：无 token 的坏 body 也是 401 而不是 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/write')
      .set('Content-Type', 'application/json')
      .send('not-json-at-all');
    assert.equal(res.status, 401);
  });

  it('resolveWriteToken：BONTOP_WRITE_TOKEN 优先于文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bontop-write-token-'));
    try {
      writeFileSync(join(dir, '.bontop-write-token'), 'file-token\n');
      process.env.BONTOP_WRITE_TOKEN = 'env-token';
      const resolved = resolveWriteToken(dir);
      assert.equal(resolved.token, 'env-token');
      assert.equal(resolved.source, 'env');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveWriteToken：无环境变量时读文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bontop-write-token-'));
    try {
      writeFileSync(join(dir, '.bontop-write-token'), 'file-token\n');
      const resolved = resolveWriteToken(dir);
      assert.equal(resolved.token, 'file-token');
      assert.equal(resolved.source, 'file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveWriteToken：文件不存在则生成并以 600 落盘，二次加载复用同一值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bontop-write-token-'));
    try {
      const filePath = join(dir, '.bontop-write-token');
      assert.equal(existsSync(filePath), false);

      const first = resolveWriteToken(dir);
      assert.equal(first.source, 'generated');
      assert.match(first.token, /^[0-9a-f]{48}$/);
      assert.equal(existsSync(filePath), true);
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
      assert.equal(readFileSync(filePath, 'utf8').trim(), first.token);

      const second = resolveWriteToken(dir);
      assert.equal(second.source, 'file');
      assert.equal(second.token, first.token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
