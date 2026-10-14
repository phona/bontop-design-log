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
    // 2026-10-13 阶段 3：config/hvac.yaml 成为必读配置（hvac 选型/单价/取证态的唯一源），
    // 与 materials.yaml / house.yaml 同级——缺文件就抛错，不静默按「没有空调」计。
    writeFileSync(
      join(dir, 'config/hvac.yaml'),
      `plans:\n  - id: fixture\n    kind: vrf_ducted\n    name: fixture\n    commercial:\n      status: candidate\n      price_cny: 0\n    outdoor:\n      platform: west_platform\n      width: 1\n      depth: 1\n      height: 1\n    diagram:\n      anchors: []\n      terminals: []\n      routes: []\n      reference_constraints: []\n`,
    );

    const catalog = ProjectCatalog.load(dir);
    assert.strictEqual(catalog.getLayoutSource(), 'model-geometry');

    rmSync(dir, { recursive: true, force: true });
  });
});
