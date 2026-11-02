// shared/flow-layout.ts 的回归测试（自装审批流程图任务，2026-11-02）。
// 守四件事：并行（同层）、汇合（层号=前置最大+1）、单链、PKG-900 侧车道；
// 外加一条真实仓集成——用一期真实依赖结构钉住布局，配置漂移时当场红。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeFlowLayout, type FlowLayoutPackage } from '../../shared/flow-layout.js';
import { buildScheduleSnapshot, loadScheduleState } from '../../shared/schedule-state.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

const layerOf = (layout: ReturnType<typeof computeFlowLayout>, id: string) =>
  layout.nodes.find((node) => node.id === id)?.layer;

describe('computeFlowLayout: 合成结构', () => {
  it('并行：两个包同接一个前置 → 同层', () => {
    const layout = computeFlowLayout([
      {id: 'A', name: 'A', sequence: 10},
      {id: 'B', name: 'B', sequence: 20, dependencies: ['A']},
      {id: 'C', name: 'C', sequence: 30, dependencies: ['A']},
    ]);
    assert.equal(layerOf(layout, 'A'), 0);
    assert.equal(layerOf(layout, 'B'), 1);
    assert.equal(layerOf(layout, 'C'), 1, 'B/C 都只接 A，必须同层（并行）');
    assert.deepEqual(layout.layerSizes, [1, 2]);
  });

  it('汇合：等三个前置的包 → 层号 = 前置最大层 + 1', () => {
    const layout = computeFlowLayout([
      {id: 'ROOT', name: '根', sequence: 10},
      {id: 'X', name: 'X', sequence: 20, dependencies: ['ROOT']},
      {id: 'Y', name: 'Y', sequence: 30, dependencies: ['X']},
      {id: 'Z', name: 'Z', sequence: 40, dependencies: ['X']},
      {id: 'MERGE', name: '汇合', sequence: 50, dependencies: ['X', 'Y', 'Z']},
    ]);
    assert.equal(layerOf(layout, 'X'), 1);
    assert.equal(layerOf(layout, 'Y'), 2);
    assert.equal(layerOf(layout, 'Z'), 2);
    assert.equal(layerOf(layout, 'MERGE'), 3, 'MERGE 等 X(1)/Y(2)/Z(2)，层号应为 3');
    const mergeEdges = layout.edges.filter((edge) => edge.to === 'MERGE').map((edge) => edge.from).sort();
    assert.deepEqual(mergeEdges, ['X', 'Y', 'Z'], '三条入边都必须画出来');
  });

  it('单链：a→b→c 深度递增', () => {
    const layout = computeFlowLayout([
      {id: 'a', sequence: 10},
      {id: 'b', sequence: 20, dependencies: ['a']},
      {id: 'c', sequence: 30, dependencies: ['b']},
    ]);
    assert.deepEqual([layerOf(layout, 'a'), layerOf(layout, 'b'), layerOf(layout, 'c')], [0, 1, 2]);
    assert.deepEqual(layout.edges, [{from: 'a', to: 'b'}, {from: 'b', to: 'c'}]);
  });

  it('PKG-900 侧车道：不占层、不进边', () => {
    const layout = computeFlowLayout([
      {id: 'A', name: 'A', sequence: 10},
      {id: 'RESERVE', name: '预备金', sequence: 900, dependencies: []},
    ]);
    const reserve = layout.nodes.find((node) => node.id === 'RESERVE')!;
    assert.equal(reserve.sideLane, true);
    assert.equal(reserve.layer, -1);
    assert.equal(layout.layerCount, 1, '侧车道不计入主车道层数');
    assert.equal(layout.edges.length, 0);
  });

  it('层内按 sequence 排序，row 连续；确定性（两次计算深相等）', () => {
    const packages: FlowLayoutPackage[] = [
      {id: 'LATER', name: '后', sequence: 90},
      {id: 'EARLY', name: '先', sequence: 10},
    ];
    const first = computeFlowLayout(packages);
    const second = computeFlowLayout(packages);
    assert.deepEqual(first, second);
    assert.equal(first.nodes.find((node) => node.id === 'EARLY')!.row, 0);
    assert.equal(first.nodes.find((node) => node.id === 'LATER')!.row, 1);
  });

  it('跨包环不挂死：跳过成环约束，边照画', () => {
    const layout = computeFlowLayout([
      {id: 'P', sequence: 10, dependencies: ['Q']},
      {id: 'Q', sequence: 20, dependencies: ['P']},
    ]);
    assert.equal(layout.edges.length, 2, '两条边都画（布局降级但不丢信息）');
  });
});

describe('computeFlowLayout: 一期真实依赖结构', () => {
  it('PKG-030/040 并行接 PKG-020；PKG-070 汇合等 030+040+050；PKG-900 侧车道', () => {
    const state = loadScheduleState(process.cwd(), {modelPackageLinks: loadModelPackageLinks()});
    const snapshot = buildScheduleSnapshot(state);
    const layout = computeFlowLayout(snapshot.packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      dependencies: pkg.dependencies,
      sequence: pkg.sequence,
    })));

    // 并行：030 与 040 都只接 020 → 同层
    assert.equal(layerOf(layout, 'PKG-030'), layerOf(layout, 'PKG-040'));
    // 汇合：070 等 030+040+050 三个都过 → 层号 = 三者最大 + 1
    const expected070 = Math.max(
      layerOf(layout, 'PKG-030')!,
      layerOf(layout, 'PKG-040')!,
      layerOf(layout, 'PKG-050')!,
    ) + 1;
    assert.equal(layerOf(layout, 'PKG-070'), expected070);
    const mergeEdges = layout.edges.filter((edge) => edge.to === 'PKG-070').map((edge) => edge.from).sort();
    assert.deepEqual(mergeEdges, ['PKG-030', 'PKG-040', 'PKG-050']);
    // 侧车道：PKG-900 不占层
    assert.equal(layout.nodes.find((node) => node.id === 'PKG-900')!.sideLane, true);
    // 24 个施工包全部进主车道分层（layerCount 是不同层数，不是包数）
    assert.equal(layout.nodes.filter((node) => !node.sideLane).length, 24);
    assert.equal(layout.layerSizes.reduce((sum, size) => sum + size, 0), 24);
    assert.equal(layout.layerCount, layout.layerSizes.length);
    // 每层非空
    assert.ok(layout.layerSizes.every((size) => size > 0));
  });
});
