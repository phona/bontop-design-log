/**
 * 构件 blocker 完整性门禁（issue #98 第六阶段 S2-A「状态上对象」）。
 *
 * 回答一个问题：**每个 pending / undeclared 的构件，都说清了自己卡在谁、什么事件能解锁、
 * 什么条件下反转吗？** 这是「intent / blocker 归档到对象本体」（业主裁定②）的机器形态——
 * 没有这条门禁，「把 blocker 写上对象」就只是一次性搬运，下一个人加构件时照样留空。
 *
 * 设计约束（与 shared/element-state.ts 同规格）：
 * 1. **纯函数、零 I/O**：输入由调用方注入（采集结果 + 派生状态），CLI / 测试 / server 共用。
 * 2. **只读对象，不查表**：判定依据全部来自 config 里构件自己的 `status` / `blocker` 字段，
 *    不读 docs/pending-site-data.md、不读 DEC——状态是对象的声明，不是查表查出来的结果。
 * 3. **覆盖矩阵不许说谎**：这里有且只有一条规则（pending/undeclared ⟹ blocker 四字段齐备），
 *    实现与声明一一对应，没有第二个「也算合法」的分支。
 */

import type { BlockerKind, BlockerOwner, ComponentBlocker, ComponentStatus } from './types.js';

/** `blocker.kind` 的合法枚举（schema 侧同一份，双处显形防漂移）。 */
export const BLOCKER_KINDS: readonly BlockerKind[] = [
  'site_measurement',
  'pending_selection',
  'pending_vendor_drawing',
  'pending_adjudication',
  'unclosed_conflict',
];

/** `blocker.owner` 的合法枚举。 */
export const BLOCKER_OWNERS: readonly BlockerOwner[] = [
  '业主', '设计', '量房', '厂家', '商家', '电工', '柜商', '运营商', '物业', '燃气公司',
];

/** 需要 blocker 的状态词。 */
export const BLOCKER_REQUIRED_STATUSES: readonly ComponentStatus[] = ['pending', 'undeclared'];

/** 采集器从配置里读到的构件最小描述（与 ElementInput 同源，少一个字段就少一处耦合）。 */
export interface BlockerSubject {
  id: string;
  kind: string;
  /** 构件自己声明的 `status` 原值（可能缺省）。 */
  status?: string;
  /** 构件自己声明的 `blocker`（可能缺省）。 */
  blocker?: ComponentBlocker;
}

export interface BlockerIssue {
  /** 构件 objectId（如 `electrical:sock_child_ac`）。 */
  id: string;
  kind: string;
  code:
    | 'blocker_missing'
    | 'blocker_kind_invalid'
    | 'blocker_owner_missing'
    | 'blocker_owner_invalid'
    | 'blocker_trigger_empty'
    | 'blocker_reverses_if_empty'
    | 'blocker_rationale_empty';
  message: string;
}

export interface BlockerGateResult {
  issues: BlockerIssue[];
  /** 受门禁管辖的构件数（derived status ∈ {pending, undeclared}）。 */
  checked: number;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 门禁本体：对每个 `derivedStatus ∈ {pending, undeclared}` 的构件，
 * 要求它带一个结构完整的 `blocker`。
 *
 * `derivedStatus` 由调用方从 `deriveElementStates` 的结果取——不在这里重算状态，
 * 避免第二套优先级逻辑。缺 `status` 声明的构件若被派生为 undeclared 同样在管辖范围内
 * （「未申报」也是一种要说清卡在什么的状态）。
 */
export function checkBlockers(subjects: BlockerSubject[], derivedStatus: (subject: BlockerSubject) => string | undefined): BlockerGateResult {
  const issues: BlockerIssue[] = [];
  let checked = 0;
  for (const subject of subjects) {
    const status = derivedStatus(subject);
    if (!status || !BLOCKER_REQUIRED_STATUSES.includes(status as ComponentStatus)) continue;
    checked += 1;
    const blocker = subject.blocker;
    const fail = (code: BlockerIssue['code'], message: string): void => {
      issues.push({ id: subject.id, kind: subject.kind, code, message });
    };
    if (!blocker) {
      fail('blocker_missing', `status=${status} 的构件必须声明 blocker（kind/owner/trigger/reverses_if/rationale）`);
      continue;
    }
    if (!BLOCKER_KINDS.includes(blocker.kind)) {
      fail('blocker_kind_invalid', `blocker.kind "${String(blocker.kind)}" 不在枚举内：${BLOCKER_KINDS.join(' / ')}`);
    }
    if (!Array.isArray(blocker.owner) || blocker.owner.length === 0) {
      fail('blocker_owner_missing', 'blocker.owner 必须是非空数组（可多值，但至少要有人负责）');
    } else {
      for (const owner of blocker.owner) {
        if (!BLOCKER_OWNERS.includes(owner)) {
          fail('blocker_owner_invalid', `blocker.owner "${String(owner)}" 不在枚举内：${BLOCKER_OWNERS.join(' / ')}`);
        }
      }
    }
    if (!isNonEmpty(blocker.trigger)) fail('blocker_trigger_empty', 'blocker.trigger 不能为空（什么事件能解锁）');
    if (!isNonEmpty(blocker.reverses_if)) fail('blocker_reverses_if_empty', 'blocker.reverses_if 不能为空（什么条件下结论反转）');
    if (!isNonEmpty(blocker.rationale)) fail('blocker_rationale_empty', 'blocker.rationale 不能为空（为什么卡）');
  }
  return { issues, checked };
}

/** 把 issue 渲染成一行人类可读的文本（CLI 与测试共用）。 */
export function formatBlockerIssue(issue: BlockerIssue): string {
  return `${issue.id} [${issue.code}] ${issue.message}`;
}
