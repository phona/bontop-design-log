/**
 * 一期成本总表（硬装，含中央空调）——生成源。
 *
 * 为什么需要这张表：预算有正式总表（phase-1/budget.md + 计算器科目视图），成本没有。
 * 成本数字散在各包 estimated_need_cny、报价卡与计算器快照里，靠人誊抄拼表，已经造成
 * 严重误读（把科目视图的「承诺额」已定价小计当成硬装总价）。本模块把成本行逐行钉死
 * 到唯一权威来源，由 scripts/schedule/control.ts 在 render 时生成 phase-1/cost.md，
 * verify:schedule 用同一条流水线做时效校验（指纹 + 内容全等），禁止手改生成物。
 *
 * 业主口径（2026-10-23 裁定，违背即错）：
 *  1. 只列实际成本：planned_cny / 批准额不得作为任何一行的金额或垫数出现（本模块
 *     在计算上根本不读 planned_cny；测试以篡改 planned 全量不变断言防回归）。
 *  2. 硬装包含中央空调：hvac 池并入本表硬装板块，不拆开单列。
 *  3. 没有真实价格的行只标「未定价」、金额为 null，绝不按 0 计入合计；合计行固定
 *     写作「已知小计（不含未定价）」。
 *  4. 每行标注成色且不得拔高：已签约 / 报价卡实算 / 报价轮实算 / 定标目标 / 参考实付 /
 *     算量费率 / 候选价 / 定额暂估。推导在现有数据里追不到构成时，只许降格成色，
 *     不许编造拆解；构成分解与来源金额对不上时构建直接抛错（fail-closed），逼着先
 *     更新本映射表再出表。
 *  5. 小计必须分层（2026-10-23 评审 P1）：每行登记核实层级（tier）——已核实 =
 *     金额已锁定（签约）或由生效数据源完整实算（生效报价卡全行计价、无待报价行），
 *     且无未决去重/待报价标记；其余未锁价等级（封顶价、预算池、候选价、定标目标、
 *     参考实付、定额暂估，以及带未关闭 dedup 的实算行）一律暂估。汇总分三行呈现：
 *     已核实小计 + 暂估小计 = 已知合计；已知合计不得被表述为已核实成本。
 *
 * ── 数据源映射裁定（每行唯一来源 + 防双算理由）────────────────────────────
 *  中央空调 36,000 ← control.yaml PKG-030 budget.contracted_cny（已转合同，
 *    QR-2026-10-03-24 locked_cny 同值、contract_ref DEC-2026-10-04-R1）。
 *    计算器 hvac 科目的 36,000 是同一笔钱的镜像，不另计。
 *  拆改 7,059 ← PKG-020 description 的同户型半包实付锚（拆砌人工 6,000 + 物业垃圾
 *    清运 1,059，程序从原文解析、解析不到即抛错）。科目 demolition 无计价行；
 *    QR-2026-10-03-01 的 3,000 是候选目标，不是价格，不采用。
 *  水电 ← compareMepQuotes 生效卡总额（shared/mep-takeoff.ts 算量 ×
 *    config/mep-quotes.yaml 生效卡单价，与 scripts/project/mep-takeoff.ts 同一条路）。
 *    科目 water_electric 的 6,218（人工一口价 5,000 + 候选 1,218）是同范围的旧科目
 *    口径，且其候选里混着热水器（属家电包）与开关插座占位价，不采用。
 *  防水人工 366 ← 计算器科目 waterproof 的 actual。经核：该科目 verified/candidate/
 *    manual/auto 全为 0，366 纯粹是 computeLabor 的防水人工——base.json 费率 20 元/㎡ ×
 *    needs_waterproof 房间面积 18.286 ㎡。（曾被误读为「材料候选价」，以数据为准纠正：
 *    未定价的是防水**材料**，不是人工。）金额虽为费率实算，但 QR-2026-10-03-03 的
 *    dedup_rule 明文「若瓦工 18,500 元预算池已含防水人工，最终报价必须去重」且未关闭，
 *    本行可能已含于泥瓦行内——去重关闭前只入暂估层（评审 P1）。
 *  泥瓦 45,071 ← PKG-060 estimated_need_cny（构成：QR-2026-10-03-04/05/06 的
 *    20,000 + 18,500 + 4,000 = 42,500，加 DEC-2026-10-16-TILE-01 终核的墙砖主材
 *    36.7236 ㎡ × 70 元/㎡ ≈ 2,571；代码断言构成和 == need）。
 *    科目 masonry 的人工 + 地砖候选与本行同范围，不另计。
 *  美缝 4,500 ← hard_finish_quote_rounds 的 QR-2026-10-03-07 登记定额
 *    （DEC-2026-08-22 暂估入账、price_type candidate、文件自述「暂估非算量」），
 *    成色只能给「定额暂估」。金额**不**取 PKG-065/130 的 planned_cny（500 + 4,000
 *    是这笔定额按 DEC-2026-10-22-R03 拆进预算的镜像，读它即违反口径 1）；
 *    config/tile-comparison.yaml grout_model 的干区实算 2,237 只作交叉核对。
 *  吊顶 18,000 ← PKG-070 estimated_need_cny（DEC-2026-10-05-R3 定标目标
 *    13,500 + 4,500，断言构成和）。科目 carpentry 的 1,714 是吊顶板面人工
 *    （40 元/㎡ × ceiling_zones），与本行同范围，不另计；窗帘盒人工在科目侧
 *    待报价显形，已含在定标目标口径内。
 *  涂装 9,357 ← 计算器科目 painting：actual（人工，paint-scope 实算面积 × base.json
 *    费率 25 元/㎡）+ candidateActual（latex_paint_01 候选材料）。PKG-080 无
 *    estimated_need，包侧没有第二个数，不构成双算。
 *  洁具 14,798 ← PKG-100 estimated_need_cny（构成 5,598 + 3,500 + 1,300 + 1,100 +
 *    1,800 + 1,500，断言构成和；不含浴霸，见 need 注解）。科目 sanitary 的 1,600
 *    只是安装人工（200 元/件 × fixture_count），与本行同范围，不另计。
 *  橱柜 13,500 ← PKG-110 estimated_need_cny（构成 12,000 + 1,500，断言构成和）。
 *    科目 kitchen_cabinet 候选（cabinet + countertop 两 topic）与本行同范围，不另计。
 *  灯具 2,500 ← 计算器科目 lighting 的 candidateActual（lighting_01 选品候选价）。
 *    QR-2026-10-03-23 的 3,000 是询价目标、非价格，不采用。
 *  烟灶 1,200 ← 计算器科目 range_hood 的 candidateActual（range_hood_01 候选价）。
 *    无独立工作包；灶具属家电包，不在本表。
 *  未定价五项 ← 包侧 components 全部 planned_cny == null 的显形登记（PKG-005 物业
 *    手续 / PKG-050 防水材料 / PKG-090 室内门 / PKG-125 开关面板 / PKG-135 踢脚线
 *    收边保洁）。科目 smart_home 的 2,000 是一口价占位选品、无逐项构成，
 *    不足以给 PKG-125 定价；switch_socket 候选 ¥18 同为占位价，均不采用。
 *  miscellaneous 科目的 1,800（hardware_01 通用五金候选）与洁具行构成里的通用
 *    五金 1,500 同范围，不另计（防双算登记里显形）。
 * ────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { ProjectCatalog } from '../../server/project-catalog.js';
import { RuleEngine } from '../../server/rule-engine.js';
import {
  BudgetCalculator,
  loadMasonryTakeoff,
  loadPaintScopeAreaByRoom,
} from '../../server/budget-calculator.js';
import { loadPaintScopeInputs } from '../../server/paint-cost-comparison.js';
import {
  compareMepQuotes,
  loadMepQuotes,
  mepQuoteFallback,
  type MepQuoteComparison,
} from '../../server/mep-quotes.js';
import {
  computeMepTakeoff,
  type MepTakeoff,
  type MepTakeoffRules,
} from '../../shared/mep-takeoff.js';
import {
  endpointSourcesFromFacts,
  parseMepCoordination,
  resolveMepRoutes,
} from '../../shared/mep-hvac-coordination-schema.js';
import type { BudgetCategory, CurrentScheme } from '../../shared/types.js';

type AnyRecord = Record<string, any>;

export const COST_SUMMARY_PATH = 'schedule/phase-1/cost.md';

/** 本表全部数据输入（指纹用；时效判定以 verify 时重算内容全等为准，此表决定报错时列哪些变更文件）。 */
export const COST_INPUT_PATHS: string[] = [
  'config/budget/base.json',
  'config/ceiling-quotes.yaml',
  'config/ceiling.yaml',
  'config/design-rules.yaml',
  'config/electrical-topology.yaml',
  'config/electrical.yaml',
  'config/house.yaml',
  'config/hvac.yaml',
  'config/layout/model-geometry.yaml',
  'config/layout/overlay.yaml',
  'config/masonry-labor.yaml',
  'config/materials.yaml',
  'config/mep-hvac-coordination.yaml',
  'config/mep-labor.yaml',
  'config/mep-quotes.yaml',
  'config/mep-takeoff.yaml',
  'config/plumbing.yaml',
  'config/tile-comparison.yaml',
  'data/current-scheme.json',
  'schedule/phase-1/control.yaml',
].sort();

/** 核实层级：verified = 已锁定或完整实算且无未决去重/待报价；provisional = 暂估（未锁价等级）。 */
export type CostTier = 'verified' | 'provisional';

export interface CostRow {
  id: string;
  name: string;
  packageIds: string[];
  /** null = 未定价：不进合计、不按 0 显示。 */
  amountCny: number | null;
  grade: string;
  derivation: string;
  /**
   * 核实层级与理由：定价行必须在登记处显式裁定（数据驱动，渲染层不临时判断），
   * buildCostSummary 对缺失 tier 的定价行直接抛错；未定价行不入层级，留空。
   */
  tier?: CostTier;
  tierReason?: string;
}

export interface ExcludedFigure {
  label: string;
  amountCny: number;
  reason: string;
}

export interface CostSummaryData {
  rows: CostRow[];
  unpriced: CostRow[];
  notSeparate: Array<{ name: string; packageIds: string[]; note: string }>;
  excluded: ExcludedFigure[];
  /** 已核实层小计（tier = verified 的行）。 */
  verifiedSubtotalCny: number;
  /** 暂估层小计（tier = provisional 的行）。 */
  provisionalSubtotalCny: number;
  /** 已知合计 = 已核实 + 暂估；只是已定价行之和，不得读作已核实成本。 */
  knownSubtotalCny: number;
}

const yuan = (value: number) => `¥${Math.round(value).toLocaleString('zh-CN')}`;
const qty = (value: number, digits = 1) => {
  const text = value.toFixed(digits);
  return text.replace(/\.?0+$/, '') || '0';
};

function pkgOf(control: AnyRecord, id: string): AnyRecord {
  const pkg = (control.work_packages ?? []).find((item: AnyRecord) => item.id === id);
  if (!pkg) throw new Error(`cost summary: control.yaml 缺工作包 ${id}`);
  return pkg;
}

function qrOf(control: AnyRecord, id: string): AnyRecord {
  const record = (control.hard_finish_quote_rounds?.records ?? []).find((item: AnyRecord) => item.id === id);
  if (!record) throw new Error(`cost summary: control.yaml 缺询价轮次记录 ${id}`);
  return record;
}

function needOf(control: AnyRecord, id: string): number {
  const need = pkgOf(control, id).budget?.estimated_need_cny;
  if (typeof need !== 'number') throw new Error(`cost summary: ${id} 缺 estimated_need_cny，成本行无来源`);
  return need;
}

/** 构成分解必须与来源金额逐分对上；对不上说明映射表已过期，先更新映射再出表。 */
function assertDecomposition(rowId: string, parts: number[], total: number): void {
  const sum = parts.reduce((acc, part) => acc + part, 0);
  if (sum !== total) {
    throw new Error(`cost summary: ${rowId} 构成分解合计 ${sum} != 来源金额 ${total}——请先更新 scripts/schedule/cost-summary.ts 的映射与推导，再重新生成`);
  }
}

function categoryOf(categories: BudgetCategory[], key: string): BudgetCategory {
  const category = categories.find((item) => item.key === key);
  if (!category) throw new Error(`cost summary: 计算器快照缺科目 ${key}`);
  return category;
}

/** 与 scripts/project/mep-takeoff.ts 完全同一条装配路径（量只有一份，不许第二套）。 */
export function computeActiveMepQuote(): { comparison: MepQuoteComparison; takeoff: MepTakeoff; areaSqm: number } {
  const rules = parseYaml(readFileSync('config/mep-takeoff.yaml', 'utf8')) as MepTakeoffRules & { sources: Record<string, string> };
  const electrical = parseYaml(readFileSync(rules.sources.electrical_points, 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['electrical'];
  const plumbing = parseYaml(readFileSync(rules.sources.plumbing_points, 'utf8')) as Parameters<typeof endpointSourcesFromFacts>[0]['plumbing'];
  const ceiling = parseYaml(readFileSync(rules.sources.ceiling, 'utf8')) as unknown[];
  const hvac = parseYaml(readFileSync(rules.sources.hvac, 'utf8')) as { plans: unknown[] };
  const coordination = parseMepCoordination(readFileSync(rules.sources.routes, 'utf8'));
  const topology = parseYaml(readFileSync(rules.sources.circuits, 'utf8')) as {
    circuits: Parameters<typeof computeMepTakeoff>[0]['circuits'];
    controls?: Parameters<typeof computeMepTakeoff>[0]['controls'];
  };
  const sources = endpointSourcesFromFacts({
    electrical,
    plumbing,
    ceiling: ceiling as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['ceiling'],
    hvac: hvac as unknown as Parameters<typeof endpointSourcesFromFacts>[0]['hvac'],
  });
  const takeoff = computeMepTakeoff({
    electrical: electrical as unknown as Parameters<typeof computeMepTakeoff>[0]['electrical'],
    plumbing: plumbing as unknown as Parameters<typeof computeMepTakeoff>[0]['plumbing'],
    circuits: topology.circuits ?? [],
    controls: topology.controls ?? [],
    routes: coordination.routes,
    resolution: resolveMepRoutes(coordination, sources),
    rules,
  });
  const house = parseYaml(readFileSync('config/house.yaml', 'utf8')) as { project?: { usable_area?: number } };
  const areaSqm = house.project?.usable_area;
  if (typeof areaSqm !== 'number' || !(areaSqm > 0)) {
    throw new Error('cost summary: config/house.yaml 的 project.usable_area 必须是正数（水电清包人工按㎡计价）');
  }
  const labor = parseYaml(readFileSync('config/mep-labor.yaml', 'utf8')) as Parameters<typeof mepQuoteFallback>[0];
  const comparisons = compareMepQuotes(loadMepQuotes(), takeoff, areaSqm, mepQuoteFallback(labor));
  const comparison = comparisons.find((entry) => entry.active);
  if (!comparison) throw new Error('cost summary: config/mep-quotes.yaml 没有生效报价卡');
  if (comparison.total == null || comparison.pendingRows.length) {
    throw new Error(`cost summary: 生效水电报价卡 ${comparison.id} 存在待报价行（${comparison.pendingRows.join(', ')}），总额不可用`);
  }
  return { comparison, takeoff, areaSqm };
}

export function buildCostSummary(control: AnyRecord): CostSummaryData {
  const catalog = ProjectCatalog.load('.');
  const rulesConfig = RuleEngine.load('config/design-rules.yaml').getConfig();
  const calculator = new BudgetCalculator(catalog, rulesConfig);
  const scheme = JSON.parse(readFileSync('data/current-scheme.json', 'utf8')) as CurrentScheme;
  const snapshot = calculator.calculate(scheme);
  const cat = (key: string) => categoryOf(snapshot.categories, key);
  /** 科目「已定价总额」口径：actual（已取证材料 + 人工）+ candidateActual（候选材料）。仅用于防双算登记与涂装行。 */
  const categoryTotal = (key: string) => Math.round(cat(key).actual + (cat(key).candidateActual ?? 0));

  const rows: CostRow[] = [];

  // ── 拆改（PKG-020）：同户型实付锚，从包说明原文解析，解析不到即抛错 ──
  {
    const description = String(pkgOf(control, 'PKG-020').description ?? '');
    const match = description.match(/拆砌人工([\d,]+)元\+物业垃圾清运([\d,]+)元/);
    if (!match) throw new Error('cost summary: PKG-020 说明里的同户型实付锚（拆砌人工+物业垃圾清运）解析失败');
    const labor = Number(match[1].replaceAll(',', ''));
    const haul = Number(match[2].replaceAll(',', ''));
    rows.push({
      id: 'cost-demolition',
      name: '拆改、墙体新建与清运',
      packageIds: ['PKG-020'],
      amountCny: labor + haul,
      grade: '参考实付',
      tier: 'provisional',
      tierReason: '同户型实付锚、非本户报价，未锁价',
      derivation: `同户型半包实付锚（PKG-020 说明原文）：拆砌人工 ${yuan(labor)} + 物业垃圾清运 ${yuan(haul)}。非本户报价，本户金额待量房后按确认图纸复核；QR-2026-10-03-01 的 ${yuan(qrOf(control, 'QR-2026-10-03-01').owner_target_cny)} 是候选目标、非价格，不采用`,
    });
  }

  // ── 中央空调（PKG-030 + PKG-140）：合同额 ──
  {
    const contracted = pkgOf(control, 'PKG-030').budget?.contracted_cny;
    if (typeof contracted !== 'number') throw new Error('cost summary: PKG-030 缺 contracted_cny');
    const qr = qrOf(control, 'QR-2026-10-03-24');
    if (qr.locked_cny !== contracted) {
      throw new Error(`cost summary: QR-2026-10-03-24 locked_cny=${qr.locked_cny} 与 PKG-030 contracted_cny=${contracted} 不一致`);
    }
    rows.push({
      id: 'cost-hvac',
      name: '中央空调',
      packageIds: ['PKG-030', 'PKG-140'],
      amountCny: contracted,
      grade: '已签约',
      tier: 'verified',
      tierReason: '已转合同、成交价锁定（合同外不含项另在未定价与待核清单登记，不属本行金额）',
      derivation: `合同额：QR-2026-10-03-24（${qr.item}）已转合同（contract_ref ${qr.contract_ref}），成交 ${yuan(contracted)}（含辅材；不含复合风管与风口加长、不含税）；本行金额 = PKG-030 的 contracted_cny。PKG-140 二次安装含在本包合同（included_in_other_package），不另计`,
    });
  }

  // ── 水电（PKG-040）：算量 × 生效报价卡 ──
  {
    const { comparison, takeoff, areaSqm } = computeActiveMepQuote();
    const total = comparison.total as number;
    const subtotalOf = (...keys: string[]) => comparison.rows
      .filter((row) => keys.includes(row.key))
      .reduce((sum, row) => sum + (row.subtotal ?? 0), 0);
    const laborPart = subtotalOf('labor_by_area');
    const laborRate = comparison.rows.find((row) => row.key === 'labor_by_area')?.per_unit;
    if (laborRate == null) throw new Error('cost summary: 生效水电报价卡缺清包人工单价');
    const wirePart = subtotalOf('wire_1_5', 'wire_2_5', 'wire_4_0', 'wire_trunk');
    const conduitPart = subtotalOf('conduit_20', 'conduit_25');
    const restPart = total - laborPart - wirePart - conduitPart;
    rows.push({
      id: 'cost-mep',
      name: '水电改造',
      packageIds: ['PKG-040'],
      amountCny: Math.round(total),
      grade: '报价卡实算',
      tier: 'verified',
      tierReason: '生效报价卡全行计价、无待报价行，由算量引擎完整实算',
      derivation: `算量 × 生效报价卡：shared/mep-takeoff.ts 按路由实算（强电计价管长 ${qty(takeoff.conduit.strongPowerTotalM)} m、导线 ${qty(takeoff.wire.totalWireM)} m，给排水与器件逐项），× config/mep-quotes.yaml 生效卡 ${comparison.id} 单价，${comparison.rows.length} 行全部计价、无待报价行——清包人工 ${yuan(laborPart)}（${qty(areaSqm, 2)} ㎡ × ${yuan(laborRate)}/㎡）、导线 ${yuan(wirePart)}、线管 ${yuan(conduitPart)}、其余管材/器件/增项 ${yuan(restPart)}，卡总额 ${yuan(total)} 取整。本行按本分支算量（平面 union 口径，DEC-2026-10-07-M02）；竖直段补计（DEC-2026-10-23-R01，PR #11）合入后约 +¥1,300，届时重生成自动更新`,
    });
  }

  // ── 防水人工（PKG-050 的人工部分）：计算器科目 waterproof 的算量费率 ──
  {
    const waterproof = cat('waterproof');
    if ((waterproof.verifiedActual ?? 0) !== 0 || (waterproof.candidateActual ?? 0) !== 0 || waterproof.manualActual !== 0 || waterproof.autoActual !== 0) {
      throw new Error('cost summary: 科目 waterproof 出现材料金额——366 元「纯人工」口径已变化，请重新裁定防水行来源');
    }
    const baseRaw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as AnyRecord;
    const wetRate = baseRaw.categories?.waterproof?.labor?.rate;
    if (typeof wetRate !== 'number') throw new Error('cost summary: base.json 的 waterproof.labor.rate 缺失');
    const wetArea = catalog.getRooms()
      .filter((room: AnyRecord) => room.needs_waterproof === true)
      .reduce((sum: number, room: AnyRecord) => sum + room.width * room.depth, 0);
    if (Math.abs(wetArea * wetRate - waterproof.actual) > 1) {
      throw new Error(`cost summary: 防水人工对不上（${qty(wetArea, 2)} ㎡ × ${wetRate} = ${qty(wetArea * wetRate, 2)}，科目 actual = ${waterproof.actual}）`);
    }
    rows.push({
      id: 'cost-waterproof-labor',
      name: '防水人工',
      packageIds: ['PKG-050'],
      amountCny: Math.round(waterproof.actual),
      grade: '算量费率',
      tier: 'provisional',
      tierReason: '费率实算，但 QR-2026-10-03-03 的 dedup_rule 未关闭——可能已含于瓦工预算池，去重确认前不入已核实层',
      derivation: `计算器科目 waterproof 的人工：费率 ${yuan(wetRate)}/㎡（config/budget/base.json 的 waterproof.labor）× 湿区面积 ${qty(wetArea, 2)} ㎡（needs_waterproof 房间——主卫、客卫、厨房、北阳台——面积合计）= ${yuan(waterproof.actual)}，仅人工；防水材料未定价（见未定价与待核清单）。**待去重确认**：QR-2026-10-03-03 的 dedup_rule 明文「若瓦工 ${yuan(18500)} 预算池已含防水人工，最终报价必须去重」，该去重尚未关闭，本行可能已含于泥瓦行的瓦工预算池内——去重关闭前只入暂估层`,
    });
  }

  // ── 泥瓦（PKG-060）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-060');
    const tileSqm = loadMasonryTakeoff(catalog).totalTileSqm;
    const wallTilePart = 2571;
    if (Math.abs(tileSqm * 70 - wallTilePart) > 1) {
      throw new Error(`cost summary: 墙砖主材对不上（${qty(tileSqm, 4)} ㎡ × 70 = ${qty(tileSqm * 70, 2)}，映射登记 ${wallTilePart}）`);
    }
    assertDecomposition('cost-masonry', [20000, 18500, 4000, wallTilePart], need);
    rows.push({
      id: 'cost-masonry',
      name: '泥瓦与铺贴',
      packageIds: ['PKG-060'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '构成含瓷砖封顶价、瓦工预算池（quote_pending）、待报价辅材与候选墙砖，均未锁价',
      derivation: `业主询价轮次（QR-2026-10-03-04/05/06）：瓷砖主材封顶 ${yuan(20000)} + 瓦工人工预算池 ${yuan(18500)} + 辅材约 ${yuan(4000)} = ${yuan(42500)}；墙砖主材按 DEC-2026-10-16-TILE-01 终核另计：masonry-takeoff 全量 ${qty(tileSqm, 4)} ㎡ × wall_tile_01 候选 ${yuan(70)}/㎡ ≈ ${yuan(wallTilePart)}；合计 = PKG-060 的 estimated_need_cny ${yuan(need)}。COST-060-05 小砖条人工约 ${yuan(394)} 待书面报价、未计入（need 口径如此）`,
    });
  }

  // ── 美缝（PKG-065 + PKG-130）：询价轮次登记定额，暂估非算量 ──
  {
    const qr = qrOf(control, 'QR-2026-10-03-07');
    const target = qr.owner_target_cny;
    if (typeof target !== 'number' || target <= 0) throw new Error('cost summary: QR-2026-10-03-07 缺 owner_target_cny');
    const tileComparison = parseYaml(readFileSync('config/tile-comparison.yaml', 'utf8')) as AnyRecord;
    const grout = tileComparison.grout_model;
    const computed = grout?.pkg130_reconciliation?.computed_need_cny;
    if (grout?.pkg130_reconciliation?.owner_target_cny !== target || typeof computed !== 'number') {
      throw new Error('cost summary: tile-comparison.yaml 的 grout_model 对账与 QR-2026-10-03-07 定额不一致');
    }
    rows.push({
      id: 'cost-grout',
      name: '美缝（全屋）',
      packageIds: ['PKG-065', 'PKG-130'],
      amountCny: target,
      grade: '定额暂估',
      tier: 'provisional',
      tierReason: '定额暂估、pending_quote，门店按米终核未取得',
      derivation: `定额暂估：DEC-2026-08-22 环氧彩砂暂估入账，QR-2026-10-03-07 登记 ${yuan(target)}（price_type: candidate、pending_quote，暂估非算量）；DEC-2026-10-22-R03 按砖缝长度估算拆两包（湿区约 56 m → PKG-065、其余全屋约 750 m → PKG-130），本表合并一行，金额取 QR 登记定额、不取两包 planned_cny。交叉核对：干区实算 ${yuan(computed)}（111.864 ㎡ × ${yuan(20)}/㎡ 包工包料，业主口述、未确认；config/tile-comparison.yaml grout_model），在定额内；门店按米终核未取得`,
    });
  }

  // ── 吊顶（PKG-070）：estimated_need = 定标目标 ──
  {
    const need = needOf(control, 'PKG-070');
    assertDecomposition('cost-ceiling', [13500, 4500], need);
    rows.push({
      id: 'cost-ceiling',
      name: '吊顶',
      packageIds: ['PKG-070'],
      amountCny: need,
      grade: '定标目标',
      tier: 'provisional',
      tierReason: '定标目标价、非成交价，裸价重报未取得',
      derivation: `业主定标后重算（DEC-2026-10-05-R3）：石膏板吊顶与窗帘盒目标 ${yuan(13500)} + 铝扣板裸价目标 ${yuan(4500)}（设备拆分后反推目标、非成交价，裸价重报待取得）= PKG-070 的 estimated_need_cny ${yuan(need)}；实际以生效报价卡 + COST-070 逐项报价为准`,
    });
  }

  // ── 涂装（PKG-080）：计算器科目 painting（人工算量费率 + 材料候选价） ──
  {
    const painting = cat('painting');
    if ((painting.verifiedActual ?? 0) !== 0 || painting.manualActual !== 0) {
      throw new Error('cost summary: 科目 painting 出现已取证/录入金额——涂装行构成已变化，请重新裁定');
    }
    const baseRaw = JSON.parse(readFileSync('config/budget/base.json', 'utf8')) as AnyRecord;
    const paintRate = baseRaw.categories?.painting?.labor?.rate;
    if (typeof paintRate !== 'number') throw new Error('cost summary: base.json 的 painting.labor.rate 缺失');
    const paintArea = [...loadPaintScopeAreaByRoom(catalog, loadPaintScopeInputs()).values()]
      .reduce((sum, area) => sum + area, 0);
    if (Math.abs(paintArea * paintRate - painting.actual) > 1) {
      throw new Error(`cost summary: 涂装人工对不上（${qty(paintArea, 2)} ㎡ × ${paintRate} = ${qty(paintArea * paintRate, 2)}，科目 actual = ${painting.actual}）`);
    }
    const paintItem = snapshot.lineItems.find((item) => item.topic === 'paint' && item.cost > 0);
    if (!paintItem) throw new Error('cost summary: 计算器快照缺 paint 材料行');
    const laborPart = Math.round(painting.actual);
    const materialPart = Math.round(painting.candidateActual ?? 0);
    rows.push({
      id: 'cost-painting',
      name: '墙顶面基层与涂装',
      packageIds: ['PKG-080'],
      amountCny: laborPart + materialPart,
      grade: '算量费率+候选价',
      tier: 'provisional',
      tierReason: '人工为静态费率、材料为候选价，均未锁价',
      derivation: `计算器科目 painting：人工 ${yuan(laborPart)} = 涂装净面积约 ${qty(paintArea, 1)} ㎡（shared/paint-scope.ts 按 overlay 的 paint_region 声明实算）× ${yuan(paintRate)}/㎡（config/budget/base.json 的 painting.labor）；材料 ${yuan(materialPart)} = 选品 ${paintItem.optionId} 候选价 ${yuan(paintItem.unitPrice)}/桶 ÷ ${qty(paintItem.coveragePerUnit)} ㎡/桶 × ${qty(paintItem.lossRate, 2)} 损耗 × 同面积`,
    });
  }

  // ── 洁具（PKG-100）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-100');
    assertDecomposition('cost-sanitary', [5598, 3500, 1300, 1100, 1800, 1500], need);
    rows.push({
      id: 'cost-sanitary',
      name: '洁具与五金',
      packageIds: ['PKG-100'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '报价轮构成含封顶价与候选项（马桶未锁定、浴室柜待报价），未锁价',
      derivation: `业主询价轮次（2026-10-03）经 DEC-2026-10-05-R12、DEC-2026-10-07-R02 两次收口：智能马桶封顶 ${yuan(5598)}（九牧 ZQ6650 cap、未锁定）+ 浴室柜 ${yuan(3500)}（主卫 ${yuan(1500)} + 客卫 ${yuan(2000)}）+ 花洒 ${yuan(1300)} + 龙头下水角阀 ${yuan(1100)} + 固定玻璃屏 ${yuan(1800)} + 通用五金 ${yuan(1500)} = PKG-100 的 estimated_need_cny ${yuan(need)}。不含浴霸：COST-100-06 业主自购待决策（QR-2026-10-05-01 ${yuan(1362)}）未计入`,
    });
  }

  // ── 橱柜（PKG-110）：estimated_need，构成断言 ──
  {
    const need = needOf(control, 'PKG-110');
    assertDecomposition('cost-cabinet', [12000, 1500], need);
    rows.push({
      id: 'cost-cabinet',
      name: '橱柜及台面',
      packageIds: ['PKG-110'],
      amountCny: need,
      grade: '报价轮实算',
      tier: 'provisional',
      tierReason: '报价轮目标构成、两轮询价均 pending_quote，未锁价',
      derivation: `业主询价轮次（QR-2026-10-03-20/21）：橱柜 + PET 柜门 + 20mm 石英石目标 ${yuan(12000)} + 水槽与厨房龙头约 ${yuan(1500)} = PKG-110 的 estimated_need_cny ${yuan(need)}`,
    });
  }

  // ── 灯具（PKG-120）：计算器科目 lighting 候选价 ──
  {
    const lighting = cat('lighting');
    if (lighting.actual !== 0 || (lighting.verifiedActual ?? 0) !== 0) {
      throw new Error('cost summary: 科目 lighting 构成已变化（出现 actual/已取证金额），请重新裁定灯具行');
    }
    const amount = Math.round(lighting.candidateActual ?? 0);
    if (amount <= 0) throw new Error('cost summary: 科目 lighting 无候选价，灯具行无来源');
    rows.push({
      id: 'cost-lighting',
      name: '基础灯具',
      packageIds: ['PKG-120'],
      amountCny: amount,
      grade: '候选价',
      tier: 'provisional',
      tierReason: '选品候选价、未取证未成交',
      derivation: `选品候选价：config/materials.yaml 的 lighting_01 ${yuan(amount)} × 1 套（计算器科目 lighting 的 candidateActual）；QR-2026-10-03-23 的 ${yuan(qrOf(control, 'QR-2026-10-03-23').owner_target_cny)} 是询价目标、非价格，不采用`,
    });
  }

  // ── 烟灶（油烟机）：计算器科目 range_hood 候选价，无独立工作包 ──
  {
    const hood = cat('range_hood');
    if (hood.actual !== 0 || (hood.verifiedActual ?? 0) !== 0) {
      throw new Error('cost summary: 科目 range_hood 构成已变化，请重新裁定烟灶行');
    }
    const amount = Math.round(hood.candidateActual ?? 0);
    if (amount <= 0) throw new Error('cost summary: 科目 range_hood 无候选价，烟灶行无来源');
    rows.push({
      id: 'cost-range-hood',
      name: '烟灶（油烟机）',
      packageIds: [],
      amountCny: amount,
      grade: '候选价',
      tier: 'provisional',
      tierReason: '选品候选价、未取证未成交',
      derivation: `选品候选价：config/materials.yaml 的 range_hood_01 ${yuan(amount)} × 1 台（计算器科目 range_hood 的 candidateActual）。无独立工作包；灶具属家电包，不在本表`,
    });
  }

  const unpriced: CostRow[] = [
    {
      id: 'unpriced-property-fees',
      name: '物业手续与物业收费',
      packageIds: ['PKG-005'],
      amountCny: null,
      grade: '未定价',
      derivation: '量未建模：金额以物业收费通知与票据为准（COST-005-01/02 均为 notice_pending）；其中可退押金属临时现金占用、非最终成本，须与本表分开记账',
    },
    {
      id: 'unpriced-waterproof-material',
      name: '防水材料',
      packageIds: ['PKG-050'],
      amountCny: null,
      grade: '未定价',
      derivation: '量未建模：COST-050-01/02 待量房后按面积、高度、涂刷遍数报价（site_measurement_pending）；base.json 的 waterproof 无材料价、无对应选品 topic。人工已按算量费率计入定价行',
    },
    {
      id: 'unpriced-doors',
      name: '室内门及厨房门',
      packageIds: ['PKG-090'],
      amountCny: null,
      grade: '未定价',
      derivation: '量已声明：室内门 4 樘 + 卫生间门 2 樘 + 厨房联动玻璃推拉门 1 组（COST-090-01/02/03，quote_pending），门洞修正待复尺；门扇价格待询价（计算器 door_count 未接通家具清单、当前为 0，不构成价格）',
    },
    {
      id: 'unpriced-switch-panels',
      name: '开关插座面板与基础智能',
      packageIds: ['PKG-125'],
      amountCny: null,
      grade: '未定价',
      derivation: '量已算出：面板点位 17 只灯控 + 56 只插座 + 6 个网口面板（COST-125-01，quantity_pending），智能开关 11 只 + 无线 6 只 + 网关 0–1 台待选型（COST-125-02，selection_pending）；面板选品未定价。计算器 switch_socket 候选 ¥18 与 smart_home 一口价候选均为占位价、无逐项构成，不采用',
    },
    {
      id: 'unpriced-finishing',
      name: '踢脚线、收边与竣工保洁',
      packageIds: ['PKG-135'],
      amountCny: null,
      grade: '未定价',
      derivation: '量未算出：踢脚线长度待完成面复核（COST-135-01，quantity_pending）、收边位置清单未形成（COST-135-02，scope_schedule_pending）、验收缺陷修复待责任判定、竣工保洁按面积报价未取得（COST-135-04，quote_pending）',
    },
  ];

  const excluded: ExcludedFigure[] = [
    { label: '科目 masonry（人工 + 地砖/墙砖候选）', amountCny: categoryTotal('masonry'), reason: '与泥瓦行同范围：包口径 estimated_need 为业主轮次口径，优先' },
    { label: '科目 water_electric（人工一口价 + 候选）', amountCny: categoryTotal('water_electric'), reason: '与水电行同范围：报价卡实算优先；且其候选混有热水器（属家电包）与开关插座占位价' },
    { label: '科目 kitchen_cabinet（柜体 + 台面候选）', amountCny: categoryTotal('kitchen_cabinet'), reason: '与橱柜行同范围：包口径 estimated_need 优先' },
    { label: '科目 sanitary（洁具安装人工）', amountCny: categoryTotal('sanitary'), reason: '只是安装人工（200 元/件 × 点位数），洁具本体在洁具行内' },
    { label: '科目 carpentry（吊顶板面人工）', amountCny: categoryTotal('carpentry'), reason: '与吊顶行同范围：只是板面人工，吊顶行是定标全包目标' },
    { label: '科目 miscellaneous（通用五金候选）', amountCny: categoryTotal('miscellaneous'), reason: 'hardware_01 候选与洁具行构成里的通用五金同范围' },
    { label: '科目 smart_home（一口价候选）', amountCny: categoryTotal('smart_home'), reason: '占位选品、无逐项构成；PKG-125 组件口径为未定价，不足以据此定价' },
    { label: '科目 hvac（选品镜像）', amountCny: categoryTotal('hvac'), reason: '与空调合同同额：来源以 control.yaml 的 contracted_cny 为准，科目侧只是镜像' },
  ];

  // 层级完整性：每条定价行必须已在登记处裁定 tier 与理由，缺失即抛错（不许渲染层猜）。
  for (const row of rows) {
    if (!row.tier || !row.tierReason) {
      throw new Error(`cost summary: 定价行 ${row.id} 缺核实层级裁定（tier/tierReason）——请先在 cost-summary.ts 登记处裁定，再重新生成`);
    }
  }
  const verifiedSubtotalCny = rows.filter((row) => row.tier === 'verified').reduce((sum, row) => sum + (row.amountCny ?? 0), 0);
  const provisionalSubtotalCny = rows.filter((row) => row.tier === 'provisional').reduce((sum, row) => sum + (row.amountCny ?? 0), 0);
  const knownSubtotalCny = verifiedSubtotalCny + provisionalSubtotalCny;
  return {
    rows,
    unpriced,
    notSeparate: [
      { name: '施工现场保护与施工位置标记', packageIds: ['PKG-010'], note: 'funding_status 为 contract_inclusion_pending：拟包含在施工合同中，未落实为合同条款前不计价（QR-2026-10-03-25 的目标为待拆分候选、非价格）' },
      { name: '中央空调第二次安装与调试', packageIds: ['PKG-140'], note: '含在中央空调行（PKG-030 合同，included_in_other_package），不另计' },
      { name: '基础硬装后的临时入住放行', packageIds: ['PKG-142'], note: '流程放行包，无独立成本' },
      { name: '竣工联合验收、整改与资料移交', packageIds: ['PKG-170'], note: '验收流程包，无独立成本' },
      { name: '硬装预备金', packageIds: ['PKG-900'], note: '预算储备，不是成本，按本表口径不列' },
    ],
    excluded,
    verifiedSubtotalCny,
    provisionalSubtotalCny,
    knownSubtotalCny,
  };
}

export function renderCostSummary(data: CostSummaryData, headerText: string): string {
  const escapeCell = (value: unknown) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>');
  let markdown = headerText;
  markdown += '本表是**成本**总表，不是预算表：每一行都是按当前数据实际算出或已有来源的价格，并标注成色与推导；没有真实价格的项目只登记为「未定价」，不填金额、不按 0 计入合计。\n\n';
  markdown += '## 口径说明\n\n';
  markdown += '- **范围**：一期硬装，**含中央空调**（hvac 池并入本表，不单列）。家具、家电、窗帘、设计准备等其他预算池不在本表。\n';
  markdown += '- **无预算数**：本表任何一行都不取 planned_cny / 批准额；预算口径见 [一期预算控制表](budget.md)。\n';
  markdown += '- **小计分三层**：**已核实小计** = 金额已锁定（签约）或由生效数据源完整实算（生效报价卡全行计价、无待报价行）、且无未决去重/待报价标记的行；**暂估小计** = 其余未锁价等级的行（封顶价、预算池、候选价、定标目标、参考实付、定额暂估，以及带未关闭去重规则的实算行）；**已知合计** = 两者之和，只是已定价行的总和，**不得读作已核实成本**。每行的层级与理由登记在生成器中，逐行可查。\n';
  markdown += '- 未定价项目将来必花钱，真实总成本必然高于已知合计，高多少要等其报价/量房后才知道。\n';
  markdown += '- **成色定义**：已签约 = 已转合同的成交价；报价卡实算 = 算量引擎实算量 × 生效报价卡单价；报价轮实算 = 业主询价轮次逐项构成的实算目标；定标目标 = 业主定标时裁定的目标价、非成交价；参考实付 = 同户型已发生的实付锚、非本户报价；算量费率 = 算量面积 × 静态费率（人工）；候选价 = 当前选品的候选价、未取证未成交；定额暂估 = 按定额登记的暂估额、非算量非报价。\n';
  markdown += '- **数据源**：`schedule/phase-1/control.yaml`（合同额、estimated_need、询价轮次）、`server/budget-calculator.ts` 科目快照（量 × 选品价）、`shared/mep-takeoff.ts` 算量 × `config/mep-quotes.yaml` 生效报价卡。映射裁定与防双算理由固化在 `scripts/schedule/cost-summary.ts` 文件头。\n\n';
  markdown += '## 硬装成本（含中央空调）\n\n';
  markdown += '| 项目 | 归属工作包 | 成本 | 成色 | 推导 |\n|---|---|---:|---|---|\n';
  for (const row of data.rows) {
    markdown += `| ${escapeCell(row.name)} | ${row.packageIds.join('、') || '—'} | ${row.amountCny == null ? '—' : yuan(row.amountCny)} | ${escapeCell(row.grade)} | ${escapeCell(row.derivation)} |\n`;
  }
  markdown += `| **已核实小计** | | **${yuan(data.verifiedSubtotalCny)}** | | 已锁定或完整实算且无未决去重/待报价标记的行之和 |\n`;
  markdown += `| **暂估小计** | | **${yuan(data.provisionalSubtotalCny)}** | | 未锁价等级的行之和（封顶/预算池/候选/目标/参考/暂估/待去重） |\n`;
  markdown += `| **已知合计（不含未定价）** | | **${yuan(data.knownSubtotalCny)}** | | 已核实 + 暂估，共 ${data.rows.length} 行；未定价 ${data.unpriced.length} 项不在内，本行不是已核实成本 |\n`;
  markdown += '\n## 未定价（必花但尚无真实价格，不计入小计）\n\n';
  markdown += '| 项目 | 归属工作包 | 成本 | 量与价格现状 |\n|---|---|---|---|\n';
  for (const row of data.unpriced) {
    markdown += `| ${escapeCell(row.name)} | ${row.packageIds.join('、') || '—'} | 未定价 | ${escapeCell(row.derivation)} |\n`;
  }
  markdown += '\n## 不单独计价\n\n';
  for (const item of data.notSeparate) {
    markdown += `- **${escapeCell(item.name)}**（${item.packageIds.join('、')}）：${escapeCell(item.note)}。\n`;
  }
  markdown += '\n## 防双算登记（科目侧同范围数字，未采用）\n\n';
  markdown += '计算器科目视图与本表是同一所房子的两套切分：下列科目数字与上表行同范围，一律不另计，只登记备查。\n\n';
  markdown += '| 科目侧数字 | 金额 | 不采用理由 |\n|---|---:|---|\n';
  for (const figure of data.excluded) {
    markdown += `| ${escapeCell(figure.label)} | ${yuan(figure.amountCny)} | ${escapeCell(figure.reason)} |\n`;
  }
  return markdown;
}
