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

/** 带保质期的豁免。没有 reason 的豁免视为谎言。 */
export interface WaiverSpec {
  id: string;
  /** 被豁免的规则 id。 */
  rule: string;
  /** 被豁免的实体对（两个 runtime id，顺序无关）。 */
  pair: [string, string];
  reason: string;
  owner: string;
  /** YYYY-MM-DD；到期后豁免失效并复活为 error。 */
  expires: string;
}

export type MepParticipationPolicy = 'excluded' | 'solid';

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
}

/** 配置 severity 是下限：只在比规则自判级别更严时生效。 */
export function severityFloor(issueLevel: string, configured: PenetrationSeverity): 'error' | 'warning' | 'info' {
  const issueRank = issueLevel === 'error' ? 2 : issueLevel === 'warning' ? 1 : 0;
  return issueRank >= SEVERITY_RANK[configured] ? (issueLevel as 'error' | 'warning' | 'info') : configured;
}

export function samePair(a: string, b: string, pair: [string, string]): boolean {
  return (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]);
}
