import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LifecycleEngine } from '../../server/lifecycle-engine.js';

describe('LifecycleEngine', () => {
  it('defaults all materials to selection stage', () => {
    const engine = new LifecycleEngine();
    const status = engine.getStatus('floor_tile_01');
    assert.equal(status.stage, 'selection');
  });

  it('advances to next stage on setStage', () => {
    const engine = new LifecycleEngine();
    engine.setStage('floor_tile_01', 'quantity');
    assert.equal(engine.getStatus('floor_tile_01').stage, 'quantity');
  });

  it('calculates quantity from room area', () => {
    const engine = new LifecycleEngine();
    const qty = engine.calculateQuantity('floor_tile_01');
    assert.ok(qty.area > 0);
    assert.ok(qty.total > qty.area);
  });

  it('supports stage transitions back to previous', () => {
    const engine = new LifecycleEngine();
    engine.setStage('floor_tile_01', 'purchased');
    engine.setStage('floor_tile_01', 'selection');
    assert.equal(engine.getStatus('floor_tile_01').stage, 'selection');
  });

  it('returns all statuses from getAllStatuses', () => {
    const engine = new LifecycleEngine();
    const all = engine.getAllStatuses();
    assert.ok(all.length >= 3);
    const ids = all.map(s => s.id);
    assert.ok(ids.includes('floor_tile_01'));
    assert.ok(ids.includes('wall_tile_01'));
    assert.ok(ids.includes('latex_paint_01'));
  });

  it('throws for unknown material in getStatus', () => {
    const engine = new LifecycleEngine();
    assert.throws(() => engine.getStatus('nonexistent'), /Unknown material/);
  });

  it('throws for unknown material in setStage', () => {
    const engine = new LifecycleEngine();
    assert.throws(() => engine.setStage('nonexistent', 'purchased'), /Unknown material/);
  });

  it('calculates quantity for null-room (whole house) materials', () => {
    const engine = new LifecycleEngine();
    const qty = engine.calculateQuantity('latex_paint_01');
    assert.ok(qty.area > 0);
    assert.ok(qty.total > qty.area);
    assert.equal(qty.unit, 'L');
  });

  it('returns notes from config', () => {
    const engine = new LifecycleEngine();
    const status = engine.getStatus('floor_tile_01');
    assert.ok(Array.isArray(status.notes));
  });

  it('setStage does not affect other materials', () => {
    const engine = new LifecycleEngine();
    engine.setStage('floor_tile_01', 'purchased');
    const wallStatus = engine.getStatus('wall_tile_01');
    assert.equal(wallStatus.stage, 'selection');
  });

  it('getStatus returns a copy, not a reference', () => {
    const engine = new LifecycleEngine();
    const s1 = engine.getStatus('floor_tile_01');
    const s2 = engine.getStatus('floor_tile_01');
    s1.stage = 'purchased';
    assert.equal(s2.stage, 'selection');
  });
});
