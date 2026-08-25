import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFixture, buildKitchenCabinetRun } from './FixtureFactory.js';

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

describe('kitchen cabinet runs', () => {
  it('builds a continuous base cabinet and quartz countertop from declared dimensions', () => {
    const cabinet = buildKitchenCabinetRun({ length: 3.6, depth: 0.6 });
    cabinet.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cabinet);
    const size = box.getSize(new THREE.Vector3());

    expect(size.x).toBeCloseTo(3.64, 2);
    expect(size.y).toBeCloseTo(0.89, 2);
    expect(size.z).toBeCloseTo(0.64, 2);
    expect(cabinet.children.some((child) => child.userData.surface === 'countertop')).toBe(true);
  });
});

describe('plumbing fixtures', () => {
  it('builds a low round drain with a rim and multiple grate details', () => {
    const drain = buildFixture('drain');
    expect(drain).not.toBeNull();
    drain!.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(drain!).getSize(new THREE.Vector3());
    const cylinders = drain!.children.filter((part) => part instanceof THREE.Mesh && part.geometry.type === 'CylinderGeometry');

    expect(size.y).toBeLessThanOrEqual(0.03);
    expect(size.x).toBeGreaterThan(0.1);
    expect(size.z).toBeGreaterThan(0.1);
    expect(drain!.children.length).toBeGreaterThanOrEqual(5);
    expect(cylinders.length).toBeGreaterThanOrEqual(2);
  });

  it('builds the faucet as a compact wall escutcheon with a horizontal spout', () => {
    const faucet = buildFixture('faucet');
    expect(faucet).not.toBeNull();
    faucet!.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(faucet!).getSize(new THREE.Vector3());

    expect(size.y).toBeLessThanOrEqual(0.22);
    expect(size.z).toBeGreaterThan(size.y);
    expect(faucet!.children.length).toBeGreaterThanOrEqual(3);
    expect(faucet!.children.filter((part) => part instanceof THREE.Mesh && part.geometry.type === 'CylinderGeometry')).toHaveLength(3);
  });
});

describe('living room TV proposal fixtures', () => {
  it('keeps the TV independent from the low cabinet instead of rendering a TV backboard', () => {
    const tv = fixtureSize('tv_65');
    const lowCabinet = fixtureSize('tv_wall_low');

    expect(tv.x).toBeCloseTo(1.45, 2);
    expect(tv.y).toBeCloseTo(0.84, 2);
    expect(lowCabinet.y).toBeLessThan(0.51);
  });

  it('uses five visible legs so the low cabinet is a freestanding piece', () => {
    const lowCabinet = buildFixture('tv_wall_low');
    const legs = lowCabinet!.children.filter((part) => part instanceof THREE.Mesh && part.geometry.type === 'CylinderGeometry');

    expect(legs).toHaveLength(5);
  });

  it('keeps the tall cabinet below the ceiling with an open storage niche', () => {
    const cabinet = fixtureSize('wall_cabinet_tall');

    expect(cabinet.x).toBeCloseTo(1.35, 2);
    expect(cabinet.y).toBeCloseTo(2.715, 2);
    expect(cabinet.z).toBeCloseTo(0.375, 2);
  });

  it('renders the TV-side fiddle-leaf fig as a compact, freestanding accent', () => {
    const plant = fixtureSize('plant_fiddle');

    expect(plant.x).toBeLessThan(0.9);
    expect(plant.y).toBeCloseTo(1.77, 2);
    expect(plant.z).toBeCloseTo(0.4, 2);
  });
});

describe('electrical panel fixtures', () => {
  it('builds readable strong and weak panel boxes with door details', () => {
    const strong = buildFixture('strong_panel');
    const weak = buildFixture('weak_panel');

    expect(strong).not.toBeNull();
    expect(weak).not.toBeNull();
    expect(strong!.children.length).toBeGreaterThan(5);
    expect(weak!.children.length).toBeGreaterThan(5);
    expect(fixtureSize('strong_panel').y).toBeCloseTo(1, 2);
    expect(fixtureSize('weak_panel').y).toBeCloseTo(0.75, 2);
  });
});
