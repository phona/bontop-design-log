import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { createFurnishingsRouter } from '../../server/routes-furnishings.js';

describe('Furnishings API (with real YAML file)', () => {
  let tmpDir: string;
  let app: express.Express;
  const yamlPath = () => join(tmpDir, 'house.yaml');

  function writeGeometryContext(): void {
    mkdirSync(join(tmpDir, 'layout'), { recursive: true });
    writeFileSync(join(tmpDir, 'layout/model-geometry.yaml'), `vertices:
  - {id: v_living_1, x: 0, z: 0}
  - {id: v_living_2, x: 10, z: 0}
  - {id: v_living_3, x: 10, z: 10}
  - {id: v_bedroom_1, x: 20, z: 0}
  - {id: v_bedroom_2, x: 30, z: 0}
  - {id: v_bedroom_3, x: 30, z: 10}
walls: []
rooms:
  - {id: living_dining, boundary: [v_living_1, v_living_2, v_living_3]}
  - {id: bedroom_nw, boundary: [v_bedroom_1, v_bedroom_2, v_bedroom_3]}
`, 'utf8');
    writeFileSync(join(tmpDir, 'layout/overlay.yaml'), 'suppress: []\n', 'utf8');
  }

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'furnishings-test-'));
    writeGeometryContext();
    writeFileSync(yamlPath(), `furnishings:
  living_dining:
    - { type: sofa_3seat, x: 11, z: 7, rotation: 270 }
    - { type: tv_wall_low, x: 7.4, z: 7, rotation: 90 }
  bedroom_nw:
    - { type: bed_180, x: 4.6, z: 2.3, rotation: 270 }
`, 'utf8');

    app = express();
    app.use(express.json());
    app.use('/api/furnishings', createFurnishingsRouter(yamlPath()));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET returns all furnishings grouped by room', async () => {
    const res = await request(app).get('/api/furnishings');
    assert.equal(res.status, 200);
    assert.ok(res.body.living_dining);
    assert.equal(res.body.living_dining.length, 2);
  });

  it('PUT updates a furnishing position', async () => {
    const res = await request(app)
      .put('/api/furnishings/living_dining/0')
      .send({ x: 12, z: 8, rotation: 180 });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.x, 12);
    assert.equal(res.body.item.z, 8);
    assert.equal(res.body.item.rotation, 180);

    const content = readFileSync(yamlPath(), 'utf8');
    assert.ok(content.includes('x: 12'));
  });

  it('DELETE removes a furnishing', async () => {
    const res = await request(app).delete('/api/furnishings/living_dining/0');
    assert.equal(res.status, 200);
    const getRes = await request(app).get('/api/furnishings');
    assert.equal(getRes.body.living_dining.length, 1);
  });

  it('POST adds a new furnishing', async () => {
    const res = await request(app)
      .post('/api/furnishings')
      .send({ room: 'living_dining', type: 'dining_table', x: 9, z: 5.3, rotation: 0 });
    assert.equal(res.status, 201);
    assert.equal(res.body.item.type, 'dining_table');

    const content = readFileSync(yamlPath(), 'utf8');
    assert.ok(content.includes('dining_table'));
  });

  it('GET /api/furnishings returns empty object for empty furnishings', async () => {
    const prevYaml = readFileSync(yamlPath(), 'utf8');
    writeFileSync(yamlPath(), `furnishings: {}
`, 'utf8');
    const res = await request(app).get('/api/furnishings');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {});
    writeFileSync(yamlPath(), prevYaml, 'utf8');
  });

  it('PUT returns 404 for non-existent room', async () => {
    const res = await request(app)
      .put('/api/furnishings/nonexistent/0')
      .send({ x: 1, z: 1 });
    assert.equal(res.status, 404);
  });

  it('PUT returns 404 for out-of-range index', async () => {
    const res = await request(app)
      .put('/api/furnishings/living_dining/999')
      .send({ x: 1, z: 1 });
    assert.equal(res.status, 404);
  });

  it('DELETE returns 404 for non-existent room', async () => {
    const res = await request(app).delete('/api/furnishings/nonexistent/0');
    assert.equal(res.status, 404);
  });

  it('POST returns 400 when missing room or type', async () => {
    const res1 = await request(app).post('/api/furnishings').send({ type: 'sofa' });
    assert.equal(res1.status, 400);

    const res2 = await request(app).post('/api/furnishings').send({ room: 'living_dining' });
    assert.equal(res2.status, 400);
  });
});
