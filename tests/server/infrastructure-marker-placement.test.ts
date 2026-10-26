// marker 穿墙回归单测：深 fixture（比墙厚的马桶/洗衣机类）不得按薄面板约定挂装后捅到邻房。
//
// 2026-10-26 事件：`placeModel` 曾对所有压墙点位一律用薄面板约定——origin 偏移
// `WALL_THICKNESS/2 + WALL_GAP + FIXTURE_HALF_THICKNESS`。马桶 recipe 朝墙厚 0.325m >
// 墙厚 0.12m，其朝墙极端（水箱）被推到墙的另一侧：toilet_mbath 整块水箱落进儿童房、
// toilet_gbath 越 w_gbath_east 东脸 19cm。修复后，朝墙厚度超过墙厚的 fixture 改为把朝墙端
// 贴到墙脸（只留 WALL_GAP）；强/弱电箱是"本体坐在墙里"的埋墙箱体（FixtureFactory recipe
// 注释原话 "body sits in the wall; door and frame are flush/slightly proud"），门位置由
// frontProjection 单独调校，既不参与深 fixture 锚定，也不受远面规则约束。
//
// 墙几何一律取自 runtime 场景的权威 wall mesh（`buildRuntimeScene().index.wallMeshes`），
// marker 一律走真实渲染路径 `buildInfrastructure`（与 app 的 placeInfrastructureFixtures、
// server 的 SceneBuilder 同一实现），本文件不推导、不复制任何坐标。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildInfrastructure, type InfrastructureWallSegment } from '../../shared/render/InfrastructureBuilder.js';
import { buildRuntimeScene, loadSceneInputs } from '../../shared/penetration/scene.js';
import type { ElectricalPoint, PlumbingPoint } from '../../shared/types.js';

/** 越过远面 >10mm 才算穿到墙另一侧的房间；贴脸与浮点差不判。 */
const FAR_FACE_TOLERANCE = 0.01;
/** 埋墙箱体豁免：recipe 设计为本体在墙内、门框齐平/微凸，穿墙是设计意图而非事故。 */
const RECESSED_BOX_TYPES = new Set(['strong_panel', 'weak_panel']);

interface AxisBox { min: THREE.Vector3; max: THREE.Vector3 }

interface MarkerEntry {
  id: string;
  fixtureType: string;
  object: THREE.Group;
  box: AxisBox;
}

interface WallEntry {
  id: string;
  wallId: string;
  box: AxisBox;
  /** AABB 最薄的那根轴（墙的厚度方向）。 */
  thinAxis: 0 | 1 | 2;
  /** 另一根水平轴（墙的长度方向）。 */
  lengthAxis: 0 | 1 | 2;
}

interface Crossing {
  marker: string;
  fixtureType: string;
  wall: string;
  overrun: number;
}

function worldBox(object: THREE.Object3D): AxisBox {
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(object);
  return { min: box.min.clone(), max: box.max.clone() };
}

function spansOverlap(marker: AxisBox, wall: AxisBox, axis: 0 | 1 | 2): boolean {
  return marker.min.getComponent(axis) < wall.max.getComponent(axis)
    && marker.max.getComponent(axis) > wall.min.getComponent(axis);
}

function markerEntries(objects: THREE.Group[]): MarkerEntry[] {
  return objects.map((object) => ({
    id: String(object.userData.objectId),
    fixtureType: String(object.userData.fixtureType),
    object,
    box: worldBox(object),
  }));
}

function wallEntries(wallMeshes: THREE.Mesh[]): WallEntry[] {
  return wallMeshes.flatMap((mesh): WallEntry[] => {
    const box = worldBox(mesh);
    const extents = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const thinAxis = extents.indexOf(Math.min(...extents)) as 0 | 1 | 2;
    const id = String(mesh.userData.objectId ?? mesh.name);
    return [{ id, wallId: id.split(':')[0], box, thinAxis, lengthAxis: thinAxis === 0 ? 2 : 0 }];
  });
}

/**
 * 每个 marker × 每堵墙：只在长度轴与高度轴同时有重叠时才检；按 marker 中心相对墙中心线的
 * 偏向定装配侧（中心压在墙板内时贴靠近的一侧），marker 不得越过该墙远面 > FAR_FACE_TOLERANCE。
 * 埋墙箱体（strong/weak_panel）豁免。返回全部越墙记录，由调用方断言为空。
 */
function farFaceCrossings(markers: MarkerEntry[], walls: WallEntry[]): { crossings: Crossing[]; checkedPairs: number } {
  const crossings: Crossing[] = [];
  let checkedPairs = 0;
  for (const marker of markers) {
    if (RECESSED_BOX_TYPES.has(marker.fixtureType)) continue;
    for (const wall of walls) {
      if (!spansOverlap(marker.box, wall.box, wall.lengthAxis)) continue;
      if (!spansOverlap(marker.box, wall.box, 1)) continue;
      checkedPairs += 1;
      const thin = wall.thinAxis;
      const wallMin = wall.box.min.getComponent(thin);
      const wallMax = wall.box.max.getComponent(thin);
      const wallCentre = (wallMin + wallMax) / 2;
      const markerCentre = (marker.box.min.getComponent(thin) + marker.box.max.getComponent(thin)) / 2;
      // 中心压在墙板内（埋墙/骑墙）时，按偏向小的一侧定装配侧。
      const side = markerCentre > wallMin && markerCentre < wallMax
        ? ((markerCentre - wallMin) <= (wallMax - markerCentre) ? -1 : 1)
        : (markerCentre <= wallCentre ? -1 : 1);
      const farFace = side < 0 ? wallMax : wallMin;
      const markerExtreme = side < 0 ? marker.box.max.getComponent(thin) : marker.box.min.getComponent(thin);
      const overrun = (markerExtreme - farFace) * (side < 0 ? 1 : -1);
      if (overrun > FAR_FACE_TOLERANCE) {
        crossings.push({ marker: marker.id, fixtureType: marker.fixtureType, wall: wall.id, overrun });
      }
    }
  }
  return { crossings, checkedPairs };
}

let realScene: { walls: WallEntry[]; markers: MarkerEntry[] } | undefined;
function realSceneMarkers(): { walls: WallEntry[]; markers: MarkerEntry[] } {
  if (!realScene) {
    const inputs = loadSceneInputs();
    const scene = buildRuntimeScene(inputs);
    const built = buildInfrastructure({
      electrical: inputs.electrical,
      plumbing: inputs.plumbing,
      // 与 SceneBuilder 同一份 wallSegments（index.wallSegments 即其构造源）。
      wallSegments: scene.index.wallSegments,
    });
    realScene = { walls: wallEntries(scene.index.wallMeshes), markers: markerEntries(built.objects) };
  }
  return realScene;
}

describe('infrastructure marker placement (real scene)', () => {
  it('keeps every marker on its assembly side of every wall it spans', () => {
    const { walls, markers } = realSceneMarkers();
    assert.ok(markers.length > 100, `expected the full marker set, got ${markers.length}`);
    const { crossings, checkedPairs } = farFaceCrossings(markers, walls);
    assert.ok(checkedPairs > 100, `expected the marker x wall pairs to be checked, got ${checkedPairs}`);
    assert.deepEqual(
      crossings,
      [],
      `markers crossing a wall far face:\n${crossings.map((c) => `  ${c.marker} (${c.fixtureType}) crosses ${c.wall} by ${c.overrun.toFixed(3)}m`).join('\n')}`,
    );
  });

  it('regression 2026-10-26: the toilet markers stay clear of the mbath/gbath east walls', () => {
    const { walls, markers } = realSceneMarkers();
    const mbath = markers.find((marker) => marker.id === 'plumbing:toilet_mbath');
    const gbath = markers.find((marker) => marker.id === 'plumbing:toilet_gbath');
    assert.ok(mbath && gbath, 'both toilet markers must exist in the real scene inputs');
    // 权威墙脸：w_mbath_east / w_gbath_east 的 runtime wall mesh（东脸即儿童房/客厅侧）。
    const mbathEastFace = Math.max(...walls.filter((wall) => wall.wallId === 'w_mbath_east').map((wall) => wall.box.max.x));
    const gbathEastFace = Math.max(...walls.filter((wall) => wall.wallId === 'w_gbath_east').map((wall) => wall.box.max.x));
    assert.ok(Math.abs(mbathEastFace - 2.66) < 1e-6, `w_mbath_east east face moved: ${mbathEastFace}`);
    assert.ok(Math.abs(gbathEastFace - 7.26) < 1e-6, `w_gbath_east east face moved: ${gbathEastFace}`);
    assert.ok(mbath.box.max.x <= mbathEastFace + FAR_FACE_TOLERANCE,
      `toilet_mbath must not cross w_mbath_east east face ${mbathEastFace} (got max.x=${mbath.box.max.x})`);
    assert.ok(gbath.box.max.x <= gbathEastFace + FAR_FACE_TOLERANCE,
      `toilet_gbath must not cross w_gbath_east east face ${gbathEastFace} (got max.x=${gbath.box.max.x})`);
    // 深 fixture 锚定：水箱朝墙端贴到墙西脸、只留 WALL_GAP(5mm)，整体随之西移。
    assert.ok(Math.abs(mbath.box.max.x - 2.535) < 0.002, `toilet_mbath tank back should stop at x=2.535 (got ${mbath.box.max.x})`);
    assert.ok(Math.abs(mbath.box.min.x - 1.985) < 0.002, `toilet_mbath bowl end should reach x=1.985 (got ${mbath.box.min.x})`);
    assert.ok(Math.abs(gbath.box.max.x - 7.135) < 0.002, `toilet_gbath tank back should stop at x=7.135 (got ${gbath.box.max.x})`);
    assert.ok(Math.abs(gbath.box.min.x - 6.585) < 0.002, `toilet_gbath bowl end should reach x=6.585 (got ${gbath.box.min.x})`);
    const tank = (group: MarkerEntry) => group.object.children.find((child) => child.userData.part === 'toilet-tank');
    const mbathTank = tank(mbath);
    const gbathTank = tank(gbath);
    assert.ok(mbathTank && gbathTank, 'toilet tank part must exist');
    assert.ok(Math.abs(worldBox(mbathTank).max.x - 2.535) < 0.002, 'toilet_mbath tank must stop 5mm off the wall face');
    assert.ok(Math.abs(worldBox(gbathTank).max.x - 7.135) < 0.002, 'toilet_gbath tank must stop 5mm off the wall face');
  });

  it('keeps the recessed panel boxes on the thin-panel convention (unchanged by the deep-fixture anchor)', () => {
    const { markers } = realSceneMarkers();
    const weak = markers.find((marker) => marker.id === 'electrical:panel_weak_entry_left');
    const strong = markers.find((marker) => marker.id === 'electrical:panel_strong_entry_left');
    assert.ok(weak && strong, 'both panel markers must exist in the real scene inputs');
    // 埋墙箱体豁免的位置哨兵：修复前后完全一致（弱电箱声明深度 0.30，recipe 缩放后朝墙厚
    // 0.15 > 墙厚，若误入深 fixture 分支会整体东移约 0.14m）。弱电箱盒体按设计跨立墙板
    // （body sits in the wall），故不受远面规则约束。
    assert.ok(Math.abs(weak.box.min.x - 10.66) < 0.001, `weak panel min.x drifted: ${weak.box.min.x}`);
    assert.ok(Math.abs(weak.box.max.x - 11.005) < 0.001, `weak panel max.x drifted: ${weak.box.max.x}`);
    assert.ok(Math.abs(strong.box.min.x - 10.6829) < 0.001, `strong panel min.x drifted: ${strong.box.min.x}`);
    assert.ok(Math.abs(strong.box.max.x - 10.91) < 0.001, `strong panel max.x drifted: ${strong.box.max.x}`);
  });
});

describe('placeModel anchoring rules (synthetic points)', () => {
  // w_mbath_east 中心线段（与 model-geometry 一致）：slab x[2.540,2.660]，儿童房在 x>2.66。
  const wallSegments = new Map<string, InfrastructureWallSegment[]>([
    ['w_mbath_east', [{ x1: 2.6, z1: 1.1, x2: 2.6, z2: 4.3 }]],
  ]);
  const anchor = { x: 2.6, z: 1.5, wall: 'w_mbath_east', wallSide: 'west' } as const;

  it('anchors a fixture thicker than the wall by its wall-facing extreme', () => {
    // washer recipe 进深 0.60（local z[-0.30,0.30]）> 墙厚 0.12，与马桶同类；
    // 当前 config 无洗衣机点位，用合成点锁死规则本身，不依赖 config。
    const washer: PlumbingPoint = { id: 'synthetic_washer', room: 'master_bath', type: 'washer', height: 0.5, ...anchor };
    const box = worldBox(buildInfrastructure({ electrical: [], plumbing: [washer], wallSegments }).plumbing[0]);
    // offset = 0.12/2 + 0.005 + 0.30 = 0.365 -> origin x=2.235，盒体 x[1.935,2.535]
    assert.ok(Math.abs(box.max.x - 2.535) < 1e-6, `washer wall-facing extreme should stop at 2.535 (got ${box.max.x})`);
    assert.ok(Math.abs(box.min.x - 1.935) < 1e-6, `washer room-facing extreme should reach 1.935 (got ${box.min.x})`);
    assert.ok(box.max.x < 2.54, 'the wall-facing extreme must stay on the assembly side of the wall');
  });

  it('keeps thin fixtures on the unchanged thin-panel offset', () => {
    const socket: ElectricalPoint = { id: 'synthetic_socket', room: 'master_bath', type: 'socket', height: 1.0, ...anchor };
    const box = worldBox(buildInfrastructure({ electrical: [socket], plumbing: [], wallSegments }).electrical[0]);
    // 薄面板约定不变：origin 偏移 0.12/2 + 0.005 + 0.01 = 0.075 -> origin x=2.525；
    // socket recipe local z[-0.014,0.016]（local +z 朝房间）-> x[2.509,2.539]。
    assert.ok(Math.abs(box.max.x - 2.539) < 1e-6, `socket wall-facing extreme should stay at 2.539 (got ${box.max.x})`);
    assert.ok(Math.abs(box.min.x - 2.509) < 1e-6, `socket room-facing extreme should stay at 2.509 (got ${box.min.x})`);
  });

  it('keeps a recessed box on its frontProjection-tuned door position even when scaled deeper than the wall', () => {
    // 弱电箱声明深度 0.30（recipe 0.14 → 缩放 2.14x，朝墙厚 0.15 > 墙厚）：埋墙箱体必须继续走
    // 薄面板公式，门位置由 frontProjection(0.13) 调校，不得被深 fixture 规则顶出墙面。
    const panel: ElectricalPoint = {
      id: 'synthetic_weak_panel', room: 'living_dining', type: 'weak_panel',
      x: 10.8, z: 2.98, wall: 'w_ent_west', wallSide: 'west',
      mount_height: 0.5, body_height: 0.4, width: 0.4, depth: 0.3,
    };
    const segments = new Map<string, InfrastructureWallSegment[]>([
      ['w_ent_west', [{ x1: 10.8, z1: 2.4, x2: 10.8, z2: 3.0 }]],
    ]);
    const box = worldBox(buildInfrastructure({ electrical: [panel], plumbing: [], wallSegments: segments }).electrical[0]);
    // 薄面板公式：offset = 0.075 - 0.13 = -0.055，沿朝房法线（west）作用于中心线
    // -> origin x=10.855；缩放后 recipe local z[-0.15,0.195]（local +z 朝房间/西）
    // -> x[10.66,11.005]，盒体按设计跨立墙板 x[10.740,10.860]。
    assert.ok(Math.abs(box.min.x - 10.66) < 1e-6, `weak panel min.x should stay at 10.66 (got ${box.min.x})`);
    assert.ok(Math.abs(box.max.x - 11.005) < 1e-6, `weak panel max.x should stay at 11.005 (got ${box.max.x})`);
  });
});
