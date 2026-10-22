/**
 * 一次性迁移（文档精简批 3，2026-10-22）：把每轮的五件套
 * （decision-brief.yaml / design-datum.yaml / fact-table.yaml /
 * object-manifest.yaml / review-manifest.json）合并为单个 round.yaml。
 *
 * 规则：
 * - 字段不丢：五件套各自解析后挂到 brief/datum/fact_table/objects/review 段下；
 *   合并结果与原文逐段 deep-equal 校验，不等即中止（原文可从 git 历史取回）。
 * - INDEX.yaml 的登记字段（topic/review_state/supersedes/note + 登记序 order）
 *   一并写入 round.yaml 的 index 段，此后 INDEX.yaml 改由
 *   scripts/docs/generate-iteration-index.ts 生成。
 * - 豁免（有 error 级机器读者按原路径读，保留原文件、只合并其余件）：
 *   hvac-resix-20261003 的 fact-table.yaml / design-datum.yaml（config/facts.yaml 读者）；
 *   mep-lint-governance-20261006 的 review-manifest.json（治理基线测试读者）。
 * - 没有五件套的轮次也生成 round.yaml（只有 schema/iteration_id/index 段），
 *   保证「每轮一个 round.yaml」无一例外。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ITER = path.join(ROOT, 'docs/design-iterations');

const PIECES: Array<[string, string]> = [
  ['decision-brief.yaml', 'brief'],
  ['design-datum.yaml', 'datum'],
  ['fact-table.yaml', 'fact_table'],
  ['object-manifest.yaml', 'objects'],
  ['review-manifest.json', 'review'],
];

const EXEMPT: Record<string, string[]> = {
  'hvac-resix-20261003': ['fact-table.yaml', 'design-datum.yaml'],
  'mep-lint-governance-20261006': ['review-manifest.json'],
};

interface IndexEntry {
  dir: string;
  topic: string;
  review_state: string;
  supersedes: string;
  external_refs: number;
  note?: string;
}


/** 提取 YAML 原文的实质注释（全行注释 + 引号外的行尾注释；引号内的 # 不算）。 */
function extractComments(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('#')) {
      out.push({ line: i + 1, text: t.replace(/^#+\s?/, '') });
      return;
    }
    let inS = false, inD = false, pos = -1;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === "'" && !inD) inS = !inS;
      else if (ch === '"' && !inS) inD = !inD;
      else if (ch === '#' && !inS && !inD && j > 0 && line[j - 1] === ' ') { pos = j; break; }
    }
    if (pos > 0) {
      const key = line.slice(0, pos).trim().replace(/:$/, '').split(':')[0].slice(0, 40);
      out.push({ line: i + 1, text: `${key} —— ${line.slice(pos + 1).trim()}` });
    }
  });
  return out;
}

/**
 * 值引用改指（与二审修复的提交内容一致，内建于迁移本身）：结构化字符串里指向
 * 「将被删除的五件套文件」的引用改指 round.yaml 对应段；指向豁免保留文件的
 * 引用（EXEMPT 清单）原样保留。带目录前缀的按前缀判定，裸文件名按本轮判定。
 */
const SECTION_OF: Record<string, string> = Object.fromEntries(PIECES);
function isRetained(dirBase: string, file: string): boolean {
  return (EXEMPT[dirBase] ?? []).includes(file);
}
function rewriteRefs(value: unknown, ownBase: string): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /(?:([\w.-]+(?:\/[\w.-]+)*)\/)?(decision-brief\.yaml|design-datum\.yaml|fact-table\.yaml|object-manifest\.yaml|review-manifest\.json)/g,
      (m, prefix: string | undefined, name: string) => {
        const targetBase = prefix ? prefix.split('/').pop()! : ownBase;
        if (isRetained(targetBase, name)) return m;
        const section = SECTION_OF[name];
        return prefix ? `${prefix}/round.yaml（${section} 段）` : `round.yaml（${section} 段）`;
      },
    );
  }
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, ownBase));
  if (value && typeof value === 'object') {
    // 键也改指：checksums 类映射以五件套路径为键（二审复现核对发现）。
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [rewriteRefs(k, ownBase) as string, rewriteRefs(v, ownBase)]),
    );
  }
  return value;
}

function main(): void {
  // 幂等保护（批 3 审阅修复）：任一 round.yaml 已存在即中止——五件套删除后
  // 重跑会把 round.yaml 覆盖成只有 index 段的空壳，属于毁数据操作。
  const existing: string[] = [];
  const walkFor = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walkFor(path.join(dir, e.name));
      else if (e.name === 'round.yaml') existing.push(path.relative(ROOT, path.join(dir, e.name)));
    }
  };
  walkFor(ITER);
  if (existing.length > 0) {
    throw new Error(
      `迁移已执行过（发现 ${existing.length} 个 round.yaml，如 ${existing[0]}）；拒绝重跑以免覆盖有效数据。如需重做，请先在干净的五件套状态下运行。`,
    );
  }
  const index = loadYaml(fs.readFileSync(path.join(ITER, 'INDEX.yaml'), 'utf8')) as {
    entries: IndexEntry[];
  };
  const removed: string[] = [];
  let rounds = 0;

  index.entries.forEach((entry, i) => {
    const dirAbs = path.join(ITER, entry.dir);
    if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
      console.log(`skip (not a dir): ${entry.dir}`);
      return;
    }
    const base = path.basename(entry.dir);
    const exempt = EXEMPT[base] ?? [];
    const merged: Record<string, unknown> = {
      schema: 'design-iteration-round/v1',
      iteration_id: base,
      index: {
        order: i + 1,
        topic: entry.topic,
        review_state: entry.review_state,
        supersedes: entry.supersedes,
        ...(entry.note ? { note: entry.note } : {}),
      },
    };
    if (exempt.length > 0) (merged.index as Record<string, unknown>).exempt_files = exempt;

    const commentBlocks: Array<{ file: string; comments: Array<{ line: number; text: string }> }> = [];
    for (const [file, section] of PIECES) {
      const p = path.join(dirAbs, file);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf8');
      const parsed = file.endsWith('.json') ? JSON.parse(src) : loadYaml(src);
      if (exempt.includes(file)) continue; // 保留原文件，不并入
      const comments = extractComments(src);
      if (comments.length > 0) commentBlocks.push({ file, comments });
      merged[section] = parsed;
      // 逐段保真校验：合并对象该段与原文解析结果 deep-equal。
      assert.deepStrictEqual(merged[section], parsed, `${entry.dir}/${file} 段保真失败`);
      removed.push(path.relative(ROOT, p));
    }

    // 值引用改指作用于全部段（含 index.note），与提交版本一致。
    const rewritten = rewriteRefs(merged, base) as Record<string, unknown>;
    let preservation = '';
    if (commentBlocks.length > 0) {
      const lines = ['# ── 原五件套注释保全（批 3 迁移时自原文逐条提取；[文件 L行号] 为原文位置，语义注释不得当作字段删除）──'];
      for (const b of commentBlocks) for (const c of b.comments) lines.push(`# [${b.file} L${c.line}] ${c.text}`);
      lines.push('# ── 注释保全结束 ──');
      preservation = lines.join('\n') + '\n';
    }
    const text =
      '# 本轮的全部结构化记录（文档精简批 3 由五件套合并；原文见 git 历史）。\n' +
      '# INDEX.yaml 由 scripts/docs/generate-iteration-index.ts 从本文件的 index 段生成，勿手改 INDEX。\n' +
      preservation +
      dumpYaml(rewritten, { lineWidth: -1 });
    // 整文件回读校验。
    const reread = loadYaml(text) as Record<string, unknown>;
    assert.deepStrictEqual(reread, rewritten, `${entry.dir}/round.yaml 回读不一致`);
    fs.writeFileSync(path.join(dirAbs, 'round.yaml'), text, 'utf8');
    rounds += 1;
  });

  console.log(`round.yaml written for ${rounds} rounds`);
  console.log(`piece files to remove: ${removed.length}`);
  fs.writeFileSync('/tmp/merged-pieces.txt', removed.join('\n'));
}

main();
