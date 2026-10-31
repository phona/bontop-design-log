// 决策门禁登记表（config/decision-gates.yaml）的加载与纯判定内核。
//
// 存在理由：装修口径里有大量「并列旗标」——打压三档、闭水两档、龙骨两档、
// 强弱电间距三个对象。报告铁律是「未拍板不能直接写进验收合格线」，但在此之前
// 这只活在 acceptance.yaml 的 knowledge 散文里，没有任何机器强制：一边
// check_carp_keel 写死 ≤400mm，一边 D9 说 300/400 未拍板，门禁全绿。
//
// 本模块把登记表变成可判事实：scope=acceptance 且 status=open 的决策所阻塞的
// 验收项，不得出现 passed 审计记录。判定函数全部纯函数（不碰 fs），
// 文件加载单独隔离，测试直接喂数据。

import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';

export const DECISION_GATES_PATH = 'config/decision-gates.yaml';
/** 叙事侧登记表：决策点 D1–D18 的人读版（待拍板内容与缺的证据）。 */
export const NARRATIVE_DECISION_REGISTRY_PATH = 'docs/pending-site-data.md';
const NARRATIVE_SECTION_MARKER = '## 决策点登记';

/** 决策编号形如 D5；report 的 D1–D18 与仓内既有引用都走这个形态。 */
const DECISION_ID_PATTERN = /^D\d+$/;
/** 散文里「待 Dx 拍板」的引用形态。 */
const PROSE_DECISION_PATTERN = /\bD(\d+)\b/g;
/** 散文里与决策共现的验收项编号。 */
const PROSE_CHECK_PATTERN = /\b(check_[a-z0-9_]+)\b/g;

export type DecisionScope = 'acceptance' | 'tracked';
export type DecisionStatus = 'open' | 'decided';

export interface Decision {
  id: string;
  topic: string;
  scope: DecisionScope;
  question: string;
  options: string[];
  status: DecisionStatus;
  /** scope=acceptance 必填：被阻塞的验收项 id（acceptance.yaml 或 control.yaml 内置 check）。 */
  blocks?: string[];
  /** scope=acceptance 必填：阻塞期间会发生什么、什么时候必须拍板。 */
  blocked_effect?: string;
  /** scope=tracked 必填：为什么不阻塞、缺口由谁跟踪。 */
  tracking_note?: string;
  /** status=decided 必填四件套。 */
  decided_value?: string;
  decided_by?: string;
  decided_at?: string;
  decision_evidence?: string[];
}

export interface DecisionGates {
  version: number;
  decisions: Decision[];
}

export interface GateIssue {
  code: string;
  severity: 'error' | 'warning';
  decision?: string;
  check?: string;
  message: string;
}

/** 散文引用：某段文本提到了哪个决策、同时点了哪些验收项。 */
export interface ProseMention {
  source: string;
  decisionId: string;
  namedChecks: string[];
}

export interface ValidateInput {
  gates: DecisionGates;
  /** 全部合法验收项 id：acceptance.yaml 的 items 与各阶段 control.yaml 的内置 checks。 */
  knownCheckIds: Set<string>;
  /** 出现过 passed 审计记录的验收项 id（跨包收集，一个验收项被多个包引用时任一包 passed 都算）。 */
  passedCheckIds: Set<string>;
  /** 验收配置与工作包检查文本里的决策引用。 */
  proseMentions: ProseMention[];
  /**
   * 叙事侧登记的决策编号（docs/pending-site-data.md「决策点登记」节的表格行）。
   * 机器门禁与叙事登记必须同步移动：只登记一侧等于另一侧静默失效。
   * 不传则跳过该项对照。
   */
  narrativeDecisionIds?: Set<string>;
}

export function parseDecisionGates(text: string): DecisionGates {
  const doc = yaml.load(text) as DecisionGates | null;
  if (!doc || !Array.isArray(doc.decisions)) {
    throw new Error(`${DECISION_GATES_PATH}: 缺少 decisions 列表`);
  }
  return doc;
}

export function loadDecisionGates(root: string): DecisionGates {
  const absolute = path.join(root, DECISION_GATES_PATH);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${DECISION_GATES_PATH} 缺失：决策门禁登记表是 verify:decision-gates 的输入，删文件等于关掉门禁`);
  }
  return parseDecisionGates(fs.readFileSync(absolute, 'utf8'));
}

/**
 * 读叙事登记表（docs/pending-site-data.md「决策点登记」节）里的决策编号集合。
 * 只取表格行首的 `| D<n> ` 形态；节标题里的「D1–D18」字样不是行首，不会误收。
 * 文件或节缺失时返回空集——由调用方决定是否当作漂移（verifier 传空集即跳过对照）。
 */
export function readNarrativeDecisionIds(root: string): Set<string> {
  const absolute = path.join(root, NARRATIVE_DECISION_REGISTRY_PATH);
  if (!fs.existsSync(absolute)) return new Set();
  const text = fs.readFileSync(absolute, 'utf8');
  const start = text.indexOf(NARRATIVE_SECTION_MARKER);
  if (start < 0) return new Set();
  const rest = text.slice(start);
  const nextHeading = rest.indexOf('\n## ', NARRATIVE_SECTION_MARKER.length);
  const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading);
  return new Set([...section.matchAll(/^\|\s*(D\d+)\s/gm)].map((match) => match[1]));
}

/** 收集一段散文里的决策引用与共现验收项；decisionId 形如 D5（不带前缀 D 的数字不收）。 */
export function collectProseMentions(text: string, source: string): ProseMention[] {
  const mentions: ProseMention[] = [];
  const decisionMatches = [...text.matchAll(PROSE_DECISION_PATTERN)];
  if (!decisionMatches.length) return mentions;
  const namedChecks = [...new Set([...text.matchAll(PROSE_CHECK_PATTERN)].map((match) => match[1]))];
  for (const match of decisionMatches) {
    mentions.push({ source, decisionId: `D${match[1]}`, namedChecks });
  }
  return mentions;
}

/** 阻塞某个验收项的开放门禁（control.ts 渲染注释用）。 */
export function openDecisionsBlocking(gates: DecisionGates, checkId: string): Decision[] {
  return gates.decisions.filter(
    (decision) => decision.scope === 'acceptance' && decision.status === 'open' && (decision.blocks ?? []).includes(checkId),
  );
}

export function openGatesByCheck(gates: DecisionGates): Map<string, Decision[]> {
  const map = new Map<string, Decision[]>();
  for (const decision of gates.decisions) {
    if (decision.scope !== 'acceptance' || decision.status !== 'open') continue;
    for (const checkId of decision.blocks ?? []) {
      const existing = map.get(checkId) ?? [];
      existing.push(decision);
      map.set(checkId, existing);
    }
  }
  return map;
}

const nonEmpty = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * 登记表自洽性 + 门禁语义的全量判定。返回的 issues 里 severity=error 的每一项
 * 都对应一种「未拍板却已放行」或「门禁只活在注释里」的失效，不许降级为 warning。
 */
export function validateDecisionGates(input: ValidateInput): GateIssue[] {
  const { gates, knownCheckIds, passedCheckIds, proseMentions, narrativeDecisionIds } = input;
  const issues: GateIssue[] = [];
  const fail = (issue: GateIssue) => issues.push(issue);

  if (gates.version !== 1) {
    fail({ code: 'unsupported_version', severity: 'error', message: `version 必须为 1，当前为 ${String(gates.version)}` });
  }

  const byId = new Map<string, Decision>();
  const blockOwner = new Map<string, string>();
  for (const decision of gates.decisions) {
    const label = decision?.id ?? '(缺失 id)';
    if (!nonEmpty(decision?.id) || !DECISION_ID_PATTERN.test(decision.id)) {
      fail({ code: 'decision_id_format', severity: 'error', decision: label, message: `决策编号必须匹配 D+数字，当前为 ${JSON.stringify(decision?.id)}` });
      continue;
    }
    if (byId.has(decision.id)) {
      fail({ code: 'duplicate_decision_id', severity: 'error', decision: decision.id, message: '决策编号重复登记' });
      continue;
    }
    byId.set(decision.id, decision);

    if (!['acceptance', 'tracked'].includes(decision.scope)) {
      fail({ code: 'invalid_scope', severity: 'error', decision: decision.id, message: `scope 必须为 acceptance 或 tracked，当前为 ${JSON.stringify(decision.scope)}` });
    }
    if (!['open', 'decided'].includes(decision.status)) {
      fail({ code: 'invalid_status', severity: 'error', decision: decision.id, message: `status 必须为 open 或 decided，当前为 ${JSON.stringify(decision.status)}` });
    }
    if (!nonEmpty(decision.topic) || !nonEmpty(decision.question)) {
      fail({ code: 'missing_topic_or_question', severity: 'error', decision: decision.id, message: 'topic 与 question 必填' });
    }
    if (!Array.isArray(decision.options) || decision.options.length < 2) {
      fail({ code: 'options_min_two', severity: 'error', decision: decision.id, message: '选项少于两个不构成决策，至少列两个旗标' });
    }

    if (decision.scope === 'acceptance') {
      const blocks = decision.blocks ?? [];
      if (blocks.length === 0) {
        fail({ code: 'acceptance_requires_blocks', severity: 'error', decision: decision.id, message: 'scope=acceptance 必须登记 blocks' });
      }
      if (!nonEmpty(decision.blocked_effect)) {
        fail({ code: 'acceptance_requires_blocked_effect', severity: 'error', decision: decision.id, message: 'scope=acceptance 必须写 blocked_effect（阻塞会发生什么、何时必须拍板）' });
      }
      for (const checkId of blocks) {
        if (!knownCheckIds.has(checkId)) {
          fail({ code: 'unknown_blocked_check', severity: 'error', decision: decision.id, check: checkId, message: 'blocks 引用了不存在的验收项' });
          continue;
        }
        const owner = blockOwner.get(checkId);
        if (owner && owner !== decision.id) {
          fail({
            code: 'check_blocked_by_multiple_decisions',
            severity: 'error',
            decision: decision.id,
            check: checkId,
            message: `同一验收项已被 ${owner} 阻塞；确需两个门禁先拆验收项，再分别登记`,
          });
          continue;
        }
        blockOwner.set(checkId, decision.id);
      }
    }

    if (decision.scope === 'tracked') {
      if (!nonEmpty(decision.tracking_note)) {
        fail({ code: 'tracked_requires_note', severity: 'error', decision: decision.id, message: 'scope=tracked 必须写 tracking_note（为什么不阻塞、缺口由谁跟踪）' });
      }
      if ((decision.blocks ?? []).length > 0) {
        fail({ code: 'tracked_must_not_block', severity: 'error', decision: decision.id, message: 'scope=tracked 不得登记 blocks；要阻塞就改 scope=acceptance' });
      }
    }

    if (decision.status === 'decided') {
      const missing = [
        nonEmpty(decision.decided_value) ? null : 'decided_value',
        nonEmpty(decision.decided_by) ? null : 'decided_by',
        nonEmpty(decision.decided_at) ? null : 'decided_at',
        Array.isArray(decision.decision_evidence) && decision.decision_evidence.length > 0 ? null : 'decision_evidence',
      ].filter((field): field is string => field !== null);
      if (missing.length) {
        fail({ code: 'decided_requires_record', severity: 'error', decision: decision.id, message: `status=decided 缺少 ${missing.join('、')}` });
      }
      if (decision.scope === 'acceptance' && (decision.blocks ?? []).length === 0) {
        fail({ code: 'decided_gate_without_blocks', severity: 'error', decision: decision.id, message: '已拍板的验收门禁必须保留 blocks（记录它曾经阻塞什么）' });
      }
    }

    // 门禁语义本体：开放中的验收门禁，其阻塞项不得已有 passed 审计记录。
    if (decision.scope === 'acceptance' && decision.status === 'open') {
      for (const checkId of decision.blocks ?? []) {
        if (passedCheckIds.has(checkId)) {
          fail({
            code: 'passed_under_open_decision',
            severity: 'error',
            decision: decision.id,
            check: checkId,
            message: `决策未拍板，验收项却已有 passed 记录：未拍板档位不得判通过，复验前付款门槛不得放行`,
          });
        }
      }
    }
  }

  // 反向防线：散文里提了决策编号，登记表必须收；散文点名的验收项必须登记在该决策的 blocks 里。
  for (const mention of proseMentions) {
    const decision = byId.get(mention.decisionId);
    if (!decision) {
      fail({
        code: 'prose_decision_unregistered',
        severity: 'error',
        decision: mention.decisionId,
        message: `${mention.source} 提到待 ${mention.decisionId} 拍板，但登记表没有这个决策：门禁不许只活在注释里`,
      });
      continue;
    }
    for (const checkId of mention.namedChecks) {
      if (!(decision.blocks ?? []).includes(checkId)) {
        fail({
          code: 'prose_block_mismatch',
          severity: 'error',
          decision: mention.decisionId,
          check: checkId,
          message: `${mention.source} 说「待 ${mention.decisionId} 拍板、不得擅自改写 ${checkId}」，但 ${checkId} 没有登记在 ${mention.decisionId} 的 blocks 里`,
        });
      }
    }
  }

  // 双登记对照：docs/pending-site-data.md 的叙事登记表与本表必须同时移动。
  // 只登记一侧，另一侧就静默失效——叙事说待拍板而机器侧没有门禁，或反过来。
  if (narrativeDecisionIds) {
    for (const decisionId of narrativeDecisionIds) {
      if (!byId.has(decisionId)) {
        fail({
          code: 'decision_missing_from_gates',
          severity: 'error',
          decision: decisionId,
          message: '叙事登记表（docs/pending-site-data.md 决策点登记节）列了这个决策，但本表没有：机器门禁覆盖不到它',
        });
      }
    }
    for (const decision of gates.decisions) {
      if (!narrativeDecisionIds.has(decision.id)) {
        fail({
          code: 'decision_missing_from_docs',
          severity: 'error',
          decision: decision.id,
          message: '本表登记了这个决策，但叙事登记表（docs/pending-site-data.md 决策点登记节）没有：两侧必须同步移动',
        });
      }
      if (decision.status === 'decided' && narrativeDecisionIds.has(decision.id)) {
        fail({
          code: 'decided_but_narrative_pending',
          severity: 'warning',
          decision: decision.id,
          message: '本表已拍板，叙事登记表仍列为待拍板：同步更新 docs/pending-site-data.md 的决策点登记节',
        });
      }
    }
  }

  return issues;
}
