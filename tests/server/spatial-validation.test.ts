import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../../shared/render/FixtureFactory.js';
import {
  aabbOverlapDepth,
  aabbIntersects,
  collinearOverlapLength,
  requiredClearance,
  segmentCrossingDepth,
  segmentSolidOverlapDepth,
  validateGlassSegments,
  validateGlassAgainstWalls,
  validateOverlayJunctionSpecs,
  validateOverlayReplacements,
  deriveRuntimeGlassJoins,
  validateRelationshipSpecs,
  validateRuntimeScene,
  validateWallLampMount,
  validateWallTopology,
  type Aabb3,
  type PlanSegment,
} from '../../shared/spatial-validation.js';

const wall = (wallId: string, x1: number, z1: number, x2: number, z2: number): PlanSegment => ({ wallId, x1, z1, x2, z2 });
const box = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Aabb3 => ({ minX, maxX, minY, maxY, minZ, maxZ });

describe('spatial validation primitives', () => {
  it('fails on wall crossing and permits declared L/T junctions', () => {
    const crossing = validateWallTopology([
      wall('a', 0, 0, 2, 2),
      wall('b', 0, 2, 2, 0),
    ]);
    assert.ok(crossing.some((issue) => issue.code === 'wall_intersection_without_junction' && issue.level === 'error'));
    const wrongJunctionKind = validateWallTopology([
      wall('a', 0, 0, 2, 2),
      wall('b', 0, 2, 2, 0),
    ], { junctions: [{ id: 'not-a-cross', type: 't', walls: ['a', 'b'], x: 1, z: 1 }] });
    assert.ok(wrongJunctionKind.some((issue) => issue.code === 'wall_intersection_without_junction' && issue.level === 'error'), 'a T declaration must not suppress a true crossing');

    const legalL = validateWallTopology([
      wall('a', 0, 0, 2, 0),
      wall('b', 0, 0, 0, 2),
    ]);
    assert.equal(legalL.length, 0);

    const legalT = validateWallTopology([
      wall('main', 0, 0, 3, 0),
      wall('branch', 1, 0, 1, 2),
    ], { junctions: [{ id: 't', type: 't', walls: ['main', 'branch'], x: 1, z: 0 }] });
    assert.equal(legalT.length, 0);
  });

  it('reports near miss and rejects undeclared collinear overlap', () => {
    const nearMiss = validateWallTopology([
      wall('a', 0, 0, 1, 0),
      wall('b', 0, 0.006, 1, 0.006),
    ], { nearMissTolerance: 0.01 });
    assert.ok(nearMiss.some((issue) => issue.code === 'wall_near_miss'));

    const overlap = validateWallTopology([
      wall('a', 0, 0, 2, 0),
      wall('b', 1, 0, 3, 0),
    ]);
    assert.ok(overlap.some((issue) => issue.code === 'wall_collinear_overlap' && issue.level === 'error'));
    assert.equal(validateWallTopology([
      wall('a', 0, 0, 2, 0),
      wall('b', 1, 0, 3, 0),
    ], { allowedCollinearOverlaps: [{ walls: ['a', 'b'], max_overlap: 1.01 }] }).length, 0);
    assert.ok(Math.abs(collinearOverlapLength(
      wall('a', 0, 0, 2, 2),
      wall('b', 1, 1, 3, 3),
    ) - Math.SQRT2) < 1e-9, 'diagonal overlap must use Euclidean tangent length');
  });

  it('enforces one suppress replacement and catches duplicate glass paths', () => {
    const elements = [{
      id: 'glass',
      type: 'curtain_run',
      walls: ['w1'],
      parts: [{ wallRefs: ['w1'] }],
    }];
    assert.equal(validateOverlayReplacements(
      ['w1'], elements, [{ wall: 'w1', replacement: 'glass', kind: 'curtain_run' }],
    ).length, 0);
    assert.ok(validateOverlayReplacements(
      ['w1'], elements, [
        { wall: 'w1', replacement: 'glass', kind: 'curtain_run' },
        { wall: 'w1', replacement: 'glass', kind: 'curtain_run' },
      ],
    ).some((issue) => issue.code === 'overlay_replacement_duplicate'));

    const duplicateGlass = validateGlassSegments([
      { ...wall('w1', 0, 0, 2, 0), elementId: 'glass_a' },
      { ...wall('w2', 1, 0, 3, 0), elementId: 'glass_b' },
    ]);
    assert.ok(duplicateGlass.some((issue) => issue.code === 'glass_duplicate_overlap'));
    assert.ok(validateOverlayReplacements(
      ['w1', 'w1'], elements, [{ wall: 'w1', replacement: 'glass', kind: 'curtain_run' }], 'overlay', ['w1'],
    ).some((issue) => issue.code === 'overlay_suppress_duplicate'));
    assert.ok(validateGlassAgainstWalls(
      [{ ...wall('w1', 0, 0, 2, 0), elementId: 'glass' }],
      [wall('solid', 1, 0, 3, 0)],
    ).some((issue) => issue.code === 'glass_wall_overlap'));
    assert.ok(validateGlassAgainstWalls(
      [{ ...wall('w1', 0, 0, 2, 2), elementId: 'glass' }],
      [wall('solid', 0, 2, 2, 0)],
      [],
      'overlay',
      [{ element: 'glass', wall: 'solid', type: 'overlap' }],
    ).some((issue) => issue.code === 'glass_wall_intersection'), 'an overlap declaration must not suppress a crossing');
    assert.ok(validateGlassSegments([
      { ...wall('w1', 0, 0, 2, 2), elementId: 'glass_a' },
      { ...wall('w2', 0, 2, 2, 0), elementId: 'glass_b' },
    ]).some((issue) => issue.code === 'glass_path_intersection'));

    const duplicatePartRefs = validateGlassSegments([
      { ...wall('w1', 0, 0, 2, 0), elementId: 'same_element', partId: 'p1' },
      { ...wall('w1', 0.5, 0, 1.5, 0), elementId: 'same_element', partId: 'p2' },
    ]);
    assert.ok(duplicatePartRefs.some((issue) => issue.code === 'glass_duplicate_overlap'), 'same element/wall duplicate parts remain physical duplicates');

    const joinedPaths = deriveRuntimeGlassJoins([
      { ...wall('w-a', 0, 0, 1, 0), id: 'e:p-a:0:w-a:0', elementId: 'e', partId: 'p-a' },
      { ...wall('w-b', 1, 0, 1, 1), id: 'e:p-b:1:w-b:0', elementId: 'e', partId: 'p-b' },
    ], [
      { wall: 'w-a', replacement: 'e', kind: 'curtain_run', part: 'p-a', join: 'continuous' },
      { wall: 'w-b', replacement: 'e', kind: 'curtain_run', part: 'p-b', join: 'continuous' },
    ]);
    assert.deepEqual(joinedPaths, [{ elementId: 'e', pathA: 'e:p-a:0:w-a:0', pathB: 'e:p-b:1:w-b:0', join: 'continuous' }], 'replacement joins must retain concrete path identities');

    const junctionPath = [{ ...wall('source', 0, 0, 1, 0), elementId: 'e' }];
    assert.equal(validateOverlayJunctionSpecs(
      [{ element: 'e', wall: 'solid', type: 'endpoint', x: 1, z: 0 }],
      junctionPath,
      [wall('solid', 1, 0, 2, 0)],
    ).length, 0, 'only exact shared endpoint closure is accepted');
    const invalidJunctions = validateOverlayJunctionSpecs([
      { element: 'missing', wall: 'solid', type: 'endpoint', x: 1, z: 0 },
      { element: 'e', wall: 'missing', type: 'endpoint', x: 1, z: 0 },
      { element: 'e', wall: 'solid', type: 'endpoint' },
      { element: 'e', wall: 'solid', type: 'overlap', x: 1, z: 0, max_overlap: 0 },
    ], junctionPath, [wall('solid', 1, 0, 2, 0)]);
    assert.ok(invalidJunctions.some((issue) => issue.code === 'overlay_junction_element_unknown'));
    assert.ok(invalidJunctions.some((issue) => issue.code === 'overlay_junction_wall_unknown'));
    assert.ok(invalidJunctions.some((issue) => issue.code === 'overlay_junction_coordinate_missing'));
    assert.ok(invalidJunctions.some((issue) => issue.code === 'overlay_junction_overlap_range_invalid'));
    assert.ok(validateOverlayReplacements(
      ['w1'], elements, [{ wall: 'unknown', replacement: 'glass', kind: 'not_structural' }], 'overlay', ['w1'],
    ).some((issue) => issue.code === 'overlay_replacement_kind_invalid' && issue.level === 'error'));
  });

  it('distinguishes furniture contact from a wall/glass crossing and checks ceiling overlap', () => {
    const solidWall = wall('solid', 0, 0, 0, 3);
    assert.equal(segmentCrossingDepth(box(0, 1, 0, 1, 1, 2), solidWall), undefined, 'flush body is legal contact');
    assert.ok((segmentCrossingDepth(box(-0.08, 1, 0, 1, 1, 2), solidWall) ?? 0) > 0, 'body crossing wall must be visible to verifier');
    const glass = wall('glass', 0, 0, 3, 0);
    assert.ok((segmentCrossingDepth(box(1, 2, 0, 1, -0.1, 0.4), glass) ?? 0) > 0, 'body crossing glass must be visible to verifier');
    assert.ok((segmentSolidOverlapDepth(box(-0.061, 0.1, 0, 1, 1, 2), solidWall, 0.12) ?? 0) > 0, 'runtime wall thickness must expose shallow slab penetration');
    assert.equal(segmentSolidOverlapDepth(box(0.06, 1, 0, 1, 1, 2), solidWall, 0.12), undefined, 'touching the actual wall face is not a penetration');
    assert.equal(aabbIntersects(box(0, 0.5, 0, 1, 0, 0.5), box(0.4, 1, 0.2, 0.8, 0.4, 1)), true, 'ceiling/drop collision uses 3D envelope');
    assert.ok(Math.abs(requiredClearance({ survey_uncertainty: 0.01, fabrication_tolerance: 0.003, installation_tolerance: 0.005, minimum_clearance: 0.002 }) - 0.02) < 1e-9);
    const overlapDepth = aabbOverlapDepth(box(0, 1, 0, 1, 0, 1), box(0.5, 1.5, 0.2, 0.8, 0.1, 0.9));
    assert.ok(overlapDepth && Math.abs(overlapDepth.x - 0.5) < 1e-9 && Math.abs(overlapDepth.y - 0.6) < 1e-9 && Math.abs(overlapDepth.z - 0.8) < 1e-9);
    assert.equal(aabbOverlapDepth(box(0, 1, 0, 1, 0, 1), box(1, 2, 0, 1, 0, 1)), undefined);
  });

  it('fails closed for unknown placed fixture types and validates wall lamp hosts', () => {
    assert.equal(buildFixture('unknown_placed_type'), null);
    const missing = validateWallLampMount({ id: 'lamp', x: 0, z: 0 });
    assert.ok(missing.some((issue) => issue.code === 'lighting_mount_host_missing'));
    const reversed = validateWallLampMount({ id: 'lamp', x: 0, z: 1, wall: wall('solid', 0, 0, 0, 3), wallId: 'solid', wallSide: 'west', normalDot: -1 });
    assert.ok(reversed.some((issue) => issue.code === 'lighting_mount_orientation_reversed'));
    const onGlass = validateWallLampMount({ id: 'lamp', x: 0, z: 1, wall: wall('glass', 0, 0, 0, 3), wallId: 'glass', wallSide: 'west', suppressed: true });
    assert.ok(onGlass.some((issue) => issue.code === 'lighting_mount_glass_forbidden'));
    const dangling = validateWallLampMount({ id: 'lamp', x: 0.2, z: 1, wall: wall('solid', 0, 0, 0, 3), wallId: 'solid', wallSide: 'west' });
    assert.ok(dangling.some((issue) => issue.code === 'lighting_mount_off_wall'));
  });

  it('validates injectable runtime cardinality, exact relationships and glass joins', () => {
    const missingAndUnknown = validateRuntimeScene({
      furniture: [{ id: 'f-a', type: 'cabinet', box: box(0, 1, 0, 1, 0, 1) }, { id: 'f-extra', type: 'cabinet', box: box(2, 3, 0, 1, 0, 1) }],
      expectedFurnitureIds: ['f-a', 'f-b'],
    });
    assert.ok(missingAndUnknown.some((issue) => issue.code === 'furniture_runtime_missing' && issue.entity === 'f-b'));
    assert.ok(missingAndUnknown.some((issue) => issue.code === 'furniture_runtime_unknown' && issue.entity === 'f-extra'));

    const injectedWallCollision = validateRuntimeScene({
      furniture: [{ id: 'f-cross', type: 'cabinet', box: box(-0.01, 0.3, 0, 1, 1, 2) }],
      walls: [{ id: 'wall-runtime', type: 'wall', wallId: 'solid', box: box(-0.06, 0.06, 0, 3, 0, 3), segment: wall('solid', 0, 0, 0, 3), thickness: 0.12 }],
    });
    assert.ok(injectedWallCollision.some((issue) => issue.code === 'furniture_wall_collision' && issue.level === 'error'));
    const shallowRuntimeWallCollision = validateRuntimeScene({
      furniture: [{ id: 'f-shallow', type: 'cabinet', box: box(0.055, 0.30, 0, 1, 1, 2) }],
      walls: [{ id: 'wall-runtime', type: 'wall', wallId: 'solid', box: box(-0.06, 0.06, 0, 3, 0, 3), segment: wall('solid', 0, 0, 0, 3), thickness: 0.12 }],
    });
    const shallowIssue = shallowRuntimeWallCollision.find((issue) => issue.code === 'furniture_wall_collision');
    assert.ok(shallowIssue && shallowIssue.level === 'error', 'entering the wall slab without reaching its centreline must still fail closed');
    assert.ok(Number((shallowIssue.evidence as { penetration_m?: number }).penetration_m) > 0);
    const unknownGlass = validateRuntimeScene({
      furniture: [],
      expectedGlassElementIds: ['known'],
      glass: [{ id: 'runtime-extra', type: 'curtain_run', elementId: 'extra', box: box(0, 1, 0, 1, 0, 1) }],
    });
    assert.ok(unknownGlass.some((issue) => issue.code === 'glass_runtime_missing' && issue.entity === 'known'));
    assert.ok(unknownGlass.some((issue) => issue.code === 'glass_runtime_unknown' && issue.entity === 'extra'));
    assert.ok(validateRelationshipSpecs(
      [{ id: 'bad-global', type: 'attached', objects: ['washer', 'dryer'] }],
      ['furniture:balcony:washer:0', 'furniture:balcony:dryer:1'],
    ).some((issue) => issue.code === 'relationship_instance_unstable'));

    const exactRelation = validateRuntimeScene({
      furniture: [
        { id: 'f-a', type: 'cabinet', box: box(0, 1, 0, 1, 0, 1) },
        { id: 'f-b', type: 'board', box: box(0.8, 1.8, 0, 1, 0, 1) },
        { id: 'f-c', type: 'board', box: box(0.8, 1.8, 0, 1, 0, 1) },
      ],
      relationships: [{ id: 'only-a-b', type: 'attached', objects: ['f-a', 'f-b'] }],
    });
    assert.ok(!exactRelation.some((issue) => issue.entity === 'f-a↔f-b' && issue.code === 'furniture_furniture_collision'));
    assert.ok(exactRelation.some((issue) => issue.entity === 'f-a↔f-c' && issue.code === 'furniture_furniture_collision'));

    const glassPathA = { ...wall('wa', 0, 0, 1, 0), elementId: 'ga' };
    const glassPathB = { ...wall('wb', 1, 0, 2, 0), elementId: 'gb' };
    const legalJoin = validateRuntimeScene({
      furniture: [],
      glass: [
        { id: 'ga-mesh', type: 'curtain_run', elementId: 'ga', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [glassPathA] },
        { id: 'gb-mesh', type: 'railing_run', elementId: 'gb', box: box(0.9, 2, 0, 1, -0.02, 0.02), pathSegments: [glassPathB] },
      ],
    });
    assert.equal(legalJoin.filter((issue) => issue.code === 'glass_runtime_collision').length, 0);
    const duplicateJoin = validateRuntimeScene({
      furniture: [],
      glass: [
        { id: 'ga-mesh', type: 'curtain_run', elementId: 'ga', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [glassPathA] },
        { id: 'gb-mesh', type: 'railing_run', elementId: 'gb', box: box(0.4, 1.6, 0, 1, -0.02, 0.02), pathSegments: [{ ...wall('wb', 0.4, 0, 1.6, 0), elementId: 'gb' }] },
      ],
    });
    assert.ok(duplicateJoin.some((issue) => issue.code === 'glass_runtime_collision'));

    const cornerPathA = { ...wall('corner-a', 0, 0, 1, 0), id: 'corner:a', elementId: 'same-corner' };
    const cornerPathB = { ...wall('corner-b', 1, 0, 1, 1), id: 'corner:b', elementId: 'same-corner' };
    const unjoinedCorner = validateRuntimeScene({
      furniture: [],
      glass: [
        { id: 'corner-mesh-a', type: 'curtain_run', elementId: 'same-corner', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'corner-mesh-b', type: 'curtain_run', elementId: 'same-corner', box: box(0.98, 1.02, 0, 1, 0, 1), pathSegments: [cornerPathB] },
      ],
    });
    assert.ok(unjoinedCorner.some((issue) => issue.code === 'glass_runtime_collision'), 'same-element 90-degree corner needs an explicit configured join');
    const joinedCorner = validateRuntimeScene({
      furniture: [],
      glass: [
        { id: 'corner-mesh-a', type: 'curtain_run', elementId: 'same-corner', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'corner-mesh-b', type: 'curtain_run', elementId: 'same-corner', box: box(0.98, 1.02, 0, 1, 0, 1), pathSegments: [cornerPathB] },
      ],
      glassJoins: [{ elementId: 'same-corner', pathA: 'corner:a', pathB: 'corner:b', join: 'continuous' }],
    });
    assert.equal(joinedCorner.filter((issue) => issue.code === 'glass_runtime_collision').length, 0);
    const samePathMeshes = validateRuntimeScene({
      furniture: [],
      glass: [
        { id: 'one-element-mesh-a', type: 'curtain_run', elementId: 'one-element', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'one-element-mesh-b', type: 'curtain_run', elementId: 'one-element', box: box(0.2, 0.8, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
      ],
    });
    assert.equal(samePathMeshes.filter((issue) => issue.code === 'glass_runtime_collision').length, 0, 'sibling meshes bound to one path are not self-collisions');
  });
});

describe('spatial validation CLI integration', () => {
  it('runs the project adapter, validates runtime lighting/furniture, and emits parseable stable JSON', () => {
    const run = () => {
      const result = spawnSync('npx', ['tsx', 'scripts/verify/spatial/verify-spatial.ts', '--json'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const first = run();
    const second = run();
    assert.equal(first.version, 1);
    assert.equal(first.report.counts.errors, 0);
    const wallCollisions = first.report.issues.filter((issue: { code: string }) => issue.code === 'furniture_wall_collision');
    assert.equal(wallCollisions.length, 0, 'the authorized TV cabinet move must clear the known house furniture penetration');
    assert.equal(first.report.issues.some((issue: { code: string; entity: string }) => issue.code === 'furniture_furniture_collision' && issue.entity.includes('tv_wall_low')), false);
    assert.ok(first.inputs.placedFurniture > 0);
    assert.ok(first.report.issues.some((issue: { code: string }) => issue.code === 'furniture_furniture_contact_tolerance'));
    assert.deepEqual(first.report, second.report);
    assert.deepEqual(first.inputs, second.inputs);

    const outDir = mkdtempSync(join(tmpdir(), 'spatial-validation-'));
    const outputPath = join(outDir, 'report.json');
    const outResult = spawnSync('npx', ['tsx', 'scripts/verify/spatial/verify-spatial.ts', '--json', '--out', outputPath], { encoding: 'utf8' });
    assert.equal(outResult.status, 0, outResult.stderr);
    assert.deepEqual(JSON.parse(outResult.stdout), JSON.parse(readFileSync(outputPath, 'utf8')));
  });
});
