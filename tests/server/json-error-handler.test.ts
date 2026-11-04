import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { jsonErrorHandler } from '../../server/json-error-handler.js';

// issue #70：手机上传 2-5MB 照片时 body-parser 超 express.json({limit:'1mb'}
// （server/index.ts）抛 PayloadTooLargeError（err.type === 'entity.too.large'），express
// 默认错误页是 HTML，前端只剩「HTTP 413」。这里验错误出口把超限转成 413 JSON，且不吞
// 其它错误。buildApp 模式参考 tests/server/write-token.test.ts:26-33。
describe('json-error-handler（issue #70）', () => {
  function buildApp(passthrough: unknown[] = []): express.Express {
    const app = express();
    app.use(express.json({limit: '1kb'}));
    app.post('/api/echo', (_req, res) => { res.json({ok: true}); });
    app.get('/api/boom', () => { throw new Error('boom'); });
    app.use(jsonErrorHandler);
    // 终端错误层：证明普通 Error 穿透 413 分支（原样 next，不被吞成 413）
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      passthrough.push(err);
      res.status(500).json({passthrough: err instanceof Error ? err.message : String(err)});
    });
    return app;
  }

  it('body-parser 超限（entity.too.large）→ 413 且响应是 JSON', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({blob: 'x'.repeat(4096)}));
    assert.equal(res.status, 413);
    assert.ok(res.body, '响应应被解析成 JSON');
    assert.equal(res.body.error, 'payload too large');
    assert.match(String(res.body.detail), /重拍或换角度/);
  });

  it('普通 Error 穿透到下一层，不被 413 分支吞掉', async () => {
    const passthrough: unknown[] = [];
    const app = buildApp(passthrough);
    const res = await request(app).get('/api/boom');
    assert.equal(res.status, 500);
    assert.equal(res.body.passthrough, 'boom');
    assert.equal(passthrough.length, 1);
    assert.ok(passthrough[0] instanceof Error);
  });

  it('正常请求不受错误出口影响', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/echo').send({a: 1});
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {ok: true});
  });
});
