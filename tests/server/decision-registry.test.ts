// tests/server/decision-registry.test.ts
// DEC 决策登记簿（config/decision-registry.yaml，issue #98 第六阶段 S1 新建）的自检。
//
// 这个文件是登记簿的**机器校验器**，对应设计文档 §2.5 的对账钩子：
//   钩子 1 id 覆盖对账 —— 登记簿 id 集合 vs docs/decisions/ 标题实测集合，差集必须为 0
//                       （S3 删档后差集由墓碑承接，见下方「删档后」分支）；
//   钩子 4 登记簿自检   —— js-yaml 加载逐条目断言 + 值内含 `#` 已加引号（AGENTS.md 铁律 7）。
// 另固化了三项人工抽核结论（status 表 / intent 最低内容 / pending 指针真实性），
// 以及 facts.yaml 侧的两项 S1 接线（coverage 登记 + decision_log_files）。
//
// 为什么这些断言值得钉死：登记簿是 1,925 处 DEC 编号的新家，字段漂移（漏条目、重号、
// status 与 superseded_by 不一致、值被 `#` 静默吞掉半行）都不会让任何几何门禁报警，
// 但会让「编号可查」这件事悄悄失效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { findUnquotedInlineComments } from '../../scripts/verify/yaml/inline-comment-utils.js';

const REGISTRY = 'config/decision-registry.yaml';
const DECISIONS_DIR = 'docs/decisions';
const FACTS = 'config/facts.yaml';
const LEDGER = 'docs/pending-site-data.md';

interface RegistryEntry {
  id: string;
  subject: string;
  status: string;
  superseded_by: string | null;
  intent: string;
  evidence: string[];
  pending: string[];
  retired_commit: string | null;
  [key: string]: unknown;
}

const source = readFileSync(REGISTRY, 'utf8');
const doc = parseYaml(source) as { entries?: RegistryEntry[] };
const entries: RegistryEntry[] = doc.entries ?? [];

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
const registryIds = new Set(entries.map((e) => e.id));

// ── ① 钩子 1：id 覆盖对账 ───────────────────────────────────────────────────
test('钩子 1：登记簿 id 集合与 docs/decisions 标题实测集合差集为 0', () => {
  if (!titles.length) {
    // S3 删档后的形态：原档案已不存在，登记簿成为编号的唯一在册载体。
    // 此时不要求「差集为 0」（集合已空），但要求登记簿本身完整、编号形态合法——
    // 真墓碑核对由 docs/README.md 退场墓碑表 + 登记簿 retired_commit 承担。
    assert.ok(entries.length > 0, 'docs/decisions 已删档，登记簿必须仍是编号的在册载体');
    for (const e of entries) assert.match(e.id, /^DEC-\d{4}-\d{2}-\d{2}-[A-Za-z0-9.\-]+$/, `${e.id} 编号形态非法`);
    return;
  }
  const missing = [...titleIds].filter((id) => !registryIds.has(id));
  const extra = [...registryIds].filter((id) => !titleIds.has(id));
  assert.deepEqual(missing, [], `登记簿漏登记的 DEC 标题（差集必须为 0 或在墓碑表有行）：${missing.join(', ')}`);
  assert.deepEqual(extra, [], `登记簿多出、docs/decisions 里没有对应标题的 id：${extra.join(', ')}`);
  // 条目数 = 标题数：防「解析静默截断」（少几条也能让集合差集为 0 的相反情形是整块丢失）。
  assert.equal(entries.length, titles.length, `登记簿 ${entries.length} 条 ≠ 标题实测 ${titles.length} 条`);
});

// ── ② 唯一性（无重号；-补 族补充号不判重） ─────────────────────────────────
test('唯一性：id 无重号，-补/-补记/.n 补充号族不构成重号', () => {
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
  assert.deepEqual(dups, [], `重号：${dups.join(', ')}`);

  // 补充号族：同一 base 下只允许一条「正牌」+ 若干补充号（与 facts.yaml c.dec_unique 的
  // allow_suffix: ['-补','-补2','-补3','.1','.2','.3'] 同纪律）。
  const SUPPLEMENT = /(-补\d*|-补记.+|\.\d+)$/;
  const baseOf = (id: string) => id.replace(SUPPLEMENT, '');
  const byBase = new Map<string, string[]>();
  for (const e of entries) (byBase.get(baseOf(e.id)) ?? byBase.set(baseOf(e.id), []).get(baseOf(e.id))!).push(e.id);
  const badBase: string[] = [];
  for (const [base, ids] of byBase) {
    const plain = ids.filter((id) => !SUPPLEMENT.test(id));
    if (plain.length > 1) badBase.push(`${base} 有 ${plain.length} 条正牌：${plain.join('、')}`);
  }
  assert.deepEqual(badBase, [], `同一 base 多条正牌（补充号族只许一条正牌）：${badBase.join('；')}`);
});

// ── ③ status 取值合法 + superseded 必须带 superseded_by ─────────────────────
test('status 合法：superseded 必带 superseded_by，且取代者本身是登记簿条目', () => {
  const allowed = new Set(['active', 'superseded', 'retired', 'archived', '待实测']);
  const counts: Record<string, number> = {};
  for (const e of entries) {
    counts[e.status] = (counts[e.status] ?? 0) + 1;
    assert.ok(allowed.has(e.status), `${e.id} status「${e.status}」不在取值表内（active/superseded/retired/archived/待实测）`);
    if (e.status === 'superseded') {
      assert.ok(e.superseded_by, `${e.id} 判为 superseded 却没写 superseded_by——读者无法知道取代者是谁`);
    }
    if (e.superseded_by) {
      assert.ok(['superseded', 'archived', 'retired'].includes(e.status),
        `${e.id} status=${e.status} 却写了 superseded_by=${e.superseded_by}——仍活跃/待实测的条目不许指名取代者`);
      assert.ok(registryIds.has(e.superseded_by), `${e.id} 的 superseded_by「${e.superseded_by}」不是登记簿条目——取代边指向不存在的 id`);
      assert.notEqual(e.superseded_by, e.id, `${e.id} 的 superseded_by 指向自己`);
    }
    // S1 是「先立替代」切片：不许预填 retired_commit（那属于 S3 删档动作）。
    assert.equal(e.retired_commit, null, `${e.id} 的 retired_commit 非 null——S1 未删任何 DEC，该字段只能由 S3 填`);
  }
  // 结构形态留痕：取代边必须真的存在（否则 status 表是空转的）。
  const withSuperseder = entries.filter((e) => e.superseded_by).length;
  assert.ok(withSuperseder > 0, '登记簿里没有任何取代边——§5-S1 要求把 C 轨取代边结构化沉淀');
});

// ── ④ intent 最低内容（§2.2-T1）：非空、不是标题复述 ────────────────────────
test('intent 最低内容：active/superseded 条目 intent 非空且长于 subject（不是标题复述）', () => {
  const bad: string[] = [];
  for (const e of entries) {
    if (!['active', 'superseded'].includes(e.status)) continue;
    if (!e.intent || e.intent.trim().length === 0) { bad.push(`${e.id} intent 为空`); continue; }
    if (e.intent.trim() === e.subject.trim()) { bad.push(`${e.id} intent 与 subject 完全相同（纯标题复述）`); continue; }
    if (e.intent.length <= e.subject.length) { bad.push(`${e.id} intent(${e.intent.length}) 未超过 subject(${e.subject.length})`); continue; }
  }
  assert.deepEqual(bad, [], `intent 未达 T1 最低内容：${bad.join('；')}`);
});

// ── ④b 开放项迁移（停止条件 1 的机器版）：DEC 正文里的开放项必须在登记簿里显形 ──
// 业主裁定「不裸删」最难机器化的一条：摘要写不全，pending/失效条件就只存在于 git 历史。
// 判据：正文含开放项信号（失效/反转/待核/量房/遗留/X 不工作时/owner/trigger…）的条目，
// 其 intent 必须承载其中至少一条（标签名或正文前 12 字可辨），或已挂 pending 台账编号。
const OPEN_LINE = /失效|反转|待核|待SKU|待定|待业主|待现场|量房|待实测|遗留|下一步|卡在|owner|trigger|X ?不工作时|blocked|未决|待确认|悬案|待补|待供应商|待厂家|待门店|待选样|待官方|待销售|待核实/;
const LINE_LABEL = /^\s*(?:[-*]\s*|\d+\.\s*)?\*\*(.+?)\*\*[^：:]{0,12}[：:]\s*(.*)$/;
const plain = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '')
  .replace(/^\s*(?:[-*]\s*|\d+\.\s*)/, '').replace(/^[：:，,、；;。\s]+/, '').replace(/\s+/g, ' ').trim();

function bodyOf(titleFile: string, id: string): string {
  const lines = readFileSync(join(DECISIONS_DIR, titleFile), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(`### ${id} `) || l.trim() === `### ${id}`);
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{2,3} /.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

test('开放项迁移：DEC 正文带开放项的条目，intent 或 pending 必须承载它（不许抹掉 pending）', () => {
  const dropped: string[] = [];
  for (const e of entries) {
    if (!['active', 'superseded'].includes(e.status)) continue;
    const title = titles.find((t) => t.id === e.id);
    if (!title) continue;
    const openLines = bodyOf(title.file, e.id).split('\n')
      .filter((l) => OPEN_LINE.test(l) && !/^\s*(?:[-*]\s*)?\*\*(?:验证|关联文件|决策人|编号说明|日期)/.test(l));
    if (!openLines.length) continue;
    const carried = openLines.some((l) => {
      const m = l.match(LINE_LABEL);
      const label = m ? plain(m[1]) : '';
      const bare = m ? plain(m[2]) : plain(l);
      return (label.length > 0 && e.intent.includes(label)) || (bare.length >= 12 && e.intent.includes(bare.slice(0, 12)));
    });
    if (!carried && !(e.pending ?? []).length) dropped.push(`${e.id}（${plain(openLines[0]).slice(0, 40)}…）`);
  }
  assert.deepEqual(dropped, [], `这些条目的开放项在登记簿里无处安放（停止条件 1）：${dropped.join('；')}`);
});

// ── ④b 人工抽核固化：抽样条目必须包含人工核对过的关键内容 ──────────────────
// 机器判据（长度/信号词）证不了「摘录对不对」。这里把抽样人工核对结论钉成断言：
// 每条都读过 DEC 正文，关键字是正文里真实存在的裁定/失效条件/owner。
const SAMPLES: Array<{ id: string; must: RegExp; why: string }> = [
  { id: 'DEC-2026-10-06-R5', must: /降板空腔|分层标高/, why: '#41 裁定主口径：管线分层升入降板空腔' },
  { id: 'DEC-2026-10-06-R5', must: /触发/, why: 'T1：触发（业主确认吊顶遮盖管线口径）必须显形' },
  { id: 'DEC-2026-08-21-039', must: /推翻 DEC-035~038/, why: '该条是 035~038 的取代者，取代边必须在 intent 里可读' },
  { id: 'DEC-2026-11-05-R5', must: /抽屉|仓区/, why: '客卫机器人仓「仓+抽屉」定案主裁定' },
  { id: 'DEC-2026-11-04-R4', must: /口头规格|台盆下开放格/, why: '仓位图由业主口头规格取代' },
  { id: 'DEC-2026-10-17-R20', must: /X 不工作时|待核|pending/, why: '带 owner/触发 的开放项必须显形（T1）' },
  { id: 'DEC-2026-10-09-E01', must: /undeclared|派生|ElementState/, why: 'element-state 机制裁定主口径' },
  { id: 'DEC-2026-10-04-R1', must: /36,000 元|转录级|待核/, why: '合同成交额 + 转录级证据限定（停止条件 1：不许抹掉证据等级）' },
  { id: 'DEC-2026-09-09-R6', must: /部分覆盖/, why: '该条仅部分子结论被 11-03-R1/11-04-R3 覆盖，须显形（设计 A4）' },
  { id: 'DEC-2026-10-08-R05', must: /凹弧|垂面弧全拆/, why: '东南角终裁口径' },
  { id: 'DEC-2026-07-03-001', must: /Git|YAML/, why: '最早一条 DEC：项目控制框架（旧式模板体也要给出裁定句）' },
  { id: 'DEC-2026-10-09-P12', must: /设备平台|走廊/, why: '业主一句话裁定也要连触发带出' },
];
test('抽样人工核对：12 条抽样条目包含人工读过的关键内容', () => {
  for (const s of SAMPLES) {
    const e = entries.find((x) => x.id === s.id);
    assert.ok(e, `抽样条目 ${s.id} 不在登记簿里`);
    assert.match(e.intent, s.must, `${s.id} 抽样核对失败（${s.why}）：intent=${e.intent.slice(0, 120)}`);
  }
});

// ── ⑤ YAML 铁律 7：值内含 `#` 必须已加引号 ─────────────────────────────────
test('YAML 铁律 7：值内含 # 已加引号（引擎同口径扫描 + 解析层无静默吞值）', () => {
  // 与 scripts/verify/yaml/verify-inline-comments.ts（verify:yaml-hash）完全同一实现：
  // 未加引号、紧跟内容的裸 `#` token 一律报错。
  const issues = findUnquotedInlineComments(source);
  assert.deepEqual(issues.map((i) => `${REGISTRY}:${i.line} ${i.comment}`), [],
    '登记簿里有未加引号的裸 # token——js-yaml 会把它后半行吞成注释（AGENTS.md 铁律 7）');

  // 解析层：原始文本里每个 `#编号` 都必须活着进到某个字符串字段里（防止「加引号加错位置」）。
  const HASH_TOKEN = /#[0-9A-Za-z]+/g;
  const blocks = source.split(/\n(?=  - id: )/).filter((b) => b.startsWith('  - id:'));
  assert.equal(blocks.length, entries.length, '原始条目块数与解析出的条目数不一致');
  for (const [i, block] of blocks.entries()) {
    const e = entries[i];
    const flat = [e.id, e.subject, e.intent, ...e.evidence, ...e.pending].join('\n');
    for (const token of block.match(HASH_TOKEN) ?? []) {
      if (token === '#L') continue; // `文件#L行` 定位后缀，不是编号
      assert.ok(flat.includes(token), `${e.id}：原始文本里的 ${token} 没进到任何字段——YAML 引号把它吞了`);
    }
  }
});

// ── ⑥ evidence / pending 指针必须真实存在 ──────────────────────────────────
test('evidence 与 pending 指针有效：路径在仓内、台账编号真实存在', () => {
  const ledger = readFileSync(LEDGER, 'utf8');
  const ledgerIds = new Set([...ledger.matchAll(/^\|\s*(\d+[a-z]?)\s*\|/gm)].map((m) => `#${m[1]}`));
  const bad: string[] = [];
  for (const e of entries) {
    assert.ok(Array.isArray(e.evidence) && e.evidence.length > 0, `${e.id} 没有 evidence 指针——「不裸删」要求每条裁定可回溯到凭证`);
    for (const p of e.evidence) {
      const base = p.split('#')[0];
      if (!existsSync(base) || statSync(base).isDirectory()) bad.push(`${e.id} evidence 路径不存在：${p}`);
    }
    for (const p of e.pending ?? []) {
      const m = p.match(/^docs\/pending-site-data\.md(#\d+[a-z]?)$/);
      if (!m) { bad.push(`${e.id} pending 指针形态不符：${p}`); continue; }
      if (!ledgerIds.has(m[1])) bad.push(`${e.id} pending 指向不存在的台账编号：${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], `指针腐烂：${bad.join('；')}`);
});

// ── ⑦ facts.yaml 侧两项 S1 接线：coverage 登记 + decision_log_files ─────────
test('facts.yaml 接线：登记簿进了 coverage 矩阵且读者真实存在；decision_log_files 已登记', () => {
  const facts = parseYaml(readFileSync(FACTS, 'utf8')) as {
    coverage?: Array<{ file: string; field?: string; fields?: string[]; readers?: string[] }>;
    decision_log_files?: string[];
  };
  const cov = (facts.coverage ?? []).find((c) => c.file === REGISTRY);
  assert.ok(cov, 'config/decision-registry.yaml 未登记进 facts.yaml coverage 矩阵——新增 config 文件必须登记（否则 field_uncovered）');
  const fields = [...(cov.field ? [cov.field] : []), ...(cov.fields ?? [])];
  assert.ok(fields.includes('entries'), `coverage 登记字段 ${fields.join('/')} 不含 entries`);
  const readers = cov.readers ?? [];
  assert.ok(readers.length > 0, 'coverage 登记的 readers 为空——「读者真实性」自证明失效');
  for (const r of readers) {
    assert.ok(existsSync(r), `coverage 登记的 reader ${r} 不存在（declared_reader_does_not_read）`);
    assert.ok(readFileSync(r, 'utf8').includes('entries'), `reader ${r} 里没有 entries 字段名——覆盖矩阵说谎`);
  }
  // decision_log_files：repair_channel.decision_ref 存在性校验的靶（S1 让它从「跳过」变成真跑）。
  const logFiles = facts.decision_log_files ?? [];
  assert.ok(logFiles.length > 0, 'facts.yaml 未登记 decision_log_files——repair_channel 存在性校验仍会被跳过（只打 INFO）');
  for (const f of logFiles) assert.ok(existsSync(f), `decision_log_files 里的 ${f} 不存在`);
});
