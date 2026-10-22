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

    for (const [file, section] of PIECES) {
      const p = path.join(dirAbs, file);
      if (!fs.existsSync(p)) continue;
      const src = fs.readFileSync(p, 'utf8');
      const parsed = file.endsWith('.json') ? JSON.parse(src) : loadYaml(src);
      if (exempt.includes(file)) continue; // 保留原文件，不并入
      merged[section] = parsed;
      // 逐段保真校验：合并对象该段与原文解析结果 deep-equal。
      assert.deepStrictEqual(merged[section], parsed, `${entry.dir}/${file} 段保真失败`);
      removed.push(path.relative(ROOT, p));
    }

    const text =
      '# 本轮的全部结构化记录（文档精简批 3 由五件套合并；原文见 git 历史）。\n' +
      '# INDEX.yaml 由 scripts/docs/generate-iteration-index.ts 从本文件的 index 段生成，勿手改 INDEX。\n' +
      dumpYaml(merged, { lineWidth: -1 });
    // 整文件回读校验。
    const reread = loadYaml(text) as Record<string, unknown>;
    assert.deepStrictEqual(reread, merged, `${entry.dir}/round.yaml 回读不一致`);
    fs.writeFileSync(path.join(dirAbs, 'round.yaml'), text, 'utf8');
    rounds += 1;
  });

  console.log(`round.yaml written for ${rounds} rounds`);
  console.log(`piece files to remove: ${removed.length}`);
  fs.writeFileSync('/tmp/merged-pieces.txt', removed.join('\n'));
}

main();
