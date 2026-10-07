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

export function getNightLightMountNormal(fixture: RenderLightingFixture): THREE.Vector3 {
  const hostSide = fixture.mountAnchor?.kind === 'furniture_face' ? fixture.mountAnchor.face : fixture.wallSide;
  const normal = wallSideNormal(hostSide);
  if (!normal) {
    throw new Error(`Night light ${fixture.id} must have a wallSide or furniture_face anchor`);
  }
  return normal;
}

function buildWallMounted(fixture: RenderLightingFixture, glow: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  const furnitureAnchor = fixture.mountAnchor?.kind === 'furniture_face' ? fixture.mountAnchor : undefined;
  const normal = getNightLightMountNormal(fixture);
  const bodyDepth = 0.028;
  const surfaceGap = furnitureAnchor?.surfaceGap ?? 0.003;
  const finishFaceOffset = (furnitureAnchor ? 0 : DEFAULT_WALL_HALF_THICKNESS) + bodyDepth / 2 + surfaceGap;
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
  group.userData = {
    mountKind: furnitureAnchor ? 'furniture_face' : 'wall',
    ...(fixture.wallSide ? { wallSide: fixture.wallSide } : {}),
    ...(furnitureAnchor ? { furnitureId: furnitureAnchor.furnitureId, hostFace: furnitureAnchor.face } : {}),
    mountNormal: normal.toArray(),
  };
  return group;
}

/** One low-glare geometry shared by browser and GLB/export rendering. */
export function buildNightLightVisual(fixture: RenderLightingFixture, glow: THREE.Color): THREE.Group {
  return buildWallMounted(fixture, glow);
}
