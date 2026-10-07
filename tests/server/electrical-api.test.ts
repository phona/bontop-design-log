import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createElectricalRouter } from '../../server/routes-electrical.js';

describe('Electrical API', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'electrical.yaml');

  function writeGeometryContext(): void {
    mkdirSync(join(tmpDir, 'layout'), { recursive: true });
    writeFileSync(join(tmpDir, 'layout/model-geometry.yaml'), `vertices:
  - {id: v_liv_w, x: 0, z: 6}
  - {id: v_liv_e, x: 20, z: 6}
  - {id: v_bed_w, x: 0, z: 2.3}
  - {id: v_bed_e, x: 10, z: 2.3}
  - {id: v_kit_w, x: 0, z: 4}
  - {id: v_kit_e, x: 10, z: 4}
  - {id: v_liv_1, x: 0, z: 0}
  - {id: v_liv_2, x: 10, z: 0}
  - {id: v_liv_3, x: 10, z: 10}
  - {id: v_bed_1, x: 20, z: 0}
  - {id: v_bed_2, x: 30, z: 0}
  - {id: v_bed_3, x: 30, z: 10}
  - {id: v_kit_1, x: 40, z: 0}
  - {id: v_kit_2, x: 50, z: 0}
  - {id: v_kit_3, x: 50, z: 10}
walls:
  - {id: w_st_east, from: v_liv_w, to: v_liv_e}
  - {id: w_bd_east, from: v_bed_w, to: v_bed_e}
  - {id: w_kit_north, from: v_kit_w, to: v_kit_e}
rooms:
  - {id: living_dining, boundary: [v_liv_1, v_liv_2, v_liv_3]}
  - {id: bedroom_nw, boundary: [v_bed_1, v_bed_2, v_bed_3]}
  - {id: kitchen, boundary: [v_kit_1, v_kit_2, v_kit_3]}
`, 'utf8');
    writeFileSync(join(tmpDir, 'layout/overlay.yaml'), 'suppress: []\n', 'utf8');
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'electrical-test-'));
    writeGeometryContext();
    writeFileSync(yamlPath(), `- id: sock_living_tv
  room: living_dining
  wall: w_st_east
  type: socket
  x: 7.2
  z: 5.8
  wall_side: north
  height: 0.3
  count: 4
  note: "电视墙"
- id: sock_bedroom
  room: bedroom_nw
  wall: w_bd_east
  type: socket
  x: 4.6
  z: 2.3
  wall_side: north
  height: 0.3
  count: 2
`, 'utf8');

    app = express();
    app.use(express.json());
    app.use('/api/electrical', createElectricalRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET lists all electrical points', async () => {
    const res = await request(app).get('/api/electrical');
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body), true);
    assert.equal(res.body.length, 2);
  });

  it('PUT updates position', async () => {
    const res = await request(app)
      .put('/api/electrical/sock_living_tv')
      .send({ x: 7.5, z: 6.0 });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.x, 7.5);
  });

  it('POST adds new point', async () => {
    const res = await request(app)
      .post('/api/electrical')
      .send({ id: 'sock_new', room: 'kitchen', wall: 'w_kit_north', wall_side: 'north', type: 'socket', x: 3, z: 4, height: 0.3 });
    assert.equal(res.status, 201);
  });

  it('DELETE removes a point', async () => {
    const res = await request(app).delete('/api/electrical/sock_bedroom');
    assert.equal(res.status, 200);
    const getRes = await request(app).get('/api/electrical');
    assert.equal(getRes.body.length, 2);
  });

  it('PUT returns 404 for non-existent point', async () => {
    const res = await request(app)
      .put('/api/electrical/nonexistent')
      .send({ x: 1, z: 1 });
    assert.equal(res.status, 404);
  });

  it('DELETE returns 404 for non-existent point', async () => {
    const res = await request(app).delete('/api/electrical/nonexistent');
    assert.equal(res.status, 404);
  });

  it('POST returns 400 when missing id or room', async () => {
    const res1 = await request(app).post('/api/electrical').send({ room: 'kitchen' });
    assert.equal(res1.status, 400);

    const res2 = await request(app).post('/api/electrical').send({ id: 'test' });
    assert.equal(res2.status, 400);
  });
});
