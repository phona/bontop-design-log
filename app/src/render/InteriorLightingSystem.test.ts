import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InteriorLightingSystem } from './InteriorLightingSystem';
import type { RenderLightingFixture } from '@shared/types';

const FIXTURES: RenderLightingFixture[] = [
  { id: 'p1', room: 'living_dining', type: 'pendant', position: { x: 8.5, y: 2.8, z: 3.35 }, temperatureK: 3000, enabled: true },
  { id: 'p2', room: 'living_dining', type: 'pendant', position: { x: 10.3, y: 2.8, z: 7.0 }, temperatureK: 3000, enabled: true },
  { id: 'p3', room: 'master_bedroom', type: 'pendant', position: { x: 2.6, y: 2.8, z: 7.6 }, temperatureK: 3000, enabled: true },
  { id: 'd1', room: 'master_bedroom', type: 'dome', position: { x: 2.6, y: 2.55, z: 7.6 }, temperatureK: 3000, enabled: true },
  { id: 'w1', room: 'master_bedroom', type: 'wall_lamp', position: { x: 4.2, y: 1.6, z: 7.2 }, temperatureK: 3000, enabled: true },
  { id: 's1', room: 'living_dining', type: 'downlight', position: { x: 5.7, y: 2.8, z: 4.9 }, temperatureK: 3000, enabled: true },
  { id: 't1', room: 'living_dining', type: 'led_strip', position: { x: 7.35, y: 2.0, z: 7.0 }, temperatureK: 3000, enabled: true },
  { id: 'k1', room: 'kitchen', type: 'dome', position: { x: 9.0, y: 2.55, z: 1.2 }, temperatureK: 4000, enabled: true },
  { id: 'off', room: 'living_dining', type: 'dome', position: { x: 0, y: 0, z: 0 }, temperatureK: 3000, enabled: false },
];

function makeSystem(fixtures = FIXTURES) {
  const scene = new THREE.Scene();
  return { scene, sys: new InteriorLightingSystem(scene, fixtures) };
}

function lights(scene: THREE.Scene): THREE.Light[] {
  const group = scene.children.find((child) => child instanceof THREE.Group) as THREE.Group;
  return group.children.filter((child) => child instanceof THREE.Light) as THREE.Light[];
}

describe('InteriorLightingSystem', () => {
  it('creates enabled projection fixtures only', () => {
    expect(makeSystem().sys.lightCount).toBe(8);
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
    const light4000 = lights(scene).find((light) => Math.abs(light.position.x - 9) < 0.01)!;
    expect(light3000.color.getHex()).not.toBe(light4000.color.getHex());
  });

  it('keeps pendant shadows limited to two', () => {
    expect(makeSystem().sys.shadowLightCount).toBe(2);
  });

  it('toggles global visibility', () => {
    const { scene, sys } = makeSystem();
    sys.toggle();
    expect(lights(scene).every((light) => light.visible)).toBe(true);
    sys.toggle();
    expect(lights(scene).every((light) => !light.visible)).toBe(true);
  });

  it('only toggles the requested room', () => {
    const { scene, sys } = makeSystem();
    sys.setOn(true);
    sys.setRoomLights('kitchen', false);
    const kitchenLight = lights(scene).find((light) => Math.abs(light.position.x - 9) < 0.01)!;
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
