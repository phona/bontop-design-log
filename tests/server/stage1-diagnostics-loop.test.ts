/**
 * Issue #98 二阶段 Stage 1 修复轮 Fix 3：家具解算诊断闭环。
 *
 * buildScene 此前把 buildPlacementIndexes 的 furnitureDiagnostics 直接丢掉：逐件循环
 * 只走渲染表（阶段过滤），阶段外宿主的解算失败无任何出口；同时批量索引解算时不带
 * 链锚点，阶段外链条家具在批量侧报失败、逐件侧解出（或反之）。本文件用合成场景证明：
 * 阶段外坏件的诊断补入报告（A）、已渲染件的失败不重复入列（B）、链锚点两路共用——
 * 链正常时阶段外链条家具不误报、链断时其失败与根因一并显形（C）。
 *
 * 全部用合成夹具，不读 config。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HvacDiagram } from '../../shared/hvac-diagram-schema.js';

const WALLS = [{ id: 'w_test', x1: 0, z1: 0, x2: 4, z2: 0, height: 2.8 }];
const ROOMS = [{ id: 'test_room', name: 'Test', x: 2, z: 0, width: 4, depth: 2, height: 2.8, type: 'private' as const, boundary_count: 4 }];

function wallCabinet(id: string, along: number) {
  return {
    id,
    type: 'test_cabinet',
    wall: 'w_test',
    wall_side: 'south' as const,
    along,
    width: 0.4,
    depth: 0.3,
    rotation: 0,
  };
}

test('A：阶段外宿主失败进报告——furnishingsAll 里坏件不在渲染表，批量诊断补入、不静默丢件', async () => {
  const { buildScene } = await import('../../shared/render/SceneBuilder.js');
  const healthy = wallCabinet('test.healthy_cab', 2);
  const broken = wallCabinet('test.broken_cab', 99);
  const result = buildScene({
    rooms: ROOMS,
    walls: WALLS,
    elements: [],
    furnishings: { test_room: [healthy] },
    furnishingsAll: { test_room: [healthy, broken] },
  });
  assert.equal(result.report.placementDiagnostics.length, 1);
  assert.match(
    result.report.placementDiagnostics[0],
    /furniture "test\.broken_cab": wall anchor along=99 places furniture outside wall span/,
  );
  // 批量解算本身的口径：好件进宿主、坏件不进。
  assert.ok(result.index.mountHosts?.get('test.healthy_cab'), '好件必须进 mountHosts');
  assert.equal(result.index.mountHosts?.has('test.broken_cab'), false, '坏件不得进 mountHosts');
});

test('B：已渲染件失败不重复——逐件循环已报的失败，批量诊断不二次入列', async () => {
  const { buildScene } = await import('../../shared/render/SceneBuilder.js');
  const broken = wallCabinet('test.broken_cab', 99);
  const result = buildScene({
    rooms: ROOMS,
    walls: WALLS,
    elements: [],
    furnishings: { test_room: [broken] },
  });
  assert.equal(result.report.placementDiagnostics.length, 1);
  assert.match(
    result.report.placementDiagnostics[0],
    /test_room:test_cabinet: wall anchor along=99 places furniture outside wall span/,
  );
});

test('C1：链正常时阶段外链条家具不误报——批量与逐件共用同一份链锚点', async () => {
  const { buildScene } = await import('../../shared/render/SceneBuilder.js');
  const result = buildScene(chainInputs({ withPenetration: true }));
  assert.deepEqual(result.report.placementDiagnostics, []);
  // 阶段外链条家具在批量侧解出（不误报）且进宿主表。
  assert.ok(
    result.index.mountHosts?.get('mb.vanity_pvc_service_chase_phase2'),
    '阶段外链条家具解出后必须进 mountHosts',
  );
});

test('C2：链断时阶段外链条家具的失败与根因一并显形', async () => {
  const { buildScene } = await import('../../shared/render/SceneBuilder.js');
  const result = buildScene(chainInputs({ withPenetration: false }));
  assert.equal(result.report.placementDiagnostics.length, 2);
  assert.ok(
    result.report.placementDiagnostics.some((line) => line.startsWith('condensate chain:') && line.includes('穿墙点')),
    `根因诊断缺失：${result.report.placementDiagnostics.join(' | ')}`,
  );
  assert.ok(
    result.report.placementDiagnostics.some((line) => line.includes('furniture "mb.vanity_pvc_service_chase_phase2"') && line.includes('condensateChain')),
    `阶段外链条家具的批量诊断缺失：${result.report.placementDiagnostics.join(' | ')}`,
  );
});

/**
 * 复用 condensate-chain.test.ts 的合成 diagram + 穿墙点夹具，另加一件阶段外链条家具。
 * 阶段外房间只进 furnishingsAll（不渲染），与「阶段可见性只管渲染、不管宿主」同口径。
 */
function chainInputs(options: { withPenetration?: boolean } = {}) {
  const diagram = {
    anchors: [{ id: 'indoor_master', status: 'confirmed', system: 'refrigerant', ref: { source: 'ceiling', id: 'ac_master' } }],
    terminals: [{
      id: 'condensate_master_candidate', kind: 'condensate_drain_candidate', status: 'pending', confirmed: false,
      render_interior: false, render_coordination: true, system: 'condensate', position: { x: 2.0, y: 0.1, z: 2.5 },
    }],
    routes: [],
    reference_constraints: [],
  } as unknown as HvacDiagram;
  const furnishings = {
    master_bedroom: [
      { type: 'master_north_wall_wardrobe_950', id: 'mb.wardrobe_950', x: 2.45, z: 4.59, rotation: 0 },
      { type: 'condensate_pipe_ac_outlet', id: 'mb.condensate_pipe', anchor: { source: 'hvac' as const, id: 'indoor_master' }, rotation: 0 },
      { type: 'mb_vanity_pvc_box', id: 'mb.vanity_pvc_box', wall: 'w_mbath_east', wall_side: 'west' as const, along: 2.60, rotation: 270 },
      { type: 'mb_vanity_pvc_wardrobe_entry', id: 'mb.vanity_pvc_wardrobe_entry', anchor: { source: 'chain' as const, id: 'wardrobe_east_band' }, rotation: 0 },
      { type: 'mb_vanity_pvc_service_chase', id: 'mb.vanity_pvc_service_chase', anchor: { source: 'chain' as const, id: 'wardrobe_east_band' }, rotation: 0 },
    ],
  };
  const furnishingsAll = {
    ...furnishings,
    other_room: [
      { type: 'mb_vanity_pvc_service_chase', id: 'mb.vanity_pvc_service_chase_phase2', anchor: { source: 'chain' as const, id: 'wardrobe_east_band' }, rotation: 0 },
    ],
  };
  const walls = [
    { id: 'w_mbath_east', x1: 2.6, z1: 1.1, x2: 2.6, z2: 4.3, height: 2.8 },
    { id: 'w_mb_east', x1: 4.2, z1: 5.55, x2: 4.2, z2: 9.8, height: 2.8 },
    { id: 'w_mbath_south', x1: 0.4, z1: 2.86, x2: 2.6, z2: 2.86, height: 2.8 },
  ];
  const rooms = [{ id: 'master_bedroom', name: '主卧', x: 2.1, z: 5.55, width: 4.2, depth: 4.25, height: 2.8, type: 'private' as const, boundary_count: 4 }];
  return {
    rooms,
    walls,
    elements: [],
    furnishings,
    furnishingsAll,
    options: {
      hvac: { diagram, sources: { ceiling: [{ id: 'ac_master', x: 3.70, z: 5.10, height: 2.85 }] as never } },
      ...(options.withPenetration === false ? {} : { condensatePenetration: { x: 2.30, z: 2.86 } }),
    },
  };
}
