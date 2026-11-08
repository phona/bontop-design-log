/**
 * 构件级工程状态派生：把配置字段与门禁结论里的「置信度」收敛成**每个构件一条记录**，
 * 让 3D 与 agent 能用同一套语言回答「这东西确认了吗」。
 *
 * 三条设计约束：
 * 1. **纯函数、零 I/O**：所有输入由调用方注入（配置数组、issue、状态模型）。
 *    CLI / server / app 三方共用同一实现，与 `shared/ceiling-takeoff.ts` 同规格。
 * 2. **只派生，不存储**：权威仍在原处（config 字段 / verifier），本模块不成为第二份真相。
 *    派生不出来的状态是 `undeclared`——一种要显形的状态，不是「默认已确认」。
 * 3. **优先级可评审**：规则顺序与 `status_vocabulary` 状态词映射来自
 *    `config/state-model.yaml`（调用方注入后经 `model` 参数进来），代码只提供谓词；
 *    配置申报了代码没有的规则 → warning（覆盖矩阵不许说谎）。
 *
 * 2026-11-08 issue #98 S2-A：**状态不再查表**。原 `ledger`（查 docs/pending-site-data.md）
 * 与 `decision`（note 里有 DEC 编号 → confirmed）两条规则删除，优先级只剩
 * `[conflict, config_status, fallback]`。未决的「卡在谁、什么事件能解锁、什么条件下反转」
 * 由构件自己的 `blocker` 字段承载（shared/element-blockers.ts 门禁兜底完整性），
 * 不再由任何中央账本派生。
 */

import type { ComponentBlocker } from './types.js';
import { ELEMENT_BEARING_SOURCES, SOURCE_PREFIXES, SOURCES } from './envelope-sources.js';

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
  /** config 的 `status` 原值——构件状态的唯一声明字段（issue #98 S2-A）。 */
  configStatus?: string;
  /**
   * config_status 规则下的权威出处覆盖。采集器从某份具体配置接来状态时，可带出比
   * `config:<raw>` 更具体的出处（例如 `config/hvac.yaml anchor indoor_living:confirmed`），
   * 让 statusSource 说清「来自哪个文件的哪一条、依据是什么」。缺省时退回 `config:<raw>`，
   * 行为与原先完全一致（电气/给排水仍走默认格式）。
   */
  configStatusSource?: string;
  /** 构件自己声明的未决项（issue #98 S2-A）：pending/undeclared 时的「卡在谁 / 何时解锁 / 何时反转」。 */
  blocker?: ComponentBlocker;
  /** 声明 note 里出现的 DEC 引用（溯源用，**不参与状态派生**——S2-A 起 note 内编号不再产生 confirmed）。 */
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

export interface ElementState {
  id: string;
  kind: ElementKind;
  label: string;
  room?: string;
  status: ElementStatus;
  /** 给出该状态的权威出处（文件:字段 / verifier code）。S2-A 起只可能是 config 或 verifier。 */
  statusSource: string;
  /** 构件自己声明的未决项（issue #98 S2-A：pending/undeclared 时的「卡在谁 / 何时解锁 / 何时反转」）。 */
  blocker?: ComponentBlocker;
  /**
   * **遗留显示字段**（2026-11-08 S2-A 起不再是状态的任何来源，也不再是「卡在谁」的权威）。
   *
   * 它只由调用方注入的 `ledger` 参数产生，而 `scripts/project/state-projection.ts`
   * （`npm run state:project`）已不再注入台账——CLI 输出里它恒为 undefined。
   * 保留它仅为 `server/element-state-service.ts`（`GET /api/element-state`）及其存量测试
   * 的调用兼容；`docs/pending-site-data.md` 整份删除时（issue #98 S2-B）一并移除。
   * 权威的「卡在谁」是上面的 `blocker`。
   */
  openQuestion?: OpenQuestion;
  decision?: string;
  /** 触及该构件的 verifier issue code 列表（去重排序）。 */
  conflicts: string[];
}

export interface OpenQuestion {
  ref: string;
  summary: string;
  blockedBy: string;
}

export interface StateWarning {
  code: string;
  entity: string;
  message: string;
}

/** 优先级规则：配置给顺序，代码给谓词。 */
export type StateRuleId = 'conflict' | 'config_status' | 'fallback';

export interface StateModel {
  /** 从高到低；第一条命中的规则决定 status。 */
  priority: StateRuleId[];
  /** config 状态词 → 统一状态词。 */
  statusVocabulary: Record<string, ElementStatus>;
}

export const DEFAULT_STATE_MODEL: StateModel = {
  priority: ['conflict', 'config_status', 'fallback'],
  statusVocabulary: {
    measured: 'measured',
    likely: 'inferred',
    inferred: 'inferred',
    pending: 'pending',
    confirmed: 'confirmed',
    undeclared: 'undeclared',
  },
};

export interface ElementStateInput {
  elements: ElementInput[];
  issues: IssueLike[];
  model?: StateModel;
  schedule?: { gate: string; status: string };
  /**
   * 待决台账解析结果（`shared/pending-ledger.ts`）。**S2-A 起只用于产出遗留显示字段
   * `openQuestion`，不再是任何状态的来源**（ledger 优先级规则已删）。`npm run state:project`
   * 已不注入它（CLI 输出里 openQuestion 恒为 undefined）；保留该参数与 openQuestion 仅为
   * `server/element-state-service.ts`（GET /api/element-state）及其存量测试的调用兼容，
   * `docs/pending-site-data.md` 整份删除时（issue #98 S2-B）一并移除。
   */
  ledger?: { entries: Array<{ ref: string; summary: string; blockedBy: string; targets: Array<{ file: string; id?: string }> }> };
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

const KNOWN_RULES = new Set<StateRuleId>(['conflict', 'config_status', 'fallback']);

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

/**
 * 遗留：把台账条目按构件 id 建索引，仅供 `openQuestion` 显示字段使用（见该字段注）。
 * 不参与任何状态判定——S2-A 起 ledger 不再是状态来源。
 */
function ledgerIndex(input: ElementStateInput): Map<string, OpenQuestion> {
  const index = new Map<string, OpenQuestion>();
  for (const entry of input.ledger?.entries ?? []) {
    for (const target of entry.targets) {
      if (!target.id) continue;
      // 台账写的是 `config/electrical.yaml sock_child_ac`；源名（→ objectId 前缀）由
      // shared/envelope-sources.ts 注册表按**完整路径**反查。原实现按
      // `endsWith('ceiling.yaml')` 猜——S1 搬迁（config/ceiling.yaml →
      // config/model/envelope/ceiling.yaml）这类改名会猜错，且任何同后缀文件都会误命中。
      // 只认 ELEMENT_BEARING_SOURCES 三个源（collectElements 真的采它们的构件）：
      // hvac 的行（#3a `reference_constraints`）是字段描述不是元素 id，纳入会产生假悬挂键。
      const source = ELEMENT_BEARING_SOURCES.find((name) => (SOURCES[name].files as readonly string[]).includes(target.file));
      if (source) index.set(`${SOURCE_PREFIXES[source]}${target.id}`, { ref: entry.ref, summary: entry.summary, blockedBy: entry.blockedBy });
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
  // 遗留显示面：只有调用方显式注入台账时才建索引。CLI（state-projection.ts）不注入，
  // 因此 `npm run state:project` 完全不读 docs/pending-site-data.md。
  const legacyLedger = input.ledger ? ledgerIndex(input) : new Map<string, OpenQuestion>();

  const states: ElementState[] = input.elements.map((element) => {
    const conflicts = [...new Set((issuesByElement.get(element.id) ?? []).map((issue) => issue.code))].sort();
    const errorIssues = (issuesByElement.get(element.id) ?? []).filter((issue) => issue.level === 'error');
    // 「卡在谁」的权威是对象自己的 blocker；legacyLedger 只是还没退休的显示兼容层。
    const base = {
      id: element.id,
      kind: element.kind,
      label: element.label,
      ...(element.room ? { room: element.room } : {}),
      ...(element.decision ? { decision: element.decision } : {}),
      ...(element.blocker ? { blocker: element.blocker } : {}),
      conflicts,
      ...(legacyLedger.get(element.id) ? { openQuestion: legacyLedger.get(element.id)! } : {}),
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
        case 'fallback':
          return { ...base, status: 'undeclared', statusSource: 'no status field declared on the object' };
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
