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
  assert.equal(groups.length, 2);
  const leg = groups.find((g) => Math.abs(g.position.z - 7.219) < 0.001);
  const north = groups.find((g) => Math.abs(g.position.z - 5.825) < 0.001);
  assert.ok(leg, '未找到南延腿（中心 z 7.219）');
  assert.ok(north, '未找到北段柜（中心 z 5.825）');

  const legBox = bboxOf(leg);
  // 腿两端是干净的柜体端面（无突出件），故 z 向 bbox 即柜体长：北端贴北段门面 6.128、南端贴墙垛北脸 8.31，两端缝隙 0。
  close(legBox.min.z, 6.128, '腿北端（贴北段门面）');
  close(legBox.max.z, 8.31, '腿南端（贴墙垛北脸）');
  // x 向：背板贴墙 4.20 精确；门面/门缝比柜体突出约 0.028（配方固有，北段亦然），故东脸只界定在体面+门面浮动带内。
  close(legBox.min.x, 4.2, '腿西脸（背板贴墙）');
  assert.ok(legBox.max.x >= 4.75 && legBox.max.x <= 4.79, `腿东脸应在体面 4.75 与门面浮动带内，实际 ${legBox.max.x}`);
  close(leg.scale.x, 2.182 / 1.7, '腿局部 x 缩放（2.182/目录 1.70）');
  assert.equal(leg.userData.declaredDimensions?.width, 2.182);

  const northBox = bboxOf(north);
  close(northBox.min.x, 4.2, '北段西端（齐平顶墙）');
  close(northBox.max.x, 6.0, '北段东端');
  close(northBox.min.z, 5.55, '北段北脸');
  assert.ok(northBox.max.z >= 6.1 && northBox.max.z <= 6.13, `北段南脸应在体面 6.10 与门面浮动带内，实际 ${northBox.max.z}`);
  close(north.scale.x, 1.8 / 1.7, '北段局部 x 缩放（1.80/目录 1.70）');
  assert.equal(north.userData.declaredDimensions?.width, 1.8);
});
