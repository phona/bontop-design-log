import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * 全量门禁编排器：依次跑完 15 个 verifier，**不短路**，汇总退出码。
 *
 * 为什么存在：原 `verify:all` 是 `&&` 链，任何一步非零就中止——一个「等外部输入」的
 * 待决项（如 `sock_child_ac` 卡空调厂家深化图）会让后面 7 个 verifier 根本不执行，
 * 门禁对其余问题失明。本编排器全跑完再汇总，退出码语义不变（0 ⇔ 全部通过），
 * 因此 docs/decisions 里大量「N 步全过」的历史证据仍然有效。
 *
 * 对 agent 的出口：`npm run verify:all -- --json` 一次拿到全部 verifier 的结构化信封。
 * 支持 `--json` 的 verifier 会带上解析后的 `report`；不支持的带上原始 `output` 文本，
 * 并在 `structured: false` 里显形——不假装所有 verifier 都已结构化。
 *
 * 自适应探测而非硬编码支持清单：先试 `--json`，解析成功即结构化，失败则把同一份输出
 * 当文本用（verifier 会忽略不认识的参数）。这样 W1b 逐个补 `--json` 时无需改这里，
 * 支持清单不会腐烂。
 */

const ROOT = path.resolve(import.meta.dirname, '../..');

interface VerifierSpec {
  /** 稳定名，agent 用它做 --only 过滤与结果索引。 */
  name: string;
  script: string;
}

/** 顺序与原 `verify:all` 链一致，便于对照历史输出。 */
const VERIFIERS: VerifierSpec[] = [
  { name: 'verify-topology', script: 'scripts/verify/layout/verify-topology.ts' },
  { name: 'verify-layout', script: 'scripts/verify/layout/verify-layout.ts' },
  { name: 'verify-furniture', script: 'scripts/verify/placement/verify-furniture-placement.ts' },
  { name: 'verify-rules', script: 'scripts/verify/rules/verify-rules.ts' },
  { name: 'verify-collision', script: 'scripts/verify/collision/verify-collision-coverage.ts' },
  { name: 'verify-spatial', script: 'scripts/verify/spatial/verify-spatial.ts' },
  { name: 'verify-penetration', script: 'scripts/verify/penetration/verify-penetration.ts' },
  { name: 'verify-consistency', script: 'scripts/verify/data/verify-data-consistency.ts' },
  { name: 'verify-mep', script: 'scripts/verify/mep/verify-mep-lint.ts' },
  { name: 'verify-electrical', script: 'scripts/verify/electrical/verify-electrical-lint.ts' },
  { name: 'verify-project-render-facts', script: 'scripts/verify/project/verify-project-render-facts.ts' },
  { name: 'verify-lighting-config', script: 'scripts/verify/project/verify-lighting-config.ts' },
  { name: 'verify-facts', script: 'scripts/verify/facts/verify-facts.ts' },
  { name: 'verify-mep-takeoff', script: 'scripts/verify/mep/verify-mep-takeoff.ts' },
  { name: 'verify-schedule', script: 'scripts/schedule/control.ts' },
];

interface VerifierCounts {
  errors?: number;
  warnings?: number;
  /** 计数从哪来：结构化报告 / 文本解析 / 未知（未知时不许拿 0 冒充）。 */
  source: 'structured' | 'text' | 'unknown';
}

interface VerifierResult {
  name: string;
  script: string;
  exit: number;
  /** 是否拿到了可解析的结构化报告。false 时只有 output 文本。 */
  structured: boolean;
  report?: unknown;
  output: string;
  stderr: string;
  counts: VerifierCounts;
}

interface AggregateReport {
  version: number;
  mode: 'all' | 'fail-fast' | 'only';
  totals: {
    verifiers: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
  };
  verifiers: VerifierResult[];
}

function parseArgs(argv: string[]): { json: boolean; failFast: boolean; only: string[] } {
  const args = new Set(argv);
  const only: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        console.error('verify:all --only requires a verifier name');
        process.exitCode = 2;
      } else {
        only.push(value);
      }
    }
  }
  return { json: args.has('--json'), failFast: args.has('--fail-fast'), only };
}

/** 从结构化报告里取 errors/warnings；取不到返回空（不拿 0 冒充）。 */
function countFromReport(report: unknown): { errors?: number; warnings?: number } {
  if (!report || typeof report !== 'object') return {};
  const candidate = report as { report?: { counts?: { errors?: number; warnings?: number } }; counts?: { errors?: number; warnings?: number } };
  const counts = candidate.report?.counts ?? candidate.counts;
  if (!counts) return {};
  return { ...(typeof counts.errors === 'number' ? { errors: counts.errors } : {}), ...(typeof counts.warnings === 'number' ? { warnings: counts.warnings } : {}) };
}

/**
 * 文本型 verifier 的保守计数：只认 `N error(s)` / `N warning(s)` 这类项目自己的固定措辞，
 * 认不出就返回 unknown——**不许拿 0 冒充「没有错误」**，否则 agent 会把失败的
 * verifier 读成干净。
 */
function countFromText(output: string): VerifierCounts {
  const errors = output.match(/(\d+)\s+error\(s\)/);
  const warnings = output.match(/(\d+)\s+warning\(s\)/);
  const fails = output.match(/(\d+)\s+fail\(s\)/);
  if (!errors && !warnings && !fails) return { source: 'unknown' };
  return {
    ...(errors ? { errors: Number(errors[1]) } : {}),
    ...(warnings ? { warnings: Number(warnings[1]) } : {}),
    ...(!errors && fails ? { errors: Number(fails[1]) } : {}),
    source: 'text',
  };
}

function runOne(spec: VerifierSpec): VerifierResult {
  const result = spawnSync('npx', ['tsx', spec.script, '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let structured = false;
  let report: unknown;
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object') {
      structured = true;
      report = parsed;
    }
  } catch {
    // 不支持 --json：verifier 忽略该参数，stdout 即其常规文本输出。
  }
  const structuredCounts = countFromReport(report);
  return {
    name: spec.name,
    script: spec.script,
    exit: result.status ?? 1,
    structured,
    ...(structured ? { report } : {}),
    output: stdout,
    stderr,
    counts: structured
      ? { ...structuredCounts, source: 'structured' }
      : countFromText(stdout),
  };
}

function main(): void {
  const { json, failFast, only } = parseArgs(process.argv.slice(2));
  const selected = only.length > 0
    ? VERIFIERS.filter((spec) => only.includes(spec.name))
    : VERIFIERS;
  if (selected.length === 0) {
    console.error(`verify:all --only matched nothing. known: ${VERIFIERS.map((spec) => spec.name).join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const results: VerifierResult[] = [];
  for (const spec of selected) {
    const result = runOne(spec);
    results.push(result);
    if (!json) {
      const mark = result.exit === 0 ? '✔' : '✗';
      const suffix = result.counts.source !== 'unknown' && (result.counts.errors !== undefined || result.counts.warnings !== undefined)
        ? ` (${result.counts.errors ?? '?'} error(s), ${result.counts.warnings ?? '?'} warning(s))`
        : '';
      console.log(`${mark} ${spec.name}${suffix}`);
      if (result.exit !== 0 && result.output.trim()) {
        for (const line of result.output.trim().split('\n')) console.log(`    ${line}`);
      }
      if (result.exit !== 0 && result.stderr.trim()) {
        for (const line of result.stderr.trim().split('\n')) console.log(`    ! ${line}`);
      }
    }
    if (result.exit !== 0 && failFast) break;
  }

  const totals = {
    verifiers: results.length,
    passed: results.filter((item) => item.exit === 0).length,
    failed: results.filter((item) => item.exit !== 0).length,
    errors: results.reduce((sum, item) => sum + (item.counts.errors ?? 0), 0),
    warnings: results.reduce((sum, item) => sum + (item.counts.warnings ?? 0), 0),
    /** 有几个 verifier 的计数没能拿到（unknown）——>0 时上面的 errors/warnings 是下限不是全量。 */
    unknownCounts: results.filter((item) => item.counts.source === 'unknown').length,
  };
  const aggregate: AggregateReport = {
    version: 1,
    mode: only.length > 0 ? 'only' : failFast ? 'fail-fast' : 'all',
    totals,
    verifiers: results,
  };

  if (json) console.log(JSON.stringify(aggregate, null, 2));
  else {
    console.log(`\nverify:all ${totals.passed}/${totals.verifiers} passed, ${totals.failed} failed`);
    if (totals.unknownCounts > 0) console.log(`note: ${totals.unknownCounts} verifier(s) have no parseable counts — errors/warnings above are a lower bound`);
    if (totals.failed > 0) console.log(`failing: ${results.filter((item) => item.exit !== 0).map((item) => item.name).join(', ')}`);
  }
  if (totals.failed > 0) process.exitCode = 1;
}

main();
