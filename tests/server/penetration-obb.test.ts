// OBB/SAT 窄相位与 shadow 对照单测。
//
// 要点：OBB 恒包含于 AABB，因此 OBB 判相交 ⇒ AABB 必判相交——本层只能消假阳。
// 旋转体的经典假阳（AABB 相交、实际分离）必须有测试钉住。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { aabbOverlaps, obbFromObject, satOverlap } from '../../shared/penetration/obb.js';
import { computeObbShadow } from '../../shared/penetration/shadow.js';
import type { BoxEntry } from '../../shared/penetration/scene.js';
import type { Aabb3 } from '../../shared/spatial-validation.js';

const mesh = (size: [number, number, number], rotationY: number, x: number, z: number): THREE.Mesh => {
  const object = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]));
  object.position.set(x, size[1] / 2, z);
  object.rotation.y = rotationY;
  object.updateMatrixWorld(true);
  return object;
};

/** 斜放长条：AABB 覆盖方框、实体却从方框角外侧穿过——AABB 假阳的标准构型。 */
const diagonalBar = (): THREE.Mesh => mesh([3, 0.2, 0.2], Math.PI / 4, 1.2, 0);

const toAabb = (box: THREE.Box3): Aabb3 => ({ minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z });

const boxEntry = (entity: string, object: THREE.Mesh): BoxEntry => {
  const world = new THREE.Box3().setFromObject(object);
  const box: Aabb3 = { minX: world.min.x, maxX: world.max.x, minY: world.min.y, maxY: world.max.y, minZ: world.min.z, maxZ: world.max.z };
  return { entity, type: 'cabinet', box, object };
};

describe('obb / SAT narrow phase', () => {
  it('derives an OBB from the runtime world matrix without re-deriving coordinates', () => {
    const object = mesh([2, 1, 1], Math.PI / 4, 3, 4);
    const obb = obbFromObject(object)!;
    assert.ok(obb);
    assert.ok(obb.center.distanceTo(new THREE.Vector3(3, 0.5, 4)) < 1e-9, 'center comes from the world matrix');
    assert.deepEqual(obb.half.map((value) => Number(value.toFixed(6))), [1, 0.5, 0.5]);
    // 旋转 45° 后第一个轴应指向 (cos45, 0, -sin45) 一侧
    assert.ok(Math.abs(obb.axes[0].x - Math.SQRT1_2) < 1e-9);
    assert.ok(Math.abs(obb.axes[0].z + Math.SQRT1_2) < 1e-9);
  });

  it('reports separated boxes as clear and overlapping boxes with a depth and MTV', () => {
    const a = obbFromObject(mesh([1, 1, 1], 0, 0, 0))!;
    const far = obbFromObject(mesh([1, 1, 1], 0, 3, 0))!;
    assert.equal(satOverlap(a, far), null);

    const near = obbFromObject(mesh([1, 1, 1], 0, 0.8, 0))!;
    const overlap = satOverlap(a, near)!;
    assert.ok(overlap);
    assert.ok(Math.abs(overlap.depth - 0.2) < 1e-9, 'penetration depth along the separation axis');
    assert.ok(overlap.mtv.x > 0, 'MTV points from a toward b');
    assert.ok(Math.abs(overlap.mtv.length() - 0.2) < 1e-9);
  });

  it('clears the classic rotated false positive that AABB reports as an overlap', () => {
    const straight = mesh([1, 1, 1], 0, 0, 0);
    const bar = diagonalBar();
    assert.equal(aabbOverlaps(toAabb(new THREE.Box3().setFromObject(straight)), toAabb(new THREE.Box3().setFromObject(bar))), true, 'AABB must report the overlap');
    assert.equal(satOverlap(obbFromObject(straight)!, obbFromObject(bar)!), null, 'OBB must see they are apart');
  });

  it('still detects a real overlap between rotated bodies', () => {
    const a = mesh([1, 1, 1], Math.PI / 6, 0, 0);
    const b = mesh([1, 1, 1], -Math.PI / 6, 0.6, 0);
    assert.ok(satOverlap(obbFromObject(a)!, obbFromObject(b)!), 'rotated bodies that truly touch must still be caught');
  });
});

describe('obb shadow (observe-only)', () => {
  const issue = (entity: string) => ({ level: 'error' as const, code: 'furniture_furniture_collision', entity, source: 'test', message: 'x', evidence: {} });

  it('flags a rule-level finding that OBB clears as a false positive', () => {
    const straight = boxEntry('f-a', mesh([1, 1, 1], 0, 0, 0));
    const bar = boxEntry('f-b', diagonalBar());
    const report = computeObbShadow({ furniture: [straight, bar], ruleIssues: [issue('f-a↔f-b')] });
    assert.equal(report.summary.candidates, 1);
    assert.equal(report.summary.falsePositives, 1);
    assert.equal(report.divergences[0].divergence, 'false_positive');
  });

  it('agrees when the rule and OBB both flag a genuine overlap', () => {
    const a = boxEntry('f-a', mesh([1, 1, 1], 0, 0, 0));
    const b = boxEntry('f-b', mesh([1, 1, 1], 0, 0.8, 0));
    const report = computeObbShadow({ furniture: [a, b], ruleIssues: [issue('f-a↔f-b')] });
    assert.equal(report.summary.agree, 1);
    assert.ok(report.divergences[0].obb_depth_m && report.divergences[0].obb_depth_m! > 0.19);
    assert.ok(report.divergences[0].mtv);
  });

  it('audits relationship exemptions and calls out over-broad ones', () => {
    const touching = boxEntry('f-a', mesh([1, 1, 1], 0, 0, 0));
    const stacked = boxEntry('f-b', mesh([1, 1, 1], 0, 0.8, 0));
    const apart = boxEntry('f-c', diagonalBar());
    const report = computeObbShadow({
      furniture: [touching, stacked, apart],
      relationships: [
        { id: 'real-stack', type: 'stacked', objects: ['f-a', 'f-b'] },
        { id: 'fake-stack', type: 'stacked', objects: ['f-a', 'f-c'] },
      ],
      ruleIssues: [],
    });
    assert.equal(report.summary.exemptPairsAudited, 2);
    assert.equal(report.summary.overBroadExemptions, 1, 'a declared exemption for a pair OBB says is apart is over-broad');
    const fake = report.exemptionAudit.find((entry) => entry.relationship === 'fake-stack')!;
    assert.equal(fake.obb_confirms_overlap, false);
    // 豁免对不进差异对照；剩下未豁免且 AABB 相交的那一对才是候选。
    assert.equal(report.summary.candidates, 1, 'exempt pairs are not divergence candidates');
    assert.deepEqual(report.divergences[0].pair, ['f-b', 'f-c']);
  });

  it('keeps mep coordination parts out of the furniture-vs-furniture comparison', () => {
    const cabinet = boxEntry('f-a', mesh([1, 1, 1], 0, 0, 0));
    const chase = boxEntry('f-chase', mesh([1, 1, 1], 0, 0.8, 0));
    chase.type = 'mb_vanity_pvc_service_chase';
    const report = computeObbShadow({ furniture: [cabinet, chase], mepTypes: ['mb_vanity_pvc_service_chase'], ruleIssues: [] });
    assert.equal(report.summary.candidates, 0);
    assert.equal(report.summary.exemptPairsAudited, 0);
  });
});
