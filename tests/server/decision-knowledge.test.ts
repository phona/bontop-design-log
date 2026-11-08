// tests/server/decision-knowledge.test.ts
// DEC 知识载体（config/decision-knowledge.yaml，issue #98 第六阶段 S2）的自检。
//
// 背景：业主 2026-11-08 裁定「DEC 体系退役，不建中央决策账」。S1 建的
// config/decision-registry.yaml（292 条 × intent 摘要）是原料、拆完即删；本文件是它拆完之后的
// 残壳，只收两类东西：
//   entries —— 真·不可再生的知识（合同成交语义/竞品淘汰理由/业主原话与口头规格/实地断言/
//              静默失效分析），每条带 landing 指向它同时落到的机读位置；
//   retired —— 其余 292−entries 条的墓碑一行（id/subject/status/superseded_by/record/landing），
//              不搬正文（正文即 git 历史）。
//
// 这个文件是它的**机器校验器**，对应设计文档 §2.5 的对账钩子：
//   钩子 1 id 覆盖对账 —— 本文件 id 集合 ⊇ docs/decisions/ 标题实测集合（差集必须为 0）；
//                        S3 删档后集合为空、本文件成为编号的唯一在册载体，断言自动切换到
//                        「本文件自身完整」分支（与 S1 登记簿测试同构）。
//   钩子 4 自检        —— js-yaml 逐条目断言 + 值内含 `#` 已加引号（AGENTS.md 铁律 7）
//                        + landing 词表合法且指向的路径/台账编号真实存在。
//
// 为什么这些断言值得钉死：本文件是全仓约 1,900 处 DEC 编号引用在 docs/decisions/ 删除后唯一的
// 解析靶（c.dec_unique / c.dec_ref_resolvable / repair_channel.decision_ref 都以它为 target）。
// 字段漂移（漏条目、重号、landing 指向不存在的文件、值被 `#` 静默吞掉半行）都不会让任何几何
// 门禁报警，但会让「编号可查」这件事悄悄失效——而那正是删档当天不炸的唯一保障。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { findUnquotedInlineComments } from '../../scripts/verify/yaml/inline-comment-utils.js';

const KNOWLEDGE = 'config/decision-knowledge.yaml';
const DECISIONS_DIR = 'docs/decisions';
const FACTS = 'config/facts.yaml';
const LEDGER = 'docs/pending-site-data.md';

interface KnowledgeEntry {
  id: string;
  kind: string;
  subject: string;
  knowledge: string;
  landing?: string[];
  owner?: string;
  fails_if?: string;
  [key: string]: unknown;
}

interface RetiredEntry {
  id: string;
  subject: string;
  status: string;
  superseded_by: string | null;
  record: string;
  landing: string[];
  [key: string]: unknown;
}

const source = readFileSync(KNOWLEDGE, 'utf8');
const doc = parseYaml(source) as { version?: number; entries?: KnowledgeEntry[]; retired?: RetiredEntry[] };
const entries: KnowledgeEntry[] = doc.entries ?? [];
const retired: RetiredEntry[] = doc.retired ?? [];
const allEntries = [...entries, ...retired];

// ── 标题实测集合（与 facts.yaml c.dec_unique 同源口径：`### DEC-` 标题，含 -补/-补记/.1/.2 补充号族）───
// 后缀整体可选：`DEC-2026-10-13 批次说明：…` 是仓里唯一没有序号/轮次后缀的标题（06-electrical.md:335）。
const TITLE_RE = /^###\s*(DEC-\d{4}-\d{2}-\d{2}(?:-[A-Za-z0-9.\-\u4e00-\u9fff]+)?)/;
function decisionTitles(): { id: string; file: string }[] {
  if (!existsSync(DECISIONS_DIR)) return [];
  const out: { id: string; file: string }[] = [];
  for (const file of readdirSync(DECISIONS_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    for (const line of readFileSync(join(DECISIONS_DIR, file), 'utf8').split('\n')) {
      const m = line.match(TITLE_RE);
      if (m) out.push({ id: m[1], file });
    }
  }
  return out;
}

const titles = decisionTitles();
const titleIds = new Set(titles.map((t) => t.id));
const knowledgeIds = new Set(allEntries.map((e) => e.id));

// ── ① 钩子 1：id 覆盖对账 ───────────────────────────────────────────────────
test('钩子 1：知识载体 id 集合与 docs/decisions 标题实测集合差集为 0', () => {
  if (!titles.length) {
    // S3 删档后的形态：原档案已不存在，本文件成为编号的唯一在册载体。此时不要求「差集为 0」
    // （集合已空），但要求本文件自身完整、编号形态合法——真墓碑核对由 git 历史 + record 字段承接。
    assert.ok(allEntries.length > 0, 'docs/decisions 已删档，decision-knowledge.yaml 必须仍是编号的在册载体');
    for (const e of allEntries) assert.match(e.id, /^DEC-\d{4}-\d{2}-\d{2}-[A-Za-z0-9.\-\u4e00-\u9fff]+$/, `${e.id} 编号形态非法`);
    return;
  }
  const missing = [...titleIds].filter((id) => !knowledgeIds.has(id));
  assert.deepEqual(missing, [], `知识载体漏登记的 DEC 标题（差集必须为 0）：${missing.join(', ')}`);
  // 多出来的 id 只允许来自标题实测集合之外的历史形态（例：标题被改名/合并），逐条列出来人工看，
  // 不允许静默多登记——多登记等于给不存在的编号一个「可解析」的假象。
  const extra = [...knowledgeIds].filter((id) => !titleIds.has(id));
  assert.deepEqual(extra, [], `知识载体多出、docs/decisions 里没有对应标题的 id：${extra.join(', ')}`);
});

// ── ② 唯一性（无重号；-补 族补充号不判重） ─────────────────────────────────
test('唯一性：id 无重号，-补/-补记/.n 补充号族不构成重号', () => {
  const seen = new Map<string, number>();
  for (const e of allEntries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
  assert.deepEqual(dups, [], `重号：${dups.join(', ')}`);

  const SUPPLEMENT = /(-补\d*|-补记.+|\.\d+)$/;
  const baseOf = (id: string) => id.replace(SUPPLEMENT, '');
  const byBase = new Map<string, string[]>();
  for (const e of allEntries) (byBase.get(baseOf(e.id)) ?? byBase.set(baseOf(e.id), []).get(baseOf(e.id))!).push(e.id);
  const badBase: string[] = [];
  for (const [base, ids] of byBase) {
    const plain = ids.filter((id) => !SUPPLEMENT.test(id));
    if (plain.length > 1) badBase.push(`${base} 有 ${plain.length} 条正牌：${plain.join('、')}`);
  }
  assert.deepEqual(badBase, [], `同一 base 多条正牌（补充号族只许一条正牌）：${badBase.join('；')}`);
});

// ── ③ entries 段：只收真·不可再生的知识 ───────────────────────────────────
const KINDS = new Set([
  'contract',              // 合同/成交语义
  'competitor_elimination', // 竞品为何淘汰
  'quote_card_mechanism',   // 报价卡机制口径
  'owner_verbal',           // 业主原话/口头规格/实地断言
  'silent_failure',         // 静默失效分析
  'design_caliber',         // 设计口径与推翻关系
  'gate_mechanism',         // 门禁机制的存在理由
  'process',                // 流程/纪律
]);

test('entries 段：kind 合法、knowledge 非空且不是标题复述、规模在 30–60 条', () => {
  // 规模上限是业主裁定②的机器化：「预期这个文件收到 30-60 条，不是 292 条」——entries 段只收
  // 真·不可再生的知识，其余走墓碑。超上限说明又把可以散回对象/报价卡/门禁的内容搬回来了。
  assert.ok(entries.length >= 30, `entries 只有 ${entries.length} 条——低于 30 条下限，疑似漏收不可再生知识`);
  assert.ok(entries.length <= 60, `entries 有 ${entries.length} 条——超过 60 条上限（业主裁定②：不是 292 条）`);
  const bad: string[] = [];
  for (const e of entries) {
    if (!KINDS.has(e.kind)) bad.push(`${e.id} kind「${e.kind}」不在词表内`);
    if (!e.subject || !e.subject.trim()) bad.push(`${e.id} subject 为空`);
    if (!e.knowledge || e.knowledge.trim().length === 0) { bad.push(`${e.id} knowledge 为空`); continue; }
    if (e.knowledge.trim() === e.subject.trim()) { bad.push(`${e.id} knowledge 与 subject 完全相同（纯标题复述）`); continue; }
    if (e.knowledge.length <= e.subject.length) bad.push(`${e.id} knowledge(${e.knowledge.length}) 未超过 subject(${e.subject.length})`);
  }
  assert.deepEqual(bad, [], `entries 未达最低内容要求：${bad.join('；')}`);
});

// ── ④ landing 词表 + 指向真实性（「逐条列出去了哪」的机器版）──────────────────
const LANDING_VOCAB = new Set(['git', 'object', 'code', 'quote-card', 'gate', 'agents', 'ledger', 'knowledge']);

test('landing 词表合法，且路径型/台账型词元指向的东西真实存在', () => {
  const ledger = readFileSync(LEDGER, 'utf8');
  const ledgerIds = new Set([...ledger.matchAll(/^\|\s*(\d+[a-z]?)\s*\|/gm)].map((m) => m[1]));
  const bad: string[] = [];
  for (const e of allEntries) {
    const tokens = e.landing ?? [];
    if (e.landing !== undefined && !Array.isArray(e.landing)) { bad.push(`${e.id} landing 不是数组`); continue; }
    for (const token of tokens) {
      const [kind, target] = token.split(':');
      if (!LANDING_VOCAB.has(kind)) { bad.push(`${e.id} landing 词元「${token}」的词头不在词表内`); continue; }
      if (kind === 'ledger') {
        const n = (target ?? '').replace(/^#/, '');
        if (!ledgerIds.has(n)) bad.push(`${e.id} landing 指向不存在的台账编号：${token}`);
        continue;
      }
      if (target && !existsSync(target)) bad.push(`${e.id} landing 指向不存在的路径：${token}`);
      if (kind === 'knowledge' && !knowledgeIds.has(target ?? '')) bad.push(`${e.id} landing 指向不存在的知识条目：${token}`);
    }
    // retired 段每条都必须有 git 兜底：DEC 正文（论证/证据口径）随 git 历史退场，这是墓碑的 base 承诺。
    // entries 段不要求——它的知识就住在本文件里，git 只是补充而非兜底。
    const isRetired = retired.includes(e as unknown as RetiredEntry);
    if (isRetired && !tokens.includes('git')) bad.push(`${e.id} landing 缺 git 兜底——正文即 git 历史，必须显形`);
  }
  assert.deepEqual(bad, [], `landing 腐烂：${bad.join('；')}`);
});

// ── ⑤ retired 段：墓碑形态完整 ────────────────────────────────────────────
test('retired 段：墓碑字段齐全、status 合法、superseded 必带取代者、record 是仓内定位', () => {
  const allowed = new Set(['active', 'superseded', 'archived', 'retired']);
  const bad: string[] = [];
  for (const e of retired) {
    if (!allowed.has(e.status)) bad.push(`${e.id} status「${e.status}」不在取值表内`);
    if (e.status === 'superseded' && !e.superseded_by) bad.push(`${e.id} 判为 superseded 却没写 superseded_by——读者无法知道取代者是谁`);
    if (e.superseded_by) {
      assert.ok(knowledgeIds.has(e.superseded_by), `${e.id} 的 superseded_by「${e.superseded_by}」不在册——取代边指向不存在的 id`);
      assert.notEqual(e.superseded_by, e.id, `${e.id} 的 superseded_by 指向自己`);
    }
    if (!e.subject || !e.subject.trim()) bad.push(`${e.id} subject 为空——墓碑必须能让人认出这条是什么`);
    if (!e.record || !e.record.trim()) { bad.push(`${e.id} record 为空——原文在 git 历史里的定位必须显形`); continue; }
    // record 指向 docs/decisions/ 的文件+行：档案还在时必须真实存在（S3 删档后由 git show 承接）。
    if (titles.length) {
      const base = e.record.split('#')[0];
      if (!existsSync(base)) bad.push(`${e.id} record 路径不存在：${e.record}`);
    }
  }
  assert.deepEqual(bad, [], `墓碑形态不合格：${bad.join('；')}`);
  // 取代边必须真的存在（否则 status 表是空转的）。
  const withSuperseder = retired.filter((e) => e.superseded_by).length + entries.filter((e) => false).length;
  assert.ok(withSuperseder > 0, 'retired 段里没有任何取代边——C 轨 168 对边的结构化沉淀丢失');
});

// ── ⑥ YAML 铁律 7：值内含 `#` 必须已加引号 ─────────────────────────────────
test('YAML 铁律 7：值内含 # 已加引号（引擎同口径扫描 + 解析层无静默吞值）', () => {
  const issues = findUnquotedInlineComments(source);
  assert.deepEqual(issues.map((i) => `${KNOWLEDGE}:${i.line} ${i.comment}`), [],
    'decision-knowledge.yaml 里有未加引号的裸 # token——js-yaml 会把它后半行吞成注释（AGENTS.md 铁律 7）');

  const HASH_TOKEN = /#[0-9A-Za-z]+/g;
  const blocks = source.split(/\n(?=  - id: )/).filter((b) => b.startsWith('  - id:'));
  assert.equal(blocks.length, allEntries.length, '原始条目块数与解析出的条目数不一致');
  for (const [i, block] of blocks.entries()) {
    const e = allEntries[i];
    const flat = [e.id, e.subject, ...(typeof e.knowledge === 'string' ? [e.knowledge] : []),
      ...(e.landing ?? []), ...(typeof e.fails_if === 'string' ? [e.fails_if] : []),
      ...(typeof e.owner === 'string' ? [e.owner] : []), e.record ?? ''].join('\n');
    for (const token of block.match(HASH_TOKEN) ?? []) {
      if (token === '#L') continue; // `文件#L行` 定位后缀，不是编号
      assert.ok(flat.includes(token), `${e.id}：原始文本里的 ${token} 没进到任何字段——YAML 引号把它吞了`);
    }
  }
});

// ── ⑦ facts.yaml 侧接线：coverage 登记 + decision_log_files 改切 ────────────
test('facts.yaml 接线：知识载体进了 coverage 矩阵且读者真实存在；decision_log_files 指向它', () => {
  const facts = parseYaml(readFileSync(FACTS, 'utf8')) as {
    coverage?: Array<{ file: string; field?: string; fields?: string[]; readers?: string[] }>;
    decision_log_files?: string[];
  };
  for (const field of ['entries', 'retired']) {
    const cov = (facts.coverage ?? []).find((c) => c.file === KNOWLEDGE && c.field === field);
    assert.ok(cov, `${KNOWLEDGE} 的 ${field} 未登记进 facts.yaml coverage 矩阵——新增 config 文件必须登记（否则 field_uncovered）`);
    const readers = cov.readers ?? [];
    assert.ok(readers.length > 0, `${field} 的 coverage readers 为空——「读者真实性」自证明失效`);
    for (const r of readers) {
      assert.ok(existsSync(r), `coverage 登记的 reader ${r} 不存在（declared_reader_does_not_read）`);
      const text = readFileSync(r, 'utf8');
      assert.ok(new RegExp(`\\b${field}\\b`).test(text), `reader ${r} 里没有 ${field} 字段名——覆盖矩阵说谎`);
    }
  }
  // decision_log_files：repair_channel.decision_ref 存在性校验的靶（S2 从 docs/decisions/ 改指本文件）。
  const logFiles = facts.decision_log_files ?? [];
  assert.deepEqual(logFiles, [KNOWLEDGE], `decision_log_files 应指向 ${KNOWLEDGE}，实际：${logFiles.join(', ')}`);
  for (const f of logFiles) assert.ok(existsSync(f), `decision_log_files 里的 ${f} 不存在`);

  // S2 删除的治理设施必须真的不在了（先立后删：契约先改指新靶，旧锚点才删）。
  // 注释里可以留「删了什么」的说明（决策铁律第 5 条），故只查**定义行**，不查任何提及。
  const raw = readFileSync(FACTS, 'utf8');
  const defined = raw.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.ok(!/^\s*x_decision_files\s*:/m.test(defined), 'facts.yaml 仍定义 x_decision_files——S2 应随 target 改切一并删除');
  assert.ok(!/id:\s*c\.dec045_subject_pending_adjudication/.test(defined),
    'facts.yaml 仍有 c.dec045_subject_pending_adjudication 契约定义——悬案已迁 pending #78，哨兵应删');
});

// ── ⑧ 登记簿已删（业主裁定②：S1 的 decision-registry.yaml 拆完即删）──────────
test('登记簿已删除：config/decision-registry.yaml 不存在（原料拆完即退场）', () => {
  assert.ok(!existsSync('config/decision-registry.yaml'),
    'config/decision-registry.yaml 仍在——它是 S2 的原料，拆完即删，不作为常设设施');
  assert.ok(!existsSync('tests/server/decision-registry.test.ts'),
    'tests/server/decision-registry.test.ts 仍在——其断言对象已删，应随本文件一同退场');
});
