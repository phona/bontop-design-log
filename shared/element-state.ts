/**
 * 构件级工程状态派生：把散在配置 / 待决台账 / DEC / 门禁结论里的「置信度」收敛成
 * **每个构件一条记录**，让 3D 与 agent 能用同一套语言回答「这东西确认了吗」。
 *
 * 三条设计约束：
 * 1. **纯函数、零 I/O**：所有输入由调用方注入（配置数组、台账、issue、状态模型）。
 *    CLI / server / app 三方共用同一实现，与 `shared/ceiling-takeoff.ts` 同规格。
 * 2. **只派生，不存储**：权威仍在原处（config 字段 / pending 台账 / DEC / verifier），
 *    本模块不成为第二份真相。派生不出来的状态是 `undeclared`——一种要显形的状态，
 *    不是「默认已确认」。
 * 3. **优先级可评审**：规则顺序与 `status_vocabulary` 状态词映射来自
 *    `config/state-model.yaml`（调用方注入后经 `model` 参数进来），代码只提供谓词；
 *    配置申报了代码没有的规则 → warning（覆盖矩阵不许说谎）。
 */

export type ElementStatus = 'measured' | 'confirmed' | 'inferred' | 'pending' | 'conflicted' | 'undeclared';

export type ElementKind =
  | 'electrical' | 'plumbing' | 'ceiling' | 'furniture' | 'hvac'
  | 'mep_route' | 'room' | 'wall' | 'opening' | 'material' | 'budget';

/** 调用方从配置里收集到的构件最小描述。id 与 3D `userData.objectId` 同源。 */
export interface ElementInput {
  id: string;
  kind: ElementKind;
  label: string;
  room?: string;
  /** config 的 `status` / `position_status` 原值。 */
  configStatus?: string;
  /**
   * config_status 规则下的权威出处覆盖。采集器从某份具体配置接来状态时，可带出比
   * `config:<raw>` 更具体的出处（例如 `config/hvac.yaml anchor indoor_living:confirmed`），
   * 让 statusSource 说清「来自哪个文件的哪一条、依据是什么」。缺省时退回 `config:<raw>`，
   * 行为与原先完全一致（电气/给排水仍走默认格式）。
   */
  configStatusSource?: string;
  /** 声明 note 里出现的 DEC 引用（裁定依据）。 */
  decision?: string;
}

/** verifier issue 的最小形状：`entity`（spatial/penetration）或 `id`（electrical-lint）都可以。 */
export interface IssueLike {
  entity?: string;
  id?: string;
  code: string;
  level: 'error' | 'warning' | 'info';
  message?: string;
}

export interface OpenQuestion {
  ref: string;
  summary: string;
  blockedBy: string;
}

export interface ElementState {
  id: string;
  kind: ElementKind;
  label: string;
  room?: string;
  status: ElementStatus;
  /** 给出该状态的权威出处（文件:字段 / 台账 #N / DEC / verifier code）。 */
  statusSource: string;
  openQuestion?: OpenQuestion;
  decision?: string;
  /** 触及该构件的 verifier issue code 列表（去重排序）。 */
  conflicts: string[];
}

export interface StateWarning {
  code: string;
  entity: string;
  message: string;
}

/** 优先级规则：配置给顺序，代码给谓词。 */
export type StateRuleId = 'conflict' | 'config_status' | 'ledger' | 'decision' | 'fallback';

export interface StateModel {
  /** 从高到低；第一条命中的规则决定 status。 */
  priority: StateRuleId[];
  /** config 状态词 → 统一状态词。 */
  statusVocabulary: Record<string, ElementStatus>;
}

export const DEFAULT_STATE_MODEL: StateModel = {
  priority: ['conflict', 'config_status', 'ledger', 'decision', 'fallback'],
  statusVocabulary: {
    measured: 'measured',
    likely: 'inferred',
    inferred: 'inferred',
    pending: 'pending',
    confirmed: 'confirmed',
  },
};

export interface ElementStateInput {
  elements: ElementInput[];
  /** `shared/pending-ledger.ts` 的解析结果。 */
  ledger: { entries: Array<{ ref: string; summary: string; blockedBy: string; targets: Array<{ file: string; id?: string }> }> };
  issues: IssueLike[];
  model?: StateModel;
  schedule?: { gate: string; status: string };
}

export interface ElementStateResult {
  states: ElementState[];
  warnings: StateWarning[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    undeclared: number;
    conflicted: number;
    pending: number;
  };
}

const KNOWN_RULES = new Set<StateRuleId>(['conflict', 'config_status', 'ledger', 'decision', 'fallback']);

/** 从 issue 取出它指向的构件引用：支持 `a↔b` 对、带前缀 id、裸 id 三种写法。 */
export function issueRefs(issue: IssueLike): string[] {
  const raw = issue.entity ?? issue.id;
  if (!raw) return [];
  return raw.split('↔').map((part) => part.trim()).filter(Boolean);
}

/** 判断一条 issue 是否触及给定构件。 */
export function issueTouches(issue: IssueLike, elementId: string): boolean {
  const bare = elementId.includes(':') ? elementId.slice(elementId.indexOf(':') + 1) : elementId;
  return issueRefs(issue).some((ref) => ref === elementId || ref === bare);
}

function ledgerIndex(input: ElementStateInput): Map<string, { ref: string; summary: string; blockedBy: string }> {
  const index = new Map<string, { ref: string; summary: string; blockedBy: string }>();
  for (const entry of input.ledger.entries) {
    for (const target of entry.targets) {
      if (!target.id) continue;
      // 台账写的是 `config/electrical.yaml sock_child_ac`；按文件推断前缀再拼成 objectId。
      const prefix = target.file.endsWith('electrical.yaml') ? 'electrical'
        : target.file.endsWith('plumbing.yaml') ? 'plumbing'
          : target.file.endsWith('ceiling.yaml') ? 'ceiling'
            : undefined;
      if (prefix) index.set(`${prefix}:${target.id}`, { ref: entry.ref, summary: entry.summary, blockedBy: entry.blockedBy });
    }
  }
  return index;
}

export function deriveElementStates(input: ElementStateInput): ElementStateResult {
  const model = input.model ?? DEFAULT_STATE_MODEL;
  const warnings: StateWarning[] = [];

  for (const rule of model.priority) {
    if (!KNOWN_RULES.has(rule)) {
      warnings.push({ code: 'state.rule_unknown', entity: rule, message: `state-model declares rule ${rule} with no implementation` });
    }
  }
  for (const rule of KNOWN_RULES) {
    if (!model.priority.includes(rule)) {
      warnings.push({ code: 'state.rule_undeclared', entity: rule, message: `implemented rule ${rule} is not declared in state-model priority` });
    }
  }

  const issuesByElement = new Map<string, IssueLike[]>();
  for (const element of input.elements) {
    const touched = input.issues.filter((issue) => issueTouches(issue, element.id));
    if (touched.length > 0) issuesByElement.set(element.id, touched);
  }
  const ledger = ledgerIndex(input);

  const states: ElementState[] = input.elements.map((element) => {
    const conflicts = [...new Set((issuesByElement.get(element.id) ?? []).map((issue) => issue.code))].sort();
    const errorIssues = (issuesByElement.get(element.id) ?? []).filter((issue) => issue.level === 'error');
    const openQuestion = ledger.get(element.id);
    // openQuestion 与 status 解耦：即使 status 由 config 字段决定，也带上「卡在谁」——
    // 那才是可行动的部分。
    // 矛盾告警只对 measured（现场实测）生效：inferred/likely 是设计值，和「还有未决问题」
    // 完全可以并存（如 faucet_garden：status=inferred + construction_status=pending +
    // not_for_construction，台账 #48 追踪的是「保留还是删除」这个设计决策）。只有实测过的
    // 东西还挂在待决台账上，才是「有人忘了关台账」的真矛盾。
    if (openQuestion && element.configStatus && model.statusVocabulary[element.configStatus] === 'measured') {
      warnings.push({
        code: 'state.config_vs_ledger_conflict',
        entity: element.id,
        message: `config status "${element.configStatus}" but pending-site-data #${openQuestion.ref} still tracks it as open`,
      });
    }
    const base = {
      id: element.id,
      kind: element.kind,
      label: element.label,
      ...(element.room ? { room: element.room } : {}),
      ...(element.decision ? { decision: element.decision } : {}),
      conflicts,
      ...(openQuestion ? { openQuestion } : {}),
    };

    for (const rule of model.priority) {
      switch (rule) {
        case 'conflict':
          if (errorIssues.length > 0) {
            return { ...base, status: 'conflicted', statusSource: `verifier:${errorIssues.map((issue) => issue.code).sort().join(',')}` };
          }
          break;
        case 'config_status': {
          const raw = element.configStatus;
          if (raw) {
            const mapped = model.statusVocabulary[raw];
            if (!mapped) {
              warnings.push({ code: 'state.status_unknown', entity: element.id, message: `config status "${raw}" is not in state-model statusVocabulary` });
              break;
            }
            return { ...base, status: mapped, statusSource: element.configStatusSource ?? `config:${raw}` };
          }
          break;
        }
        case 'ledger':
          if (openQuestion) {
            return { ...base, status: 'pending', statusSource: `pending-site-data #${openQuestion.ref}` };
          }
          break;
        case 'decision':
          if (element.decision) {
            return { ...base, status: 'confirmed', statusSource: `decision:${element.decision}` };
          }
          break;
        case 'fallback':
          return { ...base, status: 'undeclared', statusSource: 'no status field, no ledger entry, no DEC ref' };
      }
    }
    // 配置把 fallback 删了会走到这里——显形而不是静默给一个状态。
    warnings.push({ code: 'state.no_fallback', entity: element.id, message: 'state-model priority has no fallback rule' });
    return { ...base, status: 'undeclared', statusSource: 'state-model priority exhausted without a fallback' };
  });

  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const state of states) {
    byStatus[state.status] = (byStatus[state.status] ?? 0) + 1;
    byKind[state.kind] = (byKind[state.kind] ?? 0) + 1;
  }

  return {
    states,
    warnings,
    summary: {
      total: states.length,
      byStatus,
      byKind,
      undeclared: byStatus.undeclared ?? 0,
      conflicted: byStatus.conflicted ?? 0,
      pending: byStatus.pending ?? 0,
    },
  };
}
