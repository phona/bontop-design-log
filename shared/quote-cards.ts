/**
 * 报价卡片通用机制（从 server/ceiling-quotes.ts 抽出，DEC-2026-10-08-C03 的同款语义）。
 *
 * 定位：**只管单价，不管量**。工程量一律由对应 takeoff 从配置实算，报价方只声明
 * 「单价 + 含项范围」，**不允许自带面积/米数**——否则 A 家按毛量、B 家按净量，数字永远对不上。
 *
 * 已经建成、被吊顶验证过的语义（MEP / 其他域直接复用，不要另起一套）：
 *  1. `active:` 指向生效卡片 id；切换只改这一行（正则定点替换、保留注释排版、先留 .bak），
 *     保证 Git diff 只有一行、业主看得懂。
 *  2. `per_unit: null` = 待报价：数量照样显形、金额不编（与 base.json 的 pendingLabor 同原则），
 *     杜绝「换个报价把活儿变没」。
 *  3. `out_of_scope` = 这家不报这项（≠ 待报价）：总额照算，该行只显形，并提示"别以为总额已含"。
 *  4. 未声明的行回落到 fallback（如 base.json 费率），并标 `rate_source`，不许隐形替换。
 *  5. `comparable:false`：缺 scope_note、有待报价行、有超范围行——不同口径不可直接比较。
 *  6. 全部候选并排对比 + `deltaVsActive`：多家报价一眼看数，量永远不变。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';

export type QuoteCardStatus = 'baseline' | 'candidate' | 'quoted' | 'contracted' | 'rejected';

export interface QuoteCardRate {
  /** 单价（元/单位）。null = 待报价：数量显形、金额不编。 */
  per_unit: number | null;
  /** 单位文案，仅用于展示（元/㎡、元/m）。 */
  unit: string;
  /** 含项/不含项声明：含辅材、安装、损耗、税费的口径不同就不可直接比较。 */
  scope_note?: string;
}

export interface QuoteCard<Key extends string> {
  id: string;
  contractor: string;
  quoted_at: string | null;
  status: QuoteCardStatus;
  rates: Partial<Record<Key, QuoteCardRate>>;
  /** 不在本家报价范围内的计价行（≠ per_unit:null 的待报价）。 */
  out_of_scope?: Key[];
  note?: string;
}

export interface QuoteCardsFile<Key extends string> {
  version: number;
  active: string;
  quotes: QuoteCard<Key>[];
}

export interface QuoteCardRow<Key extends string> {
  key: Key;
  label: string;
  quantity: number;
  unit: string;
  per_unit: number | null;
  rate_source: 'quote' | 'fallback';
  subtotal: number | null;
  out_of_scope: boolean;
}

export interface QuoteCardComparison<Key extends string> {
  id: string;
  contractor: string;
  quoted_at: string | null;
  status: QuoteCardStatus;
  active: boolean;
  comparable: boolean;
  comparability_notes: string[];
  rows: QuoteCardRow<Key>[];
  total: number | null;
  pendingRows: Key[];
  outOfScopeRows: Key[];
  coveredScope: string;
  deltaVsActive: number | null;
}

/** 域描述：计价行 key 清单 + 展示文案。 */
export interface QuoteCardSpec<Key extends string> {
  keys: readonly Key[];
  labels: Record<Key, string>;
  /** 回落源的展示名（吊顶点 base.json、水电子 mep-labor.yaml）。回落必须看得见，不许隐形替换。 */
  fallbackLabel?: string;
}

function fail(message: string): never {
  throw new Error(`quote-cards: ${message}`);
}

function parseRate(value: unknown, quoteId: string, key: string): QuoteCardRate {
  if (typeof value !== 'object' || value === null) fail(`${quoteId}.rates.${key} 必须是对象`);
  const record = value as Record<string, unknown>;
  const perUnit = record.per_unit ?? null;
  if (perUnit !== null && (typeof perUnit !== 'number' || !Number.isFinite(perUnit) || perUnit < 0)) {
    fail(`${quoteId}.rates.${key}.per_unit 必须是非负数字或 null（待报价）`);
  }
  if (typeof record.unit !== 'string' || !record.unit) fail(`${quoteId}.rates.${key}.unit 必须是非空字符串`);
  if (record.scope_note !== undefined && typeof record.scope_note !== 'string') {
    fail(`${quoteId}.rates.${key}.scope_note 必须是字符串`);
  }
  return {
    per_unit: perUnit as number | null,
    unit: record.unit as string,
    ...(record.scope_note !== undefined ? { scope_note: record.scope_note as string } : {}),
  };
}

/** 读 + 校验报价卡片。任何结构问题直接抛错（fail closed），不猜、不补默认值。 */
export function parseQuoteCards<Key extends string>(raw: string, spec: QuoteCardSpec<Key>): QuoteCardsFile<Key> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    fail(`YAML 解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
  const data = parsed as Record<string, unknown> | null;
  if (typeof data !== 'object' || data === null) fail('文件不是 YAML 对象');
  if (data.version !== 1) fail(`version 必须为 1（实测 ${String(data.version)}）`);
  if (typeof data.active !== 'string' || !data.active) fail('active 必须是非空字符串');
  if (!Array.isArray(data.quotes) || data.quotes.length === 0) fail('quotes 必须是非空数组');

  const quotes: QuoteCard<Key>[] = [];
  const seen = new Set<string>();
  for (const entry of data.quotes) {
    if (typeof entry !== 'object' || entry === null) fail('quotes 条目必须是对象');
    const record = entry as Record<string, unknown>;
    for (const field of ['id', 'contractor', 'status']) {
      if (typeof record[field] !== 'string' || !(record[field] as string)) fail(`quotes 条目缺少 ${field}`);
    }
    const id = record.id as string;
    if (seen.has(id)) fail(`报价 id 重复：${id}`);
    seen.add(id);
    const allowed: QuoteCardStatus[] = ['baseline', 'candidate', 'quoted', 'contracted', 'rejected'];
    if (!allowed.includes(record.status as QuoteCardStatus)) fail(`${id}.status 必须是 ${allowed.join('/')}`);
    if (record.quoted_at !== undefined && record.quoted_at !== null && typeof record.quoted_at !== 'string') {
      fail(`${id}.quoted_at 必须是字符串或 null`);
    }
    let outOfScope: Key[] | undefined;
    if (record.out_of_scope !== undefined) {
      if (!Array.isArray(record.out_of_scope)) fail(`${id}.out_of_scope 必须是数组`);
      for (const key of record.out_of_scope as unknown[]) {
        if (!spec.keys.includes(key as Key)) fail(`${id}.out_of_scope.${String(key)} 不是已知计价行`);
      }
      outOfScope = [...(record.out_of_scope as Key[])];
    }
    if (typeof record.rates !== 'object' || record.rates === null) fail(`${id}.rates 必须是对象`);
    const ratesRaw = record.rates as Record<string, unknown>;
    for (const key of Object.keys(ratesRaw)) {
      if (!spec.keys.includes(key as Key)) fail(`${id}.rates.${key} 不是已知计价行`);
    }
    const rates: Partial<Record<Key, QuoteCardRate>> = {};
    for (const key of spec.keys) {
      if (ratesRaw[key] !== undefined) rates[key] = parseRate(ratesRaw[key], id, String(key));
    }
    quotes.push({
      id,
      contractor: record.contractor as string,
      quoted_at: (record.quoted_at ?? null) as string | null,
      status: record.status as QuoteCardStatus,
      rates,
      ...(outOfScope !== undefined ? { out_of_scope: outOfScope } : {}),
      ...(record.note !== undefined ? { note: record.note as string } : {}),
    });
  }
  if (!seen.has(data.active as string)) fail(`active「${data.active}」不在 quotes 里`);
  return { version: 1, active: data.active as string, quotes };
}

export function loadQuoteCards<Key extends string>(path: string, spec: QuoteCardSpec<Key>): QuoteCardsFile<Key> {
  return parseQuoteCards(readFileSync(path, 'utf8'), spec);
}

/**
 * 切换生效报价：只改写 `active:` 一行（正则定点替换，保留注释与排版），先留 `.bak。
 * 找不到唯一 `active:` 行或目标 id 不存在 → 抛错，不写盘。
 */
export function setActiveQuoteCard<Key extends string>(id: string, path: string, spec: QuoteCardSpec<Key>): QuoteCardsFile<Key> {
  const file = loadQuoteCards<Key>(path, spec);
  if (!file.quotes.some((quote) => quote.id === id)) fail(`报价「${id}」不存在，可用：${file.quotes.map((q) => q.id).join('/')}`);
  const raw = readFileSync(path, 'utf8');
  const matches = [...raw.matchAll(/^active:.*$/gm)];
  if (matches.length !== 1) fail(`文件里应有且仅有一行 active:（实测 ${matches.length} 行）`);
  const needsQuote = /[:#{}[\],&*?|>'"%@`]/.test(id);
  const next = `${needsQuote ? JSON.stringify(id) : id}`;
  const updated = raw.replace(/^active:.*$/m, `active: ${next}`);
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  writeFileSync(path, updated, 'utf8');
  return loadQuoteCards<Key>(path, spec);
}

export interface QuoteCardFallback<Key extends string> {
  per_unit: number | null;
  unit: string;
}

/** 全部报价并排对比（含未生效的），用于「多家报价一眼看数」。量由调用方的 takeoff 提供，永不变。 */
export function compareQuoteCards<Key extends string>(
  file: QuoteCardsFile<Key>,
  quantities: Record<Key, number>,
  fallback: Record<Key, QuoteCardFallback<Key>>,
  spec: QuoteCardSpec<Key>,
): QuoteCardComparison<Key>[] {
  const comparisons = file.quotes.map((quote) => {
    const outOfScope = new Set(quote.out_of_scope ?? []);
    const rows: QuoteCardRow<Key>[] = spec.keys.map((key) => {
      const declared = quote.rates[key];
      const perUnit = declared ? declared.per_unit : fallback[key].per_unit;
      const source: 'quote' | 'fallback' = declared ? 'quote' : 'fallback';
      // 回落行的来源名按域配置（吊顶 base.json / 水电子 mep-labor.yaml）；报价行恒为 quote
      const sourceLabel = declared ? 'quote' : (spec.fallbackLabel ?? 'fallback');
      const quantity = quantities[key];
      const skipped = outOfScope.has(key);
      return {
        key,
        label: spec.labels[key],
        quantity,
        unit: declared?.unit ?? fallback[key].unit,
        per_unit: perUnit,
        rate_source: sourceLabel as 'quote' | 'fallback',
        // 超出范围的行既不算金额、也不算待报价——「这家不报这项」≠「这项没报价」
        subtotal: skipped || perUnit === null ? null : perUnit * quantity,
        out_of_scope: skipped,
      };
    });
    const pricedRows = rows.filter((row) => !row.out_of_scope);
    const pendingRows = pricedRows.filter((row) => row.per_unit === null).map((row) => row.key);
    const outOfScopeRows = rows.filter((row) => row.out_of_scope).map((row) => row.key);
    const total = pendingRows.length > 0 ? null : pricedRows.reduce((sum, row) => sum + (row.subtotal ?? 0), 0);
    const comparabilityNotes: string[] = [];
    if (pendingRows.length > 0) comparabilityNotes.push(`待报价行：${pendingRows.map((key) => spec.labels[key]).join('、')}`);
    if (outOfScopeRows.length > 0) {
      comparabilityNotes.push(`不在本家报价范围：${outOfScopeRows.map((key) => spec.labels[key]).join('、')}（须由其他报价单覆盖，别以为总额已含）`);
    }
    const missingScope = pricedRows.filter((row) => row.rate_source === 'quote' && !quote.rates[row.key]?.scope_note);
    if (missingScope.length > 0) comparabilityNotes.push('报价未声明含项范围（辅材/安装/损耗/税费），与声明过的候选不可直接比较');
    const coveredScope = pricedRows.filter((row) => row.per_unit !== null).map((row) => spec.labels[row.key]).join('、');
    return {
      id: quote.id,
      contractor: quote.contractor,
      quoted_at: quote.quoted_at,
      status: quote.status,
      active: quote.id === file.active,
      comparable: comparabilityNotes.length === 0,
      comparability_notes: comparabilityNotes,
      rows,
      total,
      pendingRows,
      outOfScopeRows,
      coveredScope,
      deltaVsActive: null as number | null,
    };
  });
  const activeTotal = comparisons.find((entry) => entry.active)?.total ?? null;
  for (const entry of comparisons) {
    entry.deltaVsActive = entry.total !== null && activeTotal !== null && !entry.active ? entry.total - activeTotal : null;
  }
  return comparisons;
}
