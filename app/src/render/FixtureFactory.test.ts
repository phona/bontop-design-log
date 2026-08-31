import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import * as appCeiling from './CeilingZoneBuilder.js';
import * as appFixtures from './FixtureFactory.js';
import * as appUv from './uv-utils.js';
import * as sharedCeiling from '@shared/render/CeilingZoneBuilder';
import * as sharedFixtures from '@shared/render/FixtureFactory';
import * as sharedUv from '@shared/render/uv-utils';
import {
  buildBathSideCabinetRun,
  buildFixture,
  buildKitchenCabinetRun,
  buildWardrobe180,
  buildWardrobeSplit,
  getRecipeTypes,
} from './FixtureFactory.js';

describe('shared render compatibility entries', () => {
  it('resolve App compatibility exports to the shared implementations', () => {
    expect(appFixtures.buildFixture).toBe(sharedFixtures.buildFixture);
    expect(appFixtures.buildWardrobe180).toBe(sharedFixtures.buildWardrobe180);
    expect(appFixtures.buildWardrobeSplit).toBe(sharedFixtures.buildWardrobeSplit);
    expect(appFixtures.buildBathSideCabinetRun).toBe(sharedFixtures.buildBathSideCabinetRun);
    expect(appFixtures.buildKitchenCabinetRun).toBe(sharedFixtures.buildKitchenCabinetRun);
    expect(appFixtures.getRecipeTypes).toBe(sharedFixtures.getRecipeTypes);
    expect(appCeiling.buildCeilingZone).toBe(sharedCeiling.buildCeilingZone);
    expect(appUv.scalePlaneUvToMeters).toBe(sharedUv.scalePlaneUvToMeters);
    expect(appUv.scaleBoxUvToMeters).toBe(sharedUv.scaleBoxUvToMeters);
  });
});

function fixtureSize(type: string): THREE.Vector3 {
  const fixture = buildFixture(type);
  expect(fixture).not.toBeNull();
  fixture!.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(fixture!).getSize(new THREE.Vector3());
}

describe('training fixtures', () => {
  it('registers and builds every training fixture with readable dimensions', () => {
    const expected: Record<string, [number, number, number]> = {
      squat_rack: [1.515, 2.25, 1.19],
      barbell_olympic: [2.20, 0.11, 0.11],
      weight_plate_set: [0.63, 0.087, 0.42],
      bench_adjustable: [1.24, 0.63, 0.55],
      rubber_training_mat: [1.80, 0.047, 1.60],
      low_weight_storage: [0.95, 0.805, 0.42],
      low_room_cabinet: [0.405, 0.80, 1.20],
    };
    for (const [type, [x, y, z]] of Object.entries(expected)) {
      expect(getRecipeTypes()).toContain(type);
      const fixture = buildFixture(type);
      expect(fixture).not.toBeNull();
      const size = fixtureSize(type);
      expect(size.x).toBeCloseTo(x, 2);
      expect(size.y).toBeCloseTo(y, 2);
      expect(size.z).toBeCloseTo(z, 2);
    }
  });

  it('exposes two contrasting safety arms projecting in reversed local +Z direction', () => {
    const rack = buildFixture('squat_rack')!;
    const safetyBars = rack.children.filter((child) => child.userData.materialRole === 'safety_bar');

    expect(safetyBars).toHaveLength(2);
    expect(safetyBars.map((child) => child.userData.part)).toEqual(['safety-bar-lower', 'safety-bar-upper']);
    expect(safetyBars.every((child) => child instanceof THREE.Mesh && child.geometry.type === 'BoxGeometry')).toBe(true);
    for (const bar of safetyBars) {
      const geometry = (bar as THREE.Mesh).geometry as THREE.BoxGeometry;
      expect(geometry.parameters.width).toBeCloseTo(0.07, 5);
      expect(geometry.parameters.height).toBeCloseTo(0.07, 5);
      expect(geometry.parameters.depth).toBeCloseTo(0.98, 5);
      expect(geometry.parameters.depth).toBeGreaterThan(geometry.parameters.width);
    }
    expect(safetyBars.map((child) => child.position.y)).toEqual([0.82, 0.98]);
    expect(safetyBars.map((child) => child.position.x)).toEqual([-0.54, 0.54]);
    expect(safetyBars.every((child) => child.position.z === 0.11)).toBe(true);
    expect(safetyBars.every((child) => {
      const halfLength = ((child as THREE.Mesh).geometry as THREE.BoxGeometry).parameters.depth / 2;
      expect(child.position.z - halfLength).toBeCloseTo(-0.38, 5);
      expect(child.position.z + halfLength).toBeCloseTo(0.60, 5);
      return true;
    })).toBe(true);
    expect(safetyBars.every((child) => {
      const material = (child as THREE.Mesh).material;
      return material instanceof THREE.MeshStandardMaterial && material.color.getHexString() === 'd05a35';
    })).toBe(true);
    expect(rack.children.some((child) => child.userData.part === 'safety-pin-left')).toBe(false);
    expect(rack.children.some((child) => child.userData.part === 'safety-pin-right')).toBe(false);
  });

  it('exposes rack-mounted plates plus explicit bench frame details', () => {
    expect(buildFixture('barbell_olympic')!.children.some((child) => child.userData.part === 'bar-shaft')).toBe(true);
    const rack = buildFixture('squat_rack')!;
    const rackPlates = rack.children.filter((child) => child.userData.materialRole === 'weight_plate');
    expect(rackPlates).toHaveLength(6);
    expect(rackPlates.map((child) => child.userData.part)).toEqual([
      'rack-plate-left-large', 'rack-plate-left-medium', 'rack-plate-left-small',
      'rack-plate-right-large', 'rack-plate-right-medium', 'rack-plate-right-small',
    ]);
    expect(rackPlates.every((child) => child instanceof THREE.Mesh && child.geometry.type === 'CylinderGeometry' && child.position.y > 0.1)).toBe(true);
    expect(rackPlates.map((child) => child.position.x)).toEqual([-0.64, -0.69, -0.735, 0.64, 0.69, 0.735]);

    const bench = buildFixture('bench_adjustable')!;
    expect(bench.children.some((child) => child.userData.part === 'back-pad')).toBe(true);
    for (const part of ['front-leg', 'rear-leg', 'front-base', 'rear-base']) {
      const mesh = bench.children.find((child) => child.userData.part === part);
      expect(mesh).toBeDefined();
      expect(mesh).toBeInstanceOf(THREE.Mesh);
      expect((mesh as THREE.Mesh).geometry.type).toBe('BoxGeometry');
      expect(mesh!.position.y).toBeLessThan(0.3);
    }
    expect(bench.children.filter((child) => child.userData.materialRole === 'weight_plate')).toHaveLength(0);
    expect(buildFixture('low_weight_storage')!.children.filter((child) => child.userData.materialRole === 'shelf')).toHaveLength(2);
    const roomCabinet = buildFixture('low_room_cabinet')!;
    expect(roomCabinet.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(2);
    expect(roomCabinet.children.filter((child) => child.userData.materialRole === 'drawer_front')).toHaveLength(2);
    expect(roomCabinet.children.some((child) => child.userData.materialRole === 'countertop')).toBe(true);
    expect(roomCabinet.children.some((child) => child.userData.materialRole === 'plinth')).toBe(true);
    expect(roomCabinet.children.some((child) => child.userData.materialRole === 'hardware')).toBe(true);
    expect(roomCabinet.children.some((child) => child.userData.materialRole === 'weight_plate')).toBe(false);

    // Local -X is the cabinet front; rotation=0° maps it to world -X (west/interior).
    const front = new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(0));
    expect(front.x).toBeCloseTo(-1, 5);
    expect(front.z).toBeCloseTo(0, 5);
    expect(buildFixture('weight_plate_set')!.children.filter((child) => child.userData.materialRole === 'weight_plate')).toHaveLength(3);
  });
});

describe('entry storage fixtures', () => {
  it('builds the entry half-height cabinet as a 2m-long visual screen', () => {
    const cabinet = buildFixture('entry_half_height_cabinet')!;
    const size = fixtureSize('entry_half_height_cabinet');
    expect(size.x).toBeCloseTo(2.04, 2);
    expect(size.y).toBeCloseTo(1.50, 2);
    expect(size.z).toBeCloseTo(0.39, 2);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(3);
    expect(cabinet.children.some((child) => child.userData.part === 'lower-door-seam')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'back_panel')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'shelf')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'plinth')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'countertop')).toBe(true);
  });

  it('builds the movable garden station with a freestanding pegboard', () => {
    const station = buildFixture('garden_entry_station')!;
    const size = fixtureSize('garden_entry_station');
    expect(size.x).toBeCloseTo(1.16, 2);
    expect(size.y).toBeCloseTo(1.85, 2);
    expect(size.z).toBeCloseTo(0.38, 2);
    expect(station.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(3);
    expect(station.children.filter((child) => child.userData.materialRole === 'cabinet_foot')).toHaveLength(4);
    expect(station.children.some((child) => child.userData.part === 'pegboard-back')).toBe(true);
    expect(station.children.some((child) => child.userData.materialRole === 'countertop')).toBe(true);
    expect(station.children.filter((child) => child.userData.materialRole === 'hardware')).toHaveLength(3);
  });

  it('keeps the count-only shoe cabinet recipe cabinet-like without changing its footprint', () => {
    const cabinet = buildFixture('shoe_cabinet')!;
    const size = fixtureSize('shoe_cabinet');
    expect(size.x).toBeCloseTo(1.5, 2);
    expect(size.y).toBeCloseTo(2.30, 2);
    expect(size.z).toBeCloseTo(0.35, 2);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(4);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_seam')).toHaveLength(2);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'back_panel')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'plinth')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'hardware')).toBe(true);
  });

  it('builds the bookshelf as an open shelving unit rather than a solid box', () => {
    const bookshelf = buildFixture('bookshelf')!;
    const size = fixtureSize('bookshelf');
    expect(size.x).toBeCloseTo(0.8, 2);
    expect(size.y).toBeCloseTo(1.8, 2);
    expect(size.z).toBeCloseTo(0.3, 2);
    expect(bookshelf.children).toHaveLength(9);
    expect(bookshelf.children.filter((child) => child.userData.materialRole === 'shelf')).toHaveLength(4);
    expect(bookshelf.children.some((child) => child.userData.part === 'back-panel')).toBe(true);
    expect(bookshelf.children.every((child) => child.userData.part && child.userData.materialRole)).toBe(true);
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
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(6);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'drawer_front')).toHaveLength(1);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_seam')).toHaveLength(5);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'hardware')).toHaveLength(1);
    expect(cabinet.children.some((child) => child.userData.part === 'plinth')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.part === 'end-panel-left')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.part === 'end-panel-right')).toBe(true);
  });
});

describe('wardrobe fixtures', () => {
  it('buildWardrobe180: 柜体 + 顶封板封到目标总高（默认 2.50 抵边吊底，可覆盖到原顶 2.80）', async () => {
    const { buildWardrobe180 } = await import('./FixtureFactory.js');
    const sizeOf = (g: THREE.Object3D) => {
      g.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    };
    const low = sizeOf(buildWardrobe180());
    expect(low.x).toBeCloseTo(1.8, 5);
    expect(low.y).toBeCloseTo(2.5, 5);
    expect(low.z).toBeCloseTo(0.6, 5);
    const tall = sizeOf(buildWardrobe180(2.8));
    expect(tall.y).toBeCloseTo(2.8, 5);
  });

  it('keeps wardrobe_180 bounds while exposing cabinet parts', () => {
    const wardrobe = buildWardrobe180();
    wardrobe.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(wardrobe).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.8, 5);
    expect(size.y).toBeCloseTo(2.5, 5);
    expect(size.z).toBeCloseTo(0.6, 5);
    expect(wardrobe.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(3);
    expect(wardrobe.children.some((child) => child.userData.part === 'interior-shelf')).toBe(true);
    expect(wardrobe.children.every((child) => child.name.length > 0 && child.userData.part && child.userData.materialRole)).toBe(true);
  });

  it('builds the split wardrobe as 0.8m low storage plus 1.6m tall storage', () => {
    const wardrobe = buildWardrobeSplit();
    wardrobe.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(wardrobe).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(2.4, 5);
    expect(size.y).toBeCloseTo(2.7, 5);
    expect(size.z).toBeCloseTo(0.8, 5);
    expect(wardrobe.children.some((child) => child.userData.part === 'low-door-panel')).toBe(true);
    expect(wardrobe.children.some((child) => child.userData.part === 'tall-hanging-rod')).toBe(true);
  });

  it('splits bathroom cabinet doors into readable panels', () => {
    const cabinet = buildBathSideCabinetRun({ length: 1.2, depth: 0.5 });
    cabinet.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(cabinet).getSize(new THREE.Vector3());

    expect(size.x).toBeCloseTo(1.2, 2);
    expect(size.y).toBeCloseTo(2.0, 2);
    expect(size.z).toBeCloseTo(0.528, 2);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_front')).toHaveLength(2);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'door_seam')).toHaveLength(1);
    expect(cabinet.children.filter((child) => child.userData.materialRole === 'hardware')).toHaveLength(2);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'plinth')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'end_panel')).toBe(true);
    expect(cabinet.children.some((child) => child.userData.materialRole === 'shelf')).toBe(true);
  });
});

describe('bathroom fixtures', () => {
  it('keeps the vanity mirror against the wall side for the guest-bath rotation', () => {
    const vanity = buildFixture('vanity')!;
    const mirror = vanity.children.find((child) => child.userData.part === 'mirror');

    expect(mirror).toBeDefined();
    expect(mirror!.position.z).toBeCloseTo(-0.14, 5);
    expect(mirror!.userData.materialRole).toBe('mirror');
    expect(vanity.children.some((child) => String(child.userData.part).startsWith('vanity-faucet'))).toBe(false);
  });

  it('builds towel_set with stable local parts, roles, and Blender-aligned bounds', () => {
    const towelSet = buildFixture('towel_set');
    expect(towelSet).not.toBeNull();
    towelSet!.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(towelSet!).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.075, 5);
    expect(size.y).toBeCloseTo(0.45, 5);
    expect(size.z).toBeCloseTo(0.45, 5);
    expect(towelSet!.children.map((child) => ({ part: child.userData.part, materialRole: child.userData.materialRole }))).toEqual([
      { part: 'towel-bar', materialRole: 'hardware' },
      { part: 'towel', materialRole: 'fabric' },
    ]);
    expect(towelSet!.children.every((child) => child.position.x <= 0.01 && child.position.x >= -0.04)).toBe(true);
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
