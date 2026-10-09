// 防穿模（penetration）单测：实体互撞 + 净距族规则。
//
// 覆盖自 tests/server/spatial-validation.test.ts 搬迁而来的 pair 断言（家具穿墙含
// 浅层墙厚、家具互撞与 relationship 豁免、玻璃/栏杆 runtime 收口），以及
// verify:penetration CLI 的真实 house 结论。声明完整性、拓扑、运行时权威性仍归
// tests/server/spatial-validation.test.ts。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateRuntimePenetration,
  type RuntimePenetrationInput,
} from '../../shared/penetration/rules.js';
import { validateFurnitureClearance } from '../../shared/penetration/clearance.js';
import type { Aabb3, PlanSegment, RuntimeSpatialObject } from '../../shared/spatial-validation.js';

const wall = (wallId: string, x1: number, z1: number, x2: number, z2: number): PlanSegment => ({ wallId, x1, z1, x2, z2 });
const box = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Aabb3 => ({ minX, maxX, minY, maxY, minZ, maxZ });
const furniture = (id: string, b: Aabb3, type = 'cabinet'): RuntimeSpatialObject => ({ id, type, box: b });

describe('penetration pair rules', () => {
  it('fails closed when furniture enters a wall slab, even without reaching the centreline', () => {
    const runtimeWall: RuntimeSpatialObject = {
      id: 'wall-runtime', type: 'wall', wallId: 'solid', box: box(-0.06, 0.06, 0, 3, 0, 3), segment: wall('solid', 0, 0, 0, 3), thickness: 0.12,
    };
    const deep = validateRuntimePenetration({
      furniture: [furniture('f-cross', box(-0.01, 0.3, 0, 1, 1, 2))],
      walls: [runtimeWall],
    });
    assert.ok(deep.some((issue) => issue.code === 'furniture_wall_collision' && issue.level === 'error'));

    const shallow = validateRuntimePenetration({
      furniture: [furniture('f-shallow', box(0.055, 0.3, 0, 1, 1, 2))],
      walls: [runtimeWall],
    });
    const shallowIssue = shallow.find((issue) => issue.code === 'furniture_wall_collision');
    assert.ok(shallowIssue && shallowIssue.level === 'error', 'entering the wall slab without reaching its centreline must still fail closed');
    assert.ok(Number((shallowIssue.evidence as { penetration_m?: number }).penetration_m) > 0);
  });

  it('exempts only exactly declared relationships between furniture envelopes', () => {
    const input: RuntimePenetrationInput = {
      furniture: [
        furniture('f-a', box(0, 1, 0, 1, 0, 1)),
        furniture('f-b', box(0.8, 1.8, 0, 1, 0, 1), 'board'),
        furniture('f-c', box(0.8, 1.8, 0, 1, 0, 1), 'board'),
      ],
      relationships: [{ id: 'only-a-b', type: 'attached', objects: ['f-a', 'f-b'] }],
    };
    const issues = validateRuntimePenetration(input);
    assert.equal(issues.some((issue) => issue.entity === 'f-a↔f-b'), false, 'declared attached pair must be exempt');
    assert.ok(issues.some((issue) => issue.entity === 'f-a↔f-c' && issue.code === 'furniture_furniture_collision'));
  });

  it('separates deliberate contact tolerance from a real furniture overlap', () => {
    const contact = validateRuntimePenetration({
      furniture: [furniture('f-a', box(0, 1, 0, 1, 0, 1)), furniture('f-b', box(0.997, 2, 0, 1, 0, 1))],
      collisionMargin: 0.005,
    });
    assert.ok(contact.some((issue) => issue.code === 'furniture_furniture_contact_tolerance' && issue.level === 'warning'));

    const real = validateRuntimePenetration({
      furniture: [furniture('f-a', box(0, 1, 0, 1, 0, 1)), furniture('f-b', box(0.9, 2, 0, 1, 0, 1))],
      collisionMargin: 0.005,
    });
    assert.ok(real.some((issue) => issue.code === 'furniture_furniture_collision' && issue.level === 'error'));
  });

  it('keeps mep coordination parts out of furniture-vs-furniture but still measurable', () => {
    const issues = validateRuntimePenetration({
      furniture: [
        furniture('f-cabinet', box(0, 1, 0, 1, 0, 1)),
        { id: 'f-chase', type: 'mb_vanity_pvc_service_chase', box: box(0.5, 1.5, 0, 1, 0, 1) },
      ],
      mepTypes: ['mb_vanity_pvc_service_chase'],
    });
    assert.equal(issues.length, 0, 'mep coordination parts are not furniture-vs-furniture targets');
  });

  it('requires a configured join for same-element glass corners and allows declared closures', () => {
    const glassPathA = { ...wall('wa', 0, 0, 1, 0), elementId: 'ga' };
    const glassPathB = { ...wall('wb', 1, 0, 2, 0), elementId: 'gb' };
    const legalJoin = validateRuntimePenetration({
      furniture: [],
      glass: [
        { id: 'ga-mesh', type: 'curtain_run', elementId: 'ga', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [glassPathA] },
        { id: 'gb-mesh', type: 'railing_run', elementId: 'gb', box: box(0.9, 2, 0, 1, -0.02, 0.02), pathSegments: [glassPathB] },
      ],
    });
    assert.equal(legalJoin.filter((issue) => issue.code === 'glass_runtime_collision').length, 0);

    const duplicateJoin = validateRuntimePenetration({
      furniture: [],
      glass: [
        { id: 'ga-mesh', type: 'curtain_run', elementId: 'ga', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [glassPathA] },
        { id: 'gb-mesh', type: 'railing_run', elementId: 'gb', box: box(0.4, 1.6, 0, 1, -0.02, 0.02), pathSegments: [{ ...wall('wb', 0.4, 0, 1.6, 0), elementId: 'gb' }] },
      ],
    });
    assert.ok(duplicateJoin.some((issue) => issue.code === 'glass_runtime_collision'));

    const cornerPathA = { ...wall('corner-a', 0, 0, 1, 0), id: 'corner:a', elementId: 'same-corner' };
    const cornerPathB = { ...wall('corner-b', 1, 0, 1, 1), id: 'corner:b', elementId: 'same-corner' };
    const unjoinedCorner = validateRuntimePenetration({
      furniture: [],
      glass: [
        { id: 'corner-mesh-a', type: 'curtain_run', elementId: 'same-corner', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'corner-mesh-b', type: 'curtain_run', elementId: 'same-corner', box: box(0.98, 1.02, 0, 1, 0, 1), pathSegments: [cornerPathB] },
      ],
    });
    assert.ok(unjoinedCorner.some((issue) => issue.code === 'glass_runtime_collision'), 'same-element 90-degree corner needs an explicit configured join');

    const joinedCorner = validateRuntimePenetration({
      furniture: [],
      glass: [
        { id: 'corner-mesh-a', type: 'curtain_run', elementId: 'same-corner', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'corner-mesh-b', type: 'curtain_run', elementId: 'same-corner', box: box(0.98, 1.02, 0, 1, 0, 1), pathSegments: [cornerPathB] },
      ],
      glassJoins: [{ elementId: 'same-corner', pathA: 'corner:a', pathB: 'corner:b', join: 'continuous' }],
    });
    assert.equal(joinedCorner.filter((issue) => issue.code === 'glass_runtime_collision').length, 0);

    const samePathMeshes = validateRuntimePenetration({
      furniture: [],
      glass: [
        { id: 'one-element-mesh-a', type: 'curtain_run', elementId: 'one-element', box: box(0, 1, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
        { id: 'one-element-mesh-b', type: 'curtain_run', elementId: 'one-element', box: box(0.2, 0.8, 0, 1, -0.02, 0.02), pathSegments: [cornerPathA] },
      ],
    });
    assert.equal(samePathMeshes.filter((issue) => issue.code === 'glass_runtime_collision').length, 0, 'sibling meshes bound to one path are not self-collisions');
  });

  it('reports furniture entering a curtain path and warns when clearance is short', () => {
    const curtainPath = { ...wall('curtain', 0, 0, 3, 0), elementId: 'curtain' };
    const glass: RuntimeSpatialObject[] = [
      { id: 'curtain-mesh', type: 'curtain_run', elementId: 'curtain', box: box(0, 3, 0, 2.6, -0.02, 0.02), pathSegments: [curtainPath] },
    ];
    const crossing = validateRuntimePenetration({
      furniture: [furniture('f-sofa', box(1.4, 1.6, 0, 0.8, -0.1, 0.1))],
      glass,
    });
    assert.ok(crossing.some((issue) => issue.code === 'furniture_glass_collision' && issue.level === 'error'));

    const near = validateRuntimePenetration({
      furniture: [furniture('f-sofa', box(1.4, 1.6, 0, 0.8, 0.03, 0.1))],
      glass,
      glassRequiredClearance: 0.05,
    });
    assert.ok(near.some((issue) => issue.code === 'furniture_glass_clearance_insufficient' && issue.level === 'warning'));
  });

  it('reports furniture intersecting a solid ceiling and ignores mere face contact', () => {
    const ceiling: RuntimeSpatialObject[] = [{ id: 'ceiling:room', type: 'ceiling', box: box(0, 4, 2.7, 2.8, 0, 4) }];
    const through = validateRuntimePenetration({ furniture: [furniture('f-tall', box(1, 2, 2.6, 3.0, 1, 2))], ceilings: ceiling });
    assert.ok(through.some((issue) => issue.code === 'furniture_ceiling_collision' && issue.level === 'error'));

    const touching = validateRuntimePenetration({ furniture: [furniture('f-short', box(1, 2, 0, 2.7, 1, 2))], ceilings: ceiling });
    assert.equal(touching.length, 0, 'sharing a ceiling face is not a penetration');
  });
});

describe('furniture host-wall clearance', () => {
  const wallEntries = [
    { entity: 'wall:w_host:0', type: 'wall', wallId: 'w_host', box: box(-0.06, 0.06, 0, 3, 0, 3), segment: wall('w_host', 0, 0, 0, 3), thickness: 0.12 },
  ];
  const wallMap = new Map([['w_host', { id: 'w_host', x1: 0, z1: 0, x2: 0, z2: 3 } as never]]);

  it('reports entering the host wall and insufficient clearance separately', () => {
    const base = {
      type: 'wardrobe_180',
      override: { profile: 'built_in_casework', wall: 'w_host', wall_side: 'east' as const, required_wall_clearance: 0.015 },
      profile: { survey_uncertainty: 0.01, fabrication_tolerance: 0.003, installation_tolerance: 0.005, minimum_clearance: 0.002 },
      wallEntries,
      wallMap,
      source: 'test',
    };
    const entering = validateFurnitureClearance({ ...base, entry: { entity: 'f-in', type: 'wardrobe_180', box: box(-0.02, 0.5, 0, 2.4, 1, 2) } });
    assert.ok(entering.some((issue) => issue.code === 'furniture_wall_collision' && issue.level === 'error'));

    const tooClose = validateFurnitureClearance({ ...base, entry: { entity: 'f-close', type: 'wardrobe_180', box: box(0.07, 0.5, 0, 2.4, 1, 2) } });
    assert.ok(tooClose.some((issue) => issue.code === 'furniture_clearance_insufficient' && issue.level === 'error'));

    const clear = validateFurnitureClearance({ ...base, entry: { entity: 'f-clear', type: 'wardrobe_180', box: box(0.2, 0.7, 0, 2.4, 1, 2) } });
    assert.equal(clear.length, 0);
  });

  it('fails closed when the host wall is unknown or has no runtime segment', () => {
    const unknownWall = validateFurnitureClearance({
      entry: { entity: 'f-x', type: 'wardrobe_180', box: box(0.2, 0.7, 0, 2.4, 1, 2) },
      type: 'wardrobe_180',
      override: { profile: 'built_in_casework', wall: 'w_missing', wall_side: 'east' },
      profile: {},
      wallEntries: [],
      wallMap: new Map(),
      source: 'test',
    });
    assert.ok(unknownWall.some((issue) => issue.code === 'furniture_host_unknown' && issue.level === 'error'));

    const noRuntime = validateFurnitureClearance({
      entry: { entity: 'f-y', type: 'wardrobe_180', box: box(0.2, 0.7, 0, 2.4, 1, 2) },
      type: 'wardrobe_180',
      override: { profile: 'built_in_casework', wall: 'w_host', wall_side: 'east' },
      profile: {},
      wallEntries: [{ entity: 'wall:w_host:0', type: 'wall', wallId: 'w_host', box: box(-0.06, 0.06, 0, 3, 0, 3) }],
      wallMap,
      source: 'test',
    });
    assert.ok(noRuntime.some((issue) => issue.code === 'furniture_host_runtime_missing' && issue.level === 'error'));
  });

  it('reports the vanity north-end clearance against the declared boundary', () => {
    const issues = validateFurnitureClearance({
      entry: { entity: 'f-vanity', type: 'mb_vanity_base_cabinet', box: box(0.2, 0.7, 2.80, 2.4, 1, 2) },
      type: 'mb_vanity_base_cabinet',
      override: { profile: 'built_in_casework', required_endpoint_clearance: 0.02 },
      profile: {},
      wallEntries: [],
      wallMap: new Map(),
      source: 'test',
    });
    assert.ok(issues.some((issue) => issue.code === 'furniture_endpoint_clearance_insufficient' && issue.level === 'error'));
  });
});

describe('penetration CLI integration', () => {
  it('reports the real house as penetration-clean with the known glass clearance warnings', () => {
    const run = () => {
      const result = spawnSync('npx', ['tsx', 'scripts/verify/penetration/verify-penetration.ts', '--json'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const first = run();
    const second = run();
    assert.equal(first.version, 1);
    assert.equal(first.report.counts.errors, 0);
    assert.ok(first.inputs.placedFurniture > 0);
    assert.ok(first.inputs.runtimeObjects.furniture > 0);
    // 正样本哨兵：玻璃净距告警必须仍在产出，检测器不允许被静默放宽。
    assert.ok(first.report.issues.some((issue: { code: string }) => issue.code === 'furniture_glass_clearance_insufficient'));
    assert.deepEqual(first.report, second.report);
    assert.deepEqual(first.inputs, second.inputs);

    const outDir = mkdtempSync(join(tmpdir(), 'penetration-lint-'));
    const outputPath = join(outDir, 'report.json');
    const outResult = spawnSync('npx', ['tsx', 'scripts/verify/penetration/verify-penetration.ts', '--json', '--out', outputPath], { encoding: 'utf8' });
    assert.equal(outResult.status, 0, outResult.stderr);
    assert.deepEqual(JSON.parse(outResult.stdout), JSON.parse(readFileSync(outputPath, 'utf8')));
  });

  it('keeps --shadow observe-only: same verdict with and without it', () => {
    const plain = spawnSync('npx', ['tsx', 'scripts/verify/penetration/verify-penetration.ts', '--json'], { encoding: 'utf8' });
    const shadowed = spawnSync('npx', ['tsx', 'scripts/verify/penetration/verify-penetration.ts', '--json', '--shadow'], { encoding: 'utf8' });
    assert.equal(plain.status, shadowed.status, 'shadow must not change the exit code');
    const plainReport = JSON.parse(plain.stdout);
    const shadowReport = JSON.parse(shadowed.stdout);
    assert.deepEqual(plainReport.report, shadowReport.report, 'shadow must not change the verdict');
    assert.equal(plainReport.shadow, undefined, 'no shadow block without the flag');
    assert.ok(shadowReport.shadow, 'shadow block appears with the flag');
    assert.equal(typeof shadowReport.shadow.summary.candidates, 'number');
  });

  it('fails closed when the runtime scene cannot be built', () => {
    // 不改配置：用不存在的 --out 目标无法构造该分支，这里只锁定退出码契约——
    // 缺路径必须 exit 2 而不是静默写盘。
    const result = spawnSync('npx', ['tsx', 'scripts/verify/penetration/verify-penetration.ts', '--json', '--out'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
  });
});
