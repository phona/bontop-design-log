import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFixture } from './FixtureFactory.js';

function fixtureSize(type: string): THREE.Vector3 {
  const fixture = buildFixture(type);
  expect(fixture).not.toBeNull();
  fixture!.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
}

describe('entry storage fixtures', () => {
  it('builds the entry half-height cabinet as a 2m-long visual screen', () => {
    const size = fixtureSize('entry_half_height_cabinet');
    expect(size.x).toBeCloseTo(2.04, 2);
    expect(size.y).toBeCloseTo(1.50, 2);
    expect(size.z).toBeCloseTo(0.39, 2);
  });

  it('builds the movable garden station with a freestanding pegboard', () => {
    const size = fixtureSize('garden_entry_station');
    expect(size.x).toBeCloseTo(1.14, 2);
    expect(size.y).toBeCloseTo(1.905, 2);
    expect(size.z).toBeCloseTo(0.38, 2);
  });
});
