// shared/package-scope.ts 的回归测试（自装交互审批第一步，2026-11-02）。
// 守：选择器展开只做有真实映射的部分（房间/墙/叠加层区域），点位级不硬展开，
// 全项目范围包不占反查索引。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectPackageIndex, resolvePackageScope, type ProjectScopeInput } from '../../shared/package-scope.js';

const project: ProjectScopeInput = {
  house: {
    rooms: [
      {id: 'kitchen'},
      {id: 'master_bath'},
      {id: 'guest_bath'},
      {id: 'living_dining'},
    ],
    sceneElements: [
      {id: 'wall_region:kitchen_north', type: 'wall_region'},
      {id: 'floor_region:master_bath', type: 'floor_region'},
      {id: 'sill_region:master_bath_west', type: 'sill_region'},
      {id: 'paint_region:living', type: 'paint_region'},
      {id: 'w_kit_north', type: 'wall'},
      {id: 'w_liv_south', type: 'wall'},
      {id: 'sock_kitchen_gas', type: 'socket'},
    ],
  },
};

describe('resolvePackageScope', () => {
  it('room_ids + types + collections 展开成房间与场景对象 id', () => {
    // PKG-050 防水形态：room_ids + types[floor_region, wall_region]
    const result = resolvePackageScope({
      scope: [
        {source: 'model_geometry', select: {room_ids: ['master_bath', 'guest_bath']}},
        {source: 'overlay', select: {types: ['floor_region', 'wall_region']}},
      ],
    }, project);
    assert.deepEqual(result.roomIds, ['master_bath', 'guest_bath']);
    assert.deepEqual(result.objectIds, ['floor_region:master_bath', 'wall_region:kitchen_north']);
    assert.equal(result.projectScope, false);
    assert.deepEqual(result.unresolved, []);
  });

  it('PKG-060 铺贴形态：collections[rooms] 展开全部房间，叠加层区域按 type 收', () => {
    const result = resolvePackageScope({
      scope: [
        {source: 'model_geometry', select: {collections: ['rooms']}},
        {source: 'overlay', select: {types: ['floor_region', 'wall_region', 'sill_region']}},
      ],
    }, project);
    assert.deepEqual(result.roomIds, ['kitchen', 'master_bath', 'guest_bath', 'living_dining']);
    assert.deepEqual(result.objectIds, [
      'floor_region:master_bath',
      'wall_region:kitchen_north',
      'sill_region:master_bath_west',
    ]);
  });

  it('collections[walls] 按场景元素类型收墙 id', () => {
    const result = resolvePackageScope({
      scope: [{source: 'model_geometry', select: {collections: ['walls', 'openings']}}],
    }, project);
    assert.deepEqual(result.objectIds, ['w_kit_north', 'w_liv_south']);
    // openings 不是顶层场景元素（挂在 wall.openings 下）——明示不展开，不静默丢弃
    assert.deepEqual(result.unresolved, ['model_geometry.collections: openings']);
  });

  it('点位级选择器（layers/trade/plan_ids）本步不展开，进 unresolved', () => {
    const result = resolvePackageScope({
      scope: [{
        source: 'electrical',
        select: {layers: ['strong_power', 'weak_power'], ids: ['sock_kitchen_gas'], trade: ['curtain_box']},
      }],
    }, project);
    assert.deepEqual(result.objectIds, ['sock_kitchen_gas']);
    assert.equal(result.unresolved.length, 2);
    assert.ok(result.unresolved.some((entry) => entry.includes('layers: strong_power,weak_power')));
    assert.ok(result.unresolved.some((entry) => entry.includes('trade: curtain_box')));
  });

  it('select all → projectScope，不给 3D 位置', () => {
    const result = resolvePackageScope({
      scope: [{source: 'model_geometry', select: {all: true}}],
    }, project);
    assert.equal(result.projectScope, true);
    assert.deepEqual(result.roomIds, []);
    assert.deepEqual(result.objectIds, []);
  });

  it('不存在的 room_id 被收掉（不与场景对不上）', () => {
    const result = resolvePackageScope({
      scope: [{source: 'model_geometry', select: {room_ids: ['ghost_room']}}],
    }, project);
    assert.deepEqual(result.roomIds, []);
  });
});

describe('buildObjectPackageIndex', () => {
  it('一个对象可属多个包（铺贴与美缝都压 floor_region），全项目范围包不占位', () => {
    const index = buildObjectPackageIndex([
      {id: 'MODEL-PKG-000', budget_ref: {id: 'PKG-000'}, scope: [{source: 'model_geometry', select: {all: true}}]},
      {id: 'MODEL-PKG-060', budget_ref: {id: 'PKG-060'}, scope: [{source: 'overlay', select: {types: ['floor_region']}}]},
      {id: 'MODEL-PKG-130', budget_ref: {id: 'PKG-130'}, scope: [{source: 'overlay', select: {types: ['floor_region']}}]},
    ], project);
    assert.deepEqual(index.get('floor_region:master_bath'), ['PKG-060', 'PKG-130']);
    assert.equal(index.get('w_kit_north'), undefined, '全项目范围包不得占反查');
  });
});
