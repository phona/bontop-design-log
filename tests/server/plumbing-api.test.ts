import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createPlumbingRouter } from '../../server/routes-plumbing.js';

describe('Plumbing API', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'plumbing.yaml');

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'plumbing-test-'));
    writeFileSync(yamlPath(), `- id: faucet_kitchen
  room: kitchen
  type: faucet
  x: 7.2
  z: 3.0
  height: 0.8
  note: "厨房洗菜盆"
- id: toilet_mbath
  room: master_bath
  type: toilet
  x: 2.6
  z: 1.5
`, 'utf8');

    app = express();
    app.use(express.json());
    app.use('/api/plumbing', createPlumbingRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET lists all plumbing points', async () => {
    const res = await request(app).get('/api/plumbing');
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body), true);
    assert.equal(res.body.length, 2);
  });

  it('PUT updates position', async () => {
    const res = await request(app)
      .put('/api/plumbing/faucet_kitchen')
      .send({ x: 7.5, z: 3.2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.x, 7.5);
    assert.equal(res.body.item.z, 3.2);
  });

  it('POST adds new point', async () => {
    const res = await request(app)
      .post('/api/plumbing')
      .send({ id: 'shower_gbath', room: 'guest_bath', type: 'shower', x: 5.6, z: 3.0, height: 1.0 });
    assert.equal(res.status, 201);
    assert.equal(res.body.item.type, 'shower');
  });

  it('DELETE removes a point', async () => {
    const res = await request(app).delete('/api/plumbing/toilet_mbath');
    assert.equal(res.status, 200);
    const getRes = await request(app).get('/api/plumbing');
    assert.equal(getRes.body.length, 2);
  });

  it('PUT returns 404 for non-existent point', async () => {
    const res = await request(app)
      .put('/api/plumbing/nonexistent')
      .send({ x: 1, z: 1 });
    assert.equal(res.status, 404);
  });

  it('DELETE returns 404 for non-existent point', async () => {
    const res = await request(app).delete('/api/plumbing/nonexistent');
    assert.equal(res.status, 404);
  });

  it('POST returns 400 when missing id or room', async () => {
    const res1 = await request(app).post('/api/plumbing').send({ room: 'kitchen' });
    assert.equal(res1.status, 400);

    const res2 = await request(app).post('/api/plumbing').send({ id: 'test' });
    assert.equal(res2.status, 400);
  });
});
