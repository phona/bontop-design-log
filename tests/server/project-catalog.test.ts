import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectCatalog } from '../../server/project-catalog.js';

describe('ProjectCatalog', () => {
  it('loads topics and options', () => {
    const catalog = ProjectCatalog.load('.');
    const topics = catalog.getTopics();
    assert.ok(topics.some((t) => t.id === 'floor'));
    assert.ok(topics.some((t) => t.id === 'hvac'));
    assert.ok(catalog.getOptions('hvac').some((o) => o.id === 'A2'));
    assert.equal(catalog.getOption('hvac', 'A2')?.price_per_unit, 29000);
  });

  it('validates topics, options, rooms', () => {
    const catalog = ProjectCatalog.load('.');
    assert.ok(catalog.isValidTopic('floor'));
    assert.ok(catalog.isValidOption('floor', 'floor_tile_01'));
    assert.ok(catalog.isValidRoom('master_bedroom'));
    assert.ok(!catalog.isValidOption('floor', 'no-such-tile'));
  });
});
