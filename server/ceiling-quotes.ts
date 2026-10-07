/**
 * 吊顶报价卡片（DEC-2026-10-08-C03）。
 *
 * 定位：**只管单价，不管量**。工程量一律由 `shared/ceiling-takeoff.ts` 从
 * `config/ceiling.yaml` 实算（板面 ㎡ / 窗帘盒 延长米 / 铝扣板块数），报价方只声明
 * 「单价 + 含项范围」，**不允许自带面积**——否则 A 家按毛面积、B 家按展开面积，数字永远对不上。
 *
 * 切换语义：`config/ceiling-quotes.yaml` 的 `active:` 指向生效卡片；改它就是改配置，
 * 走 Git（README「没有口头变更」）。`POST /api/ceiling/quotes/active` 与 MCP
 * `set_ceiling_quote` 都只做「改写 active 一行 + 留 .bak」，不重排文件、不丢注释，
 * 保证 Git diff 只有一行、业主看得懂。
 *
 * 待报价：`per_unit: null` = 该行还没拿到价。此时**数量照样显形、金额不编**
 * （与 base.json 的 pendingLabor 同一原则），杜绝「换个报价把活儿变没」。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import type { CeilingTakeoff } from '../shared/ceiling-takeoff.js';

export const CEILING_QUOTES_PATH = 'config/ceiling-quotes.yaml';

/** 计价行 key 与 `config/budget/base.json` 的 `labor[].area` 一致（改这里必须同步那边）。 */
export type CeilingQuoteRateKey = 'ceiling_zones' | 'curtain_box_linear';

export const CEILING_QUOTE_RATE_LABEL: Record<CeilingQuoteRateKey, string> = {
  ceiling_zones: '吊顶板面（㎡）',
  curtain_box_linear: '窗帘盒（延长米）',
};

export interface CeilingQuoteRate {
  /** 单价（元/单位）。null = 待报价：数量显形、金额不编。 */
  per_unit: number | null;
  /** 单位文案，仅用于展示（元/㎡、元/m）。 */
  unit: string;
  /** 含项/不含项声明：含辅材、安装、损耗、税费的口径不同就不可直接比较。 */
  scope_note?: string;
}

export interface CeilingQuote {
  id: string;
  contractor: string;
  /** 报价日期（ISO）。null = 尚未取得正式报价。 */
  quoted_at: string | null;
  status: 'baseline' | 'candidate' | 'quoted' | 'contracted' | 'rejected';
  /**
   * 只写拿到价的行；未写的行回落到 `config/budget/base.json` 的对应 labor rate，
   * 并在对比结果里标记 `rate_source: 'base.json'`，不让"回落"变成隐形替换。
   */
  rates: Partial<Record<CeilingQuoteRateKey, CeilingQuoteRate>>;
  note?: string;
}

export interface CeilingQuotesFile {
  version: number;
  /** 生效卡片 id。 */
  active: string;
  quotes: CeilingQuote[];
}

export interface ResolvedCeilingRate {
  per_unit: number | null;
  unit: string;
  source: 'quote' | 'base.json';
  scope_note?: string;
}

export type ResolvedCeilingRates = Record<CeilingQuoteRateKey, ResolvedCeilingRate>;

export interface CeilingQuoteRow {
  key: CeilingQuoteRateKey;
  label: string;
  quantity: number;
  unit: string;
  per_unit: number | null;
  rate_source: 'quote' | 'base.json';
  subtotal: number | null;
}

export interface CeilingQuoteComparison {
  id: string;
  contractor: string;
  quoted_at: string | null;
  status: CeilingQuote['status'];
  active: boolean;
  comparable: boolean;
  /** 不可直接比较的原因（含项口径缺失/混用）。 */
  comparability_notes: string[];
  rows: CeilingQuoteRow[];
  total: number | null;
  pendingRows: CeilingQuoteRateKey[];
  deltaVsActive: number | null;
}

function fail(message: string): never {
  throw new Error(`ceiling-quotes: ${message}`);
}

function parseRate(value: unknown, quoteId: string, key: string): CeilingQuoteRate {
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
export function parseCeilingQuotes(raw: string): CeilingQuotesFile {
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

  const quotes: CeilingQuote[] = [];
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
    const allowed = ['baseline', 'candidate', 'quoted', 'contracted', 'rejected'];
    if (!allowed.includes(record.status as string)) fail(`${id}.status 必须是 ${allowed.join('/')}`);
    if (record.quoted_at !== undefined && record.quoted_at !== null && typeof record.quoted_at !== 'string') {
      fail(`${id}.quoted_at 必须是字符串或 null`);
    }
    if (typeof record.rates !== 'object' || record.rates === null) fail(`${id}.rates 必须是对象`);
    const ratesRaw = record.rates as Record<string, unknown>;
    for (const key of Object.keys(ratesRaw)) {
      if (key !== 'ceiling_zones' && key !== 'curtain_box_linear') fail(`${id}.rates.${key} 不是已知计价行`);
    }
    const rates: Partial<Record<CeilingQuoteRateKey, CeilingQuoteRate>> = {};
    if (ratesRaw.ceiling_zones !== undefined) rates.ceiling_zones = parseRate(ratesRaw.ceiling_zones, id, 'ceiling_zones');
    if (ratesRaw.curtain_box_linear !== undefined) rates.curtain_box_linear = parseRate(ratesRaw.curtain_box_linear, id, 'curtain_box_linear');
    quotes.push({
      id,
      contractor: record.contractor as string,
      quoted_at: (record.quoted_at ?? null) as string | null,      status: record.status as CeilingQuote['status'],
      rates,
      ...(record.note !== undefined ? { note: record.note as string } : {}),
    });
  }
  if (!seen.has(data.active as string)) fail(`active「${data.active}」不在 quotes 里`);
  return { version: 1, active: data.active as string, quotes };
}

export function loadCeilingQuotes(path: string = CEILING_QUOTES_PATH): CeilingQuotesFile {
  return parseCeilingQuotes(readFileSync(path, 'utf8'));
}

/**
 * 切换生效报价：只改写 `active:` 一行（正则定点替换，保留注释与排版），
 * 先留 `.bak`。返回改写后的完整文件。找不到唯一 `active:` 行或目标 id 不存在 → 抛错，不写盘。
 */
export function setActiveCeilingQuote(id: string, path: string = CEILING_QUOTES_PATH): CeilingQuotesFile {
  const file = loadCeilingQuotes(path);
  if (!file.quotes.some((quote) => quote.id === id)) fail(`报价「${id}」不存在，可用：${file.quotes.map((q) => q.id).join('/')}`);
  const raw = readFileSync(path, 'utf8');
  const matches = [...raw.matchAll(/^active:.*$/gm)];
  if (matches.length !== 1) fail(`文件里应有且仅有一行 active:（实测 ${matches.length} 行）`);
  const needsQuote = /[:#{}[\],&*?|>'"%@`]/.test(id);
  const next = `${needsQuote ? JSON.stringify(id) : id}`;
  const updated = raw.replace(/^active:.*$/m, `active: ${next}`);
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  writeFileSync(path, updated, 'utf8');
  return loadCeilingQuotes(path);
}

/** 每个计价行的工程量：与 budget-calculator 的 computeLabor 完全一致（量只有一份）。 */
export function ceilingQuoteQuantities(takeoff: CeilingTakeoff): Record<CeilingQuoteRateKey, number> {
  return {
    ceiling_zones: takeoff.totalNetAreaM2 - takeoff.curtainBoxM2,
    curtain_box_linear: takeoff.curtainBoxLinearM,
  };
}

/**
 * 解析生效报价的各计价行单价。未在报价里声明的行回落到 base.json，
 * 并标记 `source: 'base.json'`——回落必须看得见，不能悄悄替换。
 */
export function resolveActiveCeilingRates(
  file: CeilingQuotesFile,
  fallback: Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }>,
): ResolvedCeilingRates {
  const active = file.quotes.find((quote) => quote.id === file.active) ?? fail(`active「${file.active}」不存在`);
  const resolve = (key: CeilingQuoteRateKey): ResolvedCeilingRate => {
    const fromQuote = active.rates[key];
    if (fromQuote) {
      return {
        per_unit: fromQuote.per_unit,
        unit: fromQuote.unit,
        source: 'quote',
        ...(fromQuote.scope_note !== undefined ? { scope_note: fromQuote.scope_note } : {}),
      };
    }
    return { per_unit: fallback[key].per_unit, unit: fallback[key].unit, source: 'base.json' };
  };
  return { ceiling_zones: resolve('ceiling_zones'), curtain_box_linear: resolve('curtain_box_linear') };
}

/** 全部报价并排对比（含未生效的），用于「多家报价一眼看数」。 */
export function compareCeilingQuotes(
  file: CeilingQuotesFile,
  takeoff: CeilingTakeoff,
  fallback: Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }>,
): CeilingQuoteComparison[] {
  const quantities = ceilingQuoteQuantities(takeoff);
  const comparisons = file.quotes.map((quote) => {
    const rows: CeilingQuoteRow[] = (['ceiling_zones', 'curtain_box_linear'] as CeilingQuoteRateKey[]).map((key) => {
      const declared = quote.rates[key];
      const perUnit = declared ? declared.per_unit : fallback[key].per_unit;
      const source: 'quote' | 'base.json' = declared ? 'quote' : 'base.json';
      const quantity = quantities[key];
      return {
        key,
        label: CEILING_QUOTE_RATE_LABEL[key],
        quantity,
        unit: declared?.unit ?? fallback[key].unit,
        per_unit: perUnit,
        rate_source: source,
        subtotal: perUnit === null ? null : perUnit * quantity,
      };
    });
    const pendingRows = rows.filter((row) => row.per_unit === null).map((row) => row.key);
    const total = pendingRows.length > 0 ? null : rows.reduce((sum, row) => sum + (row.subtotal ?? 0), 0);
    const comparabilityNotes: string[] = [];
    if (pendingRows.length > 0) comparabilityNotes.push(`待报价行：${pendingRows.map((key) => CEILING_QUOTE_RATE_LABEL[key]).join('、')}`);
    const missingScope = rows.filter((row) => row.rate_source === 'quote' && !quote.rates[row.key]?.scope_note);
    if (missingScope.length > 0) comparabilityNotes.push('报价未声明含项范围（辅材/安装/损耗/税费），与声明过的候选不可直接比较');
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
      deltaVsActive: null as number | null,
    };
  });
  const activeTotal = comparisons.find((entry) => entry.active)?.total ?? null;
  for (const entry of comparisons) {
    entry.deltaVsActive = entry.total !== null && activeTotal !== null && !entry.active ? entry.total - activeTotal : null;
  }
  return comparisons;
}
