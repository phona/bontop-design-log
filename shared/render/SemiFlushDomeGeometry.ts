import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture, SemiFlushDomeConfig } from '../types.js';

function namedPart<T extends THREE.Object3D>(
  object: T,
  fixture: RenderLightingFixture,
  name: string,
  materialRole: string,
): T {
  object.name = 'electrical:' + fixture.id + ':part=' + name + ':role=' + materialRole;
  object.userData = { part: name, materialRole };
  return object;
}

export function getSemiFlushDomeConfig(
  lighting: LightingRenderConfig | undefined,
  fixtureId: string,
): SemiFlushDomeConfig | undefined {
  return lighting?.fixtures.find((fixture): fixture is SemiFlushDomeConfig => (
    fixture.id === fixtureId
    && fixture.type === 'ceiling_light'
    && fixture.style === 'semi_flush_ceiling_light'
  ));
}

/** Retained for any fixture that still declares the historical R12 semi-flush style. */
export function buildSemiFlushDomeVisual(
  fixture: RenderLightingFixture,
  config: SemiFlushDomeConfig,
  glow: THREE.Color,
): THREE.Group {
  const { x, y, z } = fixture.position;
  const group = new THREE.Group();
  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9e9ec,
    emissiveIntensity: 0,
    roughness: 0.26,
    metalness: 0.85,
  });
  const diffuserMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf8f2e6),
    emissive: glow,
    emissiveIntensity: 1.35,
    roughness: 0.44,
    metalness: 0,
  });

  const canopyBottomY = y - config.canopyThickness;
  const diffuserTopY = canopyBottomY - config.stemLength;
  const diffuserBottomY = diffuserTopY - config.diffuserDepth;

  const canopy = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.canopyDiameter / 2, config.canopyDiameter / 2, config.canopyThickness, 48),
      chromeMaterial,
    ),
    fixture,
    'ceiling-mounting-canopy',
    'fixture_metal',
  );
  canopy.position.set(x, y - config.canopyThickness / 2, z);

  const stem = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.stemRadius, config.stemRadius, config.stemLength, 16),
      chromeMaterial,
    ),
    fixture,
    'short-stem',
    'fixture_metal',
  );
  stem.position.set(x, canopyBottomY - config.stemLength / 2, z);

  // Shallow dome diffuser: wider upper rim, narrower lower emitting face.
  const diffuser = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        config.diffuserTopDiameter / 2,
        config.diffuserBottomDiameter / 2,
        config.diffuserDepth,
        64,
      ),
      diffuserMaterial,
    ),
    fixture,
    'shallow-opal-dome-diffuser',
    'fixture_diffuser',
  );
  diffuser.position.set(x, diffuserTopY - config.diffuserDepth / 2, z);

  const rim = namedPart(
    new THREE.Mesh(
      new THREE.TorusGeometry(config.diffuserBottomDiameter / 2, config.rimTubeRadius, 10, 96),
      chromeMaterial,
    ),
    fixture,
    'thin-metal-rim',
    'fixture_metal',
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(x, diffuserBottomY, z);

  group.add(canopy, stem, diffuser, rim);
  group.userData = {
    style: config.style,
    finish: config.finish,
    dimensions: {
      outerWidth: config.outerWidth,
      outerDepth: config.outerDepth,
      totalThickness: config.totalThickness,
      canopyDiameter: config.canopyDiameter,
      canopyThickness: config.canopyThickness,
      stemLength: config.stemLength,
      stemRadius: config.stemRadius,
      diffuserTopDiameter: config.diffuserTopDiameter,
      diffuserBottomDiameter: config.diffuserBottomDiameter,
      diffuserDepth: config.diffuserDepth,
      rimTubeRadius: config.rimTubeRadius,
    },
  };
  return group;
}
