import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InteriorLightingSystem } from './InteriorLightingSystem';
import type { RenderLightingFixture } from '@shared/types';

const FIXTURES: RenderLightingFixture[] = [
  { id: 'p1', room: 'living_dining', type: 'pendant', position: { x: 8.5, y: 2.8, z: 3.35 }, temperatureK: 3000, enabled: true },
  { id: 'p2', room: 'living_dining', type: 'pendant', position: { x: 10.3, y: 2.8, z: 7.0 }, temperatureK: 3000, enabled: true },
  { id: 'track', room: 'living_dining', type: 'track_light', position: { x: 10.8, y: 2.8, z: 7.15 }, temperatureK: 3000, enabled: true, heads: 5 },
  { id: 'p3', room: 'master_bedroom', type: 'pendant', position: { x: 2.6, y: 2.8, z: 7.6 }, temperatureK: 3000, enabled: true },
  { id: 'd1', room: 'master_bedroom', type: 'dome', position: { x: 2.6, y: 2.55, z: 7.6 }, temperatureK: 3000, enabled: true },
  { id: 'w1', room: 'master_bedroom', type: 'wall_lamp', position: { x: 4.2, y: 1.6, z: 7.2 }, temperatureK: 3000, enabled: true },
  { id: 's1', room: 'living_dining', type: 'downlight', position: { x: 5.7, y: 2.8, z: 4.9 }, temperatureK: 3000, enabled: true },
  { id: 'entry_foyer', room: 'entry_garden', type: 'downlight', position: { x: 11.2, y: 2.5, z: 2.9 }, temperatureK: 3000, enabled: true },
  { id: 't1', room: 'living_dining', type: 'led_strip', position: { x: 7.35, y: 2.0, z: 7.0 }, temperatureK: 3000, enabled: true },
  { id: 'k1', room: 'kitchen', type: 'dome', position: { x: 9.0, y: 2.55, z: 1.2 }, temperatureK: 4000, enabled: true },
  { id: 'off', room: 'living_dining', type: 'dome', position: { x: 0, y: 0, z: 0 }, temperatureK: 3000, enabled: false },
];

function makeSystem(fixtures = FIXTURES) {
  const scene = new THREE.Scene();
  return { scene, sys: new InteriorLightingSystem(scene, fixtures) };
}

function lightingGroup(scene: THREE.Scene): THREE.Group {
  return scene.children.find((child) => child instanceof THREE.Group) as THREE.Group;
}

function lights(scene: THREE.Scene): THREE.Light[] {
  const group = lightingGroup(scene);
  const result: THREE.Light[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Light) result.push(object);
  });
  return result;
}

describe('InteriorLightingSystem', () => {
  it('creates enabled projection fixtures only', () => {
    expect(makeSystem().sys.lightCount).toBe(10);
  });

  it('creates five fixed SpotLights for the track fixture and counts one entry', () => {
    const { scene, sys } = makeSystem();
    const trackLights = lights(scene).filter((light) => light instanceof THREE.SpotLight && Math.abs(light.position.y - 2.72) < 0.001);
    expect(trackLights).toHaveLength(5);
    expect(trackLights.map((light) => light.position.x)).toEqual([9, 9.9, 10.8, 11.7, 12.6].map((value) => expect.closeTo(value, 5)));
    expect(trackLights.every((light) => !light.castShadow)).toBe(true);
    expect(sys.lightCount).toBe(10);
  });

  it('renders the foyer downlight below the existing ceiling bottom', () => {
    const { scene } = makeSystem();
    const foyerLight = lights(scene).find((light) => Math.abs(light.position.x - 11.2) < 0.01)!;
    expect(foyerLight.position.y).toBeLessThan(2.5);
    const foyerVisual = lightingGroup(scene).children.find((child) => child instanceof THREE.Group && child.children.some((part) => part instanceof THREE.Mesh && part.position.x === 11.2));
    expect(foyerVisual).toBeDefined();
    expect(foyerVisual!.children.filter((part) => part instanceof THREE.Mesh)).toHaveLength(3);
  });

  it('uses final projection anchors for THREE light positions', () => {
    const { scene } = makeSystem();
    const strip = lights(scene).find((light) => Math.abs(light.position.x - 7.35) < 0.01)!;
    const dome = lights(scene).find((light) => Math.abs(light.position.x - 2.6) < 0.01 && light instanceof THREE.PointLight)!;
    expect(strip.position.toArray()).toEqual([7.35, 2, 7]);
    expect(dome.position.y).toBe(2.55);
  });

  it('uses Kelvin input for distinct 3000K and 4000K colors', () => {
    const { scene } = makeSystem();
    const light3000 = lights(scene).find((light) => Math.abs(light.position.x - 8.5) < 0.01)!;
    const light4000 = lights(scene).find((light) => Math.abs(light.position.x - 9) < 0.01 && light instanceof THREE.PointLight)!;
    expect(light3000.color.getHex()).not.toBe(light4000.color.getHex());
  });

  it('keeps pendant shadows limited to two', () => {
    expect(makeSystem().sys.shadowLightCount).toBe(2);
  });

  it('toggles global visibility', () => {
    const { scene, sys } = makeSystem();
    expect(lights(scene).every((light) => !light.visible)).toBe(true);
    sys.toggle();
    expect(lights(scene).every((light) => light.visible)).toBe(true);
    sys.toggle();
    expect(lights(scene).every((light) => !light.visible)).toBe(true);
  });

  it('keeps fixture geometry visible while changing its emissive state', () => {
    const { scene, sys } = makeSystem();
    const materials: THREE.MeshStandardMaterial[] = [];
    lightingGroup(scene).traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial && object.material.emissiveIntensity > 0) materials.push(object.material);
    });
    expect(materials.length).toBeGreaterThan(0);
    sys.setOn(true);
    const onIntensity = materials.map((material) => material.emissiveIntensity);
    sys.setOn(false);
    expect(lightingGroup(scene).children.filter((child) => child instanceof THREE.Group).every((child) => child.visible)).toBe(true);
    expect(materials.every((material, index) => material.emissiveIntensity < onIntensity[index])).toBe(true);
  });

  it('only toggles the requested room', () => {
    const { scene, sys } = makeSystem();
    sys.setOn(true);
    sys.setRoomLights('kitchen', false);
    const kitchenLight = lights(scene).find((light) => Math.abs(light.position.x - 9) < 0.01 && light instanceof THREE.PointLight)!;
    expect(kitchenLight.visible).toBe(false);
    expect(lights(scene).filter((light) => light !== kitchenLight).every((light) => light.visible)).toBe(true);
  });

  it('syncs to solar state and disposes its group', () => {
    const { scene, sys } = makeSystem();
    sys.syncSolar({ isNight: false, altitudeDeg: 45 });
    expect(sys.isOn).toBe(false);
    sys.syncSolar({ isNight: true, altitudeDeg: -20 });
    expect(sys.isOn).toBe(true);
    sys.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
