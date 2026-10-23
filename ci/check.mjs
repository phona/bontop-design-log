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
 *   node ci/check.mjs <suite> --input <file>   解析已捕获的输出做对照（调试/自验证；
 *                                              typecheck 双树须分别捕获，不支持 --input）
 *   node ci/check.mjs <suite> --write-baseline 跑套件并把实际失败集写回基线文件
 *   node ci/check.mjs baseline-delta [--base <sha>]
 *                                              基线增减门禁：与 base 提交的 ci/baseline/
 *                                              对照，条目只许删不许增（增行判红点名）。
 *                                              base 取 --base 或环境变量 CI_BASE_SHA；
 *                                              base 上无 ci/baseline（引入 CI 的首个 PR）
 *                                              时按「基线引导」跳过并明示。
 *
 * suite ∈ typecheck | test-server | test-app | verify-all
 *
 * 对照语义：
 *   - test-server / test-app：多重集对照，键含仓库相对路径（见各解析函数）——
 *     同一键实际次数 > 基线次数即新失败，按键报告超出数。
 *   - verify-all：集合对照（失败的 verify 名，天然唯一）。
 *   - typecheck：双树（root / app）分开跑、分开判定，诊断键带子树前缀后合并做
 *     多重集对照——同一文件同一错误码同一报错对象出现 N 次是 N 条基线，少一条
 *     是进步（提示）、多一条是新失败（判红）。任一子树非零退出且解析出 0 条诊断
 *     （TS 配置错误、tsc 崩溃等）按基础设施失败独立判红，不许被另一子树的基线掩盖。
 * 套件进程本身崩溃（解析不到任何结果且退出码非 0）按基础设施失败判红，不与基线混淆。
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
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

/** 把 TAP location / 路径形态的名字归一为仓库相对路径（正斜杠），避免跨机绝对路径进键。 */
function relPathOf(raw) {
  let p = raw.replace(/:\d+:\d+$/, '').replace(/^file:\/\//, '');
  if (isAbsolute(p)) {
    const rel = relative(ROOT, p);
    if (!rel.startsWith('..')) p = rel;
  }
  return p.split(sep).join('/');
}

/**
 * 解析 node:test TAP 输出，返回失败条目键数组（含重复，多重集对照）。
 * 键 = `<仓库相对路径> :: <suite 路径 > 叶子名>`：文件取失败诊断 YAML 的 location
 * 并归一为相对路径——只取 basename 时不同目录的同名测试文件、同名用例会碰撞，
 * 一处失败可能被另一处的基线条目吞掉。路径由 `# Subtest:` 公告与缩进层级还原
 * （含 suite 汇总行——汇总行本身也是失败条目，这样「汇总行在、叶子名也在」的
 * TAP 口径自洽）；名字段本身若是绝对路径（如文件级加载失败）同样归一为相对路径。
 * 诊断 YAML 块整体跳过，其中的报错文本可能含 "not ok" 字样，不得误解析。
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
        if (m) pending.file = relPathOf(m[1]);
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
        // 名字段本身可能是绝对路径（文件级加载失败时 not ok 的名字就是文件路径）
        const norm = (s) => (s.startsWith('/') || s.startsWith('file://') ? relPathOf(s) : s);
        pending = { file: null, key: [...parents.map(norm), norm(name)].join(' > ') };
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

/**
 * 解析 vitest 默认 reporter 输出的 FAIL 行（先剥 ANSI）。
 * vitest 以 app/ 为根打印相对路径（src/...）；键统一加 app/ 前缀成仓库相对路径，
 * 与 test-server 键同为「仓库相对路径 + 用例名」，对照走多重集（见 SUITES）。
 * 文件级失败的 `[ 文件 ]` 形式里路径出现两次，两处都加前缀。
 */
function parseVitest(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const failures = [];
  for (const line of clean.split('\n')) {
    const m = line.match(/^ FAIL\s{2}(.+?)\s*$/);
    if (!m) continue;
    const key = m[1].replace(/\s+/g, ' ');
    const pm = key.match(/^(\S+)([\s\S]*)$/);
    if (!pm) { failures.push(key); continue; }
    const repoPath = `app/${pm[1]}`;
    const rest = pm[2].startsWith(' [ ') ? pm[2].replace(` [ ${pm[1]} ]`, ` [ ${repoPath} ]`) : pm[2];
    failures.push(repoPath + rest);
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
    multiset: true,
    parse: parseTap,
    run: async () => run('npx', ['tsx', '--test', '--test-reporter=tap', 'tests/server/**/*.test.ts'], ROOT),
    // TAP 汇总行 `# fail N` 存在即说明跑完；解析到 0 失败但退出码非 0 也可能是全过之外的崩溃
    looksComplete: (out) => /^# (tests|pass|fail) /m.test(out),
  },
  'typecheck': {
    baselineFile: 'typecheck-errors.txt',
    multiset: true,
    parse: parseTypecheck,
    supportsInput: false, // 双树输出须分别捕获归属，单文件 --input 无法区分 root/app
    /**
     * root 与 app 两棵树分开跑、分开判定（P2-a）：合并输出 + 折叠退出码会让
     * root 的基线错误掩盖 app 侧「非零退出但诊断不可解析」的基础设施失败。
     * 每棵树独立判：退出码非 0 且本树解析出 0 条诊断键 → infraFailures 独立判红；
     * 诊断键加 `root:` / `app:` 前缀后合并，与基线做多重集对照。
     */
    runSuite: async () => {
      const trees = [];
      for (const [name, cwd] of [['root', ROOT], ['app', join(ROOT, 'app')]]) {
        const r = await run('npx', ['tsc', '--noEmit'], cwd);
        trees.push({ name, code: r.code, output: r.output, keys: parseTypecheck(r.output).map((k) => `${name}:${k}`) });
      }
      return {
        code: trees.some((t) => t.code !== 0) ? 2 : 0,
        output: trees.map((t) => t.output).join(''),
        actual: trees.flatMap((t) => t.keys),
        infraFailures: trees
          .filter((t) => t.code !== 0 && t.keys.length === 0)
          .map((t) => `typecheck/${t.name}: tsc 退出码 ${t.code} 但未解析到任何诊断（疑似 TS 配置错误或 tsc 崩溃），按基础设施失败判红`),
      };
    },
    looksComplete: () => true, // tsc 无汇总行；完整性由 runSuite 的逐树退出码 + 诊断解析判定
  },
  'test-app': {
    baselineFile: 'test-app-failures.txt',
    multiset: true,
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

const countOf = (arr) => arr.reduce((map, x) => map.set(x, (map.get(x) ?? 0) + 1), new Map());

/**
 * 返回 { newFailures, fixedEntries }，条目为 { key }（集合对照）或
 * { key, actual, baseline }（多重集对照：该键在两侧的出现次数）。
 */
function compare(actual, baseline, multiset) {
  const ca = countOf(actual); const cb = countOf(baseline);
  const newFailures = []; const fixedEntries = [];
  if (!multiset) {
    for (const k of ca.keys()) if (!cb.has(k)) newFailures.push({ key: k });
    for (const k of cb.keys()) if (!ca.has(k)) fixedEntries.push({ key: k });
  } else {
    for (const [k, n] of ca) { const b = cb.get(k) ?? 0; if (n > b) newFailures.push({ key: k, actual: n, baseline: b }); }
    for (const [k, n] of cb) { const a = ca.get(k) ?? 0; if (n > a) fixedEntries.push({ key: k, actual: a, baseline: n }); }
  }
  const byKey = (x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  return { newFailures: newFailures.sort(byKey), fixedEntries: fixedEntries.sort(byKey) };
}

/** 条目的展示行：多重集条目带两侧计数（如「实际 2 条，基线 1 条，超出 1 条」在调用处拼）。 */
function entryText(e) {
  return e.actual === undefined ? e.key : `${e.key}（实际 ${e.actual} 条，基线 ${e.baseline} 条）`;
}

/* ---------------------------------- 主流程 ---------------------------------- */

const BASELINE_HEADERS = {
  'test-server-failures.txt': [
    '# test:server 基线失败集（node:test TAP 口径：仓库相对路径 :: suite 路径 > 叶子名，含 suite 汇总行）。',
    '# 多重集对照：同一键出现几行就是几条，实际多于基线即新失败。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
  'typecheck-errors.txt': [
    '# typecheck 基线错误集（归一化键：子树前缀 root:/app: + 文件 :: TS 错误码 :: 消息主体，已剥离行列号）。',
    '# 计数对照：同一键出现几行就是几条，增减按条计。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
  'test-app-failures.txt': [
    '# test:app 基线失败集（vitest FAIL 行归一为仓库相对路径：app/文件 > suite > 用例；文件级失败保留 [ 文件 ] 形式）。',
    '# 多重集对照：同一键出现几行就是几条，实际多于基线即新失败。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
  'verify-all-failures.txt': [
    '# verify:all 基线失败集（verify 名）。维护纪律见 AGENTS.md「CI 基线纪律」。',
  ].join('\n'),
};

/* ------------------------------ 基线增减门禁 ------------------------------ */

function parseBaselineText(text) {
  return text.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '' && !l.startsWith('#'));
}

/** 读 base 提交上的某个基线文件；不存在返回 null；base 对象取不到则抛错（基础设施失败）。 */
function readBaseBaseline(sha, file) {
  const r = spawnSync('git', ['show', `${sha}:ci/baseline/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return parseBaselineText(r.stdout);
  const err = String(r.stderr ?? '');
  if (/does not exist|exists on disk, but not in/.test(err)) return null;
  throw new Error(`git show ${sha}:ci/baseline/${file} 失败（base 对象不可达？CI 需 fetch-depth: 0）：${err.trim()}`);
}

/**
 * 基线 delta 门禁（P1）：各套件的对照都读「当前 checkout 的基线」，同 PR 把新失败
 * 写进基线即可静默放行（--write-baseline 更是现成覆写入口）。本门禁以 PR base
 * （或 push 的 before）提交上的基线为准对照：条目多重集只许删不许增，增行判红
 * 并逐行点名。条目口径与 readBaseline 一致（# 注释与空行不计条目，改注释不触发）。
 * base 上四件套全不存在 = 引入 CI 的首个 PR，按「基线引导」跳过并明示。
 */
function baselineDelta(baseArg) {
  const sha = (baseArg || process.env.CI_BASE_SHA || '').trim();
  if (!sha || /^0+$/.test(sha)) {
    console.log('[ci] baseline-delta: 未提供有效 base SHA（本地手动运行或新分支首推），跳过。本门禁在 workflow 中由 CI_BASE_SHA 注入。');
    return;
  }
  const files = [...new Set(Object.values(SUITES).map((s) => s.baselineFile))];
  const perFile = files.map((f) => ({ file: f, base: readBaseBaseline(sha, f), current: readBaseline(f) }));
  if (perFile.every((p) => p.base === null)) {
    console.log(`[ci] baseline-delta: 基线引导——base ${sha.slice(0, 7)} 上无 ci/baseline，本次为初始建基线，跳过增减判红。`);
    return;
  }
  let addedTotal = 0;
  for (const { file, base, current } of perFile) {
    const cb = countOf(base ?? []);
    for (const [key, n] of countOf(current)) {
      const b = cb.get(key) ?? 0;
      if (n > b) {
        addedTotal += n - b;
        console.error(`[ci] baseline-delta: ${file} 新增基线条目（base ${b} 条 → 当前 ${n} 条）：${key}`);
      }
    }
  }
  if (addedTotal > 0) {
    console.error(`[ci] baseline-delta: 共新增 ${addedTotal} 条基线条目，判红。基线只许删不许增；确需扩基线须经业主评审并在 PR 描述逐条说明（红不禁止合并，但不得静默）。`);
    process.exit(1);
  }
  console.log(`[ci] baseline-delta: 当前基线是 base ${sha.slice(0, 7)} 基线的子集（只删不增），通过。`);
}

/* ---------------------------------- 主流程 ---------------------------------- */

async function main() {
  const [suiteName, ...rest] = process.argv.slice(2);
  if (suiteName === 'baseline-delta') {
    const baseIdx = rest.indexOf('--base');
    baselineDelta(baseIdx >= 0 ? rest[baseIdx + 1] : undefined);
    return;
  }
  const suite = SUITES[suiteName];
  if (!suite) {
    console.error(`用法: node ci/check.mjs <${Object.keys(SUITES).join('|')}|baseline-delta> [--input <file>] [--write-baseline] [--base <sha>]`);
    process.exit(2);
  }
  const inputIdx = rest.indexOf('--input');
  const writeBaselineMode = rest.includes('--write-baseline');

  let output; let exitCode = 0; let actual; let infraFailures = [];
  if (inputIdx >= 0) {
    if (suite.supportsInput === false) {
      console.error(`[ci] ${suiteName}: 双树套件须分别捕获，不支持 --input；请直接跑 live 命令。`);
      process.exit(2);
    }
    output = readFileSync(rest[inputIdx + 1], 'utf8');
    actual = suite.parse(output);
  } else if (suite.runSuite) {
    const result = await suite.runSuite();
    output = result.output; exitCode = result.code; actual = result.actual; infraFailures = result.infraFailures ?? [];
  } else {
    const result = await suite.run();
    output = result.output; exitCode = result.code;
    actual = suite.parse(output);
  }

  // 套件崩溃守卫：解析不到完整结果、或退出码非 0 且零失败条目 —— 不是「全过」，是没跑成。
  if (!suite.looksComplete(output)) {
    console.error(`\n[ci] ${suiteName}: 输出不完整（套件可能崩溃），按基础设施失败判红。`);
    process.exit(1);
  }
  if (exitCode !== 0 && actual.length === 0 && suiteName !== 'verify-all' && infraFailures.length === 0) {
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
    console.log(`[ci] 以下 ${fixedEntries.length} 条基线条目已不再出现（基线可缩减，请在修红的 PR 里删行）：`);
    for (const f of fixedEntries) console.log(`  - ${entryText(f)}`);
  }
  let failed = false;
  for (const msg of infraFailures) { console.error(`[ci] ${msg}`); failed = true; }
  if (newFailures.length > 0) {
    const total = newFailures.reduce((s, e) => s + (e.actual === undefined ? 1 : e.actual - e.baseline), 0);
    console.error(`[ci] 发现 ${total} 条基线外新失败，判红：`);
    for (const f of newFailures) {
      console.error(`  + ${entryText(f)}${f.actual === undefined ? '' : `，超出 ${f.actual - f.baseline} 条`}`);
    }
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(`[ci] ${suiteName}: 无基线外新失败，对照通过。`);
}

main().catch((err) => { console.error(err); process.exit(1); });
