/**
 * 水电报价卡片（复用 shared/quote-cards.ts，与吊顶同源语义）。
 *
 * 定位：**只管单价，不管量**。工程量一律由 `shared/mep-takeoff.ts` 从既有声明实算
 * （管长/导线米数/底盒数/模数/穿墙孔数…），报价方只报「单价 + 含项范围」，
 * **不允许自带米数/面积**——否则 A 家按毛量、B 家按净量，数字永远对不上。
 *
 * 一张卡 = 一个可执行方案（品牌档位 + 人工口径）。切方案只改 `config/mep-quotes.yaml`
 * 的 `active:` 一行，`POST /api/mep/quotes/active` 与 MCP `set_mep_quote` 也只改这一行
 * （留 .bak、保留注释），量永远不变。
 *
 * 计价行分两类：
 *   - 材料行（wire_* / pipe_* / conduit_* / device_* …）：量来自 takeoff；
 *   - 人工行（labor_* / extra_* / aux_*）：量来自 takeoff 的设备数或固定 1 次，费率在
 *     `config/mep-labor.yaml`；**不属于本家范围的行用 out_of_scope**（材料商不报人工、
 *     施工方不报主材），与 per_unit:null（待报价）是两回事。
 */
import type { QuoteCard, QuoteCardComparison, QuoteCardFallback, QuoteCardRate, QuoteCardSpec, QuoteCardsFile } from '../shared/quote-cards.js';
import { compareQuoteCards, loadQuoteCards, parseQuoteCards, setActiveQuoteCard } from '../shared/quote-cards.js';
import type { MepTakeoff } from '../shared/mep-takeoff.js';

export const MEP_QUOTES_PATH = 'config/mep-quotes.yaml';

/** 计价行 key = takeoff 的数量口径。新增计价行必须同时在这里和 config/mep-quotes.yaml 登记。 */
export type MepQuoteRateKey =
  // ── 给水 ──
  | 'water_cold_20' | 'water_cold_25' | 'water_hot_20' | 'water_hot_25' | 'water_mixed_20'
  | 'fitting_ppr'
  // ── 排水 ──
  | 'drain_50' | 'drain_75' | 'drain_110' | 'fitting_pvc'
  // ── 电工管 ──
  | 'conduit_20' | 'conduit_25'
  // ── 导线 ──
  | 'wire_1_5' | 'wire_2_5' | 'wire_4_0' | 'wire_trunk'
  // ── 配电与保护 ──
  | 'breaker_mcb' | 'breaker_rcd' | 'spd' | 'panel'
  // ── 器件与阀件 ──
  | 'box86' | 'leb_kit' | 'entry_valve_kit' | 'gas_alarm_kit' | 'exhaust_duct_kit' | 'hot_pipe_insulation'
  // ── 弱电 ──
  | 'cat6'
  // ── 人工与包干（量来自 takeoff 设备数或固定 1 次）──
  | 'labor_by_area' | 'extra_penetration' | 'extra_leb_install' | 'extra_pressure_test' | 'aux_lump';

export const MEP_SPEC: QuoteCardSpec<MepQuoteRateKey> = {
  keys: [
    'water_cold_20', 'water_cold_25', 'water_hot_20', 'water_hot_25', 'water_mixed_20', 'fitting_ppr',
    'drain_50', 'drain_75', 'drain_110', 'fitting_pvc',
    'conduit_20', 'conduit_25',
    'wire_1_5', 'wire_2_5', 'wire_4_0', 'wire_trunk',
    'breaker_mcb', 'breaker_rcd', 'spd', 'panel',
    'box86', 'leb_kit', 'entry_valve_kit', 'gas_alarm_kit', 'exhaust_duct_kit', 'hot_pipe_insulation',
    'cat6',
    'labor_by_area', 'extra_penetration', 'extra_leb_install', 'extra_pressure_test', 'aux_lump',
  ],
  labels: {
    water_cold_20: 'PPR 给水管 dn20（常温水点位）',
    water_cold_25: 'PPR 给水管 dn25（入户总管/热水干管）',
    water_hot_20: 'PPR 热水管 dn20（热水支路）',
    water_hot_25: 'PPR 热水管 dn25（热水干管）',
    water_mixed_20: 'PPR 冷热双进 dn20（台盆/淋浴/洗衣机）',
    fitting_ppr: 'PPR 普通管件（同品牌同系列）',
    drain_50: 'PVC-U 排水管 de50',
    drain_75: 'PVC-U 排水管 de75',
    drain_110: 'PVC-U 排水管 de110',
    fitting_pvc: 'PVC-U 排水管件',
    conduit_20: '阻燃 PVC 电工管 φ20（强电）',
    conduit_25: '阻燃 PVC 电工管 φ25（弱电）',
    wire_1_5: 'BV 1.5mm²（照明/灯控）',
    wire_2_5: 'BV 2.5mm²（普通插座/空调）',
    wire_4_0: 'BV 4mm²（厨房/大功率）',
    wire_trunk: '强电主干线（线径待 #45 裁定）',
    breaker_mcb: '微型断路器 1P C16',
    breaker_rcd: '漏电断路器 1P+N RCBO',
    spd: '二级浪涌保护器 SPD',
    panel: '暗装配电箱（按模数）',
    box86: '86 型阻燃底盒',
    leb_kit: '等电位端子箱 + 联结线',
    entry_valve_kit: '入户阀件三件套',
    gas_alarm_kit: '燃气报警器 + 电磁切断阀',
    exhaust_duct_kit: '浴霸排风管 + 防火止回阀',
    hot_pipe_insulation: 'PPR 热水管保温套管',
    cat6: '六类非屏蔽网线',
    labor_by_area: '清包人工（元/㎡）',
    extra_penetration: '增项人工：机械开孔（元/孔）',
    extra_leb_install: '增项人工：等电位安装（元/套）',
    extra_pressure_test: '增项人工：打压与绝缘测试（元/次）',
    aux_lump: '辅材与耗材包干',
  },
  fallbackLabel: 'mep-labor.yaml',
};

export type MepQuote = QuoteCard<MepQuoteRateKey>;
export type MepQuotesFile = QuoteCardsFile<MepQuoteRateKey>;
export type MepQuoteRow = QuoteCardComparison<MepQuoteRateKey>['rows'][number];
export type MepQuoteComparison = QuoteCardComparison<MepQuoteRateKey>;

/** 每个计价行的工程量：量只有一份，全部来自 takeoff（或人工行的固定次数）。 */
export function mepQuoteQuantities(takeoff: MepTakeoff, areaSqm: number): Record<MepQuoteRateKey, number> {
  const wire = (size: string): number => takeoff.wire.bySize.find((bucket) => bucket.wireSize === size)?.wireM ?? 0;
  const water = (key: string): number => takeoff.pipe.water.find((bucket) => bucket.key === key)?.meters ?? 0;
  const drain = (key: string): number => takeoff.pipe.drainage.find((bucket) => bucket.key === key)?.meters ?? 0;
  const declared = (name: string): number => takeoff.devices.declared[name]?.count ?? 0;
  const hot = takeoff.pipe.water.filter((bucket) => bucket.key.startsWith('hot') || bucket.key.startsWith('mixed'))
    .reduce((sum, bucket) => sum + bucket.meters, 0);
  return {
    water_cold_20: water('cold/20'),
    water_cold_25: water('cold/25'),
    water_hot_20: water('hot/20'),
    water_hot_25: water('hot/25'),
    water_mixed_20: water('mixed/20'),
    fitting_ppr: takeoff.pipe.totalWaterM * 0.35,
    drain_50: drain('de50'),
    drain_75: drain('de75'),
    drain_110: drain('de110'),
    fitting_pvc: takeoff.pipe.totalDrainageM * 0.27,
    conduit_20: takeoff.conduit.strongPowerTotalM,
    conduit_25: takeoff.conduit.weakPowerTotalM,
    wire_1_5: wire('1.5'),
    wire_2_5: wire('2.5'),
    wire_4_0: wire('4.0'),
    wire_trunk: takeoff.trunkConduitM,
    breaker_mcb: takeoff.devices.breakers.mcbOnly,
    breaker_rcd: takeoff.devices.breakers.withRcd,
    spd: 1,
    panel: takeoff.devices.panelModules,
    box86: takeoff.devices.boxes,
    leb_kit: declared('leb_kits'),
    entry_valve_kit: declared('entry_valve_kit'),
    gas_alarm_kit: declared('gas_alarm_kit'),
    exhaust_duct_kit: declared('exhaust_duct_kit'),
    hot_pipe_insulation: hot,
    cat6: takeoff.cable.cat6M,
    labor_by_area: areaSqm,
    extra_penetration: takeoff.devices.penetrations,
    extra_leb_install: declared('leb_kits'),
    extra_pressure_test: 1,
    aux_lump: 1,
  };
}

export function parseMepQuotes(raw: string): MepQuotesFile {
  return parseQuoteCards<MepQuoteRateKey>(raw, MEP_SPEC);
}

export function loadMepQuotes(path: string = MEP_QUOTES_PATH): MepQuotesFile {
  return loadQuoteCards<MepQuoteRateKey>(path, MEP_SPEC);
}

/** 切换生效方案：只改写 `active:` 一行（保留注释排版、先留 .bak）。 */
export function setActiveMepQuote(id: string, path: string = MEP_QUOTES_PATH): MepQuotesFile {
  return setActiveQuoteCard<MepQuoteRateKey>(id, path, MEP_SPEC);
}

export type MepQuoteFallback = Record<MepQuoteRateKey, QuoteCardFallback<MepQuoteRateKey>>;

/** config/mep-labor.yaml 的最小视图（只取本模块要用的字段）。 */
export interface MepLaborFile {
  labor_models?: Array<{ id: string; enabled?: boolean; unit: string; rate?: number | null; rates?: Record<string, number | null>; scope_note?: string }>;
  extras?: Record<string, { rate: number | null; unit?: string; scope_note?: string }>;
  aux_material_lump?: { amount: number | null; unit?: string; scope_note?: string };
}

const MATERIAL_UNITS: Partial<Record<MepQuoteRateKey, string>> = {
  water_cold_20: '元/m', water_cold_25: '元/m', water_hot_20: '元/m', water_hot_25: '元/m', water_mixed_20: '元/m',
  fitting_ppr: '元/m', drain_50: '元/m', drain_75: '元/m', drain_110: '元/m', fitting_pvc: '元/m',
  conduit_20: '元/m', conduit_25: '元/m',
  wire_1_5: '元/m', wire_2_5: '元/m', wire_4_0: '元/m', wire_trunk: '元/m', hot_pipe_insulation: '元/m', cat6: '元/m',
  breaker_mcb: '元/个', breaker_rcd: '元/个', spd: '元/个', panel: '元/模', box86: '元/个',
  leb_kit: '元/套', entry_valve_kit: '元/套', gas_alarm_kit: '元/套', exhaust_duct_kit: '元/套',
};

/**
 * 未在报价卡里声明的行的回落源（与吊顶的 base.json 回落同语义）。
 * 人工五行走 config/mep-labor.yaml；材料行走 null（待报价）——不猜、不补默认值。
 */
export function mepQuoteFallback(labor: MepLaborFile): MepQuoteFallback {
  const byArea = (labor.labor_models ?? []).find((model) => model.id === 'clear_labor_by_area');
  const extras = labor.extras ?? {};
  const fallback = {} as MepQuoteFallback;
  for (const key of MEP_SPEC.keys) {
    if (key === 'labor_by_area') fallback[key] = { per_unit: byArea?.rate ?? null, unit: '元/㎡' };
    else if (key === 'extra_penetration') fallback[key] = { per_unit: extras.penetration_per_hole?.rate ?? null, unit: extras.penetration_per_hole?.unit ?? '元/孔' };
    else if (key === 'extra_leb_install') fallback[key] = { per_unit: extras.leb_install?.rate ?? null, unit: extras.leb_install?.unit ?? '元/套' };
    else if (key === 'extra_pressure_test') fallback[key] = { per_unit: extras.pressure_and_test?.rate ?? null, unit: extras.pressure_and_test?.unit ?? '元/次' };
    else if (key === 'aux_lump') fallback[key] = { per_unit: labor.aux_material_lump?.amount ?? null, unit: labor.aux_material_lump?.unit ?? '元' };
    else fallback[key] = { per_unit: null, unit: MATERIAL_UNITS[key] ?? '元' };
  }
  return fallback;
}

/** 全部方案并排对比（含未生效的），量永远不变，只有单价变。 */
export function compareMepQuotes(
  file: MepQuotesFile,
  takeoff: MepTakeoff,
  areaSqm: number,
  fallback: MepQuoteFallback,
): MepQuoteComparison[] {
  return compareQuoteCards<MepQuoteRateKey>(file, mepQuoteQuantities(takeoff, areaSqm), fallback, MEP_SPEC);
}

export type { QuoteCardRate };
