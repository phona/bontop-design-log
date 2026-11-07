// shared/package-scope.ts 的回归测试（自装交互审批第一步，2026-11-02）。
// 守：选择器展开只做有真实映射的部分（房间/墙/叠加层区域），点位级不硬展开，
// 全项目范围包不占反查索引。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { buildObjectPackageIndex, isPointSourceAllSelector, resolvePackageScope, sourceWallIdOf, type ProjectScopeInput } from '../../shared/package-scope.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';
import { resolveLayout } from '../../server/layout-resolver.js';
import { mergeSceneElements, parseOverlayFiles } from '../../server/overlay-merge.js';
import { buildScene } from '../../shared/render/SceneBuilder.js';
import { loadCeilingConfig } from '../../server/config-loader.js';

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
    // 点位全量清单（/api/project 的 house.electrical / house.plumbing）：点位来源
    // select.all 的唯一展开源。sceneElements 里没有点位，别去那儿找。
    electrical: [
      {id: 'sock_living_ac'},
      {id: 'sock_kitchen_gas'},
      {id: 'panel_strong_entry_left'},
    ],
    plumbing: [
      {id: 'faucet_kitchen'},
      {id: 'drain_kitchen'},
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
    assert.deepEqual(result.pointIds, []);
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

  it('点位级选择器：ids 归一化成场景 objectId（<来源>:<裸id>），layers/trade 进 unresolved', () => {
    const result = resolvePackageScope({
      scope: [{
        source: 'electrical',
        select: {layers: ['strong_power', 'weak_power'], ids: ['sock_kitchen_gas'], trade: ['curtain_box']},
      }],
    }, project);
    // 点位是合批渲染，按 batchUserData.objectId 逐实例命中——不许混进 objectIds 充数（2026-11-02 评审 P1）
    assert.deepEqual(result.objectIds, []);
    // 裸 id → 场景约定 id。2026-11-02 真实浏览器实证：links 的 select.ids 一律裸 id、
    // 场景 objectId 一律带 electrical:/plumbing: 前缀，两边不匹配时 ids 选择器的点位
    // 高亮经 UI 全部静默 no-op、点位反查同样断——mock 用裸 id 所以照不到。
    assert.deepEqual(result.pointIds, ['electrical:sock_kitchen_gas']);
    assert.equal(result.unresolved.length, 2);
    assert.ok(result.unresolved.some((entry) => entry.includes('layers: strong_power,weak_power')));
    assert.ok(result.unresolved.some((entry) => entry.includes('trade: curtain_box')));
  });

  it('plumbing ids 同样加 plumbing: 前缀；未登记来源带 ids 显形不静默', () => {
    const result = resolvePackageScope({
      scope: [
        {source: 'plumbing', select: {ids: ['faucet_kitchen', 'drain_kitchen']}},
        {source: 'mystery_source', select: {ids: ['whatever']}},
      ],
    }, project);
    assert.deepEqual(result.pointIds, ['plumbing:faucet_kitchen', 'plumbing:drain_kitchen']);
    // 前缀约定未知的来源：不进 pointIds（造出来也对不上），显形给 UI
    assert.equal(result.unresolved.length, 1);
    assert.ok(result.unresolved[0].includes('mystery_source.ids'));
  });

  it('非点位来源的 select all → projectScope，不给 3D 位置', () => {
    const result = resolvePackageScope({
      scope: [{source: 'model_geometry', select: {all: true}}],
    }, project);
    assert.equal(result.projectScope, true);
    assert.deepEqual(result.roomIds, []);
    assert.deepEqual(result.objectIds, []);
    assert.deepEqual(result.pointIds, []);
  });

  // 2026-11-04 issue #65：select.all 按来源分流。PKG-040（水电改造）声明
  // electrical/plumbing select.all，本意「高亮全部水电点位」；旧实现一律短路成
  // projectScope，解析出 0 个点位、「在 3D 中高亮」因此被判「没有具体 3D 范围」而禁用。
  it('点位来源的 select all → 该分类全部点位 id（带场景 objectId 前缀）', () => {
    const result = resolvePackageScope({
      scope: [
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
      ],
    }, project);
    assert.equal(result.projectScope, false, '点位来源的 all 不全项目范围短路');
    assert.deepEqual(result.pointIds, [
      'electrical:sock_living_ac',
      'electrical:sock_kitchen_gas',
      'electrical:panel_strong_entry_left',
      'plumbing:faucet_kitchen',
      'plumbing:drain_kitchen',
    ]);
    // 点位不许混进 objectIds 充数（合批渲染按 batchUserData.objectId 逐实例命中）
    assert.deepEqual(result.objectIds, []);
    assert.deepEqual(result.roomIds, []);
    assert.deepEqual(result.unresolved, []);
  });

  it('点位来源的 all 与真实 PKG-040 同形：electrical_topology 的 all 仍判全项目范围徽标，点位照展', () => {
    // config/model-package-links.yaml 的 MODEL-PKG-040 原文：electrical/plumbing all +
    // electrical_topology all + mep_routes layers。回路级（electrical_topology）没有
    // 3D 位置，维持全项目范围徽标；但水电点位必须展得开——徽标与高亮能力并存。
    const result = resolvePackageScope({
      scope: [
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
        {source: 'electrical_topology', select: {all: true}},
        {source: 'mep_routes', select: {layers: ['strong_power', 'weak_power', 'water_supply', 'drainage']}},
      ],
    }, project);
    assert.equal(result.projectScope, true);
    assert.equal(result.pointIds.length, 5);
    assert.ok(result.pointIds.includes('plumbing:drain_kitchen'));
    // layers 仍不展开（人读说明），不静默丢弃
    assert.ok(result.unresolved.some((entry) => entry.includes('mep_routes.layers: strong_power')));
  });

  it('点位来源的 all 但项目数据没有该分类清单 → 显形 unresolved，不静默出 0 个点位', () => {
    const result = resolvePackageScope({
      scope: [{source: 'electrical', select: {all: true}}],
    }, {house: {rooms: project.house.rooms, sceneElements: []}});
    assert.deepEqual(result.pointIds, []);
    assert.equal(result.unresolved.length, 1);
    assert.ok(result.unresolved[0].includes('electrical.all'));
    assert.ok(result.unresolved[0].includes('house.electrical'));
  });

  // 2026-11-04 PR #76 codex major：显式 mapping_status: project_scope 的整屋包不按
  // 选择器展开。真实 MODEL-PKG-142（临时入住整屋放行）就是 electrical/plumbing
  // select.all + project_scope——#65 之后它会被展成 137 个点位（104 电气 + 33 给排水），
  // 详情面板据此计数并启用「在 3D 中高亮」，而 FlowChartPanel 按 project_scope 判
  // 全项目、禁用高亮，两个入口行为矛盾。与上面 PKG-040 两条测试并排钉住：同形
  // select.all，由 mapping_status 定分流——#65 的口径不得被本修复改回归。
  it('显式 project_scope 的整屋包（PKG-142）分类 select.all 不展开成点位，维持全项目范围', () => {
    const result = resolvePackageScope({
      // config/model-package-links.yaml 的 MODEL-PKG-142 同形（mapping_status: project_scope）
      mapping_status: 'project_scope',
      scope: [
        {source: 'model_geometry', select: {all: true}},
        {source: 'overlay', select: {all: true}},
        {source: 'furnishings', select: {all: true}},
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
        {source: 'electrical_topology', select: {all: true}},
        {source: 'mep_routes', select: {all: true}},
        {source: 'hvac', select: {all: true}},
        {source: 'ceiling', select: {all: true}},
      ],
    }, project);
    assert.equal(result.projectScope, true);
    // 整屋包的分类 all 不拆成点位（旧实现这里会是 5 个 mock 点位、真实配置 137 个）
    assert.deepEqual(result.pointIds, []);
    assert.deepEqual(result.roomIds, []);
    assert.deepEqual(result.objectIds, []);
    assert.deepEqual(result.unresolved, []);
  });

  it('对照：同一组 select.all 去掉 mapping_status 仍按 #65 展开全部点位（PKG-040 不回归）', () => {
    // 与上一条只差 mapping_status：证明分流判据是显式声明，不是 select.all 本身
    const result = resolvePackageScope({
      mapping_status: 'partial',
      scope: [
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
      ],
    }, project);
    assert.equal(result.projectScope, false);
    assert.deepEqual(result.pointIds, [
      'electrical:sock_living_ac',
      'electrical:sock_kitchen_gas',
      'electrical:panel_strong_entry_left',
      'plumbing:faucet_kitchen',
      'plumbing:drain_kitchen',
    ]);
  });

  it('ceiling/hvac 的 all 仍判全项目范围（house 下没有可比照的点位清单）', () => {
    const result = resolvePackageScope({
      scope: [
        {source: 'ceiling', select: {all: true}},
        {source: 'hvac', select: {all: true}},
      ],
    }, project);
    assert.equal(result.projectScope, true);
    assert.deepEqual(result.pointIds, []);
    assert.deepEqual(result.unresolved, []);
  });

  it('isPointSourceAllSelector：只认 electrical/plumbing 的 all', () => {
    assert.equal(isPointSourceAllSelector({source: 'electrical', select: {all: true}}), true);
    assert.equal(isPointSourceAllSelector({source: 'plumbing', select: {all: true}}), true);
    assert.equal(isPointSourceAllSelector({source: 'model_geometry', select: {all: true}}), false);
    assert.equal(isPointSourceAllSelector({source: 'electrical_topology', select: {all: true}}), false);
    assert.equal(isPointSourceAllSelector({source: 'ceiling', select: {all: true}}), false);
    // all 之外的形态都不是（ids 走 select.ids 归一化，不在此列）
    assert.equal(isPointSourceAllSelector({source: 'electrical', select: {ids: ['sock_x']}}), false);
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

  it('点位 id 也进反查索引，键是带前缀的场景 objectId（与拾取侧解析值对齐）', () => {
    const index = buildObjectPackageIndex([
      {id: 'MODEL-PKG-145', budget_ref: {id: 'PKG-145'}, scope: [{source: 'electrical', select: {ids: ['sock_kitchen_gas']}}]},
    ], project);
    // 拾取侧 targetFromIntersects 从 batchUserData 解析出的 objectId 带前缀——
    // 索引键必须是同一形式，裸 id 键会让点点位的反查静默落空（浏览器实证）。
    assert.deepEqual(index.get('electrical:sock_kitchen_gas'), ['PKG-145']);
    assert.equal(index.get('sock_kitchen_gas'), undefined, '裸 id 键是坏口径，不得回退');
  });

  // 2026-11-04 issue #65：点位来源的 select.all 不再是全项目范围，于是它展开出的
  // 全部点位也照常占反查——点任一水电点位能反查到 PKG-040 这类包。
  it('点位来源的 select.all 展开出的点位占反查索引（不再被全项目范围规则跳过）', () => {
    const index = buildObjectPackageIndex([
      {id: 'MODEL-PKG-040', budget_ref: {id: 'PKG-040'}, scope: [
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
      ]},
    ], project);
    assert.deepEqual(index.get('electrical:sock_living_ac'), ['PKG-040']);
    assert.deepEqual(index.get('plumbing:drain_kitchen'), ['PKG-040']);
  });

  it('真实 PKG-040 形态（含 electrical_topology all）仍不占反查：全项目范围规则不变', () => {
    // 边界登记：electrical_topology {all: true} 让 projectScope 保持 true，按既有
    // 不变量「全项目范围的包不占反查」整条 link 跳过——高亮侧不受影响（点位照展）。
    const index = buildObjectPackageIndex([
      {id: 'MODEL-PKG-040', budget_ref: {id: 'PKG-040'}, scope: [
        {source: 'electrical', select: {all: true}},
        {source: 'electrical_topology', select: {all: true}},
      ]},
    ], project);
    assert.equal(index.get('electrical:sock_living_ac'), undefined);
  });

  // 2026-11-04 PR #76 codex major：显式 project_scope 的整屋包（MODEL-PKG-142）
  // 不占反查——它的 electrical/plumbing all 不再展成点位（resolvePackageScope 的
  // project_scope 短路），反查侧同样不得把整屋范围摊到具体对象上。
  it('显式 project_scope 的整屋包（PKG-142）不占反查索引', () => {
    const index = buildObjectPackageIndex([
      {id: 'MODEL-PKG-142', budget_ref: {id: 'PKG-142'}, mapping_status: 'project_scope', scope: [
        {source: 'model_geometry', select: {all: true}},
        {source: 'electrical', select: {all: true}},
        {source: 'plumbing', select: {all: true}},
      ]},
    ], project);
    assert.equal(index.get('electrical:sock_living_ac'), undefined);
    assert.equal(index.get('plumbing:drain_kitchen'), undefined);
    assert.equal(index.size, 0);
  });
});

// 2026-11-06（issue #98 PR-4）：真实 links 配置按**稳定 id** 选家具对象。
// MODEL-PKG-100 / MODEL-PKG-160 原按 type 选 vanity / robot_dock_gbath——治的失效模式
// 与 tests/server/model-package-links.test.ts 同源：删/改类型后忘了同步选择器，
// assertSelector 抛错、/api/project 500；且 furnishings 的 types 选择器按 sceneElements
// 匹配，而 sceneElements 只有墙与叠加层（mergeSceneElements）、不含家具，从来解析不出
// 对象——silent no-op。改成 ids 后，正查高亮与反查归属同时生效。
describe('issue #98 PR-4： furnishings ids 选择器 ↔ 包/验收项（真实 links）', () => {
  const links = loadModelPackageLinks();
  const gbathProject: ProjectScopeInput = {
    house: {
      rooms: [{id: 'master_bath'}, {id: 'guest_bath'}, {id: 'master_bedroom'}],
      sceneElements: [
        {id: 'gbath.vanity', type: 'vanity'},
        {id: 'gbath.robot_dock', type: 'robot_dock_gbath'},
      ],
    },
  };

  it('反查：gbath.vanity → PKG-100，gbath.robot_dock → PKG-160', () => {
    const index = buildObjectPackageIndex(links.links, gbathProject);
    assert.ok(
      index.get('gbath.vanity')?.includes('PKG-100'),
      `点客卫台盆柜应反查到 PKG-100，实际 ${JSON.stringify(index.get('gbath.vanity'))}`,
    );
    assert.ok(
      index.get('gbath.robot_dock')?.includes('PKG-160'),
      `点基站泊位应反查到 PKG-160，实际 ${JSON.stringify(index.get('gbath.robot_dock'))}`,
    );
  });

  it('正查 PKG-100：gbath.vanity 进 objectIds，furnishings ids 不再落 unresolved', () => {
    const link = links.links.find((item) => item.id === 'MODEL-PKG-100');
    assert.ok(link, 'MODEL-PKG-100 必须存在');
    const result = resolvePackageScope(link, gbathProject);
    assert.ok(result.objectIds.includes('gbath.vanity'));
    assert.ok(
      !result.unresolved.some((entry) => entry.includes('furnishings.ids')),
      `furnishings ids 是场景 objectId 裸值，不该进 unresolved：${JSON.stringify(result.unresolved)}`,
    );
  });

  it('正查 PKG-160：gbath.robot_dock 进 objectIds，水电点位仍走点位前缀', () => {
    const link = links.links.find((item) => item.id === 'MODEL-PKG-160');
    assert.ok(link, 'MODEL-PKG-160 必须存在');
    const result = resolvePackageScope(link, gbathProject);
    assert.ok(result.objectIds.includes('gbath.robot_dock'));
    assert.ok(result.pointIds.includes('plumbing:faucet_gbath_vanity'));
    assert.ok(result.pointIds.includes('electrical:sock_gbath_robot'));
  });

  it('验收项按对象 id 可追溯：check_plumb_external_vanity_waterproof 点名 gbath.vanity 且挂 PKG-050', () => {
    const acceptance = parseYaml(readFileSync('config/acceptance.yaml', 'utf8')) as {
      phases: Array<{ items: Array<{ id: string; item: string; standard: string }> }>;
    };
    const check = acceptance.phases.flatMap((phase) => phase.items).find((item) => item.id === 'check_plumb_external_vanity_waterproof');
    assert.ok(check, 'check_plumb_external_vanity_waterproof 必须存在');
    assert.ok(check.item.includes('gbath.vanity'), `验收项应点名对象 id：${check.item}`);
    assert.ok(check.standard.includes('gbath.vanity'), `判定标准应引用对象 id：${check.standard}`);

    const control = parseYaml(readFileSync('schedule/phase-1/control.yaml', 'utf8')) as {
      work_packages: Array<{ id: string; acceptance_refs?: string[] }>;
    };
    const pkg050 = control.work_packages.find((pkg) => pkg.id === 'PKG-050');
    assert.ok(pkg050?.acceptance_refs?.includes('check_plumb_external_vanity_waterproof'), 'PKG-050 应挂接该验收项');
  });
});

// ── 生产 links × 生产场景：选择器 id 必须真的能在 3D 里命中 ────────────────────
// 2026-11-07 issue #98 第三阶段 S4 评审 blocking：面层配方下沉后 MODEL-PKG-050/060/
// 065/080/130/135 的 scope 从「配方 id」改为「宿主对象稳定 id」（墙 / bay_sill）。
// 但墙 mesh 的 objectId 在开门洞拆段/共墙拆面后是 `墙id:N`/`墙id:N.M`（SceneBuilder
// addWallElement 的 baseId/objectId 两行），裸墙 id 只属于无洞且单面跨度的墙——实测
// 52 面墙里 15 面命中不了，正查高亮与反查归属都会静默 no-op（本文件头注记载的
// 2026-11-02「ids 选择器静默 no-op、mock 测试照不到」同一失效类）。
// 消费侧（HouseScene.applyEmissiveHighlight / App.revealPackageForObject）已按
// sourceWallIdOf 做二级命中；本门禁钉的是**另一侧**：每个 link 的 objectIds 都必须
// 能在 buildScene 的真实产出里命中（直接命中或经源墙 id 桥接命中），
// 且反过来桥接不能把不是墙的对象错配过来。
describe('生产 links 的 objectIds 必须能在 buildScene 产出里命中（S4 宿主对象选择器）', () => {
  function productionScene() {
    const mg = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0];
    const layout = resolveLayout(mg);
    const merged = mergeSceneElements(layout.walls as never, parseOverlayFiles());
    const scene = buildScene({
      walls: layout.walls,
      rooms: layout.rooms,
      elements: merged,
      ceilingZones: loadCeilingConfig(),
      furnishings: {},
    } as never) as unknown as {exportRoot: {traverse: (fn: (o: never) => void) => void}};
    const objectIds = new Set<string>();
    scene.exportRoot.traverse((object: never) => {
      const userData = (object as {userData?: {objectId?: string}}).userData;
      if (userData?.objectId) objectIds.add(userData.objectId);
    });
    // 源墙 id 集合：桥接的兜底域（`墙id:N`/`墙id:N.M` → 墙id）
    const sourceWallIds = new Set([...objectIds].map(sourceWallIdOf));
    return {objectIds, sourceWallIds};
  }

  it('每条带宿主对象 id 的 link：objectIds 全部可在场景里命中（直接或经源墙 id 桥接）', () => {
    const links = loadModelPackageLinks();
    const mg = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0];
    const layout = resolveLayout(mg);
    const project: ProjectScopeInput = {
      house: {
        rooms: layout.rooms.map((room) => ({id: room.id})),
        sceneElements: mergeSceneElements(layout.walls as never, parseOverlayFiles()).map((element) => ({id: element.id, type: element.type})),
      },
    };
    const {objectIds, sourceWallIds} = productionScene();
    const checked: string[] = [];
    for (const link of links.links) {
      const {objectIds: scopeIds, projectScope} = resolvePackageScope(link, project);
      if (projectScope) continue;
      // 只查墙/围护构件宿主 id（点位与家具各有自己的前缀/裸值约定，由其他用例守）
      const hostIds = scopeIds.filter((id) => /^w_/.test(id) || /_(bay|waterproof_ledge)$/.test(id));
      for (const id of hostIds) {
        const hit = objectIds.has(id) || sourceWallIds.has(id);
        assert.ok(hit, `${link.id} 的宿主对象 id ${id} 在 buildScene 产出里命中不了（objectId 直接命中与 sourceWallIdOf 桥接都失败）——选择器又会静默 no-op`);
      }
      if (hostIds.length) checked.push(`${link.id}:${hostIds.length}`);
    }
    // S4 改写的 6 条必须真的被检查到（否则本门禁空转）
    for (const id of ['MODEL-PKG-050', 'MODEL-PKG-060', 'MODEL-PKG-065', 'MODEL-PKG-080', 'MODEL-PKG-130', 'MODEL-PKG-135']) {
      assert.ok(checked.some((entry) => entry.startsWith(id)), `${id} 应带宿主对象 id 并接受命中检查`);
    }
  });

  it('桥接方向正确：只有墙 mesh 的后缀 id 才桥回墙 id，构件 id 不被桥接篡改', () => {
    assert.equal(sourceWallIdOf('w_mbath_east'), 'w_mbath_east');
    assert.equal(sourceWallIdOf('w_mbath_east:0'), 'w_mbath_east');
    assert.equal(sourceWallIdOf('w_mbath_east:0.1'), 'w_mbath_east');
    // 墙 id 不含 ':'，截第一个 ':' 即得源墙；构件/点位的冒号属另一套前缀约定，
    // 不经本函数（点位的 electrical:/plumbing: 由 POINT_SOURCE_PREFIXES 归一化）
    assert.equal(sourceWallIdOf('master_bath_west_bay'), 'master_bath_west_bay');
  });

  it('反查索引按桥接后可命中：buildObjectPackageIndex 的墙键与场景 objectId 对得上', () => {
    const links = loadModelPackageLinks();
    const mg = parseYaml(readFileSync('config/layout/model-geometry.yaml', 'utf8')) as Parameters<typeof resolveLayout>[0];
    const layout = resolveLayout(mg);
    const project: ProjectScopeInput = {
      house: {
        rooms: layout.rooms.map((room) => ({id: room.id})),
        sceneElements: mergeSceneElements(layout.walls as never, parseOverlayFiles()).map((element) => ({id: element.id, type: element.type})),
      },
    };
    const index = buildObjectPackageIndex(links.links, project);
    const {objectIds} = productionScene();
    // 索引里的每个墙键，必须至少有一个场景 objectId 直接等于它或桥回它
    const wallKeys = [...index.keys()].filter((key) => /^w_/.test(key));
    assert.ok(wallKeys.length > 0, '索引里应有墙键');
    const sceneWallIds = new Set([...objectIds].map(sourceWallIdOf));
    for (const key of wallKeys) {
      assert.ok(
        objectIds.has(key) || sceneWallIds.has(key),
        `索引墙键 ${key} 在场景里没有对应 objectId（点这面墙反查不到包）`,
      );
    }
  });
});
