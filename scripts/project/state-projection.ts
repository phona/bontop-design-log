import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { classifyTarget, parsePendingLedger } from '../../shared/pending-ledger.js';
import { collectElements, collectKnownTypes } from '../../shared/element-sources.js';
import { isElementBearingFile } from '../../shared/envelope-sources.js';
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
 * 只派生不存储：权威仍在 config / pending 台账 / DEC / verifier，本命令产出的是视图。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = 'config/*.yaml + docs/pending-site-data.md + docs/decisions/ + verifier issues';

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
  // （2026-11-07 S6：原第二次读 ledgerConfig.element_bearing_files 已删——「哪些文件承载
  // 场景构件」的唯一真相在 shared/envelope-sources.ts 注册表，见该文件头注。）
  const modelConfig = readYaml<StateModelConfig>('config/state-model.yaml');
  const model: StateModel = {
    priority: modelConfig.priority ?? DEFAULT_STATE_MODEL.priority,
    statusVocabulary: modelConfig.status_vocabulary ?? DEFAULT_STATE_MODEL.statusVocabulary,
  };
  const issueSources = modelConfig.issue_sources ?? ['verify-spatial', 'verify-penetration', 'verify-electrical'];

  const ledger = parsePendingLedger(readFileSync(path.join(ROOT, 'docs/pending-site-data.md'), 'utf8'));
  const elements = collectElements();
  const knownElementIds = new Set(elements.map((element) => element.id));
  const knownTypes = collectKnownTypes();
  const { issues, ran, failed } = collectIssues(issueSources);
  const schedule = loadSchedule();

  const result = deriveElementStates({ elements, ledger, issues, model, ...(schedule ? { schedule } : {}) });

  // 台账腐烂核对：指向承载构件的文件、但配置里已不存在的引用。
  // 承载文件的判定读来源注册表的 isElementBearingFile（electrical/plumbing/ceiling 三源，
  // 与改造前 state-model.yaml 的三行同集合），不再读 state-model.yaml 的副本（S6 已删）。
  const dangling: Array<{ ref: string; file: string; id: string }> = [];
  for (const entry of ledger.entries) {
    for (const target of entry.targets) {
      if (!isElementBearingFile(target.file) || !target.id) continue;
      if (classifyTarget(target, knownElementIds, knownTypes) === 'unresolved') {
        dangling.push({ ref: entry.ref, file: target.file, id: target.id });
      }
    }
  }

  const payload = {
    version: 1,
    source: SOURCE,
    schedule: schedule ?? null,
    inputs: {
      elements: elements.length,
      ledgerEntries: ledger.entries.length,
      issues: issues.length,
      issueSourcesRan: ran,
      ...(failed.length > 0 ? { issueSourcesFailed: failed } : {}),
    },
    summary: result.summary,
    ledger: {
      dangling,
      ...(dangling.length > 0 ? { danglingNote: '台账指向的构件在配置中已不存在——台账腐烂或构件已删' } : {}),
    },
    states: result.states.sort((a, b) => a.status.localeCompare(b.status) || a.id.localeCompare(b.id)),
    warnings: [...result.warnings, ...dangling.map((item) => ({ code: 'state.ledger_dangling', entity: `${item.file} ${item.id}`, message: `pending-site-data #${item.ref} references a构件 that no longer exists in config` }))],
  };

  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`Element state projection: ${result.summary.total} element(s)`);
    console.log(`  by status: ${Object.entries(result.summary.byStatus).map(([key, value]) => `${key}=${value}`).join('  ')}`);
    console.log(`  by kind:   ${Object.entries(result.summary.byKind).map(([key, value]) => `${key}=${value}`).join('  ')}`);
    if (schedule) console.log(`  schedule:  gate=${schedule.gate} status=${schedule.status}`);
    if (dangling.length > 0) console.log(`  ⚠ ledger dangling refs: ${dangling.map((item) => `#${item.ref} ${item.id}`).join(', ')}`);
    if (payload.warnings.length > 0) console.log(`  ⚠ warnings: ${payload.warnings.length} (see --json)`);
    console.log('\n未裁定 / 有冲突的构件（前 20 条）：');
    for (const state of payload.states.filter((item) => item.status === 'pending' || item.status === 'conflicted').slice(0, 20)) {
      const question = state.openQuestion
        ? `卡在: ${state.openQuestion.blockedBy}`
        : state.conflicts.length > 0
          ? `冲突: ${state.conflicts.join(', ')}`
          : `（config 声明 ${state.statusSource}，无台账条目——未登记「卡在谁」）`;
      console.log(`  [${state.status}] ${state.id} — ${question}`);
    }
  }
  if (payload.warnings.some((warning) => warning.code !== 'state.ledger_dangling')) process.exitCode = 1;
}

main();
