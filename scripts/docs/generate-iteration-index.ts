/**
 * 生成 docs/design-iterations/INDEX.yaml（文档精简批 3 起）。
 *
 * 数据源：每轮 round.yaml 的 index 段（topic / review_state / supersedes /
 * note / order / exempt_files）。external_refs 在生成时用 git grep 现算：
 * 统计「本轮目录之外、且不是 INDEX.yaml 本身」的已跟踪文件里，包含本轮
 * 目录名的文件数。INDEX.yaml 是生成物，禁止手改；改登记信息请改对应
 * 轮次的 round.yaml 后重跑 `npm run docs:generate-index`。
 * verify-iteration-metadata 以 buildIndexText() 与磁盘逐字节比对做
 * freshness 校验（index_stale），生成物过期必然报红。
 *
 * 唯一非轮次条目：tile-scope-owner-review-20261007.md（散文件评审），
 * 无 round.yaml，其登记字段在本脚本的 EXTRA_ENTRIES 里维护。
 * meta 中的全局信息（hardcoded_paths / facts_error_level_readers /
 * batch_log / external_refs_zero_meaning）为 2026-10-20 建索引时登记的
 * 存量事实，由 PRESERVED_META 承接，逐批追加、不得静默丢失。
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

/** 建索引时登记的全局存量信息（批 3 迁移逐字承接 2026-10-20 手工版 INDEX 的 meta，
 * 仅追加 slimming-3 一条 batch_log；maintenance 口径已按生成化改写，见文件头注释）。 */
const PRESERVED_META = {
  "established": "2026-10-20",
  "external_refs_zero_meaning": "该目录在任何 md/yaml/json/ts/py 里都没被按名引用，只能靠 DEC 行号或猜测找到",
  "hardcoded_paths": [
    {
      "dir": "hvac-dual-outlet-threeline-20261007",
      "locations": [
        "scripts/render/diagrams/draw-hvac-ld-threeline.py:190",
        "scripts/render/capture/capture_hvac_ld_threeline_views.py:19"
      ]
    },
    {
      "dir": "tile-plank-comparison-20261006",
      "locations": [
        "tests/server/tile-cost-comparison.test.ts:132,169",
        "tests/server/masonry-quotes.test.ts:181"
      ]
    },
    {
      "dir": "mep-lint-governance-20261006",
      "locations": [
        "tests/server/mep-guidance-baseline.test.ts:25（活门禁）"
      ]
    }
  ],
  "facts_error_level_readers": [
    "hvac-resix-20261003/fact-table.yaml",
    "hvac-resix-20261003/design-datum.yaml"
  ],
  "batch_log": [
    {
      "batch": 1,
      "date": "2026-10-20",
      "moved": 9,
      "criterion": "零外部引用且零目录内互引",
      "refs_changed": 0,
      "ls_before": 65,
      "ls_after": 56
    },
    {
      "batch": 2,
      "date": "2026-10-20",
      "moved": 11,
      "criterion": "零外部引用但有目录内互引",
      "refs_changed": 125,
      "refs_detail": "32 处跨目录引用 + 91 处自引用 + 2 处裸目录名，涉及 20 个文件",
      "ls_before": 56,
      "ls_after": 45,
      "residual": "docs/decisions/02-layout-public.md:430 以裸名提及 hvac-dining-ceiling-20261005；按 decisions 归档纪律「历史条目只登记不改写」未动，待业主裁定是否补一条修正 DEC"
    },
    {
      "batches_total": null,
      "archive_dirs": 20,
      "git_state": "309 rename + 4 modified + 0 untracked",
      "gates": "verify:all 16/17（verify-mep 149 error 为 2026-10-19 已登记存量基线）；test:server 1040/1003/37；typecheck 通过"
    },
    {
      "batch": "slimming-3",
      "date": "2026-10-22",
      "action": "五件套合并 round.yaml + INDEX 生成化（文档精简批 3）",
      "detail": "277 个五件套文件并入 64 个 round.yaml；INDEX.yaml 改由 scripts/docs/generate-iteration-index.ts 生成，meta 全局信息（hardcoded_paths/facts 读者/batch_log/maintenance 口径）由生成器承接；hvac-resix 两件与 mep-lint-governance review-manifest 按原路径豁免保留"
    }
  ]
};

const MAINTENANCE = [
  '新增 iteration 目录时，先在该轮 round.yaml 的 index 段填全字段（order 取当前最大值 +1），再重跑 npm run docs:generate-index；禁止手改 INDEX.yaml',
  'external_refs 由生成时 git grep 现算（口径见 field_provenance），仍会随引用增减漂移；每次生成即校准，不再单设校验',
  '本文件不是第二份真相：review_state/supersedes 的权威在各轮 round.yaml 的 index 段（源头为原 manifest/brief），本文件只是汇总视图',
  '目录搬迁后更新对应 round.yaml 与各处引用，并在 commit message 里记录旧到新路径映射',
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

export function buildIndexText(): string {
  const rounds: Array<{ dir: string; idx: RoundIndex }> = [];
  const scan = (rel: string) => {
    const abs = rel ? path.join(ITER, rel) : ITER;
    for (const name of fs.readdirSync(abs)) {
      if (rel === '' && name === 'archive') continue; // archive 是容器，单独扫描
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

  const header = `# docs/design-iterations 导航索引（机读生成物，禁止手改）
# 生成：npm run docs:generate-index（scripts/docs/generate-iteration-index.ts）
# 数据源：每轮 round.yaml 的 index 段；external_refs 由生成时 git grep 现算。
# freshness 由 verify-iteration-metadata 的 index_stale 契约逐字节校验。
`;
  const body = dumpYaml(
    {
      meta: {
        schema: 'design-iterations-index/v2',
        generated: true,
        established: PRESERVED_META.established,
        dir_count: rounds.length,
        stray_file_count: EXTRA_ENTRIES.length,
        external_refs_total: entries.reduce((a, e) => a + e.external_refs, 0),
        field_provenance: {
          topic: 'round.yaml index.topic 原文（原按目录名前缀归类，命名事实）',
          review_state: 'round.yaml index.review_state 原文（来自原 review-manifest 的 state/status 字段；无 manifest 记 none）',
          supersedes: 'round.yaml index.supersedes 原文（来自原 decision-brief 的 supersedes 字段；无字段记 none）',
          external_refs:
            '生成时现算：本轮目录之外（不含 INDEX.yaml 本身）的已跟踪文件中包含本轮目录名的文件数（git grep -l）',
          note: 'round.yaml index.note 原文（仅登记已核实的结构性事实；无 note = 未核查，不等于无问题）',
        },
        external_refs_zero_meaning: PRESERVED_META.external_refs_zero_meaning,
        hardcoded_paths: PRESERVED_META.hardcoded_paths,
        facts_error_level_readers: PRESERVED_META.facts_error_level_readers,
        batch_log: PRESERVED_META.batch_log,
        maintenance: MAINTENANCE,
      },
      entries,
    },
    { lineWidth: -1 },
  );
  return header + body;
}

function main(): void {
  const text = buildIndexText();
  fs.writeFileSync(path.join(ITER, 'INDEX.yaml'), text, 'utf8');
  const count = (text.match(/^\s+- dir:/gm) ?? []).length;
  console.log(`INDEX.yaml regenerated: ${count} entries`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-iteration-index.ts')) main();
