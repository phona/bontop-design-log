import { describe, it, expect } from 'vitest';
import { getTopicsForObject } from './objectMapping.js';

describe('getTopicsForObject', () => {
  it('maps floor surface to floor topic', () => {
    expect(getTopicsForObject('floor:master_bedroom')).toContain('floor');
  });
  it('maps wall surface to the paint topic', () => {
    // DEC-2026-10-08-C19：wall topic 已下架，点墙只关联涂装主题
    expect(getTopicsForObject('wall:master_bedroom:north')).toContain('paint');
    expect(getTopicsForObject('wall:master_bedroom:north')).not.toContain('wall');
  });
  it('maps platform boundary to hvac topic', () => {
    expect(getTopicsForObject('platform_boundary')).toContain('hvac');
  });
});
