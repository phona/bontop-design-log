import * as THREE from 'three';
import type { RenderLightingFixture } from '../types.js';
import { DEFAULT_WALL_HALF_THICKNESS, wallSideNormal } from './WallLampGeometry.js';

function tagged<T extends THREE.Object3D>(object: T, fixture: RenderLightingFixture, part: string, role: string): T {
  object.name = `electrical:${fixture.id}:part=${part}:role=${role}`;
  object.userData = { part, materialRole: role };
  return object;
}

function housingMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.78, metalness: 0.04 });
}

function glowMaterial(glow: THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xfff1d4,
    emissive: glow,
    emissiveIntensity: 1.25,
    roughness: 0.42,
  });
}

function sensorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x393a39, roughness: 0.32, metalness: 0.12 });
}

function buildWallMounted(fixture: RenderLightingFixture, glow: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  const normal = wallSideNormal(fixture.wallSide)!;
  const bodyDepth = 0.028;
  const finishFaceOffset = DEFAULT_WALL_HALF_THICKNESS + bodyDepth / 2 + 0.003;
  group.position.set(
    fixture.position.x + normal.x * finishFaceOffset,
    fixture.position.y,
    fixture.position.z + normal.z * finishFaceOffset,
  );
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  const body = tagged(
    new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, bodyDepth), housingMaterial()),
    fixture, 'wall-body', 'night_light_housing',
  );
  const diffuser = tagged(
    new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.024, 0.006), glowMaterial(glow)),
    fixture, 'downward-diffuser', 'night_light_diffuser',
  );
  diffuser.position.set(0, -0.045, 0.017);

  const baffle = tagged(
    new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.012, 0.028), housingMaterial()),
    fixture, 'glare-baffle', 'night_light_housing',
  );
  baffle.position.set(0, -0.066, 0.03);

  const sensor = tagged(
    new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), sensorMaterial()),
    fixture, 'sensor-window', 'night_light_sensor',
  );
  sensor.position.set(0, 0.047, 0.018);
  group.add(body, diffuser, baffle, sensor);
  group.userData = { mountKind: 'wall', wallSide: fixture.wallSide, mountNormal: normal.toArray() };
  return group;
}

function buildFloorStanding(fixture: RenderLightingFixture, glow: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  group.position.set(fixture.position.x, 0, fixture.position.z);
  const totalHeight = Math.max(0.24, Math.min(0.38, fixture.position.y));
  const baseHeight = 0.014;
  const stemHeight = totalHeight - baseHeight;

  const base = tagged(
    new THREE.Mesh(new THREE.BoxGeometry(0.10, baseHeight, 0.10), housingMaterial()),
    fixture, 'weighted-base', 'night_light_housing',
  );
  base.position.y = baseHeight / 2;

  const stem = tagged(
    new THREE.Mesh(new THREE.BoxGeometry(0.052, stemHeight, 0.052), housingMaterial()),
    fixture, 'bollard-body', 'night_light_housing',
  );
  stem.position.y = baseHeight + stemHeight / 2;

  const diffuser = tagged(
    new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.034, 20), glowMaterial(glow)),
    fixture, 'wraparound-diffuser', 'night_light_diffuser',
  );
  diffuser.position.y = Math.min(0.115, totalHeight * 0.40);

  const sensorBand = tagged(
    new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.012, 20), sensorMaterial()),
    fixture, 'sensor-band', 'night_light_sensor',
  );
  sensorBand.position.y = totalHeight - 0.055;

  group.add(base, stem, diffuser, sensorBand);
  group.userData = { mountKind: 'floor_standing', totalHeight };
  return group;
}

/** One low-glare geometry shared by browser and GLB/export rendering. */
export function buildNightLightVisual(fixture: RenderLightingFixture, glow: THREE.Color): THREE.Group {
  return fixture.wallSide ? buildWallMounted(fixture, glow) : buildFloorStanding(fixture, glow);
}
