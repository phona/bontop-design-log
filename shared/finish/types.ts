/**
 * 面层范围核查（finish-scope）的配置契约与严重级语义。
 *
 * 与防穿模层同构的铁律：
 * - 配置**只许加严、不许放宽**：规则内部可降级，配置声明的 severity 是下限。
 * - 豁免必须带 reason/owner/expires；到期自动复活。
 * - 代码实现了但配置没申报 → 报错；配置申报了但代码没实现 → 报错。覆盖矩阵不许说谎。
 *
 * 这一层补的洞：漆/砖/防水台/吊顶都是「面层声明」，各自圈一片墙或一片顶。
 * 声明之间互相压（漆盖住砖、同侧重复声明、声明挂在不属于自己房间的墙上）时，
 * **面积数字不会报错，3D 里也看不出来**——漆是 inspection-only 半透明叠加层，
 * 要开开关、转视角、而且「压了 0.3㎡」肉眼判不了。所以必须有一层专职核查。
 */

export type FinishSeverity = 'error' | 'warning' | 'info';

/** issue 级别：severityFloor 可能把 warning 降到 info（被豁免/被规则内部降级）。 */
export type FinishIssueLevel = 'error' | 'warning' | 'info';

export const SEVERITY_RANK: Record<FinishSeverity, number> = { error: 2, warning: 1, info: 0 };

/** 配置里的一条规则申报。severity 是下限，规则内部可自行降级。 */
export interface FinishRuleSpec {
  id: string;
  /** 该规则产出的全部 issue code（登记表，也用于豁免匹配）。 */
  codes: string[];
  /** 参与比对的声明类别，仅用于人读与登记，不参与判定。 */
  kinds: string;
  severity: FinishSeverity;
  enabled: boolean;
  note?: string;
}

/** 带保质期的豁免。没有 reason 的豁免视为谎言。 */
export interface FinishWaiverSpec {
  id: string;
  /** 被豁免的规则 id。 */
  rule: string;
  /** 被豁免的实体对（两个声明 id，顺序无关）。 */
  pair: [string, string];
  reason: string;
  owner: string;
  /** YYYY-MM-DD；到期后豁免失效并复活。 */
  expires: string;
}

export interface FinishLintConfig {
  version: number;
  rules: FinishRuleSpec[];
  waivers?: FinishWaiverSpec[];
  /** 判定容差（米）。水平/竖向重叠小于此值不算压。 */
  tolerance?: number;
  note?: string;
}

/** 配置 severity 是下限：只在比规则自判级别更严时生效。 */
export function severityFloor(issueLevel: string, configured: FinishSeverity): 'error' | 'warning' | 'info' {
  const issueRank = issueLevel === 'error' ? 2 : issueLevel === 'warning' ? 1 : 0;
  return issueRank >= SEVERITY_RANK[configured] ? (issueLevel as 'error' | 'warning' | 'info') : configured;
}

export function sameFinishPair(a: string, b: string, pair: [string, string]): boolean {
  return (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]);
}
