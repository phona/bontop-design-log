// 家具稳定对象 ID（issue #98：PR-1 客卫 vanity / robot_dock，PR-7 全屋 placed 家具）。
// 锁四件事：① 声明 id 即 runtime objectId，房间内重排不变；② 未声明 id 的家具仍用
// `furniture:${room}:${type}:${index}`，带 id 的条目照常占序号，其他家具下标不漂；
// ③ 重复 id 能被 verify:furniture 使用的同一函数识别；④ 全屋 placed 家具无一带漏，
// 且任一房间整体打乱顺序后全部 runtime id 不变（count-only 对照条目无 id）。
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

/** 全屋（或指定房间）runtime 家具 objectId 的有序快照（同一 furnishings 两次调用结果稳定可比）。 */
function allRuntimeFurnitureIds(furnishings: FurnishingsYaml, roomId?: string): string[] {
  const inputs = loadSceneInputs();
  const scene = buildRuntimeScene({ ...inputs, house: { ...inputs.house, furnishings } });
  return scene.index.furnitureMeshes
    .filter((object) => roomId === undefined || object.userData.roomId === roomId)
    .map((object) => String(object.userData.objectId))
    .sort();
}

/**
 * 与 shared/furniture-placement.ts 同口径的「已放置」判定（x/z / wall / along / mount /
 * anchor——2026-11-07 PR-10 起锚点派生也是一种定位声明，见 resolveItem）。
 */
function isPlaced(item: FurnishingItem): boolean {
  return item.x !== undefined || item.z !== undefined || item.wall !== undefined || item.along !== undefined || item.mount !== undefined || item.anchor !== undefined;
}

describe('furnitureObjectId', () => {
  it('uses the declared id, otherwise the indexed fallback', () => {
    assert.equal(furnitureObjectId('guest_bath', { type: 'vanity', id: 'gbath.vanity' }, 0), 'gbath.vanity');
    assert.equal(furnitureObjectId('guest_bath', { type: 'toilet' }, 1), 'furniture:guest_bath:toilet:1');
  });

  it('keeps gbath.vanity / gbath.robot_dock and every other guest_bath id when the two are reordered', () => {
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
    // PR-7 起客卫全部 placed 家具都带稳定 id：重排后同一组 id，没有一件退回下标口径。
    assert.equal(after.get('toilet'), 'gbath.toilet');
    assert.equal(after.get('exhaust_fan'), 'gbath.exhaust_fan');
    assert.equal(after.get('mirror_cabinet_gbath'), 'gbath.mirror_cabinet');
    assert.equal(after.get('heated_towel_rack'), 'gbath.heated_towel_rack');
    assert.equal(after.size, before.size);

    // 对照：去掉 id 后同样的重排会改掉下标 ID——证明上面的不变是 id 带来的。
    // 2026-11-06 issue #98 PR-3 起 robot_dock 改 mount 派生：宿主 id 一并剥掉后它解析不出宿主
    // （断引用诊断、不进场景），这正是稳定 id 承重的直接证据；其余家具下标同样漂移。
    const strip = (items: FurnishingItem[]) => items.map(({ id: _id, ...rest }) => rest);
    const indexedAfter = guestBathRuntimeIds({ ...furnishings, guest_bath: strip(reordered) });
    assert.equal(indexedAfter.get('robot_dock_gbath'), undefined, '剥掉宿主稳定 id 后 mount 断引用，dock 不进场景');
    assert.equal(indexedAfter.get('vanity'), 'furniture:guest_bath:vanity:3');
  });
});

describe('whole-house stable ids (issue #98 PR-7)', () => {
  it('gives every placed furnishing an id and no id to count-only entries', () => {
    const furnishings = loadSceneInputs().house.furnishings ?? {};
    let placed = 0;
    for (const [roomId, items] of Object.entries(furnishings)) {
      items.forEach((item, index) => {
        if (isPlaced(item)) {
          placed++;
          assert.ok(typeof item.id === 'string' && item.id.length > 0, `${roomId}[${index}] ${item.type} 是 placed 却无稳定 id`);
        } else {
          assert.equal(item.id, undefined, `${roomId}[${index}] ${item.type} 是 count-only，不得带 runtime id`);
        }
      });
    }
    // 覆盖全屋每个房间的 placed 家具，而不是只测客卫。
    assert.ok(placed >= 59, `placed 家具应全屋覆盖（当前 ${placed} 件）`);
    const rooms = Object.keys(furnishings).filter((roomId) => (furnishings[roomId] ?? []).some(isPlaced));
    assert.ok(rooms.length >= 10, `应有 ≥10 个房间带 placed 家具（当前 ${rooms.length}）`);
  });

  it('keeps every runtime furniture id when any single room is reordered', () => {
    const furnishings = loadSceneInputs().house.furnishings ?? {};
    const before = allRuntimeFurnitureIds(furnishings);
    assert.ok(before.length >= 59, `runtime 家具对象应全屋覆盖（当前 ${before.length} 个）`);
    // 稳定 id 不带 ':'，按它认不出房间/类型；确认 id 集合本身就是权威。
    assert.ok(before.every((id) => !id.startsWith('furniture:')), `全部 placed 家具都应走稳定 id，仍在下标口径的是：${before.filter((id) => id.startsWith('furniture:'))}`);

    for (const [roomId, items] of Object.entries(furnishings)) {
      if (items.filter(isPlaced).length < 2) continue;
      // 反转即「打乱顺序」：确定性、不引入随机，且对每个多件房间都执行。
      const reversed = [...items].reverse();
      assert.deepEqual(
        allRuntimeFurnitureIds({ ...furnishings, [roomId]: reversed }),
        before,
        `reordering ${roomId} must not change any runtime furniture id`,
      );
    }
  });

  it('control: without ids the same reorder rewrites the indexed ids', () => {
    const furnishings = loadSceneInputs().house.furnishings ?? {};
    const kitchen = furnishings.kitchen ?? [];
    assert.ok(kitchen.filter(isPlaced).length >= 5, 'kitchen 应有多个 placed 家具供对照');
    const strip = (items: FurnishingItem[]) => items.map(({ id: _id, ...rest }) => rest);
    const reversed = strip([...kitchen].reverse());
    const ids = allRuntimeFurnitureIds({ ...furnishings, kitchen: reversed }, 'kitchen');
    // 剥掉 id 后全部退回 `furniture:kitchen:<type>:<index>`，且与带 id 的快照完全不同——
    // 证明上一条的不变性来自声明的稳定 id，不是测试写法造成的恒真。
    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith('furniture:kitchen:')), `kitchen 对照应全走下标口径，实际 ${ids.join(',')}`);
    assert.notDeepEqual(ids, allRuntimeFurnitureIds(furnishings, 'kitchen'));
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
