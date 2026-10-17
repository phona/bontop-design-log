import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { parseLightingRenderConfig } from '../../shared/project-render-facts-schema.js';
import type { RenderLightingFixture } from '../../shared/types.js';
import { buildLightingFixtures } from '../../shared/render/LightingFixtureBuilder.js';

test('dining cloud-orb fixture keeps the declared body size and image-proportional three-ball drop', () => {
  const lighting = parseLightingRenderConfig(readFileSync('config/render/lighting.yaml', 'utf8'));
  const config = lighting.fixtures.find((fixture) => fixture.id === 'light_dining_pendant');
  assert.ok(config && config.type === 'ceiling_light');
  assert.equal(config.style, 'antique_cloud_orb_ceiling_light');

  const fixture: RenderLightingFixture = {
    id: 'light_dining_pendant',
    room: 'living_dining',
    type: 'ceiling_light',
    position: { x: 9.25, y: 2.8, z: 3.65 },
    temperatureK: 3000,
    enabled: true,
    circuit: 'dining',
  };
  const built = buildLightingFixtures([fixture], lighting);
  const object = built.fixtures.get('electrical:light_dining_pendant');
  assert.ok(object);
  object.updateMatrixWorld(true);

  const parts: string[] = [];
  object.traverse((child) => {
    if (typeof child.userData.part === 'string') parts.push(child.userData.part);
  });
  assert.equal(parts.filter((part) => part.startsWith('pe-cloud-lobe-')).length, 20);
  assert.equal(parts.filter((part) => part.startsWith('hanging-cord-')).length, 3);
  assert.equal(parts.filter((part) => part.startsWith('hanging-wood-orb-')).length, 3);
  assert.equal(object.userData.style, 'antique_cloud_orb_ceiling_light');
  assert.equal(object.userData.dimensions.proportionalPreview, true);
  assert.ok(Math.abs(object.userData.dimensions.totalThickness - 0.486) < 1e-9);

  const bounds = new THREE.Box3().setFromObject(object);
  const excessParts: Array<{ part: string; minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  object.traverse((child) => {
    if (typeof child.userData.part !== 'string') return;
    const partBounds = new THREE.Box3().setFromObject(child);
    if (partBounds.min.x < 9.0 - 1e-6 || partBounds.max.x > 9.5 + 1e-6) {
      excessParts.push({ part: child.userData.part, minX: partBounds.min.x, maxX: partBounds.max.x, minZ: partBounds.min.z, maxZ: partBounds.max.z });
    }
  });
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).x - 0.5) < 1e-6, `AABB x width ${bounds.getSize(new THREE.Vector3()).x}; excess ${JSON.stringify(excessParts)}`);
  assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).z - 0.5) < 1e-6, `AABB z width ${bounds.getSize(new THREE.Vector3()).z}`);
  assert.ok(Math.abs(bounds.max.y - 2.8) < 1e-6);
  assert.ok(Math.abs(bounds.min.y - 2.314) < 1e-6);
  assert.equal(built.group.getObjectByProperty('type', 'PointLight'), undefined, 'GLB/export builder must not add runtime lights');
});
