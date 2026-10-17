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

function makeRibbedSocketGeometry(height: number, diameter: number): THREE.LatheGeometry {
  const halfHeight = height / 2;
  const radius = diameter / 2;
  const profile = [
    new THREE.Vector2(0, -halfHeight),
    new THREE.Vector2(radius * 0.72, -halfHeight),
    new THREE.Vector2(radius * 0.9, -halfHeight * 0.82),
    new THREE.Vector2(radius * 0.72, -halfHeight * 0.7),
    new THREE.Vector2(radius, -halfHeight * 0.55),
    new THREE.Vector2(radius * 0.74, -halfHeight * 0.42),
    new THREE.Vector2(radius, -halfHeight * 0.27),
    new THREE.Vector2(radius * 0.74, -halfHeight * 0.14),
    new THREE.Vector2(radius, 0),
    new THREE.Vector2(radius * 0.74, halfHeight * 0.14),
    new THREE.Vector2(radius, halfHeight * 0.28),
    new THREE.Vector2(radius * 0.74, halfHeight * 0.42),
    new THREE.Vector2(radius * 0.96, halfHeight * 0.56),
    new THREE.Vector2(radius * 0.84, halfHeight * 0.72),
    new THREE.Vector2(radius * 0.68, halfHeight),
    new THREE.Vector2(0, halfHeight),
  ];
  return new THREE.LatheGeometry(profile, 32);
}

function makeBowlGeometry(diameter: number, thickness: number): THREE.LatheGeometry {
  const halfHeight = thickness / 2;
  const radius = diameter / 2;
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, -halfHeight),
    new THREE.Vector2(radius * 0.68, -halfHeight),
    new THREE.Vector2(radius * 0.78, -halfHeight * 0.7),
    new THREE.Vector2(radius * 0.94, -halfHeight * 0.18),
    new THREE.Vector2(radius, halfHeight * 0.36),
    new THREE.Vector2(radius, halfHeight),
    new THREE.Vector2(radius * 0.82, halfHeight),
    new THREE.Vector2(radius * 0.75, halfHeight * 0.34),
    new THREE.Vector2(radius * 0.57, -halfHeight * 0.48),
    new THREE.Vector2(0, -halfHeight * 0.48),
  ], 48);
}

function makeTurnedSpindleGeometry(height: number, radius: number): THREE.LatheGeometry {
  const halfHeight = height / 2;
  const beadRadius = radius * 2.2;
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, -halfHeight),
    new THREE.Vector2(radius * 0.72, -halfHeight),
    new THREE.Vector2(radius, -halfHeight * 0.84),
    new THREE.Vector2(radius * 1.4, -halfHeight * 0.68),
    new THREE.Vector2(radius * 0.76, -halfHeight * 0.54),
    new THREE.Vector2(radius * 0.72, -halfHeight * 0.28),
    new THREE.Vector2(beadRadius, -halfHeight * 0.12),
    new THREE.Vector2(beadRadius, halfHeight * 0.12),
    new THREE.Vector2(radius * 0.72, halfHeight * 0.28),
    new THREE.Vector2(radius * 0.76, halfHeight * 0.54),
    new THREE.Vector2(radius * 1.4, halfHeight * 0.68),
    new THREE.Vector2(radius, halfHeight * 0.84),
    new THREE.Vector2(radius * 0.72, halfHeight),
    new THREE.Vector2(0, halfHeight),
  ], 32);
}

function makeTurnedFinialGeometry(diameter: number): THREE.LatheGeometry {
  const halfHeight = diameter / 2;
  const radius = diameter / 2;
  return new THREE.LatheGeometry([
    new THREE.Vector2(0, -halfHeight),
    new THREE.Vector2(radius * 0.24, -halfHeight),
    new THREE.Vector2(radius * 0.38, -halfHeight * 0.76),
    new THREE.Vector2(radius * 0.22, -halfHeight * 0.56),
    new THREE.Vector2(radius * 0.66, -halfHeight * 0.34),
    new THREE.Vector2(radius, -halfHeight * 0.04),
    new THREE.Vector2(radius * 0.76, halfHeight * 0.16),
    new THREE.Vector2(radius * 0.4, halfHeight * 0.34),
    new THREE.Vector2(radius * 0.68, halfHeight * 0.48),
    new THREE.Vector2(radius * 0.52, halfHeight),
    new THREE.Vector2(0, halfHeight),
  ], 32);
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

/** Browser and GLB/export share this declared multi-globe chandelier geometry. */
export function buildMultiGlobeChandelierVisual(
  fixture: RenderLightingFixture,
  config: MultiGlobeChandelierConfig,
  glow: THREE.Color,
): THREE.Group {
  const { x, y, z } = fixture.position;
  const group = new THREE.Group();
  const antiqueFinish = config.finish === 'antique_wood_copper_opal';
  const chromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9e9ec,
    emissiveIntensity: 0,
    roughness: 0.26,
    metalness: 0.85,
  });
  const copperMaterial = new THREE.MeshStandardMaterial({
    color: 0x794324,
    emissiveIntensity: 0,
    roughness: 0.34,
    metalness: 0.72,
  });
  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x75471f,
    emissiveIntensity: 0,
    roughness: 0.82,
    metalness: 0,
  });
  const blackMaterial = new THREE.MeshStandardMaterial({
    color: 0x17171b,
    emissiveIntensity: 0,
    roughness: 0.48,
    metalness: 0.3,
  });
  const metalMaterial = antiqueFinish ? copperMaterial : chromeMaterial;
  const bodyMaterial = antiqueFinish ? copperMaterial : blackMaterial;
  const canopyMaterial = antiqueFinish ? woodMaterial : chromeMaterial;
  const globeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(antiqueFinish ? 0xffefd9 : 0xf8f2e6),
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
      new THREE.CylinderGeometry(
        config.canopyDiameter / 2 * (antiqueFinish ? 0.96 : 1),
        config.canopyDiameter / 2,
        config.canopyThickness,
        48,
      ),
      canopyMaterial,
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
      metalMaterial,
    ),
    fixture,
    'suspension-stem',
    'fixture_metal',
  );

  const jointBall = namedPart(
    new THREE.Mesh(new THREE.SphereGeometry(config.jointBallDiameter / 2, 24, 18), bodyMaterial),
    fixture,
    'stem-joint-ball',
    'fixture_body',
  );
  jointBall.position.set(x, jointBallCenterY, z);

  const hubUpperDisc = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.hubUpperDiscDiameter / 2, config.hubUpperDiscDiameter / 2, config.hubUpperDiscThickness, 64),
      bodyMaterial,
    ),
    fixture,
    'hub-upper-disc',
    'fixture_body',
  );
  hubUpperDisc.position.set(x, y + config.hubUpperDiscCenterOffsetY, z);

  const hubLowerDisc = namedPart(
    new THREE.Mesh(
      antiqueFinish
        ? makeBowlGeometry(config.hubLowerDiscDiameter, config.hubLowerDiscThickness)
        : new THREE.CylinderGeometry(config.hubLowerDiscDiameter / 2, config.hubLowerDiscDiameter / 2, config.hubLowerDiscThickness, 64),
      bodyMaterial,
    ),
    fixture,
    'hub-lower-disc',
    'fixture_body',
  );
  hubLowerDisc.position.set(x, y + config.hubLowerDiscCenterOffsetY, z);

  const hubFinial = namedPart(
    new THREE.Mesh(
      antiqueFinish
        ? makeTurnedFinialGeometry(config.hubFinialDiameter)
        : new THREE.SphereGeometry(config.hubFinialDiameter / 2, 20, 16),
      metalMaterial,
    ),
    fixture,
    'hub-finial',
    'fixture_metal',
  );
  hubFinial.position.set(x, finialCenterY, z);

  group.add(canopy, stem, jointBall, hubUpperDisc, hubLowerDisc, hubFinial);

  // The antique chandelier has a visible decorative drop between the arm hub
  // and lower finial; the former chrome/black fixture keeps its 5mm disc gap.
  const upperDiscBottom = y + config.hubUpperDiscCenterOffsetY - config.hubUpperDiscThickness / 2;
  const lowerDiscTop = y + config.hubLowerDiscCenterOffsetY + config.hubLowerDiscThickness / 2;
  if (antiqueFinish && config.hubDiscGap > 0.02 && upperDiscBottom > lowerDiscTop) {
    const spindleHeight = upperDiscBottom - lowerDiscTop;
    const spindle = namedPart(
      new THREE.Mesh(makeTurnedSpindleGeometry(spindleHeight, config.stemRadius), metalMaterial),
      fixture,
      'hub-drop-spindle',
      'fixture_metal',
    );
    spindle.position.set(x, lowerDiscTop + spindleHeight / 2, z);
    group.add(spindle);
  }

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
      const globeTopY = globeCenter.y + (config.globeHeight ?? config.globeDiameter) / 2;
      const armTip = new THREE.Vector3(globeCenter.x, globeTopY + 0.004, globeCenter.z);
      const chordMid = armStart.clone().add(armTip).multiplyScalar(0.5);
      const bow = tier.sweep === 'rise' ? config.armBow : -config.armBow;
      const control = new THREE.Vector3(chordMid.x, chordMid.y + bow, chordMid.z);
      const armCurve = new THREE.QuadraticBezierCurve3(armStart, control, armTip);
      const arm = namedPart(
        new THREE.Mesh(
          new THREE.TubeGeometry(armCurve, 32, config.armTubeRadius, 10, false),
          metalMaterial,
        ),
        fixture,
        'arm-' + label,
        'fixture_metal',
      );

      const socket = namedPart(
        new THREE.Mesh(
          makeRibbedSocketGeometry(config.socketHeight, config.socketDiameter),
          metalMaterial,
        ),
        fixture,
        'globe-socket-' + label,
        'fixture_metal',
      );
      socket.position.set(globeCenter.x, globeTopY + config.socketHeight / 2, globeCenter.z);

      const globe = namedPart(
        new THREE.Mesh(new THREE.SphereGeometry(config.globeDiameter / 2, 32, 24), globeMaterial),
        fixture,
        'globe-' + label,
        'fixture_diffuser',
      );
      globe.scale.y = (config.globeHeight ?? config.globeDiameter) / config.globeDiameter;
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
      globeHeight: config.globeHeight ?? config.globeDiameter,
      armTiers: config.armTiers,
      armCount,
    },
  };
  return group;
}
