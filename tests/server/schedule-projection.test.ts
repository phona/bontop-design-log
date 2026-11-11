// shared/schedule-projection.ts 的回归测试（issue #202 切片 B）。
//
// 守设计 §4 的六条算法与 §10 的 node 侧测试计划：DAG 显形报错、工作历展开
// （rest_dates 优先、补班日占 ord、周末不占 ord）、min/max 双前向（并行不互推、
// 汇合取最大）、无锚点时按名义纪元确定性地出 date、实际窗口钉死与后继顺延、
// what-if 只动拓扑下游且不动已完工包、同角色 onsite 窗口重叠才报冲突。
// §14（Codex PR #216）增补：not_before 的锚点守卫（B5）；actual_windows 以真实日期
// 给入、ordinals 双向地平线（锚点前负 ord，B3）。
// §15（Codex PR #216 第 2 轮）增补：日期→ord 查询顺序无关（F1）、affected 以
// forecast-no-scenario 为对照并比较完整窗口（M1）、零工期里程碑不推后继（m1）。
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
  it('duration_workdays {0,0} 不占工作日，后继从同一 ord 起算（§15/m1）', () => {
    // schedule/phase-1/control.yaml:1838 的真实声明；设计 §4 说侧车道由调用方过滤，
    // 但漏过滤时本模块不得崩、也不得造出 start > end 的窗口。
    // §15/m1：零工期根包位于 ord 1，后继必须也从 ord 1 起算（旧行为是 ord 2，
    // 与头注「不占 ord，也不推后任何后继包」相反——本用例是契约变更）。
    const projection = projectSchedule({
      packages: [pkg('PKG-000', 10, 2, 2, ['PKG-900']), pkg('PKG-900', 900, 0, 0)],
      calendar: calendar(),
    });
    assert.deepEqual(projection.packages['PKG-900'].baseline, { start_ord: 1, end_ord_min: 1, end_ord_max: 1 });
    assert.deepEqual(
      projection.packages['PKG-000'].baseline,
      { start_ord: 1, end_ord_min: 2, end_ord_max: 2 },
      '后继不得被零工期里程碑推后到第 2 日',
    );
  });

  it('零工期根节点不推后继：后继 start_ord = 1（不是 2）', () => {
    const projection = projectSchedule({
      packages: [pkg('MILESTONE', 10, 0, 0), pkg('SUCCESSOR', 20, 1, 1, ['MILESTONE'])],
      calendar: calendar(),
    });
    assert.deepEqual(projection.packages.MILESTONE.baseline, { start_ord: 1, end_ord_min: 1, end_ord_max: 1 });
    assert.deepEqual(projection.packages.SUCCESSOR.baseline, { start_ord: 1, end_ord_min: 1, end_ord_max: 1 });
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
      // 2026-01-05(一)…01-09(五) → ord 1…5
      actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-09' } },
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
      actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-08' } },
    });
    const withDelay = projectSchedule({
      packages: packagesWithActual,
      calendar: calendar(),
      actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-08' } },
      scenario: { delay: [{ pkg: 'A', workdays: 3 }] },
    });
    assert.deepEqual(withDelay.packages.A.forecast, base.packages.A.forecast, 'delay 不得改写实际窗口');
    assert.deepEqual(withDelay.packages.A.forecast, { start_ord: 1, end_ord_min: 4, end_ord_max: 4 });
    assert.deepEqual(withDelay.scenario?.affected, []);
  });
});

describe('§15/M1：affected 以 forecast-no-scenario 为对照、比较完整窗口', () => {
  it('仅保守末端变化的下游包也进 affected（Codex 探针）', () => {
    // A {1,10} 与 B {5} 并行 → C {1} 依赖两者。delay A +3 后：
    // 乐观起点仍由 B 决定（6），但保守末端 11 → 14，旧算法 delta = 0 会漏掉 C。
    const packages = [pkg('A', 10, 1, 10), pkg('B', 20, 5, 5), pkg('C', 30, 1, 1, ['A', 'B'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      scenario: { delay: [{ pkg: 'A', workdays: 3 }] },
    });
    assert.deepEqual(projection.packages.C.forecast, { start_ord: 6, end_ord_min: 6, end_ord_max: 14 });
    assert.deepEqual(projection.scenario?.affected, [{ pkg: 'C', delta: 3 }]);
  });

  it('delay 0 且存在实际延期：既有实际位移不得进 affected', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // A 实际窗口 01-05…01-09 = ord 1…5；B 的既有实际位移是 start 3 → 6
      actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-09' } },
      scenario: { delay: [{ pkg: 'A', workdays: 0 }] },
    });
    assert.equal(projection.packages.A.forecast.start_ord, 1);
    assert.equal(projection.packages.B.forecast.start_ord, 6, '既有实际位移保留在 forecast 里');
    assert.deepEqual(projection.scenario?.affected, [], '本次演算没有造成任何位移');
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

describe('not_before 约束的锚点守卫（§14/B5）', () => {
  it('anchor_date 为 null：resolved not_before 带真实日期不抬升', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 2, 2)],
      calendar: calendar({ anchor_date: null }),
      constraints: { A: [{ id: 'C1', type: 'not_before', status: 'resolved', date: '2026-01-07' }] },
    });
    // 无锚点不得把 2026-01-07 映射到 1970 名义纪元（否则会被算成第 14613 工作日并抬升）
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
  });

  it('anchor_date 就绪：同一约束照常抬升', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 2, 2)],
      calendar: calendar({ anchor_date: '2026-01-05' }),
      constraints: { A: [{ id: 'C1', type: 'not_before', status: 'resolved', date: '2026-01-07' }] },
    });
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 3, end_ord_min: 4, end_ord_max: 4 });
  });
});

describe('actual_windows 以真实日期给入（§14/B3）', () => {
  it('锚点后且超出基线末端的实际日期 → 窗口存在、ordinals 扩展、forecast 顺延', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // A 基线末端只到 ord 2；实际日期扩到 01-12（跳过周末）= ord 6
      actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-12' } },
    });
    assert.deepEqual(projection.packages.A.actual, { start_ord: 1, end_ord: 6 });
    assert.deepEqual(projection.packages.A.forecast, { start_ord: 1, end_ord_min: 6, end_ord_max: 6 });
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 }, '基线不被实际窗口改写');
    assert.equal(projection.packages.B.forecast.start_ord, 7, '后继从实际末端顺延');
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 6), { ord: 6, date: '2026-01-12' });
    assert.equal(projection.ordinals.length, 8, 'ordinals 覆盖到预测末端 ord 8');
  });

  it('锚点前的实际日期 → 负 ord，ordinals 向后覆盖', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // ord 1 = 2026-01-05(一)：01-02(五)=0、01-01(四)=-1、2025-12-31(三)=-2
      actual_windows: { A: { start_date: '2025-12-31', end_date: '2026-01-02' } },
    });
    assert.deepEqual(projection.packages.A.actual, { start_ord: -2, end_ord: 0 });
    assert.deepEqual(projection.packages.A.forecast, { start_ord: -2, end_ord_min: 0, end_ord_max: 0 });
    assert.equal(projection.packages.B.forecast.start_ord, 1, '后继仍从排程零点（ord 1）起算');
    assert.deepEqual(projection.ordinals.slice(0, 4), [
      { ord: -2, date: '2025-12-31' },
      { ord: -1, date: '2026-01-01' },
      { ord: 0, date: '2026-01-02' },
      { ord: 1, date: '2026-01-05' },
    ]);
  });

  it('实际日期落在休息日/周末 → 取之后第一个工作日，不丢弃', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar({ rest_dates: ['2026-01-06'] }), // 周二调休
      actual_windows: { A: { start_date: '2026-01-06', end_date: '2026-01-10' } },
    });
    // 01-06(二) 调休 → 01-07(三)=ord 2；01-10(六) 周末 → 01-12(一)=ord 5
    assert.deepEqual(projection.packages.A.actual, { start_ord: 2, end_ord: 5 });
    assert.equal(projection.ordinals[1].date, '2026-01-07', '休息日的实际开始日映射到之后第一个工作日');
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 5), { ord: 5, date: '2026-01-12' });
    assert.equal(projection.packages.B.forecast.start_ord, 6);
  });

  it('start_date 晚于 end_date → invalid_actual_window', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 2, 2)],
        calendar: calendar(),
        actual_windows: { A: { start_date: '2026-01-08', end_date: '2026-01-05' } },
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'invalid_actual_window',
    );
  });

  it('anchor_date 为 null：不把真实日期映射到 1970 名义纪元', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 2, 2)],
        calendar: calendar({ anchor_date: null }),
        actual_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-06' } },
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'invalid_actual_window',
    );
  });
});

describe('§15/F1：日期→ord 查询顺序无关', () => {
  const packages = [pkg('A', 10, 1, 1), pkg('B', 20, 1, 1)];

  it('先查 2026-01-01 再查 2025-12-31 与反向顺序同结果，负 ord 不漏记', () => {
    const actualA = { start_date: '2026-01-01', end_date: '2026-01-01' };
    const actualB = { start_date: '2025-12-31', end_date: '2025-12-31' };
    const forward = projectSchedule({
      packages,
      calendar: calendar(),
      actual_windows: { A: actualA, B: actualB },
    });
    const reverse = projectSchedule({
      packages,
      calendar: calendar(),
      actual_windows: { B: actualB, A: actualA },
    });
    assert.deepEqual(forward, reverse, '实际窗口的输入顺序不得改变投影');
    assert.deepEqual(forward.packages.A.actual, { start_ord: -1, end_ord: -1 });
    assert.deepEqual(forward.packages.B.actual, { start_ord: -2, end_ord: -2 });
    assert.deepEqual(
      forward.ordinals.filter((entry) => entry.ord <= 0),
      [
        { ord: -2, date: '2025-12-31' },
        { ord: -1, date: '2026-01-01' },
        { ord: 0, date: '2026-01-02' },
      ],
      '2025-12-31 不得从 ordinals 消失',
    );
  });

  it('约束日期与实际窗口混查：正反向映射互不干扰', () => {
    const makeInput = (order: 'AB' | 'BA') => {
      const restB = { start_date: '2025-12-31', end_date: '2025-12-31' };
      const restA = { start_date: '2026-01-01', end_date: '2026-01-01' };
      const constraintA = { id: 'C-A', type: 'not_before' as const, status: 'resolved', date: '2026-01-08' };
      const constraintB = { id: 'C-B', type: 'not_before' as const, status: 'resolved', date: '2025-12-30' };
      return {
        packages: order === 'AB' ? packages : [packages[1], packages[0]],
        calendar: calendar(),
        actual_windows: order === 'AB' ? { A: restA, B: restB } : { B: restB, A: restA },
        constraints: order === 'AB' ? { A: [constraintA], B: [constraintB] } : { B: [constraintB], A: [constraintA] },
      };
    };
    const first = projectSchedule(makeInput('AB'));
    const second = projectSchedule(makeInput('BA'));
    assert.deepEqual(first, second, '包顺序与查询顺序不得改变投影');
    assert.deepEqual(first.packages.A.actual, { start_ord: -1, end_ord: -1 });
    assert.deepEqual(first.packages.B.actual, { start_ord: -2, end_ord: -2 });
    assert.equal(first.packages.A.baseline.start_ord, 4, '01-08 在锚点后 = ord 4');
    assert.equal(
      first.packages.B.baseline.start_ord,
      1,
      '2025-12-30 映射为 ord -3，但 not_before 只能抬升，不得把声明起点压到 ord 1 之前',
    );
  });

  it('休息日反向查询取之后第一个工作日', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: calendar({ rest_dates: ['2026-01-01'] }), // 元旦调休
      actual_windows: { A: { start_date: '2025-12-31', end_date: '2026-01-01' } },
    });
    // 12-31(三) 工作日 → ord -1（01-01 休息不占 ord）；01-01 → 之后第一个工作日 01-02 = ord 0
    assert.deepEqual(projection.packages.A.actual, { start_ord: -1, end_ord: 0 });
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === -1), { ord: -1, date: '2025-12-31' });
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 0), { ord: 0, date: '2026-01-02' });
    assert.ok(!projection.ordinals.some((entry) => entry.date === '2026-01-01'), '休息日不得占 ord');
  });

  it('一批锚点前日期的 ord 连续、无跳号、无重复', () => {
    const dates = ['2025-12-29', '2025-12-30', '2025-12-31'];
    const entries = dates.map((date, index) => [`P${index}`, { start_date: date, end_date: date }] as const);
    const makeInput = (windows: typeof entries) => ({
      packages: dates.map((_, index) => pkg(`P${index}`, 10 + index, 1, 1)),
      calendar: calendar(),
      actual_windows: Object.fromEntries(windows),
    });
    const forward = projectSchedule(makeInput(entries));
    const reverse = projectSchedule(makeInput([...entries].reverse()));
    assert.deepEqual(forward, reverse, '反向插入实际窗口不得改变序数');
    for (const [index, expected] of [[0, -4], [1, -3], [2, -2]] as const) {
      assert.equal(forward.packages[`P${index}`].actual?.start_ord, expected, `${dates[index]} 的 ord 错误`);
    }
    const negative = forward.ordinals.filter((entry) => entry.ord <= 0);
    assert.deepEqual(negative.map((entry) => entry.ord), [-4, -3, -2, -1, 0], '负序数连续');
    assert.deepEqual(
      negative.map((entry) => entry.date),
      ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'],
    );
    for (let index = 1; index < forward.ordinals.length; index += 1) {
      assert.equal(forward.ordinals[index].ord, forward.ordinals[index - 1].ord + 1, 'ordinals 不得跳号');
    }
    assert.equal(
      new Set(forward.ordinals.map((entry) => entry.ord)).size,
      forward.ordinals.length,
      'ordinals 不得重复',
    );
  });

  it('稀疏日历（workdays 为空、只有 extra_workdates）的锚点前日期 → 第一个工作日 ord 1，不误报 exhausted', () => {
    // 合法日历：loader 只校验 workdays 元素合法（shared/schedule-state.ts:1484），
    // 投影只要求 workdays 与 extra_workdates 不同时为空；两个补班日相隔 59 天的稀疏日历
    // 不得触发 ensureBackward 的「凑足 count 个工作日」保险丝（§15/F1 复审回归）。
    const sparse = calendar({
      workdays: [],
      rest_dates: [],
      extra_workdates: ['2026-01-05', '2026-03-05'],
    });
    const beforeAnchor = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: sparse,
      actual_windows: { A: { start_date: '2025-12-31', end_date: '2025-12-31' } },
    });
    // 12-31 之后没有任何工作日 → 第一个工作日 2026-01-05 即 ord 1
    assert.deepEqual(beforeAnchor.packages.A.actual, { start_ord: 1, end_ord: 1 });
    assert.deepEqual(beforeAnchor.ordinals, [{ ord: 1, date: '2026-01-05' }]);

    const anchoredLater = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: calendar({
        workdays: [],
        rest_dates: [],
        extra_workdates: ['2026-01-05', '2026-03-05'],
        anchor_date: '2026-03-05',
      }),
      actual_windows: { A: { start_date: '2026-02-01', end_date: '2026-02-01' } },
    });
    // 02-01 与锚点之间没有工作日（01-05 在目标日期之前）→ 锚点日仍是 ord 1
    assert.deepEqual(anchoredLater.packages.A.actual, { start_ord: 1, end_ord: 1 });
    assert.deepEqual(anchoredLater.ordinals, [{ ord: 1, date: '2026-03-05' }]);
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
