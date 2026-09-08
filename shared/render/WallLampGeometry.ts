import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture, WallLampConfig } from '../types.js';

const DEFAULT_WALL_HALF_THICKNESS = 0.06;
const BACKPLATE_DEPTH = 0.008;

const FALLBACK_WALL_LAMP: Omit<WallLampConfig, 'id'> = {
  type: 'wall_lamp',
  style: 'adjustable_short_cylinder',
  finish: 'matte_black',
  backplateDiameter: 0.080,
  headDiameter: 0.060,
  headLength: 0.120,
  armLength: 0.035,
  maxProjection: 0.190,
  control: { kind: 'integral_push_button', location: 'backplate_bottom' },
  adjustability: { yawDeg: [-60, 60], tiltDeg: [-45, 45] },
};

export function wallSideNormal(side: RenderLightingFixture['wallSide']): THREE.Vector3 | null {
  switch (side) {
    case 'north': return new THREE.Vector3(0, 0, -1);
    case 'south': return new THREE.Vector3(0, 0, 1);
    case 'east': return new THREE.Vector3(1, 0, 0);
    case 'west': return new THREE.Vector3(-1, 0, 0);
    default: return null;
  }
}

export function getWallLampConfig(lighting: LightingRenderConfig | undefined, id: string): WallLampConfig {
  return lighting?.fixtures.find((fixture): fixture is WallLampConfig => fixture.id === id && fixture.type === 'wall_lamp')
    ?? { id, ...FALLBACK_WALL_LAMP };
}

function part<T extends THREE.Object3D>(object: T, fixture: RenderLightingFixture, name: string, role: string): T {
  object.name = `electrical:${fixture.id}:part=${name}:role=${role}`;
  object.userData = { part: name, materialRole: role };
  return object;
}

function cylinderAlong(object: THREE.Object3D, direction: THREE.Vector3): void {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
}

export function getWallLampLensPosition(fixture: RenderLightingFixture, config: WallLampConfig): THREE.Vector3 {
  const normal = wallSideNormal(fixture.wallSide) ?? new THREE.Vector3(1, 0, 0);
  const finishFace = new THREE.Vector3(fixture.position.x, fixture.position.y, fixture.position.z).addScaledVector(normal, DEFAULT_WALL_HALF_THICKNESS);
  return finishFace.addScaledVector(normal, BACKPLATE_DEPTH + config.armLength + config.headLength + 0.0005);
}

export function buildWallLampVisual(
  fixture: RenderLightingFixture,
  config: WallLampConfig,
  glow: THREE.Color,
): THREE.Group {
  const group = new THREE.Group();
  const normal = wallSideNormal(fixture.wallSide) ?? new THREE.Vector3(1, 0, 0);
  const finishFace = new THREE.Vector3(fixture.position.x, fixture.position.y, fixture.position.z).addScaledVector(normal, DEFAULT_WALL_HALF_THICKNESS);
  const black = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.78, metalness: 0.24 });
  const blackDetail = new THREE.MeshStandardMaterial({ color: 0x303338, roughness: 0.72, metalness: 0.18 });
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4efe4,
    emissive: glow,
    emissiveIntensity: 1.4,
    roughness: 0.52,
  });

  const backplate = part(new THREE.Mesh(
    new THREE.CylinderGeometry(config.backplateDiameter / 2, config.backplateDiameter / 2, BACKPLATE_DEPTH, 24),
    black,
  ), fixture, 'backplate', 'fixture_metal');
  cylinderAlong(backplate, normal);
  backplate.position.copy(finishFace).addScaledVector(normal, BACKPLATE_DEPTH / 2);

  const arm = part(new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, config.armLength, 16),
    black,
  ), fixture, 'short-arm', 'fixture_metal');
  cylinderAlong(arm, normal);
  arm.position.copy(finishFace).addScaledVector(normal, BACKPLATE_DEPTH + config.armLength / 2);

  const joint = part(new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 18, 12),
    blackDetail,
  ), fixture, 'concealed-pivot', 'adjustment_joint');
  joint.position.copy(finishFace).addScaledVector(normal, BACKPLATE_DEPTH + config.armLength);
  joint.userData = { ...joint.userData, adjustability: config.adjustability };

  const head = part(new THREE.Mesh(
    new THREE.CylinderGeometry(config.headDiameter / 2, config.headDiameter / 2, config.headLength, 24),
    black,
  ), fixture, 'adjustable-head', 'fixture_metal');
  cylinderAlong(head, normal);
  head.position.copy(finishFace).addScaledVector(normal, BACKPLATE_DEPTH + config.armLength + config.headLength / 2);
  head.userData = { ...head.userData, adjustable: true, adjustability: config.adjustability };

  const lens = part(new THREE.Mesh(
    new THREE.CircleGeometry(config.headDiameter * 0.39, 24),
    lensMaterial,
  ), fixture, 'recessed-lens', 'fixture_diffuser');
  lens.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  lens.position.copy(getWallLampLensPosition(fixture, config));

  const button = part(new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16),
    blackDetail,
  ), fixture, 'integral-button', 'fixture_control');
  cylinderAlong(button, normal);
  button.position.copy(finishFace).addScaledVector(normal, BACKPLATE_DEPTH + 0.003);
  button.position.y -= config.backplateDiameter * 0.32;
  button.userData = { ...button.userData, controlKind: config.control.kind, controlLocation: config.control.location };

  group.add(backplate, arm, joint, head, lens, button);
  group.userData = {
    style: config.style,
    finish: config.finish,
    dimensions: {
      backplateDiameter: config.backplateDiameter,
      headDiameter: config.headDiameter,
      headLength: config.headLength,
      armLength: config.armLength,
      maxProjection: config.maxProjection,
    },
    control: config.control,
    adjustability: config.adjustability,
  };
  return group;
}
