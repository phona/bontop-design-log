import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InteriorLightingSystem } from './InteriorLightingSystem';
import type { RenderLightingFixture } from '@shared/types';

const foyer: RenderLightingFixture = {
  id: 'light_entry_foyer',
  room: 'living_dining',
  type: 'downlight',
  position: { x: 12.4, y: 2.5, z: 3.35 },
  temperatureK: 3000,
  recessed: true,
  enabled: true,
};

function lightingGroup(scene: THREE.Scene): THREE.Group {
  return scene.children.find((child) => child instanceof THREE.Group) as THREE.Group;
}

describe('InteriorLightingSystem fixture metadata and clearance', () => {
  it('tags fixture groups so child meshes resolve to the electrical object', () => {
    const scene = new THREE.Scene();
    new InteriorLightingSystem(scene, [foyer, {
      ...foyer,
      id: 'track_foyer',
      type: 'track_light',
      position: { x: 8, y: 2.8, z: 3 },
    }]);

    const group = lightingGroup(scene);
    const visuals = group.children.filter((child) => child instanceof THREE.Group) as THREE.Group[];
    expect(visuals).toHaveLength(2);
    expect(visuals.map((visual) => visual.userData)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'lighting_fixture',
        objectId: 'electrical:light_entry_foyer',
        fixtureType: 'downlight',
        roomId: 'living_dining',
      }),
      expect.objectContaining({
        type: 'lighting_fixture',
        objectId: 'electrical:track_foyer',
        fixtureType: 'track_light',
        roomId: 'living_dining',
      }),
    ]));

    const downlight = visuals.find((visual) => visual.userData.objectId === 'electrical:light_entry_foyer')!;
    const child = downlight.children.find((object) => object instanceof THREE.Mesh)!;
    let target: THREE.Object3D | null = child;
    while (target && !target.userData.objectId) target = target.parent;
    expect(target?.userData.objectId).toBe('electrical:light_entry_foyer');
  });

  it('renders recessed foyer hardware at the existing ceiling finish', () => {
    const scene = new THREE.Scene();
    new InteriorLightingSystem(scene, [foyer]);
    const group = lightingGroup(scene);
    const spot = group.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    const visual = group.children.find((child) => child instanceof THREE.Group && child.userData.objectId === 'electrical:light_entry_foyer')!;
    const [body, ring, lens] = visual.children as THREE.Mesh[];

    expect(spot.position.y).toBeCloseTo(2.47, 6);
    expect(body.position.y).toBeCloseTo(2.54, 6);
    expect(ring.position.y).toBeCloseTo(2.498, 6);
    expect(lens.position.y).toBeCloseTo(2.494, 6);
    visual.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(visual);
    expect(2.5 - box.max.y).toBeLessThanOrEqual(0.001);
    expect(visual.userData.objectId).toBe('electrical:light_entry_foyer');
  });

  it('keeps non-recessed downlight clearance unchanged', () => {
    const fixture = { ...foyer, id: 'ordinary_downlight', recessed: undefined, position: { x: 5.7, y: 2.8, z: 4.9 } };
    const scene = new THREE.Scene();
    new InteriorLightingSystem(scene, [fixture]);
    const group = lightingGroup(scene);
    const spot = group.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    expect(spot.position.y).toBeCloseTo(2.75, 6);
  });
});
