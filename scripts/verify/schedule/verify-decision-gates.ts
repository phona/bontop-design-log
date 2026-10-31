// 决策门禁校验器（npm run verify:decision-gates）。
//
// 门禁语义（与 computeGateStatus 同向：宁可多 pending，不可错放款）：
//   登记表里 scope=acceptance 且 status=open 的决策，其 blocks 中的验收项
//   不得出现 passed 审计记录。没有 passed 就没有「全部检查通过」，
//   computeGateStatus 自然判 pending，付款门槛不释放。
//
// 反向防线：acceptance.yaml 与 control.yaml 的散文里「待 Dx 拍板」必须能在
// 登记表找到对应决策，且散文点名的 check 必须登记在该决策的 blocks 里——
// 门禁不许只活在注释里。
//
// 本校验器只读，不写任何文件；修复一律改登记表或审计记录本身。

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {
  DECISION_GATES_PATH,
  collectProseMentions,
  loadDecisionGates,
  readNarrativeDecisionIds,
  validateDecisionGates,
  type DecisionGates,
  type GateIssue,
  type ProseMention,
} from '../../schedule/decision-gates.js';

type AnyRecord = Record<string, any>;

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ACCEPTANCE_PATH = 'config/acceptance.yaml';
const CONTROL_PATHS = [
  'schedule/phase-1/control.yaml',
  'schedule/phase-2/control.yaml',
  'schedule/phase-3/control.yaml',
];

/** 散文扫描字段：这些自由文本里出现「待 Dx 拍板」就要能被登记表收编。 */
const PROSE_FIELDS = ['item', 'method', 'standard', 'pass_condition', 'knowledge'];

function readYaml(relPath: string): AnyRecord {
  const absolute = path.join(ROOT, relPath);
  if (!fs.existsSync(absolute)) return {};
  return (yaml.load(fs.readFileSync(absolute, 'utf8')) ?? {}) as AnyRecord;
}

function main(): void {
  const gates: DecisionGates = loadDecisionGates(ROOT);
  const acceptance = readYaml(ACCEPTANCE_PATH);
  const controls = CONTROL_PATHS.map((relPath) => ({ relPath, doc: readYaml(relPath) }));

  const knownCheckIds = new Set<string>();
  for (const phase of acceptance.phases ?? []) {
    for (const item of phase.items ?? []) {
      if (typeof item?.id === 'string') knownCheckIds.add(item.id);
    }
  }
  const passedCheckIds = new Set<string>();
  const proseMentions: ProseMention[] = [];

  for (const item of (acceptance.phases ?? []).flatMap((phase: AnyRecord) => phase.items ?? [])) {
    for (const field of PROSE_FIELDS) {
      const text = item?.[field];
      if (typeof text !== 'string') continue;
      proseMentions.push(...collectProseMentions(text, `${ACCEPTANCE_PATH}:${item.id}.${field}`));
    }
  }

  for (const { relPath, doc } of controls) {
    for (const pkg of doc.work_packages ?? []) {
      for (const check of pkg.checks ?? []) {
        if (typeof check?.id === 'string') knownCheckIds.add(check.id);
        for (const field of PROSE_FIELDS) {
          const text = check?.[field];
          if (typeof text !== 'string') continue;
          proseMentions.push(...collectProseMentions(text, `${relPath}:${pkg.id}/${check.id}.${field}`));
        }
      }
    }
    for (const record of doc.audit_log?.records ?? []) {
      if (record?.status === 'passed' && typeof record.check_id === 'string') {
        passedCheckIds.add(record.check_id);
      }
    }
  }

  const narrativeDecisionIds = readNarrativeDecisionIds(ROOT);
  const issues: GateIssue[] = validateDecisionGates({
    gates,
    knownCheckIds,
    passedCheckIds,
    proseMentions,
    narrativeDecisionIds,
  });
  const sorted = issues.sort((left, right) =>
    left.code.localeCompare(right.code)
    || (left.decision ?? '').localeCompare(right.decision ?? '')
    || (left.check ?? '').localeCompare(right.check ?? ''));
  const errors = sorted.filter((issue) => issue.severity === 'error');
  const warnings = sorted.filter((issue) => issue.severity === 'warning');
  const openGates = gates.decisions.filter((decision) => decision.scope === 'acceptance' && decision.status === 'open');
  const blockedChecks = [...new Set(openGates.flatMap((decision) => decision.blocks ?? []))];

  const report = {
    version: 1,
    registry: DECISION_GATES_PATH,
    counts: { errors: errors.length, warnings: warnings.length },
    inputs: {
      decisions: gates.decisions.length,
      narrative_decisions: narrativeDecisionIds.size,
      open_acceptance_gates: openGates.length,
      blocked_checks: blockedChecks.length,
      passed_audit_checks: passedCheckIds.size,
      prose_mentions: proseMentions.length,
    },
    issues: sorted,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`决策门禁（${DECISION_GATES_PATH}）：`);
    console.log(`  登记 ${gates.decisions.length} 个决策（叙事登记表 docs/pending-site-data.md 同步 ${narrativeDecisionIds.size} 个），其中开放中的验收门禁 ${openGates.length} 个、阻塞 ${blockedChecks.length} 项验收；已有 passed 记录的验收 ${passedCheckIds.size} 项；散文决策引用 ${proseMentions.length} 处`);
    for (const issue of sorted) {
      const where = [issue.decision, issue.check].filter(Boolean).join(' / ');
      console.log(`  ${issue.severity === 'error' ? 'x' : '!'} [${issue.code}] ${where || '-'} ${issue.message}`);
    }
    console.log(`决策门禁：${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  // 用 exitCode 自然退出，不许 process.exit()：stdout 是管道时写入异步，
  // 硬退出会截断尾部输出（verify-facts 2026-10-28 实测过 35KB 被截到 28KB）。
  process.exitCode = errors.length ? 1 : 0;
}

main();
