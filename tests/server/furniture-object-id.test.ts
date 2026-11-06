// 家具稳定对象 ID（issue #98 PR-1：客卫 vanity / robot_dock）。
// 锁三件事：① 声明 id 即 runtime objectId，房间内重排不变；② 未声明 id 的家具仍用
// `furniture:${room}:${type}:${index}`，带 id 的条目照常占序号，其他家具下标不漂；
// ③ 重复 id 能被 verify:furniture 使用的同一函数识别。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateFurnitureIds, furnitureObjectId } from '../../shared/furniture-object-id.js';
import { buildRuntimeScene, loadSceneInputs } from '../../shared/penetration/scene.js';
import type { FurnishingItem, FurnishingsYaml } from '../../shared/types.js';

function guestBathRuntimeIds(furnishings: FurnishingsYaml): Map<string, string> {
  const inputs = loadSceneInputs();
  const scene = buildRuntimeScene({ ...inputs, house: { ...inputs.house, furnishings } });
  // key = 类型（客卫每类 placed 家具各一件），value = runtime objectId
  const ids = new Map<string, string>();
  for (const object of scene.index.furnitureMeshes) {
    if (object.userData.roomId !== 'guest_bath') continue;
    ids.set(String(object.userData.furnishingType), String(object.userData.objectId));
  }
  return ids;
}

describe('furnitureObjectId', () => {
  it('uses the declared id, otherwise the indexed fallback', () => {
    assert.equal(furnitureObjectId('guest_bath', { type: 'vanity', id: 'gbath.vanity' }, 0), 'gbath.vanity');
    assert.equal(furnitureObjectId('guest_bath', { type: 'toilet' }, 1), 'furniture:guest_bath:toilet:1');
  });

  it('keeps gbath.vanity / gbath.robot_dock and every other guest_bath index when the two are reordered', () => {
    const furnishings = loadSceneInputs().house.furnishings ?? {};
    const guestBath = furnishings.guest_bath ?? [];
    const vanityAt = guestBath.findIndex((item) => item.type === 'vanity');
    const dockAt = guestBath.findIndex((item) => item.type === 'robot_dock_gbath');
    assert.ok(vanityAt >= 0 && dockAt >= 0, 'guest_bath must declare vanity and robot_dock_gbath');
    assert.equal(guestBath[vanityAt].id, 'gbath.vanity');
    assert.equal(guestBath[dockAt].id, 'gbath.robot_dock');

    const reordered: FurnishingItem[] = [...guestBath];
    [reordered[vanityAt], reordered[dockAt]] = [reordered[dockAt], reordered[vanityAt]];

    const before = guestBathRuntimeIds(furnishings);
    const after = guestBathRuntimeIds({ ...furnishings, guest_bath: reordered });

    assert.equal(before.get('vanity'), 'gbath.vanity');
    assert.equal(before.get('robot_dock_gbath'), 'gbath.robot_dock');
    assert.deepEqual([...after.entries()].sort(), [...before.entries()].sort(), 'swapping the two stable-id entries must not change any guest_bath runtime id');
    // 其他家具仍走下标口径，且下标不因两件带 id 的家具而漂移。
    assert.equal(after.get('toilet'), 'furniture:guest_bath:toilet:1');
    assert.equal(after.get('exhaust_fan'), 'furniture:guest_bath:exhaust_fan:2');
    assert.equal(after.get('mirror_cabinet_gbath'), 'furniture:guest_bath:mirror_cabinet_gbath:3');
    assert.equal(after.get('heated_towel_rack'), 'furniture:guest_bath:heated_towel_rack:5');

    // 对照：去掉 id 后同样的重排会改掉两件的下标 ID——证明上面的不变是 id 带来的。
    const strip = (items: FurnishingItem[]) => items.map(({ id: _id, ...rest }) => rest);
    const indexedAfter = guestBathRuntimeIds({ ...furnishings, guest_bath: strip(reordered) });
    assert.equal(indexedAfter.get('vanity'), 'furniture:guest_bath:vanity:4');
    assert.equal(indexedAfter.get('robot_dock_gbath'), 'furniture:guest_bath:robot_dock_gbath:0');
  });
});

describe('findDuplicateFurnitureIds', () => {
  it('reports an id declared twice, across rooms', () => {
    const duplicates = findDuplicateFurnitureIds({
      guest_bath: [{ type: 'vanity', id: 'gbath.vanity' }, { type: 'toilet' }],
      master_bath: [{ type: 'vanity', id: 'gbath.vanity' }],
    });
    assert.deepEqual(duplicates, [{ id: 'gbath.vanity', entries: ['guest_bath/vanity[0]', 'master_bath/vanity[0]'] }]);
  });

  it('finds no duplicate in the current house.yaml', () => {
    assert.deepEqual(findDuplicateFurnitureIds(loadSceneInputs().house.furnishings ?? {}), []);
  });
});
