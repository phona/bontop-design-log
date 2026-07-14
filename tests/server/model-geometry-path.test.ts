import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ProjectCatalog default layout source', () => {
  it('loads config/layout/model-geometry.yaml by default', () => {
    const dir = join(tmpdir(), `bontop-model-geometry-${Date.now()}`);
    mkdirSync(join(dir, 'config/layout'), { recursive: true });
    mkdirSync(join(dir, 'config/budget'), { recursive: true });
    mkdirSync(join(dir, 'config/materials'), { recursive: true });

    writeFileSync(
      join(dir, 'config/layout/model-geometry.yaml'),
      `version: '1.0'\nunit: m\nrooms: []\nwalls: []\n`,
    );
    writeFileSync(join(dir, 'config/house.yaml'), `rooms: []\ngift_areas: []\n`);
    writeFileSync(join(dir, 'config/materials.yaml'), `materials: []\n`);
    writeFileSync(join(dir, 'config/budget/base.json'), `{"total_budget": 0, "categories": {}}`);

    const catalog = ProjectCatalog.load(dir);
    assert.strictEqual(catalog.layoutSource, 'model-geometry.yaml');

    rmSync(dir, { recursive: true, force: true });
  });
});
