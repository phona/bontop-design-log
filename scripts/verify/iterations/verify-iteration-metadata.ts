import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

/**
 * iteration 元数据可解析性门禁（design-iterations round.yaml 一件套）。
 *
 * 为什么需要它：`docs/design-iterations/<round>/round.yaml`（2026-10-22 文档
 * 精简批 3 由五件套合并而来）是每轮设计的机读元数据，但**全是 AI 手写的，
 * 写入时没有任何工具校验语法**。五件套时代已实测有 24 个 YAML/JSON 语法损坏
 * （流式集合缺逗号 11、缩进错误 11、重复键 1、JSON 语法 1），坏了两三年无人
 * 发现——因为没有任何读者。
 *
 * 本 verifier 把「必须可解析」变成门禁：递归解析 scope 内所有 .yaml/.json，
 * 不可解析的连错误类型与行号一起报。这样两类失效都会当场显形：
 *   ① 新写的 round.yaml 语法坏掉 → 写的时候就被拦，不留给三个月后
 *   ② 想按 round.yaml 做机读聚合（INDEX.yaml 即由其 index 段生成）→ 工具
 *      不会静默跳过坏文件
 * 另加一条结构契约：每个轮次目录（含 archive/ 下）必须有 round.yaml
 * （round_yaml_missing），保证「每轮一件套」不漏登记。
 *
 * 刻意不做语义校验：本脚本只回答「能不能解析、登记全不全」，不回答
 * 「内容对不对」。语义校验属于各轮自己的 review 与 config 对账，混进来会让
 * 这个门禁变得不可维护。
 *
 * CLI 契约与 verify-model-package-links 一致：`--json` 不含时间戳、issue 按
 * code/entity/message 稳定排序；errors > 0 → exit 1。
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SCOPE = 'docs/design-iterations';

interface MetaIssue {
  level: 'error' | 'warning';
  code: string;
  entity: string;
  source: string;
  message: string;
}

/** 把解析器错误归类成稳定 code，便于按类计数。 */
function classify(message: string): string {
  if (/missed comma between flow collection/i.test(message)) return 'yaml_flow_missing_comma';
  if (/duplicated mapping key/i.test(message)) return 'yaml_duplicate_key';
  if (/bad indentation|deficient indentation|mapping entry/i.test(message)) return 'yaml_indentation';
  if (/a line break is expected|did not find expected|unexpected end/i.test(message)) return 'yaml_structure';
  if (/Expected ',' or '}'|Unexpected token|not valid JSON/i.test(message)) return 'json_syntax';
  return 'unclassified';
}

/** 从 YAML mark 或 JSON 字符偏移抽取行列；无法确定时返回空串。 */
export function errorLocation(message: string, source: string, format: 'yaml' | 'json'): string {
  if (format === 'yaml') {
    const mark = message.match(/\((\d+):(\d+)\)/);
    return mark ? `${mark[1]}:${mark[2]}` : '';
  }
  const position = message.match(/\bposition\s+(\d+)\b/i);
  const unexpected = message.match(/Unexpected token ['"](.?)['"]/i);
  const offset = position
    ? Number(position[1])
    : unexpected?.[1]
      ? source.lastIndexOf(unexpected[1])
      : -1;
  if (offset < 0) return '';
  const prefix = source.slice(0, offset);
  const line = prefix.split('\n').length;
  const column = offset - prefix.lastIndexOf('\n');
  return `${line}:${column}`;
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.(yaml|yml|json)$/i.test(entry.name)) out.push(full);
  }
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const issues: MetaIssue[] = [];

  const files: string[] = [];
  walk(path.join(ROOT, SCOPE), files);
  files.sort();

  const byExt = { yaml: 0, json: 0 };
  for (const f of files) {
    if (f.endsWith('.json')) byExt.json += 1;
    else byExt.yaml += 1;
  }

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    try {
      if (file.endsWith('.json')) JSON.parse(src);
      else loadYaml(src);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      const code = classify(message);
      const at = errorLocation(message, src, file.endsWith('.json') ? 'json' : 'yaml');
      issues.push({
        level: 'error',
        code,
        entity: rel,
        source: rel,
        message: `${code}${at ? ` @ ${at}` : ''}：${message.slice(0, 160)}`,
      });
    }
  }

  // 结构契约：每个轮次目录必须有 round.yaml（一件套登记不漏）。
  const roundDirs: string[] = [];
  for (const base of [SCOPE, `${SCOPE}/archive`]) {
    const abs = path.join(ROOT, base);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (base === SCOPE && entry.name === 'archive') continue; // archive 是容器
      roundDirs.push(`${base}/${entry.name}`);
    }
  }
  for (const dir of roundDirs) {
    if (!fs.existsSync(path.join(ROOT, dir, 'round.yaml'))) {
      issues.push({
        level: 'error',
        code: 'round_yaml_missing',
        entity: dir,
        source: dir,
        message: `轮次目录缺少 round.yaml：${dir}`,
      });
    }
  }

  // scope 内一个文件都没有 = 目录被删空或路径写错，必须红而不是静默通过。
  if (files.length === 0) {
    issues.push({
      level: 'error',
      code: 'scope_empty',
      entity: SCOPE,
      source: SCOPE,
      message: `${SCOPE} 下没有任何 .yaml/.json——scope 路径写错或目录被清空`,
    });
  }

  const sorted = [...issues].sort(
    (a, b) => a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity) || a.message.localeCompare(b.message),
  );
  const errors = sorted.filter((issue) => issue.level === 'error');

  const byCode: Record<string, number> = {};
  for (const issue of errors) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;

  const output = JSON.stringify({
    version: 1,
    scope: SCOPE,
    counts: { errors: errors.length, warnings: 0, info: 0 },
    inputs: { files: files.length, yaml: byExt.yaml, json: byExt.json },
    byCode,
    issues: sorted,
  }, null, 2);

  if (args.has('--json')) {
    console.log(output);
  } else {
    console.log(`Iteration metadata lint: ${errors.length} error(s)`);
    console.log(`  ${SCOPE}: ${files.length} file(s) (${byExt.yaml} yaml / ${byExt.json} json)`);
    if (Object.keys(byCode).length > 0) {
      console.log(`  by code: ${Object.entries(byCode).map(([c, n]) => `${c} ×${n}`).join(', ')}`);
    }
    for (const issue of sorted) {
      console.log(`  x [${issue.code}] ${issue.entity}: ${issue.message}`);
    }
  }
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
