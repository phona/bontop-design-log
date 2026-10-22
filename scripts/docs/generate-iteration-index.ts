/**
 * 生成 docs/design-iterations/INDEX.yaml（文档精简批 3 起）。
 *
 * 数据源：每轮 round.yaml 的 index 段（topic / review_state / supersedes /
 * note / order / exempt_files）。external_refs 在生成时用 git grep 现算：
 * 统计「本轮目录之外、且不是 INDEX.yaml 本身」的已跟踪文件里，包含本轮
 * 目录名的文件数。INDEX.yaml 是生成物，禁止手改；改登记信息请改对应
 * 轮次的 round.yaml 后重跑 `npm run docs:generate-index`。
 *
 * 唯一非轮次条目：tile-scope-owner-review-20261007.md（散文件评审），
 * 无 round.yaml，其登记字段在本脚本的 EXTRA_ENTRIES 里维护。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ITER = path.join(ROOT, 'docs/design-iterations');

interface RoundIndex {
  order: number;
  topic: string;
  review_state: string;
  supersedes: string;
  note?: string;
  exempt_files?: string[];
}

const EXTRA_ENTRIES = [
  {
    dir: 'tile-scope-owner-review-20261007.md',
    order: 44,
    topic: 'tile-finish',
    review_state: 'none',
    supersedes: 'none',
    note: '这是散落在 design-iterations 根下的 md 文件，不是目录；被 docs/decisions/11-tile-finish.md 引用。散文件无 round.yaml，登记字段在本生成脚本维护',
  },
];

function countExternalRefs(roundRel: string, roundId: string): number {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-l', '-F', '--', roundId], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  } catch {
    return 0; // git grep 无命中时 exit 1
  }
  return out
    .split('\n')
    .filter((f) => f.length > 0)
    .filter((f) => !f.startsWith(`docs/design-iterations/${roundRel}/`))
    .filter((f) => f !== 'docs/design-iterations/INDEX.yaml').length;
}

function main(): void {
  const rounds: Array<{ dir: string; idx: RoundIndex }> = [];
  const scan = (rel: string) => {
    const abs = path.join(ITER, rel);
    for (const name of fs.readdirSync(abs)) {
      const full = path.join(abs, name);
      if (!fs.statSync(full).isDirectory()) continue;
      const roundFile = path.join(full, 'round.yaml');
      if (!fs.existsSync(roundFile)) {
        throw new Error(`缺少 round.yaml: docs/design-iterations/${rel ? rel + '/' : ''}${name}`);
      }
      const parsed = loadYaml(fs.readFileSync(roundFile, 'utf8')) as { index: RoundIndex };
      rounds.push({ dir: rel ? `${rel}/${name}` : name, idx: parsed.index });
    }
  };
  scan('');
  scan('archive');

  const entries = [
    ...rounds.map(({ dir, idx }) => ({ dir, idx })),
    ...EXTRA_ENTRIES.map((e) => ({
      dir: e.dir,
      idx: {
        order: e.order,
        topic: e.topic,
        review_state: e.review_state,
        supersedes: e.supersedes,
        note: e.note,
      } as RoundIndex,
    })),
  ]
    .sort((a, b) => a.idx.order - b.idx.order)
    .map(({ dir, idx }) => ({
      dir,
      topic: idx.topic,
      review_state: idx.review_state,
      supersedes: idx.supersedes,
      external_refs: countExternalRefs(dir, path.basename(dir)),
      ...(idx.note ? { note: idx.note } : {}),
    }));

  const header = `# design-iterations 迭代入口索引（机读生成物，禁止手改）
# 生成：npm run docs:generate-index（scripts/docs/generate-iteration-index.ts）
# 数据源：每轮 round.yaml 的 index 段；external_refs 由生成时 git grep 现算。
`;
  const body = dumpYaml(
    {
      meta: {
        schema: 'design-iterations-index/v2',
        generated: true,
        field_provenance: {
          dir: '轮次目录名（archive/ 前缀表示已归档区）',
          topic: 'round.yaml index.topic 原文',
          review_state: 'round.yaml index.review_state 原文（来自原 review-manifest 的 state/status）',
          supersedes: 'round.yaml index.supersedes 原文',
          external_refs:
            '生成时现算：本轮目录之外（不含 INDEX.yaml 本身）的已跟踪文件中包含本轮目录名的文件数',
          note: 'round.yaml index.note 原文（无则省略）',
        },
      },
      entries,
    },
    { lineWidth: -1 },
  );
  fs.writeFileSync(path.join(ITER, 'INDEX.yaml'), header + body, 'utf8');
  console.log(`INDEX.yaml regenerated: ${entries.length} entries`);
}

main();
