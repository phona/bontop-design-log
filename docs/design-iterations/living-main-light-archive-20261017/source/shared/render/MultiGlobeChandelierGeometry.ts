import * as THREE from 'three';
import type { LightingRenderConfig, MultiGlobeChandelierConfig, RenderLightingFixture } from '../types.js';

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

export function getMultiGlobeChandelierConfig(
  lighting: LightingRenderConfig | undefined,
  fixtureId: string,
): MultiGlobeChandelierConfig | undefined {
  return lighting?.fixtures.find((fixture): fixture is MultiGlobeChandelierConfig => (
    fixture.id === fixtureId
    && fixture.type === 'dome'
    && fixture.style === 'multi_globe_semi_flush_chandelier'
  ));
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  segments = 16,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), segments),
    material,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

/**
 * Globe centre positions in world space. The visual builder and the per-globe
 * light placement share this single source so the lit points can never drift
 * from the rendered globes.
 */
export function getMultiGlobeGlobeCenters(
  fixture: RenderLightingFixture,
  config: MultiGlobeChandelierConfig,
): THREE.Vector3[] {
  const { x, y, z } = fixture.position;
  const centers: THREE.Vector3[] = [];
  for (const tier of config.armTiers) {
    const tilt = (tier.tiltDeg * Math.PI) / 180;
    for (let index = 0; index < tier.count; index += 1) {
      const radians = ((tier.angularOffsetDeg + (360 / tier.count) * index) * Math.PI) / 180;
      centers.push(new THREE.Vector3(
        x + tier.globeRadius * Math.sin(radians),
        y + tier.globeCenterOffsetY - tier.globeRadius * Math.cos(radians) * Math.sin(tilt),
        z + tier.globeRadius * Math.cos(radians) * Math.cos(tilt),
      ));
    }
  }
  return centers;
}

/** Browser and GLB/export share this declared ten-globe semi-flush living-room fixture geometry. */
export function buildMultiGlobeChandelierVisual(
  fixture: RenderLightingFixture,
  config: MultiGlobeChandelierConfig,
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
  const blackMaterial = new THREE.MeshStandardMaterial({
    color: 0x17171b,
    emissiveIntensity: 0,
    roughness: 0.48,
    metalness: 0.3,
  });
  const globeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf8f2e6),
    emissive: glow,
    emissiveIntensity: 1.35,
    roughness: 0.44,
    metalness: 0,
  });

  const canopyBottomY = y - config.canopyThickness;
  const stemBottomY = canopyBottomY - config.stemLength;
  const jointBallCenterY = stemBottomY - config.jointBallDiameter / 2;
  const hubTopY = y + config.hubUpperDiscCenterOffsetY + config.hubUpperDiscThickness / 2;
  const hubLowerDiscTopY = y + config.hubLowerDiscCenterOffsetY + config.hubLowerDiscThickness / 2;
  const hubBottomY = y + config.hubLowerDiscCenterOffsetY - config.hubLowerDiscThickness / 2;
  const finialCenterY = hubBottomY - config.hubFinialDiameter / 2;

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
    cylinderBetween(
      new THREE.Vector3(x, canopyBottomY, z),
      new THREE.Vector3(x, stemBottomY, z),
      config.stemRadius,
      chromeMaterial,
    ),
    fixture,
    'suspension-stem',
    'fixture_metal',
  );

  const jointBall = namedPart(
    new THREE.Mesh(new THREE.SphereGeometry(config.jointBallDiameter / 2, 24, 18), blackMaterial),
    fixture,
    'stem-joint-ball',
    'fixture_body',
  );
  jointBall.position.set(x, jointBallCenterY, z);

  const hubUpperDisc = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.hubUpperDiscDiameter / 2, config.hubUpperDiscDiameter / 2, config.hubUpperDiscThickness, 64),
      blackMaterial,
    ),
    fixture,
    'hub-upper-disc',
    'fixture_body',
  );
  hubUpperDisc.position.set(x, y + config.hubUpperDiscCenterOffsetY, z);

  const hubLowerDisc = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.hubLowerDiscDiameter / 2, config.hubLowerDiscDiameter / 2, config.hubLowerDiscThickness, 64),
      blackMaterial,
    ),
    fixture,
    'hub-lower-disc',
    'fixture_body',
  );
  hubLowerDisc.position.set(x, y + config.hubLowerDiscCenterOffsetY, z);

  const hubFinial = namedPart(
    new THREE.Mesh(new THREE.SphereGeometry(config.hubFinialDiameter / 2, 20, 16), chromeMaterial),
    fixture,
    'hub-finial',
    'fixture_metal',
  );
  hubFinial.position.set(x, finialCenterY, z);

  group.add(canopy, stem, jointBall, hubUpperDisc, hubLowerDisc, hubFinial);

  const armCount = config.armTiers.reduce((total, tier) => total + tier.count, 0);
  const globeCenters = getMultiGlobeGlobeCenters(fixture, config);
  let armIndex = 0;
  let globeIndex = 0;
  for (const tier of config.armTiers) {
    for (let index = 0; index < tier.count; index += 1) {
      armIndex += 1;
      globeIndex += 1;
      const label = String(armIndex).padStart(2, '0');
      const radians = ((tier.angularOffsetDeg + (360 / tier.count) * index) * Math.PI) / 180;
      const globeCenter = globeCenters[globeIndex - 1];
      const armStart = new THREE.Vector3(
        x + tier.armStartRadius * Math.sin(radians),
        y + tier.armStartOffsetY,
        z + tier.armStartRadius * Math.cos(radians),
      );
      const arrival = globeCenter.clone().sub(armStart).normalize();
      const armTip = globeCenter.clone().sub(arrival.clone().multiplyScalar(config.globeDiameter / 2 - 0.008));
      const chordMid = armStart.clone().add(armTip).multiplyScalar(0.5);
      const bow = tier.sweep === 'rise' ? config.armBow : -config.armBow;
      const control = new THREE.Vector3(chordMid.x, chordMid.y + bow, chordMid.z);
      const armCurve = new THREE.QuadraticBezierCurve3(armStart, control, armTip);
      const arm = namedPart(
        new THREE.Mesh(
          new THREE.TubeGeometry(armCurve, 32, config.armTubeRadius, 10, false),
          chromeMaterial,
        ),
        fixture,
        'arm-' + label,
        'fixture_metal',
      );

      const socket = namedPart(
        new THREE.Mesh(
          new THREE.CylinderGeometry(config.socketDiameter / 2, config.socketDiameter / 2, config.socketHeight, 20),
          chromeMaterial,
        ),
        fixture,
        'globe-socket-' + label,
        'fixture_metal',
      );
      socket.position.copy(globeCenter).sub(arrival.clone().multiplyScalar(config.globeDiameter / 2 - config.socketHeight / 2 + 0.006));
      socket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrival);

      const globe = namedPart(
        new THREE.Mesh(new THREE.SphereGeometry(config.globeDiameter / 2, 32, 24), globeMaterial),
        fixture,
        'globe-' + label,
        'fixture_diffuser',
      );
      globe.position.copy(globeCenter);

      group.add(arm, socket, globe);
    }
  }

  group.userData = {
    style: config.style,
    finish: config.finish,
    dimensions: {
      outerWidth: config.outerWidth,
      outerDepth: config.outerDepth,
      totalThickness: config.totalThickness,
      canopyDiameter: config.canopyDiameter,
      canopyThickness: config.canopyThickness,
      stemRadius: config.stemRadius,
      stemLength: config.stemLength,
      jointBallDiameter: config.jointBallDiameter,
      hubUpperDiscDiameter: config.hubUpperDiscDiameter,
      hubUpperDiscThickness: config.hubUpperDiscThickness,
      hubUpperDiscCenterOffsetY: config.hubUpperDiscCenterOffsetY,
      hubDiscGap: config.hubDiscGap,
      hubLowerDiscDiameter: config.hubLowerDiscDiameter,
      hubLowerDiscThickness: config.hubLowerDiscThickness,
      hubLowerDiscCenterOffsetY: config.hubLowerDiscCenterOffsetY,
      hubFinialDiameter: config.hubFinialDiameter,
      armTubeRadius: config.armTubeRadius,
      armBow: config.armBow,
      socketDiameter: config.socketDiameter,
      socketHeight: config.socketHeight,
      globeDiameter: config.globeDiameter,
      armTiers: config.armTiers,
      armCount,
    },
  };
  return group;
}
