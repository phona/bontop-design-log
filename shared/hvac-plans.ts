/**
 * HVAC 方案的**配置→选项**映射（2026-10-13「预算计算架构根治」阶段 3）。
 *
 * 为什么要有这个文件：单价原先硬编码在 `shared/houseData.ts` 的七套 invented 报价表里
 * （A1 30,500 / A2 29,000 / A3 24,000 / … / F2 31,500 + 七个 invented 区间），
 * 而合同成交价是 36,000（DEC-2026-10-04-R1）——业主端看到的空调金额与合同不一致，
 * 且那七套表没有任何一条带 `status`，候选价门控只能把它们整体归「未取证」。
 * 现在**选型、单价、取证态都从 config/hvac.yaml 读**，本文件只做「YAML → 选项」的纯映射，
 * 不碰文件系统（server 侧读文件、app 侧用 `?raw` 导入，两边共用同一份逻辑）。
 *
 * 铁律：
 *   - 一台一价：`commercial.price_cny` 缺失或不是有限数字 → 抛错。
 *     「没有价格的方案」进预算就是静默归零（cost = price × 1 = 0），那是「静默发明」的反面，
 *     同一类病。要留未定价方案就先把它从 plans 里摘掉。
 *   - `data.status` 由 `commercial.status` 透传，候选价门控（autoActualBucket）据此分流，
 *     不再需要 SYNTHETIC_UNVERIFIED_TOPICS 白名单。
 */
import type { DesignOption, IndoorUnit, OutdoorUnit } from './types.js';

/** config/hvac.yaml 里本模块要用的子集（其余字段由 hvac-lint / render-facts 消费）。 */
export interface HvacPlanCommercial {
  status: string;
  price_cny: number;
  currency?: string;
  decided_at?: string;
  decision_ref?: string;
  vendor?: string;
  price_basis?: string;
  scope_note?: string;
  source_refs?: string[];
}

export interface HvacPlanOutdoor {
  /** 平台 id（如 west_platform）；与 `location` 二选一。 */
  platform?: string;
  location?: OutdoorUnit['location'];
  width?: number;
  depth?: number;
  height?: number;
  w?: number;
  d?: number;
  h?: number;
}

export interface HvacPlanRoom {
  room: string;
  indoor?: string;
  note?: string;
}

export interface HvacPlanConfig {
  id: string;
  kind?: string;
  name?: string;
  summary?: string;
  commercial: HvacPlanCommercial;
  outdoor?: HvacPlanOutdoor;
  outdoors?: HvacPlanOutdoor[];
  load_design?: { rooms?: HvacPlanRoom[] };
}

export interface HvacPlansFile {
  plans?: unknown;
}

/** 一个方案映射出来的选项（server 的 DesignOption 与 app 的 TopicOption 共用）。 */
export interface HvacPlanOption {
  id: string;
  name: string;
  description: string;
  price_per_unit: number;
  coverage_per_unit: 1;
  loss_rate: 1;
  data: Record<string, unknown>;
  outdoorUnits: OutdoorUnit[];
  indoorUnits: IndoorUnit[];
}

function fail(message: string): never {
  throw new Error(`hvac-plans: ${message}`);
}

const OUTDOOR_LOCATIONS: readonly OutdoorUnit['location'][] = ['platform', 'entry_garden', 'south_balcony'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, field: string, planId: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${planId}.outdoor.${field} 必须是有限数字`);
  return value;
}

function toOutdoorUnit(raw: unknown, planId: string): OutdoorUnit {
  if (!isRecord(raw)) fail(`${planId}.outdoor 必须是对象`);
  // 位置：优先 location（枚举直填），否则按 platform 归到 'platform'。
  // 不猜第三种可能——位置决定 3D 摆在哪，猜错就是把外机画到墙里。
  let location: OutdoorUnit['location'];
  if (typeof raw.location === 'string') {
    if (!OUTDOOR_LOCATIONS.includes(raw.location as OutdoorUnit['location'])) {
      fail(`${planId}.outdoor.location「${raw.location}」不在 ${OUTDOOR_LOCATIONS.join('/')}`);
    }
    location = raw.location as OutdoorUnit['location'];
  } else if (typeof raw.platform === 'string' && raw.platform) {
    location = 'platform';
  } else {
    fail(`${planId}.outdoor 既没有 location 也没有 platform，外机无法定位`);
  }
  return {
    location,
    w: numberField(raw, raw.w !== undefined ? 'w' : 'width', planId),
    d: numberField(raw, raw.d !== undefined ? 'd' : 'depth', planId),
    h: numberField(raw, raw.h !== undefined ? 'h' : 'height', planId),
  };
}

function toIndoorUnits(plan: HvacPlanConfig): IndoorUnit[] {
  const rooms = plan.load_design?.rooms ?? [];
  return rooms.map((room) => ({
    roomId: room.room,
    // 多联机风管/双出风内机都藏吊顶里；分体挂机/柜机今天没有 plans 条目，进来了也要显式写 kind。
    type: plan.kind === 'vrf_ducted' ? 'ceiling' as const : fail(`${plan.id}.kind「${String(plan.kind)}」未登记内机安装形式`),
    ...(room.indoor !== undefined ? { note: room.indoor } : {}),
  }));
}

/** config/hvac.yaml 的 plans → 选项清单。形状不对直接抛错（fail closed），不猜、不补默认值。 */
export function hvacPlanOptions(doc: unknown): HvacPlanOption[] {
  const file = (isRecord(doc) ? doc : {}) as HvacPlansFile;
  if (!Array.isArray(file.plans) || file.plans.length === 0) {
    fail('config/hvac.yaml 的 plans 必须是非空数组（没有方案 = 没有空调，不能静默按 0 元计）');
  }
  const seen = new Set<string>();
  return file.plans.map((entry) => {
    if (!isRecord(entry)) fail('plans 条目必须是对象');
    const plan = entry as unknown as HvacPlanConfig;
    if (typeof plan.id !== 'string' || !plan.id) fail('plans 条目缺少 id');
    if (seen.has(plan.id)) fail(`plans id 重复：${plan.id}`);
    seen.add(plan.id);
    if (!isRecord(plan.commercial)) fail(`${plan.id} 缺 commercial{...}（单价与取证态的唯一入口）`);
    if (typeof plan.commercial.status !== 'string' || !plan.commercial.status) {
      fail(`${plan.id}.commercial.status 必须是非空字符串（候选价门控按它分流）`);
    }
    const price = plan.commercial.price_cny;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      fail(`${plan.id}.commercial.price_cny 必须是非负数字；没有价格的方案不许进预算（会静默变成 0 元）`);
    }
    const outdoors = plan.outdoors ?? (plan.outdoor !== undefined ? [plan.outdoor] : []);
    return {
      id: plan.id,
      name: typeof plan.name === 'string' && plan.name ? plan.name : plan.id,
      description: typeof plan.summary === 'string' ? plan.summary : '',
      price_per_unit: price,
      coverage_per_unit: 1,
      loss_rate: 1,
      // data 整条摊开：候选价门控只读 data.status，app 端读 rooms/outdoor/commercial。
      data: {
        ...entry,
        id: plan.id,
        status: plan.commercial.status,
        price_cny: price,
        commercial: plan.commercial,
      },
      outdoorUnits: outdoors.map((outdoor) => toOutdoorUnit(outdoor, plan.id)),
      indoorUnits: toIndoorUnits(plan),
    } satisfies HvacPlanOption;
  });
}

/** app 端把同一份选项包成 TopicOption（server 端包成 DesignOption），外壳不同、值相同。 */
export function hvacTopicOptions(doc: unknown): Array<{
  id: string;
  name: string;
  description: string;
  price: number;
  data: Record<string, unknown>;
}> {
  return hvacPlanOptions(doc).map((option) => ({
    id: option.id,
    name: option.name,
    description: option.description,
    price: option.price_per_unit,
    data: option.data,
  }));
}
