import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AcceptanceEngine } from '../../server/acceptance-engine.js';

describe('AcceptanceEngine', () => {
  it('returns checklist for tile installation phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('tile_installation');
    assert.ok(items.length > 0);
    assert.ok(items[0].item);
    assert.ok(items[0].method);
    assert.ok(items[0].standard);
  });

  it('returns empty for unknown phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('unknown_phase');
    assert.equal(items.length, 0);
  });

  it('returns items for demolition phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('demolition');
    assert.ok(items.length >= 2);
    assert.equal(items[0].severity, 'critical');
  });

  it('returns items for waterproofing phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('waterproofing');
    assert.ok(items.length >= 2);
  });

  it('returns items for painting phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('painting');
    assert.ok(items.length >= 2);
  });

  it('returns items for hvac_installation phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('hvac_installation');
    assert.ok(items.length >= 6);
  });

  it('returns items for electrical_check phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('electrical_check');
    assert.ok(items.length >= 2);
  });

  it('returns items for occupancy phase', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklist('occupancy');
    assert.ok(items.length >= 1);
  });

  it('filters items by room', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklistForRoom('tile_installation', 'master_bath');
    assert.ok(items.length > 0);
    const allRooms = items.every(i => !i.rooms || i.rooms.includes('master_bath'));
    assert.ok(allRooms);
  });

  it('returns global items for unknown room', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklistForRoom('tile_installation', 'nonexistent_room');
    const all = engine.getChecklist('tile_installation');
    const globalItems = all.filter(i => !i.rooms);
    assert.equal(items.length, globalItems.length);
  });

  it('returns all items for phase when room filter has no rooms restriction', () => {
    const engine = new AcceptanceEngine();
    const items = engine.getChecklistForRoom('demolition', 'living_room');
    const all = engine.getChecklist('demolition');
    assert.equal(items.length, all.length);
  });

  it('loads on first access', () => {
    const engine = new AcceptanceEngine();
    assert.doesNotThrow(() => engine.getChecklist('demolition'));
  });
});
