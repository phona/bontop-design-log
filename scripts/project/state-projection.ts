import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { collectElements } from '../../shared/element-sources.js';
import { checkBlockers, formatBlockerIssue, type BlockerIssue, type BlockerSubject } from '../../shared/element-blockers.js';
import {
  deriveElementStates,
  DEFAULT_STATE_MODEL,
  type ElementInput,
  type ElementKind,
  type IssueLike,
  type StateModel,
} from '../../shared/element-state.js';

/**
 * 构件级工程状态投影：`npm run state:project [-- --json]`。
 *
 * 回答一个问题：**每个构件确认到什么程度、卡在谁、和谁冲突。**
 * 人用它核对，agent 用它在下结论前先问「这确认了吗」——不需要 MCP，一条命令即可。
 *
 * 只派生不存储：权威仍在 config 字段与 verifier，本命令产出的是视图。
 *
 * 2026-11-08（issue #98 第六阶段 S2-A）：**不再读任何待决台账**。原
 * `原量房台账（已于 S2-B 退场）` 的两项职责都已退役——① 作为状态来源（`ledger` 优先级规则）
 * 与 ② 「卡在谁」的展示源（openQuestion）；现在两者都由构件自己的 `status` / `blocker`
 * 字段承载（业主裁定①③⑤）。台账腐烂核对（ledger dangling refs）随之删除：blocker 住在
 * 对象上，「台账指向的构件已不存在」这类腐烂在结构上不再可能发生。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = 'config/*.yaml + verifier issues';

// config/state-model.yaml 的词汇表键名是蛇形 status_vocabulary（coverage 矩阵
// config/facts.yaml 按此名登记 reader）；此前这里读驼峰 statusVocabulary，蛇形键
// 静默走 DEFAULT_STATE_MODEL——2026-11-08 issue #98 S1-B 改读蛇形，词汇表真正生效。
// 默认值与 YAML 内容逐键相同，故无行为差。
interface StateModelConfig {
  priority?: StateModel['priority'];
  status_vocabulary?: StateModel['statusVocabulary'];
  issue_sources?: string[];
}

function readYaml<T>(file: string): T {
  return parseYaml(readFileSync(path.join(ROOT, file), 'utf8')) as T;
}

const VERIFIER_SCRIPTS: Record<string, string> = {
  'verify-spatial': 'scripts/verify/spatial/verify-spatial.ts',
  'verify-penetration': 'scripts/verify/penetration/verify-penetration.ts',
  'verify-electrical': 'scripts/verify/electrical/verify-electrical-lint.ts',
};

/** 跑指定 verifier 并把它们的 issue 归一成 IssueLike（entity 与 id 两种写法都接）。 */
function collectIssues(sources: string[]): { issues: IssueLike[]; ran: string[]; failed: string[] } {
  const issues: IssueLike[] = [];
  const ran: string[] = [];
  const failed: string[] = [];
  for (const source of sources) {
    const script = VERIFIER_SCRIPTS[source];
    if (!script) {
      failed.push(`${source} (unknown issue source)`);
      continue;
    }
    const result = spawnSync('npx', ['tsx', script, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    ran.push(source);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      failed.push(`${source} (unparseable output)`);
      continue;
    }
    const candidate = parsed as { report?: { issues?: IssueLike[] }; issues?: IssueLike[]; errors?: IssueLike[]; warnings?: IssueLike[] };
    const buckets = [candidate.report?.issues, candidate.issues, candidate.errors, candidate.warnings];
    for (const bucket of buckets) {
      if (Array.isArray(bucket)) issues.push(...bucket);
    }
  }
  return { issues, ran, failed };
}

function loadSchedule(): { gate: string; status: string } | undefined {
  try {
    const control = readYaml<{ current_gate?: string; status?: string }>('schedule/phase-1/control.yaml');
    if (!control.current_gate && !control.status) return undefined;
    return { gate: control.current_gate ?? 'unknown', status: control.status ?? 'unknown' };
  } catch {
    return undefined;
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const json = args.has('--json');

  // 同一份配置读一次：priority / status_vocabulary 喂派生模型，issue_sources 喂 issue 采集。
  const modelConfig = readYaml<StateModelConfig>('config/state-model.yaml');
  const model: StateModel = {
    priority: modelConfig.priority ?? DEFAULT_STATE_MODEL.priority,
    statusVocabulary: modelConfig.status_vocabulary ?? DEFAULT_STATE_MODEL.statusVocabulary,
  };
  const issueSources = modelConfig.issue_sources ?? ['verify-spatial', 'verify-penetration', 'verify-electrical'];

  const elements = collectElements();
  const { issues, ran, failed } = collectIssues(issueSources);
  const schedule = loadSchedule();

  const result = deriveElementStates({ elements, issues, model, ...(schedule ? { schedule } : {}) });

  // blocker 完整性门禁（issue #98 S2-A）：pending / undeclared 的构件必须自带
  // kind/owner/trigger/reverses_if/rationale。缺失即 error——「未决项上对象」不许有漏网。
  // 管辖范围按**派生后的状态**判（不是按声明的 status 字段）：没有 status 声明而被兜底成
  // undeclared 的构件同样要说清卡在什么——那正是「申报缺口」要显形的东西。
  const statusById = new Map(result.states.map((state) => [state.id, state.status]));
  const blockerResult = checkBlockers(elements as BlockerSubject[], (subject) => statusById.get(subject.id));
  const blockerIssues: BlockerIssue[] = blockerResult.issues;

  const payload = {
    version: 1,
    source: SOURCE,
    schedule: schedule ?? null,
    inputs: {
      elements: elements.length,
      issues: issues.length,
      issueSourcesRan: ran,
      ...(failed.length > 0 ? { issueSourcesFailed: failed } : {}),
    },
    summary: result.summary,
    blockers: {
      checked: blockerResult.checked,
      issues: blockerIssues.map((issue) => ({ id: issue.id, kind: issue.kind, code: issue.code, message: issue.message })),
    },
    states: result.states.sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id)),
    warnings: [...result.warnings, ...blockerIssues.map((issue) => ({ code: `state.${issue.code}`, entity: issue.id, message: issue.message }))],
  };

  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Element state projection: ${result.summary.total} element(s)`);
    console.log(`  by status: ${Object.entries(result.summary.byStatus).map(([key, value]) => `${key}=${value}`).join('  ')}`);
    console.log(`  by kind:   ${Object.entries(result.summary.byKind).map(([key, value]) => `${key}=${value}`).join('  ')}`);
    if (schedule) console.log(`  schedule:  gate=${schedule.gate} status=${schedule.status}`);
    console.log(`  blockers:  ${blockerResult.checked} 个 pending/undeclared 构件受门禁管辖，${blockerIssues.length} 条不合规`);
    for (const issue of blockerIssues.slice(0, 20)) console.log(`    ✗ ${formatBlockerIssue(issue)}`);
    if (payload.warnings.length > 0) console.log(`  ⚠ warnings: ${payload.warnings.length} (see --json)`);
    console.log('\n未裁定 / 有冲突的构件（前 20 条）：');
    for (const state of payload.states.filter((item) => item.status === 'pending' || item.status === 'conflicted').slice(0, 20)) {
      const question = state.blocker
        ? `卡在: ${state.blocker.owner.join('/')}｜${state.blocker.kind}｜解锁=${state.blocker.trigger}`
        : state.conflicts.length > 0
          ? `冲突: ${state.conflicts.join(', ')}`
          : `（config 声明 ${state.statusSource}，无 blocker——未登记「卡在谁」）`;
      console.log(`  [${state.status}] ${state.id} — ${question}`);
    }
  }
  // blocker 门禁是 error 级：pending/undeclared 构件缺未决声明即退出码非零。
  if (blockerIssues.length > 0) process.exitCode = 1;
  else if (payload.warnings.some((warning) => warning.code !== 'state.ledger_dangling')) process.exitCode = 1;
}

main();
