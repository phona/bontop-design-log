import * as THREE from 'three';
import type { CloudOrbCeilingLightConfig, LightingRenderConfig, RenderLightingFixture } from '../types.js';

function namedPart<T extends THREE.Object3D>(
  object: T,
  fixture: RenderLightingFixture,
  name: string,
  materialRole: string,
): T {
  object.name = `electrical:${fixture.id}:part=${name}:role=${materialRole}`;
  object.userData = { part: name, materialRole };
  return object;
}

export function getCloudOrbCeilingLightConfig(
  lighting: LightingRenderConfig | undefined,
  fixtureId: string,
): CloudOrbCeilingLightConfig | undefined {
  return lighting?.fixtures.find((fixture): fixture is CloudOrbCeilingLightConfig => (
    fixture.id === fixtureId
    && fixture.type === 'ceiling_light'
    && fixture.style === 'antique_cloud_orb_ceiling_light'
  ));
}

/** Browser and GLB/export share the same owner-approved cloud-lamp preview geometry. */
export function buildCloudOrbCeilingLightVisual(
  fixture: RenderLightingFixture,
  config: CloudOrbCeilingLightConfig,
  glow: THREE.Color,
): THREE.Group {
  const { x, y, z } = fixture.position;
  const baseBottomY = y - config.canopyThickness;
  const group = new THREE.Group();
  const walnutMaterial = new THREE.MeshStandardMaterial({
    color: 0x4c2d1c,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0.02,
  });
  const grainMaterial = new THREE.MeshStandardMaterial({
    color: 0x71452a,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.58,
    metalness: 0,
  });
  const wireMaterial = new THREE.MeshStandardMaterial({
    color: 0xa77b4c,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.36,
    metalness: 0.58,
  });
  // PE is modelled as a diffuse/emissive surface. Do not enable transmission,
  // which would trigger a second full-scene render in the browser.
  const peMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8edda,
    emissive: glow.clone(),
    emissiveIntensity: 0.48,
    roughness: 0.72,
    metalness: 0,
  });

  const base = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.outerDiameter / 2, config.outerDiameter / 2, config.canopyThickness, 64),
      walnutMaterial,
    ),
    fixture,
    'walnut-ceiling-base',
    'fixture_wood',
  );
  base.position.set(x, y - config.canopyThickness / 2, z);

  const baseEdge = namedPart(
    new THREE.Mesh(
      new THREE.TorusGeometry(config.outerDiameter / 2 - 0.006, 0.006, 8, 96),
      grainMaterial,
    ),
    fixture,
    'walnut-base-edge',
    'fixture_wood',
  );
  baseEdge.rotation.x = Math.PI / 2;
  baseEdge.position.set(x, baseBottomY + 0.003, z);
  group.add(base, baseEdge);

  const lobeGeometry = new THREE.SphereGeometry(0.5, 20, 14);
  for (let layer = 0; layer < config.lobeLayers; layer += 1) {
    const layerT = layer / (config.lobeLayers - 1);
    const centerY = baseBottomY - config.lobeHeight / 2 - layerT * (config.diffuserDepth - config.lobeHeight);
    const layerPhase = THREE.MathUtils.degToRad(config.layerOffsetDeg * layer);
    for (let index = 0; index < config.lobesPerLayer; index += 1) {
      const angle = (Math.PI * 2 * index) / config.lobesPerLayer + layerPhase;
      const radialX = Math.sin(angle);
      const radialZ = Math.cos(angle);
      const lobe = namedPart(
        new THREE.Mesh(lobeGeometry, peMaterial),
        fixture,
        `pe-cloud-lobe-${layer + 1}-${String(index + 1).padStart(2, '0')}`,
        'fixture_diffuser',
      );
      lobe.scale.set(config.lobeTangentialDiameter, config.lobeHeight, config.lobeRadialDiameter);
      lobe.rotation.y = angle;
      lobe.position.set(x + radialX * config.cloudRingRadius, centerY, z + radialZ * config.cloudRingRadius);
      group.add(lobe);
    }
  }

  const ballGeometry = new THREE.SphereGeometry(0.5, 24, 18);
  for (const ball of config.hangingBalls) {
    const cordTopY = baseBottomY;
    const ballTopY = cordTopY - ball.cordLength;
    const ballCenterY = ballTopY - ball.diameter / 2;
    const ballX = x + ball.xOffset;
    const ballZ = z + ball.zOffset;
    const cord = namedPart(
      new THREE.Mesh(
        new THREE.CylinderGeometry(config.wireRadius, config.wireRadius, ball.cordLength, 10),
        wireMaterial,
      ),
      fixture,
      `hanging-cord-${ball.id}`,
      'fixture_metal',
    );
    cord.position.set(ballX, cordTopY - ball.cordLength / 2, ballZ);

    const orb = namedPart(
      new THREE.Mesh(ballGeometry, walnutMaterial),
      fixture,
      `hanging-wood-orb-${ball.id}`,
      'fixture_wood',
    );
    orb.scale.set(ball.diameter, ball.diameter, ball.diameter);
    orb.position.set(ballX, ballCenterY, ballZ);
    orb.userData = { ...orb.userData, previewDimension: true };

    const grain = namedPart(
      new THREE.Mesh(
        new THREE.TorusGeometry(ball.diameter * 0.36, 0.0016, 6, 24),
        grainMaterial,
      ),
      fixture,
      `wood-grain-ring-${ball.id}`,
      'fixture_wood',
    );
    grain.rotation.x = Math.PI / 2;
    grain.position.set(ballX, ballCenterY + ball.diameter * 0.08, ballZ);
    group.add(cord, orb, grain);
  }

  const longestBallDrop = Math.max(...config.hangingBalls.map((ball) => ball.cordLength + ball.diameter));
  group.userData = {
    style: config.style,
    finish: config.finish,
    dimensions: {
      outerWidth: config.outerDiameter,
      outerDepth: config.outerDiameter,
      totalThickness: config.canopyThickness + longestBallDrop,
      canopyDiameter: config.outerDiameter,
      canopyThickness: config.canopyThickness,
      diffuserDepth: config.diffuserDepth,
      hangingBallCount: config.hangingBalls.length,
      lobeCount: config.lobesPerLayer * config.lobeLayers,
      proportionalPreview: true,
    },
  };
  return group;
}
