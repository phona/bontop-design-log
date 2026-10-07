/**
 * 吊顶主材参考成本区间（DEC-2026-10-08-C09 建立，C10 改为证据台账 + 可核实价格优先）。
 *
 * 定位：回答一个问题——**施工方包工包料里留给材料的那 95 元/㎡，够不够买这一套东西**。
 * 结构层的真实成本不是一个点，而是一个区间（公开零售价不透明、经销商与工程渠道差异大），
 * 所以本模块只做「区间对账 + 三态判定」，不做「贵/便宜」的市场判断。
 *
 * 铁律（写进 config/ceiling-material-cost.yaml 头部，这里落地）：
 *  1. 只记区间，不写死单价；每条价格都要带 `observations[]` 证据台账，没台账的数不入库；
 *  2. 张价 → 元/㎡ 一律折算，且**按每条观察自己的规格折算**（家装 1200×2400 与工程
 *     3000×1200 差一倍，混算会得出离谱的每平米价）；
 *  3. 面积口径只有一份：`shared/ceiling-takeoff.ts` 的石膏板净面积，本模块不另立口径；
 *  4. 材料额度 = 包工包料 − 纯人工，两个单价由调用方传入（takeoff 与报价卡都可能变）；
 *  5. 证据分级：verified > comparable > owner_reported，off_spec 与「在售无价」只登记不折算；
 *  6. 结论只出三态 + 余量 + 贴上限告警，不出「贵/便宜」的市场判断。
 *
 * 与 paint-cost-comparison 同构：声明式范围 + 显式口径 + 逐项对账，算不出就 throw，
 * 由路由降级成 503，绝不静默凑数。
 */
import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import type { CeilingTakeoff } from '../shared/ceiling-takeoff.js';

export const CEILING_MATERIAL_COST_PATH = 'config/ceiling-material-cost.yaml';

/** 证据等级。observed_at + source + caliber 三件套缺一即视为无台账。 */
export type CeilingMaterialGrade =
  | 'verified'
  | 'comparable'
  | 'comparable_off_spec'
  | 'owner_reported'
  | 'in_stock_no_price'
  | 'product_confirmed';

/** 计价基准：哪种单价能折算进 元/㎡，哪种不能。 */
export type CeilingMaterialBasis = 'per_sheet' | 'per_sqm' | 'per_metre_derived' | 'per_metre_unconverted';

export interface CeilingMaterialRange {
  min: number;
  max: number;
}

export interface CeilingMaterialObservation {
  grade: CeilingMaterialGrade;
  /** per_metre_derived：这条米价对应哪个构件（主龙骨/副龙骨/边龙骨），靠它匹配 usage。 */
  component?: string;
  /** 单价（单点价）；与 min/max 二选一。 */
  rate?: number;
  /** 区间价（业主口径这类给不出单点价的用）。 */
  min?: number;
  max?: number;
  unit?: string;
  /** 本条观察自己的板材规格（㎡/张）。缺省用条目级的 sheet_size_m2。 */
  sheet_size_m2?: number;
  source: string;
  observed_at: string;
  caliber: string;
  url?: string;
}

export interface CeilingMaterialItemConfig {
  id: string;
  layer: string;
  name: string;
  spec: string;
  basis: CeilingMaterialBasis;
  /** 条目级板材规格（㎡/张）；per_sheet 必填，per_metre_unconverted 可省。 */
  sheet_size_m2?: number;
  observations: CeilingMaterialObservation[];
  note?: string;
}

/** 用量口径：把「元/米」折算成「元/㎡」的必要输入。 */
export interface CeilingMaterialUsage {
  id: string;
  component: string;
  /** 手抄的用量（米/㎡）；`source: takeoff_perimeter` 时由代码实算，此处应为 null。 */
  metres_per_sqm?: number;
  /** 用量区间（间距取规范上下限时用）。 */
  range?: [number, number];
  /** `takeoff_perimeter` = 本案吊顶周长 ÷ 面积，代码实算，禁止手抄。 */
  source?: string;
  basis: string;
  source_note?: string;
  status: 'unconfirmed' | 'model_derived' | 'model_derived_upper_bound' | 'confirmed';
}

export interface CeilingMaterialCostConfig {
  version: number;
  /** 面积口径取自 takeoff 的哪个工艺类别（当前只有石膏板走这套主材结构）。 */
  area_basis: 'gypsum_board' | 'curtain_box' | 'aluminum_buckle' | 'drying_rack';
  /** 龙骨用量口径（米/㎡）。per_metre_derived 项必须能在里面找到每个构件的用量。 */
  usage_assumptions?: CeilingMaterialUsage[];
  items: CeilingMaterialItemConfig[];
  contractor_rates: {
    /** 分形态口径（C12）。有它就用它算材料额度，不用 flat_only 的近似口径。 */
    forms?: CeilingMaterialContractorForm[];
    /** 旧口径：全部按一个 元/㎡ 价（把边吊也按平米算 → 低估边吊 → 低估材料额度）。 */
    flat_only_per_sqm?: { turnkey: number; labor_only: number };
  };
}

/** 施工方的分形态单价（DEC-2026-10-08-C12）：边吊按米、平顶按㎡。 */
export interface CeilingMaterialContractorForm {
  form: 'edge_drop' | 'flat';
  unit: string;
  turnkey_per_unit: number;
  labor_only_per_unit: number;
}

/** 判定用的区间来自哪一档证据——决定结论的可信度，必须显形。 */
export type CeilingMaterialBasisUsed = 'verified' | 'comparable' | 'owner_reported';

/** per_metre_derived 的逐构件折算明细（米价 × 用量），让 28～37 这个数可复核。 */
export interface CeilingMaterialDerivedComponent {
  component: string;
  rateYuanPerMetre: number;
  rateGrade: CeilingMaterialGrade;
  rateSource: string;
  metresPerSqm: [number, number];
  usageStatus: CeilingMaterialUsage['status'];
  usageBasis: string;
  perSqm: [number, number];
}

export interface CeilingMaterialItemResult {
  id: string;
  layer: string;
  name: string;
  spec: string;
  basis: CeilingMaterialBasis;
  /** 本条目的证据台账原样回显（API 消费者要能看到来源与口径）。 */
  observations: CeilingMaterialObservation[];
  /** 参与折算的区间；null = 本项没有可用价格，不进合计。 */
  perSqm: CeilingMaterialRange | null;
  /** perSqm 由哪档证据得出；null = 未定价。 */
  basisUsed: CeilingMaterialBasisUsed | null;
  /** 折算依据（可读字符串）：张价项写「80÷2.9768≈26.9」。 */
  derivation: string | null;
  /** 型材米价等**不可折算**的证据：有价、缺用量假设，只登记。 */
  unconvertedEvidence: CeilingMaterialObservation[];
  /** 规格不符/起订量不符/型号不适用等**不折算**的证据。 */
  offSpecEvidence: CeilingMaterialObservation[];
  /** per_metre_derived 的逐构件折算明细。 */
  derivedComponents: CeilingMaterialDerivedComponent[];
  /** 只证明「买得到/产品存在」的证据。 */
  existenceOnlyEvidence: CeilingMaterialObservation[];
  /** 对账面积（㎡）——与 takeoff 同源，不是第二套面积。 */
  areaSqm: number;
  /** 区间下限 × 面积 / 上限 × 面积（元）。 */
  totalRange: CeilingMaterialRange | null;
  itemNote?: string;
}

export type CeilingMaterialVerdict = 'below_range' | 'within_range' | 'above_range';

export interface CeilingMaterialCostResult {
  areaBasis: CeilingMaterialCostConfig['area_basis'];
  areaSqm: number;
  items: CeilingMaterialItemResult[];
  /** 材料合计区间（元/㎡）与对账面积上的金额区间（元）。只累计「有价格」的项。 */
  materialPerSqm: CeilingMaterialRange;
  materialTotal: CeilingMaterialRange;
  /** 每项证据档位的分布：让结论的可信度一眼可见。 */
  evidenceMix: Record<CeilingMaterialBasisUsed, string[]>;
  /**
   * 敏感性对照：**全部按 owner_reported 口径**的合计（即业主/施工方转述数字隐含的材料成本）。
   * 与 materialPerSqm 的差 = 「未核实数据」对结论的影响幅度。
   * 业主口径只在部分项有数，缺的项沿用 best-available 值，并在此注明。
   */
  ownerOnlyPerSqm: CeilingMaterialRange;
  ownerOnlyTotal: CeilingMaterialRange;
  ownerOnlyCoverage: { covered: string[]; missing: string[] };
  /** 施工方材料额度 = 包工包料 − 纯人工（元/㎡）。 */
  contractor: {
    laborOnlyPerSqm: number;
    turnkeyPerSqm: number;
    allowancePerSqm: number;
    /** 额度怎么算出来的（分形态 / 旧口径），让结论可复核。 */
    basis: 'forms' | 'flat_only';
    /** 分形态逐项明细。 */
    formBreakdown?: Array<{
      form: string;
      quantity: number;
      unit: string;
      turnkeyYuan: number;
      laborOnlyYuan: number;
      materialYuan: number;
    }>;
  };
  /** 额度相对参考区间的判定与余量。 */
  verdict: CeilingMaterialVerdict;
  slackVsMinYuanPerSqm: number;
  slackVsMaxYuanPerSqm: number;
  /** 未确认假设与口径提醒（显形，不藏）。 */
  warnings: string[];
}

function fail(message: string): never {
  throw new Error(`ceiling-material-cost: ${message}`);
}

const GRADES: CeilingMaterialGrade[] = [
  'verified', 'comparable', 'comparable_off_spec', 'owner_reported', 'in_stock_no_price', 'product_confirmed',
];
const BASIS: CeilingMaterialBasis[] = ['per_sheet', 'per_sqm', 'per_metre_derived', 'per_metre_unconverted'];

function parseRange(value: unknown, label: string): [number, number] {
  if (typeof value !== 'object' || value === null) fail(`${label} 必须是对象`);
  const record = value as Record<string, unknown>;
  const rate = record.rate;
  const min = record.min;
  const max = record.max;
  const hasRate = rate !== undefined;
  const hasRange = min !== undefined || max !== undefined;
  if (hasRate === hasRange) fail(`${label} 必须且只能给一种：rate（单点价）或 min/max（区间）`);
  if (hasRate) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) fail(`${label}.rate 必须是正数`);
    return [rate as number, rate as number];
  }
  for (const [key, raw] of [['min', min], ['max', max]] as const) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) fail(`${label}.${key} 必须是正数（区间不写 0，也不写「待定」占位）`);
  }
  if ((min as number) > (max as number)) fail(`${label}.min 不能大于 max`);
  return [min as number, max as number];
}

function parseObservation(value: unknown, label: string): CeilingMaterialObservation {
  if (typeof value !== 'object' || value === null) fail(`${label} 必须是对象`);
  const record = value as Record<string, unknown>;
  if (typeof record.grade !== 'string' || !GRADES.includes(record.grade as CeilingMaterialGrade)) {
    fail(`${label}.grade 必须是 ${GRADES.join('/')}`);
  }
  const grade = record.grade as CeilingMaterialGrade;
  for (const field of ['source', 'observed_at', 'caliber']) {
    if (typeof record[field] !== 'string' || !(record[field] as string).trim()) {
      fail(`${label}.${field} 必填——没有台账的价格不入库（grade=${grade}）`);
    }
  }
  // 「在售无价 / 仅确认存在」这两档本来就没有价格，跳过价格解析
  if (grade !== 'in_stock_no_price' && grade !== 'product_confirmed') {
    parseRange(record, `${label}`);
  }
  if (record.sheet_size_m2 !== undefined && (typeof record.sheet_size_m2 !== 'number' || !(record.sheet_size_m2 > 0))) {
    fail(`${label}.sheet_size_m2 必须是正数（规格写错会静默算错每平米价）`);
  }
  return {
    grade,
    ...(record.component !== undefined ? { component: record.component as string } : {}),
    ...(record.rate !== undefined ? { rate: record.rate as number } : {}),
    ...(record.min !== undefined ? { min: record.min as number } : {}),
    ...(record.max !== undefined ? { max: record.max as number } : {}),
    ...(record.unit !== undefined ? { unit: record.unit as string } : {}),
    ...(record.sheet_size_m2 !== undefined ? { sheet_size_m2: record.sheet_size_m2 as number } : {}),
    source: record.source as string,
    observed_at: record.observed_at as string,
    caliber: record.caliber as string,
    ...(record.url !== undefined ? { url: record.url as string } : {}),
  };
}

function parseUsage(value: unknown, label: string): CeilingMaterialUsage {
  if (typeof value !== 'object' || value === null) fail(`${label} 必须是对象`);
  const record = value as Record<string, unknown>;
  for (const field of ['id', 'component', 'basis', 'status']) {
    if (typeof record[field] !== 'string' || !(record[field] as string).trim()) fail(`${label} 缺少 ${field}`);
  }
  const allowedStatus = ['unconfirmed', 'model_derived', 'model_derived_upper_bound', 'confirmed'];
  if (!allowedStatus.includes(record.status as string)) fail(`${label}.status 必须是 ${allowedStatus.join('/')}`);
  const fromTakeoff = record.source === 'takeoff_perimeter';
  if (fromTakeoff && record.metres_per_sqm !== undefined) {
    fail(`${label}：source 为 takeoff_perimeter 时**不许手抄** metres_per_sqm，由代码从 takeoff 周长实算`);
  }
  if (!fromTakeoff && typeof record.metres_per_sqm !== 'number') {
    fail(`${label}.metres_per_sqm 必须是正数（或把 source 设为 takeoff_perimeter 让代码实算）`);
  }
  if (record.range !== undefined) {
    const usageRange = record.range as unknown[];
    if (!Array.isArray(usageRange) || usageRange.length !== 2 || usageRange.some((v) => typeof v !== 'number' || !(v > 0))) {
      fail(`${label}.range 必须是 [min, max] 且均为正数`);
    }
    if ((usageRange[0] as number) > (usageRange[1] as number)) fail(`${label}.range min 不能大于 max`);
  }
  return {
    id: record.id as string,
    component: record.component as string,
    ...(record.metres_per_sqm !== undefined ? { metres_per_sqm: record.metres_per_sqm as number } : {}),
    ...(record.range !== undefined ? { range: [(record.range as unknown[])[0] as number, (record.range as unknown[])[1] as number] } : {}),
    ...(fromTakeoff ? { source: 'takeoff_perimeter' } : {}),
    basis: record.basis as string,
    ...(record.source_note !== undefined ? { source_note: record.source_note as string } : {}),
    status: record.status as CeilingMaterialUsage['status'],
  };
}

/** 读 + 校验配置。任何结构问题直接抛错（fail closed），不猜、不补默认值。 */
export function parseCeilingMaterialCost(raw: string): CeilingMaterialCostConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    fail(`YAML 解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
  const data = parsed as Record<string, unknown> | null;
  if (typeof data !== 'object' || data === null) fail('文件不是 YAML 对象');
  if (data.version !== 1) fail(`version 必须为 1（实测 ${String(data.version)}）`);
  const allowedBasis = ['gypsum_board', 'curtain_box', 'aluminum_buckle', 'drying_rack'];
  if (typeof data.area_basis !== 'string' || !allowedBasis.includes(data.area_basis)) {
    fail(`area_basis 必须是 ${allowedBasis.join('/')}`);
  }
  if (!Array.isArray(data.items) || data.items.length === 0) fail('items 必须是非空数组');

  const items: CeilingMaterialItemConfig[] = [];
  const seen = new Set<string>();
  for (const entry of data.items as unknown[]) {
    if (typeof entry !== 'object' || entry === null) fail('items 条目必须是对象');
    const record = entry as Record<string, unknown>;
    for (const field of ['id', 'layer', 'name', 'spec']) {
      if (typeof record[field] !== 'string' || !(record[field] as string).trim()) fail(`items 条目缺少 ${field}`);
    }
    const id = record.id as string;
    if (seen.has(id)) fail(`材料 id 重复：${id}`);
    seen.add(id);
    if (typeof record.basis !== 'string' || !BASIS.includes(record.basis as CeilingMaterialBasis)) {
      fail(`${id}.basis 必须是 ${BASIS.join('/')}`);
    }
    const basis = record.basis as CeilingMaterialBasis;
    if (basis === 'per_sheet') {
      if (typeof record.sheet_size_m2 !== 'number' || !(record.sheet_size_m2 > 0)) {
        fail(`${id}.sheet_size_m2 必须填（张价折算靠它；规格不同要写在观察级）`);
      }
    }
    if (!Array.isArray(record.observations) || record.observations.length === 0) {
      fail(`${id}.observations 必须是非空数组——没有证据台账的价格不入库`);
    }
    items.push({
      id,
      layer: record.layer as string,
      name: record.name as string,
      spec: record.spec as string,
      basis,
      ...(record.sheet_size_m2 !== undefined ? { sheet_size_m2: record.sheet_size_m2 as number } : {}),
      observations: (record.observations as unknown[]).map((obs, index) => parseObservation(obs, `${id}.observations[${index}]`)),
      ...(record.note !== undefined ? { note: record.note as string } : {}),
    });
  }

  const rates = data.contractor_rates as Record<string, unknown> | undefined;
  if (typeof rates !== 'object' || rates === null) fail('contractor_rates 必须是对象');
  const forms: CeilingMaterialContractorForm[] = [];
  if (Array.isArray(rates!.forms)) {
    for (const entry of rates!.forms as unknown[]) {
      if (typeof entry !== 'object' || entry === null) fail('contractor_rates.forms 条目必须是对象');
      const record = entry as Record<string, unknown>;
      if (record.form !== 'edge_drop' && record.form !== 'flat') fail('contractor_rates.forms.form 必须是 edge_drop/flat');
      if (typeof record.unit !== 'string' || !record.unit) fail('contractor_rates.forms.unit 必须是非空字符串');
      for (const field of ['turnkey_per_unit', 'labor_only_per_unit']) {
        if (typeof record[field] !== 'number' || !Number.isFinite(record[field] as number) || (record[field] as number) <= 0) {
          fail(`contractor_rates.forms.${field} 必须是正数`);
        }
      }
      if ((record.turnkey_per_unit as number) <= (record.labor_only_per_unit as number)) {
        fail(`contractor_rates.forms.${String(record.form)}：包工包料必须大于纯人工，否则材料额度为负`);
      }
      forms.push({
        form: record.form as 'edge_drop' | 'flat',
        unit: record.unit as string,
        turnkey_per_unit: record.turnkey_per_unit as number,
        labor_only_per_unit: record.labor_only_per_unit as number,
      });
    }
  }
  const flatOnly = rates!.flat_only_per_sqm as Record<string, unknown> | undefined;
  if (flatOnly !== undefined) {
    for (const field of ['turnkey', 'labor_only']) {
      if (typeof flatOnly[field] !== 'number' || !Number.isFinite(flatOnly[field] as number) || (flatOnly[field] as number) <= 0) {
        fail(`contractor_rates.flat_only_per_sqm.${field} 必须是正数`);
      }
    }
    if ((flatOnly.turnkey as number) <= (flatOnly.labor_only as number)) {
      fail('contractor_rates.flat_only_per_sqm：包工包料必须大于纯人工');
    }
  }
  if (forms.length === 0 && flatOnly === undefined) {
    fail('contractor_rates 必须给 forms（分形态）或 flat_only_per_sqm（旧口径）之一');
  }

  const usageAssumptions = data.usage_assumptions !== undefined
    ? (data.usage_assumptions as unknown[]).map((entry, index) => parseUsage(entry, `usage_assumptions[${index}]`))
    : [];
  if (items.some((item) => item.basis === 'per_metre_derived') && usageAssumptions.length === 0) {
    fail('有 per_metre_derived 项就必须给 usage_assumptions 用量口径——没有用量的米价不许折算');
  }

  return {
    version: 1,
    area_basis: data.area_basis as CeilingMaterialCostConfig['area_basis'],
    usage_assumptions: usageAssumptions,
    items,
    contractor_rates: {
      ...(forms.length > 0 ? { forms } : {}),
      ...(flatOnly !== undefined
        ? { flat_only_per_sqm: { turnkey: flatOnly.turnkey as number, labor_only: flatOnly.labor_only as number } }
        : {}),
    },
  };
}

export function loadCeilingMaterialCost(path: string = CEILING_MATERIAL_COST_PATH): CeilingMaterialCostConfig {
  return parseCeilingMaterialCost(readFileSync(path, 'utf8'));
}

/**
 * 张价折算 / 面积价取值一律取整到元。
 * 必须取整：参考区间表读起来是「27～29 元/㎡」，留一位小数会与归档表差 0.x——
 * 这种「代码算的数和表对不上」正是本项目反复在治的口径漂移。
 */
const roundMoney = (value: number): number => Math.round(value + Number.EPSILON);
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** 该项是否真的存在 owner_reported 口径（用于 sensitivity 的覆盖率，别把 best-available 冒充业主口径）。 */
function hasOwnerRate(config: CeilingMaterialCostConfig, itemId: string): boolean {
  const item = config.items.find((entry) => entry.id === itemId);
  if (!item) return false;
  return item.observations.some((obs) => obs.grade === 'owner_reported' && (obs.rate !== undefined || obs.min !== undefined));
}

/** 取面积：口径只有一份，绝不在这里另立公式。 */
function areaFor(config: CeilingMaterialCostConfig, takeoff: CeilingTakeoff): number {
  switch (config.area_basis) {
    case 'gypsum_board': return takeoff.gypsumBoardM2;
    case 'curtain_box': return takeoff.curtainBoxM2;
    case 'aluminum_buckle': return takeoff.aluminumBuckleM2;
    case 'drying_rack': return takeoff.dryingRackM2;
    default: return fail(`未知 area_basis：${String(config.area_basis)}`);
  }
}

const unitPerSqm = (observation: CeilingMaterialObservation, fallback: number | undefined): number => {
  const sheet = observation.sheet_size_m2 ?? fallback;
  if (sheet === undefined || !(sheet > 0)) {
    fail(`观察「${observation.source}」要折算每张价必须给 sheet_size_m2（条目级或观察级）`);
  }
  return sheet;
};

/**
 * 区间对账：把参考区间与施工方材料额度摆到同一把尺子上。
 *
 * 不输出「贵/便宜」——本项目没有南宁本地进货单，只输出三态与余量：
 *  - below_range：额度低于参考下限，材料可能被降档或以次充好，必须核进货单；
 *  - within_range：额度落在区间内，配合验收前提即可接受；
 *  - above_range：额度高于参考上限，可能是渠道价高、含运输/利润，或配置与声明不符。
 */
export function computeCeilingMaterialCost(
  config: CeilingMaterialCostConfig,
  takeoff: CeilingTakeoff,
): CeilingMaterialCostResult {
  const areaSqm = areaFor(config, takeoff);
  if (!(areaSqm > 0)) fail(`area_basis ${config.area_basis} 的实算面积为 ${areaSqm}，无法对账`);

  const items: CeilingMaterialItemResult[] = [];
  const warnings: string[] = [];
  const evidenceMix: Record<CeilingMaterialBasisUsed, string[]> = { verified: [], comparable: [], owner_reported: [] };

  for (const item of config.items) {
    const observations = item.observations;
    const convertible: Array<{ grade: 'verified' | 'comparable' | 'owner_reported'; observation: CeilingMaterialObservation; range: [number, number] }> = [];
    const derived: CeilingMaterialObservation[] = [];
    const usageFor = (component: string): CeilingMaterialUsage | undefined =>
      config.usage_assumptions?.find((usage) => usage.component === component);
    const unconverted: CeilingMaterialObservation[] = [];
    const offSpec: CeilingMaterialObservation[] = [];
    const existenceOnly: CeilingMaterialObservation[] = [];

    for (const observation of observations) {
      if (observation.grade === 'in_stock_no_price' || observation.grade === 'product_confirmed') {
        existenceOnly.push(observation);
        continue;
      }
      if (observation.grade === 'comparable_off_spec') {
        offSpec.push(observation);
        continue;
      }
      if (item.basis === 'per_metre_unconverted' && (observation.unit ?? '').includes('米') && !(observation.unit ?? '').includes('平米')) {
        // 型材按**米**计价：单价可核实，但每平米用量没声明 → 有价也不能折算，只登记。
        // 注意同样是本条目下若有人给了 元/㎡ 的区间（业主口径的折算后估计），那是**面积口径**，
        // 可以参与合计，但必须标 owner_reported——它的折算依据（每平米龙骨米数）同样没声明。
        unconverted.push(observation);
        continue;
      }
      if (item.basis === 'per_metre_derived' && observation.rate !== undefined && observation.component !== undefined) {
        // 有构件归属的米价按「米价 × 用量」逐构件折算；缺 component 的米价一律进不可折算
        if (!usageFor(observation.component)) {
          fail(`${item.id}：观察「${observation.source}」声明了构件 ${observation.component}，但 usage_assumptions 里没有它的用量口径`);
        }
        derived.push(observation);
        continue;
      }
      const [min, max] = parseRange(observation, `${item.id} 的观察`);
      convertible.push({ grade: observation.grade as 'verified' | 'comparable' | 'owner_reported', observation, range: [min, max] });
    }

    // 折算：张价按各自规格 ÷ sheet，面积价直接取。entries 与 perSqm 一一对应，
    // 便于 derivation 写出「用了哪一条观察的哪个规格」。
    const toPerSqm = (entry: { grade: 'verified' | 'comparable' | 'owner_reported'; observation: CeilingMaterialObservation; range: [number, number] }): [number, number] => {
      if (item.basis === 'per_sheet') {
        const sheet = unitPerSqm(entry.observation, item.sheet_size_m2);
        return [roundMoney(entry.range[0] / sheet), roundMoney(entry.range[1] / sheet)];
      }
      return [roundMoney(entry.range[0]), roundMoney(entry.range[1])];
    };

    type Folded = { grade: 'verified' | 'comparable' | 'owner_reported'; observation: CeilingMaterialObservation; range: [number, number]; perSqm: [number, number] };
    const fold = (grade: 'verified' | 'comparable' | 'owner_reported'): Folded[] =>
      convertible.filter((entry) => entry.grade === grade).map((entry) => ({ ...entry, perSqm: toPerSqm(entry) }));

    // 逐构件折算：米价 × 用量。边龙骨用量由 takeoff 周长实算，不手抄。
    const derivedComponents: CeilingMaterialDerivedComponent[] = [];
    for (const observation of derived) {
      const usage = usageFor(observation.component!)!;
      let metres: [number, number];
      if (usage.source === 'takeoff_perimeter') {
        const perimeter = takeoff.byClass[config.area_basis].perimeterM;
        const value = round2(perimeter / areaSqm);
        metres = [value, value];
      } else {
        metres = usage.range ?? [usage.metres_per_sqm!, usage.metres_per_sqm!];
      }
      const rate = observation.rate!;
      derivedComponents.push({
        component: usage.component,
        rateYuanPerMetre: rate,
        rateGrade: observation.grade,
        rateSource: observation.source,
        metresPerSqm: metres,
        usageStatus: usage.status,
        usageBasis: usage.basis,
        perSqm: [roundMoney(metres[0] * rate), roundMoney(metres[1] * rate)],
      });
    }
    const derivedRange: CeilingMaterialRange | null = derivedComponents.length > 0
      ? {
          min: roundMoney(derivedComponents.reduce((sum, c) => sum + c.perSqm[0], 0)),
          max: roundMoney(derivedComponents.reduce((sum, c) => sum + c.perSqm[1], 0)),
        }
      : null;
    if (derivedComponents.length > 0) {
      const unconfirmed = derivedComponents.filter((c) => c.usageStatus === 'unconfirmed');
      if (unconfirmed.length > 0) {
        warnings.push(
          `${item.name}：${unconfirmed.map((c) => c.component).join('、')} 的每平米用量来自规范区间与行业算例、**未经施工图确认**，随间距取值波动`,
        );
      }
      if (derivedComponents.some((c) => c.rateGrade !== 'verified')) {
        warnings.push(`${item.name}：折算用的米价全部是 comparable（同品牌不同系列），蓝臻系列本身无公开成交价，实际价应不低于此`);
      }
      const upperBound = derivedComponents.filter((c) => c.usageStatus === 'model_derived_upper_bound');
      if (upperBound.length > 0) {
        warnings.push(
          `${item.name}：${upperBound.map((c) => `${c.component} ${c.metresPerSqm[0]} 米每平米`).join('、')} 取的是**全部分区周长上界**，真实边龙骨只沿墙与错台边缘（本案分区碎，10 区周长 70.95m ÷ 23.222㎡），实际用量低于此值，须现场核定`,
        );
      }
    }

    const verified = fold('verified');
    const comparable = fold('comparable');
    const owner = fold('owner_reported');

    const pick = (list: Folded[]): CeilingMaterialRange | null => {
      if (list.length === 0) return null;
      return { min: Math.min(...list.map((r) => r.perSqm[0])), max: Math.max(...list.map((r) => r.perSqm[1])) };
    };
    const verifiedRange = pick(verified);
    const comparableRange = pick(comparable);
    const ownerRange = pick(owner);
    // per_metre_derived：构件折算结果优先于任何「直接给 元/㎡」的口径（包括业主的区间），
    // 因为它是唯一可复核的（米价 × 用量，两项都有来源）。
    const perSqm = derivedRange ?? verifiedRange ?? comparableRange ?? ownerRange;
    /** 构件折算结果的档位 = 用到的米价里最低的一档（有 verified 用 verified，否则 comparable）。 */
    const derivedGrade: CeilingMaterialBasisUsed | null = derivedComponents.length === 0 ? null
      : derivedComponents.every((c) => c.rateGrade === 'verified') ? 'verified'
        : derivedComponents.some((c) => c.rateGrade === 'comparable') ? 'comparable'
          : 'owner_reported';
    const basisUsed: CeilingMaterialBasisUsed | null =
      derivedGrade ?? (verifiedRange ? 'verified' : comparableRange ? 'comparable' : ownerRange ? 'owner_reported' : null);
    if (basisUsed) evidenceMix[basisUsed].push(item.name);

    let derivation: string | null = null;
    if (perSqm && basisUsed === null) fail(`${item.id}：有区间却判不出证据档位`);
    if (perSqm && basisUsed) {
      if (derivedRange) {
        const parts = derivedComponents.map(
          (c) => `${c.component} ${c.rateYuanPerMetre}元/米 × ${c.metresPerSqm[0]}${c.metresPerSqm[1] !== c.metresPerSqm[0] ? `～${c.metresPerSqm[1]}` : ''}米每平米 = ${c.perSqm[0]}${c.perSqm[1] !== c.perSqm[0] ? `～${c.perSqm[1]}` : ''}`,
        );
        derivation = `${parts.join('；')} → 合计 ${perSqm.min}～${perSqm.max} 元每平米（${basisUsed}，用量口径见 usage_assumptions）`;
      } else {
        const chosen = basisUsed === 'verified' ? verified : basisUsed === 'comparable' ? comparable : owner;
        if (item.basis === 'per_sheet') {
          const sheet = unitPerSqm(chosen[0].observation, item.sheet_size_m2);
          derivation = `${chosen[0].range[0]}/${chosen[0].range[1]} 元每张 ÷ ${sheet}㎡ ≈ ${perSqm.min}～${perSqm.max} 元每平米（${basisUsed}）`;
        } else {
          derivation = `按面积取值 ${perSqm.min}～${perSqm.max} 元每平米（${basisUsed}）`;
        }
      }
    }

    // 口径告警：规格不同的证据一律显形，绝不混算
    if (offSpec.length > 0) {
      warnings.push(
        `${item.name}：有 ${offSpec.length} 条可核实价因规格/起订量与本案不符只登记不折算（${offSpec.map((o) => `${o.rate ?? o.min}${o.unit ?? ''}@${o.sheet_size_m2 ?? '?'}㎡：${o.caliber.slice(0, 24)}…`).join('；')}）`,
      );
    }
    if (basisUsed === 'comparable') {
      warnings.push(`${item.name}：无本案型号的可核实成交价，区间取**同级旁证**价，判定必须标注 comparable`);
    }
    if (basisUsed === 'owner_reported') {
      warnings.push(`${item.name}：只有业主转述口径、无可核实来源，区间标 owner_reported`);
    }
    if (basisUsed === null) {
      warnings.push(`${item.name}：没有任何可用价格，未计入材料合计——必须补价`);
    }
    if (item.basis === 'per_metre_unconverted' && unconverted.length > 0) {
      warnings.push(
        `${item.name}：型材米价可核实（${unconverted.map((o) => `${o.rate}${o.unit ?? ''}`).join('、')}），但每平米用量（吊杆/主副龙骨间距、边龙骨周长）未声明，无法折算成 元/㎡`,
      );
    }
    if (item.sheet_size_m2 === undefined && item.basis === 'per_sheet' && perSqm) {
      warnings.push(`${item.name}：条目级 sheet_size_m2 未声明，折算口径不可复核`);
    }
    if (item.spec.includes('未确认')) {
      warnings.push(`${item.name}：规格本身未确认，折算结果随规格变化（${item.spec}）`);
    }

    items.push({
      id: item.id,
      layer: item.layer,
      name: item.name,
      spec: item.spec,
      basis: item.basis,
      observations,
      perSqm,
      basisUsed,
      derivation,
      unconvertedEvidence: unconverted,
      offSpecEvidence: offSpec,
      derivedComponents,
      existenceOnlyEvidence: existenceOnly,
      areaSqm,
      totalRange: perSqm ? { min: round2(perSqm.min * areaSqm), max: round2(perSqm.max * areaSqm) } : null,
      ...(item.note !== undefined ? { itemNote: item.note } : {}),
    });
  }

  // 敏感性对照：每项都取 owner_reported 档（对 per_metre_derived 项就是业主的 元/㎡ 区间）
  const ownerRanges = new Map(config.items.map((item) => {
    const areaObservation = item.observations.find((obs) => obs.grade === 'owner_reported' && obs.unit !== undefined && obs.unit.includes('㎡'));
    const result = items.find((entry) => entry.id === item.id)!;
    let range: CeilingMaterialRange | null = null;
    if (item.basis === 'per_metre_derived' || item.basis === 'per_sqm') {
      if (areaObservation) {
        const [min, max] = areaObservation.min !== undefined && areaObservation.max !== undefined
          ? [areaObservation.min, areaObservation.max]
          : [areaObservation.rate!, areaObservation.rate!];
        range = { min: roundMoney(min), max: roundMoney(max) };
      }
    } else if (item.basis === 'per_sheet') {
      const sheet = item.observations.find((obs) => obs.grade === 'owner_reported');
      if (sheet && item.sheet_size_m2) {
        const [min, max] = sheet.min !== undefined && sheet.max !== undefined ? [sheet.min, sheet.max] : [sheet.rate!, sheet.rate!];
        range = { min: roundMoney(min / item.sheet_size_m2), max: roundMoney(max / item.sheet_size_m2) };
      }
    }
    return [item.id, range ?? result.perSqm] as const;
  }));
  const ownerOnlyPerSqm: CeilingMaterialRange = {
    min: roundMoney([...ownerRanges.values()].reduce((sum, r) => sum + (r?.min ?? 0), 0)),
    max: roundMoney([...ownerRanges.values()].reduce((sum, r) => sum + (r?.max ?? 0), 0)),
  };
  const ownerOnlyTotal: CeilingMaterialRange = {
    min: round2([...ownerRanges.values()].reduce((sum, r) => sum + (r?.min ?? 0) * areaSqm, 0)),
    max: round2([...ownerRanges.values()].reduce((sum, r) => sum + (r?.max ?? 0) * areaSqm, 0)),
  };
  const ownerOnlyCoverage = {
    covered: config.items.filter((item) => hasOwnerRate(config, item.id)).map((item) => item.name),
    missing: config.items.filter((item) => !hasOwnerRate(config, item.id)).map((item) => item.name),
  };

  const priced = items.filter((item) => item.perSqm !== null);
  const materialPerSqm: CeilingMaterialRange = {
    min: roundMoney(priced.reduce((sum, item) => sum + (item.perSqm?.min ?? 0), 0)),
    max: roundMoney(priced.reduce((sum, item) => sum + (item.perSqm?.max ?? 0), 0)),
  };
  const materialTotal: CeilingMaterialRange = {
    min: round2(priced.reduce((sum, item) => sum + (item.totalRange?.min ?? 0), 0)),
    max: round2(priced.reduce((sum, item) => sum + (item.totalRange?.max ?? 0), 0)),
  };

  // 材料额度：优先按施工方**分形态口径**算（C12），回落到旧口径「一个 元/㎡」。
  // 分形态口径更准：边吊按米报价，把它按平米算会系统性低估额度（本案低估 27.71 元每平米）。
  const forms = config.contractor_rates.forms;
  const formBreakdown: CeilingMaterialCostResult['contractor']['formBreakdown'] = [];
  let laborOnly: number;
  let turnkey: number;
  let allowancePerSqm: number;
  if (forms && forms.length > 0) {
    const quantityFor = (form: 'edge_drop' | 'flat'): { quantity: number; unit: string } => {
      if (form === 'edge_drop') return { quantity: takeoff.edgeDropLinearM, unit: '元/m' };
      return { quantity: takeoff.flatNetAreaM2, unit: '元/㎡' };
    };
    let turnkeyTotal = 0;
    let laborTotal = 0;
    for (const form of forms) {
      const { quantity } = quantityFor(form.form);
      if (!(quantity > 0)) fail(`分形态 ${form.form} 的实算量为 ${quantity}，无法算材料额度`);
      const turnkeyYuan = round2(form.turnkey_per_unit * quantity);
      const laborYuan = round2(form.labor_only_per_unit * quantity);
      turnkeyTotal += turnkeyYuan;
      laborTotal += laborYuan;
      formBreakdown.push({
        form: form.form,
        quantity: round2(quantity),
        unit: form.unit,
        turnkeyYuan,
        laborOnlyYuan: laborYuan,
        materialYuan: round2(turnkeyYuan - laborYuan),
      });
    }
    laborOnly = round2(laborTotal / areaSqm);
    turnkey = round2(turnkeyTotal / areaSqm);
    allowancePerSqm = round2(turnkey - laborOnly);
    if (allowancePerSqm <= 0) fail('分形态口径下材料额度 ≤ 0，单价给错了');
  } else {
    const flatOnly = config.contractor_rates.flat_only_per_sqm!;
    laborOnly = flatOnly.labor_only;
    turnkey = flatOnly.turnkey;
    allowancePerSqm = round2(turnkey - laborOnly);
  }

  const verdict: CeilingMaterialVerdict =
    allowancePerSqm < materialPerSqm.min ? 'below_range'
      : allowancePerSqm > materialPerSqm.max ? 'above_range'
        : 'within_range';
  const slackVsMin = round2(allowancePerSqm - materialPerSqm.min);
  const slackVsMax = round2(allowancePerSqm - materialPerSqm.max);

  if (verdict === 'below_range') {
    warnings.push(`材料额度 ${allowancePerSqm} 元/㎡ 低于参考下限 ${materialPerSqm.min} 元/㎡，验收时必须核进货单与材料型号，防止降档或以次充好`);
  }
  if (verdict === 'above_range') {
    warnings.push(`材料额度 ${allowancePerSqm} 元/㎡ 高于参考上限 ${materialPerSqm.max} 元/㎡，需确认是渠道价、含运输/利润，还是实际配置与声明不符`);
  }
  if (verdict === 'within_range') {
    const headroom = round2(materialPerSqm.max - allowancePerSqm);
    if (headroom >= 0 && headroom <= 10) {
      warnings.push(`材料额度距参考上限只剩 ${headroom} 元/㎡：若实际拿货价偏上限（如 C7 按同级耐潮/耐水板拿货）或龙骨用量高于参照，材料侧没有余量`);
    }
  }
  if (evidenceMix.verified.length === 0) {
    warnings.push('全部区间都无可核实来源（owner_reported），本判定只能当询价起点，不能当成本结论');
  }
  warnings.push('区间不含施工方利润与风险金，也不含超高费、垃圾清运与成品保护——那些应计入人工侧，不能拿材料额度去对');
  const straddles = ownerOnlyPerSqm.min <= allowancePerSqm && ownerOnlyPerSqm.max >= allowancePerSqm
    && !(materialPerSqm.min <= allowancePerSqm && materialPerSqm.max >= allowancePerSqm);
  if (straddles) {
    warnings.push(
      `两个口径给出不同结论：全按业主转述口径算是 ${ownerOnlyPerSqm.min}～${ownerOnlyPerSqm.max} 元/㎡（95 落在区间内），按可核实/可折算口径算是 ${materialPerSqm.min}～${materialPerSqm.max} 元/㎡（95 低于下限）。下限差 ${round2(materialPerSqm.min - ownerOnlyPerSqm.min)} 元/㎡、上限差 ${round2(materialPerSqm.max - ownerOnlyPerSqm.max)} 元/㎡，全部来自未核实数据——这正是必须核进货单的原因`,
    );
  }
  warnings.push(`面积口径为 takeoff 的 ${config.area_basis} 净面积（欧松板满铺结构）；若改欧松板局部加强，欧松板项要按实际用量单独重估`);

  return {
    areaBasis: config.area_basis,
    areaSqm,
    items,
    materialPerSqm,
    materialTotal,
    ownerOnlyPerSqm,
    ownerOnlyTotal,
    ownerOnlyCoverage,
    evidenceMix,
    contractor: {
      laborOnlyPerSqm: laborOnly,
      turnkeyPerSqm: turnkey,
      allowancePerSqm,
      basis: forms && forms.length > 0 ? 'forms' : 'flat_only',
      ...(formBreakdown.length > 0 ? { formBreakdown } : {}),
    },
    verdict,
    slackVsMinYuanPerSqm: slackVsMin,
    slackVsMaxYuanPerSqm: slackVsMax,
    warnings,
  };
}
