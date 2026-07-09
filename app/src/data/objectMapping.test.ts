import { describe, it, expect } from 'vitest';
import { getTopicsForObject } from './objectMapping.js';

describe('getTopicsForObject', () => {
  it('maps floor surface to floor topic', () => {
    expect(getTopicsForObject('floor:master_bedroom')).toContain('floor');
  });
  it('maps wall surface to wall and paint topics', () => {
    expect(getTopicsForObject('wall:master_bedroom:north')).toContain('wall');
    expect(getTopicsForObject('wall:master_bedroom:north')).toContain('paint');
  });
  it('maps platform boundary to hvac topic', () => {
    expect(getTopicsForObject('platform_boundary')).toContain('hvac');
  });
});
