import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurtainRenderProjection,
  normalizeCurtainState,
  type CurtainOverlayLike,
} from '../../../shared/curtain-projection.js';
import { sha256Hex } from '../../../shared/sha256.js';
import type { CurtainPresentationState } from '../../../shared/types.js';

const overlay: CurtainOverlayLike = {
  elements: [
    { id: 'curtain_living_south', type: 'curtain', room: 'living_dining', kind: 'sheer_blackout' },
    { id: 'curtain_master_south', type: 'curtain', room: 'master_bedroom', kind: 'sheer_blackout' },
    { id: 'curtain_master_west', type: 'curtain', room: 'master_bedroom', kind: 'sheer_blackout' },
    { id: 'curtain_mbath_corner', type: 'curtain', room: 'master_bath', kind: 'blinds' },
    { id: 'wall_1', type: 'wall' },
  ],
};

function presentation(partial: Partial<CurtainPresentationState> = {}): CurtainPresentationState {
  return { default: 'open', roomOverrides: {}, updatedAt: '2026-08-25T00:00:00.000Z', ...partial };
}

describe('sha256Hex', () => {
  it('matches the standard SHA-256 abc test vector', () => {
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('normalizeCurtainState', () => {
  it('normalizes blinds blackout to privacy and keeps other states', () => {
    assert.equal(normalizeCurtainState('blackout', 'blinds'), 'privacy');
    assert.equal(normalizeCurtainState('blackout', 'sheer_blackout'), 'blackout');
    assert.equal(normalizeCurtainState('open', 'blinds'), 'open');
  });
});

describe('buildCurtainRenderProjection', () => {
  it('expands default state to every curtain room', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({ default: 'privacy' }));
    assert.deepEqual(projection.effectiveByRoom, {
      living_dining: 'privacy',
      master_bath: 'privacy',
      master_bedroom: 'privacy',
    });
    const living = projection.curtains.find((c) => c.id === 'curtain_living_south');
    assert.deepEqual(living?.expectedVisibleNodes, [
      'curtain_living_south:sheer:deployed',
      'curtain_living_south:blackout:gathered:left',
      'curtain_living_south:blackout:gathered:right',
    ]);
  });

  it('applies room overrides over the default and sorts output keys', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({
      default: 'open',
      roomOverrides: { master_bedroom: 'blackout' },
    }));
    assert.equal(projection.effectiveByRoom.master_bedroom, 'blackout');
    assert.equal(projection.effectiveByRoom.living_dining, 'open');
    assert.deepEqual(Object.keys(projection.effectiveByRoom), [...Object.keys(projection.effectiveByRoom)].sort());
    assert.deepEqual(Object.keys(projection.source.roomOverrides), [...Object.keys(projection.source.roomOverrides)].sort());
    assert.deepEqual(projection.curtains.map((c) => c.id), [...projection.curtains.map((c) => c.id)].sort());
    const master = projection.curtains.find((c) => c.id === 'curtain_master_west');
    assert.deepEqual(master?.expectedVisibleNodes, [
      'curtain_master_west:sheer:deployed',
      'curtain_master_west:blackout:deployed',
    ]);
  });

  it('shares one state across multiple curtains in the same room', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({
      roomOverrides: { master_bedroom: 'privacy' },
    }));
    const masterCurtains = projection.curtains.filter((c) => c.roomId === 'master_bedroom');
    assert.equal(masterCurtains.length, 2);
    assert.ok(masterCurtains.every((c) => c.state === 'privacy'));
  });

  it('normalizes blinds blackout to privacy and derives blinds nodes', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({
      roomOverrides: { master_bath: 'blackout' },
    }));
    assert.equal(projection.effectiveByRoom.master_bath, 'privacy');
    assert.equal(projection.source.roomOverrides.master_bath, 'privacy');
    const blinds = projection.curtains.find((c) => c.kind === 'blinds');
    assert.deepEqual(blinds?.expectedVisibleNodes, ['curtain_mbath_corner:blinds:deployed']);
  });

  it('normalizes whole-house blackout to privacy only for blinds', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({ default: 'blackout' }));
    assert.deepEqual(projection.effectiveByRoom, {
      living_dining: 'blackout',
      master_bath: 'privacy',
      master_bedroom: 'blackout',
    });
    assert.deepEqual(projection.curtains.find((c) => c.id === 'curtain_mbath_corner')?.expectedVisibleNodes, [
      'curtain_mbath_corner:blinds:deployed',
    ]);
  });

  it('derives empty visible nodes for open curtains', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation());
    assert.ok(projection.curtains.every((c) => c.expectedVisibleNodes.length === 0));
  });

  it('rejects overrides for rooms without curtains', () => {
    assert.throws(
      () => buildCurtainRenderProjection(overlay, presentation({ roomOverrides: { kitchen: 'privacy' } })),
      /without curtains/,
    );
  });

  it('rejects duplicate curtain ids', () => {
    const dup: CurtainOverlayLike = {
      elements: [
        { id: 'c1', type: 'curtain', room: 'a' },
        { id: 'c1', type: 'curtain', room: 'b' },
      ],
    };
    assert.throws(() => buildCurtainRenderProjection(dup, presentation()), /duplicate curtain id/);
  });

  it('rejects mixed curtain kinds in the same room', () => {
    const mixed: CurtainOverlayLike = {
      elements: [
        { id: 'c1', type: 'curtain', room: 'a', kind: 'blinds' },
        { id: 'c2', type: 'curtain', room: 'a', kind: 'sheer_blackout' },
      ],
    };
    assert.throws(() => buildCurtainRenderProjection(mixed, presentation()), /mixes curtain kinds/);
  });

  it('drops redundant overrides that match the normalized default', () => {
    const projection = buildCurtainRenderProjection(overlay, presentation({
      default: 'open',
      roomOverrides: { master_bedroom: 'open' },
      updatedAt: '2026-08-25T01:00:00.000Z',
    }));
    assert.deepEqual(projection.source.roomOverrides, {});
    assert.equal(projection.source.updatedAt, '2026-08-25T01:00:00.000Z');
    assert.equal(projection.effectiveByRoom.master_bedroom, 'open');
  });

  it('keeps snapshotSha256 stable regardless of input key order and updatedAt', () => {
    const a = buildCurtainRenderProjection(overlay, presentation({
      roomOverrides: { living_dining: 'privacy', master_bedroom: 'blackout' },
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
    const b = buildCurtainRenderProjection(
      { elements: [...overlay.elements].reverse() },
      presentation({
        roomOverrides: { master_bedroom: 'blackout', living_dining: 'privacy' },
        updatedAt: '2026-08-26T00:00:00.000Z',
      }),
    );
    assert.equal(a.snapshotSha256, b.snapshotSha256);
    assert.match(a.snapshotSha256, /^[0-9a-f]{64}$/u);
  });

  it('changes snapshotSha256 when the effective state changes', () => {
    const a = buildCurtainRenderProjection(overlay, presentation());
    const b = buildCurtainRenderProjection(overlay, presentation({ roomOverrides: { living_dining: 'privacy' } }));
    assert.notEqual(a.snapshotSha256, b.snapshotSha256);
  });
});
