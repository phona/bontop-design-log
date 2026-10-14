/**
 * 瓦工报价卡片（2026-10-13「预算计算架构根治」阶段 3）。
 *
 * 与吊顶（server/ceiling-quotes.ts）、水电（server/mep-quotes.ts）**同源**：卡片机制只有一份
 * （shared/quote-cards.ts），本文件只保留瓦工的计价行 key、文案与规格解析。
 * 新增域请复用 shared/quote-cards.ts，不要另写一套。
 *
 * 定位不变：**只管单价，不管量**。工程量一律由 `shared/masonry-takeoff.ts` 从
 * config/layout/overlay.yaml 的 wall_region / sill_region / floor_region 声明实算，
 * 报价方只报「单价 + 含项范围」，不允许自带面积。
 *
 * 计价行（一个 surface 一个 key）：
 *   floor      干区主地面铺砖（㎡）
 *   wet_floor  湿区主地面铺砖（㎡）
 *   wall_tile  墙砖 + 防水台贴砖（㎡）
 * 为什么不是「一规格一 key」：今天没有按规格的算量子系统，选那个形状等于要先建 takeoff。
 * 规格表留在卡内（domain.floor_rates_yuan_per_sqm / wall_rates_yuan_per_sqm），
 * 由本文件的 resolver 按 data/current-scheme.json 的选型规格取行。
 */
import { readFileSync } from 'node:fs';
import type { MasonryTakeoffResult } from '../shared/masonry-takeoff.js';
import type { CurrentScheme } from '../shared/types.js';
import type {
  QuoteCard,
  QuoteCardComparison,
  QuoteCardFallback,
  QuoteCardsFile,
  QuoteCardSpec,
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
import type { ProjectCatalog } from './project-catalog.js';

export const MASONRY_QUOTES_PATH = 'config/masonry-labor.yaml';

/** 计价行 key = takeoff 的数量口径。新增计价行必须同时在这里和 config/masonry-labor.yaml 登记。 */
export type MasonryQuoteRateKey = 'floor' | 'wet_floor' | 'wall_tile';

export const MASONRY_SPEC: QuoteCardSpec<MasonryQuoteRateKey> = {
  keys: ['floor', 'wet_floor', 'wall_tile'],
  labels: {
    floor: '干区地面贴砖（㎡）',
    wet_floor: '湿区地面贴砖（㎡）',
    wall_tile: '墙砖/防水台贴砖（㎡）',
  },
  fallbackLabel: 'base.json',
};

/**
 * 计价行 key → `server/budget-calculator.ts` 的 labor `area` 名。
 *
 * `wet_floor` **不能**直接当 area 名：config/budget/base.json 的 `waterproof` 分类已占用
 * `wet_floor`（20 元/㎡ 防水工，量取 needs_waterproof 房间）。computeLabor 的报价费率表按
 * area 名索引，同名会让瓦工费率盖到防水工头上——所以这里显式改名，不靠「恰好不撞」。
 */
export const MASONRY_LABOR_AREAS: Record<MasonryQuoteRateKey, string> = {
  floor: 'floor',
  wet_floor: 'wet_floor_tile',
  wall_tile: 'wall_tile',
};

export type MasonryQuote = QuoteCard<MasonryQuoteRateKey>;
export type MasonryQuotesFile = QuoteCardsFile<MasonryQuoteRateKey>;
export type MasonryQuoteRow = QuoteCardComparison<MasonryQuoteRateKey>['rows'][number];
export type MasonryQuoteComparison = QuoteCardComparison<MasonryQuoteRateKey>;

/** 每个计价行的工程量：量只有一份，全部来自 shared/masonry-takeoff.ts。 */
export function masonryQuoteQuantities(takeoff: MasonryTakeoffResult): Record<MasonryQuoteRateKey, number> {
  return {
    // 干区主地面 = dryRoomIds 房间 footprint + 归属干区的 floor_region extra（现行含主走廊 3.75㎡）。
    floor: takeoff.dryFloorSqm,
    // 湿区主地面 = wetRoomIds 房间 footprint + 归属湿区的 floor_region extra。
    wet_floor: takeoff.wetFloorSqm,
    // 墙砖 + 防水台贴砖：与材料侧 wall topic 的 masonryTileArea 同一出口。
    wall_tile: takeoff.totalTileSqm,
  };
}

export function parseMasonryQuotes(raw: string): MasonryQuotesFile {
  return parseQuoteCards<MasonryQuoteRateKey>(raw, MASONRY_SPEC);
}

export function loadMasonryQuotes(path: string = MASONRY_QUOTES_PATH): MasonryQuotesFile {
  return loadQuoteCards<MasonryQuoteRateKey>(path, MASONRY_SPEC);
}

/** 切换生效报价：只改写 `active:` 一行（保留注释排版、先留 .bak）。 */
export function setActiveMasonryQuote(id: string, path: string = MASONRY_QUOTES_PATH): MasonryQuotesFile {
  return setActiveQuoteCard<MasonryQuoteRateKey>(id, path, MASONRY_SPEC);
}

/** 生效卡片；active 指向不存在的卡片直接抛错（fail closed，不悄悄回落）。 */
export function activeMasonryCard(file: MasonryQuotesFile): MasonryQuote {
  const active = file.quotes.find((quote) => quote.id === file.active);
  if (!active) throw new Error(`masonry-quotes: active「${file.active}」不存在`);
  return active;
}

// ─── 卡内域层数据（domain{...}）───────────────────────────────────────────────

export interface MasonrySpecRateRow {
  specification: string;
  price: number;
}

export interface MasonryConditionalAddon {
  id: string;
  label: string;
  price: number;
  unit: string;
  status: string;
  scope_status?: string;
}

export interface MasonryExtra {
  label: string;
  price: number;
  unit: string;
  note?: string;
}

export interface MasonryCardDomain {
  floor_rates_yuan_per_sqm: MasonrySpecRateRow[];
  wall_rates_yuan_per_sqm: MasonrySpecRateRow[];
  conditional_addons: MasonryConditionalAddon[];
  extras: MasonryExtra[];
  notes: string[];
  bathroom_floor_charge_interpretations: {
    source_text: string;
    selection_status: string;
    options: Array<{ id: string; mode: 'flat_replaces_area_rate' | 'additive_only_if_mason_confirms'; note: string }>;
  };
}

function domainArray(value: unknown, field: string, cardId: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`masonry-quotes: ${cardId}.domain.${field} 必须是数组`);
  return value;
}

/**
 * 取出并校验卡内域层数据。shape 不对就抛错——「规格表读不出来」必须让预算算不出来，
 * 而不是悄悄退化成「这一行没报价」或更糟的「按 45 元/㎡ 算」。
 */
export function masonryCardDomain(card: MasonryQuote): MasonryCardDomain {
  const domain = card.domain;
  if (!domain) {
    throw new Error(`masonry-quotes: 卡 ${card.id} 没有 domain{...}（规格费率表/增项/extras 的唯一容器）`);
  }
  const specRows = (value: unknown, field: string): MasonrySpecRateRow[] =>
    domainArray(value, field, card.id).map((row, index) => {
      const record = (row ?? {}) as Record<string, unknown>;
      if (typeof record.specification !== 'string' || !record.specification) {
        throw new Error(`masonry-quotes: ${card.id}.domain.${field}[${index}] 缺 specification`);
      }
      if (typeof record.price !== 'number' || !Number.isFinite(record.price) || record.price < 0) {
        throw new Error(`masonry-quotes: ${card.id}.domain.${field}[${index}].price 必须是非负数字`);
      }
      return { specification: record.specification, price: record.price };
    });
  const addons = domainArray(domain.conditional_addons, 'conditional_addons', card.id).map((row, index) => {
    const record = (row ?? {}) as Record<string, unknown>;
    for (const field of ['id', 'label', 'unit', 'status']) {
      if (typeof record[field] !== 'string' || !(record[field] as string)) {
        throw new Error(`masonry-quotes: ${card.id}.domain.conditional_addons[${index}] 缺 ${field}`);
      }
    }
    if (typeof record.price !== 'number' || !Number.isFinite(record.price)) {
      throw new Error(`masonry-quotes: ${card.id}.domain.conditional_addons[${index}].price 必须是数字`);
    }
    return {
      id: record.id as string,
      label: record.label as string,
      price: record.price as number,
      unit: record.unit as string,
      status: record.status as string,
      ...(record.scope_status !== undefined ? { scope_status: String(record.scope_status) } : {}),
    };
  });
  const extras = domainArray(domain.extras, 'extras', card.id).map((row, index) => {
    const record = (row ?? {}) as Record<string, unknown>;
    for (const field of ['label', 'unit']) {
      if (typeof record[field] !== 'string' || !(record[field] as string)) {
        throw new Error(`masonry-quotes: ${card.id}.domain.extras[${index}] 缺 ${field}`);
      }
    }
    if (typeof record.price !== 'number' || !Number.isFinite(record.price)) {
      throw new Error(`masonry-quotes: ${card.id}.domain.extras[${index}].price 必须是数字`);
    }
    return {
      label: record.label as string,
      price: record.price as number,
      unit: record.unit as string,
      ...(record.note !== undefined ? { note: String(record.note) } : {}),
    };
  });
  const interpretations = domain.bathroom_floor_charge_interpretations as MasonryCardDomain['bathroom_floor_charge_interpretations'] | undefined;
  if (!interpretations || typeof interpretations !== 'object' || !Array.isArray(interpretations.options)) {
    throw new Error(`masonry-quotes: ${card.id}.domain.bathroom_floor_charge_interpretations 形状不对`);
  }
  return {
    floor_rates_yuan_per_sqm: specRows(domain.floor_rates_yuan_per_sqm, 'floor_rates_yuan_per_sqm'),
    wall_rates_yuan_per_sqm: specRows(domain.wall_rates_yuan_per_sqm, 'wall_rates_yuan_per_sqm'),
    conditional_addons: addons,
    extras,
    notes: domainArray(domain.notes, 'notes', card.id).map((note) => String(note)),
    bathroom_floor_charge_interpretations: interpretations,
  };
}

// ─── 按选型规格解析单价 ───────────────────────────────────────────────────────

/** 规格串 → 候选尺寸对（mm）。「木纹砖200x1200或150x900」解析成两个候选。 */
function specAlternativesMm(specification: string): Array<[number, number]> {
  return specification
    .split(/[或/,]/)
    .map((part) => (part.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
    .filter((nums) => nums.length >= 2)
    .map((nums) => [nums[0], nums[1]] as [number, number]);
}

/** 材料 spec（如 "200x1200mm"）→ 尺寸对。取不出来返回 null（调用方按「无法解析」显形）。 */
function materialDimensionsMm(spec: string): [number, number] | null {
  const nums = (spec.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length < 2) return null;
  return [nums[0], nums[1]];
}

function sameSize(a: [number, number], b: [number, number]): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

/**
 * 一个计价行解析出来的单价：在 `ResolvedQuoteRate` 之外多带**命中了哪一行规格**与
 * **该面积内出现的全部选型规格**。多规格时必须显形——费率卡按规格计价，
 * 用单一代表行去乘整个面积会让「两种砖一个价」这件事看不见。
 */
export interface MasonryResolvedRate extends ResolvedQuoteRate {
  matchedSpecification: string | null;
  specs: string[];
}

export type ResolvedMasonryRates = Record<MasonryQuoteRateKey, MasonryResolvedRate>;

/** 每个计价行的选型规格清单（来自 data/current-scheme.json + materials.yaml 的 spec）。 */
export type MasonrySpecSelection = Partial<Record<MasonryQuoteRateKey, string[]>>;

/**
 * 解析生效瓦工卡的各计价行单价。三条优先级：
 *   ① 卡里直接声明了 `rates.<key>.per_unit`（书面报价的常见形状）→ 用它；
 *   ② 卡里该行是待报价，但 `domain.*_rates_yuan_per_sqm` 有匹配**选型规格**的行 → 用那一行；
 *   ③ 都没有 → 回落 fallback（base.json），并标 `rate_source`。
 *
 * ②是「照片级费率卡」的正确形状：卡上按规格分行，项目按选型取行。
 * 湿区 400×400 / 200×200 在费率卡上**无行**，于是走到 ③ 而 fallback 也是 null
 * → 待报价显形，绝不用 base.json 的 45 元/㎡（那只是 600×600 行）冒充。
 */
export function resolveActiveMasonryRates(
  file: MasonryQuotesFile | null,
  fallback: Record<MasonryQuoteRateKey, QuoteCardFallback<MasonryQuoteRateKey>>,
  selection: MasonrySpecSelection,
): ResolvedMasonryRates {
  const active = file ? activeMasonryCard(file) : undefined;
  const domain = active ? masonryCardDomain(active) : undefined;
  const specTableFor = (key: MasonryQuoteRateKey): MasonrySpecRateRow[] => {
    if (!domain) return [];
    return key === 'wall_tile' ? domain.wall_rates_yuan_per_sqm : domain.floor_rates_yuan_per_sqm;
  };
  const resolve = (key: MasonryQuoteRateKey): MasonryResolvedRate => {
    const specs = (selection[key] ?? []).filter((spec) => spec.length > 0);
    const declared = active?.rates[key];
    if (declared && declared.per_unit !== null) {
      return {
        per_unit: declared.per_unit,
        unit: declared.unit,
        source: 'quote',
        ...(declared.scope_note !== undefined ? { scope_note: declared.scope_note } : {}),
        matchedSpecification: null,
        specs,
      };
    }
    for (const spec of specs) {
      const dimensions = materialDimensionsMm(spec);
      if (!dimensions) continue;
      const row = specTableFor(key).find((candidate) => specAlternativesMm(candidate.specification).some((alt) => sameSize(alt, dimensions)));
      if (row) {
        return {
          per_unit: row.price,
          unit: declared?.unit ?? '元/㎡',
          source: 'quote',
          scope_note: `按选型规格 ${spec} 取费率卡「${row.specification}」行`,
          matchedSpecification: row.specification,
          specs,
        };
      }
    }
    return {
      per_unit: fallback[key].per_unit,
      unit: fallback[key].unit,
      source: MASONRY_SPEC.fallbackLabel ?? 'fallback',
      matchedSpecification: null,
      specs,
    };
  };
  return MASONRY_SPEC.keys.reduce((acc, key) => {
    acc[key] = resolve(key);
    return acc;
  }, {} as ResolvedMasonryRates);
}

/**
 * 每个计价行的选型规格清单：干区地面取 dryRoomIds 房间的 floor 选型、湿区取 wetRoomIds 的、
 * 墙砖取全部有 wall 选型的房间。同一面积出现多规格时**全部列出**（见 MasonryResolvedRate.specs），
 * 由 resolver 显形，不悄悄取平均、也不悄悄取第一个。
 *
 * `floorRoomSplit` 由调用方给（server/budget-calculator.ts 的 loadFloorRoomSplit，读
 * config/tile-comparison.yaml）——干/湿区划分是算量输入，全库只有那一份。
 */
export function masonrySpecSelection(
  catalog: ProjectCatalog,
  scheme: CurrentScheme,
  floorRoomSplit: { dryRoomIds: string[]; wetRoomIds: string[] },
): MasonrySpecSelection {
  const specOf = (topicId: string, optionId: string | undefined): string | null => {
    if (!optionId) return null;
    const option = catalog.getOption(topicId, optionId);
    const spec = (option?.data as { spec?: unknown } | undefined)?.spec;
    return typeof spec === 'string' && spec ? spec : null;
  };
  const distinct = (values: Array<string | null>): string[] => [...new Set(values.filter((value): value is string => value !== null))];
  const selected = (topicId: string, roomId: string): string | undefined =>
    scheme.selections[topicId]?.roomOverrides?.[roomId] ?? scheme.selections[topicId]?.default;

  const drySpecs: Array<string | null> = [];
  const wetSpecs: Array<string | null> = [];
  const wallSpecs: Array<string | null> = [];
  for (const room of catalog.getRooms()) {
    const floorSpec = specOf('floor', selected('floor', room.id));
    if (floorRoomSplit.dryRoomIds.includes(room.id)) drySpecs.push(floorSpec);
    if (floorRoomSplit.wetRoomIds.includes(room.id)) wetSpecs.push(floorSpec);
    wallSpecs.push(specOf('wall', selected('wall', room.id)));
  }
  return {
    floor: distinct(drySpecs),
    wet_floor: distinct(wetSpecs),
    wall_tile: distinct(wallSpecs),
  };
}

/** 全部报价并排对比（含未生效的），量永远不变，只有单价变。 */
export function compareMasonryQuotes(
  file: MasonryQuotesFile,
  takeoff: MasonryTakeoffResult,
  fallback: Record<MasonryQuoteRateKey, QuoteCardFallback<MasonryQuoteRateKey>>,
): MasonryQuoteComparison[] {
  return compareQuoteCards<MasonryQuoteRateKey>(file, masonryQuoteQuantities(takeoff), fallback, MASONRY_SPEC);
}

// ─── base.json 兜底 ───────────────────────────────────────────────────────────

/**
 * base.json 的兜底瓦工费率：生效报价没声明的计价行回落到它。
 *
 * 三条 labor 行的口径（2026-10-13 阶段 3 起 masonry.labor 从单对象改成数组）：
 *   `floor`          45 元/㎡ —— 只对应费率卡的 600×600 行；干区当前选型 200×1200 木纹砖
 *                     在卡上有行（75），所以正常路径不会落到这里。保留仅为「卡坏了」时的回落。
 *   `wet_floor_tile` null    —— 湿区 400×400 / 200×200 在费率卡上无行，**必须**显形为待报价，
 *                     不得用 45 冒充（见 config/masonry-labor.yaml historical_reference）。
 *   `wall_tile`      null    —— base.json 原先没有墙砖人工行（旧口径墙砖人工整体未计价），
 *                     费率由费率卡的墙砖规格表按选型解析。
 */
export function masonryQuoteFallback(
  baseRaw: Record<string, { labor?: unknown }>,
): Record<MasonryQuoteRateKey, QuoteCardFallback<MasonryQuoteRateKey>> {
  const masonry = baseRaw.masonry;
  const entries = masonry?.labor ? (Array.isArray(masonry.labor) ? masonry.labor : [masonry.labor]) : [];
  const byArea = new Map<string, { rate: number | null; unit: string }>();
  for (const entry of entries) {
    const record = entry as { area?: unknown; rate?: unknown; unit?: unknown };
    if (typeof record.area !== 'string') continue;
    byArea.set(record.area, {
      rate: typeof record.rate === 'number' ? record.rate : null,
      unit: typeof record.unit === 'string' ? record.unit : '元/㎡',
    });
  }
  const row = (area: string, unit: string) => ({
    per_unit: byArea.get(area)?.rate ?? null,
    unit: byArea.get(area)?.unit ?? unit,
  });
  return {
    floor: row('floor', '元/㎡'),
    wet_floor: row('wet_floor_tile', '元/㎡'),
    wall_tile: row('wall_tile', '元/㎡'),
  };
}

/** 读 + 校验瓦工报价卡片（fail closed）。 */
export function loadMasonryQuotesBundle(path: string = MASONRY_QUOTES_PATH): {
  file: MasonryQuotesFile;
  card: MasonryQuote;
  domain: MasonryCardDomain;
} {
  const raw = readFileSync(path, 'utf8');
  const file = parseMasonryQuotes(raw);
  const card = activeMasonryCard(file);
  return { file, card, domain: masonryCardDomain(card) };
}
