#!/usr/bin/env node
/**
 * CI 基线对照检查器（本地与 GitHub Actions 共用同一入口、同一解析口径）。
 *
 * 背景：本仓有存量红（master 上既有的失败），「全绿才过」会让 CI 永远红、没人看。
 * 本脚本的判红条件只有一个：**出现基线之外的新失败**。基线内失败照常完整打印在
 * 日志里；基线条目若已不再失败，只打印「可缩减」提示、不判红。基线文件的维护
 * 纪律见 AGENTS.md「CI 基线纪律」。
 *
 * 用法：
 *   node ci/check.mjs <suite>                  跑套件并与 ci/baseline/ 对照
 *   node ci/check.mjs <suite> --input <file>   解析已捕获的输出做对照（调试/自验证）
 *   node ci/check.mjs <suite> --write-baseline 跑套件并把实际失败集写回基线文件
 *
 * suite ∈ typecheck | test-server | test-app | verify-all
 *
 * 对照语义：
 *   - test-server / test-app / verify-all：集合对照（失败条目名）。
 *   - typecheck：计数对照（归一化键的多重集）——同一文件同一错误码同一报错对象
 *     出现 N 次是 N 条基线，少一条是进步（提示）、多一条是新失败（判红）。
 * 套件进程本身崩溃（解析不到任何结果且退出码非 0）按基础设施失败判红，不与基线混淆。
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CI_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(CI_DIR);
const BASELINE_DIR = join(CI_DIR, 'baseline');

/** 在指定 cwd 下流式跑命令：输出实时透传到本进程 stdout，同时捕获全文供解析。 */
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, shell: false });
    let buf = '';
    child.stdout.on('data', (d) => { process.stdout.write(d); buf += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); buf += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, output: buf }));
  });
}

/* ---------------------------------- 解析 ---------------------------------- */

/**
 * 解析 node:test TAP 输出，返回失败条目键集合。
 * 键 = `<文件 basename> :: <suite 路径 > 叶子名>`：文件名取失败诊断 YAML 的 location，
 * 路径由 `# Subtest:` 公告与缩进层级还原（含 suite 汇总行——汇总行本身也是失败条目，
 * 这样「汇总行在、叶子名也在」的 TAP 口径自洽）。诊断 YAML 块整体跳过，其中的
 * 报错文本可能含 "not ok" 字样，不得误解析。
 */
function parseTap(output) {
  const failures = [];
  const stack = []; // stack[depth] = 该层级最近公告的 Subtest 名
  let yamlIndent = -1; // >=0 表示正处于诊断 YAML 块内（其 --- 行的缩进）
  let pending = null; // 最近一条 not ok 的记录，等它的 location
  const lines = output.split('\n');
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    if (yamlIndent >= 0) {
      if (indent === yamlIndent && trimmed === '...') { yamlIndent = -1; continue; }
      if (pending && pending.file === null) {
        const m = line.match(/^\s*location: '([^']+)'/);
        if (m) pending.file = basename(m[1].replace(/:\d+:\d+$/, ''));
      }
      continue;
    }
    if (/^\s*---\s*$/.test(line)) { yamlIndent = indent; continue; }
    const sub = line.match(/^(\s*)# Subtest: (.*)$/);
    if (sub) {
      const depth = Math.floor(sub[1].length / 4);
      stack[depth] = sub[2].trim();
      stack.length = depth + 1;
      continue;
    }
    const res = line.match(/^(\s*)(not ok|ok) (\d+) - (.*)$/);
    if (res) {
      const depth = Math.floor(res[1].length / 4);
      const name = res[4].replace(/\s+#\s*(SKIP|TODO)\b.*$/i, '').trim();
      if (res[2] === 'not ok') {
        const parents = stack.slice(0, depth).filter((s) => s !== undefined);
        pending = { file: null, key: [...parents, name].join(' > ') };
        failures.push(pending);
      } else {
        pending = null;
      }
      continue;
    }
  }
  return failures.map((f) => `${f.file ?? '(unknown-file)'} :: ${f.key}`);
}

/**
 * 解析 tsc 输出为归一化键的多重集（数组，含重复）。
 * 键 = `<文件> :: <TS 错误码> :: <消息主体>`——剥离 (行,列)，避免无关行号漂移误报。
 */
function parseTypecheck(output) {
  const keys = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$/);
    if (m) keys.push(`${m[1]} :: ${m[2]} :: ${m[3].trim()}`);
  }
  return keys;
}

/** 解析 vitest 默认 reporter 输出的 FAIL 行（先剥 ANSI）。 */
function parseVitest(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const failures = [];
  for (const line of clean.split('\n')) {
    const m = line.match(/^ FAIL\s{2}(.+?)\s*$/);
    if (m) failures.push(m[1].replace(/\s+/g, ' '));
  }
  return failures;
}

/** 解析 verify-all.ts 的汇总：`failing: a, b` 行（全过时无此行）。 */
function parseVerifyAll(output) {
  for (const line of output.split('\n')) {
    const m = line.match(/^failing: (.+)$/);
    if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/* ---------------------------------- 套件 ---------------------------------- */

const SUITES = {
  'test-server': {
    baselineFile: 'test-server-failures.txt',
    multiset: false,
    parse: parseTap,
    run: async () => run('npx', ['tsx', '--test', '--test-reporter=tap', 'tests/server/**/*.test.ts'], ROOT),
    // TAP 汇总行 `# fail N` 存在即说明跑完；解析到 0 失败但退出码非 0 也可能是全过之外的崩溃
    looksComplete: (out) => /^# (tests|pass|fail) /m.test(out),
  },
  'typecheck': {
    baselineFile: 'typecheck-errors.txt',
    multiset: true,
    parse: parseTypecheck,
    run: async () => {
      const rootRun = await run('npx', ['tsc', '--noEmit'], ROOT);
      const appRun = await run('npx', ['tsc', '--noEmit'], join(ROOT, 'app'));
      return { code: rootRun.code !== 0 || appRun.code !== 0 ? 2 : 0, output: rootRun.output + appRun.output };
    },
    looksComplete: () => true, // tsc 无汇总行；退出码非 0 且解析为 0 条错误在 compare 里单独判基础设施失败
  },
  'test-app': {
    baselineFile: 'test-app-failures.txt',
    multiset: false,
    parse: parseVitest,
    run: async () => run('npx', ['vitest', 'run'], join(ROOT, 'app')),
    looksComplete: (out) => /Test Files/.test(out),
  },
  'verify-all': {
    baselineFile: 'verify-all-failures.txt',
    multiset: false,
    parse: parseVerifyAll,
    run: async () => run('npx', ['tsx', 'scripts/verify/verify-all.ts'], ROOT),
    looksComplete: (out) => /^verify:all \d+\/\d+ passed, \d+ failed$/m.test(out),
  },
};

/* ---------------------------------- 对照 ---------------------------------- */

function readBaseline(file) {
  const path = join(BASELINE_DIR, file);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

function writeBaseline(file, entries, header) {
  const sorted = [...entries].sort();
  writeFileSync(join(BASELINE_DIR, file), `${header}\n${sorted.join('\n')}\n`, 'utf8');
}

/** 返回 { newFailures: string[], fixedEntries: string[] }。multiset 时按计数比较。 */
function compare(actual, baseline, multiset) {
  if (!multiset) {
    const a = new Set(actual); const b = new Set(baseline);
    return {
      newFailures: [...a].filter((x) => !b.has(x)).sort(),
      fixedEntries: [...b].filter((x) => !a.has(x)).sort(),
    };
  }
  const count = (arr) => arr.reduce((map, x) => map.set(x, (map.get(x) ?? 0) + 1), new Map());
  const ca = count(actual); const cb = count(baseline);
  const newFailures = []; const fixedEntries = [];
  for (const [k, n] of ca) { const over = n - (cb.get(k) ?? 0); for (let i = 0; i < over; i++) newFailures.push(k); }
  for (const [k, n] of cb) { const under = n - (ca.get(k) ?? 0); for (let i = 0; i < under; i++) fixedEntries.push(k); }
  return { newFailures: newFailures.sort(), fixedEntries: fixedEntries.sort() };
}

/* ---------------------------------- 主流程 ---------------------------------- */

const BASELINE_HEADERS = {
  'test-server-failures.txt': [
    '# test:server 基线失败集（node:test TAP 口径：文件 :: suite 路径 > 叶子名，含 suite 汇总行）。',
    '# 维护纪律见 AGENTS.md「CI 基线纪律」：修掉存量失败须在同一 PR 删行；禁止塞入新失败放行。',
  ].join('\n'),
  'typecheck-errors.txt': [
    '# typecheck 基线错误集（归一化键：文件 :: TS 错误码 :: 消息主体，已剥离行列号）。',
    '# 计数对照：同一键出现几行就是几条，增减按条计。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
  'test-app-failures.txt': [
    '# test:app 基线失败集（vitest FAIL 行：文件 > suite > 用例；文件级失败保留 [ 文件 ] 形式）。',
    '# 维护纪律见 AGENTS.md「CI 基线纪律」：修掉存量失败须在同一 PR 删行；禁止塞入新失败放行。',
  ].join('\n'),
  'verify-all-failures.txt': [
    '# verify:all 基线失败集（verify 名）。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
};

async function main() {
  const [suiteName, ...rest] = process.argv.slice(2);
  const suite = SUITES[suiteName];
  if (!suite) {
    console.error(`用法: node ci/check.mjs <${Object.keys(SUITES).join('|')}> [--input <file>] [--write-baseline]`);
    process.exit(2);
  }
  const inputIdx = rest.indexOf('--input');
  const writeBaselineMode = rest.includes('--write-baseline');

  let output; let exitCode = 0;
  if (inputIdx >= 0) {
    output = readFileSync(rest[inputIdx + 1], 'utf8');
  } else {
    const result = await suite.run();
    output = result.output; exitCode = result.code;
  }

  const actual = suite.parse(output);

  // 套件崩溃守卫：解析不到完整结果、或退出码非 0 且零失败条目 —— 不是「全过」，是没跑成。
  if (!suite.looksComplete(output)) {
    console.error(`\n[ci] ${suiteName}: 输出不完整（套件可能崩溃），按基础设施失败判红。`);
    process.exit(1);
  }
  if (exitCode !== 0 && actual.length === 0 && suiteName !== 'verify-all') {
    console.error(`\n[ci] ${suiteName}: 套件退出码 ${exitCode} 但未解析到任何失败条目，按基础设施失败判红。`);
    process.exit(1);
  }

  if (writeBaselineMode) {
    writeBaseline(suite.baselineFile, actual, BASELINE_HEADERS[suite.baselineFile]);
    console.log(`\n[ci] ${suiteName}: 已写入基线 ${suite.baselineFile}（${actual.length} 条）。`);
    return;
  }

  const baseline = readBaseline(suite.baselineFile);
  const { newFailures, fixedEntries } = compare(actual, baseline, suite.multiset);

  console.log(`\n[ci] ${suiteName}: 实际失败 ${actual.length} 条，基线 ${baseline.length} 条。`);
  if (fixedEntries.length > 0) {
    console.log(`[ci] 以下 ${fixedEntries.length} 条基线失败已不再出现（基线可缩减，请在修红的 PR 里删行）：`);
    for (const f of fixedEntries) console.log(`  - ${f}`);
  }
  if (newFailures.length > 0) {
    console.error(`[ci] 发现 ${newFailures.length} 条基线外新失败，判红：`);
    for (const f of newFailures) console.error(`  + ${f}`);
    process.exit(1);
  }
  console.log(`[ci] ${suiteName}: 无基线外新失败，对照通过。`);
}

main().catch((err) => { console.error(err); process.exit(1); });
