// tests/server/decision-gates.test.ts
//
// 决策门禁机制（config/decision-gates.yaml + scripts/schedule/decision-gates.ts）
// 的回归测试。这个机制防的失效很具体：未拍板的档位（打压、闭水、龙骨间距……）
// 被当成验收合格线悄悄放行——一边 check 写死数值，一边决策点说未拍板，
// 两边互不知情，门禁全绿。测试把每一种「门禁失效」固化成断言：
// 判定函数是纯函数，直接喂数据；真实仓状态用 CLI spawn 做集成冒烟。

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  collectProseMentions,
  openDecisionsBlocking,
  parseDecisionGates,
  readNarrativeDecisionIds,
  validateDecisionGates,
  type Decision,
  type DecisionGates,
} from '../../scripts/schedule/decision-gates.js';

const gate = (overrides: Partial<Decision> = {}): Decision => ({
  id: 'D5',
  topic: '打压与闭水档位',
  scope: 'acceptance',
  question: '打压取哪一档',
  options: ['0.8MPa 档', '0.6MPa 档'],
  status: 'open',
  blocks: ['check_plumb_pressure'],
  blocked_effect: '档位写进合同前不得判 passed',
  ...overrides,
});

const gatesOf = (...decisions: Decision[]): DecisionGates => ({ version: 1, decisions });

const run = (input: Parameters<typeof validateDecisionGates>[0]) =>
  validateDecisionGates(input).map((issue) => issue.code);

describe('决策门禁：合法登记表零 issue', () => {
  it('开放门禁 + 无 passed 记录 + 无散文引用 → 通过', () => {
    assert.deepEqual(
      run({
        gates: gatesOf(gate()),
        knownCheckIds: new Set(['check_plumb_pressure']),
        passedCheckIds: new Set(),
        proseMentions: [],
      }),
      [],
    );
  });

  it('已拍板门禁保留 blocks 且留痕四件套齐全 → 通过', () => {
    assert.deepEqual(
      run({
        gates: gatesOf(gate({
          status: 'decided',
          decided_value: '0.8MPa 保压 30min',
          decided_by: '业主',
          decided_at: '2026-10-31',
          decision_evidence: ['docs/decisions/xxx.md'],
        })),
        knownCheckIds: new Set(['check_plumb_pressure']),
        passedCheckIds: new Set(['check_plumb_pressure']),
        proseMentions: [],
      }),
      [],
    );
  });
});

describe('决策门禁：门禁语义（未拍板不得放行）', () => {
  it('开放门禁的阻塞项已有 passed 记录 → passed_under_open_decision', () => {
    const codes = run({
      gates: gatesOf(gate()),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(['check_plumb_pressure']),
      proseMentions: [],
    });
    assert.ok(codes.includes('passed_under_open_decision'), `实际：${codes.join(',')}`);
  });

  it('已拍板后阻塞项可以 passed，但缺留痕四件套 → decided_requires_record', () => {
    const codes = run({
      gates: gatesOf(gate({ status: 'decided', decided_value: '0.8MPa' })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(['check_plumb_pressure']),
      proseMentions: [],
    });
    assert.ok(codes.includes('decided_requires_record'), `实际：${codes.join(',')}`);
    assert.ok(!codes.includes('passed_under_open_decision'));
  });

  it('已拍板却清空 blocks → decided_gate_without_blocks（记录它曾经阻塞什么）', () => {
    const codes = run({
      gates: gatesOf(gate({
        status: 'decided', blocks: [],
        decided_value: 'v', decided_by: '业主', decided_at: '2026-10-31', decision_evidence: ['e'],
      })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('decided_gate_without_blocks'), `实际：${codes.join(',')}`);
  });
});

describe('决策门禁：登记表结构', () => {
  it('scope=acceptance 不写 blocks / blocked_effect → 两项结构错误', () => {
    const codes = run({
      gates: gatesOf(gate({ blocks: undefined, blocked_effect: undefined })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('acceptance_requires_blocks'));
    assert.ok(codes.includes('acceptance_requires_blocked_effect'));
  });

  it('scope=tracked 不写 tracking_note 或擅自 blocks → 两项错误', () => {
    const codes = run({
      gates: gatesOf(gate({ scope: 'tracked', tracking_note: undefined })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('tracked_requires_note'));
    assert.ok(codes.includes('tracked_must_not_block'));
  });

  it('blocks 引用不存在的验收项 → unknown_blocked_check', () => {
    const codes = run({
      gates: gatesOf(gate({ blocks: ['check_typo'] })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('unknown_blocked_check'), `实际：${codes.join(',')}`);
  });

  it('同一验收项被两个决策阻塞 → check_blocked_by_multiple_decisions', () => {
    const codes = run({
      gates: gatesOf(
        gate(),
        gate({ id: 'D9', topic: '龙骨间距', blocks: ['check_plumb_pressure'] }),
      ),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('check_blocked_by_multiple_decisions'), `实际：${codes.join(',')}`);
  });

  it('编号重复 / 形态非法 / 选项只有一个 → 各自报错', () => {
    const codes = run({
      gates: gatesOf(gate(), gate({ id: 'D5' }), gate({ id: 'D-1' }), gate({ id: 'D7', options: ['只有一个'] })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
    });
    assert.ok(codes.includes('duplicate_decision_id'));
    assert.ok(codes.includes('decision_id_format'));
    assert.ok(codes.includes('options_min_two'));
  });
});

describe('决策门禁：散文反向防线', () => {
  it('散文提了未登记的决策编号 → prose_decision_unregistered', () => {
    const codes = run({
      gates: gatesOf(gate()),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [{ source: 'config/acceptance.yaml:check_x.knowledge', decisionId: 'D19', namedChecks: [] }],
    });
    assert.ok(codes.includes('prose_decision_unregistered'), `实际：${codes.join(',')}`);
  });

  it('散文说「待 D5 拍板、不得擅自改写 check_plumb_pressure」但 blocks 没收它 → prose_block_mismatch', () => {
    const codes = run({
      gates: gatesOf(gate({ blocks: ['check_wp_flood'] })),
      knownCheckIds: new Set(['check_plumb_pressure', 'check_wp_flood']),
      passedCheckIds: new Set(),
      proseMentions: [{
        source: 'config/acceptance.yaml:check_gate.knowledge',
        decisionId: 'D5',
        namedChecks: ['check_plumb_pressure'],
      }],
    });
    assert.ok(codes.includes('prose_block_mismatch'), `实际：${codes.join(',')}`);
  });

  it('散文点名与 blocks 一致 → 不报错', () => {
    const codes = run({
      gates: gatesOf(gate()),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [{
        source: 'config/acceptance.yaml:check_gate.knowledge',
        decisionId: 'D5',
        namedChecks: ['check_plumb_pressure'],
      }],
    });
    assert.deepEqual(codes, []);
  });
});

describe('决策门禁：叙事登记表双向对照', () => {
  it('叙事侧有、机器侧没有 → decision_missing_from_gates', () => {
    const codes = run({
      gates: gatesOf(gate()),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
      narrativeDecisionIds: new Set(['D5', 'D19']),
    });
    assert.ok(codes.includes('decision_missing_from_gates'), `实际：${codes.join(',')}`);
  });

  it('机器侧有、叙事侧没有 → decision_missing_from_docs', () => {
    const codes = run({
      gates: gatesOf(gate({ id: 'D20' })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
      narrativeDecisionIds: new Set(['D5']),
    });
    assert.ok(codes.includes('decision_missing_from_docs'), `实际：${codes.join(',')}`);
  });

  it('已拍板但叙事仍列待拍板 → warning decided_but_narrative_pending（不挡 CI，只催同步）', () => {
    const issues = validateDecisionGates({
      gates: gatesOf(gate({
        status: 'decided',
        decided_value: 'v', decided_by: '业主', decided_at: '2026-10-31', decision_evidence: ['e'],
      })),
      knownCheckIds: new Set(['check_plumb_pressure']),
      passedCheckIds: new Set(),
      proseMentions: [],
      narrativeDecisionIds: new Set(['D5']),
    });
    assert.deepEqual(issues.map((issue) => issue.code), ['decided_but_narrative_pending']);
    assert.equal(issues[0].severity, 'warning');
  });

  it('两侧一致 → 零 issue', () => {
    assert.deepEqual(
      run({
        gates: gatesOf(gate()),
        knownCheckIds: new Set(['check_plumb_pressure']),
        passedCheckIds: new Set(),
        proseMentions: [],
        narrativeDecisionIds: new Set(['D5']),
      }),
      [],
    );
  });

  it('readNarrativeDecisionIds 从真实 docs 读到 D1–D18（节标题里的区间字样不误收）', () => {
    const ids = readNarrativeDecisionIds(process.cwd());
    assert.equal(ids.size, 18, `实际：${[...ids].sort().join(',')}`);
    assert.ok(ids.has('D1') && ids.has('D18'));
  });
});

describe('collectProseMentions：散文引用提取', () => {  it('提取 D 编号与同段共现的验收项，3D / DEC 编号不误判', () => {
    const mentions = collectProseMentions(
      '本条不锁定档位：打压档位待 D5 拍板，不得擅自改写 check_plumb_pressure 的既有口径；3D 预览与 DEC-2026-10-06-R1 不受影响。',
      'config/acceptance.yaml:check_gate.knowledge',
    );
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].decisionId, 'D5');
    assert.deepEqual(mentions[0].namedChecks, ['check_plumb_pressure']);
    assert.equal(mentions[0].source, 'config/acceptance.yaml:check_gate.knowledge');
  });

  it('没有决策编号的文本不产生引用', () => {
    assert.deepEqual(collectProseMentions('普通验收描述，没有任何决策编号。', 'x'), []);
  });
});

describe('parseDecisionGates 与 openDecisionsBlocking', () => {
  it('缺少 decisions 列表 → 抛错（fail loud，不静默放行）', () => {
    assert.throws(() => parseDecisionGates('version: 1\n'), /缺少 decisions/);
  });

  it('openDecisionsBlocking 只返回开放中的验收门禁', () => {
    const gates = gatesOf(
      gate(),
      gate({ id: 'D9', topic: '龙骨', status: 'decided', blocks: ['check_carp_keel'],
        decided_value: 'v', decided_by: '业主', decided_at: '2026-10-31', decision_evidence: ['e'] }),
      gate({ id: 'D1', topic: '品牌', scope: 'tracked', tracking_note: 'n' }),
    );
    assert.deepEqual(openDecisionsBlocking(gates, 'check_plumb_pressure').map((d) => d.id), ['D5']);
    assert.deepEqual(openDecisionsBlocking(gates, 'check_carp_keel'), []);
  });
});

describe('真实仓状态集成冒烟', () => {
  it('verify:decision-gates 对当前仓库退出码为 0 且无 issue', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/verify/schedule/verify-decision-gates.ts', '--json'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    assert.equal(result.status, 0, `stderr: ${result.stderr ?? ''}`);
    const report = JSON.parse(result.stdout ?? '{}');
    assert.equal(report.counts.errors, 0);
    assert.equal(report.counts.warnings, 0);
    assert.ok(report.inputs.decisions >= 18, `登记表应至少含报告 D1–D18，实际 ${report.inputs.decisions}`);
    assert.ok(report.inputs.blocked_checks > 0, '应有验收项被开放门禁阻塞');
  });
});
