import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TradeoffEngine } from '../../server/tradeoff-engine.js';

describe('TradeoffEngine', () => {
  it('returns tradeoffs for a known topic', () => {
    const engine = new TradeoffEngine();
    const tradeoffs = engine.getTradeoffs('tile_installation');
    assert.ok(tradeoffs.length >= 1);
    assert.ok(tradeoffs[0].options.length >= 2);
    assert.ok(tradeoffs[0].options[0].cost > 0);
  });

  it('returns multiple options per tradeoff', () => {
    const engine = new TradeoffEngine();
    const tradeoffs = engine.getTradeoffs('paint_brand');
    assert.equal(tradeoffs.length, 1);
    assert.equal(tradeoffs[0].options.length, 3);
  });

  it('returns empty for unknown topic', () => {
    const engine = new TradeoffEngine();
    const tradeoffs = engine.getTradeoffs('nonexistent_topic');
    assert.equal(tradeoffs.length, 0);
  });

  it('returns empty for unknown materialId', () => {
    const engine = new TradeoffEngine();
    const tradeoffs = engine.getAffectedTradeoffs('unknown_category_01');
    assert.equal(tradeoffs.length, 0);
  });

  it('returns tradeoffs for known material category', () => {
    const engine = new TradeoffEngine();
    const tradeoffs = engine.getAffectedTradeoffs('floor_tile_01');
    assert.ok(tradeoffs.length >= 1);
    assert.equal(tradeoffs[0].topic, 'tile_installation');
  });

  it('getAll returns all tradeoffs', () => {
    const engine = new TradeoffEngine();
    const all = engine.getAll();
    assert.ok(all.length >= 3);
    const topics = all.map(t => t.topic);
    assert.ok(topics.includes('tile_installation'));
    assert.ok(topics.includes('paint_brand'));
    assert.ok(topics.includes('procurement_mode'));
  });

  it('getAll returns a copy, not a reference', () => {
    const engine = new TradeoffEngine();
    const a1 = engine.getAll();
    const a2 = engine.getAll();
    a1[0].options = [];
    assert.notEqual(a2[0].options.length, 0);
  });
});
