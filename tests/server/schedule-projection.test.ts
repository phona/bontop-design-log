// shared/schedule-projection.ts 的回归测试（issue #202 切片 B）。
//
// 守设计 §4 的六条算法与 §10 的 node 侧测试计划：DAG 显形报错、工作历展开
// （rest_dates 优先、补班日占 ord、周末不占 ord）、min/max 双前向（并行不互推、
// 汇合取最大）、无锚点时按名义纪元确定性地出 date、实际窗口钉死与后继顺延、
// what-if 只动拓扑下游且不动已完工包、同角色 onsite 窗口重叠才报冲突。
// 全部是纯函数断言，不读 config、不跑 loader——loader 接线由下一个切片测。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCoordinationConflicts,
  projectSchedule,
  ProjectionError,
  validateDag,
  type ProjectionCalendar,
  type ProjectionPackage,
} from '../../shared/schedule-projection.js';

function pkg(id: string, sequence: number, min: number, max: number, dependencies: string[] = []): ProjectionPackage {
  return { id, sequence, dependencies, duration_workdays: { min, max } };
}

function calendar(overrides: Partial<ProjectionCalendar> = {}): ProjectionCalendar {
  return {
    workdays: [1, 2, 3, 4, 5], // 周一~周五
    rest_dates: [],
    extra_workdates: [],
    anchor_date: '2026-01-05', // 周一
    ...overrides,
  };
}

function ordinates(projection: ReturnType<typeof projectSchedule>): Array<[number, string | null]> {
  return projection.ordinals.map((entry) => [entry.ord, entry.date]);
}

describe('validateDag / projectSchedule：DAG 显形校验', () => {
  it('正确图返回空数组', () => {
    const packages = [pkg('A', 10, 2, 3), pkg('B', 20, 1, 2, ['A']), pkg('C', 30, 1, 1, ['A', 'B'])];
    assert.deepEqual(validateDag(packages), []);
  });

  it('未知依赖：一条中文错误串', () => {
    const errors = validateDag([pkg('PKG-000', 10, 2, 3, ['PKG-999'])]);
    assert.deepEqual(errors, ['PKG-000: 未知依赖 PKG-999']);
  });

  it('自依赖：一条中文错误串', () => {
    const errors = validateDag([pkg('PKG-010', 20, 2, 3, ['PKG-010'])]);
    assert.deepEqual(errors, ['PKG-010: 自依赖']);
  });

  it('跨包环：一条中文错误串，路径从最小 id 起', () => {
    const errors = validateDag([pkg('A', 10, 1, 1, ['B']), pkg('B', 20, 1, 1, ['C']), pkg('C', 30, 1, 1, ['A'])]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /依赖环/);
    assert.match(errors[0], /A → B → C → A/);
  });

  it('环不会被拓扑排序吞掉：projectSchedule 抛 ProjectionError(dependency_cycle)', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 1, 1, ['B']), pkg('B', 20, 1, 1, ['A'])],
        calendar: calendar(),
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'dependency_cycle',
    );
  });

  it('未知依赖同样抛结构化错误', () => {
    assert.throws(
      () => projectSchedule({ packages: [pkg('A', 10, 1, 1, ['NOPE'])], calendar: calendar() }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'unknown_dependency',
    );
  });
});

describe('工作历展开：ord 只数工作日', () => {
  it('跨周末：周六周日不占 ord，下一个工作日接续', () => {
    // 2026-01-10 是周六、01-11 是周日；workdays 含周六时周日仍跳过
    const projection = projectSchedule({
      packages: [pkg('A', 10, 7, 7)],
      calendar: calendar({ workdays: [1, 2, 3, 4, 5, 6] }),
    });
    assert.deepEqual(ordinates(projection), [
      [1, '2026-01-05'],
      [2, '2026-01-06'],
      [3, '2026-01-07'],
      [4, '2026-01-08'],
      [5, '2026-01-09'],
      [6, '2026-01-10'],
      [7, '2026-01-12'],
    ]);
    assert.ok(!projection.ordinals.some((entry) => entry.date === '2026-01-11'), '周日不得占序数');
  });

  it('rest_dates 优先于 workdays：调休日不占 ord；extra_workdates 补班日占 ord', () => {
    // 01-07 周三被声明为休息日，01-10 周六被声明为补班日
    const projection = projectSchedule({
      packages: [pkg('A', 10, 6, 6)],
      calendar: calendar({ rest_dates: ['2026-01-07'], extra_workdates: ['2026-01-10'] }),
    });
    assert.deepEqual(ordinates(projection), [
      [1, '2026-01-05'],
      [2, '2026-01-06'],
      [3, '2026-01-08'],
      [4, '2026-01-09'],
      [5, '2026-01-10'],
      [6, '2026-01-12'],
    ]);
    assert.equal(projection.packages.A.baseline.end_ord_min, 6, '6 个工作日应刚好用完 6 个序数');
  });
});

describe('min/max 双前向传播', () => {
  // A {2,4} → B {2,3} / C {3,3} 并行 → D {1,2} 汇合
  const packages = [pkg('D', 40, 1, 2, ['B', 'C']), pkg('B', 20, 2, 3, ['A']), pkg('A', 10, 2, 4), pkg('C', 30, 3, 3, ['A'])];

  it('并行分支互不推高（同一起点）', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    assert.equal(projection.packages.B.baseline.start_ord, 3);
    assert.equal(projection.packages.C.baseline.start_ord, 3);
    assert.equal(projection.packages.B.baseline.end_ord_min, 4, 'B 的乐观末端只由自己的工期决定');
    assert.equal(projection.packages.C.baseline.end_ord_min, 5, 'C 的乐观末端只由自己的工期决定');
  });

  it('汇合包 start 取各依赖 end 的最大值', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    // min 口径：B 末 4、C 末 5 → D 起 6；max 口径：B/C 末均 7 → D 起 8、末 9
    assert.equal(projection.packages.D.baseline.start_ord, 6, 'start_ord 取乐观口径（最早可能开工）');
    assert.equal(projection.packages.D.baseline.end_ord_min, 6);
    assert.equal(projection.packages.D.baseline.end_ord_max, 9, '保守口径下 D 起 8、工期 2 → 末 9');
  });

  it('min/max 两端来自两遍传播', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 4 });
  });
});

describe('侧车道零工期包（PKG-900 真实形态）', () => {
  it('duration_workdays {0,0} 传进来不崩，按零工作日里程碑占位', () => {
    // schedule/phase-1/control.yaml:1838 的真实声明；设计 §4 说侧车道由调用方过滤，
    // 但漏过滤时本模块不得崩、也不得造出 start > end 的窗口。
    const projection = projectSchedule({
      packages: [pkg('PKG-000', 10, 2, 2), pkg('PKG-900', 900, 0, 0)],
      calendar: calendar(),
    });
    assert.deepEqual(projection.packages['PKG-900'].baseline, { start_ord: 1, end_ord_min: 1, end_ord_max: 1 });
    assert.deepEqual(projection.packages['PKG-000'].baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
  });
});

describe('anchor_date 为空：仍按名义纪元确定性地算 date', () => {
  it('1970-01-01 起展开，跳周末，重复调用结果一致', () => {
    const input = {
      packages: [pkg('A', 10, 3, 3)],
      calendar: calendar({ anchor_date: null }),
    };
    const first = projectSchedule(input);
    const second = projectSchedule(input);
    assert.deepEqual(ordinates(first), [
      [1, '1970-01-01'],
      [2, '1970-01-02'],
      [3, '1970-01-05'],
    ]);
    assert.deepEqual(ordinates(second), ordinates(first), '同输入必须同输出');
    assert.deepEqual(first.ordinals, second.ordinals);
  });

  it('无包且无实际窗口 → ordinals 为空数组', () => {
    assert.deepEqual(projectSchedule({ packages: [], calendar: calendar({ anchor_date: null }) }).ordinals, []);
  });
});

describe('actual_windows：实际窗口钉死与后继顺延', () => {
  const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A']), pkg('C', 30, 2, 2, ['B'])];

  it('无实际窗口 → actual 全为 null，forecast 等于 baseline', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    for (const id of ['A', 'B', 'C']) {
      assert.equal(projection.packages[id].actual, null);
      assert.deepEqual(projection.packages[id].forecast, projection.packages[id].baseline);
    }
    assert.equal(projection.packages.B.forecast.start_ord, 3);
  });

  it('有实际窗口 → forecast 钉死实际值，后继包从实际末端顺延', () => {
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      actual_windows: { A: { start_ord: 1, end_ord: 5 } },
    });
    assert.deepEqual(projection.packages.A.actual, { start_ord: 1, end_ord: 5 });
    assert.deepEqual(projection.packages.A.forecast, { start_ord: 1, end_ord_min: 5, end_ord_max: 5 });
    assert.deepEqual(projection.packages.B.forecast, { start_ord: 6, end_ord_min: 7, end_ord_max: 7 });
    assert.deepEqual(projection.packages.C.forecast, { start_ord: 8, end_ord_min: 9, end_ord_max: 9 });
    assert.deepEqual(projection.packages.B.baseline, { start_ord: 3, end_ord_min: 4, end_ord_max: 4 }, 'baseline 不受实际窗口影响');
  });
});

describe('scenario.delay：what-if 只动拓扑下游', () => {
  // ROOT → BRANCH / MAIN 并行 → TAIL 汇合
  const packages = [
    pkg('ROOT', 10, 2, 2),
    pkg('BRANCH', 20, 3, 3, ['ROOT']),
    pkg('MAIN', 30, 2, 2, ['ROOT']),
    pkg('TAIL', 40, 2, 2, ['BRANCH', 'MAIN']),
  ];

  it('并行分支序数不变、不列入 affected', () => {
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      scenario: { delay: [{ pkg: 'BRANCH', workdays: 2 }] },
    });
    assert.deepEqual(projection.scenario, {
      overrides: [{ pkg: 'BRANCH', workdays: 2 }],
      affected: [{ pkg: 'TAIL', delta: 2 }],
    });
    assert.deepEqual(projection.packages.MAIN.forecast, projection.packages.MAIN.baseline);
    assert.equal(projection.packages.BRANCH.forecast.end_ord_max, 7, 'BRANCH 工期 3+2');
    assert.equal(projection.packages.TAIL.forecast.start_ord, 8);
  });

  it('无 scenario → scenario 为 null，forecast 与 baseline 一致', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    assert.equal(projection.scenario, null);
    assert.deepEqual(projection.packages.TAIL.forecast, projection.packages.TAIL.baseline);
  });

  it('已有实际窗口的包忽略 delay（已完成包不得被排程回退）', () => {
    const packagesWithActual = [pkg('A', 10, 2, 2)];
    const base = projectSchedule({
      packages: packagesWithActual,
      calendar: calendar(),
      actual_windows: { A: { start_ord: 1, end_ord: 4 } },
    });
    const withDelay = projectSchedule({
      packages: packagesWithActual,
      calendar: calendar(),
      actual_windows: { A: { start_ord: 1, end_ord: 4 } },
      scenario: { delay: [{ pkg: 'A', workdays: 3 }] },
    });
    assert.deepEqual(withDelay.packages.A.forecast, base.packages.A.forecast, 'delay 不得改写实际窗口');
    assert.deepEqual(withDelay.packages.A.forecast, { start_ord: 1, end_ord_min: 4, end_ord_max: 4 });
    assert.deepEqual(withDelay.scenario?.affected, []);
  });
});

describe('not_before 约束（resolved 才生效）', () => {
  it('resolved 的 not_before 抬 start；site_pending / not_after / time_window 只登记', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 2, 2)],
      calendar: calendar({ rest_dates: ['2026-01-07'] }), // 01-08 → ord 3
      constraints: {
        A: [
          { id: 'C1', type: 'not_before', status: 'resolved', date: '2026-01-08' },
          { id: 'C2', type: 'not_before', status: 'site_pending', date: '2026-01-12' },
          { id: 'C3', type: 'not_after', status: 'resolved', date: '2026-01-05' },
          { id: 'C4', type: 'time_window', status: 'resolved', date: '2026-01-12' },
        ],
      },
    });
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 3, end_ord_min: 4, end_ord_max: 4 });
  });

  it('约束日期落在休息日 → 取当天之后第一个工作日', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: calendar({ rest_dates: ['2026-01-07'] }),
      constraints: { A: [{ id: 'C1', type: 'not_before', status: 'resolved', date: '2026-01-07' }] },
    });
    assert.equal(projection.packages.A.baseline.start_ord, 3);
  });
});

describe('detectCoordinationConflicts', () => {
  const packages = [pkg('X', 10, 5, 5), pkg('Y', 20, 5, 5), pkg('Z', 30, 3, 3, ['X'])];
  const projection = projectSchedule({ packages, calendar: calendar() });

  it('同角色 onsite 窗口重叠 → 冲突；notify / remote 不参与', () => {
    const conflicts = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '空调商', mode: 'onsite' },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '空调商', mode: 'onsite' },
      { sch_id: 'SCH-N', pkg: 'X', role: '空调商', mode: 'notify' },
      { sch_id: 'SCH-R', pkg: 'Y', role: '空调商', mode: 'remote' },
    ], projection);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].role, '空调商');
    assert.deepEqual(conflicts[0].sch_ids, ['SCH-X', 'SCH-Y']);
    assert.match(conflicts[0].reason, /现场窗口重叠/);
    assert.match(conflicts[0].reason, /SCH-X/);
    assert.match(conflicts[0].reason, /SCH-Y/);
    assert.ok(!conflicts[0].sch_ids.includes('SCH-N'));
    assert.ok(!conflicts[0].sch_ids.includes('SCH-R'));
  });

  it('同角色 onsite 窗口不重叠 → 无冲突；不同角色各自单项也不报', () => {
    const conflicts = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '空调商', mode: 'onsite' }, // 1–5
      { sch_id: 'SCH-Z', pkg: 'Z', role: '空调商', mode: 'onsite' }, // 6–8
      { sch_id: 'SCH-Y', pkg: 'Y', role: '施工方', mode: 'onsite' }, // 1–5，不同角色
    ], projection);
    assert.deepEqual(conflicts, []);
  });
});
