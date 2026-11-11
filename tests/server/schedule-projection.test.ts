// shared/schedule-projection.ts 的回归测试（issue #202 切片 B）。
//
// 守设计 §4 的算法与 §10 的 node 侧测试计划：DAG 显形报错、工作历展开
// （rest_dates 优先、补班日占 ord、周末不占 ord）、min/max 双前向（并行不互推、
// 汇合取最大）、无锚点时 ordinals 的 date 为 null 而序号仍连续确定、what-if 只动拓扑下游、
// 同角色 onsite 的分级（潜在重叠 vs 已确认冲突）。
// §14（Codex PR #216）增补：not_before 的锚点守卫（B5）；check_windows 以真实日期
// 给入、ordinals 双向地平线（锚点前负 ord，B3）。
// §15（Codex PR #216 第 2 轮）增补：日期→ord 查询顺序无关（F1）、affected 比较完整窗口（M1）、
// 零工期里程碑不推后继（m1）。
// §16（业主裁定 A）：检查记录窗口不进 forecast；稀疏日历声明日必须找得到；
// 协调冲突与潜在重叠分开。无 scenario 时 forecast 与 baseline 逐字节相同，
// 这一条对真实 control.yaml 成立（只读该文件，不跑 loader）。
// §17（第 4 轮，业主裁定 A）：无锚点时检查窗口保留日期、序数 null，不抛错、
// 不改 baseline/forecast/ordinals；锚点就绪时序数照常。cancelled 在分组前退出协调检测。
// §18（第 5 轮，业主点名 major）：无锚点时 ordinals 的 date 在模块边界就是 null，
// 不再出 1970 名义纪元日期；锚点就绪时 date 仍是真实日期。检查窗口的日期不动。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import {
  detectCoordinationConflicts,
  projectSchedule,
  ProjectionError,
  validateDag,
  type ProjectionCalendar,
  type ProjectionConstraint,
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

/** §17 起 check_window 同时带原样日期与可空序数。锚点就绪时序数是 number，无锚点时是 null。 */
function checkEvidence(
  start_date: string,
  end_date: string,
  start_ord: number | null,
  end_ord: number | null,
): { start_date: string; end_date: string; start_ord: number | null; end_ord: number | null } {
  return { start_date, end_date, start_ord, end_ord };
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

describe('§18：anchor_date 为空时 ordinals 的 date 为 null，序号仍确定', () => {
  it('无锚点：date 全 null，序号 1..N 连续，重复调用一致', () => {
    const input = {
      packages: [pkg('A', 10, 3, 3)],
      calendar: calendar({ anchor_date: null }),
    };
    const first = projectSchedule(input);
    const second = projectSchedule(input);
    assert.deepEqual(ordinates(first), [
      [1, null],
      [2, null],
      [3, null],
    ]);
    assert.deepEqual(first.ordinals, second.ordinals, '同输入必须同输出');
    for (let index = 1; index < first.ordinals.length; index += 1) {
      assert.equal(first.ordinals[index].ord, first.ordinals[index - 1].ord + 1, '序号连续');
    }
  });

  it('锚点就绪：同一工期给出真实日期（对照，不回归）', () => {
    // 2026-01-05 是周一。三天工期停在周三，不跨周末。
    const projection = projectSchedule({
      packages: [pkg('A', 10, 3, 3)],
      calendar: calendar(),
    });
    assert.deepEqual(ordinates(projection), [
      [1, '2026-01-05'],
      [2, '2026-01-06'],
      [3, '2026-01-07'],
    ]);
  });

  it('无锚点 + 稀疏日历：不因凑不够日期轴上的工作日而 exhausted，序号仍按工期连续', () => {
    // 有锚点时这两个补班日不够三天工期，会报 work_calendar_exhausted（§16 的用例）。
    // 无锚点没有日期轴，工期序号不靠展开日历，date 为 null。
    const projection = projectSchedule({
      packages: [pkg('A', 10, 3, 3)],
      calendar: calendar({
        anchor_date: null,
        workdays: [],
        extra_workdates: ['2026-01-05', '2026-03-05'],
      }),
    });
    assert.deepEqual(ordinates(projection), [
      [1, null],
      [2, null],
      [3, null],
    ]);
  });

  it('无锚点仍校验日历结构：空历照旧抛 work_calendar_empty', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 1, 1)],
        calendar: calendar({ anchor_date: null, workdays: [], extra_workdates: [] }),
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'work_calendar_empty',
    );
  });

  it('无包且无检查记录窗口 → ordinals 为空数组', () => {
    assert.deepEqual(projectSchedule({ packages: [], calendar: calendar({ anchor_date: null }) }).ordinals, []);
  });
});

describe('§16：检查记录窗口不进 forecast', () => {
  const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A']), pkg('C', 30, 2, 2, ['B'])];

  it('无检查记录窗口 → check_window 全为 null，forecast 等于 baseline', () => {
    const projection = projectSchedule({ packages, calendar: calendar() });
    for (const id of ['A', 'B', 'C']) {
      assert.equal(projection.packages[id].check_window, null);
      assert.equal(
        JSON.stringify(projection.packages[id].forecast),
        JSON.stringify(projection.packages[id].baseline),
      );
    }
    assert.equal(projection.packages.B.forecast.start_ord, 3);
  });

  it('声明 min≥3、两项检查同日 → forecast 保持计划值，check_window 单独给出证据 ord', () => {
    // 三审探针：旧实现把 forecast 压成当天开始、当天结束，后继从第 2 日开始。
    const projection = projectSchedule({
      packages: [pkg('PKG-005', 5, 3, 7), pkg('NEXT', 10, 2, 2, ['PKG-005'])],
      calendar: calendar(),
      check_windows: { 'PKG-005': { start_date: '2026-01-05', end_date: '2026-01-05' } },
    });
    assert.deepEqual(projection.packages['PKG-005'].check_window, checkEvidence('2026-01-05', '2026-01-05', 1, 1));
    assert.deepEqual(
      projection.packages['PKG-005'].forecast,
      { start_ord: 1, end_ord_min: 3, end_ord_max: 7 },
    );
    assert.equal(
      JSON.stringify(projection.packages['PKG-005'].forecast),
      JSON.stringify(projection.packages['PKG-005'].baseline),
    );
    assert.equal(projection.packages.NEXT.forecast.start_ord, 4, '后继从计划末端起算，不从检查日的次日');
    assert.equal(
      JSON.stringify(projection.packages.NEXT.forecast),
      JSON.stringify(projection.packages.NEXT.baseline),
    );
  });

  it('检查窗口长于计划时 forecast 仍是计划，证据 ord 单独返回', () => {
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // 2026-01-05(一)…01-09(五) → ord 1…5。计划 A 只到 ord 2。
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-09' } },
    });
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-09', 1, 5));
    assert.deepEqual(projection.packages.A.forecast, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
    assert.deepEqual(projection.packages.B.forecast, { start_ord: 3, end_ord_min: 4, end_ord_max: 4 });
    assert.deepEqual(projection.packages.C.forecast, { start_ord: 5, end_ord_min: 6, end_ord_max: 6 });
    assert.equal(
      JSON.stringify(projection.packages.B.forecast),
      JSON.stringify(projection.packages.B.baseline),
    );
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

  it('检查记录窗口不吞掉 delay，delay 仍只推拓扑下游', () => {
    const withWindow = projectSchedule({
      packages,
      calendar: calendar(),
      // ROOT 的检查日期是 ord 1–5，不得把 BRANCH 的 delay 吃掉，也不得改 MAIN。
      check_windows: { ROOT: { start_date: '2026-01-05', end_date: '2026-01-09' } },
      scenario: { delay: [{ pkg: 'BRANCH', workdays: 2 }] },
    });
    assert.deepEqual(withWindow.packages.ROOT.check_window, checkEvidence('2026-01-05', '2026-01-09', 1, 5));
    assert.deepEqual(withWindow.packages.ROOT.forecast, withWindow.packages.ROOT.baseline);
    assert.deepEqual(withWindow.packages.MAIN.forecast, withWindow.packages.MAIN.baseline);
    assert.equal(withWindow.packages.BRANCH.forecast.end_ord_max, 7, 'BRANCH 工期 3+2');
    assert.equal(withWindow.packages.TAIL.forecast.start_ord, 8);
    assert.deepEqual(withWindow.scenario?.affected, [{ pkg: 'TAIL', delta: 2 }]);
  });

  it('有检查窗口的包仍吃 delay（窗口不是完工钉死）', () => {
    const withDelay = projectSchedule({
      packages: [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])],
      calendar: calendar(),
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-08' } },
      scenario: { delay: [{ pkg: 'A', workdays: 3 }] },
    });
    assert.deepEqual(withDelay.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-08', 1, 4), '证据窗口不被 delay 改写');
    assert.deepEqual(withDelay.packages.A.forecast, { start_ord: 1, end_ord_min: 5, end_ord_max: 5 }, '工期 2+3');
    assert.equal(withDelay.packages.B.forecast.start_ord, 6, '后继从计划末端加 delay 起算，不从检查窗口');
    assert.deepEqual(withDelay.scenario?.affected, [{ pkg: 'B', delta: 3 }]);
  });
});

describe('§15/M1：affected 比较完整窗口（§16 起对照基准就是 baseline）', () => {
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

  it('delay 0 且存在检查窗口：窗口不进 forecast，affected 为空', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // 检查日期 ord 1…5。旧实现会把 B 从第 3 日推到第 6 日，并可能把这次位移记进 affected。
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-09' } },
      scenario: { delay: [{ pkg: 'A', workdays: 0 }] },
    });
    assert.equal(
      JSON.stringify(projection.packages.A.forecast),
      JSON.stringify(projection.packages.A.baseline),
    );
    assert.equal(projection.packages.B.forecast.start_ord, 3, '检查窗口不得把后继从第 3 日推到第 6 日');
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-09', 1, 5));
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
    // 无锚点不得把 2026-01-07 映成序数再抬升；ordinals 的 date 也不得是编造日期（§18）
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
    assert.deepEqual(projection.ordinals.map((entry) => entry.ord), [1, 2]);
    assert.ok(projection.ordinals.every((entry) => entry.date === null));
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

describe('check_windows 以真实日期给入（§14/B3）', () => {
  it('锚点后且超出计划末端的检查日期 → 证据 ord 存在、ordinals 扩展、forecast 不顺延', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // A 计划末端只到 ord 2；检查日期扩到 01-12（跳过周末）= ord 6
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-12' } },
    });
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-12', 1, 6));
    assert.deepEqual(projection.packages.A.forecast, projection.packages.A.baseline);
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
    assert.equal(projection.packages.B.forecast.start_ord, 3, '后继不被检查日期顺延');
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 6), { ord: 6, date: '2026-01-12' });
    assert.equal(projection.ordinals.at(-1)?.ord, 6, 'ordinals 覆盖到检查窗口末端，而不是被钉死后的预测末端');
  });

  it('锚点前的检查日期 → 负 ord，ordinals 向后覆盖，forecast 保持计划', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar(),
      // ord 1 = 2026-01-05(一)：01-02(五)=0、01-01(四)=-1、2025-12-31(三)=-2
      check_windows: { A: { start_date: '2025-12-31', end_date: '2026-01-02' } },
    });
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2025-12-31', '2026-01-02', -2, 0));
    assert.deepEqual(projection.packages.A.forecast, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
    assert.equal(projection.packages.B.forecast.start_ord, 3, '后继按计划从第 3 日开始，不因检查日期提前');
    assert.deepEqual(projection.ordinals.slice(0, 4), [
      { ord: -2, date: '2025-12-31' },
      { ord: -1, date: '2026-01-01' },
      { ord: 0, date: '2026-01-02' },
      { ord: 1, date: '2026-01-05' },
    ]);
  });

  it('检查日期落在休息日/周末 → 取之后第一个工作日，不丢弃，也不改 forecast', () => {
    const packages = [pkg('A', 10, 2, 2), pkg('B', 20, 2, 2, ['A'])];
    const projection = projectSchedule({
      packages,
      calendar: calendar({ rest_dates: ['2026-01-06'] }), // 周二调休
      check_windows: { A: { start_date: '2026-01-06', end_date: '2026-01-10' } },
    });
    // 01-06(二) 调休 → 01-07(三)=ord 2；01-10(六) 周末 → 01-12(一)=ord 5
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-06', '2026-01-10', 2, 5));
    assert.equal(projection.ordinals.find((entry) => entry.ord === 2)?.date, '2026-01-07', '休息日的检查日期映射到之后第一个工作日');
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 5), { ord: 5, date: '2026-01-12' });
    assert.equal(projection.packages.B.forecast.start_ord, 3, 'forecast 不被检查日期顺延');
    assert.deepEqual(projection.packages.A.forecast, projection.packages.A.baseline);
  });

  it('start_date 晚于 end_date → invalid_check_window', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 2, 2)],
        calendar: calendar(),
        check_windows: { A: { start_date: '2026-01-08', end_date: '2026-01-05' } },
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'invalid_check_window',
    );
  });

});

describe('§17：无锚点检查窗口保留日期、序数待定', () => {
  const packages = [pkg('A', 10, 3, 7), pkg('B', 20, 2, 4, ['A'])];

  it('锚点 null + 检查窗：不抛；日期保留、序数 null；baseline/forecast/ordinals 与无检查窗逐字节相同', () => {
    const cal = calendar({ anchor_date: null });
    const bare = projectSchedule({ packages, calendar: cal });
    const withWindow = projectSchedule({
      packages,
      calendar: cal,
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-09' } },
    });
    assert.deepEqual(
      withWindow.packages.A.check_window,
      checkEvidence('2026-01-05', '2026-01-09', null, null),
    );
    assert.equal(withWindow.packages.B.check_window, null, '没有窗口的包仍是 null，不是空序数');
    for (const id of ['A', 'B']) {
      assert.equal(
        JSON.stringify(withWindow.packages[id].baseline),
        JSON.stringify(bare.packages[id].baseline),
        `${id} baseline`,
      );
      assert.equal(
        JSON.stringify(withWindow.packages[id].forecast),
        JSON.stringify(bare.packages[id].forecast),
        `${id} forecast`,
      );
    }
    assert.equal(JSON.stringify(withWindow.ordinals), JSON.stringify(bare.ordinals), '地平线不得因检查日期扩大');
    assert.ok(
      withWindow.ordinals.length > 0 && withWindow.ordinals.every((entry) => entry.date === null),
      '无锚点时 ordinals 的 date 必须为 null，不得是名义纪元日期，也不得抄入检查日',
    );
    assert.equal(withWindow.scenario, null);
    assert.equal(bare.scenario, null);
  });

  it('锚点就绪 + 检查窗：序数照常（B3 不回归）', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 2, 2)],
      calendar: calendar(),
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-06' } },
    });
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-06', 1, 2));
    assert.deepEqual(projection.packages.A.forecast, projection.packages.A.baseline);
  });

  it('非法日期串仍抛 invalid_check_window（与锚点是否就绪无关）', () => {
    for (const anchor_date of ['2026-01-05', null] as const) {
      for (const start_date of ['not-a-date', '2026-02-30']) {
        assert.throws(
          () => projectSchedule({
            packages: [pkg('A', 10, 2, 2)],
            calendar: calendar({ anchor_date }),
            check_windows: { A: { start_date, end_date: '2026-03-01' } },
          }),
          (error: unknown) => error instanceof ProjectionError && error.code === 'invalid_check_window',
          `anchor=${String(anchor_date)} start=${start_date}`,
        );
      }
    }
  });

  it('未知包仍抛 unknown_check_window_package', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 2, 2)],
        calendar: calendar(),
        check_windows: { 'PKG-NOPE': { start_date: '2026-01-05', end_date: '2026-01-06' } },
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'unknown_check_window_package',
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
      check_windows: { A: actualA, B: actualB },
    });
    const reverse = projectSchedule({
      packages,
      calendar: calendar(),
      check_windows: { B: actualB, A: actualA },
    });
    assert.deepEqual(forward, reverse, '检查记录窗口的输入顺序不得改变投影');
    assert.deepEqual(forward.packages.A.check_window, checkEvidence('2026-01-01', '2026-01-01', -1, -1));
    assert.deepEqual(forward.packages.B.check_window, checkEvidence('2025-12-31', '2025-12-31', -2, -2));
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

  it('约束日期与检查记录窗口混查：正反向映射互不干扰', () => {
    const makeInput = (order: 'AB' | 'BA') => {
      const restB = { start_date: '2025-12-31', end_date: '2025-12-31' };
      const restA = { start_date: '2026-01-01', end_date: '2026-01-01' };
      const constraintA = { id: 'C-A', type: 'not_before' as const, status: 'resolved', date: '2026-01-08' };
      const constraintB = { id: 'C-B', type: 'not_before' as const, status: 'resolved', date: '2025-12-30' };
      return {
        packages: order === 'AB' ? packages : [packages[1], packages[0]],
        calendar: calendar(),
        check_windows: order === 'AB' ? { A: restA, B: restB } : { B: restB, A: restA },
        constraints: order === 'AB' ? { A: [constraintA], B: [constraintB] } : { B: [constraintB], A: [constraintA] },
      };
    };
    const first = projectSchedule(makeInput('AB'));
    const second = projectSchedule(makeInput('BA'));
    assert.deepEqual(first, second, '包顺序与查询顺序不得改变投影');
    assert.deepEqual(first.packages.A.check_window, checkEvidence('2026-01-01', '2026-01-01', -1, -1));
    assert.deepEqual(first.packages.B.check_window, checkEvidence('2025-12-31', '2025-12-31', -2, -2));
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
      check_windows: { A: { start_date: '2025-12-31', end_date: '2026-01-01' } },
    });
    // 12-31(三) 工作日 → ord -1（01-01 休息不占 ord）；01-01 → 之后第一个工作日 01-02 = ord 0
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2025-12-31', '2026-01-01', -1, 0));
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
      check_windows: Object.fromEntries(windows),
    });
    const forward = projectSchedule(makeInput(entries));
    const reverse = projectSchedule(makeInput([...entries].reverse()));
    assert.deepEqual(forward, reverse, '反向插入检查记录窗口不得改变序数');
    for (const [index, expected] of [[0, -4], [1, -3], [2, -2]] as const) {
      assert.equal(forward.packages[`P${index}`].check_window?.start_ord, expected, `${dates[index]} 的 ord 错误`);
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
      check_windows: { A: { start_date: '2025-12-31', end_date: '2025-12-31' } },
    });
    // 12-31 之后没有任何工作日 → 第一个工作日 2026-01-05 即 ord 1
    assert.deepEqual(beforeAnchor.packages.A.check_window, checkEvidence('2025-12-31', '2025-12-31', 1, 1));
    assert.deepEqual(beforeAnchor.ordinals, [{ ord: 1, date: '2026-01-05' }]);

    const anchoredLater = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: calendar({
        workdays: [],
        rest_dates: [],
        extra_workdates: ['2026-01-05', '2026-03-05'],
        anchor_date: '2026-03-05',
      }),
      check_windows: { A: { start_date: '2026-02-01', end_date: '2026-02-01' } },
    });
    // 02-01 与锚点之间没有工作日（01-05 在目标日期之前）→ 锚点日仍是 ord 1
    assert.deepEqual(anchoredLater.packages.A.check_window, checkEvidence('2026-02-01', '2026-02-01', 1, 1));
    assert.deepEqual(anchoredLater.ordinals, [{ ord: 1, date: '2026-03-05' }]);
  });
});

describe('§16 major：稀疏工作日历的声明日必须找得到', () => {
  const sparse = calendar({
    workdays: [],
    rest_dates: [],
    extra_workdates: ['2026-01-05', '2026-03-05'],
    anchor_date: '2026-01-05',
  });

  it('Codex 探针：两天工期正向展开到第二个声明日，不报 exhausted', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 2, 2)],
      calendar: sparse,
    });
    assert.deepEqual(projection.ordinals, [
      { ord: 1, date: '2026-01-05' },
      { ord: 2, date: '2026-03-05' },
    ]);
    assert.deepEqual(projection.packages.A.baseline, { start_ord: 1, end_ord_min: 2, end_ord_max: 2 });
    assert.equal(
      JSON.stringify(projection.packages.A.forecast),
      JSON.stringify(projection.packages.A.baseline),
    );
  });

  it('同场景锚点在后一个声明日：锚点前的声明日反向映射得到 ord 0', () => {
    const projection = projectSchedule({
      packages: [pkg('A', 10, 1, 1)],
      calendar: calendar({
        workdays: [],
        rest_dates: [],
        extra_workdates: ['2026-01-05', '2026-03-05'],
        anchor_date: '2026-03-05',
      }),
      check_windows: { A: { start_date: '2026-01-05', end_date: '2026-01-05' } },
    });
    assert.deepEqual(projection.packages.A.check_window, checkEvidence('2026-01-05', '2026-01-05', 0, 0));
    assert.deepEqual(projection.ordinals.find((entry) => entry.ord === 0), { ord: 0, date: '2026-01-05' });
    assert.deepEqual(projection.packages.A.forecast, { start_ord: 1, end_ord_min: 1, end_ord_max: 1 });
  });

  it('声明日不够凑工期时仍报 work_calendar_exhausted', () => {
    assert.throws(
      () => projectSchedule({
        packages: [pkg('A', 10, 3, 3)],
        calendar: sparse,
      }),
      (error: unknown) => error instanceof ProjectionError && error.code === 'work_calendar_exhausted',
    );
  });
});

describe('detectCoordinationConflicts：潜在重叠与已确认冲突分开', () => {
  const packages = [pkg('X', 10, 5, 5), pkg('Y', 20, 5, 5), pkg('Z', 30, 3, 3, ['X'])];
  const projection = projectSchedule({ packages, calendar: calendar() });

  it('没有确认日期的同角色 onsite 重叠只记潜在；notify / remote 不参与', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '空调商', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '空调商', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
      { sch_id: 'SCH-N', pkg: 'X', role: '空调商', mode: 'notify' },
      { sch_id: 'SCH-R', pkg: 'Y', role: '空调商', mode: 'remote' },
    ], projection);
    assert.deepEqual(report.conflicts, []);
    assert.equal(report.potential.length, 1);
    assert.equal(report.potential[0].role, '空调商');
    assert.deepEqual(report.potential[0].sch_ids, ['SCH-X', 'SCH-Y']);
    assert.match(report.potential[0].reason, /潜在窗口重叠/);
    assert.match(report.potential[0].reason, /不是确定冲突/);
    assert.ok(!report.potential[0].sch_ids.includes('SCH-N'));
    assert.ok(!report.potential[0].sch_ids.includes('SCH-R'));
  });

  it('潜在窗口不重叠 → potential 为空；不同角色各自单项也不报', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '空调商', mode: 'onsite' }, // 1–5
      { sch_id: 'SCH-Z', pkg: 'Z', role: '空调商', mode: 'onsite' }, // 6–8
      { sch_id: 'SCH-Y', pkg: 'Y', role: '施工方', mode: 'onsite' }, // 1–5，不同角色
    ], projection);
    assert.deepEqual(report, { conflicts: [], potential: [] });
  });

  it('两条 confirmed 同日同角色 onsite → conflicts 1（即使包的预测区间不重叠）', () => {
    // X 占 1–2，Y 占 3–4。旧算法按包区间不报冲突；真实占用是 confirmed_at 当天。
    const disjoint = projectSchedule({
      packages: [pkg('X', 10, 2, 2), pkg('Y', 20, 2, 2, ['X'])],
      calendar: calendar(),
    });
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-01-06' },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-01-06' },
    ], disjoint);
    assert.equal(report.conflicts.length, 1);
    assert.equal(report.conflicts[0].role, '业主');
    assert.deepEqual(report.conflicts[0].sch_ids, ['SCH-X', 'SCH-Y']);
    assert.match(report.conflicts[0].reason, /2026-01-06/);
    assert.deepEqual(report.potential, []);
  });

  it('一条 confirmed 一条 pending → 不冲突', () => {
    // 两条包区间都是 1–5，旧算法必然报冲突。
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: '2026-01-05' },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
    ], projection);
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(report.potential, [], 'confirmed 不进潜在窗口，单条 pending 不自成重叠');
  });

  it('status=confirmed 但没有 confirmed_at → 仍只是潜在窗口', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'confirmed', confirmed_at: null },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'confirmed' },
    ], projection);
    assert.deepEqual(report.conflicts, []);
    assert.equal(report.potential.length, 1);
    assert.deepEqual(report.potential[0].sch_ids, ['SCH-X', 'SCH-Y']);
  });
});

describe('§17 minor：cancelled 在分组前退出', () => {
  const packages = [pkg('X', 10, 5, 5), pkg('Y', 20, 5, 5)];
  const projection = projectSchedule({ packages, calendar: calendar() });

  it('cancelled + pending 同角色 onsite → conflicts 与 potential 均空', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'cancelled', confirmed_at: '2026-01-05' },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
    ], projection);
    assert.deepEqual(report.conflicts, []);
    assert.deepEqual(report.potential, []);
  });

  it('cancelled + cancelled → 空', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'cancelled', confirmed_at: '2026-01-06' },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'cancelled', confirmed_at: '2026-01-06' },
    ], projection);
    assert.deepEqual(report, { conflicts: [], potential: [] });
  });

  it('pending + pending → potential 照实（不回归）', () => {
    const report = detectCoordinationConflicts([
      { sch_id: 'SCH-X', pkg: 'X', role: '业主', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
      { sch_id: 'SCH-Y', pkg: 'Y', role: '业主', mode: 'onsite', status: 'pending_invite', confirmed_at: null },
    ], projection);
    assert.deepEqual(report.conflicts, []);
    assert.equal(report.potential.length, 1);
    assert.deepEqual(report.potential[0].sch_ids, ['SCH-X', 'SCH-Y']);
    assert.match(report.potential[0].reason, /潜在窗口重叠/);
  });
});

interface ControlCheck {
  id?: string;
  coordination?: {
    required_roles?: string[];
    mode?: 'onsite' | 'remote' | 'notify';
    status?: string;
    confirmed_at?: string | null;
  };
}

interface ControlPackage {
  id: string;
  sequence: number;
  dependencies?: string[];
  duration_workdays?: { min: number; max: number };
  constraints?: ProjectionConstraint[];
  checks?: ControlCheck[];
}

/** 真实 control.yaml → 投影输入。sequence≥900 的侧车道由调用方过滤，与 loader 同一刀。不跑 loader。 */
function loadRealProjectionInput(): {
  packages: ProjectionPackage[];
  calendar: ProjectionCalendar;
  constraints: Record<string, ProjectionConstraint[]>;
  coordinationItems: Array<{
    sch_id: string;
    pkg: string;
    role: string;
    mode: 'onsite' | 'remote' | 'notify';
    status: string;
    confirmed_at: string | null;
  }>;
} {
  const control = parseYaml(readFileSync(new URL('../../schedule/phase-1/control.yaml', import.meta.url), 'utf8')) as {
    work_calendar: ProjectionCalendar & { anchor_status?: string };
    work_packages: ControlPackage[];
  };
  const main = control.work_packages.filter((pkg) => pkg.sequence < 900);
  const constraints: Record<string, ProjectionConstraint[]> = {};
  const coordinationItems: Array<{
    sch_id: string;
    pkg: string;
    role: string;
    mode: 'onsite' | 'remote' | 'notify';
    status: string;
    confirmed_at: string | null;
  }> = [];
  for (const pkg of main) {
    if (Array.isArray(pkg.constraints) && pkg.constraints.length > 0) {
      constraints[pkg.id] = pkg.constraints.map((constraint) => ({
        id: constraint.id,
        type: constraint.type,
        status: constraint.status,
        date: constraint.date ?? null,
        ...(typeof constraint.detail === 'string' ? { detail: constraint.detail } : {}),
      }));
    }
    for (const check of pkg.checks ?? []) {
      const block = check.coordination;
      if (!block || !check.id || !block.mode) continue;
      for (const role of block.required_roles ?? []) {
        coordinationItems.push({
          sch_id: check.id,
          pkg: pkg.id,
          role,
          mode: block.mode,
          status: block.status ?? '',
          confirmed_at: block.confirmed_at ?? null,
        });
      }
    }
  }
  return {
    packages: main.map((pkg) => ({
      id: pkg.id,
      sequence: pkg.sequence,
      dependencies: Array.isArray(pkg.dependencies) ? [...pkg.dependencies] : [],
      duration_workdays: { min: pkg.duration_workdays?.min ?? Number.NaN, max: pkg.duration_workdays?.max ?? Number.NaN },
    })),
    calendar: {
      workdays: control.work_calendar.workdays,
      rest_dates: control.work_calendar.rest_dates,
      extra_workdates: control.work_calendar.extra_workdates,
      anchor_date: control.work_calendar.anchor_date,
    },
    constraints,
    coordinationItems,
  };
}

describe('§16：真实 control.yaml，无 scenario 时 forecast 与 baseline 逐字节相同', () => {
  it('24 个主车道包逐包 JSON 相同，检查窗口全为 null', () => {
    const input = loadRealProjectionInput();
    assert.equal(input.packages.length, 24);
    const projection = projectSchedule({
      packages: input.packages,
      calendar: input.calendar,
      constraints: input.constraints,
    });
    assert.equal(projection.scenario, null);
    for (const id of Object.keys(projection.packages)) {
      assert.equal(projection.packages[id].check_window, null, id);
      assert.equal(
        JSON.stringify(projection.packages[id].forecast),
        JSON.stringify(projection.packages[id].baseline),
        `${id} forecast 与 baseline 必须逐字节相同`,
      );
    }
  });
});

describe('§16 minor：当前试点协调数据', () => {
  it('4 条全 pending_invite → conflicts 0，potential 按预测区间重叠照实', () => {
    const input = loadRealProjectionInput();
    const schIds = [...new Set(input.coordinationItems.map((item) => item.sch_id))].sort();
    assert.deepEqual(schIds, ['SCH-000-01', 'SCH-000-02', 'SCH-005-01', 'SCH-070-01']);
    assert.ok(input.coordinationItems.every((item) => item.status === 'pending_invite'));
    assert.ok(input.coordinationItems.every((item) => item.confirmed_at === null));

    const projection = projectSchedule({
      packages: input.packages,
      calendar: input.calendar,
      constraints: input.constraints,
    });
    assert.equal(projection.packages['PKG-000'].forecast.start_ord, 1);
    assert.equal(projection.packages['PKG-000'].forecast.end_ord_max, 25);

    // 潜在窗口是 [乐观 start_ord, 保守 end_ord_max]，不是某一遍的完整区间。
    // PKG-000 是 1–25；PKG-005 是 16–32，与前者重叠。PKG-070 乐观起点是 37，
    // 接不上 32，所以 SCH-070-01 不进任何潜在簇。施工方/设计师不在 SCH-005 上，只有两条 SCH-000。
    assert.deepEqual(
      [projection.packages['PKG-005'].forecast.start_ord, projection.packages['PKG-005'].forecast.end_ord_max],
      [16, 32],
    );
    assert.equal(projection.packages['PKG-070'].forecast.start_ord, 37);

    const report = detectCoordinationConflicts(input.coordinationItems, projection);
    assert.deepEqual(report.conflicts, []);
    const byRole = new Map(report.potential.map((entry) => [entry.role, entry]));
    assert.deepEqual(
      [...byRole.keys()].sort((left, right) => left.localeCompare(right)),
      ['业主', '施工方', '设计师'].sort((left, right) => left.localeCompare(right)),
    );
    const owner = byRole.get('业主');
    assert.ok(owner);
    assert.deepEqual(owner.sch_ids, ['SCH-000-01', 'SCH-000-02', 'SCH-005-01']);
    assert.match(owner.reason, /SCH-000-01 第 1–25 工作日/);
    assert.match(owner.reason, /SCH-000-02 第 1–25 工作日/);
    assert.match(owner.reason, /SCH-005-01 第 16–32 工作日/);
    assert.match(owner.reason, /不是确定冲突/);
    assert.deepEqual(byRole.get('施工方')?.sch_ids, ['SCH-000-01', 'SCH-000-02']);
    assert.deepEqual(byRole.get('设计师')?.sch_ids, ['SCH-000-01', 'SCH-000-02']);
    assert.ok(!report.potential.some((entry) => entry.sch_ids.includes('SCH-070-01')));
    assert.ok(!report.potential.some((entry) => entry.role === '空调商' || entry.role === '物业' || entry.role === '橱柜供应商'));
  });
});
