// 活动包络（envelope）shadow-only 单测。
//
// 覆盖：门扇开启弧几何（inward/outward × hinge start/end 四种组合）、推拉门开启态、
// 家具活动包络（抽屉/电器门/椅子拉出/衣柜门）、未申报类型显形 envelope_undeclared、
// 包络与静体相交的深度计算。全部结论 level: 'info'，不进 errors/warnings。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  computeEnvelopeShadow,
  doorSwingGeometry,
  doorSwingObbs,
  slidingOpenObbs,
  type EnvelopeInput,
  type EnvelopeTarget,
} from '../../shared/penetration/envelopes.js';
import { obbFromObject, satOverlap } from '../../shared/penetration/obb.js';
import type { BoxEntry } from '../../shared/penetration/scene.js';
import type { ResolvedOpening, ResolvedRoom, ResolvedWall, SceneElement } from '../../shared/types.js';
import type { Aabb3 } from '../../shared/spatial-validation.js';

const box = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Aabb3 => ({ minX, maxX, minY, maxY, minZ, maxZ });

/** 沿 +x 的墙 (0,0)→(5,0)；左法向 = +z（南）。 */
const wallPlusX: ResolvedWall = { id: 'w', x1: 0, z1: 0, x2: 5, z2: 0, height: 2.8 };
const room = (id: string, x: number, z: number): ResolvedRoom => ({ id, name: id, x, z, width: 1, depth: 1, height: 2.8, type: 'public' } as ResolvedRoom);
const northRoom: ResolvedRoom = room('r', 2.5, -3);
const opening = (over: Partial<ResolvedOpening>): ResolvedOpening => ({ id: 'd', type: 'door', x: 2.5, z: 0, width: 1, height: 2.1, ...over });

const target = (entity: string, b: Aabb3, type = 'cabinet'): EnvelopeTarget => ({ entity, type, box: b });
const entry = (entity: string, type: string, b: Aabb3): BoxEntry => ({ entity, type, box: b });

/** 方向断言（容忍 -0 与 0 的严格不等）。 */
const assertDir = (d: { x: number; z: number }, ex: number, ez: number, msg: string): void => {
  assert.ok(Math.abs(d.x - ex) < 1e-9 && Math.abs(d.z - ez) < 1e-9, `${msg}: got (${d.x},${d.z}) want (${ex},${ez})`);
};

describe('door swing geometry (inward/outward × hinge start/end)', () => {
  // inward 朝 room：room 在北（-z）→ inward=(0,-1)；outward 恒为 wallNormal=(0,1)（与 room 无关）。

  it('inward + start: hinge at start jamb, opens toward the room', () => {
    const geo = doorSwingGeometry(wallPlusX, opening({ swing: 'inward', hinge: 'start' }), [northRoom])!;
    assert.ok(geo);
    assert.ok(Math.abs(geo.hinge.x - 2.0) < 1e-9 && Math.abs(geo.hinge.z) < 1e-9, 'start hinge at center-half = x2.0');
    assertDir(geo.closedDir, 1, 0, 'closed leaf points +u across the opening');
    assertDir(geo.openDir, 0, -1, 'inward opens toward the north room');
    assert.equal(geo.leafLength, 1, 'leaf length = declared clear width');
  });

  it('inward + end: hinge at end jamb, closed leaf points -u', () => {
    const geo = doorSwingGeometry(wallPlusX, opening({ swing: 'inward', hinge: 'end' }), [northRoom])!;
    assert.ok(Math.abs(geo.hinge.x - 3.0) < 1e-9, 'end hinge at center+half = x3.0');
    assertDir(geo.closedDir, -1, 0, 'closed leaf points -u');
    assertDir(geo.openDir, 0, -1, 'inward opens toward the north room');
  });

  it('outward + start: opens along the wall normal, room-independent', () => {
    const geo = doorSwingGeometry(wallPlusX, opening({ swing: 'outward', hinge: 'start' }), [northRoom])!;
    assert.ok(Math.abs(geo.hinge.x - 2.0) < 1e-9);
    assertDir(geo.openDir, 0, 1, 'outward uses wallNormal (+z for a +x wall), not the room side');
    assertDir(geo.closedDir, 1, 0, 'closed leaf points +u');
  });

  it('outward + end: hinge at end jamb, opens along the wall normal', () => {
    const geo = doorSwingGeometry(wallPlusX, opening({ swing: 'outward', hinge: 'end' }), [northRoom])!;
    assert.ok(Math.abs(geo.hinge.x - 3.0) < 1e-9);
    assertDir(geo.openDir, 0, 1, 'outward uses wallNormal');
    assertDir(geo.closedDir, -1, 0, 'closed leaf points -u');
  });

  it('does not guess a swing when swing/hinge are undeclared (铁律：不猜)', () => {
    assert.equal(doorSwingGeometry(wallPlusX, opening({}), [northRoom]), null, 'no swing → no envelope');
    assert.equal(doorSwingGeometry(wallPlusX, opening({ swing: 'inward' }), [northRoom]), null, 'no hinge → no envelope');
  });

  it('approximates the 90° sweep as K oriented boxes that cover the arc', () => {
    const geo = doorSwingGeometry(wallPlusX, opening({ swing: 'inward', hinge: 'start' }), [northRoom])!;
    const boxes = doorSwingObbs(geo, 3);
    assert.equal(boxes.length, 3);
    // 扫掠外包必含关闭态叶尖（合页+closedDir*L）与开启态叶尖（合页+openDir*L）。
    const closedTip = new THREE.Vector3(geo.hinge.x + geo.closedDir.x * geo.leafLength, geo.sill + geo.height / 2, geo.hinge.z + geo.closedDir.z * geo.leafLength);
    const openTip = new THREE.Vector3(geo.hinge.x + geo.openDir.x * geo.leafLength, geo.sill + geo.height / 2, geo.hinge.z + geo.openDir.z * geo.leafLength);
    const insideAny = (p: THREE.Vector3) => {
      const tiny = { center: p, axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as [THREE.Vector3, THREE.Vector3, THREE.Vector3], half: [1e-4, 1e-4, 1e-4] as [number, number, number] };
      return boxes.some((o) => satOverlap(o, tiny) !== null);
    };
    assert.ok(insideAny(closedTip), 'sweep covers the closed leaf tip');
    assert.ok(insideAny(openTip), 'sweep covers the open leaf tip');
  });
});

describe('sliding door open state', () => {
  const run = (open: boolean): SceneElement => ({ id: 'sd', type: 'sliding_door_run', points: [{ x: 0, z: 0 }, { x: 4, z: 0 }], panels: 4, open, height: 2.55 } as unknown as SceneElement);

  it('stacks all panels at the b-end when open:true (复刻 SceneBuilder 叠收公式)', () => {
    const boxes = slidingOpenObbs(run(true) as unknown as { id: string; points: Array<{ x: number; z: number }>; panels?: number; open?: boolean; height: number });
    assert.equal(boxes.length, 4);
    // 4 面板宽 1.0，叠收在 b 端 x=4 附近：每片中心 x 都在 [3, 4]。
    for (const b of boxes) assert.ok(b.center.x >= 3 - 1e-9 && b.center.x <= 4 + 1e-9, `panel center x=${b.center.x} near the b-end`);
  });

  it('a target at the stacking end is hit; the far passage is clear', () => {
    const input: EnvelopeInput = {
      walls: [], rooms: [],
      elements: [run(true)],
      furniture: [],
      targets: [target('t-stack', box(3.5, 4.2, 0, 2.6, -0.1, 0.1)), target('t-passage', box(0.2, 0.8, 0, 2.6, -0.1, 0.1))],
      config: { sliding_open: { enabled: true } },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    const hit = report.hits.find((h) => h.envelope_kind === 'sliding_open');
    assert.ok(hit, 'sliding open produces a hit');
    assert.ok(hit.overlaps.some((o) => o.entity === 't-stack' && o.depth_m > 0));
    assert.ok(!hit.overlaps.some((o) => o.entity === 't-passage'), 'the clear passage is not a hit');
  });
});

describe('furniture envelopes: appliance_door depth + drawer + chair + wardrobe', () => {
  it('appliance_door extrudes a slab in front of the face; SAT depth is the slab overlap', () => {
    const fridge = entry('furniture:kitchen:fridge:5', 'fridge', box(10, 11, 0, 2, 0, 1)); // door opens west
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [fridge],
      // 目标与包络（x[9.5,10]）在 x[9.5,9.8] 相交 → 深 0.3；家电自体作为 target 也会被「排除 Owner」滤掉。
      targets: [target('furniture:kitchen:fridge:5', fridge.box, 'fridge'), target('t-dock', box(9.5, 9.8, 0, 2, 0, 1))],
      config: { furniture: [{ id: 'env.fridge.door', type: 'fridge', kind: 'appliance_door', open_face: 'west', swing_m: 0.5, declared_basis: 'test' }] },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    const hit = report.hits.find((h) => h.envelope_kind === 'appliance_door')!;
    assert.ok(hit);
    assert.equal(hit.enabled_by, 'env.fridge.door');
    assert.equal(hit.level, 'info');
    const dock = hit.overlaps.find((o) => o.entity === 't-dock')!;
    assert.ok(dock, 'door slab hits the dock');
    assert.ok(Math.abs(dock.depth_m - 0.3) < 1e-6, `depth = 0.3 slab overlap, got ${dock.depth_m}`);
    assert.ok(!hit.overlaps.some((o) => o.entity === 'furniture:kitchen:fridge:5'), 'the appliance itself (owner) is not a self-hit');
  });

  it('drawer pulls out along open_face; nothing in front → no hit', () => {
    const dresser = entry('furniture:master_bedroom:dresser:8', 'master_hot_season_low_dresser', box(0, 1.4, 0, 0.85, 9, 9.5));
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [dresser],
      targets: [target('t-far', box(0, 1.4, 0, 0.85, 7, 8))], // 3m+ away
      config: { furniture: [{ id: 'env.drawer', type: 'master_hot_season_low_dresser', kind: 'drawer', open_face: 'north', extend_m: 0.35, declared_basis: 'test' }] },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    assert.equal(report.hits.length, 0, 'a drawer with nothing in front does not hit');
  });

  it('chair_pullout derives direction from the backrest (local -z) via the runtime matrix', () => {
    // rotation=0 → local -z 朝 world -z（北）；拉出 0.45 → 落位盒 z 平移 -0.45。
    const object = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.85, 0.45));
    object.position.set(7.55, 0.425, 3.0);
    object.updateMatrixWorld(true);
    const chair = { entity: 'furniture:x:chair:0', type: 'chair', box: box(7.33, 7.77, 0, 0.85, 2.78, 3.22), object };
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [chair],
      // 目标放在拉出落位（-z 0.45，即 z≈2.33..2.77）会撞、放南侧原位不外扩不撞。
      targets: [target('t-north', box(7.33, 7.77, 0, 0.85, 2.0, 2.4)), target('t-south', box(7.33, 7.77, 0, 0.85, 3.3, 3.6))],
      config: { furniture: [{ id: 'env.chair', type: 'chair', kind: 'chair_pullout', pullout_axis: 'backrest', pullout_m: 0.45, declared_basis: 'test' }] },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    const hit = report.hits.find((h) => h.envelope_kind === 'chair_pullout');
    assert.ok(hit, 'pulled-out chair hits the north target');
    assert.ok(hit.overlaps.some((o) => o.entity === 't-north'));
    assert.ok(!hit.overlaps.some((o) => o.entity === 't-south'));
  });

  it('wardrobe_door hinged: front face derived from the door-panel local axis', () => {
    // door_face_axis local+z, rotation=0 → 朝南 (+z)；平开探出 leaf_width。
    const object = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.8, 0.58));
    object.position.set(2.45, 1.4, 4.59);
    object.updateMatrixWorld(true);
    const wardrobe = { entity: 'furniture:mb:wardrobe:1', type: 'master_north_wall_wardrobe_950', box: box(1.98, 2.92, 0, 2.8, 4.3, 4.88), object };
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [wardrobe],
      targets: [target('t-south', box(2.0, 2.9, 0, 2.8, 4.9, 5.2)), target('t-north', box(2.0, 2.9, 0, 2.8, 4.0, 4.28))],
      config: { furniture: [{ id: 'env.wardrobe', type: 'master_north_wall_wardrobe_950', kind: 'wardrobe_door', door_face_axis: 'local+z', leaf_width_m: 0.29, leaf_count: 3, declared_basis: 'test' }] },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    const hit = report.hits.find((h) => h.envelope_kind === 'wardrobe_door');
    assert.ok(hit, 'hinged wardrobe door swing hits the south target');
    assert.ok(hit.overlaps.some((o) => o.entity === 't-south'));
    assert.ok(!hit.overlaps.some((o) => o.entity === 't-north'), 'the back (north) side is not the door side');
  });
});

describe('envelope_undeclared (未申报 → 显形，不猜)', () => {
  it('reports an info entry for every placed non-mep type with no envelope declaration', () => {
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [
        entry('furniture:a:sofa_3seat:0', 'sofa_3seat', box(0, 2.8, 0, 0.9, 0, 0.9)),
        entry('furniture:a:bed_180:0', 'bed_180', box(3, 5, 0, 0.8, 0, 2)),
        entry('furniture:a:mb_vanity_pvc_service_chase:0', 'mb_vanity_pvc_service_chase', box(0, 1, 2, 3, 0, 1)),
      ],
      targets: [],
      config: { furniture: [{ id: 'env.fridge', type: 'fridge', kind: 'appliance_door', open_face: 'west', swing_m: 0.5, declared_basis: 'test' }] },
      mepTypes: ['mb_vanity_pvc_service_chase'],
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    const types = report.undeclared.map((u) => u.type).sort();
    assert.deepEqual(types, ['bed_180', 'sofa_3seat'], 'mep parts and registered types are not undeclared');
    assert.equal(report.summary.undeclared_types, 2);
    const sofa = report.undeclared.find((u) => u.type === 'sofa_3seat')!;
    assert.ok(sofa.note.includes('无活动包络申报'));
    assert.deepEqual(sofa.instances, ['furniture:a:sofa_3seat:0']);
  });

  it('a registered type produces no undeclared entry', () => {
    const input: EnvelopeInput = {
      walls: [], rooms: [], elements: [],
      furniture: [entry('furniture:a:fridge:0', 'fridge', box(0, 0.7, 0, 1.8, 0, 0.7))],
      targets: [],
      config: { furniture: [{ id: 'env.fridge', type: 'fridge', kind: 'appliance_door', open_face: 'west', swing_m: 0.5, declared_basis: 'test' }] },
      source: 'test',
    };
    const report = computeEnvelopeShadow(input);
    assert.equal(report.undeclared.length, 0);
  });
});

describe('envelope shadow is observe-only (never error/warning)', () => {
  it('every hit is level info and door_swing can be disabled by config', () => {
    const input: EnvelopeInput = {
      walls: [{ ...wallPlusX, openings: [opening({ id: 'd_mbath', swing: 'inward', hinge: 'end', room: 'r' })] }],
      rooms: [northRoom],
      elements: [],
      furniture: [],
      targets: [target('t', box(1.0, 1.6, 0, 2.1, -1.0, -0.2))],
      config: { door_swing: { enabled: false } },
      source: 'test',
    };
    const enabled = computeEnvelopeShadow({ ...input, config: { door_swing: { enabled: true } } });
    for (const hit of enabled.hits) assert.equal(hit.level, 'info');
    const disabled = computeEnvelopeShadow(input);
    assert.equal(disabled.summary.envelopes, 0, 'door_swing disabled → no door envelopes');
  });

  it('OBB narrow phase on the envelope confirms real depth/MTV on a rotated target', () => {
    // 旋转 45° 的目标：AABB 与包络相交，OBB 仍报合理深度（证明扫掠体 SAT 用在真实旋转几何上成立）。
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    object.position.set(9.6, 1, 0.5);
    object.rotation.y = Math.PI / 4;
    object.updateMatrixWorld(true);
    const obb = obbFromObject(object)!;
    const envSlab = { center: new THREE.Vector3(9.75, 1, 0.5), axes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)] as [THREE.Vector3, THREE.Vector3, THREE.Vector3], half: [0.25, 1, 0.5] as [number, number, number] };
    const overlap = satOverlap(envSlab, obb)!;
    assert.ok(overlap && overlap.depth > 0 && overlap.depth < 1.5, `rotated target overlap depth sane: ${overlap?.depth}`);
    assert.ok(Math.abs(overlap.mtv.length() - overlap.depth) < 1e-9, 'MTV length equals depth');
  });
});
