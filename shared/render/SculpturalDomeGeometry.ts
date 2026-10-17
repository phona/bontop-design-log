import * as THREE from 'three';
import type { LightingRenderConfig, RenderLightingFixture, SculpturalDomeConfig } from '../types.js';

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

export function getSculpturalDomeConfig(
  lighting: LightingRenderConfig | undefined,
  fixtureId: string,
): SculpturalDomeConfig | undefined {
  return lighting?.fixtures.find((fixture): fixture is SculpturalDomeConfig => (
    fixture.id === fixtureId
    && fixture.type === 'dome'
    && fixture.style === 'suspended_offset_side_arch_opal_lantern'
  ));
}

function rodBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, direction.length(), 12),
    material,
  );
  rod.position.copy(start).add(end).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return rod;
}

/** Browser and GLB/export share this declared suspended side-frame living-room fixture geometry. */
export function buildSculpturalDomeVisual(
  fixture: RenderLightingFixture,
  config: SculpturalDomeConfig,
  glow: THREE.Color,
): THREE.Group {
  const { x, y, z } = fixture.position;
  const group = new THREE.Group();
  const diffuserBottomY = y - config.diffuserDrop;
  const diffuserTopY = diffuserBottomY + config.diffuserThickness;
  const diffuserCenterY = (diffuserBottomY + diffuserTopY) / 2;
  const archMountY = diffuserBottomY + config.arcFootHeight / 2;
  const lowerDiffuserRadius = config.diffuserBottomDiameter / 2;
  const upperDiffuserRadius = config.diffuserDiameter / 2;
  const bodyRadiusAtHeight = (height: number): number => {
    const t = Math.max(0, Math.min(1, height / config.diffuserThickness));
    return lowerDiffuserRadius + (upperDiffuserRadius - lowerDiffuserRadius) * t;
  };
  const bandBottom = (config.diffuserThickness - config.housingBandHeight) / 2;
  const housingBottomRadius = bodyRadiusAtHeight(bandBottom) + config.housingBandOffset;
  const housingTopRadius = bodyRadiusAtHeight(bandBottom + config.housingBandHeight) + config.housingBandOffset;
  const housingMaterial = new THREE.MeshStandardMaterial({
    color: 0xe4ded2,
    emissiveIntensity: 0,
    roughness: 0.72,
    metalness: 0.04,
  });
  const diffuserMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf7f1e5),
    emissive: glow,
    emissiveIntensity: 1.35,
    roughness: 0.46,
    metalness: 0,
  });
  const bronzeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a6948,
    emissiveIntensity: 0,
    roughness: 0.62,
    metalness: 0.08,
  });

  const housing = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        housingTopRadius,
        housingBottomRadius,
        config.housingBandHeight,
        64,
        1,
        true,
      ),
      housingMaterial,
    ),
    fixture,
    'diffuser-edge-housing',
    'fixture_body',
  );
  housing.position.set(x, diffuserCenterY, z);

  const diffuser = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(
        upperDiffuserRadius,
        lowerDiffuserRadius,
        config.diffuserThickness,
        64,
      ),
      diffuserMaterial,
    ),
    fixture,
    'opal-diffuser',
    'fixture_diffuser',
  );
  diffuser.position.set(x, diffuserCenterY, z);

  const rimTubeRadius = 0.006;
  const rim = namedPart(
    new THREE.Mesh(
      new THREE.TorusGeometry(lowerDiffuserRadius - rimTubeRadius, rimTubeRadius, 10, 96),
      bronzeMaterial,
    ),
    fixture,
    'thin-bronze-diffuser-rim',
    'fixture_metal',
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(x, diffuserBottomY + rimTubeRadius, z);

  const canopy = namedPart(
    new THREE.Mesh(
      new THREE.CylinderGeometry(config.canopyDiameter / 2, config.canopyDiameter / 2, config.canopyThickness, 48),
      bronzeMaterial,
    ),
    fixture,
    'ceiling-mounting-canopy',
    'fixture_metal',
  );
  canopy.position.set(x, y - config.canopyThickness / 2, z);

  const suspensionRods = config.suspensionRods.map((rod, index) => {
    const top = new THREE.Vector3(
      x + rod.ceiling.x,
      y - config.canopyThickness,
      z + rod.ceiling.z,
    );
    const lowerDirection = new THREE.Vector2(rod.diffuser.x, rod.diffuser.z).normalize();
    const elbowRadius = upperDiffuserRadius + config.suspensionRodRadius * 2;
    const elbow = new THREE.Vector3(
      x + lowerDirection.x * elbowRadius,
      diffuserTopY + config.suspensionRodRadius * 2,
      z + lowerDirection.y * elbowRadius,
    );
    const bottom = new THREE.Vector3(
      x + rod.diffuser.x,
      diffuserBottomY + rod.diffuser.heightFromBottom,
      z + rod.diffuser.z,
    );
    const sideMountRadius = bodyRadiusAtHeight(rod.diffuser.heightFromBottom) + config.housingBandOffset;
    const sideMount = new THREE.Vector3(
      x + lowerDirection.x * sideMountRadius,
      diffuserBottomY + rod.diffuser.heightFromBottom,
      z + lowerDirection.y * sideMountRadius,
    );
    const hanger = new THREE.Group();
    hanger.add(
      rodBetween(top, elbow, config.suspensionRodRadius, bronzeMaterial),
      rodBetween(elbow, bottom, config.suspensionRodRadius, bronzeMaterial),
      // A short radial connector makes the exposed support visibly meet the shell.
      rodBetween(sideMount, bottom, config.suspensionRodRadius, bronzeMaterial),
    );
    return namedPart(
      hanger,
      fixture,
      'suspension-rod-' + String(index + 1).padStart(2, '0'),
      'fixture_metal',
    );
  });

  const arcPoints = Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const curveWeight = Math.sin(Math.PI * t);
    return new THREE.Vector3(
      x + (t - 0.5) * config.arcSpan + config.arcOffset.x,
      archMountY + config.arcRise * curveWeight,
      z + config.arcOffset.z + config.arcDepthExtension * curveWeight,
    );
  });
  const arcCurve = new THREE.CatmullRomCurve3(arcPoints, false, 'centripetal');
  const arc = namedPart(
    new THREE.Mesh(
      new THREE.TubeGeometry(arcCurve, 96, config.arcTubeRadius, 12, false),
      bronzeMaterial,
    ),
    fixture,
    'offset-bronze-three-dimensional-arch',
    'fixture_metal',
  );

  const arcFeet = [-1, 1].map((side) => {
    const foot = namedPart(
      new THREE.Mesh(
        new THREE.CylinderGeometry(
          config.arcFootDiameter / 2,
          config.arcFootDiameter / 2,
          config.arcFootHeight,
          20,
        ),
        bronzeMaterial,
      ),
      fixture,
      'arch-foot-' + (side < 0 ? 'west' : 'east'),
      'fixture_metal',
    );
    foot.position.set(
      x + side * config.arcSpan / 2 + config.arcOffset.x,
      archMountY,
      z + config.arcOffset.z,
    );
    return foot;
  });

  group.add(housing, diffuser, rim, canopy, arc, ...arcFeet, ...suspensionRods);
  group.userData = {
    style: config.style,
    finish: config.finish,
    dimensions: {
      outerWidth: config.outerWidth,
      outerDepth: config.outerDepth,
      totalThickness: config.totalThickness,
      diffuserDrop: config.diffuserDrop,
      diffuserDiameter: config.diffuserDiameter,
      diffuserThickness: config.diffuserThickness,
      housingBandHeight: config.housingBandHeight,
      housingBandOffset: config.housingBandOffset,
      canopyDiameter: config.canopyDiameter,
      canopyThickness: config.canopyThickness,
      suspensionRodRadius: config.suspensionRodRadius,
      suspensionRods: config.suspensionRods,
      arcSpan: config.arcSpan,
      arcRise: config.arcRise,
      arcDepthExtension: config.arcDepthExtension,
      arcTubeRadius: config.arcTubeRadius,
      arcFootDiameter: config.arcFootDiameter,
      arcFootHeight: config.arcFootHeight,
      diffuserBottomDiameter: config.diffuserBottomDiameter,
      arcOffset: config.arcOffset,
    },
  };
  return group;
}
