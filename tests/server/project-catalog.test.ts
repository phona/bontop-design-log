import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import type { CadLayoutYaml, MaterialsYaml } from '../../shared/types.js';

const layoutFixture: CadLayoutYaml = {
  version: '1.0',
  source: 'test.dxf',
  unit: 'mm',
  scale: 0.001,
  origin: { x: 0, z: 0 },
  export_date: '2026-07-09',
  rooms: [
    { id: 'master_bedroom', name: '主卧', x: -5.35, z: 2.0, width: 4.5, depth: 4.05, height: 3.0, area: 18.16, perimeter: 18.39 },
  ],
  platform: { id: 'west_platform', name: '西设备平台', x: -8.5, z: 2.0, width: 1.6, depth: 1.55, height: 3.0, area: 2.48 },
};

const materialsFixture: MaterialsYaml = {
  materials: [
    {
      id: 'floor_tile_01',
      category: '地砖',
      name: '浅胡桃木纹砖',
      brand: '马可波罗',
      model: '800x800',
      spec: '800x800mm',
      unit: '片',
      price_per_unit: 65,
      coverage_per_unit: 0.64,
      loss_rate: 1.08,
      supplier: '',
      online_link: '',
      sample_acquired: false,
      sample_date: null,
      status: 'candidate',
      notes: '',
    },
  ],
};

const budgetBaseFixture = {
  total_budget: 110000,
  categories: {
    floor: { budget: 10000, actual: 0, status: 'draft', notes: '' },
  },
};

describe('ProjectCatalog', () => {
  it('loads topics and options from the real config directory', () => {
    const catalog = ProjectCatalog.load('.');
    const topics = catalog.getTopics();
    assert.ok(topics.some((t) => t.id === 'floor'));
    assert.ok(topics.some((t) => t.id === 'hvac'));
    assert.ok(catalog.getOptions('hvac').some((o) => o.id === 'A2'));
    assert.equal(catalog.getOption('hvac', 'A2')?.price_per_unit, 29000);
  });

  it('validates topics, options, and rooms from the real config directory', () => {
    const catalog = ProjectCatalog.load('.');
    assert.ok(catalog.isValidTopic('floor'));
    assert.ok(catalog.isValidOption('floor', 'floor_tile_01'));
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.ok(!catalog.isValidOption('floor', 'no-such-tile'));
  });

  it('builds catalog from an inline layout fixture', () => {
    const catalog = ProjectCatalog.fromMaterials(materialsFixture, budgetBaseFixture, layoutFixture);
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.equal(catalog.getRoom('master_bedroom')?.type, 'public');
    const platform = catalog.getPlatform();
    assert.ok(platform);
    assert.equal(platform?.id, 'west_platform');
    assert.equal(platform?.type, 'service');
    assert.equal(platform?.name, '西设备平台');
    assert.ok(!catalog.getRooms().some((r) => r.id === 'west_platform'));
    assert.ok(catalog.isValidTopic('floor'));
    assert.ok(catalog.isValidOption('floor', 'floor_tile_01'));
  });

  it('loads a layout YAML fixture', () => {
    const layout = load(readFileSync('tests/fixtures/layout.yaml', 'utf8')) as CadLayoutYaml;
    const catalog = ProjectCatalog.fromMaterials(materialsFixture, budgetBaseFixture, layout);
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.equal(catalog.getRoom('master_bedroom')?.name, '主卧');
    const platform = catalog.getPlatform();
    assert.ok(platform);
    assert.equal(platform?.name, '西设备平台');
    assert.ok(!catalog.getRooms().some((r) => r.id === 'west_platform'));
  });
});
