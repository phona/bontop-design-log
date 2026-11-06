import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCondensateChain,
  diffCondensateChainPlanAgainstMep,
  type BuildCondensateChainInput,
} from '../../shared/condensate-chain.js';
import { resolveFurniturePlacement } from '../../shared/furniture-placement.js';
import type { HvacDiagram } from '../../shared/types.js';

// 主卫冷凝链锚点派生的回归（issue #98 PR-10）。设计值口径：ac_master (3.70,5.10)；
// 衣柜 mb.wardrobe_950 (2.45,4.59) 0.95×0.58 → 东缘 2.925、南缘 4.30；w_mb_east 线 4.20 →
// 卧室侧完成面 4.14 − 40mm = 4.10；w_mbath_east 线 2.60 → 西完成面 2.54 − 40mm = 2.50；
// 服务带 = 衣柜中心 4.59 + 0.03 = 4.62；墙行包管 along 2.60（沿墙距离，自起点顶点
// v_bath_ne z=1.10 起算 → 世界锚点 z=3.70，与 house.yaml 实配一致）、宽 1.20 → z[3.10,4.30]；
// MEP 穿墙点 (2.30,2.86)；候选点 (2.00,2.50,y0.10)。
const anchors: Pick<BuildCondensateChainInput, 'hvacAnchors' | 'hvacTerminals' | 'mepRoute'> = {
  hvacAnchors: new Map([['indoor_master', { x: 3.70, z: 5.10 }]]),
  hvacTerminals: [{ id: 'condensate_master_candidate', position: { x: 2.0, y: 0.1, z: 2.5 } }],
  mepRoute: { penetration: [{ wall: 'w_mbath_south', at: { x: 2.30, z: 2.86 } }] },
};
const wardrobe = { type: 'master_north_wall_wardrobe_950', id: 'mb.wardrobe_950', x: 2.45, z: 4.59, rotation: 0 };
const wallRun = { type: 'mb_vanity_pvc_box', id: 'mb.vanity_pvc_box', wall: 'w_mbath_east', wall_side: 'west' as const, along: 2.60, rotation: 270 };
const wallSegments = new Map<string, Array<{ x1: number; z1: number; x2: number; z2: number }>>([
  ['w_mb_east', [{ x1: 4.20, z1: 5.55, x2: 4.20, z2: 9.80 }]],
  ['w_mbath_east', [{ x1: 2.60, z1: 1.10, x2: 2.60, z2: 4.30 }]],
  ['w_mbath_south', [{ x1: 0.40, z1: 2.86, x2: 2.60, z2: 2.86 }]],
]);

function chainWith(overrides: Partial<BuildCondensateChainInput> = {}) {
  return buildCondensateChain({ ...anchors, wardrobe, wallRun, wallSegments, ...overrides });
}

test('主卫冷凝链按锚点解出设计值折线，接口全部由共同锚点算出', () => {
  const { geometry, diagnostics } = chainWith();
  assert.deepEqual(diagnostics, []);
  assert.ok(geometry);
  assert.equal(geometry.placements.condensate_pipe_ac_outlet.x, 3.70);
  assert.equal(geometry.placements.condensate_pipe_ac_outlet.z, 5.10);
  assert.ok(Math.abs(geometry.placements.mb_vanity_pvc_wardrobe_entry.x - 2.925) < 1e-9);
  assert.equal(geometry.placements.mb_vanity_pvc_wardrobe_entry.z, 4.62);
  assert.ok(Math.abs(geometry.placements.mb_vanity_pvc_service_chase.x - 2.925) < 1e-9);
  assert.equal(geometry.placements.mb_vanity_pvc_service_chase.z, 4.62);
  assert.ok(Math.abs(geometry.derived.boxTurnX - 4.10) < 1e-9);
  assert.ok(Math.abs(geometry.derived.wallRunX - 2.50) < 1e-9);
  assert.ok(Math.abs(geometry.derived.serviceBandZ - 4.62) < 1e-9);
  assert.ok(Math.abs(geometry.derived.wallRunSouthZ - 3.10) < 1e-9);
  assert.ok(Math.abs(geometry.derived.penetrationWallBedroomFinishZ - 2.92) < 1e-9);
  // 平面折线与 MEP condensate-master 的 10 点一一对应（verify:furniture 亦逐点对照）。
  // 容差 1e-9：衣柜东缘 2.45+0.475 在二进制下是 2.9250000000000003。
  const expectedPlan = [
    { x: 3.70, z: 5.10 },
    { x: 4.10, z: 5.10 },
    { x: 4.10, z: 4.62 },
    { x: 2.925, z: 4.62 },
    { x: 2.50, z: 4.62 },
    { x: 2.50, z: 4.30 },
    { x: 2.50, z: 3.10 },
    { x: 2.30, z: 3.10 },
    { x: 2.30, z: 2.50 },
    { x: 2.00, z: 2.50 },
  ];
  assert.equal(geometry.plan.length, expectedPlan.length);
  geometry.plan.forEach((point, index) => {
    assert.ok(Math.abs(point.x - expectedPlan[index].x) < 1e-9 && Math.abs(point.z - expectedPlan[index].z) < 1e-9, `折点 ${index + 1}: (${point.x},${point.z})`);
  });
  // 相邻段共享端点（接口重合断言）。
  geometry.segments.forEach((segment, index) => {
    if (index === 0) return;
    const previous = geometry.segments[index - 1];
    assert.ok(
      Math.hypot(previous.to.x - segment.from.x, previous.to.z - segment.from.z) < 1e-9,
      `段 ${previous.id} → ${segment.id} 接口不重合`,
    );
  });
});

test('移动衣柜：服务带锚点与 entry/chase 两段一起跟随，接口仍重合', () => {
  const { geometry, diagnostics } = chainWith({ wardrobe: { ...wardrobe, x: 2.55 } });
  assert.deepEqual(diagnostics, []);
  assert.ok(geometry);
  // 东缘 2.925 → 3.025：entry 西端与 chase 原点同步东移，outlet 不动（它挂内机锚点）。
  assert.ok(Math.abs(geometry.placements.mb_vanity_pvc_wardrobe_entry.x - 3.025) < 1e-9);
  assert.ok(Math.abs(geometry.placements.mb_vanity_pvc_service_chase.x - 3.025) < 1e-9);
  assert.equal(geometry.placements.condensate_pipe_ac_outlet.x, 3.70);
  assert.equal(geometry.plan.length, 10);
});

test('改穿墙点：折点与折后各段跟随，服务带锚点不动', () => {
  const { geometry, diagnostics } = chainWith({
    mepRoute: { penetration: [{ wall: 'w_mbath_south', at: { x: 2.40, z: 2.86 } }] },
  });
  assert.deepEqual(diagnostics, []);
  assert.ok(geometry);
  assert.equal(geometry.points.fold.x, 2.40);
  assert.ok(Math.abs(geometry.placements.mb_vanity_pvc_service_chase.x - 2.925) < 1e-9);
  // 折点东移后 墙行→穿墙点 段变短（2.50−2.40），穿墙点→候选点 段变长（2.40−2.00）。
  assert.equal(geometry.plan[7].x, 2.40);
  assert.equal(geometry.plan[8].x, 2.40);
});

test('衣柜东缘越过空调盒转点：段反向，链作废并显形', () => {
  const { geometry, diagnostics } = chainWith({ wardrobe: { ...wardrobe, x: 3.80 } });
  assert.equal(geometry, null);
  assert.ok(diagnostics.some((line) => line.includes('wardrobe-entry') && line.includes('非西行或零长')));
});

test('穿墙点东移到墙行以东：折点段反向，链作废并显形', () => {
  const { geometry, diagnostics } = chainWith({
    mepRoute: { penetration: [{ wall: 'w_mbath_south', at: { x: 2.60, z: 2.86 } }] },
  });
  assert.equal(geometry, null);
  assert.ok(diagnostics.some((line) => line.includes('chase-fold-west') && line.includes('非西行或零长')));
});

test('衣柜 z 向移位而墙行包管没跟着改：接口不重合报警（既有诊断链）', () => {
  const { geometry, diagnostics } = chainWith({ wardrobe: { ...wardrobe, z: 4.69 } });
  assert.equal(geometry, null);
  assert.ok(diagnostics.some((line) => line.includes('接口不重合') && line.includes('chase-wall-drop')));
});

test('锚点缺失即诊断失败，不发明坐标', () => {
  const noUnit = chainWith({ hvacAnchors: new Map() });
  assert.equal(noUnit.geometry, null);
  assert.ok(noUnit.diagnostics.some((line) => line.includes('indoor_master')));

  const noPenetration = chainWith({ mepRoute: { penetration: [] } });
  assert.equal(noPenetration.geometry, null);
  assert.ok(noPenetration.diagnostics.some((line) => line.includes('穿墙点')));

  const noWardrobe = chainWith({ wardrobe: undefined });
  assert.equal(noWardrobe.geometry, null);
  assert.ok(noWardrobe.diagnostics.some((line) => line.includes('衣柜')));

  const noWallRun = chainWith({ wallRun: undefined });
  assert.equal(noWallRun.geometry, null);
  assert.ok(noWallRun.diagnostics.some((line) => line.includes('墙行包管')));
});

test('家具摆位解算：anchor 声明解出链上点，绝对 x/z 对三件已废', () => {
  const { geometry } = chainWith();
  assert.ok(geometry);
  const placementAnchors = {
    hvacAnchors: anchors.hvacAnchors,
    condensateChain: geometry,
  };
  const outlet = resolveFurniturePlacement(
    { type: 'condensate_pipe_ac_outlet', anchor: { source: 'hvac', id: 'indoor_master' } },
    wallSegments,
    undefined,
    placementAnchors,
  );
  assert.ok(outlet.placement && Math.abs(outlet.placement.x - 3.70) < 1e-9 && Math.abs(outlet.placement.z - 5.10) < 1e-9);

  const entry = resolveFurniturePlacement(
    { type: 'mb_vanity_pvc_wardrobe_entry', anchor: { source: 'chain', id: 'wardrobe_east_band' } },
    wallSegments,
    undefined,
    placementAnchors,
  );
  assert.ok(entry.placement && Math.abs(entry.placement.x - 2.925) < 1e-9 && Math.abs(entry.placement.z - 4.62) < 1e-9);

  // 被替代的旧机制：绝对 x/z 写回来即失败（防第二份坐标源）。
  const legacy = resolveFurniturePlacement({ type: 'mb_vanity_pvc_service_chase', x: 2.925, z: 4.62 }, wallSegments);
  assert.equal(legacy.placement, null);
  assert.ok(legacy.diagnostic?.includes('绝对 x/z 已废'));

  // 同时声明 anchor 与绝对坐标 / 墙锚：定位来源必须唯一。
  assert.ok(resolveFurniturePlacement(
    { type: 'mb_vanity_pvc_service_chase', x: 1, z: 1, anchor: { source: 'chain', id: 'wardrobe_east_band' } },
    wallSegments,
    undefined,
    placementAnchors,
  ).diagnostic?.includes('不得同时声明'));

  // 上下文缺失（断引用）显形，不静默发明。
  assert.ok(resolveFurniturePlacement(
    { type: 'condensate_pipe_ac_outlet', anchor: { source: 'hvac', id: 'indoor_master' } },
    wallSegments,
  ).diagnostic?.includes('hvacAnchors 上下文缺失'));
  assert.ok(resolveFurniturePlacement(
    { type: 'mb_vanity_pvc_wardrobe_entry', anchor: { source: 'chain', id: 'wardrobe_east_band' } },
    wallSegments,
    undefined,
    { hvacAnchors: anchors.hvacAnchors },
  ).diagnostic?.includes('condensateChain 上下文缺失'));
  assert.ok(resolveFurniturePlacement(
    { type: 'mb_vanity_pvc_wardrobe_entry', anchor: { source: 'chain', id: 'not_a_point' } },
    wallSegments,
    undefined,
    placementAnchors,
  ).diagnostic?.includes('unknown chain anchor point'));
});

test('家具链 ↔ MEP 平面折线对照：重合无发现，漂移即显形', () => {
  const { geometry } = chainWith();
  assert.ok(geometry);
  const mepPlan = [
    { x: 3.70, z: 5.10 }, { x: 4.10, z: 5.10 }, { x: 4.10, z: 4.62 }, { x: 2.925, z: 4.62 },
    { x: 2.50, z: 4.62 }, { x: 2.50, z: 4.30 }, { x: 2.50, z: 3.10 }, { x: 2.30, z: 3.10 },
    { x: 2.30, z: 2.50 }, { x: 2.00, z: 2.50 },
  ];
  assert.deepEqual(diffCondensateChainPlanAgainstMep(geometry.plan, mepPlan), []);
  const drifted = diffCondensateChainPlanAgainstMep(geometry.plan, mepPlan.map((point, index) => (index === 6 ? { x: 2.50, z: 3.00 } : point)));
  assert.equal(drifted.length, 1);
  assert.ok(drifted[0].includes('第 7 个折点不重合'));
  assert.ok(diffCondensateChainPlanAgainstMep(geometry.plan, mepPlan.slice(0, 9)).some((line) => line.includes('折点点数不一致')));
});

test('buildScene 侧锚点接线：合成 diagram + 穿墙点解出三件，缺一项即诊断', async () => {
  const { buildScene } = await import('../../shared/render/SceneBuilder.js');
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
  const walls = [
    { id: 'w_mbath_east', x1: 2.6, z1: 1.1, x2: 2.6, z2: 4.3, height: 2.8 },
    { id: 'w_mb_east', x1: 4.2, z1: 5.55, x2: 4.2, z2: 9.8, height: 2.8 },
    { id: 'w_mbath_south', x1: 0.4, z1: 2.86, x2: 2.6, z2: 2.86, height: 2.8 },
  ];
  const rooms = [{ id: 'master_bedroom', name: '主卧', x: 2.1, z: 5.55, width: 4.2, depth: 4.25, height: 2.8, type: 'private' as const, boundary_count: 4 }];
  const ok = buildScene({
    rooms, walls, elements: [], furnishings,
    options: {
      hvac: { diagram, sources: { ceiling: [{ id: 'ac_master', x: 3.70, z: 5.10, height: 2.85 }] as never } },
      condensatePenetration: { x: 2.30, z: 2.86 },
    },
  });
  assert.deepEqual(ok.report.placementDiagnostics, []);
  const placed = new Map(ok.index.furnitureMeshes.map((group) => [String(group.userData.furnishingType), group.position]));
  assert.ok(Math.abs((placed.get('condensate_pipe_ac_outlet')?.x ?? 0) - 3.70) < 1e-9);
  assert.ok(Math.abs((placed.get('condensate_pipe_ac_outlet')?.z ?? 0) - 5.10) < 1e-9);
  assert.ok(Math.abs((placed.get('mb_vanity_pvc_wardrobe_entry')?.x ?? 0) - 2.925) < 1e-9);
  assert.ok(Math.abs((placed.get('mb_vanity_pvc_service_chase')?.x ?? 0) - 2.925) < 1e-9);

  // 缺 MEP 穿墙点：三件一并解不出来，根因诊断显形（不静默少件）。
  const broken = buildScene({ rooms, walls, elements: [], furnishings, options: { hvac: { diagram, sources: { ceiling: [{ id: 'ac_master', x: 3.70, z: 5.10, height: 2.85 }] as never } } } });
  assert.equal(broken.report.placementDiagnostics.length, 1);
  assert.ok(broken.report.placementDiagnostics[0].includes('穿墙点'));
  assert.equal(broken.index.furnitureMeshes.length, 2); // 只剩衣柜与墙行包管
});
