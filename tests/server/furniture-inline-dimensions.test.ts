import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { buildCliHouseScene } from '../../scripts/render/glb/cli-glb-builder.js';

// 回归：书房南延腿在 house.yaml 上带行内 width 2.182 / depth 0.55（目录 1.70×0.55）；
// 北段带行内 width 1.80（2026-10-27 齐平：西延顶墙）。
// 2026-10-27 业主反馈：渲染里的腿仍按目录 1.70m 画，北端离原柜、南端离墙垛各留 0.255m 缝
// （模型 AABB 是对的，渲染错）——SceneBuilder 通用家具路径只认目录尺寸，不认行内尺寸。
// 本测试断言渲染几何与模型 AABB 同口径：腿北端贴北段门面（z=6.128，体面 6.10 外 0.028 门面余量）、
// 南端贴墙垛北脸（z=8.31）；北段西脸顶西墙（x=4.20）。
// 2026-10-27 DEC-2026-10-27-R02 通顶：腿沿 z=6.45（边吊南缘）拆为北段 stub（z[6.128,6.45]，顶 2.40，
// 留 0.10 灰缝到边吊底）与南段高腿（z[6.45,8.31]，cabinetHeight 2.8，顶贴平顶 2.80）；
// 通用路径 Y 缩放（cabinetHeight / 配方实建高 2.40）断言见第二个测试（红绿验证：暂藏 Y 缩放应失败）。

function studyWardrobeGroups(): THREE.Object3D[] {
  const { scene } = buildCliHouseScene();
  const found: THREE.Object3D[] = [];
  scene.traverse((object) => {
    // 柜体零件（门板/层板等）与柜组共享 objectId，只取 Group 本体，勿把零件也算成柜体。
    if (
      object instanceof THREE.Group &&
      typeof object.userData.objectId === 'string' &&
      object.userData.objectId.startsWith('furniture:study:study_seasonal_wardrobe_wall:')
    ) {
      found.push(object);
    }
  });
  return found;
}

function bboxOf(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function close(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${label}: 期望 ${expected}，实际 ${actual}`);
}

test('行内尺寸柜体按行内宽/深渲染：书房南延腿贴合北柜与墙垛', () => {
  const groups = studyWardrobeGroups();
  assert.equal(groups.length, 3);
  const stub = groups.find((g) => Math.abs(g.position.z - 6.289) < 0.001);
  const tall = groups.find((g) => Math.abs(g.position.z - 7.38) < 0.001);
  const north = groups.find((g) => Math.abs(g.position.z - 5.825) < 0.001);
  assert.ok(stub, '未找到通顶北段 stub（中心 z 6.289）');
  assert.ok(tall, '未找到通顶南段高腿（中心 z 7.38）');
  assert.ok(north, '未找到北段柜（中心 z 5.825）');

  const stubBox = bboxOf(stub);
  // stub 两端是干净的柜体端面：北端贴北段门面 6.128、南端贴边吊南缘 6.45（与高腿面接）。
  close(stubBox.min.z, 6.128, 'stub 北端（贴北段门面）');
  close(stubBox.max.z, 6.45, 'stub 南端（边吊南缘，与高腿面接）');
  // x 向：背板贴墙 4.20 精确；门面/门缝比柜体突出约 0.028（配方固有，北段亦然），故东脸只界定在体面+门面浮动带内。
  close(stubBox.min.x, 4.2, 'stub 西脸（背板贴墙）');
  assert.ok(stubBox.max.x >= 4.75 && stubBox.max.x <= 4.79, `stub 东脸应在体面 4.75 与门面浮动带内，实际 ${stubBox.max.x}`);
  close(stub.scale.x, 0.322 / 1.7, 'stub 局部 x 缩放（0.322/目录 1.70）');
  assert.equal(stub.userData.declaredDimensions?.width, 0.322);
  assert.equal(stub.userData.declaredDimensions?.height, undefined, 'stub 不带 cabinetHeight，不编造高度');

  const tallBox = bboxOf(tall);
  close(tallBox.min.z, 6.45, '高腿北端（边吊南缘，与 stub 面接）');
  close(tallBox.max.z, 8.31, '高腿南端（贴墙垛北脸）');
  close(tallBox.min.x, 4.2, '高腿西脸（背板贴墙）');
  assert.ok(tallBox.max.x >= 4.75 && tallBox.max.x <= 4.79, `高腿东脸应在体面 4.75 与门面浮动带内，实际 ${tallBox.max.x}`);
  close(tall.scale.x, 1.86 / 1.7, '高腿局部 x 缩放（1.86/目录 1.70）');
  assert.equal(tall.userData.declaredDimensions?.width, 1.86);

  const northBox = bboxOf(north);
  close(northBox.min.x, 4.2, '北段西端（齐平顶墙）');
  close(northBox.max.x, 6.0, '北段东端');
  close(northBox.min.z, 5.55, '北段北脸');
  assert.ok(northBox.max.z >= 6.1 && northBox.max.z <= 6.13, `北段南脸应在体面 6.10 与门面浮动带内，实际 ${northBox.max.z}`);
  close(north.scale.x, 1.8 / 1.7, '北段局部 x 缩放（1.80/目录 1.70）');
  assert.equal(north.userData.declaredDimensions?.width, 1.8);
});

test('通顶高腿按行内高度渲染：stub 顶 2.40、高腿顶 2.80', () => {
  const groups = studyWardrobeGroups();
  const stub = groups.find((g) => Math.abs(g.position.z - 6.289) < 0.001);
  const tall = groups.find((g) => Math.abs(g.position.z - 7.38) < 0.001);
  assert.ok(stub, '未找到通顶北段 stub（中心 z 6.289）');
  assert.ok(tall, '未找到通顶南段高腿（中心 z 7.38）');
  const stubBox = bboxOf(stub);
  const tallBox = bboxOf(tall);
  close(stubBox.min.y, 0, 'stub 底（落地）');
  close(tallBox.min.y, 0, '高腿底（落地）');
  close(stubBox.max.y, 2.4, 'stub 顶（2.40，与北段同高，留 0.10 灰缝到边吊底 2.50）');
  close(tallBox.max.y, 2.8, '高腿顶（2.80，贴平顶）');
  close(tall.scale.y, 2.8 / 2.4, '高腿局部 y 缩放（cabinetHeight 2.8 / 配方实建高 2.40）');
  assert.equal(tall.userData.declaredDimensions?.height, 2.8);
});
