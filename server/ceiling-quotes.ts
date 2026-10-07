/**
 * 吊顶报价卡片（DEC-2026-10-08-C03）。
 *
 * 实现已改为 `shared/quote-cards.ts` 的薄封装——卡片机制（active 一行切换 + .bak、
 * 待报价显形、out_of_scope、comparable 门禁、并排对比 + deltaVsActive）是跨域共用的一份，
 * 本文件只保留吊顶的计价行 key 与文案。**新增域请复用 shared/quote-cards.ts，不要另写一套。**
 *
 * 定位不变：**只管单价，不管量**。工程量由 `shared/ceiling-takeoff.ts` 从
 * `config/ceiling.yaml` 实算，报价方只报单价 + 含项范围，不允许自带面积。
 */
import type {
  QuoteCard,
  QuoteCardComparison,
  QuoteCardFallback,
  QuoteCardRate,
  QuoteCardSpec,
  QuoteCardsFile,
  QuoteCardStatus,
} from '../shared/quote-cards.js';
import {
  compareQuoteCards,
  loadQuoteCards,
  parseQuoteCards,
  setActiveQuoteCard,
} from '../shared/quote-cards.js';
import type { CeilingTakeoff } from '../shared/ceiling-takeoff.js';

export const CEILING_QUOTES_PATH = 'config/ceiling-quotes.yaml';

/** 计价行 key。前两条与 `config/budget/base.json` 的 `labor[].area` 一致（改这里必须同步那边）。 */
export type CeilingQuoteRateKey =
  | 'ceiling_zones'
  | 'curtain_box_linear'
  | 'gypsum_edge_drop_linear'
  | 'gypsum_flat_sqm'
  | 'aluminum_buckle_sqm';

const CEILING_SPEC: QuoteCardSpec<CeilingQuoteRateKey> = {
  keys: ['ceiling_zones', 'curtain_box_linear', 'gypsum_edge_drop_linear', 'gypsum_flat_sqm', 'aluminum_buckle_sqm'],
  labels: {
    ceiling_zones: '吊顶板面（㎡，混合口径）',
    curtain_box_linear: '窗帘盒（延长米）',
    gypsum_edge_drop_linear: '石膏板边吊（延长米）',
    gypsum_flat_sqm: '石膏板满吊平顶（㎡）',
    aluminum_buckle_sqm: '厨卫铝扣板（㎡）',
  },
  fallbackLabel: 'base.json',
};

export const CEILING_QUOTE_RATE_LABEL = CEILING_SPEC.labels;
export const CEILING_QUOTE_RATE_KEYS: readonly CeilingQuoteRateKey[] = CEILING_SPEC.keys;

export type { QuoteCardRate, QuoteCardStatus };
export type CeilingQuote = QuoteCard<CeilingQuoteRateKey>;
export type CeilingQuotesFile = QuoteCardsFile<CeilingQuoteRateKey>;
export type CeilingQuoteRow = QuoteCardComparison<CeilingQuoteRateKey>['rows'][number];
export type CeilingQuoteComparison = QuoteCardComparison<CeilingQuoteRateKey>;
export type ResolvedCeilingRate = {
  per_unit: number | null;
  unit: string;
  source: 'quote' | 'base.json';
  scope_note?: string;
};
export type ResolvedCeilingRates = Record<CeilingQuoteRateKey, ResolvedCeilingRate>;

/** 读 + 校验吊顶报价卡片（fail closed）。 */
export function parseCeilingQuotes(raw: string): CeilingQuotesFile {
  return parseQuoteCards<CeilingQuoteRateKey>(raw, CEILING_SPEC);
}

export function loadCeilingQuotes(path: string = CEILING_QUOTES_PATH): CeilingQuotesFile {
  return loadQuoteCards<CeilingQuoteRateKey>(path, CEILING_SPEC);
}

/** 切换生效报价：只改写 `active:` 一行（保留注释排版、先留 .bak）。 */
export function setActiveCeilingQuote(id: string, path: string = CEILING_QUOTES_PATH): CeilingQuotesFile {
  return setActiveQuoteCard<CeilingQuoteRateKey>(id, path, CEILING_SPEC);
}

/** 每个计价行的工程量：与 budget-calculator 的 computeLabor 完全一致（量只有一份）。 */
export function ceilingQuoteQuantities(takeoff: CeilingTakeoff): Record<CeilingQuoteRateKey, number> {
  return {
    // 厨卫铝扣板独立成行（DEC-2026-10-08-C13）：16.366㎡ / 185 块，归 QR-2026-10-03-08 那张单，
    // 与石膏板的边吊/平顶两行分开——混在 ceiling_zones 里会让两家报价互相污染。
    aluminum_buckle_sqm: takeoff.aluminumBuckleM2,
    ceiling_zones: takeoff.totalNetAreaM2 - takeoff.curtainBoxM2,
    curtain_box_linear: takeoff.curtainBoxLinearM,
    // C12：边吊按长边之和、满吊平顶按净面积；两者相加 = 石膏板净面积（单元测试钉住）
    gypsum_edge_drop_linear: takeoff.edgeDropLinearM,
    gypsum_flat_sqm: takeoff.flatNetAreaM2,
  };
}

/** 解析生效报价的各计价行单价；未声明的行回落到 fallback 并标 `source`，回落必须看得见。 */
export function resolveActiveCeilingRates(
  file: CeilingQuotesFile,
  fallback: Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }>,
): ResolvedCeilingRates {
  const active = file.quotes.find((quote) => quote.id === file.active);
  if (!active) throw new Error(`ceiling-quotes: active「${file.active}」不存在`);
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
  return CEILING_SPEC.keys.reduce((acc, key) => {
    acc[key] = resolve(key);
    return acc;
  }, {} as ResolvedCeilingRates);
}

/** 全部报价并排对比（含未生效的），用于「多家报价一眼看数」。 */
export function compareCeilingQuotes(
  file: CeilingQuotesFile,
  takeoff: CeilingTakeoff,
  fallback: Record<CeilingQuoteRateKey, QuoteCardFallback<CeilingQuoteRateKey>>,
): CeilingQuoteComparison[] {
  return compareQuoteCards<CeilingQuoteRateKey>(file, ceilingQuoteQuantities(takeoff), fallback, CEILING_SPEC);
}
