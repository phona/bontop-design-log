import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProblemDetector } from '../../../app/src/render/annotations/ProblemDetector.js';

describe('ProblemDetector', () => {
  it('detects socket behind furniture', () => {
    const detector = new ProblemDetector();
    const socket = {
      id: 's1',
      room: 'living_dining',
      wall: 'w_st_east',
      x: 7.2,
      z: 5.8,
      height: 0.3,
      type: 'socket' as const,
    };
    const furniture = [{ type: 'sofa_3seat', x: 7.2, z: 5.8, width: 0.5, depth: 0.5 }];
    const problems = detector.checkSocketBehindFurniture([socket], furniture);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].severity, 'warning');
    assert.equal(problems[0].type, 'socket_blocked');
  });

  it('passes when socket is clear of furniture', () => {
    const detector = new ProblemDetector();
    const socket = {
      id: 's1',
      room: 'living_dining',
      wall: 'w_st_east',
      x: 7.2,
      z: 5.8,
      height: 0.3,
      type: 'socket' as const,
    };
    const furniture = [{ type: 'sofa_3seat', x: 8.0, z: 5.0, width: 0.5, depth: 0.5 }];
    const problems = detector.checkSocketBehindFurniture([socket], furniture);
    assert.equal(problems.length, 0);
  });

  it('detects point overlap on same wall', () => {
    const detector = new ProblemDetector();
    const electrical = [
      { id: 'e1', room: 'living_dining', wall: 'w_st_east', x: 7.2, z: 5.8, height: 0.3, type: 'socket' as const },
      { id: 'e2', room: 'living_dining', wall: 'w_st_east', x: 7.25, z: 5.9, height: 1.2, type: 'switch' as const },
    ];
    const problems = detector.checkPointOverlap(electrical, []);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].type, 'point_overlap');
  });

  it('no false positive for distant electrical points', () => {
    const detector = new ProblemDetector();
    const electrical = [
      { id: 'e1', room: 'living_dining', wall: 'w_st_east', x: 7.2, z: 5.8, height: 0.3, type: 'socket' as const },
      { id: 'e2', room: 'living_dining', wall: 'w_st_east', x: 9.0, z: 5.8, height: 1.2, type: 'switch' as const },
    ];
    const problems = detector.checkPointOverlap(electrical, []);
    assert.equal(problems.length, 0);
  });

  it('detects plumbing overlap', () => {
    const detector = new ProblemDetector();
    const plumbing = [
      { id: 'p1', room: 'bathroom', type: 'faucet' as const, x: 3.0, z: 2.0, height: 0.5 },
      { id: 'p2', room: 'bathroom', type: 'drain' as const, x: 3.1, z: 2.05, height: 0.0 },
    ];
    const problems = detector.checkPointOverlap([], plumbing);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].type, 'point_overlap');
    assert.equal(problems[0].severity, 'error');
  });

  it('detects cross-type overlap (electrical + plumbing)', () => {
    const detector = new ProblemDetector();
    const electrical = [
      { id: 'e1', room: 'kitchen', wall: 'w_kt_north', x: 4.0, z: 3.0, height: 0.3, type: 'socket' as const },
    ];
    const plumbing = [
      { id: 'p1', room: 'kitchen', type: 'faucet' as const, x: 4.05, z: 3.02, height: 0.5 },
    ];
    const problems = detector.checkPointOverlap(electrical, plumbing);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].type, 'point_overlap');
    assert.equal(problems[0].severity, 'warning');
  });

  it('socket is detected within tolerance (0.2m from furniture edge)', () => {
    const detector = new ProblemDetector();
    const socket = {
      id: 's1',
      room: 'living_dining',
      wall: 'w_st_east',
      x: 7.6,
      z: 5.6,
      height: 0.3,
      type: 'socket' as const,
    };
    const furniture = [{ type: 'sofa_3seat', x: 7.2, z: 5.8, width: 0.5, depth: 0.5 }];
    const problems = detector.checkSocketBehindFurniture([socket], furniture);
    assert.equal(problems.length, 1);
  });

  it('detectAll combines results', () => {
    const detector = new ProblemDetector();
    const electrical = [
      { id: 'e1', room: 'living_dining', wall: 'w_st_east', x: 7.2, z: 5.8, height: 0.3, type: 'socket' as const },
      { id: 'e2', room: 'living_dining', wall: 'w_st_east', x: 7.25, z: 5.9, height: 1.2, type: 'switch' as const },
    ];
    const furniture = [{ type: 'sofa_3seat', x: 7.2, z: 5.8, width: 0.5, depth: 0.5 }];
    const problems = detector.detectAll(electrical, [], [], furniture, []);
    assert.ok(problems.length >= 1);
    const types = new Set(problems.map(p => p.type));
    assert.ok(types.has('socket_blocked'));
    assert.ok(types.has('point_overlap'));
  });
});
