import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { load } from 'js-yaml';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { parseOverlay, mergeSceneElements } from '../../server/overlay-merge.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { buildBaySillGeometry } from '../../shared/render/BaySillGeometry.js';
import { computePaintSillScope, type PaintSillFaceInput } from '../../shared/paint-sill-scope.js';
import { loadCeilingConfig } from '../../server/config-loader.js';

/**
 * 上飘窗漆面（paint_sill_region）的**世界坐标**对账（2026-10-09 主卫整改）。
 *
 * 为什么不能只对面积：旧实现把 Shape(x,z) 绕 X 轴 −90° 立起来时漏了 bay_sill 本体那步
 * `scale.y = -1`，于是底面整体镜像到对侧——真实飘窗脚印 z=[1.10,2.20]，高亮底面落在
 * z=[−2.20,−1.10]。**面积一模一样（2.536㎡）、包围盒完全不同**：预算里算了钱，3D 里
 * 盖不到目标实体。所以这里逐顶点、逐包围盒、逐三角形对账，面积只是其中一项。
 *
 * 三条不变量：
 *   ① underside 网格的世界坐标顶点集合 == bay_sill outline 在 (x, sill, z) 上的投影；
 *   ② underside 的 x/z 包围盒与 bay_sill 本体的 x/z 包围盒重合，且 y 恒等于 sill（水平面）；
 *   ③ 独立三角网格面积合计 == computePaintSillScope 的汇总口径（4.193㎡，全精度累加后 round3），
 *      且与「outline 鞋带 + 前缘/端面宽×高」的解析复算一致。
 */

const MG: any = load(readFileSync('config/layout/model-geometry.yaml', 'utf8'));
const OVERLAY: any = load(readFileSync('config/layout/overlay.yaml', 'utf8'));
const layout = resolveLayout(MG);
const ceilingZones = loadCeilingConfig();

function mergedElements() {
  return mergeSceneElements(layout.walls as any, parseOverlay(readFileSync('config/layout/overlay.yaml', 'utf8')));
}

/** 与 app 同路径：真实墙（带 openings）+ resolved 房间 + 真实吊顶分区 + 涂装/贴砖声明。 */
function sceneWithPaintSill() {
  const merged = mergedElements();
  return buildScene({
    walls: layout.walls,
    rooms: layout.rooms,
    elements: merged.filter((element: any) => ['wall', 'paint_region', 'paint_sill_region', 'bay_sill', 'wall_region'].includes(element.type)),
    ceilingZones,
    furnishings: {},
  } as any);
}

/** mesh 的世界坐标顶点（去重到 1e-9），不受 position/rotation/scale 组合影响。 */
function worldVertices(mesh: THREE.Mesh): Array<{ x: number; y: number; z: number }> {
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position');
  const matrix = mesh.matrixWorld;
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < position.count; i += 1) {
    const vertex = new THREE.Vector3().fromBufferAttribute(position as any, i).applyMatrix4(matrix);
    out.push({ x: vertex.x, y: vertex.y, z: vertex.z });
  }
  return out;
}

/** 独立三角网格面积：逐三角形 |(b−a)×(c−a)|/2 求和，不用任何被测模块的面积函数。 */
function triangleArea(mesh: THREE.Mesh): number {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  const matrix = mesh.matrixWorld;
  const at = (i: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(position as any, i).applyMatrix4(matrix);
  let total = 0;
  const consume = (a: number, b: number, c: number) => {
    const ab = at(b).clone().sub(at(a));
    const ac = at(c).clone().sub(at(a));
    total += ab.clone().cross(ac).length() / 2;
  };
  if (index) for (let i = 0; i < index.count; i += 3) consume(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  else for (let i = 0; i < position.count; i += 3) consume(i, i + 1, i + 2);
  return total;
}

// ShapeGeometry stores vertices as Float32; compare at 1e-5 so the test checks
// placement rather than harmless GPU-buffer quantization.
const key = (p: { x: number; y: number; z: number }): string => `${p.x.toFixed(5)}|${p.y.toFixed(5)}|${p.z.toFixed(5)}`;
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

test('paint_sill_region underside lands on the bay_sill footprint: world vertices, AABB and flat elevation', () => {
  const scene: any = sceneWithPaintSill();
  assert.deepEqual(scene.unsupported ?? [], [], '声明必须全部落地');
  scene.exportRoot.updateMatrixWorld(true);

  const sillMeshes: THREE.Mesh[] = [];
  const bayMeshes: THREE.Mesh[] = [];
  scene.exportRoot.traverse((object: any) => {
    if (object.userData?.inspectionLayer !== 'wall-paint') return;
    if (object.userData?.elementId !== 'master_bath_west_bay') return;
    if (!(object as THREE.Mesh).isMesh) return;
    sillMeshes.push(object as THREE.Mesh);
  });
  scene.exportRoot.traverse((object: any) => {
    if (object.userData?.type === 'bay_sill' && object.userData?.objectId === 'master_bath_west_bay' && (object as THREE.Mesh).isMesh) {
      bayMeshes.push(object as THREE.Mesh);
    }
  });
  assert.equal(sillMeshes.length > 0, true, '必须产出上飘窗漆面网格');
  assert.equal(bayMeshes.length, 1, '必须只有一件 master_bath_west_bay 实体');
  const bay = bayMeshes[0];
  const underside = sillMeshes.find((mesh) => mesh.userData.face === 'underside')!;
  assert.ok(underside, 'faces 声明了 underside，必须产出一张水平底面');

  // ── ① 世界坐标顶点集合 == outline 投影到 (x, sill, z) ──
  const declaration = (OVERLAY.elements ?? []).find((element: any) => element?.id === 'paint_master_bath_west_bay') as unknown as PaintSillFaceInput;
  const bayElement: any = mergedElements().find((element: any) => element.type === 'bay_sill' && element.id === 'master_bath_west_bay');
  const room = layout.rooms.find((candidate) => candidate.id === declaration.room)!;
  const geometry = buildBaySillGeometry(bayElement.wallRefs, layout.rooms, bayElement.depth);
  const scope = computePaintSillScope(declaration, geometry, bayElement, room, ceilingZones, layout.walls as any);
  const sill = bayElement.sill;

  const expected = new Set(geometry.outline.map((point) => key({ x: point.x, y: sill, z: point.z })));
  const actual = new Set(worldVertices(underside).map(key));
  assert.deepEqual([...actual].sort(), [...expected].sort(),
    'underside 的世界坐标顶点必须与 bay_sill 脚印逐点同位（镜像到对侧时这一条立刻红）');
  // 旧缺陷的定向回归：真实飘窗脚印 z ∈ [1.10, 2.20]，绝不允许出现负 z
  for (const point of geometry.outline) {
    assert.ok(point.z > 0, `outline 点 z 应为正（室内侧），实际 ${point.z}`);
    assert.ok(actual.has(key({ x: point.x, y: sill, z: point.z })), `outline 点 (${point.x}, ${point.z}) 必须落在底面上`);
  }

  // ── ② 包围盒：x/z 与实体重合，y 恒等于 sill（水平面，没有厚度）──
  const undersideBox = new THREE.Box3().setFromObject(underside);
  const bayBox = new THREE.Box3().setFromObject(bay);
  assert.ok(near(undersideBox.min.x, bayBox.min.x), `底面 min.x ${undersideBox.min.x} != 实体 ${bayBox.min.x}`);
  assert.ok(near(undersideBox.max.x, bayBox.max.x), `底面 max.x ${undersideBox.max.x} != 实体 ${bayBox.max.x}`);
  assert.ok(near(undersideBox.min.z, bayBox.min.z), `底面 min.z ${undersideBox.min.z} != 实体 ${bayBox.min.z}`);
  assert.ok(near(undersideBox.max.z, bayBox.max.z), `底面 max.z ${undersideBox.max.z} != 实体 ${bayBox.max.z}`);
  assert.ok(near(undersideBox.min.y, sill) && near(undersideBox.max.y, sill), `底面必须是 y=${sill} 的水平面，实际 y∈[${undersideBox.min.y}, ${undersideBox.max.y}]`);
  assert.ok(bayBox.min.y <= sill + 1e-9, '底面标高必须落在实体根部');
  // 具体数字（真实布局）：x∈[0,2.6]、z∈[1.1,2.2]、y=2.07
  assert.ok(near(undersideBox.min.x, 0) && near(undersideBox.max.x, 2.6), `底面 x 包围盒 ${undersideBox.min.x}..${undersideBox.max.x}`);
  assert.ok(near(undersideBox.min.z, 1.1) && near(undersideBox.max.z, 2.2), `底面 z 包围盒 ${undersideBox.min.z}..${undersideBox.max.z}`);
  assert.ok(near(undersideBox.min.y, 2.07) && near(undersideBox.max.y, 2.07), `底面 y 包围盒 ${undersideBox.min.y}..${undersideBox.max.y}`);

  // ── ③ 独立三角面积对账 ──
  const undersideArea = triangleArea(underside);
  assert.ok(Math.abs(undersideArea - 2.536295751410121) < 1e-6, `底面三角面积 ${undersideArea}`);
  assert.ok(Math.abs(undersideArea - scope.surfaces.find((surface) => surface.kind === 'underside')!.areaSqm) < 1e-5,
    '三角面积必须等于声明的全精度面积（不再逐段 round3）');

  const meshTotal = sillMeshes.reduce((sum, mesh) => sum + triangleArea(mesh), 0);
  // 解析复算：outline 鞋带 + 前缘总宽×外露高 + 端面宽×外露高（全部从 config 独立推得）
  const masterBathCeiling = ceilingZones.find((zone) => zone.id === 'ceiling_master_bath');
  assert.ok(masterBathCeiling, '缺少主卫吊顶声明');
  const ceilingThickness = masterBathCeiling.thickness ?? 0;
  assert.ok(ceilingThickness > 0, '主卫吊顶厚度必须已声明');
  const ceilingFinish = room.height - ceilingThickness;
  const frontWidth = geometry.frontPath.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.frontPath[index].x, point.z - geometry.frontPath[index].z), 0);
  const capWidth = Math.hypot(geometry.frontPath[0].x - geometry.wallPath[0].x, geometry.frontPath[0].z - geometry.wallPath[0].z);
  const analytic = scope.surfaces.find((surface) => surface.kind === 'underside')!.areaSqm
    + frontWidth * (ceilingFinish - sill) + capWidth * (ceilingFinish - sill);
  assert.ok(Math.abs(meshTotal - analytic) < 1e-6, `三角网格合计 ${meshTotal} 与解析复算 ${analytic} 对不上`);
  assert.ok(Math.abs(meshTotal - 4.193365) < 1e-5, `三角网格合计 ${meshTotal}（浏览器独立复算 4.193365㎡）`);
  assert.equal(scope.totalAreaSqm, 4.193, '汇总口径 round3 后必须是 4.193㎡（旧逐段 round3 是 4.198㎡）');
  assert.ok(Math.abs(scope.totalAreaSqm - meshTotal) < 5e-4, '汇总口径与三角网格复算必须同源');

  // 立面必须给真实标高（审计靠 bottom/top 算带高，不能是 0）
  for (const mesh of sillMeshes) {
    if (mesh.userData.face === 'underside') continue;
    assert.ok(typeof mesh.userData.bottom === 'number' && mesh.userData.bottom > 0, `${mesh.userData.objectId} 缺 bottom`);
    assert.ok(typeof mesh.userData.top === 'number' && mesh.userData.top > mesh.userData.bottom, `${mesh.userData.objectId} 缺 top`);
    assert.equal(mesh.userData.surfaceOrientation, 'vertical');
  }
  assert.equal(underside.userData.surfaceOrientation, 'horizontal');
  assert.equal(underside.userData.bottom, sill);
  assert.equal(underside.userData.top, sill);
  assert.equal(underside.userData.inspectionLayer, 'wall-paint');
  assert.equal(underside.userData.inspectionVisibleOnly, true);
  assert.equal(underside.visible, false, 'inspection-only：正常视图不可见');
});

test('underside keeps the wall-paint layer label and a reversible initial snapshot', () => {
  const scene: any = sceneWithPaintSill();
  const found: THREE.Mesh[] = [];
  scene.exportRoot.traverse((object: any) => {
    if (object.userData?.inspectionLayer === 'wall-paint' && object.userData?.face === 'underside' && (object as THREE.Mesh).isMesh) {
      found.push(object as THREE.Mesh);
    }
  });
  assert.equal(found.length, 1);
  const mesh = found[0];
  assert.equal(mesh.userData.inspectionLayer, 'wall-paint', '新面必须仍是 wall-paint 标签');
  assert.equal(mesh.userData.finish, 'wet_area');
  assert.deepEqual(mesh.userData.inspectionInitial, { visible: false, opacity: 0.38, transparent: true, depthTest: true, depthWrite: false, renderOrder: 0 });
  assert.equal(mesh.visible, false);
  // 同一件 material 被多张面共享（ underside + front + start_end ），关闭态按快照逐网格恢复
  const shared = sillMeshesSharing(mesh, scene.exportRoot);
  assert.ok(shared >= 3, `同一张漆材质应被多张面共享，实际 ${shared}`);
});

/** 与给定 mesh 共用同一 material 实例的 wall-paint 网格数。 */
function sillMeshesSharing(mesh: THREE.Mesh, root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object: any) => {
    if (object.userData?.inspectionLayer === 'wall-paint' && object.material === mesh.material) count += 1;
  });
  return count;
}
