/**
 * 防穿模规则层的配置契约与严重级语义。
 *
 * 设计约束（与项目既有铁律一致）：
 * - 配置**只许加严、不许放宽**：规则内部可降级（如家具接触容差），配置声明的
 *   severity 是下限，永远盖不住规则自己判出的 error。
 * - 豁免必须带 reason/owner/expires；到期自动复活为 error。
 * - 代码里实现了但配置没申报的规则 → 报错；配置申报了但代码没实现 → 报错。
 *   覆盖矩阵不许说谎。
 */

export type PenetrationSeverity = 'error' | 'warning';

export const SEVERITY_RANK: Record<PenetrationSeverity, number> = { error: 2, warning: 1 };

/** 配置里的一条规则申报。severity 是下限，规则内部可自行降级。 */
export interface PenetrationRuleSpec {
  id: string;
  /** 该规则产出的全部 issue code（登记表，也用于豁免匹配）。 */
  codes: string[];
  /** 参与的物体对类别，仅用于人读与登记，不参与判定。 */
  kinds: string;
  severity: PenetrationSeverity;
  enabled: boolean;
  note?: string;
}

/**
 * 关系语义类型：这两件家具为什么合法重叠。
 *
 * 2026-10-09 原 `config/spatial-validation.yaml` 的 `relationships` 白名单整体迁入
 * 本配置的 `waivers[]`，`type` 随迁到 `WaiverSpec.kind`——不丢信息，也不让「合法重叠」
 * 的语义退化成一句没有类型的 reason。
 */
export type RelationshipKind = 'stacked' | 'attached' | 'contained';

/** 带保质期的豁免。没有 reason 的豁免视为谎言。 */
export interface WaiverSpec {
  id: string;
  /** 被豁免的规则 id。 */
  rule: string;
  /** 被豁免的实体对（两个 runtime id，顺序无关）。 */
  pair: [string, string];
  /**
   * 语义类型（原 relationships 的 `type`）：stacked 叠放 / attached 咬合依附 /
   * contained 内含。**只作人读与登记，不参与豁免判定**——判定永远只按
   * 「rule + 稳定 runtime id 对」匹配，因此补错 kind 不会悄悄放行任何一对。
   */
  kind?: RelationshipKind;
  reason: string;
  owner: string;
  /** YYYY-MM-DD；到期后豁免失效并复活为 error。 */
  expires: string;
}

export type MepParticipationPolicy = 'excluded' | 'solid';

// ── 活动包络（envelope）申报：shadow-only ──────────────────────────────────
// 现行规则只验默认静态状态。「用起来才穿模」（门扇开启弧、推拉门开启态、电器门/
// 抽屉/拉篮/椅子拉出、衣柜平开门 vs 床）不可见。活动包络补这一洞，但**只进
// report.shadow、不计入 errors/warnings、不影响退出码**（见 shared/penetration/
// envelopes.ts）。铁律：不许猜几何——每个包络都从已声明数据推导，未申报的类型
// 不生成包络并显形为 envelope_undeclared（info）。
export type EnvelopeKind = 'door_swing' | 'sliding_open' | 'appliance_door' | 'drawer' | 'chair_pullout' | 'wardrobe_door';

/** 世界象限方向（北=-z / 南=+z / 西=-x / 东=+x）。 */
export type WorldFace = 'north' | 'south' | 'east' | 'west';

/**
 * 单个家具类型的活动包络申报。**只登记有依据的类型**（依据写在 declared_basis：
 * config/house.yaml 注释、docs/、或厂家常识）；未登记的类型不生成包络，并在 shadow
 * 汇总里显形为 envelope_undeclared——符合「未申报 → 显形，不猜」。
 */
export interface FurnitureEnvelopeSpec {
  /** 稳定申报 id，进 Git diff 可评审；也作为 shadow 命中的 enabled_by。 */
  id: string;
  /** 登记的 placed 类型。 */
  type: string;
  kind: EnvelopeKind;
  /**
   * 门/抽屉/柜门朝哪个世界象限开（appliance_door / drawer / wardrobe_door 平开 /
   * chair_pullout 固定方向）。wardrobe 平开门用它定正面；拉出用 pullout_axis 时留空。
   */
  open_face?: WorldFace;
  /** appliance_door：开启时机门向 open_face 探出的净空（米）。厂家安装净空常识值。 */
  swing_m?: number;
  /** drawer：抽屉/拉篮沿 open_face 拉出的行程（米）。 */
  extend_m?: number;
  /** chair_pullout：椅子拉出距离（米）。 */
  pullout_m?: number;
  /**
   * chair_pullout：拉出方向来源。'backrest' = 从 FixtureFactory recipe 的靠背所在
   * local -z 推导，按该 placed 的 rotation 旋转（不猜固定世界向）；缺省用 open_face。
   */
  pullout_axis?: 'backrest';
  /** wardrobe_door 平开：单扇门宽（米）。 */
  leaf_width_m?: number;
  /** wardrobe_door 平开：扇数。 */
  leaf_count?: number;
  /** wardrobe_door 推拉：扇厚（米），开启态包络≈静态正面 + 扇厚（贴面滑移，近似无外探）。 */
  sliding?: boolean;
  panel_thickness_m?: number;
  /**
   * wardrobe_door：门扇所在的模型局部轴（'local+z' / 'local-z'），正面世界向由该轴按 placed
   * rotation 推导（贴最近世界象限）。用于同一类型多个 placed 朝向相反时（如 wardrobe_180 一靠
   * 南墙一靠北墙）。依据 = FixtureFactory 门板局部坐标（wardrobe_180 门板在 local -z、
   * master_north_wall_wardrobe_950 门板在 local +z）。设了它就以它为准，忽略 open_face。
   */
  door_face_axis?: 'local+z' | 'local-z';
  /** 依据出处（必填）：让「为什么这个类型有包络、朝这个方向」可评审、可追溯。 */
  declared_basis: string;
}

/** 门扇开启弧的扇形近似参数（shadow-only）。 */
export interface DoorSwingEnvelopeConfig {
  enabled?: boolean;
  /** 90° 扇形近似为 N 个有向盒（扇形→有向盒的近似误差见 envelopes.ts 注释）。 */
  wedges?: number;
  note?: string;
}

export interface SlidingOpenEnvelopeConfig {
  enabled?: boolean;
  note?: string;
}

export interface EnvelopeConfig {
  door_swing?: DoorSwingEnvelopeConfig;
  sliding_open?: SlidingOpenEnvelopeConfig;
  /** 按类型申报的家具活动包络。 */
  furniture?: FurnitureEnvelopeSpec[];
  note?: string;
}

export interface MepParticipationSpec {
  types: string[];
  /** excluded：不作为实体参与互撞（当前口径，穿墙由 MEP 专项校验负责）；
   *  solid：按实体参与墙穿透检查。 */
  policy: MepParticipationPolicy;
  note?: string;
}

export interface AntiPenetrationConfig {
  version: number;
  rules: PenetrationRuleSpec[];
  sibling_policy?: {
    /** 同一 runtime 实体只应产生一条采集记录；多条即假阳来源，按不变式测试兜底。 */
    one_entry_per_entity: boolean;
    note?: string;
  };
  mep_parts?: {
    participation: MepParticipationSpec[];
    note?: string;
  };
  waivers?: WaiverSpec[];
  /** 活动包络申报（shadow-only，见 EnvelopeConfig）。不影响任何 error/warning/退出码。 */
  envelopes?: EnvelopeConfig;
}

/** 配置 severity 是下限：只在比规则自判级别更严时生效。 */
export function severityFloor(issueLevel: string, configured: PenetrationSeverity): 'error' | 'warning' | 'info' {
  const issueRank = issueLevel === 'error' ? 2 : issueLevel === 'warning' ? 1 : 0;
  return issueRank >= SEVERITY_RANK[configured] ? (issueLevel as 'error' | 'warning' | 'info') : configured;
}

export function samePair(a: string, b: string, pair: [string, string]): boolean {
  return (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]);
}
