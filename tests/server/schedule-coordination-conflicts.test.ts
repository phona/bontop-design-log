// 协调冲突接线的回归测试（issue #202 S3.2 收尾）。
//
// 守什么：冲突检测的单一来源是 shared/schedule-projection.ts 的 detectCoordinationConflicts；
// loader（shared/schedule-state.ts）只做摊平 + 接线，不写第二套冲突口径。这里钉四件事：
//   ① 真实 control.yaml：loadScheduleState + buildScheduleSnapshot 后 coordination_conflicts
//      键存在，conflicts 0、potential 4 簇，role→sch_ids 与模块测试「§16 minor：当前试点协调数据」
//      （tests/server/schedule-projection.test.ts）逐条一致——设计 §20 留给业主裁的「模块函数与
//      面板分类是同一口径两处实现」张力，在 loader 侧从此有机器对账；
//   ② coordinationScheduleItems 只走 required_roles：owner_role（协调组织者）不产出条目，
//      侧车道 PKG-900 不进（投影里没有它的包，硬塞会被模块判 unknown_coordination_package）；
//   ③ 无 coordination 时快照键是 {conflicts: [], potential: []}，不是 undefined——键缺失 =
//      不知道（旧快照/旧服务端），空报告 = 无冲突，两者语义不同（缺失语义三分）；
//   ④ 真有冲突时键里带得出 conflicts：沙箱把两条 onsite 预约改成同日 confirmed，已确认条目
//      同时退出 potential——证明接的不是「恒空报告」。
//
// 沙箱形态沿用 tests/server/schedule-state.test.ts（symlink 农场 + 只改副本的 schedule/）；
// 手术用 js-yaml 解析后再改树，不做文本锚点替换。

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dump as dumpYaml, load as parseYaml } from 'js-yaml';
import { buildScheduleSnapshot, coordinationScheduleItems, loadScheduleState } from '../../shared/schedule-state.js';
import { loadModelPackageLinks } from '../../server/model-package-links.js';

type AnyRecord = Record<string, any>;

const repoRoot = process.cwd();

function loadState(root: string = repoRoot) {
  return loadScheduleState(root, {
    modelPackageLinks: loadModelPackageLinks(root === repoRoot ? undefined : join(root, 'config/model-package-links.yaml')),
  });
}

function byRoleKey(left: string, right: string): number {
  return left.localeCompare(right);
}

describe('真实 control.yaml：协调冲突进快照（与模块测试同口径）', () => {
  it('coordination_conflicts 存在：conflicts 0，potential 4 簇与 schedule-projection.test.ts 逐条一致', () => {
    const state = loadState();
    assert.deepEqual(state.errors, []);
    const snapshot = buildScheduleSnapshot(state);
    const report = snapshot.coordination_conflicts;
    assert.ok(report, '真实控制源有 9 条 coordination 声明，coordination_conflicts 键必须存在（键缺失 = 不知道，不是无冲突）');
    // 9 条试点协调全 pending_invite / confirmed_at null（尚未交房、无人可确认是诚实态），
    // 没有同日已确认的真实占用 → conflicts 必空。
    assert.deepEqual(report!.conflicts, []);

    // potential 4 簇：业主 7 / 设计师 6 / 施工方 3 / 空调商 3。
    // 逐条与 tests/server/schedule-projection.test.ts 的「§16 minor：当前试点协调数据」同值——
    // 该用例直接调模块，这里走 loader 摊平，两条路必须给出同一份 sch_ids。
    const byRole = new Map(report!.potential.map((entry) => [entry.role, entry]));
    assert.deepEqual(
      [...byRole.keys()].sort(byRoleKey),
      ['业主', '施工方', '空调商', '设计师'].sort(byRoleKey),
      '只有同角色 onsite 且未确认的窗口才成簇（remote/notify 在模块分组前退出）',
    );
    assert.deepEqual(byRole.get('业主')?.sch_ids, [
      'SCH-000-01',
      'SCH-000-02',
      'SCH-005-01',
      'SCH-010-02',
      'SCH-030-04',
      'SCH-040-03',
      'SCH-070-01',
    ]);
    assert.deepEqual(byRole.get('设计师')?.sch_ids, [
      'SCH-000-01',
      'SCH-000-02',
      'SCH-010-02',
      'SCH-030-04',
      'SCH-040-03',
      'SCH-070-01',
    ]);
    assert.deepEqual(byRole.get('施工方')?.sch_ids, ['SCH-000-01', 'SCH-000-02', 'SCH-010-02']);
    assert.deepEqual(byRole.get('空调商')?.sch_ids, ['SCH-030-04', 'SCH-040-03', 'SCH-070-01']);
    assert.equal(report!.potential.length, 4);
    // SCH-080-01 是 remote、SCH-090-01 是 notify：不进任何潜在簇（模块口径，不是 loader 过滤）
    for (const exitId of ['SCH-080-01', 'SCH-090-01']) {
      assert.ok(!report!.potential.some((entry) => entry.sch_ids.includes(exitId)), `${exitId} 不得进潜在簇`);
    }
    // 单一来源：load 期算完的值与 build 搬进快照的是同一份（不是装配期第二算）
    assert.deepEqual(state.coordinationConflicts, report);

    // 摊平只走 required_roles：真实数据里 owner_role 恰好都在 required_roles 内，所以逐条
    // 相等本身证明不了排除——排除由下面的构造用例钉，这里钉的是「每条 SCH 的角色集 ==
    // 声明的 required_roles」，防下游把 owner_role 或别的字段并进来。
    const items = coordinationScheduleItems(state.control);
    for (const pkg of state.control.work_packages) {
      for (const check of pkg.checks ?? []) {
        if (!check.coordination) continue;
        assert.deepEqual(
          items.filter((item) => item.sch_id === check.id).map((item) => item.role),
          check.coordination.required_roles,
          `${check.id} 的协调项角色集必须逐一对应 required_roles`,
        );
      }
    }
  });
});

describe('coordinationScheduleItems：只走 required_roles（owner_role 是组织者，不是到场参与者）', () => {
  // owner_role 刻意不在 required_roles 里（设计师组织，但只要求业主与施工方到场）：
  // 若摊平把 owner_role 当参与者，detectCoordinationConflicts 就会把组织者算成占用——
  // 这正是 S3 的 Codex blocking 主题，必须在 loader 侧同样钉死。
  const control: AnyRecord = {
    work_packages: [
      {
        id: 'PKG-X',
        sequence: 10,
        checks: [
          {
            id: 'SCH-X-01',
            coordination: {
              required_roles: ['业主', '施工方'],
              mode: 'onsite',
              lead_time_workdays: 3,
              owner_role: '设计师',
              status: 'pending_invite',
              actor: {name: null, org: null},
              confirmed_at: null,
              escalation: '提前量过半未确认 → 升级到业主并顺延预测窗口',
            },
          },
          {id: 'SCH-X-02'},
        ],
      },
      {
        // 侧车道（sequence 900）不参与排程，投影里没有它的包
        id: 'PKG-900',
        sequence: 900,
        checks: [
          {
            id: 'SCH-900-01',
            coordination: {
              required_roles: ['业主'],
              mode: 'onsite',
              lead_time_workdays: 1,
              owner_role: '业主',
              status: 'pending_invite',
              actor: {name: null, org: null},
              confirmed_at: null,
              escalation: '不确认则不动用预备金',
            },
          },
        ],
      },
    ],
  };

  it('owner_role 不在 required_roles 时不产出该角色条目', () => {
    const items = coordinationScheduleItems(control);
    assert.deepEqual(items, [
      {sch_id: 'SCH-X-01', pkg: 'PKG-X', role: '业主', mode: 'onsite', status: 'pending_invite', confirmed_at: null},
      {sch_id: 'SCH-X-01', pkg: 'PKG-X', role: '施工方', mode: 'onsite', status: 'pending_invite', confirmed_at: null},
    ]);
    assert.ok(!items.some((item) => item.role === '设计师'), 'owner_role＝组织者，不得作为到场参与者产出');
    assert.deepEqual(
      items.map((item) => item.role),
      control.work_packages[0].checks[0].coordination.required_roles,
    );
  });

  it('侧车道 PKG-900 不进（摊平后的包集必须与投影的主车道一致）', () => {
    assert.ok(!coordinationScheduleItems(control).some((item) => item.pkg === 'PKG-900'));
  });

  it('无 coordination 块 / 空 required_roles → 空数组，不是 undefined', () => {
    assert.deepEqual(coordinationScheduleItems({work_packages: [{id: 'PKG-A', sequence: 5, checks: [{id: 'SCH-A-01'}]}]}), []);
    assert.deepEqual(
      coordinationScheduleItems({
        work_packages: [{id: 'PKG-A', sequence: 5, checks: [{id: 'SCH-A-01', coordination: {required_roles: [], mode: 'onsite'}}]}],
      }),
      [],
    );
  });

  // Codex 二审 blocking（2026-11-12 修）：重复角色会让单条预约产出两条占用项、与自己成簇
  // （confirmed → sch_ids ['SCH-Y-01','SCH-Y-01'] 的「确定冲突」；旧面板用 includes 判角色，
  // 每条 SCH 只计一次，故这是接线后的回归）。摊平层去重（保序）是第一道；校验层已把重复角色
  // 报成 coordination_roles_duplicate（见沙箱用例），这里钉「即使校验被绕过也不自冲突」。
  it('重复角色去重（保序）：单条预约不与自身成冲突', () => {
    const items = coordinationScheduleItems({
      work_packages: [{
        id: 'PKG-Y',
        sequence: 10,
        checks: [{
          id: 'SCH-Y-01',
          coordination: {
            required_roles: ['业主', '业主', '施工方'],
            mode: 'onsite',
            lead_time_workdays: 1,
            owner_role: '业主',
            status: 'confirmed',
            actor: {name: '王工', org: null},
            confirmed_at: '2026-03-02',
            escalation: '提前量过半未确认 → 升级到业主并顺延预测窗口',
          },
        }],
      }],
    });
    assert.deepEqual(items.map((item) => item.role), ['业主', '施工方'], '重复角色必须去重且保序');
    assert.equal(items.filter((item) => item.role === '业主').length, 1);
    assert.ok(!items.some((item, index) => items.some((other, otherIndex) => index !== otherIndex && other.sch_id === item.sch_id && other.role === item.role)), '同一 SCH 同一角色不得出现两条');
  });
});

describe('沙箱（symlink 农场，js-yaml 改树）：空报告与真冲突', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'schedule-conflicts-'));
  let pristineControlText = '';

  before(() => {
    for (const entry of readdirSync(repoRoot)) {
      if (entry === '.git' || entry === 'node_modules' || entry === 'schedule' || entry === 'contracts') continue;
      symlinkSync(join(repoRoot, entry), join(sandbox, entry));
    }
    symlinkSync(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'));
    cpSync(join(repoRoot, 'schedule'), join(sandbox, 'schedule'), {recursive: true});
    cpSync(join(repoRoot, 'contracts'), join(sandbox, 'contracts'), {recursive: true});
    pristineControlText = readFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), 'utf8');
  });

  after(() => {
    rmSync(sandbox, {recursive: true, force: true});
  });

  function writeControl(mutate: (tree: AnyRecord) => void): void {
    const tree = parseYaml(pristineControlText) as AnyRecord;
    mutate(tree);
    writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), dumpYaml(tree, {lineWidth: -1}));
  }

  function findCheck(tree: AnyRecord, schId: string): AnyRecord {
    for (const pkg of tree.work_packages ?? []) {
      for (const check of pkg.checks ?? []) {
        if (check.id === schId) return check;
      }
    }
    throw new Error(`沙箱手术找不到检查 ${schId}——锚点漂移，本测试当场点名`);
  }

  it('去掉全部 coordination 块：键是 {conflicts: [], potential: []}，不是 undefined', () => {
    writeControl((tree) => {
      let removed = 0;
      for (const pkg of tree.work_packages ?? []) {
        for (const check of pkg.checks ?? []) {
          if (check.coordination !== undefined) {
            delete check.coordination;
            removed += 1;
          }
        }
      }
      assert.equal(removed, 9, '试点数据 9 条 coordination（设计 §20）；数量漂移时本测试当场点名');
    });
    try {
      const state = loadState(sandbox);
      assert.deepEqual(state.errors, []);
      assert.ok(
        Object.hasOwn(buildScheduleSnapshot(state), 'coordination_conflicts'),
        '无 coordination 也要带键：键缺失 = 不知道（旧快照/旧服务端），空报告 = 无冲突，两者不同',
      );
      assert.deepEqual(state.coordinationConflicts, {conflicts: [], potential: []});
      assert.deepEqual(buildScheduleSnapshot(state).coordination_conflicts, {conflicts: [], potential: []});
      // 同一份数据的 coordination 键同样退化成空映射，不造空对象
      assert.deepEqual(buildScheduleSnapshot(state).coordination, {});
    } finally {
      writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), pristineControlText);
    }
  });

  it('required_roles 含重复角色：报 coordination_roles_duplicate（fail-loud，不静默去重）', () => {
    writeControl((tree) => {
      const coordination = findCheck(tree, 'SCH-000-01').coordination;
      coordination.required_roles = ['业主', '业主', '施工方'];
    });
    try {
      const state = loadState(sandbox);
      assert.ok(
        state.errors.some((error) => error.includes('coordination_roles_duplicate')),
        `重复角色必须显形为错误（声明错误不静默去重），实际 errors：${JSON.stringify(state.errors)}`,
      );
      // fail-loud 走 errors（非空 → route 在 build 之前 503，报告不会被消费）；即便这里仍算出了报告，
      // 也不得出现「同一条预约与自己成簇」的伪冲突——摊平层去重是第二道保险。
      const report = state.coordinationConflicts;
      if (report) {
        for (const entry of [...report.conflicts, ...report.potential]) {
          assert.equal(new Set(entry.sch_ids).size, entry.sch_ids.length, `簇内不得有重复成员：${JSON.stringify(entry)}`);
        }
      }
    } finally {
      writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), pristineControlText);
    }
  });

  it('两条同包 onsite 改成同日 confirmed：conflicts 3 簇，且它们退出 potential', () => {
    writeControl((tree) => {
      for (const schId of ['SCH-000-01', 'SCH-000-02']) {
        const coordination = findCheck(tree, schId).coordination;
        coordination.status = 'confirmed';
        coordination.confirmed_at = '2026-01-06';
        coordination.actor = {name: '王工', org: null};
      }
    });
    try {
      const state = loadState(sandbox);
      assert.deepEqual(state.errors, []);
      const report = state.coordinationConflicts;
      assert.ok(report);
      // 共同角色 = 业主 / 施工方 / 设计师（空调商与橱柜供应商只有 SCH-000-02 一条 → 不成簇）
      assert.deepEqual(
        report!.conflicts.map((entry) => entry.role).sort(byRoleKey),
        ['业主', '施工方', '设计师'].sort(byRoleKey),
      );
      for (const conflict of report!.conflicts) {
        assert.deepEqual(conflict.sch_ids, ['SCH-000-01', 'SCH-000-02']);
        assert.match(conflict.reason, /同一天两处现场/);
        assert.match(conflict.reason, /2026-01-06/);
      }
      // 已确认条目退出潜在窗口（confirmed 不进 potential）：两包不再出现在任何潜在簇里
      assert.ok(
        !report!.potential.some((entry) => entry.sch_ids.includes('SCH-000-01') || entry.sch_ids.includes('SCH-000-02')),
        `已确认的 SCH-000-01/02 不得留在潜在簇，实际：${JSON.stringify(report!.potential)}`,
      );
      // 快照键搬的就是这份报告（键存在且带冲突簇，不是空报告）
      const snapshot = buildScheduleSnapshot(state);
      assert.deepEqual(snapshot.coordination_conflicts, report);
      assert.equal(snapshot.coordination_conflicts?.conflicts.length, 3);
    } finally {
      writeFileSync(join(sandbox, 'schedule/phase-1/control.yaml'), pristineControlText);
    }
  });
});
