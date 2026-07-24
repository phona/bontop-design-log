import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { PitfallEngine } from '../../server/pitfall-engine.js';
import type { PitfallConfig } from '../../server/pitfall-engine.js';

function loadEngine(): PitfallEngine {
  const raw = readFileSync('config/budget-pitfalls.yaml', 'utf8');
  return new PitfallEngine(load(raw) as PitfallConfig);
}

describe('PitfallEngine', () => {
  it('loads pitfalls from config/budget-pitfalls.yaml', () => {
    const engine = loadEngine();
    const all = engine.getPitfalls();
    assert.ok(all.length >= 20, 'expected at least 20 pitfalls (budget + construction + acceptance)');
  });

  it('filters by category', () => {
    const engine = loadEngine();
    const waterproof = engine.getPitfalls({ category: 'waterproof' });
    assert.ok(waterproof.length >= 3, 'waterproof should have budget + construction + acceptance entries');
    assert.ok(waterproof.every((p) => p.category === 'waterproof'));
  });

  it('filters by type', () => {
    const engine = loadEngine();
    const acceptance = engine.getPitfalls({ type: 'acceptance' });
    assert.ok(acceptance.length >= 5);
    assert.ok(acceptance.every((p) => p.type === 'acceptance'));
    assert.ok(acceptance.every((p) => Array.isArray(p.checklist) && p.checklist.length > 0));
  });

  it('filters by stage', () => {
    const engine = loadEngine();
    const we = engine.getPitfalls({ stage: 'water_electric' });
    assert.ok(we.length >= 2);
    assert.ok(we.every((p) => p.stage === 'water_electric'));
  });

  it('returns templates and selects by tier', () => {
    const engine = loadEngine();
    const templates = engine.listTemplates();
    assert.ok(templates.length >= 3);
    const pragmatic = engine.getTemplate('pragmatic');
    assert.ok(pragmatic);
    assert.equal(pragmatic.total, 110000);
  });

  it('selects template by target budget', () => {
    const engine = loadEngine();
    const t = engine.getTemplate(undefined, 160000);
    assert.ok(t);
    assert.equal(t.id, 'balanced');
  });

  it('returns pitfalls for central AC installation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_hvac' });
    assert.ok(pitfalls.length >= 5);
    assert.ok(pitfalls.some((p) => p.title.includes('抽真空')));
  });

  it('returns pitfalls for water heater installation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_water_heater' });
    assert.ok(pitfalls.length >= 3);
    assert.ok(pitfalls.some((p) => p.title.includes('排烟管')));
  });

  it('returns pitfalls for range hood installation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_range_hood' });
    assert.ok(pitfalls.length >= 3);
    assert.ok(pitfalls.some((p) => p.title.includes('止逆阀')));
  });

  it('returns pitfalls for water purifier installation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_water_purifier' });
    assert.ok(pitfalls.length >= 3);
    assert.ok(pitfalls.some((p) => p.title.includes('预留插座')));
  });

  it('returns pitfalls for laundry installation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_laundry' });
    assert.ok(pitfalls.length >= 2);
    assert.ok(pitfalls.some((p) => p.title.includes('插座')));
  });

  it('returns pitfalls for smart home reservation', () => {
    const engine = loadEngine();
    const pitfalls = engine.getPitfalls({ category: 'appliance_smart_home' });
    assert.ok(pitfalls.length >= 2);
    assert.ok(pitfalls.some((p) => p.title.includes('零线')));
  });
});
