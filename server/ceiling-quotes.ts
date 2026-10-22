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
  ResolvedQuoteRate,
  ResolvedQuoteRates,
} from '../shared/quote-cards.js';
import {
  compareQuoteCards,
  loadQuoteCards,
  parseQuoteCards,
  resolveActiveQuoteRates,
  setActiveQuoteCard,
} from '../shared/quote-cards.js';
import type { CeilingTakeoff } from '../shared/ceiling-takeoff.js';
import { readFileSync } from 'node:fs';

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
/**
 * 2026-10-13 阶段 3：`ResolvedCeilingRate` / `ResolvedCeilingRates` 已上提
 * `shared/quote-cards.ts` 并参数化（`ResolvedQuoteRate<Key>` / `ResolvedQuoteRates<Key>`）——
 * computeLabor 现在同时吃吊顶与瓦工两张卡，回落源名统一走 `spec.fallbackLabel`，
 * 不再有域自己硬编码的 `'base.json'` 字样。此处保留别名，既有 import 不变。
 */
export type ResolvedCeilingRate = ResolvedQuoteRate;
export type ResolvedCeilingRates = ResolvedQuoteRates<CeilingQuoteRateKey>;

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

/**
 * 解析生效报价的各计价行单价；未声明的行回落到 fallback 并标 `source`，回落必须看得见。
 *
 * 实现就是 `shared/quote-cards.ts` 的通用 resolver + 吊顶的 spec（`fallbackLabel: 'base.json'`），
 * 所以回落行在这里显示 `source: 'base.json'`，与参数化前的行为逐字节一致。
 */
export function resolveActiveCeilingRates(
  file: CeilingQuotesFile | null,
  fallback: Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }>,
): ResolvedCeilingRates {
  return resolveActiveQuoteRates<CeilingQuoteRateKey>(file, fallback, CEILING_SPEC);
}

/** 全部报价并排对比（含未生效的），用于「多家报价一眼看数」。 */
export function compareCeilingQuotes(
  file: CeilingQuotesFile,
  takeoff: CeilingTakeoff,
  fallback: Record<CeilingQuoteRateKey, QuoteCardFallback<CeilingQuoteRateKey>>,
): CeilingQuoteComparison[] {
  return compareQuoteCards<CeilingQuoteRateKey>(file, ceilingQuoteQuantities(takeoff), fallback, CEILING_SPEC);
}

// ─── base.json 兜底费率表（**全仓唯一一份**）──────────────────────────────────
//
// DEC-2026-10-13「预算计算架构根治」第二道对账（价单一源）。这张表此前在
// `server/routes.ts`、已删除的 MCP 服务端、`server/budget-calculator.ts` 里
// **逐字复制了三份**（前两份连缩进都一致），连三条硬编码 null
// （`gypsum_edge_drop_linear` / `gypsum_flat_sqm` / `aluminum_buckle_sqm`）也各抄一遍。
//
// 三份复制不是风格问题，是**对账失效**：改一处漏两处时没有任何机制会发现，
// 于是「同一份费率」可以在仓区里静默分成两个值——这正是本次要根治的根因 ①。
// 契约 `c.ceiling_rate_fallback_single_source`（config/facts.yaml）现在 grep 全仓
// `server/`，这张表的关键字只许出现一次；再复制一份，门禁当场报出全部位置。

/** base.json 的兜底费率表形状（与 `Record<CeilingQuoteRateKey, ...>` 同构，供参数化复用）。 */
export type CeilingRateFallback = Record<CeilingQuoteRateKey, { per_unit: number | null; unit: string }>;

/**
 * 从**已解析**的 base.json 派生兜底吊顶费率（carpentry 分类的 labor 行）。
 *
 * 为什么单独拆一个吃 `baseRaw` 的变体：`BudgetCalculator` 手里已经有解析好的
 * `config/budget/base.json`（它还要读 categories 算别的），让它再读一次文件既是
 * 第二次 IO、也是「同一份 config 两条装载路径」。表本身只有下面这一个实现。
 */
export function baseJsonCeilingRatesFromBase(baseRaw: {
  categories?: Record<string, { labor?: { rate: number | null; unit: string; area: string } | Array<{ rate: number | null; unit: string; area: string }> }>;
}): CeilingRateFallback {
  const carpentry = baseRaw.categories?.carpentry;
  const entries = carpentry?.labor ? (Array.isArray(carpentry.labor) ? carpentry.labor : [carpentry.labor]) : [];
  const byArea = new Map(entries.map((entry) => [entry.area, entry]));
  return {
    ceiling_zones: { per_unit: byArea.get('ceiling_zones')?.rate ?? null, unit: byArea.get('ceiling_zones')?.unit ?? '元/㎡' },
    curtain_box_linear: { per_unit: byArea.get('curtain_box_linear')?.rate ?? null, unit: byArea.get('curtain_box_linear')?.unit ?? '元/m' },
    gypsum_edge_drop_linear: { per_unit: null, unit: '元/m' },
    gypsum_flat_sqm: { per_unit: null, unit: '元/㎡' },
    aluminum_buckle_sqm: { per_unit: null, unit: '元/㎡' },
  };
}

/**
 * 读 `config/budget/base.json` 取兜底吊顶费率（`routes.ts` 用）。
 *
 * C12 新增的两行（边吊按米 / 满吊平顶按㎡）在 base.json 里没有对应 labor 行，
 * 回落值就是 null（待报价）——不编金额，只在报价面板显形。
 */
export function baseJsonCeilingRates(path = 'config/budget/base.json'): CeilingRateFallback {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Parameters<typeof baseJsonCeilingRatesFromBase>[0];
  return baseJsonCeilingRatesFromBase(raw);
}

