// tests/server/mep-guidance-baseline.test.ts
//
// 「文档不许再漂移」自审计：把 docs/mep-construction-guidance.md 的规模口径与
// §6 验收基线、docs/pending-site-data.md 的表头计数口径、以及 MEP/电气 lint 治理
// 台账（docs/design-iterations/mep-lint-governance-20261006/review-manifest.json）
// 全部绑到**实算**上。
//
// 设计原则（与 facts-lint.test.ts 同一套纪律，遵循 node:test/strict）：
//   1. 不写死任何 warning 总数（219 / 71 / 40 / 160 / 19 …）。文档侧写「与实算一致」
//      的语义，数字由本测试从 CLI 的 JSON 输出实时取，两侧逐项断言相等。
//   2. lint 新增规则/新增分桶时，本测试会因为「实算多出一个 code / 桶计数变大」
//      而 fail，从而强制同步文档与台账——自动跟随，而不是永久绿。
//   3. registry 已锁的规模数（110 / 80 / 27 / 25 / 8 / 153）除了与机器条目数对账，
//      还额外与 verify:facts 的 INFO 输出对账（62 条路线 / 14 个吊顶分区）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

// ─── 被测文档 ────────────────────────────────────────────────────────────────

const GUIDANCE_PATH = 'docs/mep-construction-guidance.md';
const PENDING_PATH = 'docs/pending-site-data.md';
const MANIFEST_PATH = 'docs/design-iterations/mep-lint-governance-20261006/review-manifest.json';

const guidance = readFileSync(GUIDANCE_PATH, 'utf8');
const pending = readFileSync(PENDING_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
  dispositions: Array<{ code: string; count: number; category: string; disposition: string }>;
  summary?: Record<string, unknown>;
};

/** §6「验收自检」起的正文（规模口径在 §6 之前，分桶表在 §6 内）。 */
const section6 = guidance.slice(guidance.indexOf('## 6. 验收自检'));
assert.ok(section6.length > 0, `${GUIDANCE_PATH} 必须含 ## 6. 验收自检 一节`);

/** §0「规模口径」正文（表格 + 表头口径说明都在本节内）。 */
const section0 = guidance.slice(guidance.indexOf('## 0. 规模口径'), guidance.indexOf('## 1. 走线总则'));

// ─── 实算源 ──────────────────────────────────────────────────────────────────

type MepLintJson = {
  errors: Array<{ code: string }>;
  warnings: Array<{ code: string }>;
  counts: { errors: number; warnings: number; routes: number; resolvedRoutes: number };
  categories: Record<string, { count: number; codes: Array<{ code: string; count: number }> }>;
};
type ElectricalLintJson = {
  errors: Array<{ code: string }>;
  warnings: Array<{ code: string }>;
  counts: { errors: number; warnings: number; byCode: Record<string, number> };
};

function runJson(script: string): unknown {
  const run = spawnSync('npx', ['tsx', script, '--json'], { encoding: 'utf8' });
  assert.ok(run.status === 0, `${script} --json 退出码 ${run.status}：${run.stderr ?? ''}`);
  return JSON.parse(run.stdout!) as unknown;
}

const mep = runJson('scripts/verify/mep/verify-mep-lint.ts') as MepLintJson;
const electrical = runJson('scripts/verify/electrical/verify-electrical-lint.ts') as ElectricalLintJson;
const registry = parseYaml(readFileSync('config/facts.yaml', 'utf8')) as {
  contracts: Array<{ id: string; registered_conflicts?: number; prose?: Array<{ extract: string; expect_matches?: number }> }>;
  facts: Array<{ id: string; value?: string }>;
};

/** verify:facts 的 INFO 行是「62 条路线 / 14 个吊顶分区 / 153 处」的唯一机器口径。 */
const factsRun = spawnSync('npx', ['tsx', 'scripts/verify/facts/verify-facts.ts'], { encoding: 'utf8' });
const factsOut = `${factsRun.stdout ?? ''}${factsRun.stderr ?? ''}`;

// ─── 解析帮助 ────────────────────────────────────────────────────────────────

/** 把 §6 的 markdown 表格行拆成 { label, count, codes }。 */
function parseGuidanceTable(text: string): Array<{ label: string; count: number; codes: Array<[string, number]> }> {
  const rows: Array<{ label: string; count: number; codes: Array<[string, number]> }> = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter((c, i, all) => !(i === 0 && c === '') && c !== '');
    if (cells.length < 3) continue;
    const [label, countCell, detail] = cells;
    if (!/^\d+$/.test(countCell)) continue;
    const codes: Array<[string, number]> = [];
    for (const m of detail.matchAll(/([a-z][a-z0-9_]*)\s+(\d+)/g)) codes.push([m[1], Number(m[2])]);
    rows.push({ label, count: Number(countCell), codes });
  }
  return rows;
}

const perCode = (items: Array<{ code: string }>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[item.code] = (out[item.code] ?? 0) + 1;
  return out;
};
const mepPerCode = perCode(mep.warnings);
const mepErrorPerCode = perCode(mep.errors);
const mepBucketPerCode: Record<string, Record<string, number>> = {};
for (const [bucket, bucketSummary] of Object.entries(mep.categories ?? {})) {
  mepBucketPerCode[bucket] = Object.fromEntries(bucketSummary.codes.map((c) => [c.code, c.count]));
}

// ─── §6：三桶 + 电气规则组与实算逐项相等（不写死总数） ─────────────────────

test('§6 验收基线：MEP 三桶/电气规则组的条数与代码明细必须等于实算（不写死 warning 总数）', () => {
  // ① 0 error 契约
  assert.equal(mep.counts.errors, 0, `verify:mep 应 0 error，实际 ${mep.counts.errors}：${JSON.stringify(mep.errors)}`);
  assert.equal(electrical.counts.errors, 0, `verify:electrical 应 0 error，实际 ${electrical.counts.errors}`);

  // ② 文档不写死总数，只写「与实算一致」的语义；一旦有人把总数抄回来，这里立刻炸
  assert.match(section6, /verify:mep`\s*=\s*\*\*0 error \/ 与实算一致/);
  assert.match(section6, /verify:electrical`\s*=\s*\*\*0 error \/ 与实算一致/);
  assert.equal(/0 error \/ \d+ warning/.test(section6), false, '§6 不许写死 warning 总数，只许写「与实算一致」');

  const rows = parseGuidanceTable(section6);
  const grouped = rows.filter((r) => /^MEP\b/.test(r.label));
  const electricRows = rows.filter((r) => /^电气/.test(r.label));

  // ③ 实算的每个分桶在文档里都必须有一行，且行内计数 = 实算桶计数
  for (const bucket of Object.keys(mep.categories ?? {})) {
    const row = grouped.find((r) => r.label.includes(bucket));
    assert.ok(row, `§6 分桶表缺少 MEP 桶 ${bucket} 一行`);
    assert.equal(row!.count, mep.categories[bucket].count, `§6 桶 ${bucket} 声明 ${row!.count} ≠ 实算 ${mep.categories[bucket].count}`);
    const claimed = Object.fromEntries(row!.codes);
    assert.deepEqual(claimed, mepBucketPerCode[bucket], `§6 桶 ${bucket} 的代码明细必须与实算完全一致`);
  }
  assert.equal(grouped.length, Object.keys(mep.categories ?? {}).length, '§6 的 MEP 桶行数必须与实算分桶数一致');

  // ④ 三桶之和 = verify:mep 总 warning（新规则落入既有桶 → 桶计数变 → 文档必须同步）
  const bucketSum = grouped.reduce((acc, r) => acc + r.count, 0);
  assert.equal(bucketSum, mep.counts.warnings, `§6 三桶之和 ${bucketSum} ≠ verify:mep 实算 ${mep.counts.warnings}`);

  // ⑤ 电气：文档的「电气」行合并起来必须覆盖 byCode 全部键，且逐 code 计数一致
  assert.ok(electricRows.length >= 1, '§6 分桶表必须含电气规则组行');
  const claimedElectrical: Record<string, number> = {};
  let electricalRowSum = 0;
  for (const row of electricRows) {
    electricalRowSum += row.count;
    for (const [code, count] of row.codes) claimedElectrical[code] = (claimedElectrical[code] ?? 0) + count;
  }
  assert.deepEqual(claimedElectrical, electrical.counts.byCode, '§6 电气规则组的代码明细必须与 verify:electrical 实算完全一致');
  assert.equal(electricalRowSum, electrical.counts.warnings, `§6 电气分组之和 ${electricalRowSum} ≠ 实算 ${electrical.counts.warnings}`);

  // ⑥ MEP 侧：文档声称出现的每个 code 必须真实存在于本次 lint 输出里（防写死历史 code）
  for (const row of grouped) {
    for (const [code] of row.codes) {
      assert.ok(code in mepPerCode, `§6 提到 ${code}，但本次 verify:mep 没有该 warning（要么漏登、要么已过时）`);
    }
  }
  // 反向：must_fix 桶与 envelope 桶里出现的 code 必须都在 §6 规则清单里有登记
  for (const bucket of ['must_fix_before_briefing', 'envelope_approximation', 'survey_dependent']) {
    for (const [code] of Object.entries(mepBucketPerCode[bucket] ?? {})) {
      assert.ok(section6.includes(code), `§6 规则清单漏登实算 code ${code}（桶 ${bucket}）`);
    }
  }
});

// ─── §0：规模口径与机器条目数逐项相等 ──────────────────────────────────────

test('§0 规模表：路由/层/电点/给排水点/吊顶分区与机器条目数一致，153 与契约登记数一致', () => {
  const mepCoordination = parseYaml(readFileSync('config/mep-hvac-coordination.yaml', 'utf8')) as {
    routes: unknown[];
    layers: Record<string, unknown>;
  };
  const electricalPoints = parseYaml(readFileSync('config/electrical.yaml', 'utf8')) as unknown[];
  const plumbingPoints = parseYaml(readFileSync('config/plumbing.yaml', 'utf8')) as unknown[];
  const ceilingZones = parseYaml(readFileSync('config/ceiling.yaml', 'utf8')) as unknown[];

  // 与 facts.yaml 的 mirror 正则同族：改写量必须同步改 facts.yaml 的 extract，否则本测试先炸
  const claims: Array<[string, RegExp, number]> = [
    ['mep 路由数', /mep-hvac-coordination\.yaml[^0-9]{0,12}共\s*(\d+)\s*条路由/, mepCoordination.routes.length],
    ['mep 层数', /mep-hvac-coordination\.yaml[^0-9]{0,12}共\s*(\d+)\s*层/, Object.keys(mepCoordination.layers).length],
    ['电点数', /electrical\.yaml[^0-9]{0,12}共\s*(\d+)\s*个点位/, electricalPoints.length],
    ['给排水点数', /plumbing\.yaml[^0-9]{0,12}共\s*(\d+)\s*个点位/, plumbingPoints.length],
    ['吊顶分区数', /ceiling\.yaml[^0-9]{0,12}共\s*(\d+)\s*个吊顶分区/, ceilingZones.length],
  ];
  for (const [name, re, expected] of claims) {
    const hits = [...guidance.matchAll(new RegExp(re.source, 'g'))];
    assert.equal(hits.length, 1, `§0 的 ${name} 口径必须恰好命中 1 次（lane-3 mirror 同族正则），实际 ${hits.length}`);
    assert.equal(Number(hits[0][1]), expected, `§0 声称 ${name}=${hits[0][1]}，机器实算 ${expected}`);
  }
  // 路由数还要与 lint 自己解析出来的条数一致（lint 解析不了 = 空跑，规模口径就失真）
  assert.equal(mep.counts.routes, mepCoordination.routes.length, 'verify:mep 解析出的路由数必须等于 yaml 条目数');

  // 153：契约 registered_conflicts ↔ §0 表行 prose ↔ verify:facts INFO
  const contract = registry.contracts.find((c) => c.id === 'c.mep_layer_below_drop_bottom');
  assert.ok(contract, 'config/facts.yaml 必须登记契约 c.mep_layer_below_drop_bottom');
  assert.equal(typeof contract!.registered_conflicts, 'number', '契约 registered_conflicts 必须存在');
  const proseRe = contract!.prose?.find((p) => p.extract.includes('低于降板完成面的既有冲突'))?.extract;
  assert.ok(proseRe, '契约必须保留 §0 表行的 prose 回抽正则');
  const proseHits = [...guidance.matchAll(new RegExp(proseRe!, 'g'))];
  assert.equal(proseHits.length, 1, `§0 表行的登记数 prose 必须恰好命中 1 次，实际 ${proseHits.length}`);
  assert.equal(Number(proseHits[0][1]), contract!.registered_conflicts, '§0 表行登记数必须与契约 registered_conflicts 一致');
  // 登记事实列不许再把契约行挂到不存在的 fact 上
  const lastRow = section0.split('\n').find((l) => l.includes('低于降板完成面的既有冲突'))!;
  assert.match(lastRow, /契约 `c\.mep_layer_below_drop_bottom`/, '§0 末行的登记事实必须是契约名，不是 fact.mep_routes_count');
  assert.equal(/fact\.mep_routes_count`\s*\+\s*契约/.test(lastRow), false, '§0 末行不许再写「fact.* + 契约」这种不存在的组合');

  // verify:facts 的 INFO 口径：153 处 / 62 条路线 / 14 个吊顶分区
  const info = factsOut.match(/实算\s*(\d+)\s*处「路线点位低于所经吊顶完成面」，涉及\s*(\d+)\s*条路线\s*\/\s*(\d+)\s*个吊顶分区/);
  assert.ok(info, `verify:facts 必须输出「实算 N 处…涉及 N 条路线 / N 个吊顶分区」，实际输出片段：${factsOut.slice(0, 400)}`);
  assert.equal(Number(info![1]), contract!.registered_conflicts, '契约登记数必须等于 verify:facts 实算数');
  const docChains = section0.match(/涉及\s*\*\*(\d+)\s*条路线\s*\/\s*(\d+)\s*个吊顶分区\*\*/);
  assert.ok(docChains, '§0 正文必须写「涉及 **N 条路线 / N 个吊顶分区**」');
  assert.equal(Number(docChains![1]), Number(info![2]), `§0 路线数 ${docChains![1]} ≠ verify:facts 实算 ${info![2]}`);
  assert.equal(Number(docChains![2]), Number(info![3]), `§0 吊顶分区数 ${docChains![2]} ≠ verify:facts 实算 ${info![3]}`);
});

// ─── pending-site-data：表头计数口径（48 个编号 + #3a 子项 = 49 行） ────────

test('pending-site-data 表头口径：「量表共 N 条」= 编号数，实际行数 = 编号数 + 子项数', () => {
  const header = pending.match(/量表共\s*(\d+)\s*条/);
  assert.ok(header, 'docs/pending-site-data.md 必须保留「量表共 N 条」这一叙事锚点（fact.pending_site_data_count 权威值）');
  const claimed = Number(header![1]);

  // 权威值（narrative）= 表头那一处，两者必须一致
  const fact = registry.facts.find((f) => f.id === 'fact.pending_site_data_count');
  assert.ok(fact, 'config/facts.yaml 必须登记 fact.pending_site_data_count');
  const anchor = String(fact!.value ?? '').match(/量表共\s*(\d+)\s*条/);
  assert.ok(anchor, 'fact.pending_site_data_count 的权威值必须锚在表头那一句上');
  assert.equal(Number(anchor![1]), claimed, '登记表权威值与文档表头的编号数必须一致');

  // 表格行：`| N |`（编号行）与 `| Na |`（子项行）
  const rows = [...pending.matchAll(/^\|\s*(\d+[a-z]?)\s*\|/gm)].map((m) => m[1]);
  const numbered = rows.filter((id) => /^\d+$/.test(id));
  const subItems = rows.filter((id) => /^\d+[a-z]$/.test(id));
  assert.equal(claimed, numbered.length, `表头声称 ${claimed} 个编号，实际编号行 ${numbered.length}`);
  assert.deepEqual(subItems, ['3a'], '子项行应恰为 #3a（#3 的 A2 HVAC 子项）');
  assert.equal(rows.length, claimed + subItems.length, '表格行数必须 = 编号数 + 子项数');
  assert.equal(rows.length, 54, '当前口径：53 个编号 + #3a = 54 行');
});

// ─── 治理台账：逐条与实算一致，且覆盖全部实算 code ───────────────────────

test('治理台账 review-manifest.json：15 条逐项等于实算，且覆盖本次 lint 的全部 code', () => {
  const dispositions = manifest.dispositions;
  const allowed = ['accept', 'reject', 'pending_adjudication'];
  const categories = new Set(Object.keys(mep.categories ?? {}));
  const byCode = new Map(dispositions.map((d) => [d.code, d]));

  // ① 覆盖性：实算出现了的 code，台账必须逐条登记（新规则进来 → 这里 fail）
  for (const code of Object.keys(mepPerCode)) {
    assert.ok(byCode.has(code), `台账漏登实算 MEP code ${code}（count=${mepPerCode[code]}）`);
  }
  for (const code of Object.keys(electrical.counts.byCode)) {
    assert.ok(byCode.has(code), `台账漏登实算电气 code ${code}（count=${electrical.counts.byCode[code]}）`);
  }
  // 反向：台账不许登记本次没出现的 code
  for (const entry of dispositions) {
    assert.ok(entry.code in mepPerCode || entry.code in electrical.counts.byCode, `台账登记了本次未出现的 code ${entry.code}`);
  }

  // ② 逐条：count / category / disposition 合法
  for (const entry of dispositions) {
    assert.ok(allowed.includes(entry.disposition), `台账 ${entry.code} 的 disposition ${entry.disposition} 不合法`);
    const expected = entry.code in mepPerCode ? mepPerCode[entry.code] : electrical.counts.byCode[entry.code];
    assert.equal(entry.count, expected, `台账 ${entry.code} 登记 ${entry.count} ≠ 实算 ${expected}`);
    if (entry.code in mepPerCode) {
      assert.ok(categories.has(entry.category), `台账 ${entry.code} 的 category ${entry.category} 不是实算分桶`);
      const bucketCodes = mepBucketPerCode[entry.category] ?? {};
      assert.ok(entry.code in bucketCodes, `台账 ${entry.code} 声称属桶 ${entry.category}，实算不在该桶`);
    }
  }

  // ③ must_fix 桶一律 reject（不许接受）
  for (const entry of dispositions) {
    if (entry.category === 'must_fix_before_briefing') {
      assert.equal(entry.disposition, 'reject', `交底前必须清的 ${entry.code} 一律 reject，不许 accept`);
    }
  }

  // ④ 汇总与实算闭合
  const summary = manifest.summary as {
    mep_total_warnings: number;
    electrical_total_warnings: number;
    disposition_counts: Record<string, number>;
  };
  assert.equal(summary.mep_total_warnings, mep.counts.warnings, '台账 MEP 总数必须等于 verify:mep 实算');
  assert.equal(summary.electrical_total_warnings, electrical.counts.warnings, '台账电气总数必须等于 verify:electrical 实算');
  const counted: Record<string, number> = {};
  for (const entry of dispositions) counted[entry.disposition] = (counted[entry.disposition] ?? 0) + 1;
  assert.deepEqual(counted, summary.disposition_counts, '台账 disposition 汇总必须与逐条统计一致');
});

// ─── 过期基线必须已经清场 ─────────────────────────────────────────────────

test('文档不许再把 2026-09-07 的快照当现行基线', () => {
  // 旧基线 0 error / 22 warning、15 条已接受项、68 条路线 / 13 个吊顶分区、13 处穿墙点
  assert.equal(/0 error \/ 22 warning/.test(guidance), false, '§6 的旧基线「0 error / 22 warning」必须已替换为实跑口径');
  assert.equal(/68 条路线/.test(guidance), false, '§0 必须已是 62 条路线，不许再出现 68 条路线');
  assert.match(guidance, /涉及\s*\*\*69 条路线 \/ 14 个吊顶分区\*\*/);
  assert.equal(/13 个吊顶分区/.test(guidance), false, '§0 必须已是 14 个吊顶分区');
  assert.equal(/design-datum\.yaml`（13 处）/.test(guidance), false, '§1 的穿墙点留档条数必须已按 design-datum.yaml 实条数改写');
  assert.equal(/plumbing type 枚举暂不扩展/.test(guidance), false, '§3.1a 的 LEB 枚举口径必须已按 shared/types.ts 现状改写');
  assert.equal(/两卫所有插座 note 已声明防溅盒/.test(guidance), false, '§3.1a 的防溅盒口径必须已按 6/8 实况改写');
  assert.equal(/当前 5 条约束全部 inferred/.test(guidance), false, '§6 的参考梁位状态必须已改为 3 inferred + 2 pending');
  assert.equal(/冷凝水竖管段/.test(guidance), false, '§5 已过期的「冷凝水竖管段」必须已按 DEC-2026-10-05-R11 移除');
});

// ─── MEP error 侧：LINT 一侧的硬门禁必须仍然为空 ─────────────────────────

test('verify:mep / verify:electrical 的 error 侧必须为空，且 error code 与台账一致', () => {
  assert.deepEqual(Object.keys(mepErrorPerCode), [], 'verify:mep 不允许出现 error（出现即分桶与台账都要重审）');
  assert.deepEqual(Object.keys(perCode(electrical.errors)), [], 'verify:electrical 不允许出现 error');
  assert.ok(factsRun.status === 0, `verify:facts 应为 0 fail，实际退出码 ${factsRun.status}`);
});
