import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { collectExportSet, EXPORT_INCLUDE_TYPES, EXPORT_EXCLUDE_TYPES } from './export-gltf.js';

function mesh(type: string | undefined, objectId?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  if (type !== undefined) m.userData = { type, ...(objectId ? { objectId } : {}) };
  return m;
}

describe('collectExportSet', () => {
  it('includes geometry, doors, ceiling zones, curtains and furniture groups', () => {
    const scene = new THREE.Scene();
    const floor = mesh('floor', 'floor:living_dining');
    const ceiling = mesh('ceiling', 'ceiling:living_dining');
    const ceilingZone = new THREE.Group();
    ceilingZone.userData = { type: 'ceiling_zone', objectId: 'cz:living' };
    ceilingZone.add(mesh('ceiling_zone_solid', 'cz:living:solid'));
    const wall = mesh('wall', 'wall:living_dining:N');
    const door = mesh('door', 'opening:entry');
    const slidingDoor = mesh('sliding_door', 'sliding_door:balcony');
    const curtainRun = mesh('curtain_run', 'curtain:living');
    const curtainSheer = mesh('curtain', 'curtain:living:sheer');
    const glass = mesh('glass_infill', 'glass:bay1');
    const sill = mesh('bay_sill', 'sill:bay1');
    const railing = mesh('railing_run', 'rail:balcony');
    const slidingRun = mesh('sliding_door_run', 'sdr:balcony');
    const region = mesh('floor_region', 'region:kitchen');
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:living:sofa_3seat:0' };
    furniture.add(mesh(undefined));
    scene.add(floor, ceiling, ceilingZone, wall, door, slidingDoor, curtainRun, curtainSheer, glass, sill, railing, slidingRun, region, furniture);

    const set = collectExportSet(scene);
    expect(set).toContain(floor);
    expect(set).toContain(ceiling);
    expect(set).toContain(ceilingZone);
    expect(set).toContain(wall);
    expect(set).toContain(door);
    expect(set).toContain(slidingDoor);
    expect(set).toContain(curtainRun);
    expect(set).toContain(curtainSheer);
    expect(set).toContain(glass);
    expect(set).toContain(sill);
    expect(set).toContain(railing);
    expect(set).toContain(slidingRun);
    expect(set).toContain(region);
    expect(set).toContain(furniture);
  });

  it('excludes annotations, electrical/plumbing markers, platform boundary and untyped helpers', () => {
    const scene = new THREE.Scene();
    const annotation = mesh('annotation', 'electrical:p1');
    const electrical = mesh('electrical', 'electrical:p1');
    const plumbing = mesh('plumbing', 'plumbing:p2');
    const platform = mesh('platform', 'platform_boundary');
    const highlight = mesh('highlight_object');
    const grid = new THREE.GridHelper();
    const untyped = mesh(undefined);
    scene.add(annotation, electrical, plumbing, platform, highlight, grid, untyped);

    const set = collectExportSet(scene);
    expect(set).toHaveLength(0);
  });

  it('does not double-collect children of an included group', () => {
    const scene = new THREE.Scene();
    const furniture = new THREE.Group();
    furniture.userData = { type: 'furniture', objectId: 'furniture:bed:bed_180:0' };
    const inner = mesh('furniture');
    furniture.add(inner);
    scene.add(furniture);

    const set = collectExportSet(scene);
    expect(set).toEqual([furniture]);
  });

  it('keeps include and exclude sets disjoint', () => {
    for (const t of EXPORT_INCLUDE_TYPES) {
      expect(EXPORT_EXCLUDE_TYPES.has(t)).toBe(false);
    }
  });
});
